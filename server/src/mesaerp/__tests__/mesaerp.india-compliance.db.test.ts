import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantContext } from '../../lib/tenantContext';
import { hashCanonical } from '../repository';
import { signExternalEvidence } from '../indiaComplianceEvidence';
import type { IndiaComplianceProvider } from '../indiaComplianceProvider';
import { PrismaMesaErpIndiaComplianceService } from '../indiaComplianceService';

const enabled = process.env.RUN_MESAERP_DB_INTEGRATION === '1';
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const orgId = 'india-compliance-db-org';
const legalEntityId = 'india-compliance-db-company';
const fyId = 'india-compliance-db-fy';
const makerId = 'india-compliance-db-maker';
const checkerId = 'india-compliance-db-checker';
const sellerGstin = '29ABCDE1234F1Z5';
const buyerGstin = '27ABCDE1234F1Z7';
const now = '2026-08-14T10:00:00.000Z';
const externalEvidenceKey = Buffer.alloc(32, 19).toString('base64');
let originalExternalEvidenceKey: string | undefined;

async function withoutExternalEvidenceKey<T>(work: () => Promise<T>): Promise<T> {
  const previousExternalEvidenceKey = process.env.MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY;
  delete process.env.MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY;
  try {
    return await work();
  } finally {
    if (previousExternalEvidenceKey === undefined) {
      delete process.env.MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY;
    } else {
      process.env.MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY = previousExternalEvidenceKey;
    }
  }
}

function externallyVerify(input: {
  evidenceKind: 'outbound_e_invoice_manual_ack' | 'external_e_way_bill' | 'inbound_e_invoice' | 'gstr2b_upload';
  sourceRecordType: string;
  sourceRecordId: string;
  evidence: unknown;
}) {
  const verifierReference = 'approved-external-verifier:test-fixture';
  return {
    verifierReference,
    verifiedAt: now,
    signature: signExternalEvidence({
      organizationId: orgId,
      legalEntityId,
      ...input,
      verifierReference,
      verifiedAt: now,
    }),
  };
}

const provider: IndiaComplianceProvider = {
  async submitEInvoice() {
    return { provider: 'test-irp', providerReference: 'irp-1', irn: '1'.repeat(64), acknowledgementNumber: 'ACK-1', acknowledgementAt: now, signedPayload: { signed: 'irp-response' }, qrData: 'signed-qr-data' };
  },
  async cancelEInvoice() { return { providerReference: 'irp-cancel-1', cancelledAt: now, evidence: { cancelled: true } }; },
  async generateEWayBill() {
    return { provider: 'test-gsp', providerReference: 'gsp-1', eWayBillNumber: '123456789012', issuedAt: now, validUntil: '2099-08-20T10:00:00.000Z', signedPayload: { signed: 'eway-response' } };
  },
  async cancelEWayBill() { return { providerReference: 'gsp-cancel-1', cancelledAt: now, evidence: { cancelled: true } }; },
  async updateEWayBillVehicle() { return { providerReference: 'gsp-vehicle-1', updatedAt: now, vehicle: { vehicleNumber: 'KA01AB4321' }, evidence: { accepted: true } }; },
  async extendEWayBill() { return { providerReference: 'gsp-extend-1', extendedAt: now, validUntil: '2100-08-20T10:00:00.000Z', evidence: { accepted: true } }; },
};

function asActor<T>(membershipId: string, work: () => Promise<T>) {
  return tenantContext.run({ organizationId: orgId, membershipId, userId: `user-${membershipId}`, role: 'Tax User', email: `${membershipId}@example.test` }, work);
}

function profileInput(kind: 'outbound_e_invoice' | 'e_way_bill', version: string) {
  const sourceEvidence = { source: 'official-test-fixture', version, capturedAt: now };
  return {
    artifactKind: kind,
    version,
    effectiveFrom: '2026-04-01',
    effectiveTo: '2027-03-31',
    rules: {
      enabled: true,
      documentTypes: ['INV'],
      supplyTypes: [kind === 'e_way_bill' ? 'supply' : 'B2B'],
      exemptSupplyTypes: [],
      minimumDocumentValue: '0',
      minimumDistanceKm: 0,
      notes: 'Integration fixture only.',
    },
    sourceReference: `official:test:${version}`,
    sourceEvidence,
    sourceChecksum: hashCanonical(sourceEvidence),
  };
}

describe.skipIf(!enabled)('MesaERP India compliance database integration', () => {
  beforeAll(async () => {
    originalExternalEvidenceKey = process.env.MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY;
    process.env.MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY = externalEvidenceKey;
    await direct.organization.create({ data: { id: orgId, name: 'India Compliance DB Org', slug: orgId } });
    await direct.user.createMany({ data: [
      { id: `user-${makerId}`, email: `${makerId}@example.test`, name: 'Maker' },
      { id: `user-${checkerId}`, email: `${checkerId}@example.test`, name: 'Checker' },
    ] });
    await direct.membership.createMany({ data: [
      { id: makerId, organizationId: orgId, userId: `user-${makerId}`, employeeCode: 'MAKER', department: 'Tax', role: 'Tax User' },
      { id: checkerId, organizationId: orgId, userId: `user-${checkerId}`, employeeCode: 'CHECKER', department: 'Tax', role: 'Tax Checker' },
    ] });
    await direct.legalEntity.create({ data: {
      id: legalEntityId, organizationId: orgId, code: 'IND', legalName: 'India Compliance Company', countryCode: 'IN', baseCurrency: 'INR',
      gstRegistrations: [{ gstin: sellerGstin }], createIdempotencyKey: 'legal-entity-compliance-db', requestHash: 'a'.repeat(64),
    } });
    await direct.financialYear.create({ data: { id: fyId, organizationId: orgId, legalEntityId, code: 'FY26-27', startsOn: new Date('2026-04-01T00:00:00.000Z'), endsOn: new Date('2027-03-31T00:00:00.000Z') } });
    const customer = await direct.erpCustomer.create({ data: { organizationId: orgId, legalEntityId, customerCode: 'BUYER', legalName: 'Buyer Pvt Ltd', gstin: buyerGstin } });
    const item = await direct.erpItem.create({ data: { organizationId: orgId, legalEntityId, itemCode: 'FG-001', name: 'Finished Component', baseUom: 'EA', hsnSacCode: '39269099', gstRate: '18', createIdempotencyKey: 'item-compliance-db', requestHash: 'b'.repeat(64) } });
    const invoice = await direct.erpDocument.create({ data: {
      id: 'india-compliance-sales-invoice', organizationId: orgId, legalEntityId, financialYearId: fyId,
      documentType: 'sales_invoice', documentNumber: 'INV-001', documentDate: new Date('2026-08-14T00:00:00.000Z'),
      customerId: customer.id, partySnapshot: { gstin: buyerGstin, legalName: 'Buyer Pvt Ltd' },
      subtotal: '1000', taxTotal: '180', grandTotal: '1180', baseCurrencyTotal: '1180',
      createIdempotencyKey: 'invoice-compliance-db', requestHash: 'c'.repeat(64), createdBy: makerId,
    } });
    await direct.erpDocumentLine.create({ data: {
      organizationId: orgId, legalEntityId, documentId: invoice.id, lineNumber: 1, itemId: item.id,
      description: 'Finished Component', hsnSacCode: '39269099', quantity: '10', uom: 'EA', unitPrice: '100',
      taxableAmount: '1000', taxRate: '18', taxAmount: '180', lineTotal: '1180',
    } });
    await direct.erpDocument.update({ where: { id: invoice.id }, data: {
      status: 'approved', approvalState: 'approved', submittedAt: new Date(now), approvedBy: checkerId,
      approvedAt: new Date(now), rowVersion: { increment: 1 },
    } });
  });

  afterAll(async () => {
    try {
      await direct.$disconnect();
    } finally {
      if (originalExternalEvidenceKey === undefined) {
        delete process.env.MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY;
      } else {
        process.env.MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY = originalExternalEvidenceKey;
      }
    }
  });

  it('activates source-hashed profiles only through a separate checker', async () => {
    const service = new PrismaMesaErpIndiaComplianceService();
    const draft = await asActor(makerId, () => service.createRuleProfile(legalEntityId, profileInput('outbound_e_invoice', '2026.1'), 'profile-outbound-create'));
    await expect(asActor(makerId, () => service.approveRuleProfile(legalEntityId, draft.id, { expectedRowVersion: 0 }, 'profile-outbound-self'))).rejects.toMatchObject({ code: 'maker_checker_required' });
    const approved = await asActor(checkerId, () => service.approveRuleProfile(legalEntityId, draft.id, { expectedRowVersion: 0 }, 'profile-outbound-approve'));
    expect(approved).toMatchObject({ status: 'approved', approvedBy: checkerId, rowVersion: 1 });

    const ewayDraft = await asActor(makerId, () => service.createRuleProfile(legalEntityId, profileInput('e_way_bill', '2026.1'), 'profile-eway-create'));
    await asActor(checkerId, () => service.approveRuleProfile(legalEntityId, ewayDraft.id, { expectedRowVersion: 0 }, 'profile-eway-approve'));
  });

  it('runs outbound draft, checker approval, provider failure and externally verified acknowledgement without MesaOps', async () => {
    const service = new PrismaMesaErpIndiaComplianceService();
    const input = { sourceDocumentId: 'india-compliance-sales-invoice', supplierGstin: sellerGstin, recipientGstin: buyerGstin, documentType: 'INV' as const, supplyType: 'B2B' as const, placeOfSupply: '27', reverseCharge: false, dispatchDetails: {}, shipTo: {} };
    const draft = await asActor(makerId, () => service.createOutboundEInvoice(legalEntityId, input, 'outbound-create-001'));
    const replay = await asActor(makerId, () => service.createOutboundEInvoice(legalEntityId, input, 'outbound-create-001'));
    expect(replay.id).toBe(draft.id);
    await expect(asActor(makerId, () => service.approveOutboundEInvoice(legalEntityId, draft.id, { expectedRowVersion: 0 }, 'outbound-approve-self'))).rejects.toMatchObject({ code: 'maker_checker_required' });
    const approved = await asActor(checkerId, () => service.approveOutboundEInvoice(legalEntityId, draft.id, { expectedRowVersion: 0 }, 'outbound-approve-001'));
    await expect(asActor(checkerId, () => service.submitOutboundEInvoice(legalEntityId, draft.id, { expectedRowVersion: approved.rowVersion }, 'outbound-provider-unavailable'))).rejects.toMatchObject({ code: 'compliance_provider_unavailable' });

    const signedPayload = { signed: 'manual-irp-acknowledgement' };
    const acknowledgementEvidence = {
      expectedRowVersion: approved.rowVersion, provider: 'manual-irp', providerReference: 'manual-ack-1', irn: '2'.repeat(64),
      acknowledgementNumber: 'ACK-MANUAL-1', acknowledgementAt: now, signedPayload, signedPayloadHash: hashCanonical(signedPayload),
      qrData: 'signed-qr-data',
    };
    const acknowledgement = {
      ...acknowledgementEvidence,
      externalVerification: externallyVerify({
        evidenceKind: 'outbound_e_invoice_manual_ack', sourceRecordType: 'ErpTaxDocument', sourceRecordId: draft.id,
        evidence: acknowledgementEvidence,
      }),
    };
    await expect(withoutExternalEvidenceKey(() => asActor(checkerId, () => service.importOutboundEInvoiceAcknowledgement(
      legalEntityId, draft.id, acknowledgement, 'outbound-manual-ack-no-verifier',
    )))).rejects.toMatchObject({ code: 'external_evidence_verifier_unavailable' });
    const acknowledged = await asActor(checkerId, () => service.importOutboundEInvoiceAcknowledgement(legalEntityId, draft.id, acknowledgement, 'outbound-manual-ack-001'));
    expect(acknowledged).toMatchObject({ status: 'acknowledged', irn: '2'.repeat(64), rowVersion: 2 });
    await expect(asActor(makerId, () => service.createOutboundEInvoice(legalEntityId, input, 'outbound-create-duplicate'))).rejects.toMatchObject({ code: 'outbound_e_invoice_identity_exists' });

    await expect(direct.erpTaxDocument.update({ where: { id: draft.id }, data: { submittedPayload: { tampered: true }, rowVersion: { increment: 1 } } })).rejects.toThrow(/immutable/);
  });

  it('runs provider-backed e-way generation, vehicle update and validity extension with immutable evidence', async () => {
    const service = new PrismaMesaErpIndiaComplianceService(provider);
    const draft = await asActor(makerId, () => service.createEWayBill(legalEntityId, {
      sourceDocumentId: 'india-compliance-sales-invoice', supplierGstin: sellerGstin, recipientGstin: buyerGstin,
      documentType: 'INV', supplyType: 'supply', subSupplyType: 'outward', transactionType: 'regular', distanceKm: 120,
      transporter: { transporterId: '', transporterName: 'Test Transport', fromPlace: 'Bengaluru', fromStateCode: '29', fromPincode: '560001', toPlace: 'Mumbai', toStateCode: '27', toPincode: '400001' },
      vehicle: { mode: 'road', vehicleNumber: 'KA01AB1234', transporterDocumentNumber: '', vehicleType: 'regular' },
    }, 'eway-create-001'));
    const approved = await asActor(checkerId, () => service.approveEWayBill(legalEntityId, draft.id, { expectedRowVersion: 0 }, 'eway-approve-001'));
    const active = await asActor(checkerId, () => service.generateEWayBill(legalEntityId, draft.id, { expectedRowVersion: approved.rowVersion }, 'eway-generate-001'));
    expect(active).toMatchObject({ status: 'active', acknowledgementNumber: '123456789012', rowVersion: 2 });
    const vehicle = await asActor(checkerId, () => service.updateEWayBillVehicle(legalEntityId, draft.id, {
      expectedRowVersion: active.rowVersion, vehicle: { mode: 'road', vehicleNumber: 'KA01AB4321', transporterDocumentNumber: '', vehicleType: 'regular' }, reasonCode: '1', reason: 'Vehicle breakdown replacement',
    }, 'eway-vehicle-001'));
    const extended = await asActor(checkerId, () => service.extendEWayBill(legalEntityId, draft.id, {
      expectedRowVersion: vehicle.rowVersion, remainingDistanceKm: 40, reasonCode: '1', reason: 'Transit delay due to breakdown',
      fromPlace: 'Pune', fromStateCode: '27', fromPincode: '411001', transitType: 'movement',
      vehicle: { mode: 'road', vehicleNumber: 'KA01AB4321', transporterDocumentNumber: '', vehicleType: 'regular' },
    }, 'eway-extend-001'));
    expect(extended).toMatchObject({ validUntil: '2100-08-20T10:00:00.000Z', rowVersion: 4 });
    await expect(asActor(makerId, () => service.cancelEWayBill(legalEntityId, draft.id, { expectedRowVersion: 4, reasonCode: '1', reason: 'Order cancelled before movement' }, 'eway-cancel-self'))).rejects.toMatchObject({ code: 'maker_checker_required' });
    const cancelled = await asActor(checkerId, () => service.cancelEWayBill(legalEntityId, draft.id, { expectedRowVersion: 4, reasonCode: '1', reason: 'Order cancelled before movement' }, 'eway-cancel-001'));
    expect(cancelled).toMatchObject({ status: 'cancelled', rowVersion: 5 });
  });

  it('re-verifies external movement and supplier evidence before GSTR-2B reconciliation and ITC claim', async () => {
    const service = new PrismaMesaErpIndiaComplianceService();
    const externalEvidence = { portalAcknowledgement: 'external-eway-evidence' };
    const externalMovementEvidence = {
      businessDate: '2026-08-14', supplierGstin: sellerGstin, recipientGstin: buyerGstin, documentType: 'INV', documentNumber: 'EXT-INV-1',
      eWayBillNumber: '987654321012', issuedAt: now, validUntil: '2099-08-20T10:00:00.000Z',
      transporter: { transporterId: '', transporterName: 'External Transport', fromPlace: 'Bengaluru', fromStateCode: '29', fromPincode: '560001', toPlace: 'Mumbai', toStateCode: '27', toPincode: '400001' },
      vehicle: { mode: 'road', vehicleNumber: 'KA01AB5678', transporterDocumentNumber: '', vehicleType: 'regular' },
      evidence: externalEvidence, evidenceHash: hashCanonical(externalEvidence),
    } as const;
    const externalMovement = {
      ...externalMovementEvidence,
      externalVerification: externallyVerify({
        evidenceKind: 'external_e_way_bill', sourceRecordType: 'ExternalMovementDocument',
        sourceRecordId: 'INV:EXT-INV-1:987654321012', evidence: externalMovementEvidence,
      }),
    };
    await expect(withoutExternalEvidenceKey(() => asActor(makerId, () => service.createExternalEWayBill(
      legalEntityId, externalMovement, 'external-eway-create-no-verifier',
    )))).rejects.toMatchObject({ code: 'external_evidence_verifier_unavailable' });
    const external = await asActor(makerId, () => service.createExternalEWayBill(legalEntityId, externalMovement, 'external-eway-create'));
    await expect(asActor(makerId, () => service.verifyExternalEWayBill(legalEntityId, external.id, { expectedRowVersion: 0 }, 'external-eway-self'))).rejects.toMatchObject({ code: 'maker_checker_required' });
    await expect(withoutExternalEvidenceKey(() => asActor(checkerId, () => service.verifyExternalEWayBill(
      legalEntityId, external.id, { expectedRowVersion: 0 }, 'external-eway-no-verifier',
    )))).rejects.toMatchObject({ code: 'external_evidence_verifier_unavailable' });
    const verified = await asActor(checkerId, () => service.verifyExternalEWayBill(legalEntityId, external.id, { expectedRowVersion: 0 }, 'external-eway-verify'));
    expect(verified.status).toBe('active');

    const supplierSigned = { signed: 'supplier-irp-evidence' };
    const inboundEvidence = {
      supplierGstin: '27AAACB1234C1Z9', recipientGstin: sellerGstin, documentType: 'INV', documentNumber: 'SUP-001', documentDate: '2026-08-14',
      irn: '3'.repeat(64), acknowledgementNumber: 'SUP-ACK-1', acknowledgementAt: now, signedPayload: supplierSigned,
      signedPayloadHash: hashCanonical(supplierSigned), taxableValue: '500', taxAmount: '90', totalAmount: '590', provider: 'supplier-upload', providerReference: 'sup-1', origin: 'json_upload',
    } as const;
    const inboundUpload = {
      ...inboundEvidence,
      externalVerification: externallyVerify({
        evidenceKind: 'inbound_e_invoice', sourceRecordType: 'InboundInvoiceIdentity',
        sourceRecordId: '27AAACB1234C1Z9:INV:SUP-001:2026-08-14', evidence: inboundEvidence,
      }),
    };
    await expect(withoutExternalEvidenceKey(() => asActor(makerId, () => service.createInboundEInvoice(
      legalEntityId, inboundUpload, 'inbound-create-no-verifier',
    )))).rejects.toMatchObject({ code: 'external_evidence_verifier_unavailable' });
    const inbound = await asActor(makerId, () => service.createInboundEInvoice(legalEntityId, inboundUpload, 'inbound-create-001'));
    const portalPayload = { returnPeriod: '2026-08', source: 'portal-export' };
    const gstr2bEvidence = {
      returnPeriod: '2026-08', generatedAt: now, recipientGstin: sellerGstin, sourceReference: 'portal-export-2026-08',
      sourcePayload: portalPayload, sourcePayloadHash: hashCanonical(portalPayload), entries: [{
        supplierGstin: '27AAACB1234C1Z9', documentType: 'INV' as const, documentNumber: 'SUP-001', documentDate: '2026-08-14', irn: '3'.repeat(64),
        taxableValue: '500', taxAmount: '90', totalAmount: '590', portalItcAvailability: 'available' as const, reason: '',
      }],
    };
    const gstr2bUpload = {
      ...gstr2bEvidence,
      externalVerification: externallyVerify({
        evidenceKind: 'gstr2b_upload', sourceRecordType: 'Gstr2bPeriod',
        sourceRecordId: `${sellerGstin}:2026-08`, evidence: gstr2bEvidence,
      }),
    };
    await expect(withoutExternalEvidenceKey(() => asActor(makerId, () => service.uploadGstr2b(
      legalEntityId, gstr2bUpload, 'gstr2b-upload-no-verifier',
    )))).rejects.toMatchObject({ code: 'external_evidence_verifier_unavailable' });
    const gstr2b = await asActor(makerId, () => service.uploadGstr2b(legalEntityId, gstr2bUpload, 'gstr2b-upload-001'));
    await expect(withoutExternalEvidenceKey(() => asActor(makerId, () => service.reconcileInboundEInvoice(
      legalEntityId, inbound.id, { expectedRowVersion: 0, gstr2bDocumentId: gstr2b.id }, 'inbound-reconcile-no-verifier',
    )))).rejects.toMatchObject({ code: 'external_evidence_verifier_unavailable' });
    const reconciled = await asActor(makerId, () => service.reconcileInboundEInvoice(legalEntityId, inbound.id, { expectedRowVersion: 0, gstr2bDocumentId: gstr2b.id }, 'inbound-reconcile-001'));
    expect(reconciled).toMatchObject({ status: 'reconciled', itcStatus: 'eligible', rowVersion: 1 });
    await expect(asActor(makerId, () => service.decideInboundItc(legalEntityId, inbound.id, { expectedRowVersion: 1, status: 'claimed', reason: 'Matched to portal evidence and approved for claim' }, 'inbound-itc-self'))).rejects.toMatchObject({ code: 'maker_checker_required' });
    await expect(withoutExternalEvidenceKey(() => asActor(checkerId, () => service.decideInboundItc(
      legalEntityId, inbound.id, { expectedRowVersion: 1, status: 'claimed', reason: 'Matched to portal evidence and approved for claim' }, 'inbound-itc-no-verifier',
    )))).rejects.toMatchObject({ code: 'external_evidence_verifier_unavailable' });
    const claimed = await asActor(checkerId, () => service.decideInboundItc(legalEntityId, inbound.id, { expectedRowVersion: 1, status: 'claimed', reason: 'Matched to portal evidence and approved for claim' }, 'inbound-itc-claim'));
    expect(claimed).toMatchObject({ itcStatus: 'claimed', rowVersion: 2 });

    expect(await direct.integrationOutboxEvent.count({ where: { organizationId: orgId, aggregateType: 'ErpTaxDocument' } })).toBeGreaterThanOrEqual(9);
    expect(await direct.auditEvent.count({ where: { organizationId: orgId, entity: 'ErpTaxDocument' } })).toBeGreaterThanOrEqual(9);
  });
});
