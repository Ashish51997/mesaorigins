import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalHash } from '../../lib/canonical';
import { tenantContext } from '../../lib/tenantContext';
import { PrismaMesaErpTdsService } from '../tdsService';

const enabled = process.env.RUN_MESAERP_DB_INTEGRATION === '1';
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const unique = () => `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

afterAll(async () => { await direct.$disconnect(); });

function asActor<T>(organizationId: string, membershipId: string, work: () => Promise<T>) {
  return tenantContext.run({
    organizationId,
    membershipId,
    userId: `user-${membershipId}`,
    role: membershipId.includes('checker') ? 'ERP Checker' : 'ERP Maker',
    email: `${membershipId}@example.test`,
  }, work);
}

async function tenantWrite<T>(organizationId: string, work: (db: Prisma.TransactionClient) => Promise<T>) {
  return direct.$transaction(async (db) => {
    await db.$executeRaw(Prisma.sql`SELECT set_config('app.current_tenant', ${organizationId}, true)`);
    return work(db);
  });
}

describe.skipIf(!enabled)('MesaERP TDS source ownership', () => {
  it('requires vendor-bound payables and revalidates the payment relationship at submit and approve', async () => {
    const run = unique();
    const organizationId = `tds-binding-org-${run}`;
    const legalEntityId = `tds-binding-entity-${run}`;
    const financialYearId = `tds-binding-fy-${run}`;
    const periodId = `tds-binding-period-${run}`;
    const makerId = `tds-binding-maker-${run}`;
    const checkerId = `tds-binding-checker-${run}`;
    const vendorId = `tds-binding-vendor-a-${run}`;
    const otherVendorId = `tds-binding-vendor-b-${run}`;
    const supplierInvoiceId = `tds-binding-invoice-${run}`;
    const payableVoucherId = `tds-binding-payable-${run}`;
    const unboundPayableVoucherId = `tds-binding-unbound-${run}`;
    const paymentVoucherId = `tds-binding-payment-${run}`;
    const paymentProposalId = `tds-binding-proposal-${run}`;
    const expenseAccountId = `tds-binding-expense-${run}`;
    const payableAccountId = `tds-binding-ap-${run}`;
    const bankAccountId = `tds-binding-bank-${run}`;
    const sectionId = `tds-binding-section-${run}`;
    const rateId = `tds-binding-rate-${run}`;
    const classificationId = `tds-binding-classification-${run}`;
    const businessDate = new Date('2026-08-14T00:00:00.000Z');

    await direct.organization.create({ data: { id: organizationId, name: 'TDS binding fixture', slug: organizationId } });
    await tenantWrite(organizationId, async (db) => {
      await db.legalEntity.create({ data: {
        id: legalEntityId, organizationId, code: `TB-${run}`, legalName: 'TDS Binding Company',
        createIdempotencyKey: `entity-${run}`, requestHash: 'a'.repeat(64),
      } });
      await db.financialYear.create({ data: {
        id: financialYearId, organizationId, legalEntityId, code: '2026-27',
        startsOn: new Date('2026-04-01T00:00:00.000Z'), endsOn: new Date('2027-03-31T00:00:00.000Z'),
      } });
      await db.accountingPeriod.create({ data: {
        id: periodId, organizationId, legalEntityId, financialYearId, periodNumber: 5, name: 'August 2026',
        startsOn: new Date('2026-08-01T00:00:00.000Z'), endsOn: new Date('2026-08-31T00:00:00.000Z'),
      } });
      await db.erpAccount.createMany({ data: [
        { id: expenseAccountId, organizationId, legalEntityId, code: `EXP-${run}`, name: 'Expense', accountType: 'expense', classification: 'operating_expense' },
        { id: payableAccountId, organizationId, legalEntityId, code: `AP-${run}`, name: 'Payable', accountType: 'liability', classification: 'payable' },
        { id: bankAccountId, organizationId, legalEntityId, code: `BANK-${run}`, name: 'Bank', accountType: 'asset', classification: 'bank' },
      ] });
      await db.erpVendor.createMany({ data: [
        { id: vendorId, organizationId, legalEntityId, vendorCode: `VA-${run}`, legalName: 'Bound Vendor', lifecycleStatus: 'approved', createdBy: makerId, lastLifecycleActor: checkerId },
        { id: otherVendorId, organizationId, legalEntityId, vendorCode: `VB-${run}`, legalName: 'Other Vendor', lifecycleStatus: 'approved', createdBy: makerId, lastLifecycleActor: checkerId },
      ] });
      await db.erpDocument.create({ data: {
        id: supplierInvoiceId, organizationId, legalEntityId, financialYearId,
        documentType: 'supplier_invoice', documentNumber: `SI-${run}`, documentDate: businessDate,
        status: 'approved', approvalState: 'approved', vendorId, grandTotal: '1000', baseCurrencyTotal: '1000',
        createdBy: makerId, approvedBy: checkerId, approvedAt: new Date(),
      } });

      for (const voucher of [
        { id: payableVoucherId, type: 'purchase', number: `PUR-${run}`, sourceDocumentId: supplierInvoiceId },
        { id: unboundPayableVoucherId, type: 'purchase', number: `UNBOUND-${run}`, sourceDocumentId: null },
      ]) {
        await db.erpVoucher.create({ data: {
          id: voucher.id, organizationId, legalEntityId, financialYearId, accountingPeriodId: periodId,
          voucherType: voucher.type, voucherNumber: voucher.number, businessDate,
          transactionDebit: '1000', transactionCredit: '1000', baseDebit: '1000', baseCredit: '1000',
          sourceDocumentId: voucher.sourceDocumentId, createdBy: makerId,
        } });
        await db.erpVoucherLine.createMany({ data: [
          { organizationId, legalEntityId, voucherId: voucher.id, lineNumber: 1, accountId: expenseAccountId, transactionDebit: '1000', baseDebit: '1000' },
          { organizationId, legalEntityId, voucherId: voucher.id, lineNumber: 2, accountId: payableAccountId, transactionCredit: '1000', baseCredit: '1000' },
        ] });
        await db.erpVoucher.update({ where: { id: voucher.id }, data: { status: 'submitted', submittedAt: new Date(), rowVersion: { increment: 1 } } });
        await db.erpVoucher.update({ where: { id: voucher.id }, data: { status: 'approved', approvedAt: new Date(), approvedBy: checkerId, rowVersion: { increment: 1 } } });
        await db.erpVoucher.update({ where: { id: voucher.id }, data: { status: 'posted', postedAt: new Date(), postedBy: checkerId, rowVersion: { increment: 1 } } });
      }

      await db.erpVoucher.create({ data: {
        id: paymentVoucherId, organizationId, legalEntityId, financialYearId, accountingPeriodId: periodId,
        voucherType: 'payment', voucherNumber: `PAY-${run}`, businessDate,
        transactionDebit: '1000', transactionCredit: '1000', baseDebit: '1000', baseCredit: '1000',
        sourceDocumentId: supplierInvoiceId, originType: 'payment_proposal',
        originMetadata: { paymentProposalId, vendorId }, createdBy: makerId,
      } });
      await db.erpVoucherLine.createMany({ data: [
        { organizationId, legalEntityId, voucherId: paymentVoucherId, lineNumber: 1, accountId: payableAccountId, transactionDebit: '1000', baseDebit: '1000', dimensions: { partyId: vendorId } },
        { organizationId, legalEntityId, voucherId: paymentVoucherId, lineNumber: 2, accountId: bankAccountId, transactionCredit: '1000', baseCredit: '1000' },
      ] });
      await db.erpVoucher.update({ where: { id: paymentVoucherId }, data: { status: 'submitted', submittedAt: new Date(), rowVersion: { increment: 1 } } });
      await db.erpVoucher.update({ where: { id: paymentVoucherId }, data: { status: 'approved', approvedAt: new Date(), approvedBy: checkerId, rowVersion: { increment: 1 } } });
      await db.erpVoucher.update({ where: { id: paymentVoucherId }, data: { status: 'posted', postedAt: new Date(), postedBy: checkerId, rowVersion: { increment: 1 } } });
      await db.erpVendorPaymentProposal.create({ data: {
        id: paymentProposalId, organizationId, legalEntityId, vendorId, supplierInvoiceId, paymentVoucherId,
        proposalNumber: `PP-${run}`, status: 'approved', amount: '1000', proposedPaymentOn: businessDate,
        payableAccountId, settlementAccountId: bankAccountId, createdBy: makerId,
        approvedBy: checkerId, approvedAt: new Date(),
      } });

      const sourceReference = 'TDS ownership fixture';
      const sourceEvidence = { fixture: run };
      await db.erpTdsSection.create({ data: {
        id: sectionId, organizationId, legalEntityId, code: `194C-${run}`, name: 'Contract payment', natureOfPayment: 'Contract',
        status: 'approved', sourceReference, sourceEvidence,
        effectiveSourceHash: canonicalHash({ sourceReference, sourceEvidence }), createdBy: makerId,
        approvedBy: checkerId, approvedAt: new Date(), rowVersion: 1,
      } });
      await db.erpTdsRate.create({ data: {
        id: rateId, organizationId, legalEntityId, sectionId,
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'), effectiveTo: new Date('2027-03-31T00:00:00.000Z'),
        standardRate: '10', noPanRate: '20', singlePaymentThreshold: '0', aggregateThreshold: '0', thresholdApplication: 'full_current',
        status: 'approved', sourceReference, sourceEvidence,
        sourceEvidenceHash: canonicalHash({ sourceReference, sourceEvidence }), createdBy: makerId,
        approvedBy: checkerId, approvedAt: new Date(), rowVersion: 1,
      } });
      const certificateReference = `PAN-${run}`;
      const evidence = { reviewed: true };
      await db.erpVendorTdsClassification.create({ data: {
        id: classificationId, organizationId, legalEntityId, vendorId, sectionId,
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'), effectiveTo: new Date('2027-03-31T00:00:00.000Z'),
        panStatus: 'valid', certificateReference, evidence,
        evidenceHash: canonicalHash({ certificateReference, evidence }), status: 'approved', createdBy: makerId,
        approvedBy: checkerId, approvedAt: new Date(), rowVersion: 1,
      } });
    });

    const tds = new PrismaMesaErpTdsService();
    await expect(asActor(organizationId, makerId, () => tds.createDeduction(legalEntityId, {
      vendorId, payableVoucherId: unboundPayableVoucherId, businessDate: '2026-08-14', grossAmount: '100', notes: 'Unbound payable',
    }, `tds-unbound-${run}`))).rejects.toMatchObject({ code: 'tds_payable_vendor_binding_required' });

    const deduction = await asActor(organizationId, makerId, () => tds.createDeduction(legalEntityId, {
      vendorId, payableVoucherId, paymentVoucherId, businessDate: '2026-08-14', grossAmount: '100', notes: 'Bound sources',
    }, `tds-bound-${run}`));
    expect(deduction).toMatchObject({ status: 'draft', calculationSnapshot: {
      payableVendorBinding: 'supplier_invoice', supplierInvoiceId, payableVoucherId, paymentVoucherId,
    } });

    await tenantWrite(organizationId, (db) => db.erpVendorPaymentProposal.update({
      where: { id: paymentProposalId }, data: { vendorId: otherVendorId },
    }));
    await expect(asActor(organizationId, makerId, () => tds.transitionDeduction(
      legalEntityId, deduction.id, 'submit', { expectedRowVersion: 0 }, `tds-submit-conflict-${run}`,
    ))).rejects.toMatchObject({ code: 'tds_payment_relationship_invalid' });

    await tenantWrite(organizationId, (db) => db.erpVendorPaymentProposal.update({
      where: { id: paymentProposalId }, data: { vendorId },
    }));
    const submitted = await asActor(organizationId, makerId, () => tds.transitionDeduction(
      legalEntityId, deduction.id, 'submit', { expectedRowVersion: 0 }, `tds-submit-${run}`,
    ));
    expect(submitted).toMatchObject({ status: 'submitted', rowVersion: 1, calculationSnapshot: {
      payableVendorBinding: 'supplier_invoice', supplierInvoiceId,
    } });

    await tenantWrite(organizationId, (db) => db.erpVendorPaymentProposal.update({
      where: { id: paymentProposalId }, data: { vendorId: otherVendorId },
    }));
    await expect(asActor(organizationId, checkerId, () => tds.transitionDeduction(
      legalEntityId, deduction.id, 'approve', { expectedRowVersion: 1 }, `tds-approve-conflict-${run}`,
    ))).rejects.toMatchObject({ code: 'tds_payment_relationship_invalid' });

    await tenantWrite(organizationId, (db) => db.erpVendorPaymentProposal.update({
      where: { id: paymentProposalId }, data: { vendorId },
    }));
    const approved = await asActor(organizationId, checkerId, () => tds.transitionDeduction(
      legalEntityId, deduction.id, 'approve', { expectedRowVersion: 1 }, `tds-approve-${run}`,
    ));
    expect(approved).toMatchObject({ status: 'approved', rowVersion: 2, approvedBy: checkerId });
  });
});
