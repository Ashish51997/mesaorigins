import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedUserContext } from '../../lib/authContext';
import { ApiError, errorHandler } from '../../middleware/error';
import { resolveTenant } from '../../middleware/tenant';
import {
  assertSeparateActor,
  assertVendorLifecycleTransition,
  type MesaErpVendorAccessService,
  type ErpRoleDto,
  type PermissionCheck,
  type PermissionDto,
  type RoleAssignmentDto,
  type VendorBankDto,
  type VendorDto,
} from '../vendorAccessService';
import {
  createMesaErpVendorAccessRouter,
  MESAERP_VENDOR_ACCESS_PERMISSIONS,
} from '../vendorAccessRouter';
import type {
  RoleAssignmentCreate,
  RoleAssignmentRevoke,
  ErpRoleCreate,
  RolePermissionsReplace,
  VendorBankCreate,
  VendorBankVerify,
  VendorCreate,
  VendorLifecycleTransition,
} from '../vendorAccessSchemas';

const NOW = '2026-08-14T00:00:00.000Z';

function vendor(input: VendorCreate, legalEntityId: string): VendorDto {
  return {
    id: 'vendor-1', legalEntityId, vendorCode: input.vendorCode, legalName: input.legalName,
    tradeName: input.tradeName, pan: input.pan, gstin: input.gstin, msmeNumber: input.msmeNumber,
    addresses: input.addresses, contacts: input.contacts, categories: input.categories,
    plantCoverage: input.plantCoverage, geographyCoverage: input.geographyCoverage,
    paymentTerms: input.paymentTerms, currency: input.currency, creditDays: input.creditDays,
    taxClassification: input.taxClassification, tdsClassification: input.tdsClassification,
    avlStatus: 'not_listed', lifecycleStatus: 'invited', riskRating: 'unrated',
    complianceStatus: 'pending', rowVersion: 0, createdAt: NOW, updatedAt: NOW, bankAccounts: [],
  };
}

class FakeVendorAccessService implements MesaErpVendorAccessService {
  readonly grants = new Set<string>();
  readonly vendors = new Map<string, VendorDto>();
  lastIdempotencyKey = '';

  grant(membershipId: string, legalEntityId: string, permission: string) {
    this.grants.add(`${membershipId}:${legalEntityId}:${permission}`);
  }

  hasPermission(input: PermissionCheck): Promise<boolean> {
    return Promise.resolve(this.grants.has(`${input.membershipId}:${input.legalEntityId}:${input.permission}`));
  }

  listVendors(legalEntityId: string): Promise<VendorDto[]> {
    return Promise.resolve([...this.vendors.values()].filter((row) => row.legalEntityId === legalEntityId));
  }

  createVendor(legalEntityId: string, input: VendorCreate, idempotencyKey: string): Promise<VendorDto> {
    this.lastIdempotencyKey = idempotencyKey;
    const row = vendor(input, legalEntityId);
    this.vendors.set(row.id, row);
    return Promise.resolve(row);
  }

  transitionVendor(_legalEntityId: string, _vendorId: string, input: VendorLifecycleTransition, idempotencyKey: string): Promise<VendorDto> {
    this.lastIdempotencyKey = idempotencyKey;
    const row = this.vendors.get('vendor-1')!;
    const updated = { ...row, lifecycleStatus: input.to, rowVersion: row.rowVersion + 1 };
    this.vendors.set(row.id, updated);
    return Promise.resolve(updated);
  }

  addVendorBank(legalEntityId: string, vendorId: string, input: VendorBankCreate, idempotencyKey: string): Promise<VendorBankDto> {
    this.lastIdempotencyKey = idempotencyKey;
    return Promise.resolve({
      id: 'bank-1', vendorId, legalEntityId, accountHolderName: input.accountHolderName,
      bankName: input.bankName, accountNumberMasked: `******${input.accountNumber.slice(-4)}`,
      ifsc: input.ifsc, branch: input.branch, currency: input.currency, status: 'pending_verification',
      verifiedBy: null, verifiedAt: null, rowVersion: 0, createdAt: NOW,
    });
  }

  verifyVendorBank(legalEntityId: string, vendorId: string, bankAccountId: string, input: VendorBankVerify, idempotencyKey: string): Promise<VendorBankDto> {
    this.lastIdempotencyKey = idempotencyKey;
    return Promise.resolve({
      id: bankAccountId, vendorId, legalEntityId, accountHolderName: 'Vendor', bankName: 'Bank',
      accountNumberMasked: '******1234', ifsc: 'HDFC0001234', branch: '', currency: 'INR',
      status: input.decision, verifiedBy: 'checker', verifiedAt: NOW, rowVersion: input.expectedRowVersion + 1, createdAt: NOW,
    });
  }

  listPermissions(_legalEntityId: string): Promise<PermissionDto[]> {
    return Promise.resolve([{ id: 'permission-1', key: 'mesaerp.vendor.read', label: 'Read vendors', description: '', riskLevel: 'standard' }]);
  }

  listRoleAssignments(_legalEntityId: string): Promise<RoleAssignmentDto[]> {
    return Promise.resolve([]);
  }

  listRoles(_legalEntityId: string): Promise<ErpRoleDto[]> {
    return Promise.resolve([{ id: 'role-1', name: 'AP Maker', version: 0, isSystem: false, permissions: [] }]);
  }

  createRole(_legalEntityId: string, input: ErpRoleCreate, idempotencyKey: string): Promise<ErpRoleDto> {
    this.lastIdempotencyKey = idempotencyKey;
    return Promise.resolve({ id: 'role-created', name: input.name, version: 0, isSystem: false, permissions: [] });
  }

  replaceRolePermissions(_legalEntityId: string, roleId: string, input: RolePermissionsReplace, idempotencyKey: string): Promise<ErpRoleDto> {
    this.lastIdempotencyKey = idempotencyKey;
    return Promise.resolve({
      id: roleId, name: 'AP Maker', version: input.expectedRoleVersion + 1, isSystem: false,
      permissions: input.grants.map((key) => ({ key, effect: 'allow', riskLevel: 'standard' })),
    });
  }

  assignRole(legalEntityId: string, input: RoleAssignmentCreate, idempotencyKey: string): Promise<RoleAssignmentDto> {
    this.lastIdempotencyKey = idempotencyKey;
    return Promise.resolve({
      id: 'assignment-1', legalEntityId,
      membership: { id: input.membershipId, employeeCode: 'EMP-1', name: 'Finance Maker', email: 'maker@example.test' },
      role: { id: input.roleId, name: 'AP Maker' }, permissions: [{ key: 'mesaerp.vendor.manage', effect: 'allow' }],
      status: 'active', validFrom: input.validFrom ?? null, validTo: input.validTo ?? null, rowVersion: 0,
    });
  }

  revokeRole(legalEntityId: string, assignmentId: string, input: RoleAssignmentRevoke, idempotencyKey: string): Promise<RoleAssignmentDto> {
    this.lastIdempotencyKey = idempotencyKey;
    return Promise.resolve({
      id: assignmentId, legalEntityId,
      membership: { id: 'membership-target', employeeCode: 'EMP-1', name: 'Finance Maker', email: 'maker@example.test' },
      role: { id: 'role-1', name: 'AP Maker' }, permissions: [{ key: 'mesaerp.vendor.manage', effect: 'allow' }],
      status: 'revoked', validFrom: null, validTo: null, rowVersion: input.rowVersion + 1,
    });
  }
}

function buildTestApp() {
  const service = new FakeVendorAccessService();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const organizationId = req.header('x-test-org') || 'org-a';
    const isAdmin = req.header('x-test-admin') === '1';
    const organization = {
      organizationId,
      organizationName: organizationId,
      organizationSlug: organizationId,
      membershipId: req.header('x-test-member') || 'membership-a',
      employeeCode: 'EMP-1',
      role: isAdmin ? 'Administrator' : 'Finance User',
      isAdmin,
      screens: ['legacy-screen-that-must-not-grant-erp-access'],
      services: [{ id: 'mesaerp', name: 'MesaERP', description: '', status: req.header('x-test-service') || 'active', sortOrder: 30 }],
    };
    req.user = {
      userId: `user-${organizationId}`, email: `${organizationId}@example.test`, name: organizationId,
      ...organization, organizations: [organization],
    } satisfies AuthenticatedUserContext;
    next();
  });
  app.use(resolveTenant);
  app.use('/api/mesaerp/v1', createMesaErpVendorAccessRouter(service));
  app.use(errorHandler);
  return { app, service };
}

const vendorBody = {
  vendorCode: 'SUP-001',
  legalName: 'Polymer Supplier Private Limited',
  pan: 'ABCDE1234F',
  gstin: '27ABCDE1234F1Z5',
  contacts: [{ name: 'Accounts', email: 'accounts@example.test' }],
};

describe('MesaERP vendor and access resources', () => {
  it('uses exact company permissions and denies legacy-screen fallthrough', async () => {
    const { app, service } = buildTestApp();
    const denied = await request(app).get('/api/mesaerp/v1/entities/company-a/vendors');
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toContain('mesaerp.vendor.read');

    const legacyAdminDenied = await request(app).get('/api/mesaerp/v1/entities/company-a/vendors')
      .set('x-test-admin', '1');
    expect(legacyAdminDenied.status).toBe(403);

    service.grant('membership-a', 'company-a', MESAERP_VENDOR_ACCESS_PERMISSIONS.vendorRead);
    const allowed = await request(app).get('/api/mesaerp/v1/entities/company-a/vendors');
    expect(allowed.status).toBe(200);

    const otherCompany = await request(app).get('/api/mesaerp/v1/entities/company-b/vendors');
    expect(otherCompany.status).toBe(403);
  });

  it('validates create input and requires an idempotency key before calling the service', async () => {
    const { app, service } = buildTestApp();
    service.grant('membership-a', 'company-a', MESAERP_VENDOR_ACCESS_PERMISSIONS.vendorCreate);
    const missingKey = await request(app).post('/api/mesaerp/v1/entities/company-a/vendors').send(vendorBody);
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe('idempotency_key_required');

    const created = await request(app).post('/api/mesaerp/v1/entities/company-a/vendors')
      .set('Idempotency-Key', 'vendor-create-001').send(vendorBody);
    expect(created.status).toBe(201);
    expect(created.body.vendorCode).toBe('SUP-001');
    expect(service.lastIdempotencyKey).toBe('vendor-create-001');
  });

  it('enforces maker-checker vendor decisions and separate bank verification actors', () => {
    expect(() => assertVendorLifecycleTransition({
      from: 'under_review', to: 'approved', actorMembershipId: 'maker',
      createdByMembershipId: 'maker', lastLifecycleActorMembershipId: 'maker',
    })).toThrowError(ApiError);

    expect(() => assertVendorLifecycleTransition({
      from: 'under_review', to: 'approved', actorMembershipId: 'checker',
      createdByMembershipId: 'maker', lastLifecycleActorMembershipId: 'maker',
    })).not.toThrow();

    expect(() => assertSeparateActor('Vendor bank verification', 'maker', 'maker')).toThrowError(ApiError);
    expect(() => assertSeparateActor('Vendor bank verification', 'maker', 'checker')).not.toThrow();
  });

  it('keeps bank verification and company role assignment behind distinct grants', async () => {
    const { app, service } = buildTestApp();
    service.grant('membership-a', 'company-a', MESAERP_VENDOR_ACCESS_PERMISSIONS.vendorBankAdd);
    const mismatch = await request(app).post('/api/mesaerp/v1/entities/company-a/vendors/vendor-1/bank-accounts')
      .set('Idempotency-Key', 'vendor-bank-001')
      .send({ accountHolderName: 'Vendor', bankName: 'HDFC Bank', accountNumber: '1234567890', confirmAccountNumber: '1234567891', ifsc: 'HDFC0001234' });
    expect(mismatch.status).toBe(422);

    const verifyDenied = await request(app).post('/api/mesaerp/v1/entities/company-a/vendors/vendor-1/bank-accounts/bank-1/verify')
      .set('Idempotency-Key', 'vendor-bank-verify-001')
      .send({ decision: 'verified', verificationReference: 'penny-drop-1', expectedRowVersion: 0 });
    expect(verifyDenied.status).toBe(403);

    service.grant('membership-a', 'company-a', MESAERP_VENDOR_ACCESS_PERMISSIONS.accessAssign);
    const role = await request(app).post('/api/mesaerp/v1/entities/company-a/access/roles')
      .set('Idempotency-Key', 'role-create-001')
      .send({ name: 'Plant Cost Reviewer', grants: ['mesaerp.reports.read'] });
    expect(role.status).toBe(201);
    expect(role.body.name).toBe('Plant Cost Reviewer');

    const assigned = await request(app).post('/api/mesaerp/v1/entities/company-a/access/role-assignments')
      .set('Idempotency-Key', 'role-assignment-001')
      .send({ membershipId: 'membership-target', roleId: 'role-1' });
    expect(assigned.status).toBe(201);
    expect(assigned.body.legalEntityId).toBe('company-a');
    expect(assigned.body.permissions).toEqual([{ key: 'mesaerp.vendor.manage', effect: 'allow' }]);
  });
});
