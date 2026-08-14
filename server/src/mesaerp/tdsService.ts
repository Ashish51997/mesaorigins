import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type ErpTdsDeduction,
  type ErpTdsRate,
  type ErpTdsSection,
  type ErpVendorTdsClassification,
} from '@prisma/client';
import { basePrisma, tenantTx } from '../db';
import { audit } from '../lib/audit';
import { canonicalHash } from '../lib/canonical';
import { tenantContext, type TenantCtx } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import { hasMesaErpPermission } from './access';
import type {
  TdsDeductionCreate,
  TdsRateCreate,
  TdsReportQuery,
  TdsSectionCreate,
  TdsTransition,
  VendorTdsClassificationCreate,
} from './handoffTdsSchemas';

type Db = typeof basePrisma;
const tdsVoucherEvidenceInclude = {
  sourceDocument: { select: { id: true, organizationId: true, legalEntityId: true, documentType: true, vendorId: true } },
  lines: { select: { dimensions: true, baseCredit: true, account: { select: { classification: true } } } },
  paymentProposals: { select: { id: true, legalEntityId: true, vendorId: true, supplierInvoiceId: true, paymentVoucherId: true, status: true } },
} satisfies Prisma.ErpVoucherInclude;
type TdsVoucherEvidence = Prisma.ErpVoucherGetPayload<{ include: typeof tdsVoucherEvidenceInclude }>;

function actor(): TenantCtx {
  const current = tenantContext.getStore();
  if (!current) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return current;
}

function dateOnly(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function day(value: Date): string { return value.toISOString().slice(0, 10); }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function money(value: Prisma.Decimal.Value): Prisma.Decimal { return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP); }
function percent(value: Prisma.Decimal.Value): Prisma.Decimal { return new Prisma.Decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP); }
function sum(values: Prisma.Decimal[]): Prisma.Decimal { return values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0)); }
function record(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function voucherPartyIds(voucher: TdsVoucherEvidence): Set<string> {
  return new Set(voucher.lines.flatMap((line) => {
    const partyId = record(line.dimensions).partyId;
    return typeof partyId === 'string' && partyId ? [partyId] : [];
  }));
}

export function calculateTdsThresholdBasis(input: {
  grossAmount: Prisma.Decimal.Value;
  priorAggregateBase: Prisma.Decimal.Value;
  singlePaymentThreshold: Prisma.Decimal.Value;
  aggregateThreshold: Prisma.Decimal.Value;
  thresholdApplication: string;
}) {
  const grossAmount = money(input.grossAmount);
  const priorAggregateBase = money(input.priorAggregateBase);
  const singlePaymentThreshold = money(input.singlePaymentThreshold);
  const aggregateThreshold = money(input.aggregateThreshold);
  const aggregateAfter = priorAggregateBase.plus(grossAmount);
  const singleHit = singlePaymentThreshold.greaterThan(0) && grossAmount.greaterThanOrEqualTo(singlePaymentThreshold);
  const aggregateHit = aggregateThreshold.greaterThan(0) && aggregateAfter.greaterThan(aggregateThreshold);
  const thresholdsDisabled = singlePaymentThreshold.isZero() && aggregateThreshold.isZero();
  const priorAggregateExcess = aggregateThreshold.greaterThan(0)
    ? Prisma.Decimal.max(priorAggregateBase.minus(aggregateThreshold), 0)
    : new Prisma.Decimal(0);
  const aggregateExcess = aggregateThreshold.greaterThan(0)
    ? Prisma.Decimal.max(aggregateAfter.minus(aggregateThreshold), 0)
    : new Prisma.Decimal(0);
  let taxableBase = new Prisma.Decimal(0);
  if (thresholdsDisabled || singleHit || aggregateHit) {
    if (input.thresholdApplication === 'excess_only' && aggregateHit && !singleHit) {
      // Only the excess introduced by this deduction is taxable. Subtracting
      // the already-taxed prior excess prevents every later deduction from
      // re-taxing the cumulative amount above the threshold.
      taxableBase = Prisma.Decimal.min(
        grossAmount,
        Prisma.Decimal.max(aggregateExcess.minus(priorAggregateExcess), 0),
      );
    } else {
      taxableBase = grossAmount;
    }
  }
  return {
    aggregateAfter: money(aggregateAfter),
    singleHit,
    aggregateHit,
    priorAggregateExcess: money(priorAggregateExcess),
    aggregateExcess: money(aggregateExcess),
    taxableBase: money(taxableBase),
  };
}

async function lockAndLoadTdsSources(
  db: Db,
  legalEntityId: string,
  payableVoucherId: string,
  paymentVoucherId?: string | null,
) {
  const voucherIds = [...new Set([payableVoucherId, ...(paymentVoucherId ? [paymentVoucherId] : [])])].sort();
  await db.$queryRaw(Prisma.sql`
    SELECT "id" FROM "ErpVoucher"
    WHERE "legalEntityId" = ${legalEntityId}
      AND "id" IN (${Prisma.join(voucherIds)})
    ORDER BY "id"
    FOR UPDATE
  `);
  // Lock the vendor-bearing source documents and the payment-proposal
  // relationship before reloading. Posted vouchers are immutable, while these
  // relationship rows carry the ownership evidence TDS relies on.
  await db.$queryRaw(Prisma.sql`
    SELECT document."id"
    FROM "ErpDocument" document
    JOIN "ErpVoucher" voucher ON voucher."sourceDocumentId" = document."id"
    WHERE voucher."legalEntityId" = ${legalEntityId}
      AND voucher."id" IN (${Prisma.join(voucherIds)})
    ORDER BY document."id"
    FOR UPDATE OF document
  `);
  if (paymentVoucherId) {
    await db.$queryRaw(Prisma.sql`
      SELECT proposal."id"
      FROM "ErpVendorPaymentProposal" proposal
      WHERE proposal."legalEntityId" = ${legalEntityId}
        AND proposal."paymentVoucherId" = ${paymentVoucherId}
      ORDER BY proposal."id"
      FOR UPDATE
    `);
  }
  const [payable, payment] = await Promise.all([
    db.erpVoucher.findFirst({ where: { id: payableVoucherId, legalEntityId }, include: tdsVoucherEvidenceInclude }),
    paymentVoucherId
      ? db.erpVoucher.findFirst({ where: { id: paymentVoucherId, legalEntityId }, include: tdsVoucherEvidenceInclude })
      : Promise.resolve(null),
  ]);
  return { payable, payment };
}

function payableVendorBinding(payable: TdsVoucherEvidence, vendorId: string) {
  const source = payable.sourceDocument;
  const partyIds = voucherPartyIds(payable);
  if ([...partyIds].some((partyId) => partyId !== vendorId)) {
    throw new ApiError(409, 'tds_vendor_voucher_conflict', 'The payable voucher contains party evidence for a different vendor.');
  }
  if (source) {
    if (source.legalEntityId !== payable.legalEntityId
      || source.documentType !== 'supplier_invoice'
      || source.vendorId !== vendorId) {
      throw new ApiError(409, 'tds_vendor_voucher_conflict', 'The payable source document is not a supplier invoice owned by this vendor.');
    }
    return { kind: 'supplier_invoice' as const, supplierInvoiceId: source.id };
  }
  const explicitlyBoundPayable = payable.lines.some((line) => (
    line.account.classification === 'payable'
      && line.baseCredit.greaterThan(0)
      && record(line.dimensions).partyId === vendorId
  ));
  if (!explicitlyBoundPayable || partyIds.size !== 1) {
    throw new ApiError(422, 'tds_payable_vendor_binding_required', 'The payable must be linked to this vendor through a supplier invoice or an explicit payable-line party dimension.');
  }
  return { kind: 'party_dimension' as const, supplierInvoiceId: null };
}

function assertTdsSourceOwnership(input: {
  payable: TdsVoucherEvidence | null;
  payment: TdsVoucherEvidence | null;
  paymentVoucherId?: string | null;
  vendorId: string;
}) {
  const { payable, payment, paymentVoucherId, vendorId } = input;
  if (!payable || payable.status !== 'posted' || !['purchase', 'journal'].includes(payable.voucherType)) {
    throw new ApiError(422, 'tds_payable_voucher_invalid', 'The payable source must be a posted company purchase or journal voucher.');
  }
  const binding = payableVendorBinding(payable, vendorId);
  if (!paymentVoucherId) return binding;
  if (!payment || payment.status !== 'posted' || payment.voucherType !== 'payment') {
    throw new ApiError(422, 'tds_payment_voucher_invalid', 'The optional payment source must be a posted company payment voucher.');
  }
  if ([...voucherPartyIds(payment)].some((partyId) => partyId !== vendorId)) {
    throw new ApiError(409, 'tds_payment_relationship_invalid', 'The payment voucher contains party evidence for a different vendor.');
  }
  if (binding.kind !== 'supplier_invoice'
    || !payment.sourceDocument
    || payment.sourceDocument.id !== binding.supplierInvoiceId
    || payment.sourceDocument.legalEntityId !== payable.legalEntityId
    || payment.sourceDocument.documentType !== 'supplier_invoice'
    || payment.sourceDocument.vendorId !== vendorId) {
    throw new ApiError(409, 'tds_payment_relationship_invalid', 'The payment voucher is not bound to the same vendor and supplier invoice as the payable.');
  }
  const proposals = payment.paymentProposals.filter((proposal) => (
    proposal.status === 'approved'
      && proposal.legalEntityId === payable.legalEntityId
      && proposal.vendorId === vendorId
      && proposal.supplierInvoiceId === binding.supplierInvoiceId
      && proposal.paymentVoucherId === payment.id
  ));
  const metadata = record(payment.originMetadata);
  if (proposals.length !== 1
    || payment.originType !== 'payment_proposal'
    || metadata.paymentProposalId !== proposals[0].id
    || metadata.vendorId !== vendorId) {
    throw new ApiError(409, 'tds_payment_relationship_invalid', 'The payment voucher lacks one approved payment-proposal relationship for this vendor and payable.');
  }
  return binding;
}

async function requireEntity(db: Db, context: TenantCtx, legalEntityId: string) {
  const entity = await db.legalEntity.findFirst({ where: { id: legalEntityId, organizationId: context.organizationId } });
  if (!entity) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found in this tenant.');
  return entity;
}

async function replay<T>(db: Db, organizationId: string, scope: string, key: string, requestHash: string): Promise<T | null> {
  const existing = await db.erpIdempotencyRecord.findUnique({ where: { organizationId_scope_key: { organizationId, scope, key } } });
  if (!existing) return null;
  if (existing.requestHash !== requestHash) throw new ApiError(409, 'idempotency_conflict', 'This Idempotency-Key was already used with a different request.');
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
  const requestHash = canonicalHash({ legalEntityId: input.legalEntityId, payload: input.payload });
  const once = () => tenantTx(async (db) => {
    await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.organizationId}:${input.scope}:${input.key}`}, 0))`);
    const existing = await replay<T>(db, context.organizationId, input.scope, input.key, requestHash);
    if (existing) return existing;
    await requireEntity(db, context, input.legalEntityId);
    const response = await input.execute(db, context);
    await db.erpIdempotencyRecord.create({ data: {
      organizationId: context.organizationId, legalEntityId: input.legalEntityId,
      scope: input.scope, key: input.key, requestHash, response: json(response),
    } });
    return response;
  });
  try { return await once(); } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    return tenantTx(async (db) => {
      const existing = await replay<T>(db, context.organizationId, input.scope, input.key, requestHash);
      if (existing) return existing;
      throw error;
    });
  }
}

function sectionDto(row: ErpTdsSection) {
  return {
    ...row,
    sourceEvidence: structuredClone(row.sourceEvidence),
    effectiveSourceHash: row.effectiveSourceHash,
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function rateDto(row: ErpTdsRate) {
  return {
    ...row,
    standardRate: row.standardRate.toString(), noPanRate: row.noPanRate.toString(),
    singlePaymentThreshold: row.singlePaymentThreshold.toString(), aggregateThreshold: row.aggregateThreshold.toString(),
    effectiveFrom: day(row.effectiveFrom), ...(row.effectiveTo ? { effectiveTo: day(row.effectiveTo) } : {}),
    sourceEvidence: structuredClone(row.sourceEvidence),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function classificationDto(row: ErpVendorTdsClassification) {
  return {
    ...row,
    ...(row.overrideRate ? { overrideRate: row.overrideRate.toString() } : {}),
    effectiveFrom: day(row.effectiveFrom), ...(row.effectiveTo ? { effectiveTo: day(row.effectiveTo) } : {}),
    evidence: structuredClone(row.evidence),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function deductionDto(row: ErpTdsDeduction) {
  return {
    ...row,
    businessDate: day(row.businessDate), grossAmount: row.grossAmount.toString(), priorAggregateBase: row.priorAggregateBase.toString(),
    taxableBase: row.taxableBase.toString(), appliedRate: row.appliedRate.toString(), deductionAmount: row.deductionAmount.toString(),
    calculationSnapshot: structuredClone(row.calculationSnapshot),
    ...(row.submittedAt ? { submittedAt: row.submittedAt.toISOString() } : {}),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function assertMakerChecker(createdBy: string, checker: string, subject: string) {
  if (!createdBy || createdBy === checker) throw new ApiError(409, 'maker_checker_required', `${subject} maker cannot approve the same record.`);
}

async function assertNoRateOverlap(db: Db, row: ErpTdsRate) {
  const conflict = await db.erpTdsRate.findFirst({
    where: {
      legalEntityId: row.legalEntityId, sectionId: row.sectionId, status: 'approved', id: { not: row.id },
      effectiveFrom: { lte: row.effectiveTo ?? new Date('9999-12-31T00:00:00.000Z') },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: row.effectiveFrom } }],
    },
  });
  if (conflict) throw new ApiError(409, 'tds_rate_effective_overlap', 'An approved rate already covers part of this effective period.');
}

async function assertNoClassificationOverlap(db: Db, row: ErpVendorTdsClassification) {
  const conflict = await db.erpVendorTdsClassification.findFirst({
    where: {
      legalEntityId: row.legalEntityId, vendorId: row.vendorId, sectionId: row.sectionId,
      status: 'approved', id: { not: row.id },
      effectiveFrom: { lte: row.effectiveTo ?? new Date('9999-12-31T00:00:00.000Z') },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: row.effectiveFrom } }],
    },
  });
  if (conflict) throw new ApiError(409, 'tds_classification_effective_overlap', 'An approved vendor classification already covers part of this effective period.');
}

async function appendOutbox(db: Db, context: TenantCtx, legalEntityId: string, aggregateType: string, aggregateId: string, eventType: string, payload: unknown) {
  await db.integrationOutboxEvent.create({ data: {
    organizationId: context.organizationId, legalEntityId, serviceId: 'mesaerp', aggregateType, aggregateId,
    eventType, schemaVersion: 1, correlationId: randomUUID(), payload: json(payload), payloadHash: canonicalHash(payload),
  } });
}

export class PrismaMesaErpTdsService {
  hasPermission(input: { organizationId: string; membershipId: string; legalEntityId: string; permission: string }) {
    return hasMesaErpPermission(input);
  }

  async listSections(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const sections = await db.erpTdsSection.findMany({ where: { legalEntityId }, include: { rates: { orderBy: { effectiveFrom: 'desc' } } }, orderBy: { code: 'asc' }, take: 500 });
      return sections.map((section) => ({ ...sectionDto(section), rates: section.rates.map(rateDto) }));
    });
  }

  createSection(legalEntityId: string, input: TdsSectionCreate, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `tds:section:create:${legalEntityId}`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      if (await db.erpTdsSection.findFirst({ where: { legalEntityId, code: input.code } })) throw new ApiError(409, 'tds_section_exists', 'This TDS section already exists in the company.');
      const sourceHash = canonicalHash({ sourceReference: input.sourceReference, sourceEvidence: input.sourceEvidence });
      const row = await db.erpTdsSection.create({ data: {
        organizationId: context.organizationId, legalEntityId, code: input.code, name: input.name,
        natureOfPayment: input.natureOfPayment, status: 'draft', sourceReference: input.sourceReference,
        sourceEvidence: json(input.sourceEvidence), effectiveSourceHash: sourceHash,
        createIdempotencyKey: idempotencyKey, requestHash: canonicalHash(input), createdBy: context.membershipId,
      } });
      await audit(db, { action: 'mesaerp.tds.section.create', entity: 'ErpTdsSection', entityId: row.id, after: sectionDto(row) });
      return sectionDto(row);
    } });
  }

  approveSection(legalEntityId: string, sectionId: string, input: TdsTransition, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `tds:section:${sectionId}:approve`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      const current = await db.erpTdsSection.findFirst({ where: { id: sectionId, legalEntityId } });
      if (!current) throw new ApiError(404, 'tds_section_not_found', 'TDS section not found in this company.');
      if (current.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'TDS section changed since it was loaded.');
      if (current.status !== 'draft') throw new ApiError(409, 'tds_section_not_transitionable', `The TDS section is ${current.status}.`);
      assertMakerChecker(current.createdBy, context.membershipId, 'TDS section');
      if (canonicalHash({ sourceReference: current.sourceReference, sourceEvidence: current.sourceEvidence }) !== current.effectiveSourceHash) {
        throw new ApiError(409, 'tds_source_evidence_changed', 'TDS source evidence no longer matches its immutable hash.');
      }
      const changed = await db.erpTdsSection.updateMany({ where: { id: sectionId, legalEntityId, status: 'draft', rowVersion: input.expectedRowVersion }, data: {
        status: 'approved', approvedBy: context.membershipId, approvedAt: new Date(), rowVersion: { increment: 1 },
      } });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'TDS section changed while approval was saved.');
      const row = await db.erpTdsSection.findUniqueOrThrow({ where: { id: sectionId } });
      await audit(db, { action: 'mesaerp.tds.section.approve', entity: 'ErpTdsSection', entityId: row.id, before: sectionDto(current), after: sectionDto(row) });
      await appendOutbox(db, context, legalEntityId, 'ErpTdsSection', row.id, 'mesaerp.tds-section.approved.v1', sectionDto(row));
      return sectionDto(row);
    } });
  }

  async listRates(legalEntityId: string, sectionId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const section = await db.erpTdsSection.findFirst({ where: { id: sectionId, legalEntityId } });
      if (!section) throw new ApiError(404, 'tds_section_not_found', 'TDS section not found in this company.');
      return (await db.erpTdsRate.findMany({ where: { legalEntityId, sectionId }, orderBy: { effectiveFrom: 'desc' }, take: 500 })).map(rateDto);
    });
  }

  createRate(legalEntityId: string, sectionId: string, input: TdsRateCreate, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `tds:section:${sectionId}:rate:create`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      const section = await db.erpTdsSection.findFirst({ where: { id: sectionId, legalEntityId, status: 'approved' } });
      if (!section) throw new ApiError(409, 'tds_section_not_approved', 'Approve the TDS section before adding effective rates.');
      const sourceHash = canonicalHash({ sourceReference: input.sourceReference, sourceEvidence: input.sourceEvidence });
      const row = await db.erpTdsRate.create({ data: {
        organizationId: context.organizationId, legalEntityId, sectionId,
        effectiveFrom: dateOnly(input.effectiveFrom), effectiveTo: input.effectiveTo ? dateOnly(input.effectiveTo) : null,
        standardRate: input.standardRate, noPanRate: input.noPanRate,
        singlePaymentThreshold: input.singlePaymentThreshold, aggregateThreshold: input.aggregateThreshold,
        thresholdApplication: input.thresholdApplication, status: 'draft', sourceReference: input.sourceReference,
        sourceEvidence: json(input.sourceEvidence), sourceEvidenceHash: sourceHash,
        createIdempotencyKey: idempotencyKey, requestHash: canonicalHash(input), createdBy: context.membershipId,
      } });
      await audit(db, { action: 'mesaerp.tds.rate.create', entity: 'ErpTdsRate', entityId: row.id, after: rateDto(row) });
      return rateDto(row);
    } });
  }

  approveRate(legalEntityId: string, rateId: string, input: TdsTransition, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `tds:rate:${rateId}:approve`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      const current = await db.erpTdsRate.findFirst({ where: { id: rateId, legalEntityId } });
      if (!current) throw new ApiError(404, 'tds_rate_not_found', 'TDS rate not found in this company.');
      if (current.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'TDS rate changed since it was loaded.');
      if (current.status !== 'draft') throw new ApiError(409, 'tds_rate_not_transitionable', `The TDS rate is ${current.status}.`);
      assertMakerChecker(current.createdBy, context.membershipId, 'TDS rate');
      if (canonicalHash({ sourceReference: current.sourceReference, sourceEvidence: current.sourceEvidence }) !== current.sourceEvidenceHash) {
        throw new ApiError(409, 'tds_source_evidence_changed', 'TDS rate evidence no longer matches its immutable hash.');
      }
      await assertNoRateOverlap(db, current);
      const changed = await db.erpTdsRate.updateMany({ where: { id: rateId, legalEntityId, status: 'draft', rowVersion: input.expectedRowVersion }, data: {
        status: 'approved', approvedBy: context.membershipId, approvedAt: new Date(), rowVersion: { increment: 1 },
      } });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'TDS rate changed while approval was saved.');
      const row = await db.erpTdsRate.findUniqueOrThrow({ where: { id: rateId } });
      await audit(db, { action: 'mesaerp.tds.rate.approve', entity: 'ErpTdsRate', entityId: row.id, before: rateDto(current), after: rateDto(row) });
      await appendOutbox(db, context, legalEntityId, 'ErpTdsRate', row.id, 'mesaerp.tds-rate.approved.v1', rateDto(row));
      return rateDto(row);
    } });
  }

  async listVendorClassifications(legalEntityId: string, vendorId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const vendor = await db.erpVendor.findFirst({ where: { id: vendorId, legalEntityId } });
      if (!vendor) throw new ApiError(404, 'vendor_not_found', 'Vendor not found in this company.');
      return (await db.erpVendorTdsClassification.findMany({ where: { legalEntityId, vendorId }, orderBy: { effectiveFrom: 'desc' }, take: 500 })).map(classificationDto);
    });
  }

  createVendorClassification(legalEntityId: string, vendorId: string, input: VendorTdsClassificationCreate, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `tds:vendor:${vendorId}:classification:create`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      const [vendor, section] = await Promise.all([
        db.erpVendor.findFirst({ where: { id: vendorId, legalEntityId } }),
        db.erpTdsSection.findFirst({ where: { id: input.sectionId, legalEntityId, status: 'approved' } }),
      ]);
      if (!vendor) throw new ApiError(404, 'vendor_not_found', 'Vendor not found in this company.');
      if (!section) throw new ApiError(422, 'tds_section_not_approved', 'Vendor classification requires an approved company TDS section.');
      const evidenceHash = canonicalHash({ certificateReference: input.certificateReference, evidence: input.evidence });
      const row = await db.erpVendorTdsClassification.create({ data: {
        organizationId: context.organizationId, legalEntityId, vendorId, sectionId: input.sectionId,
        effectiveFrom: dateOnly(input.effectiveFrom), effectiveTo: input.effectiveTo ? dateOnly(input.effectiveTo) : null,
        panStatus: input.panStatus, overrideRate: input.overrideRate ?? null,
        certificateReference: input.certificateReference, evidence: json(input.evidence), evidenceHash,
        status: 'draft', createIdempotencyKey: idempotencyKey, requestHash: canonicalHash(input), createdBy: context.membershipId,
      } });
      await audit(db, { action: 'mesaerp.tds.vendor_classification.create', entity: 'ErpVendorTdsClassification', entityId: row.id, after: classificationDto(row) });
      return classificationDto(row);
    } });
  }

  approveVendorClassification(legalEntityId: string, classificationId: string, input: TdsTransition, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `tds:classification:${classificationId}:approve`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      const current = await db.erpVendorTdsClassification.findFirst({ where: { id: classificationId, legalEntityId } });
      if (!current) throw new ApiError(404, 'tds_classification_not_found', 'Vendor TDS classification not found in this company.');
      if (current.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Vendor TDS classification changed since it was loaded.');
      if (current.status !== 'draft') throw new ApiError(409, 'tds_classification_not_transitionable', `The vendor classification is ${current.status}.`);
      assertMakerChecker(current.createdBy, context.membershipId, 'Vendor TDS classification');
      if (canonicalHash({ certificateReference: current.certificateReference, evidence: current.evidence }) !== current.evidenceHash) {
        throw new ApiError(409, 'tds_classification_evidence_changed', 'Vendor TDS classification evidence failed its immutable hash check.');
      }
      await assertNoClassificationOverlap(db, current);
      const changed = await db.erpVendorTdsClassification.updateMany({ where: { id: classificationId, legalEntityId, status: 'draft', rowVersion: input.expectedRowVersion }, data: {
        status: 'approved', approvedBy: context.membershipId, approvedAt: new Date(), rowVersion: { increment: 1 },
      } });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Vendor TDS classification changed while approval was saved.');
      const row = await db.erpVendorTdsClassification.findUniqueOrThrow({ where: { id: classificationId } });
      await audit(db, { action: 'mesaerp.tds.vendor_classification.approve', entity: 'ErpVendorTdsClassification', entityId: row.id, before: classificationDto(current), after: classificationDto(row) });
      await appendOutbox(db, context, legalEntityId, 'ErpVendorTdsClassification', row.id, 'mesaerp.vendor-tds-classification.approved.v1', classificationDto(row));
      return classificationDto(row);
    } });
  }

  async listDeductions(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      return (await db.erpTdsDeduction.findMany({ where: { legalEntityId }, orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }], take: 2000 })).map(deductionDto);
    });
  }

  createDeduction(legalEntityId: string, input: TdsDeductionCreate, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `tds:deduction:create:${legalEntityId}`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      const businessDate = dateOnly(input.businessDate);
      const year = await db.financialYear.findFirst({ where: { legalEntityId, startsOn: { lte: businessDate }, endsOn: { gte: businessDate } } });
      if (!year) throw new ApiError(409, 'financial_year_missing', 'No financial year covers the deduction date.');
      await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.organizationId}:${legalEntityId}:tds-payable:${input.payableVoucherId}`}, 0))`);
      const vendor = await db.erpVendor.findFirst({ where: { id: input.vendorId, legalEntityId } });
      if (!vendor || !['approved', 'conditionally_approved'].includes(vendor.lifecycleStatus)) throw new ApiError(422, 'tds_vendor_not_approved', 'TDS evidence requires an approved company vendor.');
      const { payable, payment } = await lockAndLoadTdsSources(db, legalEntityId, input.payableVoucherId, input.paymentVoucherId);
      const sourceBinding = assertTdsSourceOwnership({ payable, payment, paymentVoucherId: input.paymentVoucherId, vendorId: vendor.id });
      // Ownership validation above guarantees a non-null payable.
      const payableSource = payable!;
      const grossAmount = money(input.grossAmount);
      const payableVoucherValue = money(Prisma.Decimal.max(payableSource.baseDebit, payableSource.baseCredit));
      const payableReservations = await db.erpTdsDeduction.findMany({
        where: { legalEntityId, payableVoucherId: payableSource.id, status: { in: ['draft', 'submitted', 'approved'] } },
        select: { grossAmount: true },
      });
      const payableReservedBefore = money(sum(payableReservations.map((row) => row.grossAmount)));
      if (payableReservedBefore.plus(grossAmount).greaterThan(payableVoucherValue)) {
        throw new ApiError(422, 'tds_payable_basis_exhausted', 'Cumulative draft, submitted and approved TDS basis would exceed the posted payable voucher value.');
      }
      const classifications = await db.erpVendorTdsClassification.findMany({ where: {
        legalEntityId, vendorId: vendor.id, status: 'approved', effectiveFrom: { lte: businessDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: businessDate } }],
      } });
      if (classifications.length !== 1) throw new ApiError(422, 'tds_classification_missing_or_ambiguous', 'Exactly one approved vendor TDS classification must cover the business date.');
      const classification = classifications[0];
      const rates = await db.erpTdsRate.findMany({ where: {
        legalEntityId, sectionId: classification.sectionId, status: 'approved', effectiveFrom: { lte: businessDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: businessDate } }],
      } });
      if (rates.length !== 1) throw new ApiError(422, 'tds_rate_missing_or_ambiguous', 'Exactly one approved TDS rate must cover the business date.');
      const rateRow = rates[0];
      await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.organizationId}:${legalEntityId}:${vendor.id}:${classification.sectionId}:${year.id}`}, 0))`);
      const priorRows = await db.erpTdsDeduction.findMany({
        where: { legalEntityId, financialYearId: year.id, vendorId: vendor.id, sectionId: classification.sectionId, status: { in: ['submitted', 'approved'] } },
      });
      const priorAggregateBase = money(sum(priorRows.map((row) => row.grossAmount)));
      const thresholdBasis = calculateTdsThresholdBasis({
        grossAmount,
        priorAggregateBase,
        singlePaymentThreshold: rateRow.singlePaymentThreshold,
        aggregateThreshold: rateRow.aggregateThreshold,
        thresholdApplication: rateRow.thresholdApplication,
      });
      const { aggregateAfter, singleHit, aggregateHit, taxableBase } = thresholdBasis;
      const appliedRate = classification.panStatus === 'valid'
        ? classification.overrideRate ?? rateRow.standardRate
        : Prisma.Decimal.max(rateRow.noPanRate, rateRow.standardRate);
      const deductionAmount = money(taxableBase.times(appliedRate).dividedBy(100));
      const calculationSnapshot = {
        version: 1,
        calculationStage: 'draft_provisional',
        grossBasisSource: 'user_entered_reviewed_basis',
        basisReviewRequiredAtSubmit: true,
        financialYearId: year.id,
        vendorId: vendor.id,
        sectionId: classification.sectionId,
        classificationId: classification.id,
        rateId: rateRow.id,
        businessDate: input.businessDate,
        grossAmount: grossAmount.toString(),
        priorAggregateBase: priorAggregateBase.toString(),
        aggregateAfter: money(aggregateAfter).toString(),
        singlePaymentThreshold: rateRow.singlePaymentThreshold.toString(),
        aggregateThreshold: rateRow.aggregateThreshold.toString(),
        thresholdApplication: rateRow.thresholdApplication,
        thresholdBasisPolicy: 'incremental_current_excess_v1',
        priorAggregateExcess: thresholdBasis.priorAggregateExcess.toString(),
        aggregateExcess: thresholdBasis.aggregateExcess.toString(),
        singleHit,
        aggregateHit,
        panStatus: classification.panStatus,
        appliedRate: percent(appliedRate).toString(),
        taxableBase: money(taxableBase).toString(),
        deductionAmount: deductionAmount.toString(),
        payableVoucherId: payableSource.id,
        payableVendorBinding: sourceBinding.kind,
        supplierInvoiceId: sourceBinding.supplierInvoiceId,
        payableVoucherValue: payableVoucherValue.toString(),
        payableReservedBefore: payableReservedBefore.toString(),
        paymentVoucherId: payment?.id ?? null,
        notes: input.notes,
      };
      const evidenceHash = canonicalHash(calculationSnapshot);
      const row = await db.erpTdsDeduction.create({ data: {
        organizationId: context.organizationId, legalEntityId, financialYearId: year.id,
        vendorId: vendor.id, sectionId: classification.sectionId, rateId: rateRow.id,
        vendorClassificationId: classification.id, payableVoucherId: payableSource.id, paymentVoucherId: payment?.id ?? null,
        businessDate, grossAmount, priorAggregateBase, taxableBase: money(taxableBase), appliedRate: percent(appliedRate), deductionAmount,
        status: 'draft', calculationSnapshot: json(calculationSnapshot), evidenceHash,
        createIdempotencyKey: idempotencyKey, requestHash: canonicalHash(input), createdBy: context.membershipId,
      } });
      await audit(db, { action: 'mesaerp.tds.deduction.create', entity: 'ErpTdsDeduction', entityId: row.id, after: deductionDto(row) });
      return deductionDto(row);
    } });
  }

  transitionDeduction(legalEntityId: string, deductionId: string, action: 'submit' | 'approve', input: TdsTransition, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `tds:deduction:${deductionId}:${action}`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpTdsDeduction" WHERE "id" = ${deductionId} AND "legalEntityId" = ${legalEntityId} FOR UPDATE`);
      const current = await db.erpTdsDeduction.findFirst({ where: { id: deductionId, legalEntityId } });
      if (!current) throw new ApiError(404, 'tds_deduction_not_found', 'TDS deduction not found in this company.');
      if (current.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'TDS deduction changed since it was loaded.');
      const expectedStatus = action === 'submit' ? 'draft' : 'submitted';
      if (current.status !== expectedStatus) throw new ApiError(409, 'tds_deduction_not_transitionable', `The TDS deduction is ${current.status}.`);
      if (canonicalHash(current.calculationSnapshot) !== current.evidenceHash) throw new ApiError(409, 'tds_deduction_evidence_changed', 'TDS calculation evidence failed its immutable hash check.');
      let transitionData: Prisma.ErpTdsDeductionUpdateManyMutationInput;
      if (action === 'submit') {
        await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.organizationId}:${legalEntityId}:tds-payable:${current.payableVoucherId}`}, 0))`);
        const { payable, payment } = await lockAndLoadTdsSources(db, legalEntityId, current.payableVoucherId, current.paymentVoucherId);
        const sourceBinding = assertTdsSourceOwnership({ payable, payment, paymentVoucherId: current.paymentVoucherId, vendorId: current.vendorId });
        const payableSource = payable!;
        await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.organizationId}:${legalEntityId}:${current.vendorId}:${current.sectionId}:${current.financialYearId}`}, 0))`);
        const [classification, rateRow] = await Promise.all([
          db.erpVendorTdsClassification.findFirst({ where: {
            id: current.vendorClassificationId, legalEntityId, vendorId: current.vendorId,
            sectionId: current.sectionId, status: 'approved', effectiveFrom: { lte: current.businessDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: current.businessDate } }],
          } }),
          db.erpTdsRate.findFirst({ where: {
            id: current.rateId, legalEntityId, sectionId: current.sectionId, status: 'approved',
            effectiveFrom: { lte: current.businessDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: current.businessDate } }],
          } }),
        ]);
        if (!classification || !rateRow) throw new ApiError(409, 'tds_master_evidence_changed', 'The approved classification or effective rate no longer covers the deduction date.');
        const payableVoucherValue = money(Prisma.Decimal.max(payableSource.baseDebit, payableSource.baseCredit));
        const reservations = await db.erpTdsDeduction.findMany({
          where: { legalEntityId, payableVoucherId: payableSource.id, id: { not: current.id }, status: { in: ['draft', 'submitted', 'approved'] } },
          select: { grossAmount: true },
        });
        const payableReservedBefore = money(sum(reservations.map((row) => row.grossAmount)));
        if (payableReservedBefore.plus(current.grossAmount).greaterThan(payableVoucherValue)) {
          throw new ApiError(409, 'tds_payable_basis_exhausted', 'The reviewed TDS basis is no longer available on the posted payable voucher.');
        }
        const priorRows = await db.erpTdsDeduction.findMany({
          where: {
            legalEntityId, financialYearId: current.financialYearId, vendorId: current.vendorId,
            sectionId: current.sectionId, id: { not: current.id }, status: { in: ['submitted', 'approved'] },
          },
          select: { grossAmount: true },
        });
        const priorAggregateBase = money(sum(priorRows.map((row) => row.grossAmount)));
        const thresholdBasis = calculateTdsThresholdBasis({
          grossAmount: current.grossAmount,
          priorAggregateBase,
          singlePaymentThreshold: rateRow.singlePaymentThreshold,
          aggregateThreshold: rateRow.aggregateThreshold,
          thresholdApplication: rateRow.thresholdApplication,
        });
        const { aggregateAfter, singleHit, aggregateHit, taxableBase } = thresholdBasis;
        const appliedRate = classification.panStatus === 'valid'
          ? classification.overrideRate ?? rateRow.standardRate
          : Prisma.Decimal.max(rateRow.noPanRate, rateRow.standardRate);
        const deductionAmount = money(taxableBase.times(appliedRate).dividedBy(100));
        const priorSnapshot = current.calculationSnapshot as Record<string, unknown>;
        const finalSnapshot = {
          version: 1,
          calculationStage: 'submitted_final',
          grossBasisSource: 'user_entered_reviewed_basis',
          basisReviewedBy: context.membershipId,
          basisReviewedAt: new Date().toISOString(),
          financialYearId: current.financialYearId,
          vendorId: current.vendorId,
          sectionId: current.sectionId,
          classificationId: classification.id,
          rateId: rateRow.id,
          businessDate: day(current.businessDate),
          grossAmount: current.grossAmount.toString(),
          priorAggregateBase: priorAggregateBase.toString(),
          aggregateAfter: money(aggregateAfter).toString(),
          singlePaymentThreshold: rateRow.singlePaymentThreshold.toString(),
          aggregateThreshold: rateRow.aggregateThreshold.toString(),
          thresholdApplication: rateRow.thresholdApplication,
          thresholdBasisPolicy: 'incremental_current_excess_v1',
          priorAggregateExcess: thresholdBasis.priorAggregateExcess.toString(),
          aggregateExcess: thresholdBasis.aggregateExcess.toString(),
          singleHit,
          aggregateHit,
          panStatus: classification.panStatus,
          appliedRate: percent(appliedRate).toString(),
          taxableBase: money(taxableBase).toString(),
          deductionAmount: deductionAmount.toString(),
          payableVoucherId: payableSource.id,
          payableVendorBinding: sourceBinding.kind,
          supplierInvoiceId: sourceBinding.supplierInvoiceId,
          payableVoucherValue: payableVoucherValue.toString(),
          payableReservedBefore: payableReservedBefore.toString(),
          paymentVoucherId: payment?.id ?? null,
          notes: typeof priorSnapshot.notes === 'string' ? priorSnapshot.notes : '',
        };
        transitionData = {
          status: 'submitted', submittedAt: new Date(), priorAggregateBase,
          taxableBase: money(taxableBase), appliedRate: percent(appliedRate), deductionAmount,
          calculationSnapshot: json(finalSnapshot), evidenceHash: canonicalHash(finalSnapshot),
          rowVersion: { increment: 1 },
        };
      } else {
        assertMakerChecker(current.createdBy, context.membershipId, 'TDS deduction');
        await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.organizationId}:${legalEntityId}:tds-payable:${current.payableVoucherId}`}, 0))`);
        const { payable, payment } = await lockAndLoadTdsSources(db, legalEntityId, current.payableVoucherId, current.paymentVoucherId);
        assertTdsSourceOwnership({ payable, payment, paymentVoucherId: current.paymentVoucherId, vendorId: current.vendorId });
        const [classification, rateRow] = await Promise.all([
          db.erpVendorTdsClassification.findFirst({ where: {
            id: current.vendorClassificationId, legalEntityId, vendorId: current.vendorId,
            sectionId: current.sectionId, status: 'approved', effectiveFrom: { lte: current.businessDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: current.businessDate } }],
          } }),
          db.erpTdsRate.findFirst({ where: {
            id: current.rateId, legalEntityId, sectionId: current.sectionId, status: 'approved',
            effectiveFrom: { lte: current.businessDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: current.businessDate } }],
          } }),
        ]);
        if (!classification || !rateRow) throw new ApiError(409, 'tds_master_evidence_changed', 'The approved classification or effective rate is no longer active evidence.');
        transitionData = {
          status: 'approved', approvedBy: context.membershipId, approvedAt: new Date(), rowVersion: { increment: 1 },
        };
      }
      const changed = await db.erpTdsDeduction.updateMany({
        where: { id: deductionId, legalEntityId, status: expectedStatus, rowVersion: input.expectedRowVersion },
        data: transitionData,
      });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'TDS deduction changed while the transition was saved.');
      const row = await db.erpTdsDeduction.findUniqueOrThrow({ where: { id: deductionId } });
      await audit(db, { action: `mesaerp.tds.deduction.${action}`, entity: 'ErpTdsDeduction', entityId: row.id, before: deductionDto(current), after: deductionDto(row) });
      if (action === 'approve') await appendOutbox(db, context, legalEntityId, 'ErpTdsDeduction', row.id, 'mesaerp.tds-deduction.approved.v1', deductionDto(row));
      return deductionDto(row);
    } });
  }

  async report(legalEntityId: string, query: TdsReportQuery) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const rows = await db.erpTdsDeduction.findMany({
        where: {
          legalEntityId,
          ...(query.from || query.to ? { businessDate: { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) } } : {}),
          ...(query.vendorId ? { vendorId: query.vendorId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.sectionCode ? { section: { code: query.sectionCode.toUpperCase() } } : {}),
        },
        include: { vendor: { select: { vendorCode: true, legalName: true } }, section: { select: { code: true, name: true } } },
        orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }],
        take: 20000,
      });
      const totals = new Map<string, { sectionCode: string; grossAmount: Prisma.Decimal; taxableBase: Prisma.Decimal; deductionAmount: Prisma.Decimal }>();
      for (const row of rows) {
        const current = totals.get(row.section.code) ?? { sectionCode: row.section.code, grossAmount: new Prisma.Decimal(0), taxableBase: new Prisma.Decimal(0), deductionAmount: new Prisma.Decimal(0) };
        current.grossAmount = current.grossAmount.plus(row.grossAmount);
        current.taxableBase = current.taxableBase.plus(row.taxableBase);
        current.deductionAmount = current.deductionAmount.plus(row.deductionAmount);
        totals.set(row.section.code, current);
      }
      return {
        legalEntityId,
        filters: query,
        rows: rows.map((row) => ({ ...deductionDto(row), vendorCode: row.vendor.vendorCode, vendorName: row.vendor.legalName, sectionCode: row.section.code, sectionName: row.section.name })),
        totalsBySection: [...totals.values()].map((entry) => ({
          sectionCode: entry.sectionCode, grossAmount: money(entry.grossAmount).toString(),
          taxableBase: money(entry.taxableBase).toString(), deductionAmount: money(entry.deductionAmount).toString(),
        })),
        rowCount: rows.length,
        filingStatus: 'not_supported',
      };
    });
  }
}
