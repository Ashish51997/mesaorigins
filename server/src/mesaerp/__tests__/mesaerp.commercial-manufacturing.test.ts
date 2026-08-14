import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedUserContext } from '../../lib/authContext';
import { tenantContext } from '../../lib/tenantContext';
import { ApiError, errorHandler } from '../../middleware/error';
import { resolveTenant } from '../../middleware/tenant';
import {
  createMesaErpCommercialManufacturingRouter,
  MESAERP_COMMERCIAL_MANUFACTURING_PERMISSIONS,
} from '../commercialManufacturingRouter';
import {
  manufacturingVoucherCreateSchema,
  type CustomerCreate,
  type CustomerUpdate,
  type ManufacturingVoucherCreate,
  type ProductionDemandCreate,
  type RowVersionTransition,
  type SalesDocumentCreate,
  type SalesDocumentType,
} from '../commercialManufacturingSchemas';
import {
  calculateManufacturingVoucher,
  calculateSalesTotals,
  type BatchCostDto,
  type CustomerDto,
  type ManufacturingVoucherDto,
  type MesaErpCommercialManufacturingService,
  type PermissionCheck,
  type ProductionDemandDto,
  type SalesDocumentDto,
} from '../commercialManufacturingService';

const NOW = '2026-08-14T00:00:00.000Z';

function membershipId() {
  return tenantContext.getStore()?.membershipId ?? 'maker-a';
}

class FakeCommercialManufacturingService implements MesaErpCommercialManufacturingService {
  readonly grants = new Set<string>();
  readonly customers = new Map<string, CustomerDto>();
  readonly documents = new Map<string, SalesDocumentDto>();
  readonly demands = new Map<string, ProductionDemandDto>();
  readonly vouchers = new Map<string, ManufacturingVoucherDto>();
  readonly costs = new Map<string, BatchCostDto>();
  lastIdempotencyKey = '';

  grant(member: string, entity: string, permission: string) {
    this.grants.add(`${member}:${entity}:${permission}`);
  }

  hasPermission(input: PermissionCheck): Promise<boolean> {
    return Promise.resolve(this.grants.has(`${input.membershipId}:${input.legalEntityId}:${input.permission}`));
  }

  listCustomers(legalEntityId: string): Promise<CustomerDto[]> {
    return Promise.resolve([...this.customers.values()].filter((row) => row.legalEntityId === legalEntityId));
  }

  getCustomer(legalEntityId: string, customerId: string): Promise<CustomerDto> {
    const row = this.customers.get(customerId);
    if (!row || row.legalEntityId !== legalEntityId) return Promise.reject(new ApiError(404, 'customer_not_found', 'Customer not found.'));
    return Promise.resolve(row);
  }

  createCustomer(legalEntityId: string, input: CustomerCreate, idempotencyKey: string): Promise<CustomerDto> {
    this.lastIdempotencyKey = idempotencyKey;
    const id = `customer-${this.customers.size + 1}`;
    const row: CustomerDto = {
      id, organizationId: 'org-a', legalEntityId, customerCode: input.customerCode,
      legalName: input.legalName, tradeName: input.tradeName, pan: input.pan, gstin: input.gstin,
      addresses: input.addresses, contacts: input.contacts, paymentTerms: input.paymentTerms,
      currency: input.currency, creditLimit: input.creditLimit, creditDays: input.creditDays,
      status: input.status, rowVersion: 0, originMetadata: input.originMetadata, createdAt: NOW, updatedAt: NOW,
    };
    this.customers.set(id, row);
    return Promise.resolve(row);
  }

  updateCustomer(legalEntityId: string, customerId: string, input: CustomerUpdate, idempotencyKey: string): Promise<CustomerDto> {
    this.lastIdempotencyKey = idempotencyKey;
    const row = this.customers.get(customerId);
    if (!row || row.legalEntityId !== legalEntityId) return Promise.reject(new ApiError(404, 'customer_not_found', 'Customer not found.'));
    if (row.rowVersion !== input.expectedRowVersion) return Promise.reject(new ApiError(409, 'version_conflict', 'Customer changed.'));
    const { expectedRowVersion: _version, ...changes } = input;
    const updated = { ...row, ...changes, rowVersion: row.rowVersion + 1 };
    this.customers.set(customerId, updated);
    return Promise.resolve(updated);
  }

  listSalesDocuments(legalEntityId: string, type: SalesDocumentType): Promise<SalesDocumentDto[]> {
    return Promise.resolve([...this.documents.values()].filter((row) => row.legalEntityId === legalEntityId && row.documentType === type));
  }

  getSalesDocument(legalEntityId: string, type: SalesDocumentType, documentId: string): Promise<SalesDocumentDto> {
    const row = this.documents.get(documentId);
    if (!row || row.legalEntityId !== legalEntityId || row.documentType !== type) return Promise.reject(new ApiError(404, 'sales_document_not_found', 'Sales document not found.'));
    return Promise.resolve(row);
  }

  createSalesDocument(legalEntityId: string, type: SalesDocumentType, input: SalesDocumentCreate, idempotencyKey: string): Promise<SalesDocumentDto> {
    this.lastIdempotencyKey = idempotencyKey;
    const id = `${type}-${this.documents.size + 1}`;
    const totals = calculateSalesTotals(input);
    const row = {
      id, organizationId: 'org-a', legalEntityId, financialYearId: 'fy-a', documentType: type,
      documentNumber: input.documentNumber ?? id, documentDate: input.documentDate, status: 'draft',
      approvalState: 'not_required', customerId: input.customerId, partySnapshot: {}, currency: input.currency,
      exchangeRate: input.exchangeRate, subtotal: totals.subtotal.toString(), discountTotal: totals.discountTotal.toString(),
      taxTotal: totals.taxTotal.toString(), roundingAmount: '0', grandTotal: totals.grandTotal.toString(),
      baseCurrencyTotal: totals.baseCurrencyTotal.toString(), taxSummary: {}, terms: input.terms, shipping: input.shipping,
      originType: input.originType, originMetadata: input.originMetadata, sourceSnapshotHash: '', rowVersion: 0,
      createdBy: membershipId(), createdAt: NOW, updatedAt: NOW, lines: [], links: [],
    } as SalesDocumentDto;
    this.documents.set(id, row);
    return Promise.resolve(row);
  }

  transitionSalesDocument(legalEntityId: string, type: SalesDocumentType, documentId: string, action: 'submit' | 'approve', input: RowVersionTransition, idempotencyKey: string): Promise<SalesDocumentDto> {
    this.lastIdempotencyKey = idempotencyKey;
    const row = this.documents.get(documentId);
    if (!row || row.legalEntityId !== legalEntityId || row.documentType !== type) return Promise.reject(new ApiError(404, 'sales_document_not_found', 'Sales document not found.'));
    if (row.rowVersion !== input.expectedRowVersion) return Promise.reject(new ApiError(409, 'version_conflict', 'Sales document changed.'));
    const expected = action === 'submit' ? 'draft' : 'submitted';
    if (row.status !== expected) return Promise.reject(new ApiError(409, 'sales_document_not_transitionable', 'Wrong status.'));
    if (action === 'approve' && row.createdBy === membershipId()) return Promise.reject(new ApiError(409, 'maker_checker_required', 'Sales document maker cannot approve the same record.'));
    const updated = {
      ...row,
      status: action === 'submit' ? 'submitted' as const : 'approved' as const,
      approvalState: action === 'submit' ? 'pending' : 'approved',
      rowVersion: row.rowVersion + 1,
      ...(action === 'approve' ? { approvedBy: membershipId(), approvedAt: NOW } : { submittedAt: NOW }),
    };
    this.documents.set(documentId, updated);
    return Promise.resolve(updated);
  }

  listProductionDemands(legalEntityId: string): Promise<ProductionDemandDto[]> {
    return Promise.resolve([...this.demands.values()].filter((row) => row.legalEntityId === legalEntityId));
  }

  getProductionDemand(legalEntityId: string, demandId: string): Promise<ProductionDemandDto> {
    const row = this.demands.get(demandId);
    if (!row || row.legalEntityId !== legalEntityId) return Promise.reject(new ApiError(404, 'production_demand_not_found', 'Demand not found.'));
    return Promise.resolve(row);
  }

  createProductionDemand(legalEntityId: string, input: ProductionDemandCreate, idempotencyKey: string): Promise<ProductionDemandDto> {
    this.lastIdempotencyKey = idempotencyKey;
    const id = `demand-${this.demands.size + 1}`;
    const row = {
      id, organizationId: 'org-a', legalEntityId, financialYearId: 'fy-a', demandNumber: input.demandNumber ?? id,
      demandType: input.demandType, itemId: input.itemId, quantity: input.quantity, uom: input.uom,
      status: 'draft', bomSnapshot: input.bomSnapshot, materialRequirements: input.materialRequirements,
      suggestions: input.suggestions, originType: input.originType, originMetadata: input.originMetadata,
      sourceSnapshotHash: '', rowVersion: 0, makerMembershipId: membershipId(), createdAt: NOW, updatedAt: NOW,
      ...(input.requiredOn ? { requiredOn: input.requiredOn } : {}),
    } as ProductionDemandDto;
    this.demands.set(id, row);
    return Promise.resolve(row);
  }

  transitionProductionDemand(legalEntityId: string, demandId: string, action: 'approve' | 'release', input: RowVersionTransition, idempotencyKey: string): Promise<ProductionDemandDto> {
    this.lastIdempotencyKey = idempotencyKey;
    const row = this.demands.get(demandId);
    if (!row || row.legalEntityId !== legalEntityId) return Promise.reject(new ApiError(404, 'production_demand_not_found', 'Demand not found.'));
    if (row.rowVersion !== input.expectedRowVersion) return Promise.reject(new ApiError(409, 'version_conflict', 'Demand changed.'));
    if (action === 'approve' && row.makerMembershipId === membershipId()) return Promise.reject(new ApiError(409, 'maker_checker_required', 'Demand maker cannot approve it.'));
    const expected = action === 'approve' ? 'draft' : 'approved';
    if (row.status !== expected) return Promise.reject(new ApiError(409, 'production_demand_not_transitionable', 'Wrong status.'));
    const updated = {
      ...row,
      status: action === 'approve' ? 'approved' as const : 'released' as const,
      rowVersion: row.rowVersion + 1,
      ...(action === 'approve' ? { approvedBy: membershipId() } : { releasedAt: NOW, sourceSnapshotHash: 'a'.repeat(64) }),
    };
    this.demands.set(demandId, updated);
    return Promise.resolve(updated);
  }

  listManufacturingVouchers(legalEntityId: string): Promise<ManufacturingVoucherDto[]> {
    return Promise.resolve([...this.vouchers.values()].filter((row) => row.legalEntityId === legalEntityId));
  }

  getManufacturingVoucher(legalEntityId: string, voucherId: string): Promise<ManufacturingVoucherDto> {
    const row = this.vouchers.get(voucherId);
    if (!row || row.legalEntityId !== legalEntityId) return Promise.reject(new ApiError(404, 'manufacturing_voucher_not_found', 'Voucher not found.'));
    return Promise.resolve(row);
  }

  createManufacturingVoucher(legalEntityId: string, input: ManufacturingVoucherCreate, idempotencyKey: string): Promise<ManufacturingVoucherDto> {
    this.lastIdempotencyKey = idempotencyKey;
    const id = `manufacturing-voucher-${this.vouchers.size + 1}`;
    const calculated = calculateManufacturingVoucher(input);
    const row = {
      id, organizationId: 'org-a', legalEntityId, financialYearId: 'fy-a', voucherNumber: input.voucherNumber ?? id,
      voucherType: input.voucherType, businessDate: input.businessDate, status: 'draft', batchNumber: input.batchNumber,
      materialLines: calculated.materialLines, outputLines: input.outputLines, laborLines: calculated.laborLines,
      resourceLines: calculated.resourceLines, overheadLines: calculated.overheadLines,
      subcontractLines: calculated.subcontractLines, recoveryCredits: calculated.recoveryCredits,
      qaDisposition: input.qaDisposition, materialValue: calculated.materialValue.toString(),
      conversionValue: calculated.conversionValue.toString(), recoveryValue: calculated.recoveryValue.toString(),
      actualCost: calculated.actualCost.toString(), originType: input.originType, originMetadata: input.originMetadata,
      sourceSnapshotHash: '', rowVersion: 0, makerMembershipId: membershipId(), createdAt: NOW, updatedAt: NOW,
      ...(input.productionDemandId ? { productionDemandId: input.productionDemandId } : {}),
    } as ManufacturingVoucherDto;
    this.vouchers.set(id, row);
    return Promise.resolve(row);
  }

  transitionManufacturingVoucher(legalEntityId: string, voucherId: string, action: 'submit' | 'approve' | 'post', input: RowVersionTransition, idempotencyKey: string): Promise<ManufacturingVoucherDto> {
    this.lastIdempotencyKey = idempotencyKey;
    const row = this.vouchers.get(voucherId);
    if (!row || row.legalEntityId !== legalEntityId) return Promise.reject(new ApiError(404, 'manufacturing_voucher_not_found', 'Voucher not found.'));
    if (row.rowVersion !== input.expectedRowVersion) return Promise.reject(new ApiError(409, 'version_conflict', 'Voucher changed.'));
    if (action === 'approve' && row.makerMembershipId === membershipId()) return Promise.reject(new ApiError(409, 'maker_checker_required', 'Voucher maker cannot approve it.'));
    const expected = action === 'submit' ? 'draft' : action === 'approve' ? 'submitted' : 'approved';
    if (row.status !== expected) return Promise.reject(new ApiError(409, 'manufacturing_voucher_not_transitionable', 'Wrong status.'));
    const updated = { ...row, status: action === 'submit' ? 'submitted' as const : action === 'approve' ? 'approved' as const : 'posted' as const, rowVersion: row.rowVersion + 1 };
    this.vouchers.set(voucherId, updated);
    return Promise.resolve(updated);
  }

  listBatchCosts(legalEntityId: string): Promise<BatchCostDto[]> {
    return Promise.resolve([...this.costs.values()].filter((row) => row.legalEntityId === legalEntityId));
  }

  getBatchCost(legalEntityId: string, batchCostId: string): Promise<BatchCostDto> {
    const row = this.costs.get(batchCostId);
    if (!row || row.legalEntityId !== legalEntityId) return Promise.reject(new ApiError(404, 'batch_cost_not_found', 'Cost not found.'));
    return Promise.resolve(row);
  }
}

function buildTestApp() {
  const service = new FakeCommercialManufacturingService();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const member = req.header('x-test-member') || 'maker-a';
    const admin = req.header('x-test-admin') === '1';
    const organization = {
      organizationId: 'org-a', organizationName: 'Org A', organizationSlug: 'org-a', membershipId: member, membershipStatus: 'active',
      employeeCode: member, role: admin ? 'Administrator' : 'ERP User', isAdmin: admin, screens: [],
      services: [{ id: 'mesaerp', name: 'MesaERP', description: '', status: req.header('x-test-service') || 'active', sortOrder: 30 }],
    };
    req.user = {
      userId: `user-${member}`, email: `${member}@example.test`, name: member, ...organization, organizations: [organization],
    } satisfies AuthenticatedUserContext;
    next();
  });
  app.use(resolveTenant);
  app.use('/api/mesaerp/v1', createMesaErpCommercialManufacturingRouter(service));
  app.use(errorHandler);
  return { app, service };
}

const customerBody = { customerCode: 'C-001', legalName: 'Acme Components' };
const salesBody = {
  documentDate: '2026-08-14', customerId: 'customer-1', currency: 'INR', exchangeRate: '1',
  lines: [{ itemId: 'item-1', description: 'Moulded part', quantity: '10', uom: 'EA', unitPrice: '100', taxRate: '18' }],
};
const demandBody = {
  demandDate: '2026-08-14', demandType: 'internal', itemId: 'item-1', quantity: '10', uom: 'EA',
};
const voucherBody = {
  businessDate: '2026-08-14', voucherType: 'completion', batchNumber: 'B-001',
  materialLines: [{ itemId: 'rm-1', description: 'Resin', quantity: '5', uom: 'KG', rate: '100' }],
  laborLines: [{ description: 'Operator', quantity: '2', uom: 'HOUR', rate: '50' }],
  resourceLines: [{ description: 'Press', quantity: '1', uom: 'HOUR', rate: '75' }],
  overheadLines: [{ description: 'Power', quantity: '1', uom: 'LOT', rate: '25' }],
  recoveryCredits: [{ description: 'Scrap recovery', quantity: '1', uom: 'LOT', rate: '20' }],
  outputLines: [{ itemId: 'item-1', description: 'Moulded part', quantity: '10', uom: 'EA' }],
  qaDisposition: { status: 'accepted', reference: 'QA-1', notes: '' },
};

describe('MesaERP commercial and manufacturing routes', () => {
  it('fails closed on exact company permissions, including for a legacy administrator', async () => {
    const { app, service } = buildTestApp();
    expect((await request(app).get('/api/mesaerp/v1/entities/company-a/customers')).status).toBe(403);
    expect((await request(app).get('/api/mesaerp/v1/entities/company-a/customers').set('x-test-admin', '1')).status).toBe(403);
    service.grant('maker-a', 'company-a', MESAERP_COMMERCIAL_MANUFACTURING_PERMISSIONS.manufacturing);
    expect((await request(app).get('/api/mesaerp/v1/entities/company-a/customers')).status).toBe(403);
    service.grant('maker-a', 'company-a', MESAERP_COMMERCIAL_MANUFACTURING_PERMISSIONS.sales);
    expect((await request(app).get('/api/mesaerp/v1/entities/company-a/customers')).status).toBe(200);
    expect((await request(app).get('/api/mesaerp/v1/entities/company-b/customers')).status).toBe(403);
  });

  it('requires a replay-safe key and decimal strings for every commercial write', async () => {
    const { app, service } = buildTestApp();
    service.grant('maker-a', 'company-a', MESAERP_COMMERCIAL_MANUFACTURING_PERMISSIONS.sales);
    const missing = await request(app).post('/api/mesaerp/v1/entities/company-a/customers').send(customerBody);
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('idempotency_key_required');

    const customer = await request(app).post('/api/mesaerp/v1/entities/company-a/customers').set('Idempotency-Key', 'customer-create-001').send(customerBody);
    expect(customer.status).toBe(201);
    expect(service.lastIdempotencyKey).toBe('customer-create-001');

    const invalidDecimal = await request(app).post('/api/mesaerp/v1/entities/company-a/sales-orders').set('Idempotency-Key', 'sales-order-create-001').send({
      ...salesBody,
      lines: [{ ...salesBody.lines[0], quantity: 10 }],
    });
    expect(invalidDecimal.status).toBe(422);
  });

  it('approves sales locally with maker-checker and no MesaOps entitlement or call', async () => {
    const { app, service } = buildTestApp();
    service.grant('maker-a', 'company-a', MESAERP_COMMERCIAL_MANUFACTURING_PERMISSIONS.sales);
    service.grant('checker-b', 'company-a', MESAERP_COMMERCIAL_MANUFACTURING_PERMISSIONS.sales);
    const created = await request(app).post('/api/mesaerp/v1/entities/company-a/sales-orders').set('Idempotency-Key', 'sales-order-create-002').send(salesBody);
    expect(created.status).toBe(201);
    const submitted = await request(app).post(`/api/mesaerp/v1/entities/company-a/sales-orders/${created.body.id}/submit`).set('Idempotency-Key', 'sales-order-submit-002').send({ expectedRowVersion: 0 });
    expect(submitted.body.status).toBe('submitted');
    const selfApproval = await request(app).post(`/api/mesaerp/v1/entities/company-a/sales-orders/${created.body.id}/approve`).set('Idempotency-Key', 'sales-order-approve-self').send({ expectedRowVersion: 1 });
    expect(selfApproval.status).toBe(409);
    expect(selfApproval.body.error.code).toBe('maker_checker_required');
    const approved = await request(app).post(`/api/mesaerp/v1/entities/company-a/sales-orders/${created.body.id}/approve`).set('x-test-member', 'checker-b').set('Idempotency-Key', 'sales-order-approve-002').send({ expectedRowVersion: 1 });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'approved', approvedBy: 'checker-b' });
  });

  it('runs independent demand approval and release without a sales order', async () => {
    const { app, service } = buildTestApp();
    service.grant('maker-a', 'company-a', MESAERP_COMMERCIAL_MANUFACTURING_PERMISSIONS.manufacturing);
    service.grant('checker-b', 'company-a', MESAERP_COMMERCIAL_MANUFACTURING_PERMISSIONS.manufacturing);
    const created = await request(app).post('/api/mesaerp/v1/entities/company-a/production-demands').set('Idempotency-Key', 'demand-create-001').send(demandBody);
    expect(created.status).toBe(201);
    const approved = await request(app).post(`/api/mesaerp/v1/entities/company-a/production-demands/${created.body.id}/approve`).set('x-test-member', 'checker-b').set('Idempotency-Key', 'demand-approve-001').send({ expectedRowVersion: 0 });
    expect(approved.body.status).toBe('approved');
    const released = await request(app).post(`/api/mesaerp/v1/entities/company-a/production-demands/${created.body.id}/release`).set('Idempotency-Key', 'demand-release-001').send({ expectedRowVersion: 1 });
    expect(released.body).toMatchObject({ status: 'released', rowVersion: 2 });
    expect(released.body.sourceSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('validates and preserves the explainable actual-cost formula', () => {
    const parsed = manufacturingVoucherCreateSchema.parse(voucherBody);
    const calculated = calculateManufacturingVoucher(parsed);
    expect(calculated.materialValue.toString()).toBe('500');
    expect(calculated.laborValue.toString()).toBe('100');
    expect(calculated.machineValue.toString()).toBe('75');
    expect(calculated.overheadValue.toString()).toBe('25');
    expect(calculated.recoveryValue.toString()).toBe('20');
    expect(calculated.actualCost.toString()).toBe('680');
    expect(() => manufacturingVoucherCreateSchema.parse({
      ...voucherBody,
      materialLines: [{ ...voucherBody.materialLines[0], amount: '499' }],
    })).not.toThrow();
    expect(() => calculateManufacturingVoucher(manufacturingVoucherCreateSchema.parse({
      ...voucherBody,
      materialLines: [{ ...voucherBody.materialLines[0], amount: '499' }],
    }))).toThrowError(/does not match/);
  });

  it('keeps manufacturing writes independently entitled and optimistic', async () => {
    const { app, service } = buildTestApp();
    service.grant('maker-a', 'company-a', MESAERP_COMMERCIAL_MANUFACTURING_PERMISSIONS.manufacturing);
    const suspended = await request(app).get('/api/mesaerp/v1/entities/company-a/manufacturing-vouchers').set('x-test-service', 'suspended');
    expect(suspended.status).toBe(403);
    expect(suspended.body.error.code).toBe('service_not_entitled');
    const created = await request(app).post('/api/mesaerp/v1/entities/company-a/manufacturing-vouchers').set('Idempotency-Key', 'manufacturing-create-001').send(voucherBody);
    expect(created.status).toBe(201);
    const stale = await request(app).post(`/api/mesaerp/v1/entities/company-a/manufacturing-vouchers/${created.body.id}/submit`).set('Idempotency-Key', 'manufacturing-submit-stale').send({ expectedRowVersion: 9 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');
  });
});
