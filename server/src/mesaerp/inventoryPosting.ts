import { randomUUID } from 'node:crypto';
import { Prisma, type ErpDocument, type ErpDocumentLine, type ErpManufacturingVoucher, type ErpVoucher, type ErpVoucherLine } from '@prisma/client';
import { basePrisma } from '../db';
import { audit } from '../lib/audit';
import type { TenantCtx } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import { hashCanonical } from './repository';

type Db = typeof basePrisma;
type VoucherWithLines = ErpVoucher & { lines: ErpVoucherLine[] };
type DocumentWithLines = ErpDocument & { lines: ErpDocumentLine[] };

export interface InventoryPostingLine {
  key: string;
  direction: 'in' | 'out';
  movementType: string;
  itemId: string;
  warehouseId: string;
  quantity: string;
  uom: string;
  unitCost?: string;
  expectedValue: string;
  batchNumber?: string;
  serialNumber?: string;
  expiryDate?: string;
  sourceDocumentId?: string;
  originMetadata?: Record<string, unknown>;
}

export interface InventoryPostingPlan {
  version: 1;
  sourceType: string;
  sourceId: string;
  businessDate: string;
  lines: InventoryPostingLine[];
}

export interface AccountingPostingLine {
  account: string;
  debit: string;
  credit: string;
  narration: string;
  dimensions?: Record<string, string>;
}

interface SourcePostingInput {
  sourceType: string;
  sourceId: string;
  sourceDocumentId?: string;
  voucherType: 'sales' | 'purchase' | 'stock_journal' | 'manufacturing_journal';
  businessDate: string;
  currency: string;
  reference: string;
  narration: string;
  sourceSnapshot: unknown;
  accountingLines: AccountingPostingLine[];
  inventoryPlan?: InventoryPostingPlan;
}

const zero = () => new Prisma.Decimal(0);
const quantity = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const rate = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), zero());
const day = (date: Date) => date.toISOString().slice(0, 10);
const dateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`);
const json = (value: unknown) => value as Prisma.InputJsonValue;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

async function yearAndPeriod(db: Db, legalEntityId: string, businessDate: Date) {
  const year = await db.financialYear.findFirst({
    where: { legalEntityId, startsOn: { lte: businessDate }, endsOn: { gte: businessDate } },
  });
  if (!year) throw new ApiError(409, 'financial_year_missing', 'No financial year covers this inventory posting date.');
  const period = await db.accountingPeriod.findFirst({
    where: { financialYearId: year.id, startsOn: { lte: businessDate }, endsOn: { gte: businessDate } },
  });
  if (!period) throw new ApiError(409, 'accounting_period_missing', 'No accounting period covers this inventory posting date.');
  if (period.status !== 'open') throw new ApiError(409, 'period_closed', `The ${period.name} accounting period is ${period.status}.`);
  return { year, period };
}

async function accountsFor(db: Db, legalEntityId: string, references: string[]) {
  const unique = [...new Set(references)];
  const accounts = await db.erpAccount.findMany({
    where: { legalEntityId, active: true, allowPosting: true, OR: [{ id: { in: unique } }, { code: { in: unique } }] },
  });
  const byReference = new Map(accounts.flatMap((account) => [[account.id, account], [account.code, account]] as const));
  const missing = unique.filter((reference) => !byReference.has(reference));
  if (missing.length) throw new ApiError(422, 'posting_mapping_missing', `Unknown or inactive posting account: ${missing.join(', ')}.`);
  return byReference;
}

export function accountingSnapshot(voucher: VoucherWithLines) {
  return voucher.lines
    .slice()
    .sort((left, right) => left.lineNumber - right.lineNumber)
    .map((line) => ({
      lineNumber: line.lineNumber,
      accountId: line.accountId,
      debit: line.baseDebit.toString(),
      credit: line.baseCredit.toString(),
      narration: line.narration,
      dimensions: structuredClone(line.dimensions),
    }));
}

/**
 * Revalidate a manufacturing source inside the generic voucher-post
 * transaction, before either stock or GL evidence is written. The row lock is
 * shared with the manufacturing lifecycle transition, so QA/source changes
 * cannot race an already-approved accounting draft.
 */
export async function assertManufacturingSourceReadyForPosting(db: Db, voucher: VoucherWithLines) {
  const metadata = record(voucher.originMetadata);
  const metadataSource = record(metadata.mesaerpPostingSource);
  const claimsManufacturingSource = voucher.originType === 'source_posting'
    && metadataSource.type === 'manufacturing_voucher';
  await db.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ErpPostingLink"
    WHERE "legalEntityId" = ${voucher.legalEntityId}
      AND "voucherId" = ${voucher.id}
    FOR UPDATE
  `);
  const link = await db.erpPostingLink.findFirst({
    where: { legalEntityId: voucher.legalEntityId, voucherId: voucher.id },
  });
  if (!link) {
    if (claimsManufacturingSource) {
      throw new ApiError(409, 'manufacturing_source_posting_invalid', 'The manufacturing accounting voucher no longer has its immutable posting link.');
    }
    return;
  }
  if (link.sourceType !== 'manufacturing_voucher') {
    if (claimsManufacturingSource) {
      throw new ApiError(409, 'manufacturing_source_posting_invalid', 'The accounting voucher and posting link disagree on the manufacturing source type.');
    }
    return;
  }

  await db.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ErpManufacturingVoucher"
    WHERE "id" = ${link.sourceId}
      AND "legalEntityId" = ${voucher.legalEntityId}
    FOR UPDATE
  `);
  const source = await db.erpManufacturingVoucher.findFirst({
    where: { id: link.sourceId, legalEntityId: voucher.legalEntityId },
    include: { batchCost: true },
  });
  if (!source) throw new ApiError(409, 'manufacturing_source_missing', 'The linked manufacturing voucher is no longer available.');

  const mappingSnapshot = record(link.mappingSnapshot);
  const inventoryPlan = record(metadata.mesaerpInventoryPosting);
  const mappedInventoryPlan = record(mappingSnapshot.inventoryPlan);
  const expectedSourceHash = link.sourceSnapshotHash;
  const expectedAccountingHash = hashCanonical(accountingSnapshot(voucher));
  const identityMatches = voucher.originType === 'source_posting'
    && metadataSource.type === 'manufacturing_voucher'
    && metadataSource.id === source.id
    && metadataSource.sourceSnapshotHash === expectedSourceHash
    && mappingSnapshot.sourceType === 'manufacturing_voucher'
    && mappingSnapshot.sourceId === source.id
    && mappingSnapshot.sourceSnapshotHash === expectedSourceHash
    && inventoryPlan.sourceType === 'manufacturing_voucher'
    && inventoryPlan.sourceId === source.id
    && hashCanonical(inventoryPlan) === hashCanonical(mappedInventoryPlan)
    && metadata.mesaerpAccountingSnapshotHash === mappingSnapshot.accountingSnapshotHash
    && mappingSnapshot.accountingSnapshotHash === expectedAccountingHash;
  if (!identityMatches) {
    throw new ApiError(409, 'manufacturing_source_posting_invalid', 'The manufacturing source, inventory plan and accounting mapping identities no longer agree.');
  }
  if (hashCanonical(source) !== expectedSourceHash) {
    throw new ApiError(409, 'manufacturing_source_snapshot_stale', 'The linked manufacturing voucher changed after its accounting draft was generated; regenerate and reapprove the posting.');
  }
  if (source.status !== 'approved') {
    throw new ApiError(409, 'manufacturing_source_not_approved', `The linked manufacturing voucher is ${source.status}; an approved source is required for accounting posting.`);
  }
  if (['manufacturing', 'completion', 'rework'].includes(source.voucherType)) {
    const disposition = record(source.qaDisposition).status;
    if (!['accepted', 'not_applicable'].includes(typeof disposition === 'string' ? disposition : '')) {
      throw new ApiError(409, 'qa_disposition_blocks_completion', 'Completion accounting and finished-goods posting require an accepted or not-applicable QA disposition.');
    }
  }
}

export async function ensureSourcePostingDraft(db: Db, context: TenantCtx, legalEntityId: string, input: SourcePostingInput) {
  const existing = await db.erpPostingLink.findFirst({
    where: { legalEntityId, sourceType: input.sourceType, sourceId: input.sourceId },
    include: { voucher: { include: { lines: { orderBy: { lineNumber: 'asc' } } } } },
  });
  if (existing) return postingLinkDto(existing);

  const entity = await db.legalEntity.findFirst({ where: { id: legalEntityId, organizationId: context.organizationId } });
  if (!entity) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found.');
  if (input.currency !== entity.baseCurrency) {
    throw new ApiError(422, 'foreign_currency_inventory_not_supported', 'Valued inventory posting currently requires the company base currency.');
  }
  const businessDate = dateOnly(input.businessDate);
  const { year, period } = await yearAndPeriod(db, legalEntityId, businessDate);
  if (input.inventoryPlan) {
    if (input.inventoryPlan.businessDate !== input.businessDate
      || input.inventoryPlan.sourceType !== input.sourceType
      || input.inventoryPlan.sourceId !== input.sourceId) {
      throw new ApiError(409, 'inventory_posting_plan_invalid', 'Inventory and accounting source identities must match.');
    }
    for (const line of input.inventoryPlan.lines) {
      await validateInventoryLine(db, legalEntityId, businessDate, line);
    }
  }
  const invalidLine = input.accountingLines.findIndex((line) => {
    const lineDebit = money(line.debit);
    const lineCredit = money(line.credit);
    const debitPositive = lineDebit.greaterThan(0);
    const creditPositive = lineCredit.greaterThan(0);
    return lineDebit.isNegative()
      || lineCredit.isNegative()
      || (debitPositive && creditPositive)
      || (!debitPositive && !creditPositive);
  });
  if (invalidLine >= 0) {
    throw new ApiError(422, 'invalid_source_posting_line', `Source posting line ${invalidLine + 1} must contain one positive debit or credit amount.`);
  }
  const debit = money(sum(input.accountingLines.map((line) => new Prisma.Decimal(line.debit))));
  const credit = money(sum(input.accountingLines.map((line) => new Prisma.Decimal(line.credit))));
  if (!debit.greaterThan(0) || !debit.equals(credit)) {
    throw new ApiError(422, 'unbalanced_source_posting', 'Source posting mappings must contain equal, non-zero debit and credit totals.');
  }
  const accountMap = await accountsFor(db, legalEntityId, input.accountingLines.map((line) => line.account));
  const resolvedLines = input.accountingLines.map((line, index) => {
    const account = accountMap.get(line.account)!;
    return {
      lineNumber: index + 1,
      accountId: account.id,
      accountSnapshot: { code: account.code, name: account.name },
      debit: money(line.debit),
      credit: money(line.credit),
      narration: line.narration,
      dimensions: line.dimensions ?? {},
    };
  });
  const resolvedSnapshot = resolvedLines.map((line) => ({
    lineNumber: line.lineNumber,
    accountId: line.accountId,
    debit: line.debit.toString(),
    credit: line.credit.toString(),
    narration: line.narration,
    dimensions: line.dimensions,
  }));
  const accountingSnapshotHash = hashCanonical(resolvedSnapshot);
  const sourceSnapshotHash = hashCanonical(input.sourceSnapshot);
  const mappingSnapshot = {
    version: 1,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceSnapshotHash,
    accountingSnapshot: resolvedSnapshot,
    accountingSnapshotHash,
    inventoryPlan: input.inventoryPlan ?? null,
  };
  const voucher = await db.erpVoucher.create({
    data: {
      organizationId: context.organizationId,
      legalEntityId,
      financialYearId: year.id,
      accountingPeriodId: period.id,
      voucherType: input.voucherType,
      voucherNumber: `DRAFT-${randomUUID()}`,
      businessDate,
      currency: input.currency,
      transactionDebit: debit,
      transactionCredit: credit,
      baseDebit: debit,
      baseCredit: credit,
      reference: input.reference,
      narration: input.narration,
      sourceDocumentId: input.sourceDocumentId ?? null,
      originType: 'source_posting',
      originMetadata: json({
        mesaerpPostingSource: { type: input.sourceType, id: input.sourceId, sourceSnapshotHash },
        mesaerpAccountingSnapshotHash: accountingSnapshotHash,
        ...(input.inventoryPlan ? { mesaerpInventoryPosting: input.inventoryPlan } : {}),
      }),
      createIdempotencyKey: `source:${input.sourceType}:${input.sourceId}`,
      requestHash: hashCanonical(mappingSnapshot),
      createdBy: context.membershipId,
      lines: {
        create: resolvedLines.map((line) => ({
          organizationId: context.organizationId,
          legalEntityId,
          lineNumber: line.lineNumber,
          accountId: line.accountId,
          accountSnapshot: line.accountSnapshot,
          transactionDebit: line.debit,
          transactionCredit: line.credit,
          baseDebit: line.debit,
          baseCredit: line.credit,
          narration: line.narration,
          dimensions: line.dimensions,
        })),
      },
    },
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
  });
  const link = await db.erpPostingLink.create({
    data: {
      organizationId: context.organizationId,
      legalEntityId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      voucherId: voucher.id,
      mappingSnapshot: json(mappingSnapshot),
      sourceSnapshotHash,
    },
    include: { voucher: { include: { lines: { orderBy: { lineNumber: 'asc' } } } } },
  });
  await audit(db, {
    action: 'mesaerp.source_posting.create', entity: 'ErpPostingLink', entityId: link.id,
    after: postingLinkDto(link),
  });
  return postingLinkDto(link);
}

export function postingLinkDto(link: {
  id: string;
  organizationId: string;
  legalEntityId: string;
  sourceType: string;
  sourceId: string;
  voucherId: string;
  mappingSnapshot: Prisma.JsonValue;
  sourceSnapshotHash: string;
  createdAt: Date;
  voucher: VoucherWithLines;
}) {
  return {
    id: link.id,
    organizationId: link.organizationId,
    legalEntityId: link.legalEntityId,
    sourceType: link.sourceType,
    sourceId: link.sourceId,
    voucherId: link.voucherId,
    voucherStatus: link.voucher.status,
    voucherRowVersion: link.voucher.rowVersion,
    mappingSnapshot: structuredClone(link.mappingSnapshot),
    sourceSnapshotHash: link.sourceSnapshotHash,
    createdAt: link.createdAt.toISOString(),
  };
}

function traceWhere(item: { batchTracked: boolean; serialTracked: boolean }, line: Pick<InventoryPostingLine, 'batchNumber' | 'serialNumber'>) {
  return {
    ...(item.batchTracked ? { batchNumber: line.batchNumber ?? '' } : {}),
    ...(item.serialTracked ? { serialNumber: line.serialNumber ?? '' } : {}),
  };
}

async function validateInventoryLine(db: Db, legalEntityId: string, businessDate: Date, line: InventoryPostingLine) {
  const [item, warehouse] = await Promise.all([
    db.erpItem.findFirst({ where: { id: line.itemId, legalEntityId, active: true } }),
    db.erpWarehouse.findFirst({ where: { id: line.warehouseId, legalEntityId, active: true } }),
  ]);
  if (!item) throw new ApiError(422, 'inventory_item_not_found', `Inventory item ${line.itemId} is missing or inactive.`);
  if (!warehouse) throw new ApiError(422, 'warehouse_not_found', `Warehouse ${line.warehouseId} is missing or inactive.`);
  if (item.itemType !== 'inventory') throw new ApiError(422, 'item_not_stocked', `${item.itemCode} is not an inventory item.`);
  if (item.baseUom.toUpperCase() !== line.uom.toUpperCase()) throw new ApiError(422, 'item_uom_mismatch', `${item.itemCode} must be posted in ${item.baseUom}.`);
  if (item.batchTracked && !(line.batchNumber ?? '').trim()) throw new ApiError(422, 'batch_number_required', `${item.itemCode} requires a batch number.`);
  if (item.serialTracked && !(line.serialNumber ?? '').trim()) throw new ApiError(422, 'serial_number_required', `${item.itemCode} requires a serial number.`);
  if (item.serialTracked && !quantity(line.quantity).equals(1)) throw new ApiError(422, 'serial_quantity_invalid', 'Each serial-tracked inventory line must have quantity 1.');
  if (item.expiryTracked && !line.expiryDate) throw new ApiError(422, 'expiry_date_required', `${item.itemCode} requires an expiry date.`);
  if (line.expiryDate && dateOnly(line.expiryDate) < businessDate) throw new ApiError(422, 'stock_expired', `${item.itemCode} cannot move with an expired trace date.`);
  const latest = await db.erpStockMovement.findFirst({
    where: { legalEntityId, itemId: item.id, warehouseId: warehouse.id, ...traceWhere(item, line) },
    orderBy: [{ businessDate: 'desc' }, { occurredAt: 'desc' }], select: { businessDate: true },
  });
  if (latest && latest.businessDate > businessDate) {
    throw new ApiError(409, 'backdated_inventory_posting', 'Backdated valued inventory would rewrite immutable valuation history. Post a current-period adjustment instead.');
  }
  return { item, warehouse };
}

async function currentBalance(db: Db, legalEntityId: string, item: { id: string; batchTracked: boolean; serialTracked: boolean }, warehouseId: string, line: Pick<InventoryPostingLine, 'batchNumber' | 'serialNumber'>) {
  const movements = await db.erpStockMovement.findMany({
    where: { legalEntityId, itemId: item.id, warehouseId, ...traceWhere(item, line) },
    select: { quantity: true, value: true },
  });
  return {
    quantity: quantity(sum(movements.map((movement) => movement.quantity))),
    value: money(sum(movements.map((movement) => movement.value))),
  };
}

async function fifoCost(db: Db, legalEntityId: string, item: { id: string; batchTracked: boolean; serialTracked: boolean }, warehouseId: string, line: InventoryPostingLine) {
  const layers = await db.erpValuationLayer.findMany({
    where: { legalEntityId, itemId: item.id, warehouseId, ...traceWhere(item, line) },
    include: { consumptions: { select: { quantity: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  let needed = quantity(line.quantity);
  const consumptions: Array<{ layerId: string; quantity: Prisma.Decimal; value: Prisma.Decimal; unitCost: Prisma.Decimal }> = [];
  for (const layer of layers) {
    const consumed = quantity(sum(layer.consumptions.map((entry) => entry.quantity)));
    const remaining = quantity(layer.quantity.minus(consumed));
    if (!remaining.greaterThan(0)) continue;
    const take = Prisma.Decimal.min(remaining, needed);
    const value = money(take.times(layer.unitCost));
    consumptions.push({ layerId: layer.id, quantity: take, value, unitCost: layer.unitCost });
    needed = quantity(needed.minus(take));
    if (!needed.greaterThan(0)) break;
  }
  if (needed.greaterThan(0)) throw new ApiError(409, 'negative_stock_prevented', 'FIFO layers do not contain enough stock for this issue.');
  return { value: money(sum(consumptions.map((entry) => entry.value))), consumptions };
}

export async function estimateIssueValue(db: Db, legalEntityId: string, businessDate: string, input: Omit<InventoryPostingLine, 'key' | 'direction' | 'movementType' | 'expectedValue'>) {
  const line: InventoryPostingLine = { ...input, key: 'estimate', direction: 'out', movementType: 'estimate', expectedValue: '0' };
  const date = dateOnly(businessDate);
  const { item, warehouse } = await validateInventoryLine(db, legalEntityId, date, line);
  await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${legalEntityId}:${item.id}:${warehouse.id}:${line.batchNumber ?? ''}:${line.serialNumber ?? ''}`}))`);
  const balance = await currentBalance(db, legalEntityId, item, warehouse.id, line);
  const requested = quantity(line.quantity);
  if (balance.quantity.lessThan(requested)) throw new ApiError(409, 'negative_stock_prevented', `${item.itemCode} has ${balance.quantity.toString()} ${item.baseUom} available.`);
  if (item.valuationMethod === 'fifo') return (await fifoCost(db, legalEntityId, item, warehouse.id, line)).value;
  const average = balance.quantity.greaterThan(0) ? rate(balance.value.dividedBy(balance.quantity)) : zero();
  return money(requested.times(average));
}

export async function applyInventoryPostingPlan(db: Db, context: TenantCtx, voucher: VoucherWithLines) {
  const metadata = record(voucher.originMetadata);
  const planValue = metadata.mesaerpInventoryPosting;
  if (!planValue) return [];
  const expectedAccountingHash = metadata.mesaerpAccountingSnapshotHash;
  if (typeof expectedAccountingHash !== 'string' || expectedAccountingHash !== hashCanonical(accountingSnapshot(voucher))) {
    throw new ApiError(409, 'source_posting_mapping_changed', 'The source-generated accounting mapping changed and cannot be posted.');
  }
  const plan = record(planValue);
  if (plan.version !== 1 || !Array.isArray(plan.lines) || typeof plan.businessDate !== 'string') {
    throw new ApiError(409, 'inventory_posting_plan_invalid', 'The voucher inventory posting plan is invalid.');
  }
  const businessDate = dateOnly(plan.businessDate);
  const rawLines = plan.lines.map(record);
  const lines: InventoryPostingLine[] = rawLines.map((line) => ({
    key: String(line.key ?? ''), direction: line.direction === 'in' ? 'in' : 'out', movementType: String(line.movementType ?? ''),
    itemId: String(line.itemId ?? ''), warehouseId: String(line.warehouseId ?? ''), quantity: String(line.quantity ?? ''),
    uom: String(line.uom ?? ''), expectedValue: String(line.expectedValue ?? ''),
    ...(typeof line.unitCost === 'string' ? { unitCost: line.unitCost } : {}),
    ...(typeof line.batchNumber === 'string' ? { batchNumber: line.batchNumber } : {}),
    ...(typeof line.serialNumber === 'string' ? { serialNumber: line.serialNumber } : {}),
    ...(typeof line.expiryDate === 'string' ? { expiryDate: line.expiryDate } : {}),
    ...(typeof line.sourceDocumentId === 'string' ? { sourceDocumentId: line.sourceDocumentId } : {}),
    originMetadata: record(line.originMetadata),
  }));
  if (!lines.length || lines.some((line) => !line.key || !line.itemId || !line.warehouseId || !quantity(line.quantity).greaterThan(0))) {
    throw new ApiError(409, 'inventory_posting_plan_invalid', 'The voucher inventory posting plan contains an invalid line.');
  }
  const lockKeys = [...new Set(lines.map((line) => `${voucher.legalEntityId}:${line.itemId}:${line.warehouseId}:${line.batchNumber ?? ''}:${line.serialNumber ?? ''}`))].sort();
  for (const lockKey of lockKeys) await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

  const created = [];
  for (const line of lines) {
    const replay = await db.erpStockMovement.findFirst({
      where: { legalEntityId: voucher.legalEntityId, idempotencyKey: `voucher:${voucher.id}:${line.key}` },
    });
    if (replay) { created.push(replay); continue; }
    const { item, warehouse } = await validateInventoryLine(db, voucher.legalEntityId, businessDate, line);
    const requested = quantity(line.quantity);
    let unitCost: Prisma.Decimal;
    let movementValue: Prisma.Decimal;
    let fifoConsumptions: Array<{ layerId: string; quantity: Prisma.Decimal; value: Prisma.Decimal; unitCost: Prisma.Decimal }> = [];
    if (line.direction === 'in') {
      if (line.unitCost === undefined) throw new ApiError(422, 'receipt_unit_cost_required', 'Stock receipts require an immutable unit cost.');
      unitCost = rate(line.unitCost);
      movementValue = money(requested.times(unitCost));
      if (item.serialTracked) {
        const duplicateSerial = await db.erpStockMovement.findFirst({
          where: { legalEntityId: voucher.legalEntityId, itemId: item.id, serialNumber: line.serialNumber ?? '', quantity: { gt: 0 } }, select: { id: true },
        });
        if (duplicateSerial) throw new ApiError(409, 'serial_number_exists', `Serial ${line.serialNumber} was already received.`);
      }
    } else {
      const balance = await currentBalance(db, voucher.legalEntityId, item, warehouse.id, line);
      if (balance.quantity.lessThan(requested)) throw new ApiError(409, 'negative_stock_prevented', `${item.itemCode} has ${balance.quantity.toString()} ${item.baseUom} available.`);
      if (item.valuationMethod === 'fifo') {
        const fifo = await fifoCost(db, voucher.legalEntityId, item, warehouse.id, line);
        movementValue = fifo.value;
        fifoConsumptions = fifo.consumptions;
        unitCost = requested.greaterThan(0) ? rate(movementValue.dividedBy(requested)) : zero();
      } else {
        unitCost = balance.quantity.greaterThan(0) ? rate(balance.value.dividedBy(balance.quantity)) : zero();
        movementValue = money(requested.times(unitCost));
      }
    }
    if (!money(line.expectedValue).equals(movementValue)) {
      throw new ApiError(409, 'inventory_valuation_changed', `Inventory value for ${item.itemCode} changed from ${line.expectedValue} to ${movementValue.toString()}; regenerate the draft posting.`);
    }
    const movement = await db.erpStockMovement.create({
      data: {
        organizationId: context.organizationId,
        legalEntityId: voucher.legalEntityId,
        financialYearId: voucher.financialYearId,
        itemId: item.id,
        warehouseId: warehouse.id,
        movementType: line.movementType,
        businessDate,
        quantity: line.direction === 'in' ? requested : requested.negated(),
        uom: item.baseUom,
        unitCost,
        value: line.direction === 'in' ? movementValue : movementValue.negated(),
        valuationMethod: item.valuationMethod,
        valuationLayer: json({
          version: 1,
          method: item.valuationMethod,
          direction: line.direction,
          unitCost: unitCost.toString(),
          value: movementValue.toString(),
          ...(fifoConsumptions.length ? { fifoLayers: fifoConsumptions.map((entry) => ({ layerId: entry.layerId, quantity: entry.quantity.toString(), value: entry.value.toString() })) } : {}),
        }),
        batchNumber: line.batchNumber ?? '',
        serialNumber: line.serialNumber ?? '',
        expiryDate: line.expiryDate ? dateOnly(line.expiryDate) : null,
        sourceDocumentId: line.sourceDocumentId ?? voucher.sourceDocumentId,
        voucherId: voucher.id,
        originType: 'voucher_posting',
        originMetadata: json({ sourceType: plan.sourceType, sourceId: plan.sourceId, lineKey: line.key, ...line.originMetadata }),
        idempotencyKey: `voucher:${voucher.id}:${line.key}`,
      },
    });
    if (line.direction === 'in') {
      await db.erpValuationLayer.create({
        data: {
          organizationId: context.organizationId,
          legalEntityId: voucher.legalEntityId,
          itemId: item.id,
          warehouseId: warehouse.id,
          receiptMovementId: movement.id,
          batchNumber: line.batchNumber ?? '', serialNumber: line.serialNumber ?? '',
          expiryDate: line.expiryDate ? dateOnly(line.expiryDate) : null,
          quantity: requested, unitCost, value: movementValue,
        },
      });
    } else if (fifoConsumptions.length) {
      await db.erpValuationConsumption.createMany({
        data: fifoConsumptions.map((entry) => ({
          organizationId: context.organizationId, legalEntityId: voucher.legalEntityId,
          valuationLayerId: entry.layerId, issueMovementId: movement.id, quantity: entry.quantity, value: entry.value,
        })),
      });
    }
    created.push(movement);
  }
  return created;
}

function lineTrace(line: ErpDocumentLine) {
  const dimensions = record(line.dimensions);
  return {
    batchNumber: line.batchNumber,
    ...(typeof dimensions.serialNumber === 'string' ? { serialNumber: dimensions.serialNumber } : {}),
    ...(typeof dimensions.expiryDate === 'string' ? { expiryDate: dimensions.expiryDate } : {}),
  };
}

async function documentItemsAndWarehouses(db: Db, document: DocumentWithLines) {
  const itemIds = [...new Set(document.lines.flatMap((line) => line.itemId ? [line.itemId] : []))];
  const warehouseCodes = [...new Set(document.lines.map((line) => line.warehouseCode).filter(Boolean))];
  const [items, warehouses] = await Promise.all([
    db.erpItem.findMany({ where: { legalEntityId: document.legalEntityId, id: { in: itemIds }, active: true } }),
    db.erpWarehouse.findMany({ where: { legalEntityId: document.legalEntityId, code: { in: warehouseCodes }, active: true } }),
  ]);
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const warehouseMap = new Map(warehouses.map((warehouse) => [warehouse.code, warehouse]));
  return { itemMap, warehouseMap };
}

export async function ensureDocumentPostingDraft(db: Db, context: TenantCtx, document: DocumentWithLines) {
  if (!['goods_receipt', 'supplier_invoice', 'sales_invoice'].includes(document.documentType)) return null;
  const existing = await db.erpPostingLink.findFirst({ where: { legalEntityId: document.legalEntityId, sourceType: document.documentType, sourceId: document.id }, include: { voucher: { include: { lines: true } } } });
  if (existing) return postingLinkDto(existing);
  const { itemMap, warehouseMap } = await documentItemsAndWarehouses(db, document);
  const accountingLines: AccountingPostingLine[] = [];
  const inventoryLines: InventoryPostingLine[] = [];
  const taxableTotal = money(sum(document.lines.map((line) => line.taxableAmount)));
  const taxTotal = money(document.taxTotal);
  const businessDate = day(document.documentDate);

  if (document.documentType === 'supplier_invoice') {
    accountingLines.push(
      { account: '2010', debit: taxableTotal.toString(), credit: '0', narration: `Clear GRNI for ${document.documentNumber}` },
      ...(taxTotal.greaterThan(0) ? [{ account: '1300', debit: taxTotal.toString(), credit: '0', narration: `Input tax for ${document.documentNumber}` }] : []),
      { account: '2000', debit: '0', credit: money(document.grandTotal).toString(), narration: `Supplier payable ${document.documentNumber}` },
    );
  } else if (document.documentType === 'goods_receipt') {
    for (const [index, line] of document.lines.entries()) {
      if (!line.itemId || !line.warehouseCode) throw new ApiError(422, 'inventory_mapping_missing', 'Approved goods-receipt lines require an inventory item and warehouse code.');
      const item = itemMap.get(line.itemId);
      const warehouse = warehouseMap.get(line.warehouseCode);
      if (!item || !warehouse || !item.inventoryAccount) throw new ApiError(422, 'inventory_mapping_missing', `Goods-receipt line ${index + 1} is missing an active item, warehouse or inventory account.`);
      const value = money(line.taxableAmount);
      const unitCost = rate(value.dividedBy(line.quantity));
      accountingLines.push({ account: item.inventoryAccount, debit: value.toString(), credit: '0', narration: `Receive ${item.itemCode}`, dimensions: { itemId: item.id, warehouseId: warehouse.id } });
      inventoryLines.push({ key: `grn-${line.id}`, direction: 'in', movementType: 'goods_receipt', itemId: item.id, warehouseId: warehouse.id, quantity: line.quantity.toString(), uom: line.uom, unitCost: unitCost.toString(), expectedValue: value.toString(), ...lineTrace(line), sourceDocumentId: document.id });
    }
    accountingLines.push({ account: '2010', debit: '0', credit: taxableTotal.toString(), narration: `GRNI accrual ${document.documentNumber}` });
  } else {
    accountingLines.push({ account: '1100', debit: money(document.grandTotal).toString(), credit: '0', narration: `Customer receivable ${document.documentNumber}` });
    for (const [index, line] of document.lines.entries()) {
      if (!line.itemId) throw new ApiError(422, 'sales_mapping_missing', `Sales-invoice line ${index + 1} requires an item.`);
      const item = itemMap.get(line.itemId);
      if (!item || !item.salesAccount) throw new ApiError(422, 'sales_mapping_missing', `Sales-invoice line ${index + 1} is missing an active item or sales account.`);
      accountingLines.push({ account: item.salesAccount, debit: '0', credit: line.taxableAmount.toString(), narration: `Sale of ${item.itemCode}`, dimensions: { itemId: item.id } });
      if (item.itemType === 'inventory') {
        const warehouse = warehouseMap.get(line.warehouseCode);
        if (!warehouse || !item.inventoryAccount || !item.consumptionAccount) throw new ApiError(422, 'inventory_mapping_missing', `Sales-invoice line ${index + 1} is missing warehouse, inventory or consumption mapping.`);
        const trace = lineTrace(line);
        const value = await estimateIssueValue(db, document.legalEntityId, businessDate, { itemId: item.id, warehouseId: warehouse.id, quantity: line.quantity.toString(), uom: line.uom, ...trace });
        accountingLines.push(
          { account: item.consumptionAccount, debit: value.toString(), credit: '0', narration: `COGS ${item.itemCode}`, dimensions: { itemId: item.id, warehouseId: warehouse.id } },
          { account: item.inventoryAccount, debit: '0', credit: value.toString(), narration: `Issue ${item.itemCode}`, dimensions: { itemId: item.id, warehouseId: warehouse.id } },
        );
        inventoryLines.push({ key: `sale-${line.id}`, direction: 'out', movementType: 'sales_issue', itemId: item.id, warehouseId: warehouse.id, quantity: line.quantity.toString(), uom: line.uom, expectedValue: value.toString(), ...trace, sourceDocumentId: document.id });
      }
    }
    if (taxTotal.greaterThan(0)) accountingLines.push({ account: '2100', debit: '0', credit: taxTotal.toString(), narration: `Output tax ${document.documentNumber}` });
  }
  const inventoryPlan = inventoryLines.length ? { version: 1 as const, sourceType: document.documentType, sourceId: document.id, businessDate, lines: inventoryLines } : undefined;
  return ensureSourcePostingDraft(db, context, document.legalEntityId, {
    sourceType: document.documentType,
    sourceId: document.id,
    sourceDocumentId: document.id,
    voucherType: document.documentType === 'sales_invoice' ? 'sales' : 'purchase',
    businessDate,
    currency: document.currency,
    reference: document.documentNumber,
    narration: `Draft posting generated from approved ${document.documentType.replaceAll('_', ' ')} ${document.documentNumber}.`,
    sourceSnapshot: document,
    accountingLines,
    ...(inventoryPlan ? { inventoryPlan } : {}),
  });
}

export async function ensureManufacturingPostingDraft(db: Db, context: TenantCtx, voucher: ErpManufacturingVoucher) {
  const existing = await db.erpPostingLink.findFirst({ where: { legalEntityId: voucher.legalEntityId, sourceType: 'manufacturing_voucher', sourceId: voucher.id }, include: { voucher: { include: { lines: true } } } });
  if (existing) return postingLinkDto(existing);
  const businessDate = day(voucher.businessDate);
  const materialLines = array(voucher.materialLines);
  const outputLines = array(voucher.outputLines);
  const recoveryLines = array(voucher.recoveryCredits);
  const itemIds = [...new Set([...materialLines, ...outputLines, ...recoveryLines].flatMap((line) => typeof line.itemId === 'string' ? [line.itemId] : []))];
  const warehouseCodes = [...new Set([...materialLines, ...outputLines, ...recoveryLines].flatMap((line) => typeof line.warehouseCode === 'string' && line.warehouseCode ? [line.warehouseCode] : []))];
  const [items, warehouses, priorOpen, priorPosted] = await Promise.all([
    db.erpItem.findMany({ where: { legalEntityId: voucher.legalEntityId, id: { in: itemIds }, active: true } }),
    db.erpWarehouse.findMany({ where: { legalEntityId: voucher.legalEntityId, code: { in: warehouseCodes }, active: true } }),
    db.erpManufacturingVoucher.findFirst({ where: { legalEntityId: voucher.legalEntityId, batchNumber: voucher.batchNumber, id: { not: voucher.id }, status: { in: ['submitted', 'approved'] } }, select: { id: true } }),
    db.erpManufacturingVoucher.findMany({ where: { legalEntityId: voucher.legalEntityId, batchNumber: voucher.batchNumber, id: { not: voucher.id }, status: 'posted' } }),
  ]);
  if (priorOpen) throw new ApiError(409, 'batch_posting_sequence_incomplete', 'Submit and post earlier manufacturing vouchers for this batch before approving the next posting.');
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const warehouseMap = new Map(warehouses.map((warehouse) => [warehouse.code, warehouse]));
  const accountingLines: AccountingPostingLine[] = [];
  const inventoryLines: InventoryPostingLine[] = [];
  let materialTotal = zero();

  for (const [index, line] of materialLines.entries()) {
    if (typeof line.itemId !== 'string' || typeof line.warehouseCode !== 'string' || typeof line.quantity !== 'string' || typeof line.uom !== 'string') {
      throw new ApiError(422, 'manufacturing_inventory_mapping_missing', `Manufacturing material line ${index + 1} requires item, warehouse, quantity and UOM.`);
    }
    const item = itemMap.get(line.itemId);
    const warehouse = warehouseMap.get(line.warehouseCode);
    if (!item || !warehouse || !item.inventoryAccount) throw new ApiError(422, 'manufacturing_inventory_mapping_missing', `Manufacturing material line ${index + 1} is not fully mapped.`);
    const trace = { batchNumber: typeof line.batchNumber === 'string' ? line.batchNumber : voucher.batchNumber, serialNumber: typeof line.serialNumber === 'string' ? line.serialNumber : '', expiryDate: typeof line.expiryDate === 'string' ? line.expiryDate : undefined };
    let value: Prisma.Decimal;
    if (voucher.voucherType === 'return') {
      if (typeof line.rate !== 'string') throw new ApiError(422, 'manufacturing_inventory_mapping_missing', 'Material returns require a receipt rate.');
      value = money(new Prisma.Decimal(line.quantity).times(line.rate));
      inventoryLines.push({ key: `material-return-${index + 1}`, direction: 'in', movementType: 'manufacturing_return', itemId: item.id, warehouseId: warehouse.id, quantity: line.quantity, uom: line.uom, unitCost: rate(line.rate).toString(), expectedValue: value.toString(), ...trace });
      accountingLines.push({ account: item.inventoryAccount, debit: value.toString(), credit: '0', narration: `Return ${item.itemCode}`, dimensions: { itemId: item.id, warehouseId: warehouse.id, batchNumber: voucher.batchNumber } });
    } else {
      value = await estimateIssueValue(db, voucher.legalEntityId, businessDate, { itemId: item.id, warehouseId: warehouse.id, quantity: line.quantity, uom: line.uom, ...trace });
      inventoryLines.push({ key: `material-issue-${index + 1}`, direction: 'out', movementType: 'manufacturing_issue', itemId: item.id, warehouseId: warehouse.id, quantity: line.quantity, uom: line.uom, expectedValue: value.toString(), ...trace });
      accountingLines.push({ account: item.inventoryAccount, debit: '0', credit: value.toString(), narration: `Consume ${item.itemCode}`, dimensions: { itemId: item.id, warehouseId: warehouse.id, batchNumber: voucher.batchNumber } });
    }
    materialTotal = materialTotal.plus(value);
  }
  if (materialLines.length && !money(voucher.materialValue).equals(money(materialTotal))) {
    throw new ApiError(409, 'manufacturing_material_valuation_mismatch', `Manufacturing material value ${voucher.materialValue.toString()} does not match valued inventory ${money(materialTotal).toString()}.`);
  }
  if (voucher.voucherType === 'return') {
    accountingLines.push({ account: '1210', debit: '0', credit: money(materialTotal).toString(), narration: `Return material from WIP ${voucher.batchNumber}` });
  } else if (materialTotal.greaterThan(0)) {
    accountingLines.push({ account: '1210', debit: money(materialTotal).toString(), credit: '0', narration: `Material to WIP ${voucher.batchNumber}` });
  }

  const completionStyle = ['manufacturing', 'completion', 'rework'].includes(voucher.voucherType);
  if (completionStyle) {
    const lineTotal = (value: Prisma.JsonValue) => money(sum(array(value).map((line) => new Prisma.Decimal(typeof line.amount === 'string' ? line.amount : '0'))));
    const labor = lineTotal(voucher.laborLines);
    const machine = lineTotal(voucher.resourceLines);
    const overhead = lineTotal(voucher.overheadLines);
    const subcontract = lineTotal(voucher.subcontractLines);
    const recovery = money(voucher.recoveryValue);
    const conversionPostings: Array<[Prisma.Decimal, string, string]> = [
      [labor, '5200', 'Direct labour'],
      [machine.plus(overhead), '5300', 'Machine and overhead'],
      [subcontract, '2000', 'Subcontract'],
    ];
    for (const [amount, account, label] of conversionPostings) {
      if (amount.greaterThan(0)) {
        accountingLines.push(
          { account: '1210', debit: amount.toString(), credit: '0', narration: `${label} to WIP ${voucher.batchNumber}` },
          { account, debit: '0', credit: amount.toString(), narration: `${label} absorption ${voucher.batchNumber}` },
        );
      }
    }
    const priorActual = money(sum(priorPosted.map((row) => row.voucherType === 'return' ? row.actualCost.negated() : row.actualCost)));
    const totalOutputValue = money(priorActual.plus(voucher.actualCost));
    const finishedOutputs = outputLines.filter((line) => line.outputType === 'finished_good');
    const recoveryOutputs = outputLines.filter((line) => line.outputType !== 'finished_good');
    const finishedQuantity = quantity(sum(finishedOutputs.map((line) => new Prisma.Decimal(String(line.quantity ?? '0')))));
    const recoveryQuantity = quantity(sum(recoveryOutputs.map((line) => new Prisma.Decimal(String(line.quantity ?? '0')))));
    if (!finishedQuantity.greaterThan(0)) throw new ApiError(422, 'finished_output_required', 'Manufacturing completion requires finished-good output.');
    if (recovery.greaterThan(0) && !recoveryQuantity.greaterThan(0)) throw new ApiError(422, 'recovery_output_mapping_missing', 'Recovery credits require a by-product or scrap output line so the recovered value remains traceable.');
    for (const [index, line] of outputLines.entries()) {
      if (typeof line.itemId !== 'string' || typeof line.warehouseCode !== 'string' || typeof line.quantity !== 'string' || typeof line.uom !== 'string') throw new ApiError(422, 'manufacturing_output_mapping_missing', `Output line ${index + 1} requires item, warehouse, quantity and UOM.`);
      const item = itemMap.get(line.itemId);
      const warehouse = warehouseMap.get(line.warehouseCode);
      if (!item || !warehouse || !item.inventoryAccount) throw new ApiError(422, 'manufacturing_output_mapping_missing', `Output line ${index + 1} is not fully mapped.`);
      const isFinished = line.outputType === 'finished_good';
      const poolValue = isFinished ? totalOutputValue : recovery;
      const poolQuantity = isFinished ? finishedQuantity : recoveryQuantity;
      const unitCost = rate(poolValue.dividedBy(poolQuantity));
      const value = money(new Prisma.Decimal(line.quantity).times(unitCost));
      const trace = { batchNumber: typeof line.batchNumber === 'string' && line.batchNumber ? line.batchNumber : voucher.batchNumber, serialNumber: typeof line.serialNumber === 'string' ? line.serialNumber : '', expiryDate: typeof line.expiryDate === 'string' ? line.expiryDate : undefined };
      inventoryLines.push({ key: `output-${index + 1}`, direction: 'in', movementType: isFinished ? 'manufacturing_completion' : 'manufacturing_recovery', itemId: item.id, warehouseId: warehouse.id, quantity: line.quantity, uom: line.uom, unitCost: unitCost.toString(), expectedValue: value.toString(), ...trace });
      accountingLines.push({ account: item.inventoryAccount, debit: value.toString(), credit: '0', narration: `${isFinished ? 'Finished output' : 'Recovery output'} ${item.itemCode}`, dimensions: { itemId: item.id, warehouseId: warehouse.id, batchNumber: voucher.batchNumber } });
    }
    if (recovery.greaterThan(0)) accountingLines.push({ account: '1210', debit: '0', credit: recovery.toString(), narration: `Recovery from WIP ${voucher.batchNumber}` });
    accountingLines.push({ account: '1210', debit: '0', credit: totalOutputValue.toString(), narration: `Complete WIP ${voucher.batchNumber}` });
  }
  const inventoryPlan: InventoryPostingPlan = { version: 1, sourceType: 'manufacturing_voucher', sourceId: voucher.id, businessDate, lines: inventoryLines };
  return ensureSourcePostingDraft(db, context, voucher.legalEntityId, {
    sourceType: 'manufacturing_voucher', sourceId: voucher.id, voucherType: 'manufacturing_journal', businessDate,
    currency: (await db.legalEntity.findUniqueOrThrow({ where: { id: voucher.legalEntityId } })).baseCurrency,
    reference: voucher.voucherNumber, narration: `Draft posting generated from manufacturing voucher ${voucher.voucherNumber}.`,
    sourceSnapshot: voucher, accountingLines, inventoryPlan,
  });
}

export async function requirePostedSourcePosting(db: Db, legalEntityId: string, sourceType: string, sourceId: string) {
  const link = await db.erpPostingLink.findFirst({
    where: { legalEntityId, sourceType, sourceId }, include: { voucher: { include: { lines: { orderBy: { lineNumber: 'asc' } } } } },
  });
  if (!link) throw new ApiError(409, 'accounting_posting_missing', 'Approve the source record to create its accounting posting draft.');
  if (link.voucher.status !== 'posted') {
    throw new ApiError(409, 'accounting_voucher_not_posted', `Accounting voucher ${link.voucher.id} is ${link.voucher.status}; complete its maker-checker lifecycle before posting the source record.`);
  }
  return postingLinkDto(link);
}
