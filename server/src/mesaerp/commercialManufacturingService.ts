import { randomUUID } from 'node:crypto';
import { Prisma, type ErpBatchCost, type ErpCustomer, type ErpManufacturingVoucher, type ErpProductionDemand } from '@prisma/client';
import { basePrisma, tenantTx } from '../db';
import { audit } from '../lib/audit';
import { tenantContext, type TenantCtx } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import { hasMesaErpPermission } from './access';
import { hashCanonical } from './repository';
import { ensureDocumentPostingDraft, ensureManufacturingPostingDraft, requirePostedSourcePosting } from './inventoryPosting';
import type {
  CustomerCreate,
  CustomerUpdate,
  ManufacturingValuedLine,
  ManufacturingVoucherCreate,
  ProductionDemandCreate,
  RowVersionTransition,
  SalesDocumentCreate,
  SalesDocumentType,
} from './commercialManufacturingSchemas';

type Db = typeof basePrisma;

const documentInclude = {
  lines: { orderBy: { lineNumber: 'asc' as const } },
  outboundLinks: { orderBy: { createdAt: 'asc' as const } },
  inboundLinks: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ErpDocumentInclude;
type DocumentRow = Prisma.ErpDocumentGetPayload<{ include: typeof documentInclude }>;

export interface PermissionCheck {
  organizationId: string;
  membershipId: string;
  legalEntityId: string;
  permission: string;
}

export interface CustomerDto {
  id: string;
  organizationId: string;
  legalEntityId: string;
  customerCode: string;
  legalName: string;
  tradeName: string;
  pan: string;
  gstin: string;
  addresses: unknown;
  contacts: unknown;
  paymentTerms: string;
  currency: string;
  creditLimit: string;
  creditDays: number;
  status: 'active' | 'on_hold' | 'blocked';
  rowVersion: number;
  originMetadata: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface SalesLineDto {
  id: string;
  lineNumber: number;
  itemId: string;
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

export interface SalesDocumentDto {
  id: string;
  organizationId: string;
  legalEntityId: string;
  financialYearId: string;
  documentType: SalesDocumentType;
  documentNumber: string;
  documentDate: string;
  dueDate?: string;
  status: 'draft' | 'submitted' | 'approved';
  approvalState: string;
  customerId: string;
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
  sourceSnapshotHash: string;
  rowVersion: number;
  createdBy: string;
  approvedBy?: string;
  submittedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  lines: SalesLineDto[];
  links: Array<{ id: string; fromDocumentId: string; toDocumentId: string; relationship: string; snapshotHash: string }>;
}

export interface ProductionDemandDto {
  id: string;
  organizationId: string;
  legalEntityId: string;
  financialYearId: string;
  demandNumber: string;
  demandType: string;
  itemId: string;
  quantity: string;
  uom: string;
  requiredOn?: string;
  status: 'draft' | 'approved' | 'released' | 'partially_completed' | 'completed' | 'cancelled';
  bomSnapshot: unknown;
  materialRequirements: unknown;
  suggestions: unknown;
  originType: string;
  originMetadata: unknown;
  sourceSnapshotHash: string;
  rowVersion: number;
  makerMembershipId: string;
  approvedBy?: string;
  releasedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManufacturingVoucherDto {
  id: string;
  organizationId: string;
  legalEntityId: string;
  financialYearId: string;
  productionDemandId?: string;
  voucherNumber: string;
  voucherType: string;
  businessDate: string;
  status: 'draft' | 'submitted' | 'approved' | 'posted';
  batchNumber: string;
  materialLines: unknown;
  outputLines: unknown;
  laborLines: unknown;
  resourceLines: unknown;
  overheadLines: unknown;
  subcontractLines: unknown;
  recoveryCredits: unknown;
  qaDisposition: unknown;
  materialValue: string;
  conversionValue: string;
  recoveryValue: string;
  actualCost: string;
  originType: string;
  originMetadata: unknown;
  sourceSnapshotHash: string;
  rowVersion: number;
  makerMembershipId: string;
  approvedBy?: string;
  postedBy?: string;
  approvedAt?: string;
  postedAt?: string;
  createdAt: string;
  updatedAt: string;
  batchCost?: BatchCostDto;
}

export interface BatchCostDto {
  id: string;
  organizationId: string;
  legalEntityId: string;
  financialYearId: string;
  productionDemandId?: string;
  manufacturingVoucherId: string;
  batchNumber: string;
  materialCost: string;
  laborCost: string;
  machineCost: string;
  overheadCost: string;
  subcontractCost: string;
  recoveryCredits: string;
  actualCost: string;
  outputQuantity: string;
  unitCost: string;
  costingMethod: string;
  calculationSnapshot: unknown;
  status: 'approved';
  sourceSnapshotHash: string;
  approvedAt?: string;
  approvedBy: string;
  createdAt: string;
}

export interface MesaErpCommercialManufacturingService {
  hasPermission(input: PermissionCheck): Promise<boolean>;
  listCustomers(legalEntityId: string): Promise<CustomerDto[]>;
  getCustomer(legalEntityId: string, customerId: string): Promise<CustomerDto>;
  createCustomer(legalEntityId: string, input: CustomerCreate, idempotencyKey: string): Promise<CustomerDto>;
  updateCustomer(legalEntityId: string, customerId: string, input: CustomerUpdate, idempotencyKey: string): Promise<CustomerDto>;
  listSalesDocuments(legalEntityId: string, type: SalesDocumentType): Promise<SalesDocumentDto[]>;
  getSalesDocument(legalEntityId: string, type: SalesDocumentType, documentId: string): Promise<SalesDocumentDto>;
  createSalesDocument(legalEntityId: string, type: SalesDocumentType, input: SalesDocumentCreate, idempotencyKey: string): Promise<SalesDocumentDto>;
  transitionSalesDocument(legalEntityId: string, type: SalesDocumentType, documentId: string, action: 'submit' | 'approve', input: RowVersionTransition, idempotencyKey: string): Promise<SalesDocumentDto>;
  listProductionDemands(legalEntityId: string): Promise<ProductionDemandDto[]>;
  getProductionDemand(legalEntityId: string, demandId: string): Promise<ProductionDemandDto>;
  createProductionDemand(legalEntityId: string, input: ProductionDemandCreate, idempotencyKey: string): Promise<ProductionDemandDto>;
  transitionProductionDemand(legalEntityId: string, demandId: string, action: 'approve' | 'release', input: RowVersionTransition, idempotencyKey: string): Promise<ProductionDemandDto>;
  listManufacturingVouchers(legalEntityId: string): Promise<ManufacturingVoucherDto[]>;
  getManufacturingVoucher(legalEntityId: string, voucherId: string): Promise<ManufacturingVoucherDto>;
  createManufacturingVoucher(legalEntityId: string, input: ManufacturingVoucherCreate, idempotencyKey: string): Promise<ManufacturingVoucherDto>;
  transitionManufacturingVoucher(legalEntityId: string, voucherId: string, action: 'submit' | 'approve' | 'post', input: RowVersionTransition, idempotencyKey: string): Promise<ManufacturingVoucherDto>;
  listBatchCosts(legalEntityId: string): Promise<BatchCostDto[]>;
  getBatchCost(legalEntityId: string, batchCostId: string): Promise<BatchCostDto>;
}

function actor(): TenantCtx {
  const context = tenantContext.getStore();
  if (!context) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return context;
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) as Record<string, unknown> : {};
}

function control(value: unknown): Record<string, unknown> {
  const metadata = record(value);
  return record(metadata.mesaerpControl);
}

function withControl(metadata: unknown, patch: Record<string, unknown>): Prisma.InputJsonValue {
  const source = record(metadata);
  return json({ ...source, mesaerpControl: { ...control(source), ...patch } });
}

function customerDto(row: ErpCustomer): CustomerDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    legalEntityId: row.legalEntityId,
    customerCode: row.customerCode,
    legalName: row.legalName,
    tradeName: row.tradeName,
    pan: row.pan,
    gstin: row.gstin,
    addresses: structuredClone(row.addresses),
    contacts: structuredClone(row.contacts),
    paymentTerms: row.paymentTerms,
    currency: row.currency,
    creditLimit: row.creditLimit.toString(),
    creditDays: row.creditDays,
    status: row.status as CustomerDto['status'],
    rowVersion: row.rowVersion,
    originMetadata: structuredClone(row.originMetadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function salesDocumentDto(row: DocumentRow): SalesDocumentDto {
  const links = [...row.outboundLinks, ...row.inboundLinks]
    .map((link) => ({
      id: link.id,
      fromDocumentId: link.fromDocumentId,
      toDocumentId: link.toDocumentId,
      relationship: link.relationship,
      snapshotHash: link.snapshotHash,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    id: row.id,
    organizationId: row.organizationId,
    legalEntityId: row.legalEntityId,
    financialYearId: row.financialYearId,
    documentType: row.documentType as SalesDocumentType,
    documentNumber: row.documentNumber,
    documentDate: day(row.documentDate),
    ...(row.dueDate ? { dueDate: day(row.dueDate) } : {}),
    status: row.status as SalesDocumentDto['status'],
    approvalState: row.approvalState,
    customerId: row.customerId ?? '',
    partySnapshot: structuredClone(row.partySnapshot),
    currency: row.currency,
    exchangeRate: row.exchangeRate.toString(),
    subtotal: row.subtotal.toString(),
    discountTotal: row.discountTotal.toString(),
    taxTotal: row.taxTotal.toString(),
    roundingAmount: row.roundingAmount.toString(),
    grandTotal: row.grandTotal.toString(),
    baseCurrencyTotal: row.baseCurrencyTotal.toString(),
    taxSummary: structuredClone(row.taxSummary),
    terms: structuredClone(row.terms),
    shipping: structuredClone(row.shipping),
    originType: row.originType,
    originMetadata: structuredClone(row.originMetadata),
    sourceSnapshotHash: row.sourceSnapshotHash,
    rowVersion: row.rowVersion,
    createdBy: row.createdBy,
    ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}),
    ...(row.submittedAt ? { submittedAt: row.submittedAt.toISOString() } : {}),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      itemId: line.itemId ?? '',
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

function productionDemandDto(row: ErpProductionDemand): ProductionDemandDto {
  const evidence = control(row.originMetadata);
  return {
    id: row.id,
    organizationId: row.organizationId,
    legalEntityId: row.legalEntityId,
    financialYearId: row.financialYearId,
    demandNumber: row.demandNumber,
    demandType: row.demandType,
    itemId: row.itemId,
    quantity: row.quantity.toString(),
    uom: row.uom,
    ...(row.requiredOn ? { requiredOn: day(row.requiredOn) } : {}),
    status: row.status as ProductionDemandDto['status'],
    bomSnapshot: structuredClone(row.bomSnapshot),
    materialRequirements: structuredClone(row.materialRequirements),
    suggestions: structuredClone(row.suggestions),
    originType: row.originType,
    originMetadata: structuredClone(row.originMetadata),
    sourceSnapshotHash: row.sourceSnapshotHash,
    rowVersion: row.rowVersion,
    makerMembershipId: typeof evidence.makerMembershipId === 'string' ? evidence.makerMembershipId : '',
    ...(typeof evidence.approvedBy === 'string' ? { approvedBy: evidence.approvedBy } : {}),
    ...(row.releasedAt ? { releasedAt: row.releasedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function batchCostDto(row: ErpBatchCost): BatchCostDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    legalEntityId: row.legalEntityId,
    financialYearId: row.financialYearId,
    ...(row.productionDemandId ? { productionDemandId: row.productionDemandId } : {}),
    manufacturingVoucherId: row.manufacturingVoucherId,
    batchNumber: row.batchNumber,
    materialCost: row.materialCost.toString(),
    laborCost: row.laborCost.toString(),
    machineCost: row.machineCost.toString(),
    overheadCost: row.overheadCost.toString(),
    subcontractCost: row.subcontractCost.toString(),
    recoveryCredits: row.recoveryCredits.toString(),
    actualCost: row.actualCost.toString(),
    outputQuantity: row.outputQuantity.toString(),
    unitCost: row.unitCost.toString(),
    costingMethod: row.costingMethod,
    calculationSnapshot: structuredClone(row.calculationSnapshot),
    status: row.status as 'approved',
    sourceSnapshotHash: row.sourceSnapshotHash,
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    approvedBy: row.approvedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function manufacturingVoucherDto(row: ErpManufacturingVoucher, batchCost?: ErpBatchCost | null): ManufacturingVoucherDto {
  const evidence = control(row.originMetadata);
  return {
    id: row.id,
    organizationId: row.organizationId,
    legalEntityId: row.legalEntityId,
    financialYearId: row.financialYearId,
    ...(row.productionDemandId ? { productionDemandId: row.productionDemandId } : {}),
    voucherNumber: row.voucherNumber,
    voucherType: row.voucherType,
    businessDate: day(row.businessDate),
    status: row.status as ManufacturingVoucherDto['status'],
    batchNumber: row.batchNumber,
    materialLines: structuredClone(row.materialLines),
    outputLines: structuredClone(row.outputLines),
    laborLines: structuredClone(row.laborLines),
    resourceLines: structuredClone(row.resourceLines),
    overheadLines: structuredClone(row.overheadLines),
    subcontractLines: structuredClone(row.subcontractLines),
    recoveryCredits: structuredClone(row.recoveryCredits),
    qaDisposition: structuredClone(row.qaDisposition),
    materialValue: row.materialValue.toString(),
    conversionValue: row.conversionValue.toString(),
    recoveryValue: row.recoveryValue.toString(),
    actualCost: row.actualCost.toString(),
    originType: row.originType,
    originMetadata: structuredClone(row.originMetadata),
    sourceSnapshotHash: row.sourceSnapshotHash,
    rowVersion: row.rowVersion,
    makerMembershipId: typeof evidence.makerMembershipId === 'string' ? evidence.makerMembershipId : '',
    ...(typeof evidence.approvedBy === 'string' ? { approvedBy: evidence.approvedBy } : {}),
    ...(typeof evidence.postedBy === 'string' ? { postedBy: evidence.postedBy } : {}),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    ...(row.postedAt ? { postedAt: row.postedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(batchCost ? { batchCost: batchCostDto(batchCost) } : {}),
  };
}

const zero = () => new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const quantity = (value: Prisma.Decimal) => value.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), zero());
const MAX_DB_MONEY = new Prisma.Decimal('9999999999999999.99');
const MAX_DB_UNIT_COST = new Prisma.Decimal('999999999999.999999');

function checkedMoney(value: Prisma.Decimal, subject: string, allowNegative = false): Prisma.Decimal {
  const rounded = money(value);
  if ((!allowNegative && rounded.isNegative()) || rounded.abs().greaterThan(MAX_DB_MONEY)) {
    throw new ApiError(422, 'amount_out_of_range', `${subject} exceeds the supported decimal(18,2) range.`);
  }
  return rounded;
}

export function calculateSalesTotals(input: SalesDocumentCreate) {
  const lines = input.lines.map((line, index) => {
    const gross = checkedMoney(new Prisma.Decimal(line.quantity).times(line.unitPrice), `Line ${index + 1} gross amount`);
    const discount = new Prisma.Decimal(line.discountAmount);
    if (discount.greaterThan(gross)) throw new ApiError(422, 'discount_exceeds_line_value', `Line ${index + 1} discount exceeds its gross value.`);
    const taxableAmount = checkedMoney(gross.minus(discount), `Line ${index + 1} taxable amount`);
    const computedTax = checkedMoney(taxableAmount.times(line.taxRate).dividedBy(100), `Line ${index + 1} tax amount`);
    if (line.taxAmount !== undefined && !money(new Prisma.Decimal(line.taxAmount)).equals(computedTax)) {
      throw new ApiError(422, 'tax_amount_mismatch', `Line ${index + 1} tax amount does not match the server calculation.`);
    }
    const lineTotal = checkedMoney(taxableAmount.plus(computedTax), `Line ${index + 1} total`);
    return { input: line, lineNumber: index + 1, gross, taxableAmount, taxAmount: computedTax, lineTotal };
  });
  const subtotal = checkedMoney(sum(lines.map((line) => line.gross)), 'Document subtotal');
  const discountTotal = checkedMoney(sum(lines.map((line) => new Prisma.Decimal(line.input.discountAmount))), 'Document discount total');
  const taxTotal = checkedMoney(sum(lines.map((line) => line.taxAmount)), 'Document tax total');
  const grandTotal = checkedMoney(sum(lines.map((line) => line.lineTotal)), 'Document grand total');
  const baseCurrencyTotal = checkedMoney(grandTotal.times(input.exchangeRate), 'Document base-currency total');
  return { lines, subtotal, discountTotal, taxTotal, grandTotal, baseCurrencyTotal };
}

function valuedLines(lines: ManufacturingValuedLine[], subject: string) {
  return lines.map((line, index) => {
    const amount = checkedMoney(new Prisma.Decimal(line.quantity).times(line.rate), `${subject} line ${index + 1}`);
    if (line.amount !== undefined && !money(new Prisma.Decimal(line.amount)).equals(amount)) {
      throw new ApiError(422, 'line_amount_mismatch', `${subject} line ${index + 1} amount does not match quantity multiplied by rate.`);
    }
    return { ...line, amount: amount.toString() };
  });
}

function lineValue(lines: Array<{ amount: string }>): Prisma.Decimal {
  return checkedMoney(sum(lines.map((line) => new Prisma.Decimal(line.amount))), 'Manufacturing line total');
}

export function calculateManufacturingVoucher(input: ManufacturingVoucherCreate) {
  const materialLines = valuedLines(input.materialLines, 'Material');
  const laborLines = valuedLines(input.laborLines, 'Labor');
  const resourceLines = valuedLines(input.resourceLines, 'Resource');
  const overheadLines = valuedLines(input.overheadLines, 'Overhead');
  const subcontractLines = valuedLines(input.subcontractLines, 'Subcontract');
  const recoveryCredits = valuedLines(input.recoveryCredits, 'Recovery');
  const materialValue = lineValue(materialLines);
  const laborValue = lineValue(laborLines);
  const machineValue = lineValue(resourceLines);
  const overheadValue = lineValue(overheadLines);
  const subcontractValue = lineValue(subcontractLines);
  const recoveryValue = lineValue(recoveryCredits);
  const conversionValue = checkedMoney(laborValue.plus(machineValue).plus(overheadValue).plus(subcontractValue), 'Conversion value');
  // A return voucher stores its own positive value; the batch roll-up subtracts
  // that value exactly once when the completion voucher is posted.
  const actualCost = checkedMoney(materialValue.plus(conversionValue).minus(recoveryValue), 'Actual cost', true);
  return {
    materialLines, laborLines, resourceLines, overheadLines, subcontractLines, recoveryCredits,
    materialValue, laborValue, machineValue, overheadValue, subcontractValue, recoveryValue, conversionValue, actualCost,
  };
}

function jsonLineTotal(value: Prisma.JsonValue): Prisma.Decimal {
  if (!Array.isArray(value)) return zero();
  return checkedMoney(sum(value.map((entry) => {
    const amount = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>).amount : undefined;
    return typeof amount === 'string' ? new Prisma.Decimal(amount) : zero();
  })), 'Persisted manufacturing line total');
}

async function requireLegalEntity(db: Db, context: TenantCtx, legalEntityId: string) {
  const entity = await db.legalEntity.findFirst({ where: { id: legalEntityId, organizationId: context.organizationId, status: 'active' } });
  if (!entity) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found.');
  return entity;
}

async function financialYearFor(db: Db, legalEntityId: string, businessDate: Date) {
  const year = await db.financialYear.findFirst({ where: { legalEntityId, startsOn: { lte: businessDate }, endsOn: { gte: businessDate } } });
  if (!year) throw new ApiError(409, 'financial_year_missing', 'No financial year covers this business date.');
  if (year.status === 'locked') throw new ApiError(409, 'financial_year_locked', `Financial year ${year.code} is locked.`);
  return year;
}

async function allocateNumber(
  db: Db,
  context: TenantCtx,
  entity: { id: string; code: string },
  year: { id: string; code: string },
  seriesType: string,
  shortCode: string,
) {
  const prefix = `${entity.code}-${shortCode}-${year.code}-`;
  const rows = await db.$queryRaw<Array<{ nextValue: number }>>(Prisma.sql`
    INSERT INTO "ErpNumberSeries" (
      "id", "organizationId", "legalEntityId", "financialYearId", "documentType", "prefix", "padding", "nextValue", "createdAt", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${context.organizationId}, ${entity.id}, ${year.id}, ${seriesType}, ${prefix}, 6, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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
  await db.erpIdempotencyRecord.create({ data: { organizationId: context.organizationId, legalEntityId, scope, key, requestHash, response: json(response) } });
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

async function appendOutbox(
  db: Db,
  context: TenantCtx,
  legalEntityId: string,
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: unknown,
  identity: { id?: string; correlationId?: string } = {},
) {
  await db.integrationOutboxEvent.create({
    data: {
      ...(identity.id ? { id: identity.id } : {}),
      organizationId: context.organizationId,
      legalEntityId,
      serviceId: 'mesaerp',
      aggregateType,
      aggregateId,
      eventType,
      correlationId: identity.correlationId ?? randomUUID(),
      payload: json(payload),
      payloadHash: hashCanonical(payload),
    },
  });
}

function assertMakerChecker(maker: string, checker: string, subject: string) {
  if (!maker || maker === checker) throw new ApiError(409, 'maker_checker_required', `${subject} maker cannot approve the same record.`);
}

export class PrismaMesaErpCommercialManufacturingService implements MesaErpCommercialManufacturingService {
  hasPermission(input: PermissionCheck): Promise<boolean> {
    return hasMesaErpPermission(input);
  }

  async listCustomers(legalEntityId: string): Promise<CustomerDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context, legalEntityId);
      const rows = await db.erpCustomer.findMany({ where: { legalEntityId }, orderBy: [{ legalName: 'asc' }, { customerCode: 'asc' }], take: 500 });
      return rows.map(customerDto);
    });
  }

  async getCustomer(legalEntityId: string, customerId: string): Promise<CustomerDto> {
    const context = actor();
    return tenantTx(async (db) => {
      const row = await db.erpCustomer.findFirst({ where: { id: customerId, organizationId: context.organizationId, legalEntityId } });
      if (!row) throw new ApiError(404, 'customer_not_found', 'Customer not found in this company.');
      return customerDto(row);
    });
  }

  createCustomer(legalEntityId: string, input: CustomerCreate, idempotencyKey: string): Promise<CustomerDto> {
    return runIdempotent({
      legalEntityId,
      scope: `commercial:customer:create:${legalEntityId}`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const duplicate = await db.erpCustomer.findFirst({ where: { legalEntityId, customerCode: input.customerCode }, select: { id: true } });
        if (duplicate) throw new ApiError(409, 'customer_code_exists', 'Customer code already exists in this company.');
        const row = await db.erpCustomer.create({
          data: {
            organizationId: context.organizationId,
            legalEntityId,
            customerCode: input.customerCode,
            legalName: input.legalName,
            tradeName: input.tradeName,
            pan: input.pan,
            gstin: input.gstin,
            addresses: json(input.addresses),
            contacts: json(input.contacts),
            paymentTerms: input.paymentTerms,
            currency: input.currency,
            creditLimit: input.creditLimit,
            creditDays: input.creditDays,
            status: input.status,
            originMetadata: withControl(input.originMetadata, { makerMembershipId: context.membershipId }),
          },
        });
        const response = customerDto(row);
        await audit(db, { action: 'mesaerp.customer.create', entity: 'ErpCustomer', entityId: row.id, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpCustomer', row.id, 'mesaerp.customer.created.v1', response);
        return response;
      },
    });
  }

  updateCustomer(legalEntityId: string, customerId: string, input: CustomerUpdate, idempotencyKey: string): Promise<CustomerDto> {
    return runIdempotent({
      legalEntityId,
      scope: `commercial:customer:${customerId}:update`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const existing = await db.erpCustomer.findFirst({ where: { id: customerId, legalEntityId } });
        if (!existing) throw new ApiError(404, 'customer_not_found', 'Customer not found in this company.');
        if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Customer changed since it was loaded.');
        const {
          expectedRowVersion: _version,
          addresses,
          contacts,
          ...changes
        } = input;
        const updated = await db.erpCustomer.updateMany({
          where: { id: customerId, legalEntityId, rowVersion: input.expectedRowVersion },
          data: {
            ...changes,
            ...(addresses ? { addresses: json(addresses) } : {}),
            ...(contacts ? { contacts: json(contacts) } : {}),
            rowVersion: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new ApiError(409, 'version_conflict', 'Customer changed while the update was being saved.');
        const row = await db.erpCustomer.findUniqueOrThrow({ where: { id: customerId } });
        const response = customerDto(row);
        await audit(db, { action: 'mesaerp.customer.update', entity: 'ErpCustomer', entityId: row.id, before: customerDto(existing), after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpCustomer', row.id, 'mesaerp.customer.updated.v1', response);
        return response;
      },
    });
  }

  async listSalesDocuments(legalEntityId: string, type: SalesDocumentType): Promise<SalesDocumentDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context, legalEntityId);
      const rows = await db.erpDocument.findMany({ where: { legalEntityId, documentType: type }, include: documentInclude, orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }], take: 250 });
      return rows.map(salesDocumentDto);
    });
  }

  async getSalesDocument(legalEntityId: string, type: SalesDocumentType, documentId: string): Promise<SalesDocumentDto> {
    const context = actor();
    return tenantTx(async (db) => {
      const row = await db.erpDocument.findFirst({ where: { id: documentId, organizationId: context.organizationId, legalEntityId, documentType: type }, include: documentInclude });
      if (!row) throw new ApiError(404, 'sales_document_not_found', 'Sales document not found in this company.');
      return salesDocumentDto(row);
    });
  }

  createSalesDocument(legalEntityId: string, type: SalesDocumentType, input: SalesDocumentCreate, idempotencyKey: string): Promise<SalesDocumentDto> {
    return runIdempotent({
      legalEntityId,
      scope: `commercial:${type}:create:${legalEntityId}`,
      key: idempotencyKey,
      payload: { type, input },
      execute: async (db, context) => {
        const entity = await requireLegalEntity(db, context, legalEntityId);
        const businessDate = dateOnly(input.documentDate);
        const year = await financialYearFor(db, legalEntityId, businessDate);
        const customer = await db.erpCustomer.findFirst({ where: { id: input.customerId, legalEntityId } });
        if (!customer) throw new ApiError(404, 'customer_not_found', 'Customer not found in this company.');
        if (customer.status !== 'active') throw new ApiError(409, 'customer_not_active', 'Sales documents require an active customer.');
        const itemIds = [...new Set(input.lines.map((line) => line.itemId))];
        const items = await db.erpItem.findMany({ where: { legalEntityId, active: true, id: { in: itemIds } }, select: { id: true } });
        if (items.length !== itemIds.length) throw new ApiError(422, 'item_not_found', 'One or more sales line items are not active in this company.');

        let sourceOrder: DocumentRow | null = null;
        if (input.sourceSalesOrderId) {
          if (type !== 'sales_invoice') throw new ApiError(422, 'sales_order_source_invalid', 'Only a sales invoice may snapshot a sales order.');
          sourceOrder = await db.erpDocument.findFirst({
            where: { id: input.sourceSalesOrderId, legalEntityId, documentType: 'sales_order' },
            include: documentInclude,
          });
          if (!sourceOrder) throw new ApiError(404, 'source_sales_order_not_found', 'Source sales order not found in this company.');
          if (sourceOrder.status !== 'approved') throw new ApiError(409, 'source_sales_order_not_approved', 'Source sales order must be approved.');
          if (sourceOrder.customerId !== input.customerId) throw new ApiError(422, 'customer_source_mismatch', 'Invoice customer does not match the approved sales order.');
          const sourceLines = new Map(sourceOrder.lines.map((line) => [line.id, line]));
          for (const line of input.lines) {
            if (!line.sourceLineId || !sourceLines.has(line.sourceLineId)) throw new ApiError(422, 'source_line_mismatch', 'Every linked invoice line must reference a line on the selected sales order.');
            const sourceLine = sourceLines.get(line.sourceLineId)!;
            if (sourceLine.itemId !== line.itemId || sourceLine.uom !== line.uom || new Prisma.Decimal(line.quantity).greaterThan(sourceLine.quantity)) {
              throw new ApiError(422, 'source_line_value_mismatch', 'Invoice item, UOM and quantity must remain within the approved sales-order line.');
            }
          }
        } else if (input.lines.some((line) => line.sourceLineId)) {
          throw new ApiError(422, 'source_sales_order_required', 'sourceSalesOrderId is required when invoice lines carry sourceLineId.');
        }

        const totals = calculateSalesTotals(input);
        const shortCode = type === 'sales_order' ? 'SO' : 'SINV';
        const documentNumber = input.documentNumber ?? await allocateNumber(db, context, entity, year, `document:${type}`, shortCode);
        const duplicate = await db.erpDocument.findFirst({ where: { legalEntityId, financialYearId: year.id, documentType: type, documentNumber }, select: { id: true } });
        if (duplicate) throw new ApiError(409, 'document_number_exists', 'This sales document number already exists in the financial year.');
        const partySnapshot = {
          customerCode: customer.customerCode,
          legalName: customer.legalName,
          tradeName: customer.tradeName,
          gstin: customer.gstin,
          paymentTerms: customer.paymentTerms,
          currency: customer.currency,
          creditLimit: customer.creditLimit.toString(),
          creditDays: customer.creditDays,
        };
        const sourceSnapshotHash = sourceOrder ? hashCanonical(salesDocumentDto(sourceOrder))
          : input.originType === 'mesaleads_snapshot' ? hashCanonical(input.originMetadata) : '';
        const created = await db.erpDocument.create({
          data: {
            organizationId: context.organizationId,
            legalEntityId,
            financialYearId: year.id,
            documentType: type,
            documentNumber,
            documentDate: businessDate,
            dueDate: input.dueDate ? dateOnly(input.dueDate) : null,
            customerId: customer.id,
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
            sourceSnapshotHash,
            createIdempotencyKey: `${type}:${idempotencyKey}`,
            requestHash: hashCanonical({ type, input }),
            createdBy: context.membershipId,
          },
        });
        await db.erpDocumentLine.createMany({
          data: totals.lines.map((line) => ({
            organizationId: context.organizationId,
            legalEntityId,
            documentId: created.id,
            lineNumber: line.lineNumber,
            itemId: line.input.itemId,
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
        if (sourceOrder) {
          await db.erpDocumentLink.create({
            data: {
              organizationId: context.organizationId,
              legalEntityId,
              fromDocumentId: sourceOrder.id,
              toDocumentId: created.id,
              relationship: 'sales_order_to_sales_invoice',
              snapshotHash: sourceSnapshotHash,
            },
          });
        }
        const persisted = await db.erpDocument.findUniqueOrThrow({ where: { id: created.id }, include: documentInclude });
        const response = salesDocumentDto(persisted);
        await audit(db, { action: `mesaerp.${type}.create`, entity: 'ErpDocument', entityId: created.id, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpDocument', created.id, `mesaerp.${type}.created.v1`, response);
        return response;
      },
    });
  }

  transitionSalesDocument(legalEntityId: string, type: SalesDocumentType, documentId: string, action: 'submit' | 'approve', input: RowVersionTransition, idempotencyKey: string): Promise<SalesDocumentDto> {
    return runIdempotent({
      legalEntityId,
      scope: `commercial:${type}:${documentId}:${action}`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const existing = await db.erpDocument.findFirst({ where: { id: documentId, legalEntityId, documentType: type }, include: documentInclude });
        if (!existing) throw new ApiError(404, 'sales_document_not_found', 'Sales document not found in this company.');
        if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Sales document changed since it was loaded.');
        const expectedStatus = action === 'submit' ? 'draft' : 'submitted';
        if (existing.status !== expectedStatus) throw new ApiError(409, 'sales_document_not_transitionable', `Sales document is ${existing.status}.`);
        if (action === 'approve') assertMakerChecker(existing.createdBy, context.membershipId, 'Sales document');
        const now = new Date();
        const changed = await db.erpDocument.updateMany({
          where: { id: documentId, legalEntityId, documentType: type, status: expectedStatus, rowVersion: input.expectedRowVersion },
          data: action === 'submit'
            ? { status: 'submitted', approvalState: 'pending', submittedAt: now, rowVersion: { increment: 1 } }
            : { status: 'approved', approvalState: 'approved', approvedAt: now, approvedBy: context.membershipId, rowVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Sales document changed while the transition was being saved.');
        const updated = await db.erpDocument.findUniqueOrThrow({ where: { id: documentId }, include: documentInclude });
        if (action === 'approve') await ensureDocumentPostingDraft(db, context, updated);
        const response = salesDocumentDto(updated);
        await audit(db, { action: `mesaerp.${type}.${action}`, entity: 'ErpDocument', entityId: documentId, before: salesDocumentDto(existing), after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpDocument', documentId, `mesaerp.${type}.${action === 'submit' ? 'submitted' : 'approved'}.v1`, response);
        return response;
      },
    });
  }

  async listProductionDemands(legalEntityId: string): Promise<ProductionDemandDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context, legalEntityId);
      const rows = await db.erpProductionDemand.findMany({ where: { legalEntityId }, orderBy: [{ requiredOn: 'asc' }, { createdAt: 'desc' }], take: 250 });
      return rows.map(productionDemandDto);
    });
  }

  async getProductionDemand(legalEntityId: string, demandId: string): Promise<ProductionDemandDto> {
    const context = actor();
    return tenantTx(async (db) => {
      const row = await db.erpProductionDemand.findFirst({ where: { id: demandId, organizationId: context.organizationId, legalEntityId } });
      if (!row) throw new ApiError(404, 'production_demand_not_found', 'Production demand not found in this company.');
      return productionDemandDto(row);
    });
  }

  createProductionDemand(legalEntityId: string, input: ProductionDemandCreate, idempotencyKey: string): Promise<ProductionDemandDto> {
    return runIdempotent({
      legalEntityId,
      scope: `manufacturing:demand:create:${legalEntityId}`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const entity = await requireLegalEntity(db, context, legalEntityId);
        const year = await financialYearFor(db, legalEntityId, dateOnly(input.demandDate));
        const item = await db.erpItem.findFirst({ where: { id: input.itemId, legalEntityId, active: true } });
        if (!item) throw new ApiError(404, 'item_not_found', 'Production item not found or inactive in this company.');
        if (item.baseUom !== input.uom) throw new ApiError(422, 'item_uom_mismatch', 'Production demand UOM must match the item base UOM.');

        let sourceOrderSnapshot: Record<string, unknown> | undefined;
        if (input.sourceSalesOrderId && input.sourceLineId) {
          const order = await db.erpDocument.findFirst({
            where: { id: input.sourceSalesOrderId, legalEntityId, documentType: 'sales_order' },
            include: documentInclude,
          });
          if (!order) throw new ApiError(404, 'source_sales_order_not_found', 'Source sales order not found in this company.');
          if (order.status !== 'approved') throw new ApiError(409, 'source_sales_order_not_approved', 'Production demand requires an approved sales order snapshot.');
          const line = order.lines.find((entry) => entry.id === input.sourceLineId);
          if (!line) throw new ApiError(422, 'source_line_mismatch', 'Source line does not belong to the selected sales order.');
          if (line.itemId !== input.itemId || line.uom !== input.uom || new Prisma.Decimal(input.quantity).greaterThan(line.quantity)) {
            throw new ApiError(422, 'source_line_value_mismatch', 'Demand item, UOM and quantity must remain within the approved sales-order line.');
          }
          sourceOrderSnapshot = {
            salesOrderId: order.id,
            documentNumber: order.documentNumber,
            customerId: order.customerId,
            customerName: record(order.partySnapshot).legalName ?? '',
            sourceLineId: line.id,
            itemId: line.itemId,
            description: line.description,
            quantity: line.quantity.toString(),
            uom: line.uom,
            promisedOn: line.promisedOn ? day(line.promisedOn) : undefined,
          };
        }
        const demandNumber = input.demandNumber ?? await allocateNumber(db, context, entity, year, 'production:demand', 'PD');
        const duplicate = await db.erpProductionDemand.findFirst({ where: { legalEntityId, financialYearId: year.id, demandNumber }, select: { id: true } });
        if (duplicate) throw new ApiError(409, 'demand_number_exists', 'This production demand number already exists in the financial year.');
        const sourceOrderSnapshotHash = sourceOrderSnapshot ? hashCanonical(sourceOrderSnapshot) : '';
        const metadata = withControl({
          ...input.originMetadata,
          demandDate: input.demandDate,
          plantCode: input.plantCode.toUpperCase(),
          priority: input.priority,
          ...(sourceOrderSnapshot ? { sourceOrderSnapshot, sourceOrderSnapshotHash } : {}),
        }, { makerMembershipId: context.membershipId });
        const row = await db.erpProductionDemand.create({
          data: {
            organizationId: context.organizationId,
            legalEntityId,
            financialYearId: year.id,
            demandNumber,
            demandType: input.demandType,
            itemId: input.itemId,
            quantity: input.quantity,
            uom: input.uom,
            requiredOn: input.requiredOn ? dateOnly(input.requiredOn) : null,
            bomSnapshot: json(input.bomSnapshot),
            materialRequirements: json(input.materialRequirements),
            suggestions: json(input.suggestions),
            originType: input.originType,
            originMetadata: metadata,
            sourceSnapshotHash: sourceOrderSnapshotHash,
            createIdempotencyKey: `production-demand:${idempotencyKey}`,
          },
        });
        const response = productionDemandDto(row);
        await audit(db, { action: 'mesaerp.production_demand.create', entity: 'ErpProductionDemand', entityId: row.id, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpProductionDemand', row.id, 'mesaerp.production-demand.created.v1', response);
        return response;
      },
    });
  }

  transitionProductionDemand(legalEntityId: string, demandId: string, action: 'approve' | 'release', input: RowVersionTransition, idempotencyKey: string): Promise<ProductionDemandDto> {
    return runIdempotent({
      legalEntityId,
      scope: `manufacturing:demand:${demandId}:${action}`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const existing = await db.erpProductionDemand.findFirst({ where: { id: demandId, legalEntityId } });
        if (!existing) throw new ApiError(404, 'production_demand_not_found', 'Production demand not found in this company.');
        if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Production demand changed since it was loaded.');
        const expectedStatus = action === 'approve' ? 'draft' : 'approved';
        if (existing.status !== expectedStatus) throw new ApiError(409, 'production_demand_not_transitionable', `Production demand is ${existing.status}.`);
        const evidence = control(existing.originMetadata);
        if (action === 'approve') assertMakerChecker(typeof evidence.makerMembershipId === 'string' ? evidence.makerMembershipId : '', context.membershipId, 'Production demand');
        const now = new Date();
        let releaseEvent: { id: string; correlationId: string; payload: Record<string, unknown> } | undefined;
        let sourceSnapshotHash = existing.sourceSnapshotHash;
        if (action === 'release') {
          const item = await db.erpItem.findFirst({ where: { id: existing.itemId, legalEntityId } });
          if (!item) throw new ApiError(409, 'item_not_found', 'Production item is no longer available in this company.');
          const metadata = record(existing.originMetadata);
          const sourceSnapshot = record(metadata.sourceOrderSnapshot);
          const snapshot = {
            orderNumber: existing.demandNumber,
            plantCode: typeof metadata.plantCode === 'string' ? metadata.plantCode : 'PRIMARY',
            customerName: typeof sourceSnapshot.customerName === 'string' ? sourceSnapshot.customerName : '',
            productCode: item.itemCode,
            productName: item.name,
            quantity: existing.quantity.toString(),
            uom: existing.uom,
            ...(existing.requiredOn ? { dueDate: day(existing.requiredOn) } : {}),
            priority: typeof metadata.priority === 'string' ? metadata.priority : 'medium',
            requirements: {
              demandType: existing.demandType,
              bomSnapshot: structuredClone(existing.bomSnapshot),
              materialRequirements: structuredClone(existing.materialRequirements),
              sourceSalesOrderId: typeof sourceSnapshot.salesOrderId === 'string' ? sourceSnapshot.salesOrderId : '',
              sourceLineId: typeof sourceSnapshot.sourceLineId === 'string' ? sourceSnapshot.sourceLineId : '',
            },
            legalEntityId,
          };
          sourceSnapshotHash = hashCanonical(snapshot);
          const eventId = randomUUID();
          const correlationId = randomUUID();
          releaseEvent = {
            id: eventId,
            correlationId,
            payload: { eventId, correlationId, sourceId: existing.id, sourceSnapshotHash, snapshot },
          };
        }
        const metadata = action === 'approve'
          ? withControl(existing.originMetadata, { approvedBy: context.membershipId, approvedAt: now.toISOString() })
          : withControl(existing.originMetadata, { releasedBy: context.membershipId, releasedAt: now.toISOString() });
        const changed = await db.erpProductionDemand.updateMany({
          where: { id: demandId, legalEntityId, status: expectedStatus, rowVersion: input.expectedRowVersion },
          data: {
            status: action === 'approve' ? 'approved' : 'released',
            originMetadata: metadata,
            sourceSnapshotHash,
            ...(action === 'release' ? { releasedAt: now } : {}),
            rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Production demand changed while the transition was being saved.');
        const updated = await db.erpProductionDemand.findUniqueOrThrow({ where: { id: demandId } });
        const response = productionDemandDto(updated);
        await audit(db, { action: `mesaerp.production_demand.${action}`, entity: 'ErpProductionDemand', entityId: demandId, before: productionDemandDto(existing), after: response });
        if (releaseEvent) {
          await appendOutbox(db, context, legalEntityId, 'ErpProductionDemand', demandId, 'mesaerp.production-demand.released.v1', releaseEvent.payload, {
            id: releaseEvent.id,
            correlationId: releaseEvent.correlationId,
          });
        } else {
          await appendOutbox(db, context, legalEntityId, 'ErpProductionDemand', demandId, 'mesaerp.production-demand.approved.v1', response);
        }
        return response;
      },
    });
  }

  async listManufacturingVouchers(legalEntityId: string): Promise<ManufacturingVoucherDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context, legalEntityId);
      const rows = await db.erpManufacturingVoucher.findMany({ where: { legalEntityId }, include: { batchCost: true }, orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }], take: 250 });
      return rows.map((row) => manufacturingVoucherDto(row, row.batchCost));
    });
  }

  async getManufacturingVoucher(legalEntityId: string, voucherId: string): Promise<ManufacturingVoucherDto> {
    const context = actor();
    return tenantTx(async (db) => {
      const row = await db.erpManufacturingVoucher.findFirst({ where: { id: voucherId, organizationId: context.organizationId, legalEntityId }, include: { batchCost: true } });
      if (!row) throw new ApiError(404, 'manufacturing_voucher_not_found', 'Manufacturing voucher not found in this company.');
      return manufacturingVoucherDto(row, row.batchCost);
    });
  }

  createManufacturingVoucher(legalEntityId: string, input: ManufacturingVoucherCreate, idempotencyKey: string): Promise<ManufacturingVoucherDto> {
    return runIdempotent({
      legalEntityId,
      scope: `manufacturing:voucher:create:${legalEntityId}`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const entity = await requireLegalEntity(db, context, legalEntityId);
        const year = await financialYearFor(db, legalEntityId, dateOnly(input.businessDate));
        if (input.productionDemandId) {
          const demand = await db.erpProductionDemand.findFirst({ where: { id: input.productionDemandId, legalEntityId } });
          if (!demand) throw new ApiError(404, 'production_demand_not_found', 'Production demand not found in this company.');
          if (!['released', 'partially_completed'].includes(demand.status)) throw new ApiError(409, 'production_demand_not_released', 'Manufacturing vouchers require a released production demand.');
        }
        const referencedItemIds = [...new Set([
          ...input.materialLines.flatMap((line) => line.itemId ? [line.itemId] : []),
          ...input.outputLines.map((line) => line.itemId),
        ])];
        if (referencedItemIds.length) {
          const items = await db.erpItem.findMany({ where: { legalEntityId, active: true, id: { in: referencedItemIds } }, select: { id: true } });
          if (items.length !== referencedItemIds.length) throw new ApiError(422, 'item_not_found', 'One or more manufacturing items are not active in this company.');
        }
        const calculated = calculateManufacturingVoucher(input);
        if (calculated.actualCost.isNegative()) throw new ApiError(422, 'negative_actual_cost', 'Recovery credits and returns cannot make this voucher actual cost negative.');
        const shortCode = input.voucherType === 'issue' ? 'MI' : input.voucherType === 'return' ? 'MR' : 'MV';
        const voucherNumber = input.voucherNumber ?? await allocateNumber(db, context, entity, year, `manufacturing:${input.voucherType}`, shortCode);
        const duplicate = await db.erpManufacturingVoucher.findFirst({ where: { legalEntityId, financialYearId: year.id, voucherNumber }, select: { id: true } });
        if (duplicate) throw new ApiError(409, 'manufacturing_voucher_number_exists', 'This manufacturing voucher number already exists in the financial year.');
        const row = await db.erpManufacturingVoucher.create({
          data: {
            organizationId: context.organizationId,
            legalEntityId,
            financialYearId: year.id,
            productionDemandId: input.productionDemandId ?? null,
            voucherNumber,
            voucherType: input.voucherType,
            businessDate: dateOnly(input.businessDate),
            batchNumber: input.batchNumber,
            materialLines: json(calculated.materialLines),
            outputLines: json(input.outputLines),
            laborLines: json(calculated.laborLines),
            resourceLines: json(calculated.resourceLines),
            overheadLines: json(calculated.overheadLines),
            subcontractLines: json(calculated.subcontractLines),
            recoveryCredits: json(calculated.recoveryCredits),
            qaDisposition: json(input.qaDisposition),
            materialValue: calculated.materialValue,
            conversionValue: calculated.conversionValue,
            recoveryValue: calculated.recoveryValue,
            actualCost: calculated.actualCost,
            originType: input.originType,
            originMetadata: withControl(input.originMetadata, { makerMembershipId: context.membershipId }),
            createIdempotencyKey: `manufacturing-voucher:${idempotencyKey}`,
          },
        });
        const response = manufacturingVoucherDto(row);
        await audit(db, { action: 'mesaerp.manufacturing_voucher.create', entity: 'ErpManufacturingVoucher', entityId: row.id, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpManufacturingVoucher', row.id, 'mesaerp.manufacturing-voucher.created.v1', response);
        return response;
      },
    });
  }

  transitionManufacturingVoucher(legalEntityId: string, voucherId: string, action: 'submit' | 'approve' | 'post', input: RowVersionTransition, idempotencyKey: string): Promise<ManufacturingVoucherDto> {
    return runIdempotent({
      legalEntityId,
      scope: `manufacturing:voucher:${voucherId}:${action}`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        let existing = await db.erpManufacturingVoucher.findFirst({ where: { id: voucherId, legalEntityId }, include: { batchCost: true } });
        if (!existing) throw new ApiError(404, 'manufacturing_voucher_not_found', 'Manufacturing voucher not found in this company.');
        await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpManufacturingVoucher" WHERE "id" = ${voucherId} FOR UPDATE`);
        existing = await db.erpManufacturingVoucher.findFirst({ where: { id: voucherId, legalEntityId }, include: { batchCost: true } });
        if (!existing) throw new ApiError(404, 'manufacturing_voucher_not_found', 'Manufacturing voucher not found in this company.');
        if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Manufacturing voucher changed since it was loaded.');
        const expectedStatus = action === 'submit' ? 'draft' : action === 'approve' ? 'submitted' : 'approved';
        if (existing.status !== expectedStatus) throw new ApiError(409, 'manufacturing_voucher_not_transitionable', `Manufacturing voucher is ${existing.status}.`);
        const evidence = control(existing.originMetadata);
        if (action === 'approve') assertMakerChecker(typeof evidence.makerMembershipId === 'string' ? evidence.makerMembershipId : '', context.membershipId, 'Manufacturing voucher');
        const completionStyle = ['manufacturing', 'completion', 'rework'].includes(existing.voucherType);
        if (completionStyle) {
          const disposition = record(existing.qaDisposition).status;
          if (!['accepted', 'not_applicable'].includes(typeof disposition === 'string' ? disposition : '')) {
            throw new ApiError(409, 'qa_disposition_blocks_completion', 'Completion submission, approval and posting require an accepted or not-applicable QA disposition.');
          }
        }
        if (action === 'post') {
          await requirePostedSourcePosting(db, legalEntityId, 'manufacturing_voucher', existing.id);
        }

        const now = new Date();
        let batchCost: ErpBatchCost | null = existing.batchCost;
        let postedActualCost = existing.actualCost;
        if (action === 'post' && completionStyle) {
          if (existing.batchCost) throw new ApiError(409, 'batch_cost_exists', 'This manufacturing voucher already has a batch cost.');
          await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.organizationId}:${legalEntityId}:${existing.batchNumber}`}))`);
          const batchNumberConflict = await db.erpBatchCost.findFirst({ where: { legalEntityId, batchNumber: existing.batchNumber }, select: { id: true } });
          if (batchNumberConflict) throw new ApiError(409, 'batch_number_costed', 'This company batch number already has an approved batch cost.');
          if (existing.productionDemandId) {
            await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpProductionDemand" WHERE "id" = ${existing.productionDemandId} FOR UPDATE`);
          }
          const prior = await db.erpManufacturingVoucher.findMany({
            where: {
              legalEntityId,
              batchNumber: existing.batchNumber,
              status: 'posted',
              id: { not: existing.id },
              ...(existing.productionDemandId ? { productionDemandId: existing.productionDemandId } : { productionDemandId: null }),
            },
          });
          const all = [...prior, existing];
          const materialCost = checkedMoney(sum(all.map((row) => row.voucherType === 'return' ? row.materialValue.negated() : row.materialValue)), 'Batch material cost', true);
          const laborCost = checkedMoney(sum(all.map((row) => jsonLineTotal(row.laborLines))), 'Batch labor cost');
          const machineCost = checkedMoney(sum(all.map((row) => jsonLineTotal(row.resourceLines))), 'Batch machine cost');
          const overheadCost = checkedMoney(sum(all.map((row) => jsonLineTotal(row.overheadLines))), 'Batch overhead cost');
          const subcontractCost = checkedMoney(sum(all.map((row) => jsonLineTotal(row.subcontractLines))), 'Batch subcontract cost');
          const recoveryCredits = checkedMoney(sum(all.map((row) => jsonLineTotal(row.recoveryCredits))), 'Batch recovery credits');
          const actualCost = checkedMoney(materialCost.plus(laborCost).plus(machineCost).plus(overheadCost).plus(subcontractCost).minus(recoveryCredits), 'Batch actual cost', true);
          if (materialCost.isNegative() || actualCost.isNegative()) throw new ApiError(422, 'negative_batch_cost', 'Returns or recovery credits cannot make the completed batch cost negative.');
          const outputs = Array.isArray(existing.outputLines) ? existing.outputLines : [];
          const outputQuantity = quantity(sum(outputs.map((entry) => {
            const row = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
            return row.outputType === 'finished_good' && typeof row.quantity === 'string' ? new Prisma.Decimal(row.quantity) : zero();
          })));
          if (!outputQuantity.isPositive()) throw new ApiError(422, 'finished_output_required', 'A completed batch requires positive finished-good output.');
          const unitCost = actualCost.dividedBy(outputQuantity).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
          if (unitCost.greaterThan(MAX_DB_UNIT_COST)) throw new ApiError(422, 'unit_cost_out_of_range', 'Batch unit cost exceeds the supported decimal(18,6) range.');
          const snapshot = {
            formula: 'material + labor + machine + overhead + subcontract - recovery',
            voucherIds: all.map((row) => row.id).sort(),
            batchNumber: existing.batchNumber,
            materialCost: materialCost.toString(),
            laborCost: laborCost.toString(),
            machineCost: machineCost.toString(),
            overheadCost: overheadCost.toString(),
            subcontractCost: subcontractCost.toString(),
            recoveryCredits: recoveryCredits.toString(),
            actualCost: actualCost.toString(),
            outputQuantity: outputQuantity.toString(),
            unitCost: unitCost.toString(),
          };
          const snapshotHash = hashCanonical(snapshot);
          batchCost = await db.erpBatchCost.create({
            data: {
              organizationId: context.organizationId,
              legalEntityId,
              financialYearId: existing.financialYearId,
              productionDemandId: existing.productionDemandId,
              manufacturingVoucherId: existing.id,
              batchNumber: existing.batchNumber,
              materialCost,
              laborCost,
              machineCost,
              overheadCost,
              subcontractCost,
              recoveryCredits,
              actualCost,
              outputQuantity,
              unitCost,
              costingMethod: 'actual',
              calculationSnapshot: json(snapshot),
              status: 'approved',
              sourceSnapshotHash: snapshotHash,
              approvedAt: now,
              approvedBy: context.membershipId,
            },
          });
          postedActualCost = actualCost;

          if (existing.productionDemandId) {
            const demand = await db.erpProductionDemand.findFirst({ where: { id: existing.productionDemandId, legalEntityId } });
            if (!demand) throw new ApiError(409, 'production_demand_not_found', 'Linked production demand no longer exists.');
            if (!['released', 'partially_completed'].includes(demand.status)) throw new ApiError(409, 'production_demand_not_released', 'Linked production demand is not open for completion.');
            const priorCosts = await db.erpBatchCost.findMany({ where: { productionDemandId: demand.id, id: { not: batchCost.id }, status: 'approved' }, select: { outputQuantity: true } });
            const completed = quantity(sum(priorCosts.map((row) => row.outputQuantity)).plus(outputQuantity));
            if (completed.greaterThan(demand.quantity)) throw new ApiError(409, 'production_over_completion', 'Completed output exceeds the released production demand quantity.');
            await db.erpProductionDemand.update({
              where: { id: demand.id },
              data: { status: completed.equals(demand.quantity) ? 'completed' : 'partially_completed', rowVersion: { increment: 1 } },
            });
          }
        }

        const lifecyclePatch = action === 'submit'
          ? { submittedBy: context.membershipId, submittedAt: now.toISOString() }
          : action === 'approve'
            ? { approvedBy: context.membershipId, approvedAt: now.toISOString() }
            : { postedBy: context.membershipId, postedAt: now.toISOString() };
        const changed = await db.erpManufacturingVoucher.updateMany({
          where: { id: voucherId, legalEntityId, status: expectedStatus, rowVersion: input.expectedRowVersion },
          data: {
            status: action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : 'posted',
            originMetadata: withControl(existing.originMetadata, lifecyclePatch),
            ...(action === 'approve' ? { approvedAt: now } : {}),
            ...(action === 'post' ? { postedAt: now, actualCost: postedActualCost, sourceSnapshotHash: batchCost?.sourceSnapshotHash ?? existing.sourceSnapshotHash } : {}),
            rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Manufacturing voucher changed while the transition was being saved.');
        const updated = await db.erpManufacturingVoucher.findUniqueOrThrow({ where: { id: voucherId }, include: { batchCost: true } });
        if (action === 'approve') await ensureManufacturingPostingDraft(db, context, updated);
        const response = manufacturingVoucherDto(updated, updated.batchCost);
        await audit(db, { action: `mesaerp.manufacturing_voucher.${action}`, entity: 'ErpManufacturingVoucher', entityId: voucherId, before: manufacturingVoucherDto(existing, existing.batchCost), after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpManufacturingVoucher', voucherId, `mesaerp.manufacturing-voucher.${action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : 'posted'}.v1`, response);
        return response;
      },
    });
  }

  async listBatchCosts(legalEntityId: string): Promise<BatchCostDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context, legalEntityId);
      const rows = await db.erpBatchCost.findMany({ where: { legalEntityId, status: 'approved' }, orderBy: { createdAt: 'desc' }, take: 250 });
      return rows.map(batchCostDto);
    });
  }

  async getBatchCost(legalEntityId: string, batchCostId: string): Promise<BatchCostDto> {
    const context = actor();
    return tenantTx(async (db) => {
      const row = await db.erpBatchCost.findFirst({ where: { id: batchCostId, organizationId: context.organizationId, legalEntityId } });
      if (!row) throw new ApiError(404, 'batch_cost_not_found', 'Batch cost not found in this company.');
      return batchCostDto(row);
    });
  }
}
