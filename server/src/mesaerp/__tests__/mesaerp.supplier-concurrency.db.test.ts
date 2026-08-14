import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantContext } from '../../lib/tenantContext';
import { PrismaSupplierManagementService, PrismaSupplierPortalService, type SupplierActor } from '../supplierPortalService';

const enabled = process.env.RUN_MESAERP_DB_INTEGRATION === '1';
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const run = `${process.pid}-${Date.now().toString(36)}`;
const organizationId = `supplier-race-org-${run}`;
const legalEntityId = `supplier-race-company-${run}`;
const financialYearId = `supplier-race-fy-${run}`;
const vendorA = `supplier-race-vendor-a-${run}`;
const vendorB = `supplier-race-vendor-b-${run}`;
const portalA = `supplier-race-portal-a-${run}`;
const portalB = `supplier-race-portal-b-${run}`;
const purchaseOrderId = `supplier-race-po-${run}`;
const purchaseOrderLineId = `supplier-race-po-line-${run}`;
const rfqId = `supplier-race-rfq-${run}`;
const quotationA = `supplier-race-quote-a-${run}`;
const quotationB = `supplier-race-quote-b-${run}`;
const changeCaseId = `supplier-race-change-${run}`;
const disputeId = `supplier-race-dispute-${run}`;

const supplierActor: SupplierActor = {
  organizationId, legalEntityId, vendorId: vendorA, portalUserId: portalA,
  email: `supplier-a-${run}@example.test`, name: 'Supplier A', permissions: ['supplier.asn.write', 'supplier.dispute.respond'],
};

function asEmployee<T>(membershipId: string, work: () => Promise<T>) {
  return tenantContext.run({
    organizationId, membershipId, userId: `user-${membershipId}`,
    role: 'ERP Sourcing Checker', email: `${membershipId}@example.test`,
  }, work);
}

describe.skipIf(!enabled)('supplier aggregate concurrency controls', () => {
  beforeAll(async () => {
    await direct.organization.create({ data: { id: organizationId, name: 'Supplier race test', slug: organizationId } });
    await direct.legalEntity.create({ data: { id: legalEntityId, organizationId, code: `SR-${run}`, legalName: 'Supplier Race Company' } });
    await direct.financialYear.create({ data: {
      id: financialYearId, organizationId, legalEntityId, code: `FY-${run}`,
      startsOn: new Date('2026-04-01T00:00:00.000Z'), endsOn: new Date('2027-03-31T00:00:00.000Z'),
    } });
    await direct.erpVendor.createMany({ data: [
      { id: vendorA, organizationId, legalEntityId, vendorCode: `VA-${run}`, legalName: 'Supplier A', lifecycleStatus: 'approved', createdBy: 'vendor-maker', lastLifecycleActor: 'vendor-checker' },
      { id: vendorB, organizationId, legalEntityId, vendorCode: `VB-${run}`, legalName: 'Supplier B', lifecycleStatus: 'approved', createdBy: 'vendor-maker', lastLifecycleActor: 'vendor-checker' },
    ] });
    await direct.supplierPortalUser.createMany({ data: [
      { id: portalA, organizationId, legalEntityId, vendorId: vendorA, email: supplierActor.email, name: 'Supplier A', status: 'active', permissions: supplierActor.permissions },
      { id: portalB, organizationId, legalEntityId, vendorId: vendorB, email: `supplier-b-${run}@example.test`, name: 'Supplier B', status: 'active', permissions: ['supplier.rfq.respond'] },
    ] });
    await direct.erpDocument.create({ data: {
      id: purchaseOrderId, organizationId, legalEntityId, financialYearId, documentType: 'purchase_order',
      documentNumber: `PO-${run}`, documentDate: new Date('2026-08-14T00:00:00.000Z'), vendorId: vendorA,
      subtotal: '100', grandTotal: '100', baseCurrencyTotal: '100', createdBy: 'po-maker',
    } });
    await direct.erpDocumentLine.create({ data: {
      id: purchaseOrderLineId, organizationId, legalEntityId, documentId: purchaseOrderId, lineNumber: 1,
      description: 'Polymer input', quantity: '10', uom: 'KG', unitPrice: '10', taxableAmount: '100', lineTotal: '100',
    } });
    await direct.erpDocument.update({ where: { id: purchaseOrderId }, data: {
      status: 'approved', approvalState: 'approved', submittedAt: new Date(), approvedAt: new Date(),
      approvedBy: 'po-checker', rowVersion: { increment: 1 },
    } });

    await direct.erpRfq.create({ data: {
      id: rfqId, organizationId, legalEntityId, rfqNumber: `RFQ-${run}`, title: 'Resin sourcing',
      responseDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000), status: 'issued', createdBy: 'rfq-maker',
      issuedBy: 'rfq-issuer', issuedAt: new Date(),
    } });
    const rfqLine = await direct.erpRfqLine.create({ data: {
      organizationId, legalEntityId, rfqId, lineNumber: 1, description: 'Resin', quantity: '10', uom: 'KG',
    } });
    const invitations = await Promise.all([vendorA, vendorB].map((vendorId) => direct.erpRfqInvitation.create({ data: {
      organizationId, legalEntityId, rfqId, vendorId, status: 'responded', issuedAt: new Date(), respondedAt: new Date(),
    } })));
    for (const [index, quotationId] of [quotationA, quotationB].entries()) {
      const vendorId = index === 0 ? vendorA : vendorB;
      const portalUserId = index === 0 ? portalA : portalB;
      await direct.erpSupplierQuotation.create({ data: {
        id: quotationId, organizationId, legalEntityId, rfqId, invitationId: invitations[index].id,
        vendorId, portalUserId, quotationNumber: `Q-${index}-${run}`, status: 'submitted', currency: 'INR',
        subtotal: '100', taxTotal: '0', grandTotal: '100', validUntil: new Date('2026-12-31T00:00:00.000Z'),
        lines: { create: {
          organizationId, legalEntityId, rfqLineId: rfqLine.id, lineNumber: 1, quantity: '10', unitRate: '10', lineTotal: '100',
        } },
      } });
    }
  });

  afterAll(async () => { await direct.$disconnect(); });

  it('serializes ASN aggregate creation so parallel notices cannot exceed a PO line', async () => {
    const service = new PrismaSupplierPortalService();
    const attempts = await Promise.allSettled(['A', 'B'].map((suffix) => service.createAsn(supplierActor, {
      purchaseOrderId, asnNumber: `ASN-${suffix}-${run}`, dispatchedOn: '2026-08-14', expectedArrivalOn: '2026-08-15',
      expectedPurchaseOrderRowVersion: 1,
      carrier: '', vehicleNumber: '', trackingReference: '', lines: [{ sourceLineId: purchaseOrderLineId, quantity: '6' }],
    }, `asn-race-${suffix}-${run}`)));
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((attempts.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ code: 'asn_quantity_exceeds_po' });
    const rows = await direct.erpAdvanceShipmentNotice.findMany({ where: { organizationId, purchaseOrderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].lines).toEqual([{ sourceLineId: purchaseOrderLineId, quantity: '6' }]);
  });

  it('allows only one concurrent RFQ award and one selected quotation', async () => {
    const service = new PrismaSupplierManagementService();
    const attempts = await Promise.allSettled([
      asEmployee('rfq-checker-a', () => service.selectQuotation(legalEntityId, rfqId, {
        expectedRowVersion: 0, quotationId: quotationA, selectionReason: 'Commercial and technical review A',
      }, `rfq-award-a-${run}`)),
      asEmployee('rfq-checker-b', () => service.selectQuotation(legalEntityId, rfqId, {
        expectedRowVersion: 0, quotationId: quotationB, selectionReason: 'Commercial and technical review B',
      }, `rfq-award-b-${run}`)),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rfq = await direct.erpRfq.findUniqueOrThrow({ where: { id: rfqId } });
    expect(rfq).toMatchObject({ status: 'awarded', rowVersion: 1 });
    const selected = await direct.erpSupplierQuotation.findMany({ where: { rfqId, status: 'selected' } });
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe(rfq.selectedQuotationId);
  });

  it('allows only one concurrent vendor-change decision', async () => {
    const service = new PrismaSupplierManagementService();
    await direct.erpVendorChangeCase.create({ data: {
      id: changeCaseId, organizationId, legalEntityId, vendorId: vendorA, portalUserId: portalA,
      changeType: 'profile', proposedValues: { tradeName: 'Reviewed Supplier' }, createIdempotencyKey: `change-${run}`,
    } });
    const attempts = await Promise.allSettled([
      asEmployee('change-checker-a', () => service.decideVendorChange(legalEntityId, changeCaseId, { expectedRowVersion: 0, decision: 'approved', reason: 'Evidence accepted' }, `change-a-${run}`)),
      asEmployee('change-checker-b', () => service.decideVendorChange(legalEntityId, changeCaseId, { expectedRowVersion: 0, decision: 'rejected', reason: 'Evidence rejected' }, `change-b-${run}`)),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const row = await direct.erpVendorChangeCase.findUniqueOrThrow({ where: { id: changeCaseId } });
    expect(['approved', 'rejected']).toContain(row.status);
    expect(row.rowVersion).toBe(1);
  });

  it('serializes supplier response against an employee dispute resolution', async () => {
    const service = new PrismaSupplierManagementService();
    const portal = new PrismaSupplierPortalService();
    await direct.erpVendorDispute.create({ data: {
      id: disputeId, organizationId, legalEntityId, vendorId: vendorA, subject: 'Quantity variance',
      description: 'Concurrent response test', createdByActorType: 'employee', createdByRef: 'dispute-maker',
      createIdempotencyKey: `dispute-${run}`,
    } });
    const attempts = await Promise.allSettled([
      portal.respondToDispute(supplierActor, disputeId, { expectedRowVersion: 0, response: 'Supplier evidence attached' }, `dispute-response-${run}`),
      asEmployee('dispute-checker', () => service.resolveDispute(legalEntityId, disputeId, { expectedRowVersion: 0, decision: 'resolved', resolution: 'Internal evidence accepted' }, `dispute-resolve-${run}`)),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const row = await direct.erpVendorDispute.findUniqueOrThrow({ where: { id: disputeId } });
    expect(['vendor_response', 'resolved']).toContain(row.status);
    expect(row.rowVersion).toBe(1);
  });
});
