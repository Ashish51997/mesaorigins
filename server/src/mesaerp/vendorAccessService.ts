import { createCipheriv, randomBytes } from 'node:crypto';
import { Prisma, type ErpVendor, type ErpVendorBankAccount } from '@prisma/client';
import { basePrisma, tenantTx, withTenant } from '../db';
import { audit } from '../lib/audit';
import { tenantContext, type TenantCtx } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import { hasMesaErpPermission } from './access';
import { hashCanonical } from './repository';
import type {
  RoleAssignmentCreate,
  RoleAssignmentRevoke,
  ErpRoleCreate,
  RolePermissionsReplace,
  VendorBankCreate,
  VendorBankVerify,
  VendorCreate,
  VendorLifecycleStatus,
  VendorLifecycleTransition,
} from './vendorAccessSchemas';

type Db = typeof basePrisma;
type VendorWithBanks = ErpVendor & { bankAccounts: ErpVendorBankAccount[] };
type AssignmentWithDetails = Prisma.RoleAssignmentGetPayload<{
  include: {
    membership: { include: { user: true } };
    role: { include: { permissions: { include: { permission: true } } } };
  };
}>;

export interface VendorBankDto {
  id: string;
  vendorId: string;
  legalEntityId: string;
  accountHolderName: string;
  bankName: string;
  accountNumberMasked: string;
  ifsc: string;
  branch: string;
  currency: string;
  status: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rowVersion: number;
  createdAt: string;
}

export interface VendorDto {
  id: string;
  legalEntityId: string;
  vendorCode: string;
  legalName: string;
  tradeName: string;
  pan: string;
  gstin: string;
  msmeNumber: string;
  addresses: unknown;
  contacts: unknown;
  categories: unknown;
  plantCoverage: unknown;
  geographyCoverage: unknown;
  paymentTerms: string;
  currency: string;
  creditDays: number;
  taxClassification: string;
  tdsClassification: string;
  avlStatus: string;
  lifecycleStatus: string;
  riskRating: string;
  complianceStatus: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  bankAccounts: VendorBankDto[];
}

export interface PermissionDto {
  id: string;
  key: string;
  label: string;
  description: string;
  riskLevel: string;
}

export interface RoleAssignmentDto {
  id: string;
  legalEntityId: string;
  membership: { id: string; employeeCode: string; name: string; email: string };
  role: { id: string; name: string };
  permissions: Array<{ key: string; effect: string }>;
  status: string;
  validFrom: string | null;
  validTo: string | null;
  rowVersion: number;
}

export interface ErpRoleDto {
  id: string;
  name: string;
  version: number;
  isSystem: boolean;
  permissions: Array<{ key: string; effect: string; riskLevel: string }>;
}

export interface PermissionCheck {
  organizationId: string;
  membershipId: string;
  legalEntityId: string;
  permission: string;
}

export interface MesaErpVendorAccessService {
  hasPermission(input: PermissionCheck): Promise<boolean>;
  listVendors(legalEntityId: string): Promise<VendorDto[]>;
  createVendor(legalEntityId: string, input: VendorCreate, idempotencyKey: string): Promise<VendorDto>;
  transitionVendor(legalEntityId: string, vendorId: string, input: VendorLifecycleTransition, idempotencyKey: string): Promise<VendorDto>;
  addVendorBank(legalEntityId: string, vendorId: string, input: VendorBankCreate, idempotencyKey: string): Promise<VendorBankDto>;
  verifyVendorBank(legalEntityId: string, vendorId: string, bankAccountId: string, input: VendorBankVerify, idempotencyKey: string): Promise<VendorBankDto>;
  listPermissions(legalEntityId: string): Promise<PermissionDto[]>;
  listRoles(legalEntityId: string): Promise<ErpRoleDto[]>;
  createRole(legalEntityId: string, input: ErpRoleCreate, idempotencyKey: string): Promise<ErpRoleDto>;
  replaceRolePermissions(legalEntityId: string, roleId: string, input: RolePermissionsReplace, idempotencyKey: string): Promise<ErpRoleDto>;
  listRoleAssignments(legalEntityId: string): Promise<RoleAssignmentDto[]>;
  assignRole(legalEntityId: string, input: RoleAssignmentCreate, idempotencyKey: string): Promise<RoleAssignmentDto>;
  revokeRole(legalEntityId: string, assignmentId: string, input: RoleAssignmentRevoke, idempotencyKey: string): Promise<RoleAssignmentDto>;
}

export interface VendorBankProtector {
  protect(accountNumber: string): { masked: string; cipher: Uint8Array };
}

/** AES-256-GCM envelope; the encryption key must be supplied by the deployment secret store. */
export class EnvironmentVendorBankProtector implements VendorBankProtector {
  protect(accountNumber: string): { masked: string; cipher: Uint8Array } {
    const encoded = process.env.MESADESK_VENDOR_BANK_ENCRYPTION_KEY || '';
    let key: Buffer;
    try {
      key = Buffer.from(encoded, 'base64');
    } catch {
      key = Buffer.alloc(0);
    }
    if (key.length !== 32) {
      throw new ApiError(503, 'bank_encryption_not_configured', 'Vendor bank encryption is not configured.');
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = Buffer.concat([Buffer.from([1]), nonce, tag, ciphertext]);
    return {
      masked: `${'*'.repeat(Math.max(0, accountNumber.length - 4))}${accountNumber.slice(-4)}`,
      cipher: envelope,
    };
  }
}

const TRANSITIONS: Record<VendorLifecycleStatus, VendorLifecycleStatus[]> = {
  invited: ['onboarding', 'blocked'],
  onboarding: ['under_review', 'blocked'],
  under_review: ['approved', 'conditionally_approved', 'blocked'],
  approved: ['suspended', 'blocked'],
  conditionally_approved: ['approved', 'suspended', 'blocked'],
  suspended: ['under_review', 'blocked'],
  blocked: ['under_review'],
};

const CHECKER_DECISIONS = new Set<VendorLifecycleStatus>([
  'approved', 'conditionally_approved', 'suspended', 'blocked',
]);

export function assertSeparateActor(action: string, makerMembershipId: string, checkerMembershipId: string): void {
  if (makerMembershipId && makerMembershipId === checkerMembershipId) {
    throw new ApiError(409, 'maker_checker_violation', `${action} must be completed by a different actor.`);
  }
}

export function assertVendorLifecycleTransition(input: {
  from: VendorLifecycleStatus;
  to: VendorLifecycleStatus;
  actorMembershipId: string;
  createdByMembershipId: string;
  lastLifecycleActorMembershipId: string;
}): void {
  if (!TRANSITIONS[input.from].includes(input.to)) {
    throw new ApiError(409, 'invalid_vendor_transition', `Vendor cannot move from ${input.from} to ${input.to}.`);
  }
  if (CHECKER_DECISIONS.has(input.to)) {
    assertSeparateActor('Vendor decision', input.lastLifecycleActorMembershipId, input.actorMembershipId);
    assertSeparateActor('Vendor decision', input.createdByMembershipId, input.actorMembershipId);
  }
}

function actor(): TenantCtx {
  const context = tenantContext.getStore();
  if (!context) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return context;
}

function jsonResponse<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function bankDto(bank: ErpVendorBankAccount): VendorBankDto {
  return {
    id: bank.id,
    vendorId: bank.vendorId,
    legalEntityId: bank.legalEntityId,
    accountHolderName: bank.accountHolderName,
    bankName: bank.bankName,
    accountNumberMasked: bank.accountNumberMasked,
    ifsc: bank.ifsc,
    branch: bank.branch,
    currency: bank.currency,
    status: bank.status,
    verifiedBy: bank.verifiedBy,
    verifiedAt: bank.verifiedAt?.toISOString() ?? null,
    rowVersion: bank.rowVersion,
    createdAt: bank.createdAt.toISOString(),
  };
}

function vendorDto(vendor: VendorWithBanks): VendorDto {
  return {
    id: vendor.id,
    legalEntityId: vendor.legalEntityId,
    vendorCode: vendor.vendorCode,
    legalName: vendor.legalName,
    tradeName: vendor.tradeName,
    pan: vendor.pan,
    gstin: vendor.gstin,
    msmeNumber: vendor.msmeNumber,
    addresses: structuredClone(vendor.addresses),
    contacts: structuredClone(vendor.contacts),
    categories: structuredClone(vendor.categories),
    plantCoverage: structuredClone(vendor.plantCoverage),
    geographyCoverage: structuredClone(vendor.geographyCoverage),
    paymentTerms: vendor.paymentTerms,
    currency: vendor.currency,
    creditDays: vendor.creditDays,
    taxClassification: vendor.taxClassification,
    tdsClassification: vendor.tdsClassification,
    avlStatus: vendor.avlStatus,
    lifecycleStatus: vendor.lifecycleStatus,
    riskRating: vendor.riskRating,
    complianceStatus: vendor.complianceStatus,
    rowVersion: vendor.rowVersion,
    createdAt: vendor.createdAt.toISOString(),
    updatedAt: vendor.updatedAt.toISOString(),
    bankAccounts: vendor.bankAccounts.map(bankDto),
  };
}

function roleAssignmentDto(assignment: AssignmentWithDetails): RoleAssignmentDto {
  const permissions = assignment.role.permissions
    .filter((entry) => entry.permission.serviceId === 'mesaerp')
    .map((entry) => ({ key: entry.permission.key, effect: entry.effect }))
    .sort((left, right) => left.key.localeCompare(right.key));
  return {
    id: assignment.id,
    legalEntityId: assignment.legalEntityId ?? '',
    membership: {
      id: assignment.membership.id,
      employeeCode: assignment.membership.employeeCode,
      name: assignment.membership.user.name,
      email: assignment.membership.user.email,
    },
    role: { id: assignment.role.id, name: assignment.role.name },
    permissions,
    status: assignment.status,
    validFrom: assignment.validFrom?.toISOString() ?? null,
    validTo: assignment.validTo?.toISOString() ?? null,
    rowVersion: assignment.rowVersion,
  };
}

function erpRoleDto(role: Prisma.RoleGetPayload<{ include: { permissions: { include: { permission: true } } } }>): ErpRoleDto {
  return {
    id: role.id,
    name: role.name,
    version: role.version,
    isSystem: role.isSystem,
    permissions: role.permissions
      .filter((entry) => entry.permission.serviceId === 'mesaerp')
      .map((entry) => ({ key: entry.permission.key, effect: entry.effect, riskLevel: entry.permission.riskLevel }))
      .sort((left, right) => left.key.localeCompare(right.key)),
  };
}

interface VendorOriginMetadata {
  createdByMembershipId: string;
  lastLifecycleActorMembershipId: string;
  history: Array<{ from: string; to: string; actorMembershipId: string; reason: string; at: string }>;
}

function vendorMetadata(value: Prisma.JsonValue): VendorOriginMetadata {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
  const history = Array.isArray(source.history)
    ? source.history.filter((entry): entry is VendorOriginMetadata['history'][number] => Boolean(entry && typeof entry === 'object')) as VendorOriginMetadata['history']
    : [];
  return {
    createdByMembershipId: typeof source.createdByMembershipId === 'string' ? source.createdByMembershipId : '',
    lastLifecycleActorMembershipId: typeof source.lastLifecycleActorMembershipId === 'string' ? source.lastLifecycleActorMembershipId : '',
    history,
  };
}

async function requireLegalEntity(db: Db, organizationId: string, legalEntityId: string): Promise<void> {
  const entity = await db.legalEntity.findFirst({ where: { id: legalEntityId, organizationId, status: 'active' }, select: { id: true } });
  if (!entity) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found.');
}

async function findIdempotency<T>(db: Db, organizationId: string, scope: string, key: string, requestHash: string): Promise<T | null> {
  const existing = await db.erpIdempotencyRecord.findUnique({
    where: { organizationId_scope_key: { organizationId, scope, key } },
  });
  if (!existing) return null;
  if (existing.requestHash !== requestHash) {
    throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was already used with a different request.');
  }
  return structuredClone(existing.response) as T;
}

async function runIdempotent<T>(input: {
  legalEntityId: string;
  scope: string;
  key: string;
  payload: unknown;
  execute: (db: Db, context: TenantCtx) => Promise<T>;
}): Promise<T> {
  const context = actor();
  const requestHash = hashCanonical(input.payload);
  const executeOnce = () => tenantTx(async (db) => {
    await requireLegalEntity(db, context.organizationId, input.legalEntityId);
    const replay = await findIdempotency<T>(db, context.organizationId, input.scope, input.key, requestHash);
    if (replay) return replay;
    const response = await input.execute(db, context);
    await db.erpIdempotencyRecord.create({
      data: {
        organizationId: context.organizationId,
        legalEntityId: input.legalEntityId,
        scope: input.scope,
        key: input.key,
        requestHash,
        response: jsonResponse(response),
      },
    });
    return response;
  });

  try {
    return await executeOnce();
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    // A concurrent identical request may have won the unique idempotency key.
    return tenantTx(async (db) => {
      const replay = await findIdempotency<T>(db, context.organizationId, input.scope, input.key, requestHash);
      if (replay) return replay;
      throw error;
    });
  }
}

const assignmentInclude = {
  membership: { include: { user: true } },
  role: { include: { permissions: { include: { permission: true } } } },
} satisfies Prisma.RoleAssignmentInclude;

export class PrismaMesaErpVendorAccessService implements MesaErpVendorAccessService {
  constructor(private readonly bankProtector: VendorBankProtector = new EnvironmentVendorBankProtector()) {}

  hasPermission(input: PermissionCheck): Promise<boolean> {
    return hasMesaErpPermission(input);
  }

  async listVendors(legalEntityId: string): Promise<VendorDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context.organizationId, legalEntityId);
      const vendors = await db.erpVendor.findMany({
        where: { organizationId: context.organizationId, legalEntityId },
        include: { bankAccounts: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ vendorCode: 'asc' }, { id: 'asc' }],
      });
      return vendors.map(vendorDto);
    });
  }

  createVendor(legalEntityId: string, input: VendorCreate, idempotencyKey: string): Promise<VendorDto> {
    return runIdempotent({
      legalEntityId,
      scope: `vendor:create:${legalEntityId}`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const now = new Date().toISOString();
        const metadata: VendorOriginMetadata = {
          createdByMembershipId: context.membershipId,
          lastLifecycleActorMembershipId: context.membershipId,
          history: [{ from: '', to: 'invited', actorMembershipId: context.membershipId, reason: 'created', at: now }],
        };
        const vendor = await db.erpVendor.create({
          data: {
            organizationId: context.organizationId,
            legalEntityId,
            vendorCode: input.vendorCode,
            legalName: input.legalName,
            tradeName: input.tradeName,
            pan: input.pan,
            gstin: input.gstin,
            msmeNumber: input.msmeNumber,
            addresses: input.addresses,
            contacts: input.contacts,
            categories: input.categories,
            plantCoverage: input.plantCoverage,
            geographyCoverage: input.geographyCoverage,
            paymentTerms: input.paymentTerms,
            currency: input.currency,
            creditDays: input.creditDays,
            taxClassification: input.taxClassification,
            tdsClassification: input.tdsClassification,
            originMetadata: metadata as unknown as Prisma.InputJsonValue,
            createdBy: context.membershipId,
            lastLifecycleActor: context.membershipId,
          },
          include: { bankAccounts: true },
        });
        const response = vendorDto(vendor);
        await audit(db, { action: 'mesaerp.vendor.create', entity: 'ErpVendor', entityId: vendor.id, after: response });
        return response;
      },
    });
  }

  transitionVendor(legalEntityId: string, vendorId: string, input: VendorLifecycleTransition, idempotencyKey: string): Promise<VendorDto> {
    return runIdempotent({
      legalEntityId,
      scope: `vendor:${vendorId}:lifecycle`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const vendor = await db.erpVendor.findFirst({
          where: { id: vendorId, organizationId: context.organizationId, legalEntityId },
          include: { bankAccounts: { orderBy: { createdAt: 'asc' } } },
        });
        if (!vendor) throw new ApiError(404, 'vendor_not_found', 'Vendor not found.');
        if (vendor.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Vendor changed since it was loaded.');
        const metadata = vendorMetadata(vendor.originMetadata);
        assertVendorLifecycleTransition({
          from: vendor.lifecycleStatus as VendorLifecycleStatus,
          to: input.to,
          actorMembershipId: context.membershipId,
          createdByMembershipId: vendor.createdBy || metadata.createdByMembershipId,
          lastLifecycleActorMembershipId: vendor.lastLifecycleActor || metadata.lastLifecycleActorMembershipId,
        });
        const nextMetadata: VendorOriginMetadata = {
          ...metadata,
          lastLifecycleActorMembershipId: context.membershipId,
          history: [...metadata.history, {
            from: vendor.lifecycleStatus,
            to: input.to,
            actorMembershipId: context.membershipId,
            reason: input.reason,
            at: new Date().toISOString(),
          }],
        };
        const changed = await db.erpVendor.updateMany({
          where: { id: vendor.id, organizationId: context.organizationId, legalEntityId, rowVersion: input.expectedRowVersion },
          data: {
            lifecycleStatus: input.to,
            lastLifecycleActor: context.membershipId,
            originMetadata: nextMetadata as unknown as Prisma.InputJsonValue,
            rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Vendor changed since it was loaded.');
        const updated = await db.erpVendor.findUniqueOrThrow({ where: { id: vendor.id }, include: { bankAccounts: { orderBy: { createdAt: 'asc' } } } });
        const before = vendorDto(vendor);
        const response = vendorDto(updated);
        await audit(db, { action: 'mesaerp.vendor.lifecycle', entity: 'ErpVendor', entityId: vendor.id, before, after: { ...response, reason: input.reason } });
        return response;
      },
    });
  }

  addVendorBank(legalEntityId: string, vendorId: string, input: VendorBankCreate, idempotencyKey: string): Promise<VendorBankDto> {
    return runIdempotent({
      legalEntityId,
      scope: `vendor:${vendorId}:bank:create`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const vendor = await db.erpVendor.findFirst({ where: { id: vendorId, organizationId: context.organizationId, legalEntityId } });
        if (!vendor) throw new ApiError(404, 'vendor_not_found', 'Vendor not found.');
        if (vendor.lifecycleStatus === 'blocked') throw new ApiError(409, 'vendor_blocked', 'Bank details cannot be added to a blocked vendor.');
        const protectedAccount = this.bankProtector.protect(input.accountNumber);
        const bank = await db.erpVendorBankAccount.create({
          data: {
            organizationId: context.organizationId,
            legalEntityId,
            vendorId,
            accountHolderName: input.accountHolderName,
            bankName: input.bankName,
            accountNumberMasked: protectedAccount.masked,
            accountNumberCipher: Buffer.from(protectedAccount.cipher),
            ifsc: input.ifsc,
            branch: input.branch,
            currency: input.currency,
            status: 'pending_verification',
            createdBy: context.membershipId,
          },
        });
        const response = bankDto(bank);
        await audit(db, { action: 'mesaerp.vendor.bank.add', entity: 'ErpVendorBankAccount', entityId: bank.id, after: response });
        return response;
      },
    });
  }

  verifyVendorBank(legalEntityId: string, vendorId: string, bankAccountId: string, input: VendorBankVerify, idempotencyKey: string): Promise<VendorBankDto> {
    return runIdempotent({
      legalEntityId,
      scope: `vendor:${vendorId}:bank:${bankAccountId}:verify`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const bank = await db.erpVendorBankAccount.findFirst({
          where: { id: bankAccountId, vendorId, organizationId: context.organizationId, legalEntityId },
        });
        if (!bank) throw new ApiError(404, 'vendor_bank_not_found', 'Vendor bank account not found.');
        if (bank.status !== 'pending_verification') throw new ApiError(409, 'bank_already_decided', 'Vendor bank account has already been decided.');
        if (bank.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Vendor bank account changed since it was loaded.');
        assertSeparateActor('Vendor bank verification', bank.createdBy, context.membershipId);
        const changed = await db.erpVendorBankAccount.updateMany({
          where: { id: bank.id, organizationId: context.organizationId, legalEntityId, vendorId, status: 'pending_verification', rowVersion: input.expectedRowVersion },
          data: {
            status: input.decision,
            verifiedBy: context.membershipId,
            verifiedAt: new Date(),
            verificationReference: input.verificationReference,
            decisionReason: input.reason,
            rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Vendor bank account changed since it was loaded.');
        const updated = await db.erpVendorBankAccount.findUniqueOrThrow({ where: { id: bank.id } });
        const response = bankDto(updated);
        await audit(db, {
          action: 'mesaerp.vendor.bank.verify', entity: 'ErpVendorBankAccount', entityId: bank.id,
          before: bankDto(bank), after: { ...response, reason: input.reason, verificationReference: input.verificationReference },
        });
        return response;
      },
    });
  }

  async listPermissions(legalEntityId: string): Promise<PermissionDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context.organizationId, legalEntityId);
      return db.permission.findMany({ where: { serviceId: 'mesaerp' }, orderBy: { key: 'asc' } });
    });
  }

  async listRoleAssignments(legalEntityId: string): Promise<RoleAssignmentDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context.organizationId, legalEntityId);
      const assignments = await db.roleAssignment.findMany({
        where: {
          organizationId: context.organizationId,
          serviceId: 'mesaerp',
          legalEntityId,
        },
        include: assignmentInclude,
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      });
      return assignments.map(roleAssignmentDto);
    });
  }

  async listRoles(legalEntityId: string): Promise<ErpRoleDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context.organizationId, legalEntityId);
      const roles = await db.role.findMany({
        where: {
          organizationId: context.organizationId,
          erpLegalEntityId: legalEntityId,
        },
        include: { permissions: { include: { permission: true } } },
        orderBy: { name: 'asc' },
      });
      return roles.map(erpRoleDto);
    });
  }

  createRole(legalEntityId: string, input: ErpRoleCreate, idempotencyKey: string): Promise<ErpRoleDto> {
    return runIdempotent({
      legalEntityId,
      scope: `access:role:create:${legalEntityId}`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const duplicate = await db.role.findFirst({
          where: { organizationId: context.organizationId, name: input.name },
          select: { id: true },
        });
        if (duplicate) throw new ApiError(409, 'role_name_exists', 'A role with this name already exists in the organization.');
        const permissions = await db.permission.findMany({ where: { serviceId: 'mesaerp', key: { in: input.grants } } });
        if (permissions.length !== input.grants.length) {
          throw new ApiError(422, 'unknown_erp_permission', 'One or more MesaERP permissions are not in the exact permission catalogue.');
        }
        const created = await db.role.create({
          data: {
            organizationId: context.organizationId,
            erpLegalEntityId: legalEntityId,
            name: input.name,
            screens: [],
            isAdmin: false,
            isSystem: false,
            permissions: {
              create: permissions.map((permission) => ({
                organizationId: context.organizationId,
                permissionId: permission.id,
                effect: 'allow',
              })),
            },
          },
          include: { permissions: { include: { permission: true } } },
        });
        const response = erpRoleDto(created);
        await audit(db, { action: 'mesaerp.access.role.create', entity: 'Role', entityId: created.id, after: response });
        return response;
      },
    });
  }

  replaceRolePermissions(legalEntityId: string, roleId: string, input: RolePermissionsReplace, idempotencyKey: string): Promise<ErpRoleDto> {
    return runIdempotent({
      legalEntityId,
      scope: `access:role:${roleId}:permissions`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const role = await db.role.findFirst({
          where: { id: roleId, organizationId: context.organizationId, erpLegalEntityId: legalEntityId },
          include: { permissions: { include: { permission: true } } },
        });
        if (!role) throw new ApiError(404, 'role_not_found', 'Role not found in this company.');
        if (role.isSystem) throw new ApiError(409, 'system_role_protected', 'System roles cannot be changed from the company access desk.');
        if (role.version !== input.expectedRoleVersion) throw new ApiError(409, 'version_conflict', 'Role changed since it was loaded.');
        const permissions = await db.permission.findMany({ where: { serviceId: 'mesaerp', key: { in: input.grants } } });
        if (permissions.length !== input.grants.length) {
          throw new ApiError(422, 'unknown_erp_permission', 'One or more MesaERP permissions are not in the exact permission catalogue.');
        }
        const actorUsesRole = await db.roleAssignment.findFirst({
          where: {
            organizationId: context.organizationId,
            legalEntityId,
            membershipId: context.membershipId,
            roleId,
            serviceId: 'mesaerp',
            status: 'active',
          },
          select: { id: true },
        });
        const currentKeys = new Set(role.permissions
          .filter((entry) => entry.permission.serviceId === 'mesaerp' && entry.effect === 'allow')
          .map((entry) => entry.permission.key));
        const addsSensitiveGrant = permissions.some((permission) => (
          !currentKeys.has(permission.key) && ['sensitive', 'high'].includes(permission.riskLevel)
        ));
        if (actorUsesRole && addsSensitiveGrant) {
          throw new ApiError(409, 'maker_checker_required', 'A different access administrator must approve sensitive grants to a role you hold.');
        }
        const before = erpRoleDto(role);
        await db.rolePermission.deleteMany({ where: { organizationId: context.organizationId, roleId, permission: { serviceId: 'mesaerp' } } });
        if (permissions.length) {
          await db.rolePermission.createMany({
            data: permissions.map((permission) => ({
              organizationId: context.organizationId, roleId, permissionId: permission.id, effect: 'allow',
            })),
          });
        }
        const changed = await db.role.updateMany({
          where: { id: roleId, organizationId: context.organizationId, version: input.expectedRoleVersion },
          data: { version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Role changed while permissions were being saved.');
        const updated = await db.role.findUniqueOrThrow({
          where: { id: roleId }, include: { permissions: { include: { permission: true } } },
        });
        const response = erpRoleDto(updated);
        await audit(db, { action: 'mesaerp.access.role.permissions.replace', entity: 'Role', entityId: roleId, before, after: response });
        return response;
      },
    });
  }

  assignRole(legalEntityId: string, input: RoleAssignmentCreate, idempotencyKey: string): Promise<RoleAssignmentDto> {
    return runIdempotent({
      legalEntityId,
      scope: `access:role-assignment:create:${legalEntityId}`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const membership = await db.membership.findFirst({
          where: { id: input.membershipId, organizationId: context.organizationId, status: { not: 'inactive' } },
        });
        if (!membership) throw new ApiError(404, 'membership_not_found', 'Membership not found in this organization.');
        const role = await db.role.findFirst({
          where: { id: input.roleId, organizationId: context.organizationId, erpLegalEntityId: legalEntityId, isSystem: false },
          include: { permissions: { where: { permission: { serviceId: 'mesaerp' } }, include: { permission: true } } },
        });
        if (!role) throw new ApiError(404, 'role_not_found', 'Editable company role not found.');
        if (input.membershipId === context.membershipId) {
          throw new ApiError(409, 'maker_checker_required', 'A different access administrator must assign your company role.');
        }
        if (!role.permissions.some((entry) => entry.effect === 'allow')) {
          throw new ApiError(422, 'role_has_no_erp_permissions', 'Role has no explicit MesaERP permissions.');
        }
        const existing = await db.roleAssignment.findFirst({
          where: {
            organizationId: context.organizationId,
            legalEntityId,
            membershipId: input.membershipId,
            roleId: input.roleId,
            serviceId: 'mesaerp',
            status: 'active',
            plantCode: null,
            warehouseId: null,
          },
        });
        if (existing) throw new ApiError(409, 'role_already_assigned', 'This company role is already active for the membership.');
        const created = await db.roleAssignment.create({
          data: {
            organizationId: context.organizationId,
            legalEntityId,
            membershipId: input.membershipId,
            roleId: input.roleId,
            serviceId: 'mesaerp',
            validFrom: input.validFrom ? new Date(input.validFrom) : null,
            validTo: input.validTo ? new Date(input.validTo) : null,
          },
          include: assignmentInclude,
        });
        const response = roleAssignmentDto(created);
        await audit(db, { action: 'mesaerp.access.role.assign', entity: 'RoleAssignment', entityId: created.id, after: response });
        return response;
      },
    });
  }

  revokeRole(legalEntityId: string, assignmentId: string, input: RoleAssignmentRevoke, idempotencyKey: string): Promise<RoleAssignmentDto> {
    return runIdempotent({
      legalEntityId,
      scope: `access:role-assignment:${assignmentId}:revoke`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const assignment = await db.roleAssignment.findFirst({
          where: { id: assignmentId, organizationId: context.organizationId, legalEntityId, serviceId: 'mesaerp' },
          include: assignmentInclude,
        });
        if (!assignment) throw new ApiError(404, 'role_assignment_not_found', 'Role assignment not found.');
        if (assignment.status !== 'active') throw new ApiError(409, 'role_assignment_inactive', 'Role assignment is not active.');
        const changed = await db.roleAssignment.updateMany({
          where: {
            id: assignment.id,
            organizationId: context.organizationId,
            legalEntityId,
            serviceId: 'mesaerp',
            status: 'active',
            rowVersion: input.rowVersion,
          },
          data: {
            status: 'revoked',
            revokedAt: new Date(),
            revokedBy: context.membershipId,
            revocationReason: input.reason,
            rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Role assignment changed since it was loaded.');
        const updated = await db.roleAssignment.findUniqueOrThrow({ where: { id: assignment.id }, include: assignmentInclude });
        const before = roleAssignmentDto(assignment);
        const response = roleAssignmentDto(updated);
        await audit(db, {
          action: 'mesaerp.access.role.revoke', entity: 'RoleAssignment', entityId: assignment.id,
          before, after: { ...response, reason: input.reason },
        });
        return response;
      },
    });
  }
}
