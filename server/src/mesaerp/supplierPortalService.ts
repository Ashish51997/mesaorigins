import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { basePrisma, tenantTx, withTenant } from '../db';
import { tenantContext, type TenantCtx } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import { hasMesaErpPermission } from './access';
import { requireSupplierInvoiceReleaseMatch } from './purchaseMatchControl';
import { hashCanonical } from './repository';
import type {
  AgreementActivate, AsnCreate, DisputeCreate, DisputeResolve, PaymentProposalApprove,
  PaymentProposalCreate, PoAcknowledgementCreate, PortalChangeCreate, PortalInviteCreate,
  RfqCreate, RfqIssue, RfqSelect, SupplierDisputeResponse, SupplierInvoiceEvidenceCreate,
  SupplierQuotationCreate, VendorChangeDecision, VendorDocumentCreate, VendorDocumentReview,
} from './supplierPortalSchemas';

type Db = typeof basePrisma;

export const SUPPLIER_PORTAL_PERMISSIONS = [
  'supplier.profile.request_change', 'supplier.documents.write', 'supplier.rfq.respond',
  'supplier.po.respond', 'supplier.asn.write', 'supplier.invoice.evidence.write',
  'supplier.dispute.respond', 'supplier.payment.read',
] as const;

export interface SupplierActor {
  organizationId: string;
  legalEntityId: string;
  vendorId: string;
  portalUserId: string;
  email: string;
  name: string;
  permissions: string[];
}

export interface PermissionCheck {
  organizationId: string;
  membershipId: string;
  legalEntityId: string;
  permission: string;
}

export function supplierPortalLifecycleAllowed(status: string): boolean {
  return !['suspended', 'blocked'].includes(status);
}

export function assertPaymentCurrency(
  proposalCurrency: string,
  invoiceCurrency: string,
  baseCurrency: string,
): void {
  if (proposalCurrency !== invoiceCurrency || proposalCurrency !== baseCurrency) {
    throw new ApiError(
      422,
      'payment_currency_invalid',
      'V1 payment proposals must use both the supplier invoice currency and the legal entity base currency.',
    );
  }
}

const rfqInclude = {
  lines: { orderBy: { lineNumber: 'asc' as const } },
  invitations: { include: { vendor: true }, orderBy: { createdAt: 'asc' as const } },
  quotations: { include: { lines: { orderBy: { lineNumber: 'asc' as const } }, vendor: true }, orderBy: { submittedAt: 'desc' as const } },
} satisfies Prisma.ErpRfqInclude;

function employee(): TenantCtx {
  const context = tenantContext.getStore();
  if (!context) throw new ApiError(401, 'unauthenticated', 'No employee tenant context.');
  return context;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function output<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function rawToken(): string {
  return randomBytes(32).toString('base64url');
}

export function supplierInvitePath(token: string): string {
  return `/supplier-portal#invite=${encodeURIComponent(token)}`;
}

async function legalEntity(db: Db, organizationId: string, legalEntityId: string) {
  const entity = await db.legalEntity.findFirst({ where: { id: legalEntityId, organizationId, status: 'active' } });
  if (!entity) throw new ApiError(404, 'legal_entity_not_found', 'Active legal entity not found.');
  return entity;
}

async function lockSupplierInvoice(db: Db, legalEntityId: string, supplierInvoiceId: string) {
  await db.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ErpDocument"
    WHERE "id" = ${supplierInvoiceId}
      AND "legalEntityId" = ${legalEntityId}
      AND "documentType" = 'supplier_invoice'
    FOR UPDATE
  `);
}

async function lockRfq(db: Db, legalEntityId: string, rfqId: string) {
  await db.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ErpRfq"
    WHERE "id" = ${rfqId}
      AND "legalEntityId" = ${legalEntityId}
    FOR UPDATE
  `);
}

async function lockRateAgreement(db: Db, legalEntityId: string, agreementId: string) {
  await db.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ErpRateAgreement"
    WHERE "id" = ${agreementId}
      AND "legalEntityId" = ${legalEntityId}
    FOR UPDATE
  `);
}

async function lockVendorChangeCase(db: Db, legalEntityId: string, caseId: string) {
  await db.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ErpVendorChangeCase"
    WHERE "id" = ${caseId}
      AND "legalEntityId" = ${legalEntityId}
    FOR UPDATE
  `);
}

async function lockVendorDispute(db: Db, legalEntityId: string, disputeId: string) {
  await db.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ErpVendorDispute"
    WHERE "id" = ${disputeId}
      AND "legalEntityId" = ${legalEntityId}
    FOR UPDATE
  `);
}

async function lockPurchaseOrder(db: Db, legalEntityId: string, purchaseOrderId: string) {
  await db.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ErpDocument"
    WHERE "id" = ${purchaseOrderId}
      AND "legalEntityId" = ${legalEntityId}
      AND "documentType" = 'purchase_order'
    FOR UPDATE
  `);
}

async function lockPaymentProposal(db: Db, legalEntityId: string, proposalId: string) {
  await db.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ErpVendorPaymentProposal"
    WHERE "id" = ${proposalId}
      AND "legalEntityId" = ${legalEntityId}
    FOR UPDATE
  `);
}

async function appendEvidence(db: Db, actor: { organizationId: string; legalEntityId: string; actorEmail: string; actorRole: string }, input: {
  action: string; entity: string; entityId: string; before?: unknown; after: unknown; eventType: string;
}) {
  await db.auditEvent.create({
    data: {
      organizationId: actor.organizationId,
      actorEmail: actor.actorEmail,
      actorRole: actor.actorRole,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      ...(input.before === undefined ? {} : { before: json(input.before) }),
      after: json(input.after),
    },
  });
  const payloadHash = hashCanonical(input.after);
  await db.integrationOutboxEvent.create({
    data: {
      organizationId: actor.organizationId,
      legalEntityId: actor.legalEntityId,
      serviceId: 'mesaerp',
      aggregateType: input.entity,
      aggregateId: input.entityId,
      eventType: input.eventType,
      correlationId: randomUUID(),
      payload: json(input.after),
      payloadHash,
    },
  });
}

async function replay<T>(db: Db, organizationId: string, scope: string, key: string, requestHash: string): Promise<T | null> {
  const prior = await db.erpIdempotencyRecord.findUnique({ where: { organizationId_scope_key: { organizationId, scope, key } } });
  if (!prior) return null;
  if (prior.requestHash !== requestHash) throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was already used with another request.');
  return structuredClone(prior.response) as T;
}

async function remember(db: Db, organizationId: string, legalEntityId: string, scope: string, key: string, requestHash: string, response: unknown) {
  await db.erpIdempotencyRecord.create({ data: { organizationId, legalEntityId, scope, key, requestHash, response: json(response) } });
}

async function runEmployee<T>(legalEntityId: string, scope: string, key: string, payload: unknown, execute: (db: Db, actor: TenantCtx) => Promise<T>): Promise<T> {
  const actor = employee();
  const requestHash = hashCanonical({ legalEntityId, payload });
  return tenantTx(async (db) => {
    await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.organizationId}:${scope}:${key}`}, 0))`);
    const prior = await replay<T>(db, actor.organizationId, scope, key, requestHash);
    if (prior) return prior;
    await legalEntity(db, actor.organizationId, legalEntityId);
    const result = output(await execute(db, actor));
    await remember(db, actor.organizationId, legalEntityId, scope, key, requestHash, result);
    return result;
  });
}

async function runSupplier<T>(actor: SupplierActor, scope: string, key: string, payload: unknown, execute: (db: Db) => Promise<T>): Promise<T> {
  const qualifiedScope = `supplier:${actor.portalUserId}:${scope}`;
  const requestHash = hashCanonical({ legalEntityId: actor.legalEntityId, vendorId: actor.vendorId, payload });
  return withTenant(actor.organizationId, async (db) => {
    await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.organizationId}:${qualifiedScope}:${key}`}, 0))`);
    const prior = await replay<T>(db, actor.organizationId, qualifiedScope, key, requestHash);
    if (prior) return prior;
    const result = output(await execute(db));
    await remember(db, actor.organizationId, actor.legalEntityId, qualifiedScope, key, requestHash, result);
    return result;
  });
}

function assertVersion(actual: number, expected: number) {
  if (actual !== expected) throw new ApiError(409, 'version_conflict', 'The record changed; reload it before retrying.');
}

function assertSeparate(maker: string, checker: string, subject: string) {
  if (maker && maker === checker) throw new ApiError(409, 'maker_checker_required', `${subject} requires a different checker.`);
}

function supplierAuditActor(actor: SupplierActor) {
  return { organizationId: actor.organizationId, legalEntityId: actor.legalEntityId, actorEmail: actor.email, actorRole: 'supplier_portal' };
}

function employeeAuditActor(actor: TenantCtx, legalEntityId: string) {
  return { organizationId: actor.organizationId, legalEntityId, actorEmail: actor.email, actorRole: actor.role };
}

function performanceFor(vendorId: string, rows: {
  invitations: Array<{ vendorId: string; status: string }>;
  quotations: Array<{ vendorId: string; status: string }>;
  purchaseOrders: Array<{ vendorId: string | null; status: string }>;
  acknowledgements: Array<{ vendorId: string; status: string }>;
  receipts: Array<{ vendorId: string | null; status: string; documentDate: Date; lines: Array<{ promisedOn: Date | null }> }>;
  matches: Array<{ vendorId: string; status: string; quantityVariance: Prisma.Decimal; priceVariance: Prisma.Decimal; taxVariance: Prisma.Decimal; totalVariance: Prisma.Decimal }>;
  disputes: Array<{ vendorId: string; status: string }>;
  documents: Array<{ vendorId: string; status: string; expiresOn: Date | null }>;
}) {
  const invitations = rows.invitations.filter((row) => row.vendorId === vendorId);
  const quotations = rows.quotations.filter((row) => row.vendorId === vendorId);
  const purchaseOrders = rows.purchaseOrders.filter((row) => row.vendorId === vendorId);
  const acknowledgements = rows.acknowledgements.filter((row) => row.vendorId === vendorId);
  const receipts = rows.receipts.filter((row) => row.vendorId === vendorId);
  const matches = rows.matches.filter((row) => row.vendorId === vendorId);
  const disputes = rows.disputes.filter((row) => row.vendorId === vendorId);
  const documents = rows.documents.filter((row) => row.vendorId === vendorId);
  const datedReceipts = receipts.filter((receipt) => receipt.lines.some((line) => line.promisedOn));
  const onTimeReceipts = datedReceipts.filter((receipt) => receipt.lines.every((line) => !line.promisedOn || receipt.documentDate <= line.promisedOn));
  const asOfDate = dateOnly(new Date().toISOString().slice(0, 10));
  const upcomingThrough = new Date(asOfDate); upcomingThrough.setUTCDate(upcomingThrough.getUTCDate() + 30);
  const expiredDocuments = documents.filter((row) => row.expiresOn && row.expiresOn < asOfDate);
  const upcomingDocuments = documents.filter((row) => row.expiresOn && row.expiresOn >= asOfDate && row.expiresOn <= upcomingThrough);
  const currentVerifiedDocuments = documents.filter((row) => row.status === 'verified' && (!row.expiresOn || row.expiresOn >= asOfDate));
  const variance = (field: 'quantityVariance' | 'priceVariance' | 'taxVariance' | 'totalVariance') => matches.reduce((total, row) => total.plus(row[field]), new Prisma.Decimal(0)).toString();
  return {
    evidenceOnly: true,
    rfqs: { invited: invitations.length, responded: invitations.filter((row) => row.status === 'responded').length, selected: quotations.filter((row) => row.status === 'selected').length },
    purchaseOrders: { approved: purchaseOrders.filter((row) => row.status === 'approved').length, accepted: acknowledgements.filter((row) => row.status === 'accepted').length, changeRequested: acknowledgements.filter((row) => row.status === 'change_requested').length },
    receipts: { recorded: receipts.length, withPromisedDateEvidence: datedReceipts.length, onOrBeforePromisedDate: onTimeReceipts.length, leadTimeEvidenceStatus: datedReceipts.length ? 'available' : 'not_available' },
    matches: { total: matches.length, matched: matches.filter((row) => row.status === 'matched' || row.status === 'approved').length, varianceOrDisputed: matches.filter((row) => row.status === 'variance' || row.status === 'disputed').length, quantityVariance: variance('quantityVariance'), priceVariance: variance('priceVariance'), taxVariance: variance('taxVariance'), totalVariance: variance('totalVariance') },
    inspection: { evidenceStatus: 'not_available', acceptedQuantity: null, rejectedQuantity: null, limitation: 'Incoming inspection is not linked to accepted/rejected receipt quantities in the current evidence model.' },
    disputes: { total: disputes.length, open: disputes.filter((row) => ['open', 'vendor_response'].includes(row.status)).length, resolved: disputes.filter((row) => row.status === 'resolved').length, rejected: disputes.filter((row) => row.status === 'rejected').length },
    complianceDocuments: { total: documents.length, currentVerified: currentVerifiedDocuments.length, expired: expiredDocuments.length, upcomingExpiryWithinDays: 30, upcomingExpiry: upcomingDocuments.length, pendingReview: documents.filter((row) => row.status === 'pending').length, withoutExpiry: documents.filter((row) => !row.expiresOn).length, asOfDate: asOfDate.toISOString().slice(0, 10) },
  };
}

export class PrismaSupplierManagementService {
  hasPermission(input: PermissionCheck): Promise<boolean> { return hasMesaErpPermission(input); }

  async workspace(legalEntityId: string) {
    const actor = employee();
    return tenantTx(async (db) => {
      await legalEntity(db, actor.organizationId, legalEntityId);
      const [vendors, rfqs, agreements, purchaseOrders, acknowledgements, asns, documents, changes, disputes, proposals, invoices, receipts, matches, evidence] = await Promise.all([
        db.erpVendor.findMany({ where: { legalEntityId }, orderBy: { legalName: 'asc' }, take: 250 }),
        db.erpRfq.findMany({ where: { legalEntityId }, include: rfqInclude, orderBy: { createdAt: 'desc' }, take: 100 }),
        db.erpRateAgreement.findMany({ where: { legalEntityId }, orderBy: { createdAt: 'desc' }, take: 100 }),
        db.erpDocument.findMany({ where: { legalEntityId, documentType: 'purchase_order' }, include: { lines: { orderBy: { lineNumber: 'asc' } } }, orderBy: { documentDate: 'desc' }, take: 150 }),
        db.erpPoAcknowledgement.findMany({ where: { legalEntityId }, orderBy: { respondedAt: 'desc' }, take: 150 }),
        db.erpAdvanceShipmentNotice.findMany({ where: { legalEntityId }, orderBy: { createdAt: 'desc' }, take: 150 }),
        db.erpVendorDocument.findMany({ where: { legalEntityId }, orderBy: [{ expiresOn: 'asc' }, { createdAt: 'desc' }], take: 250 }),
        db.erpVendorChangeCase.findMany({ where: { legalEntityId }, orderBy: { createdAt: 'desc' }, take: 150 }),
        db.erpVendorDispute.findMany({ where: { legalEntityId }, orderBy: { createdAt: 'desc' }, take: 150 }),
        db.erpVendorPaymentProposal.findMany({ where: { legalEntityId }, orderBy: { createdAt: 'desc' }, take: 150 }),
        db.erpDocument.findMany({ where: { legalEntityId, documentType: 'supplier_invoice' }, orderBy: { documentDate: 'desc' }, take: 150 }),
        db.erpDocument.findMany({ where: { legalEntityId, documentType: 'goods_receipt' }, include: { lines: true }, orderBy: { documentDate: 'desc' }, take: 250 }),
        db.erpMatchCase.findMany({ where: { legalEntityId }, take: 250 }),
        db.erpSupplierInvoiceEvidence.findMany({ where: { legalEntityId }, orderBy: { createdAt: 'desc' }, take: 250 }),
      ]);
      const invitations = rfqs.flatMap((rfq) => rfq.invitations);
      const quotations = rfqs.flatMap((rfq) => rfq.quotations);
      return output({
        vendors: vendors.map((vendor) => ({ ...vendor, performance: performanceFor(vendor.id, { invitations, quotations, purchaseOrders, acknowledgements, receipts, matches, disputes, documents }) })),
        rfqs, agreements, purchaseOrders, acknowledgements, asns, documents, changes, disputes, proposals, invoices, evidence,
        controls: { binaryUploadAdapter: false, paymentStopsAtDraftVoucher: true, bankInitiation: false },
      });
    });
  }

  createRfq(legalEntityId: string, input: RfqCreate, key: string) {
    return runEmployee(legalEntityId, `supplier:rfq:create:${legalEntityId}`, key, input, async (db, actor) => {
      const vendorIds = [...new Set(input.invitedVendorIds)];
      if (vendorIds.length !== input.invitedVendorIds.length) throw new ApiError(422, 'duplicate_vendor', 'Each shortlisted vendor may appear once.');
      const vendors = await db.erpVendor.findMany({ where: { legalEntityId, id: { in: vendorIds } } });
      if (vendors.length !== vendorIds.length) throw new ApiError(422, 'vendor_not_found', 'A shortlisted vendor is not in this company.');
      if (vendors.some((vendor) => ['blocked', 'suspended'].includes(vendor.lifecycleStatus))) throw new ApiError(409, 'vendor_not_eligible', 'Blocked or suspended vendors cannot be shortlisted.');
      if (new Date(input.responseDueAt) <= new Date()) throw new ApiError(422, 'response_due_invalid', 'RFQ response deadline must be in the future.');
      const duplicate = await db.erpRfq.findFirst({ where: { legalEntityId, rfqNumber: input.rfqNumber } });
      if (duplicate) throw new ApiError(409, 'rfq_number_exists', 'RFQ number already exists.');
      const row = await db.erpRfq.create({
        data: {
          organizationId: actor.organizationId, legalEntityId, rfqNumber: input.rfqNumber, title: input.title,
          description: input.description, currency: input.currency, responseDueAt: new Date(input.responseDueAt),
          commercialTerms: json(input.commercialTerms), technicalTerms: json(input.technicalTerms), createdBy: actor.membershipId,
          createIdempotencyKey: key, requestHash: hashCanonical(input),
          lines: { create: input.lines.map((line, index) => ({ organizationId: actor.organizationId, legalEntityId, lineNumber: index + 1, itemId: line.itemId ?? null, description: line.description, quantity: line.quantity, uom: line.uom, requiredOn: line.requiredOn ? dateOnly(line.requiredOn) : null, technicalSpecification: json(line.technicalSpecification) })) },
          invitations: { create: vendorIds.map((vendorId) => ({ organizationId: actor.organizationId, legalEntityId, vendorId })) },
        }, include: rfqInclude,
      });
      await appendEvidence(db, employeeAuditActor(actor, legalEntityId), { action: 'supplier.rfq.create', entity: 'ErpRfq', entityId: row.id, after: row, eventType: 'mesaerp.supplier.rfq.created.v1' });
      return row;
    });
  }

  issueRfq(legalEntityId: string, rfqId: string, input: RfqIssue, key: string) {
    return runEmployee(legalEntityId, `supplier:rfq:${rfqId}:issue`, key, input, async (db, actor) => {
      await lockRfq(db, legalEntityId, rfqId);
      const rfq = await db.erpRfq.findFirst({ where: { id: rfqId, legalEntityId }, include: rfqInclude });
      if (!rfq) throw new ApiError(404, 'rfq_not_found', 'RFQ not found.');
      assertVersion(rfq.rowVersion, input.expectedRowVersion);
      if (rfq.status !== 'draft') throw new ApiError(409, 'rfq_not_draft', 'Only a draft RFQ can be issued.');
      assertSeparate(rfq.createdBy, actor.membershipId, 'RFQ issue');
      if (rfq.responseDueAt <= new Date()) throw new ApiError(409, 'rfq_expired', 'Response deadline must be extended before issue.');
      const changed = await db.erpRfq.updateMany({
        where: { id: rfq.id, legalEntityId, status: 'draft', rowVersion: input.expectedRowVersion },
        data: { status: 'issued', issuedBy: actor.membershipId, issuedAt: new Date(), rowVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'RFQ changed while issue was being saved.');
      await db.erpRfqInvitation.updateMany({ where: { rfqId: rfq.id }, data: { status: 'issued', issuedAt: new Date() } });
      const updated = await db.erpRfq.findUniqueOrThrow({ where: { id: rfq.id }, include: rfqInclude });
      await appendEvidence(db, employeeAuditActor(actor, legalEntityId), { action: 'supplier.rfq.issue', entity: 'ErpRfq', entityId: rfq.id, before: rfq, after: updated, eventType: 'mesaerp.supplier.rfq.issued.v1' });
      return updated;
    });
  }

  selectQuotation(legalEntityId: string, rfqId: string, input: RfqSelect, key: string) {
    return runEmployee(legalEntityId, `supplier:rfq:${rfqId}:select`, key, input, async (db, actor) => {
      await lockRfq(db, legalEntityId, rfqId);
      const rfq = await db.erpRfq.findFirst({ where: { id: rfqId, legalEntityId }, include: rfqInclude });
      if (!rfq) throw new ApiError(404, 'rfq_not_found', 'RFQ not found.');
      assertVersion(rfq.rowVersion, input.expectedRowVersion);
      if (rfq.status !== 'issued') throw new ApiError(409, 'rfq_not_selectable', 'Only an issued RFQ can be awarded.');
      assertSeparate(rfq.createdBy, actor.membershipId, 'RFQ selection');
      const quotation = rfq.quotations.find((candidate) => candidate.id === input.quotationId && candidate.status === 'submitted');
      if (!quotation) throw new ApiError(422, 'quotation_not_selectable', 'Submitted quotation does not belong to this RFQ.');
      await db.erpSupplierQuotation.updateMany({ where: { rfqId, status: 'submitted', id: { not: quotation.id } }, data: { status: 'rejected', rowVersion: { increment: 1 } } });
      const selected = await db.erpSupplierQuotation.updateMany({
        where: { id: quotation.id, rfqId, status: 'submitted', rowVersion: quotation.rowVersion },
        data: { status: 'selected', rowVersion: { increment: 1 } },
      });
      if (selected.count !== 1) throw new ApiError(409, 'version_conflict', 'The selected quotation changed while the award was being saved.');
      const awarded = await db.erpRfq.updateMany({
        where: { id: rfq.id, legalEntityId, status: 'issued', rowVersion: input.expectedRowVersion },
        data: { status: 'awarded', selectedQuotationId: quotation.id, selectedBy: actor.membershipId, selectedAt: new Date(), rowVersion: { increment: 1 } },
      });
      if (awarded.count !== 1) throw new ApiError(409, 'version_conflict', 'RFQ changed while the award was being saved.');
      let agreement = null;
      if (input.agreement) {
        if (input.agreement.validUntil < input.agreement.validFrom) throw new ApiError(422, 'agreement_dates_invalid', 'Agreement end date cannot precede its start date.');
        agreement = await db.erpRateAgreement.create({ data: { organizationId: actor.organizationId, legalEntityId, vendorId: quotation.vendorId, rfqId, quotationId: quotation.id, agreementNumber: input.agreement.agreementNumber, currency: quotation.currency, validFrom: dateOnly(input.agreement.validFrom), validUntil: dateOnly(input.agreement.validUntil), lines: json(quotation.lines.map((line) => ({ rfqLineId: line.rfqLineId, quantity: line.quantity.toString(), unitRate: line.unitRate.toString(), taxRate: line.taxRate.toString() }))), terms: json(input.agreement.terms), createdBy: actor.membershipId, createIdempotencyKey: `${key}:agreement`, requestHash: hashCanonical(input.agreement) } });
      }
      const updated = await db.erpRfq.findUniqueOrThrow({ where: { id: rfq.id }, include: rfqInclude });
      await appendEvidence(db, employeeAuditActor(actor, legalEntityId), { action: 'supplier.rfq.select', entity: 'ErpRfq', entityId: rfq.id, before: rfq, after: { rfq: updated, quotationId: quotation.id, selectionReason: input.selectionReason, agreement }, eventType: 'mesaerp.supplier.rfq.awarded.v1' });
      return { rfq: updated, agreement };
    });
  }

  activateAgreement(legalEntityId: string, agreementId: string, input: AgreementActivate, key: string) {
    return runEmployee(legalEntityId, `supplier:agreement:${agreementId}:activate`, key, input, async (db, actor) => {
      await lockRateAgreement(db, legalEntityId, agreementId);
      const row = await db.erpRateAgreement.findFirst({ where: { id: agreementId, legalEntityId } });
      if (!row) throw new ApiError(404, 'agreement_not_found', 'Rate agreement not found.');
      assertVersion(row.rowVersion, input.expectedRowVersion);
      if (row.status !== 'draft') throw new ApiError(409, 'agreement_not_draft', 'Only a draft agreement can be activated.');
      assertSeparate(row.createdBy, actor.membershipId, 'Rate agreement activation');
      const changed = await db.erpRateAgreement.updateMany({
        where: { id: row.id, legalEntityId, status: 'draft', rowVersion: input.expectedRowVersion },
        data: { status: 'active', activatedBy: actor.membershipId, activatedAt: new Date(), rowVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Rate agreement changed while activation was being saved.');
      const updated = await db.erpRateAgreement.findUniqueOrThrow({ where: { id: row.id } });
      await appendEvidence(db, employeeAuditActor(actor, legalEntityId), { action: 'supplier.agreement.activate', entity: 'ErpRateAgreement', entityId: row.id, before: row, after: { ...updated, reason: input.reason }, eventType: 'mesaerp.supplier.rate_agreement.activated.v1' });
      return updated;
    });
  }

  async invitePortalUser(legalEntityId: string, vendorId: string, input: PortalInviteCreate, key: string) {
    const actor = employee();
    const requestHash = hashCanonical({ legalEntityId, vendorId, input });
    return tenantTx(async (db) => {
      await legalEntity(db, actor.organizationId, legalEntityId);
      const prior = await db.supplierPortalInvite.findUnique({ where: { organizationId_idempotencyKey: { organizationId: actor.organizationId, idempotencyKey: key } } });
      if (prior) {
        if (prior.requestHash !== requestHash) throw new ApiError(409, 'idempotency_conflict', 'This key was used for a different invitation.');
        return { id: prior.id, expiresAt: prior.expiresAt.toISOString(), token: null, invitePath: null, replayed: true };
      }
      const vendor = await db.erpVendor.findFirst({ where: { id: vendorId, legalEntityId } });
      if (!vendor) throw new ApiError(404, 'vendor_not_found', 'Vendor not found.');
      if (!supplierPortalLifecycleAllowed(vendor.lifecycleStatus)) throw new ApiError(409, 'vendor_blocked', 'Blocked or suspended vendors cannot receive portal access.');
      const portalUser = await db.supplierPortalUser.upsert({
        where: { organizationId_legalEntityId_vendorId_email: { organizationId: actor.organizationId, legalEntityId, vendorId, email: input.email } },
        create: { organizationId: actor.organizationId, legalEntityId, vendorId, email: input.email, name: input.name, permissions: json(input.permissions), status: 'invited' },
        update: { name: input.name, permissions: json(input.permissions), status: 'invited' },
      });
      const token = rawToken();
      const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);
      const invite = await db.supplierPortalInvite.create({ data: { organizationId: actor.organizationId, legalEntityId, vendorId, portalUserId: portalUser.id, tokenHash: tokenHash(token), expiresAt, createdBy: actor.membershipId, idempotencyKey: key, requestHash } });
      await appendEvidence(db, employeeAuditActor(actor, legalEntityId), { action: 'supplier.portal.invite', entity: 'SupplierPortalUser', entityId: portalUser.id, after: { inviteId: invite.id, vendorId, email: input.email, expiresAt, permissions: input.permissions }, eventType: 'mesaerp.supplier.portal.invited.v1' });
      return { id: invite.id, expiresAt: expiresAt.toISOString(), token, invitePath: supplierInvitePath(token), replayed: false };
    });
  }

  addVendorDocument(legalEntityId: string, vendorId: string, input: VendorDocumentCreate, key: string) {
    return runEmployee(legalEntityId, `supplier:vendor:${vendorId}:document:create`, key, input, async (db, actor) => {
      const vendor = await db.erpVendor.findFirst({ where: { id: vendorId, legalEntityId } });
      if (!vendor) throw new ApiError(404, 'vendor_not_found', 'Vendor not found.');
      const row = await db.erpVendorDocument.create({ data: { organizationId: actor.organizationId, legalEntityId, vendorId, documentType: input.documentType, documentNumber: input.documentNumber, issuedOn: input.issuedOn ? dateOnly(input.issuedOn) : null, expiresOn: input.expiresOn ? dateOnly(input.expiresOn) : null, storageRef: input.storageRef, checksum: input.checksum, metadata: json({ ...input.metadata, submittedBy: actor.membershipId }), createIdempotencyKey: key, requestHash: hashCanonical(input) } });
      await appendEvidence(db, employeeAuditActor(actor, legalEntityId), { action: 'supplier.document.register', entity: 'ErpVendorDocument', entityId: row.id, after: row, eventType: 'mesaerp.supplier.document.registered.v1' });
      return row;
    });
  }

  reviewVendorDocument(legalEntityId: string, vendorId: string, documentId: string, input: VendorDocumentReview, key: string) {
    return runEmployee(legalEntityId, `supplier:vendor:${vendorId}:document:${documentId}:review`, key, input, async (db, actor) => {
      const row = await db.erpVendorDocument.findFirst({ where: { id: documentId, vendorId, legalEntityId } });
      if (!row) throw new ApiError(404, 'vendor_document_not_found', 'Vendor document not found.');
      assertVersion(row.rowVersion, input.expectedRowVersion);
      const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {};
      assertSeparate(typeof metadata.submittedBy === 'string' ? metadata.submittedBy : '', actor.membershipId, 'Vendor document review');
      const updated = await db.erpVendorDocument.update({ where: { id: row.id }, data: { status: input.decision, reviewedBy: actor.membershipId, reviewedAt: new Date(), metadata: json({ ...metadata, reviewReason: input.reason }), rowVersion: { increment: 1 } } });
      await appendEvidence(db, employeeAuditActor(actor, legalEntityId), { action: 'supplier.document.review', entity: 'ErpVendorDocument', entityId: row.id, before: row, after: updated, eventType: 'mesaerp.supplier.document.reviewed.v1' });
      return updated;
    });
  }

  decideVendorChange(legalEntityId: string, caseId: string, input: VendorChangeDecision, key: string) {
    return runEmployee(legalEntityId, `supplier:change:${caseId}:decide`, key, input, async (db, actor) => {
      await lockVendorChangeCase(db, legalEntityId, caseId);
      const row = await db.erpVendorChangeCase.findFirst({ where: { id: caseId, legalEntityId } });
      if (!row) throw new ApiError(404, 'vendor_change_not_found', 'Vendor change case not found.');
      assertVersion(row.rowVersion, input.expectedRowVersion);
      if (row.status !== 'pending') throw new ApiError(409, 'vendor_change_decided', 'This change case already has a decision.');
      if (input.decision === 'approved') {
        const values = row.proposedValues as Record<string, unknown>;
        if (row.changeType === 'profile') {
          const allowed = ['tradeName', 'addresses', 'contacts', 'paymentTerms'] as const;
          const update = Object.fromEntries(allowed.filter((field) => values[field] !== undefined).map((field) => [field, values[field]]));
          await db.erpVendor.update({ where: { id: row.vendorId }, data: update });
        } else if (row.changeType === 'legal' && typeof values.legalName === 'string') {
          await db.erpVendor.update({ where: { id: row.vendorId }, data: { legalName: values.legalName } });
        } else if (row.changeType === 'gstin' && typeof values.gstin === 'string') {
          await db.erpVendor.update({ where: { id: row.vendorId }, data: { gstin: values.gstin } });
        }
        // Bank cases intentionally never alter a verified payable account. An
        // employee must use the encrypted bank-account maker/checker workflow.
      }
      const changed = await db.erpVendorChangeCase.updateMany({
        where: { id: row.id, legalEntityId, status: 'pending', rowVersion: input.expectedRowVersion },
        data: { status: input.decision, decisionReason: input.reason, decidedBy: actor.membershipId, decidedAt: new Date(), rowVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Vendor change case changed while the decision was being saved.');
      const updated = await db.erpVendorChangeCase.findUniqueOrThrow({ where: { id: row.id } });
      await appendEvidence(db, employeeAuditActor(actor, legalEntityId), { action: 'supplier.change.decide', entity: 'ErpVendorChangeCase', entityId: row.id, before: row, after: { ...updated, bankPayableChanged: false }, eventType: 'mesaerp.supplier.change.decided.v1' });
      return { ...updated, bankPayableChanged: false };
    });
  }

  createDispute(legalEntityId: string, input: DisputeCreate, key: string) {
    return runEmployee(legalEntityId, `supplier:dispute:create:${legalEntityId}`, key, input, async (db, actor) => {
      const vendor = await db.erpVendor.findFirst({ where: { id: input.vendorId, legalEntityId } });
      if (!vendor) throw new ApiError(404, 'vendor_not_found', 'Vendor not found.');
      if (input.supplierInvoiceId) {
        const invoice = await db.erpDocument.findFirst({ where: { id: input.supplierInvoiceId, legalEntityId, documentType: 'supplier_invoice', vendorId: input.vendorId } });
        if (!invoice) throw new ApiError(422, 'supplier_invoice_invalid', 'Supplier invoice is not owned by this vendor.');
      }
      if (input.matchCaseId) {
        const matchCase = await db.erpMatchCase.findFirst({
          where: {
            id: input.matchCaseId,
            organizationId: actor.organizationId,
            legalEntityId,
            vendorId: input.vendorId,
          },
        });
        if (!matchCase) throw new ApiError(422, 'match_case_invalid', 'Purchase match case is not owned by this vendor and company.');
        if (input.supplierInvoiceId && matchCase.supplierInvoiceId !== input.supplierInvoiceId) {
          throw new ApiError(422, 'match_case_invoice_mismatch', 'Purchase match case does not belong to the selected supplier invoice.');
        }
      }
      const row = await db.erpVendorDispute.create({ data: { organizationId: actor.organizationId, legalEntityId, vendorId: input.vendorId, supplierInvoiceId: input.supplierInvoiceId ?? null, matchCaseId: input.matchCaseId ?? null, subject: input.subject, description: input.description, requestedDebitAmount: input.requestedDebitAmount, createdByActorType: 'employee', createdByRef: actor.membershipId, createIdempotencyKey: key, requestHash: hashCanonical(input) } });
      await appendEvidence(db, employeeAuditActor(actor, legalEntityId), { action: 'supplier.dispute.create', entity: 'ErpVendorDispute', entityId: row.id, after: row, eventType: 'mesaerp.supplier.dispute.opened.v1' });
      return row;
    });
  }

  resolveDispute(legalEntityId: string, disputeId: string, input: DisputeResolve, key: string) {
    return runEmployee(legalEntityId, `supplier:dispute:${disputeId}:resolve`, key, input, async (db, actor) => {
      await lockVendorDispute(db, legalEntityId, disputeId);
      const row = await db.erpVendorDispute.findFirst({ where: { id: disputeId, legalEntityId } });
      if (!row) throw new ApiError(404, 'dispute_not_found', 'Dispute not found.');
      assertVersion(row.rowVersion, input.expectedRowVersion);
      if (!['open', 'vendor_response'].includes(row.status)) throw new ApiError(409, 'dispute_not_open', 'Only an open dispute can be decided.');
      if (row.createdByActorType === 'employee') assertSeparate(row.createdByRef, actor.membershipId, 'Dispute resolution');
      const changed = await db.erpVendorDispute.updateMany({
        where: { id: row.id, legalEntityId, status: { in: ['open', 'vendor_response'] }, rowVersion: input.expectedRowVersion },
        data: { status: input.decision, resolution: input.resolution, resolvedBy: actor.membershipId, resolvedAt: new Date(), rowVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Dispute changed while the resolution was being saved.');
      const updated = await db.erpVendorDispute.findUniqueOrThrow({ where: { id: row.id } });
      await appendEvidence(db, employeeAuditActor(actor, legalEntityId), { action: 'supplier.dispute.resolve', entity: 'ErpVendorDispute', entityId: row.id, before: row, after: updated, eventType: 'mesaerp.supplier.dispute.resolved.v1' });
      return updated;
    });
  }

  createPaymentProposal(legalEntityId: string, input: PaymentProposalCreate, key: string) {
    return runEmployee(legalEntityId, `supplier:payment-proposal:create:${legalEntityId}`, key, input, async (db, actor) => {
      // Every proposal creator locks the invoice before reading the aggregate.
      // Different idempotency keys therefore cannot over-allocate in parallel.
      await lockSupplierInvoice(db, legalEntityId, input.supplierInvoiceId);
      const invoice = await db.erpDocument.findFirst({ where: { id: input.supplierInvoiceId, legalEntityId, documentType: 'supplier_invoice', vendorId: input.vendorId } });
      if (!invoice) throw new ApiError(422, 'supplier_invoice_invalid', 'Approved supplier invoice is not owned by this vendor.');
      if (!['approved', 'posted'].includes(invoice.status)) throw new ApiError(409, 'supplier_invoice_not_approved', 'Supplier invoice must be approved before payment proposal.');
      await requireSupplierInvoiceReleaseMatch(db, {
        organizationId: actor.organizationId,
        legalEntityId,
        supplierInvoiceId: invoice.id,
        vendorId: invoice.vendorId,
      });
      const entity = await legalEntity(db, actor.organizationId, legalEntityId);
      assertPaymentCurrency(input.currency, invoice.currency, entity.baseCurrency);
      const amount = new Prisma.Decimal(input.amount);
      const allocated = await db.erpVendorPaymentProposal.aggregate({ where: { supplierInvoiceId: invoice.id, status: { in: ['draft', 'approved'] } }, _sum: { amount: true } });
      if (amount.plus(allocated._sum.amount ?? 0).greaterThan(invoice.grandTotal)) throw new ApiError(422, 'payment_exceeds_invoice', 'Open payment proposals exceed the supplier invoice total.');
      const accounts = await db.erpAccount.findMany({ where: { legalEntityId, id: { in: [input.payableAccountId, input.settlementAccountId] }, active: true, allowPosting: true } });
      const payable = accounts.find((account) => account.id === input.payableAccountId);
      const settlement = accounts.find((account) => account.id === input.settlementAccountId);
      if (!payable || payable.accountType !== 'liability') throw new ApiError(422, 'payable_account_invalid', 'Payable account must be an active postable liability.');
      if (!settlement || settlement.accountType !== 'asset') throw new ApiError(422, 'settlement_account_invalid', 'Settlement account must be an active postable asset.');
      const row = await db.erpVendorPaymentProposal.create({ data: { organizationId: actor.organizationId, legalEntityId, vendorId: input.vendorId, supplierInvoiceId: input.supplierInvoiceId, proposalNumber: input.proposalNumber, amount: input.amount, currency: input.currency, proposedPaymentOn: dateOnly(input.proposedPaymentOn), payableAccountId: input.payableAccountId, settlementAccountId: input.settlementAccountId, narration: input.narration, createdBy: actor.membershipId, createIdempotencyKey: key, requestHash: hashCanonical(input) } });
      await appendEvidence(db, employeeAuditActor(actor, legalEntityId), { action: 'supplier.payment_proposal.create', entity: 'ErpVendorPaymentProposal', entityId: row.id, after: row, eventType: 'mesaerp.supplier.payment_proposal.created.v1' });
      return row;
    });
  }

  approvePaymentProposal(legalEntityId: string, proposalId: string, input: PaymentProposalApprove, key: string) {
    return runEmployee(legalEntityId, `supplier:payment-proposal:${proposalId}:approve`, key, input, async (db, actor) => {
      const candidate = await db.erpVendorPaymentProposal.findFirst({ where: { id: proposalId, legalEntityId } });
      if (!candidate) throw new ApiError(404, 'payment_proposal_not_found', 'Payment proposal not found.');
      // Use invoice-first lock ordering in creation and approval so aggregate
      // allocation and state transitions stay serializable without a schema lock.
      await lockSupplierInvoice(db, legalEntityId, candidate.supplierInvoiceId);
      await lockPaymentProposal(db, legalEntityId, proposalId);
      const proposal = await db.erpVendorPaymentProposal.findFirst({ where: { id: proposalId, legalEntityId } });
      if (!proposal) throw new ApiError(404, 'payment_proposal_not_found', 'Payment proposal not found.');
      assertVersion(proposal.rowVersion, input.expectedRowVersion);
      if (proposal.status !== 'draft') throw new ApiError(409, 'payment_proposal_not_draft', 'Only a draft proposal can be approved.');
      assertSeparate(proposal.createdBy, actor.membershipId, 'Payment proposal approval');
      const invoice = await db.erpDocument.findFirst({
        where: {
          id: proposal.supplierInvoiceId,
          legalEntityId,
          documentType: 'supplier_invoice',
          vendorId: proposal.vendorId,
          status: { in: ['approved', 'posted'] },
        },
      });
      if (!invoice) throw new ApiError(409, 'supplier_invoice_unavailable', 'Supplier invoice is no longer eligible for payment.');
      await requireSupplierInvoiceReleaseMatch(db, {
        organizationId: actor.organizationId,
        legalEntityId,
        supplierInvoiceId: invoice.id,
        vendorId: invoice.vendorId,
      });
      const entity = await legalEntity(db, actor.organizationId, legalEntityId);
      assertPaymentCurrency(proposal.currency, invoice.currency, entity.baseCurrency);
      const allocated = await db.erpVendorPaymentProposal.aggregate({
        where: { supplierInvoiceId: invoice.id, status: { in: ['draft', 'approved'] } },
        _sum: { amount: true },
      });
      if (new Prisma.Decimal(allocated._sum.amount ?? 0).greaterThan(invoice.grandTotal)) {
        throw new ApiError(422, 'payment_exceeds_invoice', 'Open payment proposals exceed the supplier invoice total.');
      }
      const voucherDate = dateOnly(input.voucherDate);
      const year = await db.financialYear.findFirst({ where: { legalEntityId, startsOn: { lte: voucherDate }, endsOn: { gte: voucherDate } } });
      if (!year || year.status === 'locked') throw new ApiError(409, 'financial_year_unavailable', 'Voucher date is outside an open financial year.');
      const period = await db.accountingPeriod.findFirst({ where: { legalEntityId, financialYearId: year.id, startsOn: { lte: voucherDate }, endsOn: { gte: voucherDate } } });
      if (!period || period.status === 'locked') throw new ApiError(409, 'accounting_period_unavailable', 'Voucher date is outside an open accounting period.');
      const accounts = await db.erpAccount.findMany({ where: { id: { in: [proposal.payableAccountId, proposal.settlementAccountId] }, legalEntityId, active: true, allowPosting: true } });
      const payable = accounts.find((account) => account.id === proposal.payableAccountId);
      const settlement = accounts.find((account) => account.id === proposal.settlementAccountId);
      if (!payable || payable.accountType !== 'liability') throw new ApiError(409, 'payable_account_unavailable', 'Payable account is no longer an active postable liability.');
      if (!settlement || settlement.accountType !== 'asset') throw new ApiError(409, 'settlement_account_unavailable', 'Settlement account is no longer an active postable asset.');
      const voucher = await db.erpVoucher.create({
        data: {
          organizationId: actor.organizationId, legalEntityId, financialYearId: year.id, accountingPeriodId: period.id,
          voucherType: 'payment', voucherNumber: `PAY-${proposal.proposalNumber}`, businessDate: voucherDate,
          currency: proposal.currency, transactionDebit: proposal.amount, transactionCredit: proposal.amount,
          baseDebit: proposal.amount, baseCredit: proposal.amount, reference: proposal.proposalNumber,
          narration: proposal.narration || `Draft payment for proposal ${proposal.proposalNumber}`,
          sourceDocumentId: proposal.supplierInvoiceId, originType: 'payment_proposal',
          originMetadata: json({ paymentProposalId: proposal.id, vendorId: proposal.vendorId, approvalReason: input.reason }),
          sourceSnapshotHash: hashCanonical(proposal), createIdempotencyKey: `payment-proposal:${proposal.id}`,
          requestHash: hashCanonical({ proposalId, input }), createdBy: actor.membershipId,
          lines: { create: [
            { organizationId: actor.organizationId, legalEntityId, lineNumber: 1, accountId: payable.id, accountSnapshot: json({ code: payable.code, name: payable.name }), transactionDebit: proposal.amount, baseDebit: proposal.amount, billReference: proposal.proposalNumber, narration: proposal.narration },
            { organizationId: actor.organizationId, legalEntityId, lineNumber: 2, accountId: settlement.id, accountSnapshot: json({ code: settlement.code, name: settlement.name }), transactionCredit: proposal.amount, baseCredit: proposal.amount, billReference: proposal.proposalNumber, narration: proposal.narration },
          ] },
        }, include: { lines: true },
      });
      const changed = await db.erpVendorPaymentProposal.updateMany({
        where: { id: proposal.id, legalEntityId, status: 'draft', rowVersion: input.expectedRowVersion },
        data: { status: 'approved', paymentVoucherId: voucher.id, approvedBy: actor.membershipId, approvedAt: new Date(), rowVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Payment proposal changed while approval was being saved.');
      const updated = await db.erpVendorPaymentProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      await appendEvidence(db, employeeAuditActor(actor, legalEntityId), { action: 'supplier.payment_proposal.approve', entity: 'ErpVendorPaymentProposal', entityId: proposal.id, before: proposal, after: { proposal: updated, voucher: { id: voucher.id, status: voucher.status, voucherNumber: voucher.voucherNumber } }, eventType: 'mesaerp.supplier.payment_proposal.approved.v1' });
      return { proposal: updated, draftVoucher: voucher, bankInitiated: false };
    });
  }
}

export class PrismaSupplierPortalService {
  async acceptInvite(token: string) {
    const digest = tokenHash(token);
    // The first lookup resolves the opaque token to a tenant only. All decisive
    // lifecycle and single-use checks are repeated under a row lock below.
    const candidate = await basePrisma.supplierPortalInvite.findUnique({ where: { tokenHash: digest } });
    if (!candidate) throw new ApiError(404, 'supplier_invite_not_found', 'Invitation is invalid.');
    const result = await withTenant(candidate.organizationId, async (db) => {
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplierPortalInvite" WHERE "id" = ${candidate.id} FOR UPDATE`);
      const invite = await db.supplierPortalInvite.findUnique({ where: { id: candidate.id } });
      if (!invite || invite.tokenHash !== digest) throw new ApiError(404, 'supplier_invite_not_found', 'Invitation is invalid.');
      if (invite.revokedAt) throw new ApiError(410, 'supplier_invite_revoked', 'Invitation was revoked.');
      if (invite.usedAt) throw new ApiError(410, 'supplier_invite_used', 'Invitation was already accepted.');
      const now = new Date();
      if (invite.expiresAt <= now) throw new ApiError(410, 'supplier_invite_expired', 'Invitation expired.');
      const entitlement = await db.organizationService.findFirst({
        where: {
          organizationId: invite.organizationId,
          serviceId: 'mesaerp',
          status: 'active',
          service: { status: 'active' },
          organization: { status: { not: 'suspended' } },
        },
      });
      if (!entitlement) throw new ApiError(403, 'service_not_entitled', 'Supplier portal is unavailable for this organization.');
      const entity = await db.legalEntity.findFirst({ where: { id: invite.legalEntityId, organizationId: invite.organizationId, status: 'active' } });
      if (!entity) throw new ApiError(403, 'supplier_access_denied', 'Supplier company is inactive.');
      const portalUser = await db.supplierPortalUser.findFirst({ where: { id: invite.portalUserId, organizationId: invite.organizationId, legalEntityId: invite.legalEntityId, vendorId: invite.vendorId } });
      if (!portalUser || ['suspended', 'revoked'].includes(portalUser.status)) throw new ApiError(403, 'supplier_access_denied', 'Supplier portal user is unavailable.');
      const vendor = await db.erpVendor.findFirst({ where: { id: invite.vendorId, organizationId: invite.organizationId, legalEntityId: invite.legalEntityId } });
      if (!vendor || !supplierPortalLifecycleAllowed(vendor.lifecycleStatus)) throw new ApiError(403, 'supplier_access_denied', 'Vendor portal access is unavailable.');
      const consumed = await db.supplierPortalInvite.updateMany({
        where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw new ApiError(410, 'supplier_invite_used', 'Invitation is no longer available.');
      const sessionToken = rawToken();
      const sessionExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
      const session = await db.supplierPortalSession.create({ data: { organizationId: invite.organizationId, legalEntityId: invite.legalEntityId, vendorId: invite.vendorId, portalUserId: portalUser.id, tokenHash: tokenHash(sessionToken), expiresAt: sessionExpiresAt } });
      await db.supplierPortalUser.update({ where: { id: portalUser.id }, data: { status: 'active', lastSeenAt: new Date() } });
      await appendEvidence(db, { organizationId: invite.organizationId, legalEntityId: invite.legalEntityId, actorEmail: portalUser.email, actorRole: 'supplier_portal' }, { action: 'supplier.portal.accept', entity: 'SupplierPortalUser', entityId: portalUser.id, after: { sessionId: session.id, vendorId: invite.vendorId }, eventType: 'mesaerp.supplier.portal.accepted.v1' });
      return { user: { id: portalUser.id, email: portalUser.email, name: portalUser.name, vendorId: portalUser.vendorId, legalEntityId: portalUser.legalEntityId, permissions: portalUser.permissions }, expiresAt: sessionExpiresAt.toISOString(), sessionToken };
    });
    return output(result);
  }

  async logout(actor: SupplierActor, sessionHash: string) {
    await basePrisma.supplierPortalSession.updateMany({ where: { tokenHash: sessionHash, portalUserId: actor.portalUserId }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  async workspace(actor: SupplierActor) {
    return withTenant(actor.organizationId, async (db) => {
      const [vendor, documents, invitations, purchaseOrders, acknowledgements, asns, invoices, evidence, changes, disputes, proposals] = await Promise.all([
        db.erpVendor.findFirst({ where: { id: actor.vendorId, legalEntityId: actor.legalEntityId } }),
        db.erpVendorDocument.findMany({ where: { vendorId: actor.vendorId, legalEntityId: actor.legalEntityId }, orderBy: [{ expiresOn: 'asc' }, { createdAt: 'desc' }] }),
        db.erpRfqInvitation.findMany({ where: { vendorId: actor.vendorId, status: { in: ['issued', 'viewed', 'responded'] } }, include: { rfq: { include: { lines: { orderBy: { lineNumber: 'asc' } }, quotations: { where: { vendorId: actor.vendorId }, include: { lines: true } } } } }, orderBy: { issuedAt: 'desc' } }),
        db.erpDocument.findMany({ where: { legalEntityId: actor.legalEntityId, vendorId: actor.vendorId, documentType: 'purchase_order', status: 'approved' }, include: { lines: { orderBy: { lineNumber: 'asc' } } }, orderBy: { documentDate: 'desc' } }),
        db.erpPoAcknowledgement.findMany({ where: { legalEntityId: actor.legalEntityId, vendorId: actor.vendorId }, orderBy: { respondedAt: 'desc' } }),
        db.erpAdvanceShipmentNotice.findMany({ where: { legalEntityId: actor.legalEntityId, vendorId: actor.vendorId }, orderBy: { createdAt: 'desc' } }),
        db.erpDocument.findMany({ where: { legalEntityId: actor.legalEntityId, vendorId: actor.vendorId, documentType: 'supplier_invoice' }, select: { id: true, documentNumber: true, documentDate: true, dueDate: true, status: true, currency: true, grandTotal: true, rowVersion: true }, orderBy: { documentDate: 'desc' } }),
        db.erpSupplierInvoiceEvidence.findMany({ where: { legalEntityId: actor.legalEntityId, vendorId: actor.vendorId }, orderBy: { createdAt: 'desc' } }),
        db.erpVendorChangeCase.findMany({ where: { legalEntityId: actor.legalEntityId, vendorId: actor.vendorId }, orderBy: { createdAt: 'desc' } }),
        db.erpVendorDispute.findMany({ where: { legalEntityId: actor.legalEntityId, vendorId: actor.vendorId }, orderBy: { createdAt: 'desc' } }),
        db.erpVendorPaymentProposal.findMany({ where: { legalEntityId: actor.legalEntityId, vendorId: actor.vendorId }, select: { id: true, proposalNumber: true, supplierInvoiceId: true, status: true, amount: true, currency: true, proposedPaymentOn: true, approvedAt: true, paymentVoucher: { select: { status: true } } }, orderBy: { createdAt: 'desc' } }),
      ]);
      if (!vendor) throw new ApiError(403, 'supplier_access_denied', 'Vendor portal access is unavailable.');
      return output({
        user: { id: actor.portalUserId, name: actor.name, email: actor.email, permissions: actor.permissions },
        vendor: { id: vendor.id, vendorCode: vendor.vendorCode, legalName: vendor.legalName, tradeName: vendor.tradeName, gstin: vendor.gstin, addresses: vendor.addresses, contacts: vendor.contacts, paymentTerms: vendor.paymentTerms, currency: vendor.currency, lifecycleStatus: vendor.lifecycleStatus, complianceStatus: vendor.complianceStatus },
        documents, rfqInvitations: invitations, purchaseOrders, acknowledgements, asns, supplierInvoices: invoices, invoiceEvidence: evidence, changeCases: changes, disputes, paymentStatus: proposals,
        controls: { otherVendorsVisible: false, employeeApisVisible: false, financeJournalsVisible: false, binaryUploadAdapter: false },
      });
    });
  }

  requestChange(actor: SupplierActor, input: PortalChangeCreate, key: string) {
    return runSupplier(actor, 'profile-change:create', key, input, async (db) => {
      if (input.changeType === 'bank' && Object.keys(input.proposedValues).some((field) => /accountnumber|iban/i.test(field) && !/masked/i.test(field))) {
        throw new ApiError(422, 'plaintext_bank_data_forbidden', 'Do not submit a full bank account number; register masked details and evidence for the encrypted internal workflow.');
      }
      const row = await db.erpVendorChangeCase.create({ data: { organizationId: actor.organizationId, legalEntityId: actor.legalEntityId, vendorId: actor.vendorId, portalUserId: actor.portalUserId, changeType: input.changeType, proposedValues: json(input.proposedValues), createIdempotencyKey: key, requestHash: hashCanonical(input) } });
      await appendEvidence(db, supplierAuditActor(actor), { action: 'supplier.change.request', entity: 'ErpVendorChangeCase', entityId: row.id, after: row, eventType: 'mesaerp.supplier.change.requested.v1' });
      return row;
    });
  }

  addDocument(actor: SupplierActor, input: VendorDocumentCreate, key: string) {
    return runSupplier(actor, 'document:create', key, input, async (db) => {
      const row = await db.erpVendorDocument.create({ data: { organizationId: actor.organizationId, legalEntityId: actor.legalEntityId, vendorId: actor.vendorId, submittedByPortalUserId: actor.portalUserId, documentType: input.documentType, documentNumber: input.documentNumber, issuedOn: input.issuedOn ? dateOnly(input.issuedOn) : null, expiresOn: input.expiresOn ? dateOnly(input.expiresOn) : null, storageRef: input.storageRef, checksum: input.checksum, metadata: json(input.metadata), createIdempotencyKey: key, requestHash: hashCanonical(input) } });
      await appendEvidence(db, supplierAuditActor(actor), { action: 'supplier.document.register', entity: 'ErpVendorDocument', entityId: row.id, after: row, eventType: 'mesaerp.supplier.document.registered.v1' });
      return row;
    });
  }

  submitQuotation(actor: SupplierActor, rfqId: string, input: SupplierQuotationCreate, key: string) {
    return runSupplier(actor, `rfq:${rfqId}:quotation:create`, key, input, async (db) => {
      await lockRfq(db, actor.legalEntityId, rfqId);
      const invitation = await db.erpRfqInvitation.findFirst({ where: { rfqId, vendorId: actor.vendorId, legalEntityId: actor.legalEntityId }, include: { rfq: { include: { lines: true } } } });
      if (!invitation || invitation.rfq.status !== 'issued') throw new ApiError(404, 'rfq_invitation_not_found', 'Issued RFQ invitation not found.');
      if (invitation.rfq.responseDueAt < new Date()) throw new ApiError(410, 'rfq_response_closed', 'RFQ response deadline passed.');
      const expected = new Set(invitation.rfq.lines.map((line) => line.id));
      if (input.lines.length !== expected.size || input.lines.some((line) => !expected.delete(line.rfqLineId)) || expected.size) throw new ApiError(422, 'rfq_lines_incomplete', 'Quotation must contain each RFQ line exactly once.');
      let subtotal = new Prisma.Decimal(0); let taxTotal = new Prisma.Decimal(0);
      const lines = input.lines.map((line, index) => {
        const net = new Prisma.Decimal(line.quantity).times(line.unitRate).toDecimalPlaces(2);
        const computedTax = net.times(line.taxRate).dividedBy(100).toDecimalPlaces(2);
        if (line.taxAmount !== undefined && !new Prisma.Decimal(line.taxAmount).equals(computedTax)) throw new ApiError(422, 'tax_amount_mismatch', `Line ${index + 1} tax does not match quantity, rate and tax rate.`);
        const tax = line.taxAmount === undefined ? computedTax : new Prisma.Decimal(line.taxAmount);
        subtotal = subtotal.plus(net); taxTotal = taxTotal.plus(tax);
        return { organizationId: actor.organizationId, legalEntityId: actor.legalEntityId, rfqLineId: line.rfqLineId, lineNumber: index + 1, quantity: line.quantity, unitRate: line.unitRate, taxRate: line.taxRate, taxAmount: tax, lineTotal: net.plus(tax), promisedOn: line.promisedOn ? dateOnly(line.promisedOn) : null, technicalResponse: json(line.technicalResponse) };
      });
      const row = await db.erpSupplierQuotation.create({ data: { organizationId: actor.organizationId, legalEntityId: actor.legalEntityId, rfqId, invitationId: invitation.id, vendorId: actor.vendorId, portalUserId: actor.portalUserId, quotationNumber: input.quotationNumber, currency: input.currency, subtotal, taxTotal, grandTotal: subtotal.plus(taxTotal), validUntil: dateOnly(input.validUntil), promisedOn: input.promisedOn ? dateOnly(input.promisedOn) : null, commercialResponse: json(input.commercialResponse), technicalResponse: json(input.technicalResponse), createIdempotencyKey: key, requestHash: hashCanonical(input), lines: { create: lines } }, include: { lines: true } });
      await db.erpRfqInvitation.update({ where: { id: invitation.id }, data: { status: 'responded', respondedAt: new Date() } });
      await appendEvidence(db, supplierAuditActor(actor), { action: 'supplier.rfq.respond', entity: 'ErpSupplierQuotation', entityId: row.id, after: row, eventType: 'mesaerp.supplier.quotation.submitted.v1' });
      return row;
    });
  }

  acknowledgePo(actor: SupplierActor, purchaseOrderId: string, input: PoAcknowledgementCreate, key: string) {
    return runSupplier(actor, `po:${purchaseOrderId}:acknowledge`, key, input, async (db) => {
      const po = await db.erpDocument.findFirst({ where: { id: purchaseOrderId, legalEntityId: actor.legalEntityId, documentType: 'purchase_order', vendorId: actor.vendorId, status: 'approved' } });
      if (!po) throw new ApiError(404, 'purchase_order_not_found', 'Approved purchase order not found.');
      const existing = await db.erpPoAcknowledgement.findFirst({ where: { purchaseOrderId, vendorId: actor.vendorId } });
      if (existing) throw new ApiError(409, 'purchase_order_already_acknowledged', 'Purchase order already has a supplier response.');
      const row = await db.erpPoAcknowledgement.create({ data: { organizationId: actor.organizationId, legalEntityId: actor.legalEntityId, purchaseOrderId, vendorId: actor.vendorId, portalUserId: actor.portalUserId, status: input.status, responseNote: input.responseNote, proposedChanges: json(input.proposedChanges), createIdempotencyKey: key, requestHash: hashCanonical(input) } });
      await appendEvidence(db, supplierAuditActor(actor), { action: 'supplier.po.respond', entity: 'ErpPoAcknowledgement', entityId: row.id, after: row, eventType: 'mesaerp.supplier.po.responded.v1' });
      return row;
    });
  }

  createAsn(actor: SupplierActor, input: AsnCreate, key: string) {
    return runSupplier(actor, `po:${input.purchaseOrderId}:asn:create`, key, input, async (db) => {
      // The purchase-order aggregate is the serialization point. Without this
      // lock two different idempotency keys could both observe the same
      // remaining quantity and over-ship it.
      await lockPurchaseOrder(db, actor.legalEntityId, input.purchaseOrderId);
      const po = await db.erpDocument.findFirst({ where: { id: input.purchaseOrderId, legalEntityId: actor.legalEntityId, documentType: 'purchase_order', vendorId: actor.vendorId, status: 'approved' }, include: { lines: true } });
      if (!po) throw new ApiError(404, 'purchase_order_not_found', 'Approved purchase order not found.');
      if (input.expectedPurchaseOrderRowVersion !== undefined) {
        assertVersion(po.rowVersion, input.expectedPurchaseOrderRowVersion);
      }
      const byId = new Map(po.lines.map((line) => [line.id, line]));
      if (input.lines.some((line) => !byId.has(line.sourceLineId))) throw new ApiError(422, 'asn_line_invalid', 'ASN line does not belong to this purchase order.');
      if (new Set(input.lines.map((line) => line.sourceLineId)).size !== input.lines.length) {
        throw new ApiError(422, 'asn_line_duplicate', 'Each purchase-order line may appear only once in an ASN.');
      }
      const existing = await db.erpAdvanceShipmentNotice.findMany({ where: { purchaseOrderId: po.id, status: { not: 'cancelled' } }, select: { lines: true } });
      for (const line of input.lines) {
        const already = existing.reduce((sum, asn) => {
          const rows = Array.isArray(asn.lines) ? asn.lines as Array<Record<string, unknown>> : [];
          return rows.filter((candidate) => candidate.sourceLineId === line.sourceLineId).reduce((asnTotal, candidate) => {
            if (typeof candidate.quantity !== 'string' && typeof candidate.quantity !== 'number') {
              throw new ApiError(409, 'asn_aggregate_invalid', 'Existing ASN quantity evidence is invalid; review the aggregate before adding another notice.');
            }
            try {
              const quantity = new Prisma.Decimal(candidate.quantity);
              if (!quantity.greaterThan(0)) throw new Error('range');
              return asnTotal.plus(quantity);
            } catch {
              throw new ApiError(409, 'asn_aggregate_invalid', 'Existing ASN quantity evidence is invalid; review the aggregate before adding another notice.');
            }
          }, sum);
        }, new Prisma.Decimal(0));
        if (already.plus(line.quantity).greaterThan(byId.get(line.sourceLineId)!.quantity)) throw new ApiError(422, 'asn_quantity_exceeds_po', 'ASN quantities exceed the purchase-order line quantity.');
      }
      const row = await db.erpAdvanceShipmentNotice.create({ data: { organizationId: actor.organizationId, legalEntityId: actor.legalEntityId, purchaseOrderId: po.id, vendorId: actor.vendorId, portalUserId: actor.portalUserId, asnNumber: input.asnNumber, dispatchedOn: dateOnly(input.dispatchedOn), expectedArrivalOn: dateOnly(input.expectedArrivalOn), carrier: input.carrier, vehicleNumber: input.vehicleNumber, trackingReference: input.trackingReference, lines: json(input.lines), createIdempotencyKey: key, requestHash: hashCanonical(input) } });
      await appendEvidence(db, supplierAuditActor(actor), { action: 'supplier.asn.create', entity: 'ErpAdvanceShipmentNotice', entityId: row.id, after: row, eventType: 'mesaerp.supplier.asn.submitted.v1' });
      return row;
    });
  }

  addInvoiceEvidence(actor: SupplierActor, supplierInvoiceId: string, input: SupplierInvoiceEvidenceCreate, key: string) {
    return runSupplier(actor, `invoice:${supplierInvoiceId}:evidence:create`, key, input, async (db) => {
      const invoice = await db.erpDocument.findFirst({ where: { id: supplierInvoiceId, legalEntityId: actor.legalEntityId, documentType: 'supplier_invoice', vendorId: actor.vendorId } });
      if (!invoice) throw new ApiError(404, 'supplier_invoice_not_found', 'Supplier invoice not found.');
      const row = await db.erpSupplierInvoiceEvidence.create({ data: { organizationId: actor.organizationId, legalEntityId: actor.legalEntityId, vendorId: actor.vendorId, supplierInvoiceId, portalUserId: actor.portalUserId, evidenceType: input.evidenceType, storageRef: input.storageRef, checksum: input.checksum, externalReference: input.externalReference, metadata: json(input.metadata), createIdempotencyKey: key, requestHash: hashCanonical(input) } });
      await appendEvidence(db, supplierAuditActor(actor), { action: 'supplier.invoice_evidence.register', entity: 'ErpSupplierInvoiceEvidence', entityId: row.id, after: row, eventType: 'mesaerp.supplier.invoice_evidence.registered.v1' });
      return row;
    });
  }

  respondToDispute(actor: SupplierActor, disputeId: string, input: SupplierDisputeResponse, key: string) {
    return runSupplier(actor, `dispute:${disputeId}:respond`, key, input, async (db) => {
      await lockVendorDispute(db, actor.legalEntityId, disputeId);
      const row = await db.erpVendorDispute.findFirst({ where: { id: disputeId, legalEntityId: actor.legalEntityId, vendorId: actor.vendorId } });
      if (!row) throw new ApiError(404, 'dispute_not_found', 'Dispute not found.');
      assertVersion(row.rowVersion, input.expectedRowVersion);
      if (row.status !== 'open') throw new ApiError(409, 'dispute_not_open', 'Only an open dispute accepts a response.');
      const changed = await db.erpVendorDispute.updateMany({
        where: { id: row.id, legalEntityId: actor.legalEntityId, vendorId: actor.vendorId, status: 'open', rowVersion: input.expectedRowVersion },
        data: { status: 'vendor_response', vendorResponse: input.response, rowVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Dispute changed while the response was being saved.');
      const updated = await db.erpVendorDispute.findUniqueOrThrow({ where: { id: row.id } });
      await appendEvidence(db, supplierAuditActor(actor), { action: 'supplier.dispute.respond', entity: 'ErpVendorDispute', entityId: row.id, before: row, after: updated, eventType: 'mesaerp.supplier.dispute.responded.v1' });
      return updated;
    });
  }
}

export const supplierTokenHash = tokenHash;
