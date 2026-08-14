import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedUserContext } from '../../lib/authContext';
import { tenantContext } from '../../lib/tenantContext';
import { ApiError, errorHandler } from '../../middleware/error';
import { resolveTenant } from '../../middleware/tenant';
import { hashCanonical } from '../repository';
import { UnavailableIndiaComplianceProvider } from '../indiaComplianceProvider';
import {
  createMesaErpIndiaComplianceRouter,
  MESAERP_INDIA_COMPLIANCE_PERMISSION,
} from '../indiaComplianceRouter';
import {
  complianceRuleProfileCreateSchema,
  gstr2bUploadSchema,
  inboundEInvoiceCreateSchema,
  outboundEInvoiceCreateSchema,
} from '../indiaComplianceSchemas';
import {
  evaluateApplicability,
  type ComplianceRuleProfileDto,
  type MesaErpIndiaComplianceService,
  type TaxDocumentDto,
} from '../indiaComplianceService';

const NOW = '2026-08-14T00:00:00.000Z';
const GSTIN = '29ABCDE1234F1Z5';
const externalVerification = { verifierReference: 'approved-external-verifier:test', verifiedAt: NOW, signature: 'f'.repeat(64) };

function membershipId() {
  return tenantContext.getStore()?.membershipId ?? 'maker-a';
}

const profile: ComplianceRuleProfileDto = {
  id: 'profile-1', organizationId: 'org-a', legalEntityId: 'company-a', jurisdiction: 'IN', artifactKind: 'outbound_e_invoice',
  version: '2026.1', effectiveFrom: '2026-04-01', status: 'draft', rules: {}, sourceReference: 'official:test',
  sourceEvidence: {}, sourceChecksum: 'a'.repeat(64), rowVersion: 0, createdBy: 'maker-a', createdAt: NOW, updatedAt: NOW,
};

const taxDocument: TaxDocumentDto = {
  id: 'tax-1', organizationId: 'org-a', legalEntityId: 'company-a', financialYearId: 'fy-a',
  documentKind: 'outbound_e_invoice', provider: '', providerReference: '', status: 'draft', supplierGstin: GSTIN,
  recipientGstin: '27ABCDE1234F1Z7', documentType: 'INV', documentNumber: 'INV-001', documentDate: '2026-08-14',
  irn: '', acknowledgementNumber: '', signedPayload: {}, submittedPayload: {}, qrData: '', transporter: {}, vehicle: {},
  cancellation: {}, reconciliation: {}, itcStatus: 'pending', ruleProfileVersion: '2026.1', evidenceHash: 'b'.repeat(64),
  rowVersion: 0, makerMembershipId: 'maker-a', createdAt: NOW, updatedAt: NOW,
};

class FakeComplianceService {
  readonly grants = new Set<string>();
  lastIdempotencyKey = '';

  grant(member: string, entity = 'company-a') {
    this.grants.add(`${member}:${entity}:${MESAERP_INDIA_COMPLIANCE_PERMISSION}`);
  }

  hasPermission(input: { membershipId: string; legalEntityId: string; permission: string }) {
    return Promise.resolve(this.grants.has(`${input.membershipId}:${input.legalEntityId}:${input.permission}`));
  }

  listRuleProfiles() { return Promise.resolve([profile]); }
  getRuleProfile() { return Promise.resolve(profile); }
  createRuleProfile(_entity: string, input: unknown, key: string) {
    this.lastIdempotencyKey = key;
    return Promise.resolve({ ...profile, ...(input as object), sourceEvidence: (input as { sourceEvidence: unknown }).sourceEvidence });
  }
  approveRuleProfile() {
    if (membershipId() === profile.createdBy) return Promise.reject(new ApiError(409, 'maker_checker_required', 'Maker cannot approve.'));
    return Promise.resolve({ ...profile, status: 'approved' as const, approvedBy: membershipId(), approvedAt: NOW, rowVersion: 1 });
  }

  listTaxDocuments() { return Promise.resolve([taxDocument]); }
  getTaxDocument() { return Promise.resolve(taxDocument); }
  createOutboundEInvoice(_entity: string, _input: unknown, key: string) { this.lastIdempotencyKey = key; return Promise.resolve(taxDocument); }
  approveOutboundEInvoice() { return Promise.resolve({ ...taxDocument, status: 'approved', rowVersion: 1 }); }
  submitOutboundEInvoice() { return Promise.resolve({ ...taxDocument, status: 'acknowledged', rowVersion: 2 }); }
  importOutboundEInvoiceAcknowledgement() { return Promise.resolve({ ...taxDocument, status: 'acknowledged', rowVersion: 2 }); }
  cancelOutboundEInvoice() { return Promise.resolve({ ...taxDocument, status: 'cancelled', rowVersion: 3 }); }
  createEWayBill() { return Promise.resolve({ ...taxDocument, documentKind: 'e_way_bill' as const }); }
  approveEWayBill() { return Promise.resolve({ ...taxDocument, documentKind: 'e_way_bill' as const, status: 'approved' }); }
  generateEWayBill() { return Promise.resolve({ ...taxDocument, documentKind: 'e_way_bill' as const, status: 'active' }); }
  createExternalEWayBill() { return Promise.resolve({ ...taxDocument, documentKind: 'e_way_bill' as const, status: 'external_pending' }); }
  verifyExternalEWayBill() { return Promise.resolve({ ...taxDocument, documentKind: 'e_way_bill' as const, status: 'active' }); }
  updateEWayBillVehicle() { return Promise.resolve({ ...taxDocument, documentKind: 'e_way_bill' as const, status: 'active' }); }
  extendEWayBill() { return Promise.resolve({ ...taxDocument, documentKind: 'e_way_bill' as const, status: 'active' }); }
  cancelEWayBill() { return Promise.resolve({ ...taxDocument, documentKind: 'e_way_bill' as const, status: 'cancelled' }); }
  createInboundEInvoice() { return Promise.resolve({ ...taxDocument, documentKind: 'inbound_e_invoice' as const, status: 'received' }); }
  uploadGstr2b() { return Promise.resolve({ ...taxDocument, documentKind: 'gstr2b' as const, status: 'imported' }); }
  reconcileInboundEInvoice() { return Promise.resolve({ ...taxDocument, documentKind: 'inbound_e_invoice' as const, status: 'reconciled' }); }
  decideInboundItc() { return Promise.resolve({ ...taxDocument, documentKind: 'inbound_e_invoice' as const, itcStatus: 'claimed' as const }); }
}

function buildTestApp() {
  const service = new FakeComplianceService();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const member = req.header('x-test-member') || 'maker-a';
    const admin = req.header('x-test-admin') === '1';
    const organization = {
      organizationId: 'org-a', organizationName: 'Org A', organizationSlug: 'org-a', membershipId: member,
      employeeCode: member, role: admin ? 'Administrator' : 'Tax User', isAdmin: admin, screens: [],
      services: [{ id: 'mesaerp', name: 'MesaERP', description: '', status: req.header('x-test-service') || 'active', sortOrder: 30 }],
    };
    req.user = {
      userId: `user-${member}`, email: `${member}@example.test`, name: member, ...organization, organizations: [organization],
    } satisfies AuthenticatedUserContext;
    next();
  });
  app.use(resolveTenant);
  app.use('/api/mesaerp/v1', createMesaErpIndiaComplianceRouter(service as unknown as MesaErpIndiaComplianceService));
  app.use(errorHandler);
  return { app, service };
}

const sourceEvidence = { url: 'https://example.test/official', capturedAt: NOW };
const profileBody = {
  artifactKind: 'outbound_e_invoice', version: '2026.1', effectiveFrom: '2026-04-01',
  rules: { enabled: true, documentTypes: ['INV'], supplyTypes: ['B2B'], exemptSupplyTypes: [], minimumDocumentValue: '0', minimumDistanceKm: 0, notes: '' },
  sourceReference: 'official:test', sourceEvidence, sourceChecksum: hashCanonical(sourceEvidence),
};

describe('MesaERP India compliance routes and contracts', () => {
  it('fails closed on the exact company grant, including for legacy administrators', async () => {
    const { app, service } = buildTestApp();
    expect((await request(app).get('/api/mesaerp/v1/entities/company-a/compliance-rule-profiles')).status).toBe(403);
    expect((await request(app).get('/api/mesaerp/v1/entities/company-a/compliance-rule-profiles').set('x-test-admin', '1')).status).toBe(403);
    service.grant('maker-a');
    expect((await request(app).get('/api/mesaerp/v1/entities/company-a/compliance-rule-profiles')).status).toBe(200);
    expect((await request(app).get('/api/mesaerp/v1/entities/company-b/compliance-rule-profiles')).status).toBe(403);
  });

  it('is independently entitled and requires an idempotency key for every write', async () => {
    const { app, service } = buildTestApp();
    service.grant('maker-a');
    expect((await request(app).get('/api/mesaerp/v1/entities/company-a/e-invoices/outbound').set('x-test-service', 'suspended')).status).toBe(403);
    const missing = await request(app).post('/api/mesaerp/v1/entities/company-a/compliance-rule-profiles').send(profileBody);
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('idempotency_key_required');
    const created = await request(app).post('/api/mesaerp/v1/entities/company-a/compliance-rule-profiles').set('Idempotency-Key', 'india-rule-001').send(profileBody);
    expect(created.status).toBe(201);
    expect(service.lastIdempotencyKey).toBe('india-rule-001');
  });

  it('enforces maker-checker on rule activation', async () => {
    const { app, service } = buildTestApp();
    service.grant('maker-a');
    service.grant('checker-b');
    const self = await request(app).post('/api/mesaerp/v1/entities/company-a/compliance-rule-profiles/profile-1/approve').set('Idempotency-Key', 'india-rule-self').send({ expectedRowVersion: 0 });
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe('maker_checker_required');
    const checked = await request(app).post('/api/mesaerp/v1/entities/company-a/compliance-rule-profiles/profile-1/approve').set('x-test-member', 'checker-b').set('Idempotency-Key', 'india-rule-check').send({ expectedRowVersion: 0 });
    expect(checked.body).toMatchObject({ status: 'approved', approvedBy: 'checker-b', rowVersion: 1 });
  });

  it('uses Decimal strings and rejects duplicate upload identities in one payload', () => {
    expect(() => inboundEInvoiceCreateSchema.parse({
      supplierGstin: GSTIN, recipientGstin: '27ABCDE1234F1Z7', documentType: 'INV', documentNumber: 'S-1', documentDate: '2026-08-14',
      irn: 'a'.repeat(64), acknowledgementNumber: '123', acknowledgementAt: NOW, signedPayload: sourceEvidence,
      signedPayloadHash: hashCanonical(sourceEvidence), taxableValue: 100, taxAmount: '18', totalAmount: '118', provider: 'manual', origin: 'json_upload',
      externalVerification,
    })).toThrow();

    const entry = { supplierGstin: GSTIN, documentType: 'INV', documentNumber: 'S-1', documentDate: '2026-08-14', taxableValue: '100', taxAmount: '18', totalAmount: '118' };
    expect(() => gstr2bUploadSchema.parse({
      returnPeriod: '2026-08', generatedAt: NOW, recipientGstin: '27ABCDE1234F1Z7', sourceReference: 'portal-export',
      sourcePayload: sourceEvidence, sourcePayloadHash: hashCanonical(sourceEvidence), entries: [entry, entry], externalVerification,
    })).toThrow(/Duplicate document identity/);
  });

  it('supports the explicit URP identity only for export e-invoices', () => {
    const base = { sourceDocumentId: 'invoice-1', supplierGstin: GSTIN, recipientGstin: 'URP', documentType: 'INV' as const, placeOfSupply: '96', reverseCharge: false, dispatchDetails: {}, shipTo: {} };
    expect(outboundEInvoiceCreateSchema.parse({ ...base, supplyType: 'EXPWOP' })).toMatchObject({ recipientGstin: 'URP' });
    expect(() => outboundEInvoiceCreateSchema.parse({ ...base, supplyType: 'B2B' })).toThrow(/require the recipient GSTIN/);
  });

  it('evaluates only approved-profile data rather than hard-coded statutory thresholds', () => {
    const rules = complianceRuleProfileCreateSchema.parse(profileBody).rules;
    const included = evaluateApplicability({ profile: { id: 'p1', version: 'v1', rules }, documentType: 'INV', supplyType: 'B2B', documentValue: '1', documentDate: '2026-08-14', evaluatedAt: NOW });
    const excluded = evaluateApplicability({ profile: { id: 'p1', version: 'v1', rules: { ...rules, minimumDocumentValue: '1000' } }, documentType: 'INV', supplyType: 'B2B', documentValue: '999.99', documentDate: '2026-08-14', evaluatedAt: NOW });
    expect(included).toMatchObject({ applicable: true, profileVersion: 'v1' });
    expect(excluded).toMatchObject({ applicable: false, reasons: ['below_profile_value'] });
  });

  it('never fabricates government acknowledgements without a configured adapter', async () => {
    const provider = new UnavailableIndiaComplianceProvider();
    await expect(provider.submitEInvoice({}, 'submit-001')).rejects.toMatchObject({ status: 503, code: 'compliance_provider_unavailable' });
    await expect(provider.generateEWayBill({}, 'eway-001')).rejects.toMatchObject({ status: 503, code: 'compliance_provider_unavailable' });
  });
});
