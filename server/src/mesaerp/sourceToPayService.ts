import { randomUUID } from 'node:crypto';
import { Prisma, type ErpMatchCase } from '@prisma/client';
import { basePrisma, tenantTx } from '../db';
import { audit } from '../lib/audit';
import { tenantContext, type TenantCtx } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import { hasMesaErpPermission } from './access';
import { hashCanonical } from './repository';
import { ensureDocumentPostingDraft } from './inventoryPosting';
import { requireSupplierInvoiceReleaseMatch } from './purchaseMatchControl';
import type {
  PurchaseMatchApprove,
  PurchaseMatchCreate,
  SourceToPayDocumentCreate,
  SourceToPayDocumentType,
  SourceToPayTransition,
} from './sourceToPaySchemas';

type Db = typeof basePrisma;

const documentInclude = {
  lines: { orderBy: { lineNumber: 'asc' as const } },
  outboundLinks: { orderBy: { createdAt: 'asc' as const } },
  inboundLinks: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ErpDocumentInclude;
type DocumentRow = Prisma.ErpDocumentGetPayload<{ include: typeof documentInclude }>;

const DOCUMENT_CODES: Record<SourceToPayDocumentType, string> = {
  purchase_requisition: 'PRQ',
  purchase_order: 'PO',
  goods_receipt: 'GRN',
  supplier_invoice: 'SINV',
};

const SOURCE_TYPES: Record<SourceToPayDocumentType, SourceToPayDocumentType[]> = {
  purchase_requisition: [],
  purchase_order: ['purchase_requisition'],
  goods_receipt: ['purchase_order'],
  supplier_invoice: ['purchase_order', 'goods_receipt'],
};

export interface SourceToPayDocumentLineDto {
  id: string;
  lineNumber: number;
  itemId?: string;
  description: string;
  hsnSacCode: string;
  quantity: string;
  uom: string;
  unitPrice: string;
  discountAmount: string;
  taxableAmount: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
  warehouseCode: string;
  batchNumber: string;
  promisedOn?: string;
  sourceLineId?: string;
  dimensions: unknown;
}

export interface SourceToPayDocumentDto {
  id: string;
  organizationId: string;
  legalEntityId: string;
  financialYearId: string;
  documentType: SourceToPayDocumentType;
  documentNumber: string;
  documentDate: string;
  dueDate?: string;
  status: 'draft' | 'submitted' | 'approved' | 'posted' | 'cancelled' | 'closed';
  approvalState: string;
  vendorId?: string;
  partySnapshot: unknown;
  currency: string;
  exchangeRate: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  roundingAmount: string;
  grandTotal: string;
  baseCurrencyTotal: string;
  taxSummary: unknown;
  terms: unknown;
  shipping: unknown;
  originType: string;
  originMetadata: unknown;
  rowVersion: number;
  createdBy: string;
  approvedBy?: string;
  submittedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  lines: SourceToPayDocumentLineDto[];
  links: Array<{ id: string; fromDocumentId: string; toDocumentId: string; relationship: string; snapshotHash: string }>;
}

export interface PurchaseMatchCaseDto {
  id: string;
  organizationId: string;
  legalEntityId: string;
  vendorId: string;
  supplierInvoiceId: string;
  purchaseOrderId: string;
  goodsReceiptId: string;
  status: 'pending' | 'matched' | 'variance' | 'disputed' | 'approved';
  quantityVariance: string;
  priceVariance: string;
  taxVariance: string;
  totalVariance: string;
  details: unknown;
  makerMembershipId: string;
  checkerMembershipId?: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface SourceToPayPermissionCheck {
  organizationId: string;
  membershipId: string;
  legalEntityId: string;
  permission: string;
}

export interface MesaErpSourceToPayService {
  hasPermission(input: SourceToPayPermissionCheck): Promise<boolean>;
  listDocuments(legalEntityId: string, documentType: SourceToPayDocumentType): Promise<SourceToPayDocumentDto[]>;
  getDocument(legalEntityId: string, documentType: SourceToPayDocumentType, documentId: string): Promise<SourceToPayDocumentDto>;
  createDocument(legalEntityId: string, documentType: SourceToPayDocumentType, input: SourceToPayDocumentCreate, idempotencyKey: string): Promise<SourceToPayDocumentDto>;
  submitDocument(legalEntityId: string, documentType: SourceToPayDocumentType, documentId: string, input: SourceToPayTransition, idempotencyKey: string): Promise<SourceToPayDocumentDto>;
  approveDocument(legalEntityId: string, documentType: SourceToPayDocumentType, documentId: string, input: SourceToPayTransition, idempotencyKey: string): Promise<SourceToPayDocumentDto>;
  listMatches(legalEntityId: string): Promise<PurchaseMatchCaseDto[]>;
  getMatch(legalEntityId: string, matchCaseId: string): Promise<PurchaseMatchCaseDto>;
  createMatch(legalEntityId: string, input: PurchaseMatchCreate, idempotencyKey: string): Promise<PurchaseMatchCaseDto>;
  approveMatch(legalEntityId: string, matchCaseId: string, input: PurchaseMatchApprove, idempotencyKey: string): Promise<PurchaseMatchCaseDto>;
}

function actor(): TenantCtx {
  const context = tenantContext.getStore();
  if (!context) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return context;
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function documentDto(document: DocumentRow): SourceToPayDocumentDto {
  const links = [...document.outboundLinks, ...document.inboundLinks]
    .map((link) => ({
      id: link.id,
      fromDocumentId: link.fromDocumentId,
      toDocumentId: link.toDocumentId,
      relationship: link.relationship,
      snapshotHash: link.snapshotHash,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    id: document.id,
    organizationId: document.organizationId,
    legalEntityId: document.legalEntityId,
    financialYearId: document.financialYearId,
    documentType: document.documentType as SourceToPayDocumentType,
    documentNumber: document.documentNumber,
    documentDate: day(document.documentDate),
    ...(document.dueDate ? { dueDate: day(document.dueDate) } : {}),
    status: document.status as SourceToPayDocumentDto['status'],
    approvalState: document.approvalState,
    ...(document.vendorId ? { vendorId: document.vendorId } : {}),
    partySnapshot: structuredClone(document.partySnapshot),
    currency: document.currency,
    exchangeRate: document.exchangeRate.toString(),
    subtotal: document.subtotal.toString(),
    discountTotal: document.discountTotal.toString(),
    taxTotal: document.taxTotal.toString(),
    roundingAmount: document.roundingAmount.toString(),
    grandTotal: document.grandTotal.toString(),
    baseCurrencyTotal: document.baseCurrencyTotal.toString(),
    taxSummary: structuredClone(document.taxSummary),
    terms: structuredClone(document.terms),
    shipping: structuredClone(document.shipping),
    originType: document.originType,
    originMetadata: structuredClone(document.originMetadata),
    rowVersion: document.rowVersion,
    createdBy: document.createdBy,
    ...(document.approvedBy ? { approvedBy: document.approvedBy } : {}),
    ...(document.submittedAt ? { submittedAt: document.submittedAt.toISOString() } : {}),
    ...(document.approvedAt ? { approvedAt: document.approvedAt.toISOString() } : {}),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    lines: document.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      ...(line.itemId ? { itemId: line.itemId } : {}),
      description: line.description,
      hsnSacCode: line.hsnSacCode,
      quantity: line.quantity.toString(),
      uom: line.uom,
      unitPrice: line.unitPrice.toString(),
      discountAmount: line.discountAmount.toString(),
      taxableAmount: line.taxableAmount.toString(),
      taxRate: line.taxRate.toString(),
      taxAmount: line.taxAmount.toString(),
      lineTotal: line.lineTotal.toString(),
      warehouseCode: line.warehouseCode,
      batchNumber: line.batchNumber,
      ...(line.promisedOn ? { promisedOn: day(line.promisedOn) } : {}),
      ...(line.sourceLineId ? { sourceLineId: line.sourceLineId } : {}),
      dimensions: structuredClone(line.dimensions),
    })),
    links,
  };
}

function matchDto(match: ErpMatchCase): PurchaseMatchCaseDto {
  return {
    id: match.id,
    organizationId: match.organizationId,
    legalEntityId: match.legalEntityId,
    vendorId: match.vendorId,
    supplierInvoiceId: match.supplierInvoiceId,
    purchaseOrderId: match.purchaseOrderId,
    goodsReceiptId: match.goodsReceiptId,
    status: match.status as PurchaseMatchCaseDto['status'],
    quantityVariance: match.quantityVariance.toString(),
    priceVariance: match.priceVariance.toString(),
    taxVariance: match.taxVariance.toString(),
    totalVariance: match.totalVariance.toString(),
    details: structuredClone(match.details),
    makerMembershipId: match.makerMembershipId,
    ...(match.checkerMembershipId ? { checkerMembershipId: match.checkerMembershipId } : {}),
    rowVersion: match.rowVersion,
    createdAt: match.createdAt.toISOString(),
    updatedAt: match.updatedAt.toISOString(),
  };
}

const zero = () => new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const quantity = (value: Prisma.Decimal) => value.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
const absolute = (value: Prisma.Decimal) => value.isNegative() ? value.negated() : value;
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), zero());
const MAX_DB_MONEY = new Prisma.Decimal('9999999999999999.99');

function checkedMoney(value: Prisma.Decimal, subject: string): Prisma.Decimal {
  const rounded = money(value);
  if (rounded.isNegative() || rounded.greaterThan(MAX_DB_MONEY)) {
    throw new ApiError(422, 'amount_out_of_range', `${subject} exceeds the supported 18,2 money range.`);
  }
  return rounded;
}

export function calculateSourceToPayTotals(input: SourceToPayDocumentCreate) {
  const lines = input.lines.map((line, index) => {
    const itemQuantity = new Prisma.Decimal(line.quantity);
    const unitPrice = new Prisma.Decimal(line.unitPrice);
    const discountAmount = new Prisma.Decimal(line.discountAmount);
    const gross = checkedMoney(itemQuantity.times(unitPrice), `Line ${index + 1} gross amount`);
    if (discountAmount.greaterThan(gross)) {
      throw new ApiError(422, 'discount_exceeds_line_value', `Line ${index + 1} discount exceeds its gross value.`);
    }
    const taxableAmount = checkedMoney(gross.minus(discountAmount), `Line ${index + 1} taxable amount`);
    const computedTax = checkedMoney(taxableAmount.times(new Prisma.Decimal(line.taxRate)).dividedBy(100), `Line ${index + 1} tax amount`);
    if (line.taxAmount !== undefined && !checkedMoney(new Prisma.Decimal(line.taxAmount), `Line ${index + 1} tax amount`).equals(computedTax)) {
      throw new ApiError(422, 'tax_amount_mismatch', `Line ${index + 1} tax amount does not match the server calculation.`);
    }
    const taxAmount = computedTax;
    const lineTotal = checkedMoney(taxableAmount.plus(taxAmount), `Line ${index + 1} total`);
    return { input: line, lineNumber: index + 1, gross, taxableAmount, taxAmount, lineTotal };
  });
  const subtotal = checkedMoney(sum(lines.map((line) => line.gross)), 'Document subtotal');
  const discountTotal = checkedMoney(sum(lines.map((line) => new Prisma.Decimal(line.input.discountAmount))), 'Document discount total');
  const taxTotal = checkedMoney(sum(lines.map((line) => line.taxAmount)), 'Document tax total');
  const grandTotal = checkedMoney(sum(lines.map((line) => line.lineTotal)), 'Document grand total');
  const baseCurrencyTotal = checkedMoney(grandTotal.times(new Prisma.Decimal(input.exchangeRate)), 'Document base-currency total');
  return { lines, subtotal, discountTotal, taxTotal, grandTotal, baseCurrencyTotal };
}

async function requireLegalEntity(db: Db, context: TenantCtx, legalEntityId: string) {
  const entity = await db.legalEntity.findFirst({
    where: { id: legalEntityId, organizationId: context.organizationId, status: 'active' },
  });
  if (!entity) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found.');
  return entity;
}

async function financialYearFor(db: Db, legalEntityId: string, documentDate: Date) {
  const year = await db.financialYear.findFirst({
    where: { legalEntityId, startsOn: { lte: documentDate }, endsOn: { gte: documentDate } },
  });
  if (!year) throw new ApiError(409, 'financial_year_missing', 'No financial year covers this document date.');
  if (year.status === 'locked') throw new ApiError(409, 'financial_year_locked', `Financial year ${year.code} is locked.`);
  return year;
}

async function allocateDocumentNumber(
  db: Db,
  context: TenantCtx,
  legalEntity: { id: string; code: string },
  financialYear: { id: string; code: string },
  documentType: SourceToPayDocumentType,
) {
  const seriesType = `document:${documentType}`;
  const prefix = `${legalEntity.code}-${DOCUMENT_CODES[documentType]}-${financialYear.code}-`;
  const rows = await db.$queryRaw<Array<{ nextValue: number }>>(Prisma.sql`
    INSERT INTO "ErpNumberSeries" (
      "id", "organizationId", "legalEntityId", "financialYearId", "documentType", "prefix", "padding", "nextValue", "createdAt", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${context.organizationId}, ${legalEntity.id}, ${financialYear.id}, ${seriesType}, ${prefix}, 6, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organizationId", "legalEntityId", "financialYearId", "documentType")
    DO UPDATE SET "nextValue" = "ErpNumberSeries"."nextValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "nextValue"
  `);
  const allocated = (rows[0]?.nextValue ?? 2) - 1;
  return `${prefix}${String(allocated).padStart(6, '0')}`;
}

async function replay<T>(db: Db, organizationId: string, scope: string, key: string, requestHash: string): Promise<T | null> {
  const existing = await db.erpIdempotencyRecord.findUnique({ where: { organizationId_scope_key: { organizationId, scope, key } } });
  if (!existing) return null;
  if (existing.requestHash !== requestHash) throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was already used with a different request.');
  return structuredClone(existing.response) as T;
}

async function remember(db: Db, context: TenantCtx, legalEntityId: string, scope: string, key: string, requestHash: string, response: unknown) {
  await db.erpIdempotencyRecord.create({
    data: { organizationId: context.organizationId, legalEntityId, scope, key, requestHash, response: json(response) },
  });
}

async function runIdempotent<T>(input: {
  legalEntityId: string;
  scope: string;
  key: string;
  payload: unknown;
  execute: (db: Db, context: TenantCtx) => Promise<T>;
}): Promise<T> {
  const context = actor();
  const requestHash = hashCanonical({ legalEntityId: input.legalEntityId, payload: input.payload });
  const executeOnce = () => tenantTx(async (db) => {
    const existing = await replay<T>(db, context.organizationId, input.scope, input.key, requestHash);
    if (existing) return existing;
    await requireLegalEntity(db, context, input.legalEntityId);
    const response = await input.execute(db, context);
    await remember(db, context, input.legalEntityId, input.scope, input.key, requestHash, response);
    return response;
  });
  try {
    return await executeOnce();
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    return tenantTx(async (db) => {
      const existing = await replay<T>(db, context.organizationId, input.scope, input.key, requestHash);
      if (existing) return existing;
      throw error;
    });
  }
}

async function appendOutbox(db: Db, context: TenantCtx, legalEntityId: string, aggregateType: string, aggregateId: string, eventType: string, payload: unknown) {
  const payloadHash = hashCanonical(payload);
  await db.integrationOutboxEvent.create({
    data: {
      organizationId: context.organizationId,
      legalEntityId,
      serviceId: 'mesaerp',
      aggregateType,
      aggregateId,
      eventType,
      correlationId: randomUUID(),
      payload: json(payload),
      payloadHash,
    },
  });
  return payloadHash;
}

export function assertSeparateDocumentApprover(makerMembershipId: string, checkerMembershipId: string, subject = 'Document'): void {
  if (makerMembershipId && makerMembershipId === checkerMembershipId) {
    throw new ApiError(409, 'maker_checker_required', `${subject} maker cannot approve the same record.`);
  }
}

export interface ThreeWayMatchResult {
  matched: boolean;
  quantityVariance: string;
  priceVariance: string;
  taxVariance: string;
  totalVariance: string;
  details: Array<Record<string, unknown>>;
}

function associatedLines(
  source: SourceToPayDocumentLineDto[],
  purchaseOrderLines: SourceToPayDocumentLineDto[],
  purchaseOrderLine: SourceToPayDocumentLineDto,
  receiptLines: SourceToPayDocumentLineDto[] = [],
) {
  const receiptIds = new Set(receiptLines
    .filter((line) => line.sourceLineId === purchaseOrderLine.id || (line.itemId && line.itemId === purchaseOrderLine.itemId))
    .map((line) => line.id));
  const uniqueItem = Boolean(purchaseOrderLine.itemId)
    && purchaseOrderLines.filter((line) => line.itemId === purchaseOrderLine.itemId).length === 1;
  return source.filter((line) => (
    line.sourceLineId === purchaseOrderLine.id
    || Boolean(line.sourceLineId && receiptIds.has(line.sourceLineId))
    || Boolean(uniqueItem && line.itemId === purchaseOrderLine.itemId)
    || (!line.sourceLineId && !line.itemId && line.lineNumber === purchaseOrderLine.lineNumber)
  ));
}

export function calculateThreeWayMatch(
  purchaseOrderLines: SourceToPayDocumentLineDto[],
  goodsReceiptLines: SourceToPayDocumentLineDto[],
  supplierInvoiceLines: SourceToPayDocumentLineDto[],
): ThreeWayMatchResult {
  let quantityVariance = zero();
  let priceVariance = zero();
  let taxVariance = zero();
  let totalVariance = zero();
  let structuralVariance = false;
  const matchedReceiptIds = new Set<string>();
  const matchedInvoiceIds = new Set<string>();
  const details: Array<Record<string, unknown>> = [];

  for (const orderLine of purchaseOrderLines) {
    const receipts = associatedLines(goodsReceiptLines, purchaseOrderLines, orderLine);
    const invoices = associatedLines(supplierInvoiceLines, purchaseOrderLines, orderLine, receipts);
    receipts.forEach((line) => matchedReceiptIds.add(line.id));
    invoices.forEach((line) => matchedInvoiceIds.add(line.id));

    const orderedQuantity = new Prisma.Decimal(orderLine.quantity);
    const receivedQuantity = sum(receipts.map((line) => new Prisma.Decimal(line.quantity)));
    const invoicedQuantity = sum(invoices.map((line) => new Prisma.Decimal(line.quantity)));
    const receiptOverOrder = Prisma.Decimal.max(receivedQuantity.minus(orderedQuantity), zero());
    const invoiceOverReceipt = Prisma.Decimal.max(invoicedQuantity.minus(receivedQuantity), zero());
    const lineQuantityVariance = quantity(receiptOverOrder.plus(invoiceOverReceipt));

    const orderRate = new Prisma.Decimal(orderLine.unitPrice);
    const actualInvoiceGross = money(sum(invoices.map((line) => new Prisma.Decimal(line.quantity).times(line.unitPrice))));
    const expectedInvoiceGross = money(invoicedQuantity.times(orderRate));
    const linePriceVariance = money(absolute(actualInvoiceGross.minus(expectedInvoiceGross)));
    const invoiceDiscount = money(sum(invoices.map((line) => new Prisma.Decimal(line.discountAmount))));
    const expectedTaxable = Prisma.Decimal.max(money(expectedInvoiceGross.minus(invoiceDiscount)), zero());
    const expectedTax = money(expectedTaxable.times(orderLine.taxRate).dividedBy(100));
    const actualTax = money(sum(invoices.map((line) => new Prisma.Decimal(line.taxAmount))));
    const lineTaxVariance = money(absolute(actualTax.minus(expectedTax)));
    const expectedTotal = money(expectedTaxable.plus(expectedTax));
    const actualTotal = money(sum(invoices.map((line) => new Prisma.Decimal(line.lineTotal))));
    const lineTotalVariance = money(absolute(actualTotal.minus(expectedTotal)));
    const uomMismatch = [...receipts, ...invoices].some((line) => line.uom !== orderLine.uom);
    const taxRateMismatch = invoices.some((line) => !new Prisma.Decimal(line.taxRate).equals(orderLine.taxRate));

    quantityVariance = quantity(quantityVariance.plus(lineQuantityVariance));
    priceVariance = money(priceVariance.plus(linePriceVariance));
    taxVariance = money(taxVariance.plus(lineTaxVariance));
    totalVariance = money(totalVariance.plus(lineTotalVariance));
    structuralVariance ||= uomMismatch || taxRateMismatch;
    details.push({
      purchaseOrderLineId: orderLine.id,
      lineNumber: orderLine.lineNumber,
      itemId: orderLine.itemId ?? '',
      description: orderLine.description,
      orderedQuantity: orderedQuantity.toString(),
      receivedQuantity: receivedQuantity.toString(),
      invoicedQuantity: invoicedQuantity.toString(),
      receiptOverOrder: receiptOverOrder.toString(),
      invoiceOverReceipt: invoiceOverReceipt.toString(),
      orderRate: orderRate.toString(),
      invoiceGross: actualInvoiceGross.toString(),
      priceVariance: linePriceVariance.toString(),
      expectedTax: expectedTax.toString(),
      invoiceTax: actualTax.toString(),
      taxVariance: lineTaxVariance.toString(),
      expectedTotal: expectedTotal.toString(),
      invoiceTotal: actualTotal.toString(),
      totalVariance: lineTotalVariance.toString(),
      uomMismatch,
      taxRateMismatch,
    });
  }

  const unmatchedReceiptLines = goodsReceiptLines.filter((line) => !matchedReceiptIds.has(line.id)).map((line) => line.id);
  const unmatchedInvoiceLines = supplierInvoiceLines.filter((line) => !matchedInvoiceIds.has(line.id)).map((line) => line.id);
  if (unmatchedReceiptLines.length || unmatchedInvoiceLines.length) {
    structuralVariance = true;
    details.push({ kind: 'unmatched_lines', goodsReceiptLineIds: unmatchedReceiptLines, supplierInvoiceLineIds: unmatchedInvoiceLines });
  }
  const matched = !structuralVariance
    && quantityVariance.isZero()
    && priceVariance.isZero()
    && taxVariance.isZero()
    && totalVariance.isZero();
  return {
    matched,
    quantityVariance: quantityVariance.toString(),
    priceVariance: priceVariance.toString(),
    taxVariance: taxVariance.toString(),
    totalVariance: totalVariance.toString(),
    details,
  };
}

export class PrismaMesaErpSourceToPayService implements MesaErpSourceToPayService {
  hasPermission(input: SourceToPayPermissionCheck): Promise<boolean> {
    return hasMesaErpPermission(input);
  }

  async listDocuments(legalEntityId: string, documentType: SourceToPayDocumentType): Promise<SourceToPayDocumentDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context, legalEntityId);
      const documents = await db.erpDocument.findMany({
        where: { organizationId: context.organizationId, legalEntityId, documentType },
        include: documentInclude,
        orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
        take: 250,
      });
      return documents.map(documentDto);
    });
  }

  async getDocument(legalEntityId: string, documentType: SourceToPayDocumentType, documentId: string): Promise<SourceToPayDocumentDto> {
    const context = actor();
    return tenantTx(async (db) => {
      const document = await db.erpDocument.findFirst({
        where: { id: documentId, organizationId: context.organizationId, legalEntityId, documentType },
        include: documentInclude,
      });
      if (!document) throw new ApiError(404, 'document_not_found', 'Source-to-pay document not found.');
      return documentDto(document);
    });
  }

  createDocument(
    legalEntityId: string,
    documentType: SourceToPayDocumentType,
    input: SourceToPayDocumentCreate,
    idempotencyKey: string,
  ): Promise<SourceToPayDocumentDto> {
    return runIdempotent({
      legalEntityId,
      scope: `source-to-pay:${documentType}:create:${legalEntityId}`,
      key: idempotencyKey,
      payload: { documentType, input },
      execute: async (db, context) => {
        const legalEntity = await requireLegalEntity(db, context, legalEntityId);
        const documentDate = dateOnly(input.documentDate);
        const financialYear = await financialYearFor(db, legalEntityId, documentDate);
        let vendorId = input.vendorId;
        let sourceDocument: DocumentRow | null = null;
        if (input.sourceDocumentId) {
          sourceDocument = await db.erpDocument.findFirst({
            where: { id: input.sourceDocumentId, organizationId: context.organizationId, legalEntityId },
            include: documentInclude,
          });
          if (!sourceDocument) throw new ApiError(404, 'source_document_not_found', 'Source document not found in this company.');
          if (!SOURCE_TYPES[documentType].includes(sourceDocument.documentType as SourceToPayDocumentType)) {
            throw new ApiError(422, 'invalid_source_document', `${sourceDocument.documentType} cannot source a ${documentType}.`);
          }
          if (sourceDocument.status !== 'approved') throw new ApiError(409, 'source_document_not_approved', 'The selected source document must be approved.');
          if (vendorId && sourceDocument.vendorId && vendorId !== sourceDocument.vendorId) {
            throw new ApiError(422, 'vendor_source_mismatch', 'Vendor does not match the approved source document.');
          }
          vendorId ||= sourceDocument.vendorId ?? undefined;
          const sourceLineIds = new Set(sourceDocument.lines.map((line) => line.id));
          const foreignLine = input.lines.find((line) => line.sourceLineId && !sourceLineIds.has(line.sourceLineId));
          if (foreignLine) throw new ApiError(422, 'source_line_mismatch', 'A source line does not belong to the selected source document.');
        } else if (input.lines.some((line) => line.sourceLineId)) {
          throw new ApiError(422, 'source_document_required', 'sourceDocumentId is required when a line carries sourceLineId.');
        }

        if (documentType !== 'purchase_requisition' && !vendorId) {
          throw new ApiError(422, 'vendor_required', `Vendor is required for ${documentType}.`);
        }
        const vendor = vendorId ? await db.erpVendor.findFirst({
          where: { id: vendorId, organizationId: context.organizationId, legalEntityId },
        }) : null;
        if (vendorId && !vendor) throw new ApiError(404, 'vendor_not_found', 'Vendor not found in this company.');
        if (vendor?.lifecycleStatus === 'blocked') throw new ApiError(409, 'vendor_blocked', 'Blocked vendors cannot be used for new source-to-pay documents.');
        if (documentType === 'purchase_order' && vendor && !['approved', 'conditionally_approved'].includes(vendor.lifecycleStatus)) {
          throw new ApiError(409, 'vendor_not_approved', 'Purchase orders require an approved or conditionally approved vendor.');
        }

        const itemIds = [...new Set(input.lines.flatMap((line) => line.itemId ? [line.itemId] : []))];
        if (itemIds.length) {
          const items = await db.erpItem.findMany({ where: { legalEntityId, active: true, id: { in: itemIds } }, select: { id: true } });
          if (items.length !== itemIds.length) throw new ApiError(422, 'item_not_found', 'One or more line items are not active in this company.');
        }
        const totals = calculateSourceToPayTotals(input);
        const documentNumber = input.documentNumber ?? await allocateDocumentNumber(db, context, legalEntity, financialYear, documentType);
        const duplicate = await db.erpDocument.findFirst({
          where: { legalEntityId, financialYearId: financialYear.id, documentType, documentNumber }, select: { id: true },
        });
        if (duplicate) throw new ApiError(409, 'document_number_exists', 'This document number already exists in the financial year.');
        const partySnapshot = vendor ? {
          vendorCode: vendor.vendorCode,
          legalName: vendor.legalName,
          tradeName: vendor.tradeName,
          gstin: vendor.gstin,
          paymentTerms: vendor.paymentTerms,
        } : {};
        const document = await db.erpDocument.create({
          data: {
            organizationId: context.organizationId,
            legalEntityId,
            financialYearId: financialYear.id,
            documentType,
            documentNumber,
            documentDate,
            dueDate: input.dueDate ? dateOnly(input.dueDate) : null,
            vendorId: vendorId ?? null,
            partySnapshot: json(partySnapshot),
            currency: input.currency,
            exchangeRate: input.exchangeRate,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            taxTotal: totals.taxTotal,
            grandTotal: totals.grandTotal,
            baseCurrencyTotal: totals.baseCurrencyTotal,
            taxSummary: json({ total: totals.taxTotal.toString() }),
            terms: json(input.terms),
            shipping: json(input.shipping),
            originType: input.originType,
            originMetadata: json(input.originMetadata),
            createIdempotencyKey: `${documentType}:${idempotencyKey}`,
            requestHash: hashCanonical({ documentType, input }),
            createdBy: context.membershipId,
          },
          include: documentInclude,
        });
        await db.erpDocumentLine.createMany({
          data: totals.lines.map((line) => ({
            organizationId: context.organizationId,
            legalEntityId,
            documentId: document.id,
            lineNumber: line.lineNumber,
            itemId: line.input.itemId ?? null,
            description: line.input.description,
            hsnSacCode: line.input.hsnSacCode,
            quantity: line.input.quantity,
            uom: line.input.uom,
            unitPrice: line.input.unitPrice,
            discountAmount: line.input.discountAmount,
            taxableAmount: line.taxableAmount,
            taxRate: line.input.taxRate,
            taxAmount: line.taxAmount,
            lineTotal: line.lineTotal,
            warehouseCode: line.input.warehouseCode,
            batchNumber: line.input.batchNumber,
            promisedOn: line.input.promisedOn ? dateOnly(line.input.promisedOn) : null,
            sourceLineId: line.input.sourceLineId ?? null,
            dimensions: json(line.input.dimensions),
          })),
        });
        if (sourceDocument) {
          await db.erpDocumentLink.create({
            data: {
              organizationId: context.organizationId,
              legalEntityId,
              fromDocumentId: sourceDocument.id,
              toDocumentId: document.id,
              relationship: `${sourceDocument.documentType}_to_${documentType}`,
              snapshotHash: hashCanonical(documentDto(sourceDocument)),
            },
          });
        }
        const persisted = await db.erpDocument.findUniqueOrThrow({ where: { id: document.id }, include: documentInclude });
        const response = documentDto(persisted);
        await audit(db, { action: `mesaerp.${documentType}.create`, entity: 'ErpDocument', entityId: document.id, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpDocument', document.id, `mesaerp.${documentType}.created.v1`, response);
        return response;
      },
    });
  }

  submitDocument(legalEntityId: string, documentType: SourceToPayDocumentType, documentId: string, input: SourceToPayTransition, idempotencyKey: string) {
    return this.transitionDocument(legalEntityId, documentType, documentId, 'submit', input, idempotencyKey);
  }

  approveDocument(legalEntityId: string, documentType: SourceToPayDocumentType, documentId: string, input: SourceToPayTransition, idempotencyKey: string) {
    return this.transitionDocument(legalEntityId, documentType, documentId, 'approve', input, idempotencyKey);
  }

  private transitionDocument(
    legalEntityId: string,
    documentType: SourceToPayDocumentType,
    documentId: string,
    action: 'submit' | 'approve',
    input: SourceToPayTransition,
    idempotencyKey: string,
  ): Promise<SourceToPayDocumentDto> {
    return runIdempotent({
      legalEntityId,
      scope: `source-to-pay:document:${documentId}:${action}`,
      key: idempotencyKey,
      payload: { documentType, documentId, action, input },
      execute: async (db, context) => {
        const existing = await db.erpDocument.findFirst({
          where: { id: documentId, organizationId: context.organizationId, legalEntityId, documentType },
          include: documentInclude,
        });
        if (!existing) throw new ApiError(404, 'document_not_found', 'Source-to-pay document not found.');
        if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Document changed since it was loaded.');
        const expectedStatus = action === 'submit' ? 'draft' : 'submitted';
        if (existing.status !== expectedStatus) {
          throw new ApiError(409, `document_not_${action === 'submit' ? 'submittable' : 'approvable'}`, `Document is ${existing.status}.`);
        }
        if (action === 'approve') assertSeparateDocumentApprover(existing.createdBy, context.membershipId);
        if (action === 'approve' && documentType === 'supplier_invoice') {
          await requireSupplierInvoiceReleaseMatch(db, {
            organizationId: context.organizationId,
            legalEntityId,
            supplierInvoiceId: existing.id,
            vendorId: existing.vendorId,
          });
        }
        const now = new Date();
        const changed = await db.erpDocument.updateMany({
          where: { id: existing.id, legalEntityId, documentType, status: expectedStatus, rowVersion: input.expectedRowVersion },
          data: action === 'submit'
            ? { status: 'submitted', approvalState: 'pending', submittedAt: now, rowVersion: { increment: 1 } }
            : { status: 'approved', approvalState: 'approved', approvedAt: now, approvedBy: context.membershipId, rowVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Document changed while the transition was being saved.');
        const updated = await db.erpDocument.findUniqueOrThrow({ where: { id: existing.id }, include: documentInclude });
        if (action === 'approve') await ensureDocumentPostingDraft(db, context, updated);
        const before = documentDto(existing);
        const response = documentDto(updated);
        await audit(db, { action: `mesaerp.${documentType}.${action}`, entity: 'ErpDocument', entityId: existing.id, before, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpDocument', existing.id, `mesaerp.${documentType}.${action === 'submit' ? 'submitted' : 'approved'}.v1`, response);
        return response;
      },
    });
  }

  async listMatches(legalEntityId: string): Promise<PurchaseMatchCaseDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context, legalEntityId);
      const matches = await db.erpMatchCase.findMany({
        where: { organizationId: context.organizationId, legalEntityId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 250,
      });
      return matches.map(matchDto);
    });
  }

  async getMatch(legalEntityId: string, matchCaseId: string): Promise<PurchaseMatchCaseDto> {
    const context = actor();
    return tenantTx(async (db) => {
      const match = await db.erpMatchCase.findFirst({
        where: { id: matchCaseId, organizationId: context.organizationId, legalEntityId },
      });
      if (!match) throw new ApiError(404, 'match_case_not_found', 'Purchase match case not found.');
      return matchDto(match);
    });
  }

  createMatch(legalEntityId: string, input: PurchaseMatchCreate, idempotencyKey: string): Promise<PurchaseMatchCaseDto> {
    return runIdempotent({
      legalEntityId,
      scope: `source-to-pay:match:create:${input.supplierInvoiceId}`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const documents = await db.erpDocument.findMany({
          where: {
            organizationId: context.organizationId,
            legalEntityId,
            id: { in: [input.purchaseOrderId, input.goodsReceiptId, input.supplierInvoiceId] },
          },
          include: documentInclude,
        });
        const byId = new Map(documents.map((document) => [document.id, document]));
        const purchaseOrder = byId.get(input.purchaseOrderId);
        const goodsReceipt = byId.get(input.goodsReceiptId);
        const supplierInvoice = byId.get(input.supplierInvoiceId);
        if (!purchaseOrder || !goodsReceipt || !supplierInvoice) throw new ApiError(404, 'match_document_not_found', 'One or more match documents were not found in this company.');
        if (purchaseOrder.documentType !== 'purchase_order' || goodsReceipt.documentType !== 'goods_receipt' || supplierInvoice.documentType !== 'supplier_invoice') {
          throw new ApiError(422, 'match_document_type_invalid', 'Match requires one purchase order, one goods receipt and one supplier invoice.');
        }
        if (purchaseOrder.status !== 'approved' || goodsReceipt.status !== 'approved' || !['submitted', 'approved'].includes(supplierInvoice.status)) {
          throw new ApiError(409, 'match_documents_not_ready', 'Purchase order and goods receipt must be approved; supplier invoice must be submitted or approved.');
        }
        if (!purchaseOrder.vendorId || purchaseOrder.vendorId !== goodsReceipt.vendorId || purchaseOrder.vendorId !== supplierInvoice.vendorId) {
          throw new ApiError(422, 'match_vendor_mismatch', 'All three documents must carry the same vendor.');
        }
        const purchaseOrderLineIds = new Set(purchaseOrder.lines.map((line) => line.id));
        const goodsReceiptLineIds = new Set(goodsReceipt.lines.map((line) => line.id));
        const receiptReferencesOrder = goodsReceipt.inboundLinks.some((link) => link.fromDocumentId === purchaseOrder.id)
          || goodsReceipt.lines.some((line) => Boolean(line.sourceLineId && purchaseOrderLineIds.has(line.sourceLineId)));
        const invoiceReferencesReceiptOrOrder = supplierInvoice.inboundLinks.some((link) => (
          link.fromDocumentId === purchaseOrder.id || link.fromDocumentId === goodsReceipt.id
        )) || supplierInvoice.lines.some((line) => Boolean(
          line.sourceLineId
          && (purchaseOrderLineIds.has(line.sourceLineId) || goodsReceiptLineIds.has(line.sourceLineId)),
        ));
        if (!receiptReferencesOrder || !invoiceReferencesReceiptOrOrder) {
          throw new ApiError(
            422,
            'match_document_lineage_invalid',
            'The goods receipt and supplier invoice must carry source links to the selected purchase order or receipt.',
          );
        }
        const existing = await db.erpMatchCase.findFirst({ where: { supplierInvoiceId: supplierInvoice.id } });
        if (existing) throw new ApiError(409, 'match_case_exists', 'This supplier invoice already has a match case.');
        const comparison = calculateThreeWayMatch(
          documentDto(purchaseOrder).lines,
          documentDto(goodsReceipt).lines,
          documentDto(supplierInvoice).lines,
        );
        const match = await db.erpMatchCase.create({
          data: {
            organizationId: context.organizationId,
            legalEntityId,
            vendorId: purchaseOrder.vendorId,
            supplierInvoiceId: supplierInvoice.id,
            purchaseOrderId: purchaseOrder.id,
            goodsReceiptId: goodsReceipt.id,
            status: comparison.matched ? 'matched' : 'variance',
            quantityVariance: comparison.quantityVariance,
            priceVariance: comparison.priceVariance,
            taxVariance: comparison.taxVariance,
            totalVariance: comparison.totalVariance,
            details: comparison.details as Prisma.InputJsonValue,
            makerMembershipId: context.membershipId,
          },
        });
        const response = matchDto(match);
        await audit(db, { action: 'mesaerp.purchase.match.evaluate', entity: 'ErpMatchCase', entityId: match.id, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpMatchCase', match.id, 'mesaerp.purchase.match.evaluated.v1', response);
        return response;
      },
    });
  }

  approveMatch(legalEntityId: string, matchCaseId: string, input: PurchaseMatchApprove, idempotencyKey: string): Promise<PurchaseMatchCaseDto> {
    return runIdempotent({
      legalEntityId,
      scope: `source-to-pay:match:${matchCaseId}:approve`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const existing = await db.erpMatchCase.findFirst({
          where: { id: matchCaseId, organizationId: context.organizationId, legalEntityId },
        });
        if (!existing) throw new ApiError(404, 'match_case_not_found', 'Purchase match case not found.');
        if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Match case changed since it was loaded.');
        if (!['variance', 'disputed'].includes(existing.status)) throw new ApiError(409, 'match_not_approvable', `Match case is ${existing.status}.`);
        assertSeparateDocumentApprover(existing.makerMembershipId, context.membershipId, 'Match case');
        const previousDetails = Array.isArray(existing.details) ? existing.details : [];
        const approval = { kind: 'variance_approval', reason: input.reason, checkerMembershipId: context.membershipId, at: new Date().toISOString() };
        const changed = await db.erpMatchCase.updateMany({
          where: { id: existing.id, legalEntityId, status: { in: ['variance', 'disputed'] }, rowVersion: input.expectedRowVersion },
          data: {
            status: 'approved',
            checkerMembershipId: context.membershipId,
            details: [...previousDetails, approval] as Prisma.InputJsonValue,
            rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Match case changed while approval was being saved.');
        const updated = await db.erpMatchCase.findUniqueOrThrow({ where: { id: existing.id } });
        const before = matchDto(existing);
        const response = matchDto(updated);
        await audit(db, { action: 'mesaerp.purchase.match.approve', entity: 'ErpMatchCase', entityId: existing.id, before, after: { ...response, reason: input.reason } });
        await appendOutbox(db, context, legalEntityId, 'ErpMatchCase', existing.id, 'mesaerp.purchase.match.approved.v1', response);
        return response;
      },
    });
  }
}
