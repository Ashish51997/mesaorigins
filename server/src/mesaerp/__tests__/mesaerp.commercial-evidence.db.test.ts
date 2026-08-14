import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.RUN_MESAERP_DB_INTEGRATION === '1';
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const run = `${process.pid}-${Date.now().toString(36)}`;
const organizationId = `commercial-evidence-org-${run}`;
const legalEntityId = `commercial-evidence-company-${run}`;
const financialYearId = `commercial-evidence-fy-${run}`;
const vendorId = `commercial-evidence-vendor-${run}`;
const purchaseOrderId = `commercial-evidence-po-${run}`;
const goodsReceiptId = `commercial-evidence-grn-${run}`;
const supplierInvoiceId = `commercial-evidence-invoice-${run}`;
const matchCaseId = `commercial-evidence-match-${run}`;

describe.skipIf(!enabled)('MesaERP approved commercial evidence immutability', () => {
  beforeAll(async () => {
    await direct.organization.create({ data: { id: organizationId, name: 'Commercial evidence test', slug: organizationId } });
    await direct.legalEntity.create({ data: { id: legalEntityId, organizationId, code: `CE-${run}`, legalName: 'Commercial Evidence Company' } });
    await direct.financialYear.create({ data: {
      id: financialYearId, organizationId, legalEntityId, code: `FY-${run}`,
      startsOn: new Date('2026-04-01T00:00:00.000Z'), endsOn: new Date('2027-03-31T00:00:00.000Z'),
    } });
    await direct.erpVendor.create({ data: {
      id: vendorId, organizationId, legalEntityId, vendorCode: `V-${run}`, legalName: 'Evidence Vendor',
      lifecycleStatus: 'approved', createdBy: 'vendor-maker', lastLifecycleActor: 'vendor-checker',
    } });
    for (const [id, documentType, number] of [
      [purchaseOrderId, 'purchase_order', `PO-${run}`],
      [goodsReceiptId, 'goods_receipt', `GRN-${run}`],
      [supplierInvoiceId, 'supplier_invoice', `SI-${run}`],
    ] as const) {
      await direct.erpDocument.create({ data: {
        id, organizationId, legalEntityId, financialYearId, documentType, documentNumber: number,
        documentDate: new Date('2026-08-14T00:00:00.000Z'), vendorId, subtotal: '100', grandTotal: '100',
        baseCurrencyTotal: '100', createdBy: 'document-maker',
      } });
      await direct.erpDocumentLine.create({ data: {
        organizationId, legalEntityId, documentId: id, lineNumber: 1, description: 'Reviewed line',
        quantity: '10', uom: 'KG', unitPrice: '10', taxableAmount: '100', lineTotal: '100',
      } });
      await direct.erpDocument.update({ where: { id }, data: {
        status: 'approved', approvalState: 'approved', submittedAt: new Date(), approvedAt: new Date(),
        approvedBy: 'document-checker', rowVersion: { increment: 1 },
      } });
    }
    await direct.erpMatchCase.create({ data: {
      id: matchCaseId, organizationId, legalEntityId, vendorId, supplierInvoiceId, purchaseOrderId,
      goodsReceiptId, status: 'variance', quantityVariance: '1', totalVariance: '10',
      details: [{ kind: 'reviewed_variance' }], makerMembershipId: 'match-maker',
    } });
    await direct.erpMatchCase.update({ where: { id: matchCaseId }, data: {
      status: 'approved', checkerMembershipId: 'match-checker', rowVersion: { increment: 1 },
    } });
  });

  afterAll(async () => { await direct.$disconnect(); });

  it('rejects content rewrites and line mutations after document approval', async () => {
    await expect(direct.erpDocument.update({
      where: { id: supplierInvoiceId }, data: { grandTotal: '101' },
    })).rejects.toThrow(/approved ERP document content is immutable/);
    const line = await direct.erpDocumentLine.findFirstOrThrow({ where: { documentId: supplierInvoiceId } });
    await expect(direct.erpDocumentLine.update({
      where: { id: line.id }, data: { description: 'tampered' },
    })).rejects.toThrow(/approved ERP document lines are immutable/);
    await expect(direct.erpDocumentLine.create({ data: {
      organizationId, legalEntityId, documentId: supplierInvoiceId, lineNumber: 2,
      description: 'late line', quantity: '1', uom: 'KG', unitPrice: '1', taxableAmount: '1', lineTotal: '1',
    } })).rejects.toThrow(/approved ERP document lines are immutable/);
  });

  it('permits only an explicit versioned lifecycle transition', async () => {
    await expect(direct.erpDocument.update({
      where: { id: purchaseOrderId }, data: { status: 'draft', rowVersion: { increment: 1 } },
    })).rejects.toThrow(/invalid lifecycle transition/);
    const posted = await direct.erpDocument.update({
      where: { id: supplierInvoiceId },
      data: { status: 'posted', postedAt: new Date(), rowVersion: { increment: 1 } },
    });
    expect(posted.status).toBe('posted');
    await expect(direct.erpDocument.update({
      where: { id: supplierInvoiceId }, data: { terms: [{ tampered: true }] },
    })).rejects.toThrow(/approved ERP document content is immutable/);
  });

  it('keeps an approved match calculation immutable', async () => {
    await expect(direct.erpMatchCase.update({
      where: { id: matchCaseId }, data: { totalVariance: '0' },
    })).rejects.toThrow(/approved ERP match cases are immutable/);
  });

  it('retains owner-only cleanup compatibility for approved evidence', async () => {
    await expect(direct.erpMatchCase.delete({ where: { id: matchCaseId } })).resolves.toMatchObject({ id: matchCaseId });
    const line = await direct.erpDocumentLine.findFirstOrThrow({ where: { documentId: goodsReceiptId } });
    await expect(direct.erpDocumentLine.delete({ where: { id: line.id } })).resolves.toMatchObject({ id: line.id });
    await expect(direct.erpDocument.delete({ where: { id: goodsReceiptId } })).resolves.toMatchObject({ id: goodsReceiptId });
  });
});
