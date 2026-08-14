import { randomUUID } from 'node:crypto';
import { Prisma, type ErpItem, type ErpWarehouse } from '@prisma/client';
import { basePrisma, tenantTx } from '../db';
import { audit } from '../lib/audit';
import { tenantContext, type TenantCtx } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import { hasMesaErpPermission } from './access';
import { ensureSourcePostingDraft, estimateIssueValue, postingLinkDto, type AccountingPostingLine, type InventoryPostingLine, type InventoryPostingPlan } from './inventoryPosting';
import { hashCanonical } from './repository';
import type { ItemCreate, ItemUpdate, PhysicalCountCreate, StockAdjustmentCreate, StockTransferCreate, WarehouseCreate, WarehouseUpdate } from './valuedInventorySchemas';

type Db = typeof basePrisma;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const zero = () => new Prisma.Decimal(0);
const quantity = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const rate = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), zero());
const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
const day = (value: Date) => value.toISOString().slice(0, 10);

function actor(): TenantCtx {
  const context = tenantContext.getStore();
  if (!context) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return context;
}

async function requireEntity(db: Db, context: TenantCtx, legalEntityId: string) {
  const entity = await db.legalEntity.findFirst({ where: { id: legalEntityId, organizationId: context.organizationId, status: 'active' } });
  if (!entity) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found or inactive.');
  return entity;
}

async function replay<T>(db: Db, organizationId: string, scope: string, key: string, requestHash: string): Promise<T | null> {
  const record = await db.erpIdempotencyRecord.findUnique({ where: { organizationId_scope_key: { organizationId, scope, key } } });
  if (!record) return null;
  if (record.requestHash !== requestHash) throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was already used with a different request.');
  return structuredClone(record.response) as T;
}

async function runIdempotent<T>(legalEntityId: string, scope: string, key: string, payload: unknown, execute: (db: Db, context: TenantCtx) => Promise<T>) {
  const context = actor();
  const requestHash = hashCanonical({ legalEntityId, payload });
  const once = () => tenantTx(async (db) => {
    const existing = await replay<T>(db, context.organizationId, scope, key, requestHash);
    if (existing) return existing;
    await requireEntity(db, context, legalEntityId);
    await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.organizationId}:${scope}:${key}`}))`);
    const afterLock = await replay<T>(db, context.organizationId, scope, key, requestHash);
    if (afterLock) return afterLock;
    const response = await execute(db, context);
    await db.erpIdempotencyRecord.create({ data: { organizationId: context.organizationId, legalEntityId, scope, key, requestHash, response: json(response) } });
    return response;
  });
  try { return await once(); } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    return tenantTx(async (db) => {
      const existing = await replay<T>(db, context.organizationId, scope, key, requestHash);
      if (existing) return existing;
      throw error;
    });
  }
}

function itemDto(item: ErpItem) {
  return {
    id: item.id, organizationId: item.organizationId, legalEntityId: item.legalEntityId,
    itemCode: item.itemCode, name: item.name, itemType: item.itemType, category: item.category,
    baseUom: item.baseUom, uomConversions: structuredClone(item.uomConversions), hsnSacCode: item.hsnSacCode,
    gstRate: item.gstRate.toString(), valuationMethod: item.valuationMethod,
    batchTracked: item.batchTracked, serialTracked: item.serialTracked, expiryTracked: item.expiryTracked,
    inventoryAccount: item.inventoryAccount, consumptionAccount: item.consumptionAccount,
    salesAccount: item.salesAccount, purchaseAccount: item.purchaseAccount,
    active: item.active, attributes: structuredClone(item.attributes), rowVersion: item.rowVersion,
    createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
  };
}

function warehouseDto(warehouse: ErpWarehouse) {
  return {
    id: warehouse.id, organizationId: warehouse.organizationId, legalEntityId: warehouse.legalEntityId,
    code: warehouse.code, name: warehouse.name, kind: warehouse.kind, plantCode: warehouse.plantCode,
    branchCode: warehouse.branchCode, address: structuredClone(warehouse.address), allowNegative: false,
    active: warehouse.active, rowVersion: warehouse.rowVersion,
    createdAt: warehouse.createdAt.toISOString(), updatedAt: warehouse.updatedAt.toISOString(),
  };
}

async function resolveAccountReferences(db: Db, legalEntityId: string, input: { inventoryAccount?: string; consumptionAccount?: string; salesAccount?: string; purchaseAccount?: string }, inventoryItem: boolean) {
  const requested = {
    inventoryAccount: input.inventoryAccount ?? '',
    consumptionAccount: input.consumptionAccount ?? (inventoryItem ? '5000' : ''),
    salesAccount: input.salesAccount ?? (inventoryItem ? '4000' : ''),
    purchaseAccount: input.purchaseAccount ?? (inventoryItem ? '5000' : ''),
  };
  const references = [...new Set(Object.values(requested).filter(Boolean))];
  const rows = await db.erpAccount.findMany({ where: { legalEntityId, active: true, allowPosting: true, OR: [{ id: { in: references } }, { code: { in: references } }] } });
  const byRef = new Map(rows.flatMap((row) => [[row.id, row], [row.code, row]] as const));
  const missing = references.filter((reference) => !byRef.has(reference));
  if (missing.length) throw new ApiError(422, 'posting_mapping_missing', `Unknown item posting account: ${missing.join(', ')}.`);
  if (inventoryItem && !requested.inventoryAccount) throw new ApiError(422, 'inventory_account_required', 'Inventory items require an inventory posting account.');
  return Object.fromEntries(Object.entries(requested).map(([key, reference]) => [key, reference ? byRef.get(reference)!.id : ''])) as typeof requested;
}

async function yearFor(db: Db, legalEntityId: string, businessDate: Date) {
  const year = await db.financialYear.findFirst({ where: { legalEntityId, startsOn: { lte: businessDate }, endsOn: { gte: businessDate } } });
  if (!year) throw new ApiError(409, 'financial_year_missing', 'No financial year covers this inventory date.');
  const period = await db.accountingPeriod.findFirst({ where: { financialYearId: year.id, startsOn: { lte: businessDate }, endsOn: { gte: businessDate } } });
  if (!period || period.status !== 'open') throw new ApiError(409, 'period_closed', 'Inventory changes require an open accounting period.');
  return year;
}

async function allocateCountNumber(db: Db, context: TenantCtx, legalEntityId: string, businessDate: Date) {
  const entity = await requireEntity(db, context, legalEntityId);
  const year = await yearFor(db, legalEntityId, businessDate);
  const prefix = `${entity.code}-CNT-${year.code}-`;
  const rows = await db.$queryRaw<Array<{ nextValue: number }>>(Prisma.sql`
    INSERT INTO "ErpNumberSeries" (
      "id", "organizationId", "legalEntityId", "financialYearId", "documentType", "prefix", "padding", "nextValue", "createdAt", "updatedAt"
    ) VALUES (${randomUUID()}, ${context.organizationId}, ${legalEntityId}, ${year.id}, 'inventory_count', ${prefix}, 6, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("organizationId", "legalEntityId", "financialYearId", "documentType")
    DO UPDATE SET "nextValue" = "ErpNumberSeries"."nextValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "nextValue"
  `);
  return { year, number: `${prefix}${String((rows[0]?.nextValue ?? 2) - 1).padStart(6, '0')}` };
}

export class PrismaMesaErpValuedInventoryService {
  hasPermission(input: { organizationId: string; membershipId: string; legalEntityId: string; permission: string }) {
    return hasMesaErpPermission(input);
  }

  async listItems(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      return (await db.erpItem.findMany({ where: { legalEntityId }, orderBy: [{ itemCode: 'asc' }], take: 1000 })).map(itemDto);
    });
  }

  async getItem(legalEntityId: string, itemId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const item = await db.erpItem.findFirst({ where: { id: itemId, legalEntityId, organizationId: context.organizationId } });
      if (!item) throw new ApiError(404, 'item_not_found', 'Item not found in this company.');
      return itemDto(item);
    });
  }

  createItem(legalEntityId: string, input: ItemCreate, idempotencyKey: string) {
    return runIdempotent(legalEntityId, `inventory:item:create:${legalEntityId}`, idempotencyKey, input, async (db, context) => {
      const duplicate = await db.erpItem.findFirst({ where: { legalEntityId, itemCode: input.itemCode }, select: { id: true } });
      if (duplicate) throw new ApiError(409, 'item_code_exists', 'Item code already exists in this company.');
      const mappings = await resolveAccountReferences(db, legalEntityId, input, input.itemType === 'inventory');
      const item = await db.erpItem.create({ data: {
        organizationId: context.organizationId, legalEntityId, itemCode: input.itemCode, name: input.name,
        itemType: input.itemType, category: input.category, baseUom: input.baseUom.toUpperCase(),
        uomConversions: json(input.uomConversions.map((entry) => ({ uom: entry.uom.toUpperCase(), factorToBase: entry.factorToBase }))),
        hsnSacCode: input.hsnSacCode, gstRate: input.gstRate, valuationMethod: input.valuationMethod,
        batchTracked: input.batchTracked, serialTracked: input.serialTracked, expiryTracked: input.expiryTracked,
        ...mappings, active: input.active, attributes: json(input.attributes),
        createIdempotencyKey: `item:${idempotencyKey}`, requestHash: hashCanonical(input),
      } });
      const response = itemDto(item);
      await audit(db, { action: 'mesaerp.item.create', entity: 'ErpItem', entityId: item.id, after: response });
      return response;
    });
  }

  updateItem(legalEntityId: string, itemId: string, input: ItemUpdate, idempotencyKey: string) {
    return runIdempotent(legalEntityId, `inventory:item:${itemId}:update`, idempotencyKey, input, async (db) => {
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpItem" WHERE "id" = ${itemId} FOR UPDATE`);
      const existing = await db.erpItem.findFirst({ where: { id: itemId, legalEntityId } });
      if (!existing) throw new ApiError(404, 'item_not_found', 'Item not found in this company.');
      if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Item changed since it was loaded.');
      const hasMovement = Boolean(await db.erpStockMovement.findFirst({ where: { legalEntityId, itemId }, select: { id: true } }));
      const lockedFields = ['itemType', 'baseUom', 'valuationMethod', 'batchTracked', 'serialTracked', 'expiryTracked'] as const;
      if (hasMovement && lockedFields.some((field) => input[field] !== undefined && input[field] !== existing[field])) {
        throw new ApiError(409, 'item_stock_policy_locked', 'Item type, UOM, valuation and trace policies are fixed after the first stock transaction.');
      }
      const finalItemType = input.itemType ?? existing.itemType;
      const finalBatch = input.batchTracked ?? existing.batchTracked;
      const finalExpiry = input.expiryTracked ?? existing.expiryTracked;
      if (finalExpiry && !finalBatch) throw new ApiError(422, 'expiry_requires_batch', 'Expiry tracking requires batch tracking.');
      const mappings = await resolveAccountReferences(db, legalEntityId, {
        inventoryAccount: input.inventoryAccount ?? existing.inventoryAccount,
        consumptionAccount: input.consumptionAccount ?? existing.consumptionAccount,
        salesAccount: input.salesAccount ?? existing.salesAccount,
        purchaseAccount: input.purchaseAccount ?? existing.purchaseAccount,
      }, finalItemType === 'inventory');
      const { expectedRowVersion: _version, uomConversions, baseUom, attributes, ...changes } = input;
      const changed = await db.erpItem.updateMany({ where: { id: itemId, legalEntityId, rowVersion: input.expectedRowVersion }, data: {
        ...changes, ...mappings,
        ...(baseUom ? { baseUom: baseUom.toUpperCase() } : {}),
        ...(uomConversions ? { uomConversions: json(uomConversions.map((entry) => ({ uom: entry.uom.toUpperCase(), factorToBase: entry.factorToBase }))) } : {}),
        ...(attributes ? { attributes: json(attributes) } : {}),
        rowVersion: { increment: 1 },
      } });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Item changed while the update was saved.');
      const updated = await db.erpItem.findUniqueOrThrow({ where: { id: itemId } });
      const response = itemDto(updated);
      await audit(db, { action: 'mesaerp.item.update', entity: 'ErpItem', entityId: itemId, before: itemDto(existing), after: response });
      return response;
    });
  }

  async listWarehouses(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      return (await db.erpWarehouse.findMany({ where: { legalEntityId }, orderBy: [{ code: 'asc' }], take: 500 })).map(warehouseDto);
    });
  }

  async getWarehouse(legalEntityId: string, warehouseId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const warehouse = await db.erpWarehouse.findFirst({ where: { id: warehouseId, legalEntityId, organizationId: context.organizationId } });
      if (!warehouse) throw new ApiError(404, 'warehouse_not_found', 'Warehouse not found in this company.');
      return warehouseDto(warehouse);
    });
  }

  createWarehouse(legalEntityId: string, input: WarehouseCreate, idempotencyKey: string) {
    return runIdempotent(legalEntityId, `inventory:warehouse:create:${legalEntityId}`, idempotencyKey, input, async (db, context) => {
      const duplicate = await db.erpWarehouse.findFirst({ where: { legalEntityId, code: input.code }, select: { id: true } });
      if (duplicate) throw new ApiError(409, 'warehouse_code_exists', 'Warehouse code already exists in this company.');
      const warehouse = await db.erpWarehouse.create({ data: {
        organizationId: context.organizationId, legalEntityId, code: input.code, name: input.name, kind: input.kind,
        plantCode: input.plantCode.toUpperCase(), branchCode: input.branchCode.toUpperCase(), address: json(input.address),
        allowNegative: false, active: input.active, createIdempotencyKey: `warehouse:${idempotencyKey}`, requestHash: hashCanonical(input),
      } });
      const response = warehouseDto(warehouse);
      await audit(db, { action: 'mesaerp.warehouse.create', entity: 'ErpWarehouse', entityId: warehouse.id, after: response });
      return response;
    });
  }

  updateWarehouse(legalEntityId: string, warehouseId: string, input: WarehouseUpdate, idempotencyKey: string) {
    return runIdempotent(legalEntityId, `inventory:warehouse:${warehouseId}:update`, idempotencyKey, input, async (db) => {
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpWarehouse" WHERE "id" = ${warehouseId} FOR UPDATE`);
      const existing = await db.erpWarehouse.findFirst({ where: { id: warehouseId, legalEntityId } });
      if (!existing) throw new ApiError(404, 'warehouse_not_found', 'Warehouse not found in this company.');
      if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Warehouse changed since it was loaded.');
      const { expectedRowVersion: _version, plantCode, branchCode, address, ...changes } = input;
      const changed = await db.erpWarehouse.updateMany({ where: { id: warehouseId, legalEntityId, rowVersion: input.expectedRowVersion }, data: {
        ...changes, ...(plantCode !== undefined ? { plantCode: plantCode.toUpperCase() } : {}),
        ...(branchCode !== undefined ? { branchCode: branchCode.toUpperCase() } : {}),
        ...(address !== undefined ? { address: json(address) } : {}), allowNegative: false, rowVersion: { increment: 1 },
      } });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Warehouse changed while the update was saved.');
      const updated = await db.erpWarehouse.findUniqueOrThrow({ where: { id: warehouseId } });
      const response = warehouseDto(updated);
      await audit(db, { action: 'mesaerp.warehouse.update', entity: 'ErpWarehouse', entityId: warehouseId, before: warehouseDto(existing), after: response });
      return response;
    });
  }

  async listStockLedger(legalEntityId: string, filters: { itemId?: string; warehouseId?: string }) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const rows = await db.erpStockMovement.findMany({
        where: { legalEntityId, ...(filters.itemId ? { itemId: filters.itemId } : {}), ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}) },
        include: { item: { select: { itemCode: true, name: true } }, warehouse: { select: { code: true, name: true } } },
        orderBy: [{ businessDate: 'desc' }, { occurredAt: 'desc' }, { id: 'desc' }], take: 1000,
      });
      return rows.map((row) => ({
        id: row.id, legalEntityId: row.legalEntityId, itemId: row.itemId, itemCode: row.item.itemCode, itemName: row.item.name,
        warehouseId: row.warehouseId, warehouseCode: row.warehouse.code, movementType: row.movementType,
        businessDate: day(row.businessDate), quantity: row.quantity.toString(), uom: row.uom,
        unitCost: row.unitCost.toString(), value: row.value.toString(), valuationMethod: row.valuationMethod,
        valuationLayer: structuredClone(row.valuationLayer), batchNumber: row.batchNumber, serialNumber: row.serialNumber,
        ...(row.expiryDate ? { expiryDate: day(row.expiryDate) } : {}), sourceDocumentId: row.sourceDocumentId,
        voucherId: row.voucherId, occurredAt: row.occurredAt.toISOString(),
      }));
    });
  }

  async listStockBalances(legalEntityId: string, filters: { itemId?: string; warehouseId?: string }) {
    const ledger = await this.listStockLedger(legalEntityId, filters);
    const balances = new Map<string, typeof ledger[number] & { balanceQuantity: Prisma.Decimal; balanceValue: Prisma.Decimal }>();
    for (const row of ledger) {
      const key = [row.itemId, row.warehouseId, row.batchNumber, row.serialNumber, row.expiryDate ?? ''].join('|');
      const existing = balances.get(key) ?? { ...row, balanceQuantity: zero(), balanceValue: zero() };
      existing.balanceQuantity = quantity(existing.balanceQuantity.plus(row.quantity));
      existing.balanceValue = money(existing.balanceValue.plus(row.value));
      balances.set(key, existing);
    }
    return [...balances.values()].filter((entry) => !entry.balanceQuantity.isZero()).map((entry) => ({
      legalEntityId, itemId: entry.itemId, itemCode: entry.itemCode, itemName: entry.itemName,
      warehouseId: entry.warehouseId, warehouseCode: entry.warehouseCode, batchNumber: entry.batchNumber,
      serialNumber: entry.serialNumber, ...(entry.expiryDate ? { expiryDate: entry.expiryDate } : {}), uom: entry.uom,
      quantity: entry.balanceQuantity.toString(), value: entry.balanceValue.toString(),
      unitCost: entry.balanceQuantity.greaterThan(0) ? rate(entry.balanceValue.dividedBy(entry.balanceQuantity)).toString() : '0',
    }));
  }

  createAdjustment(legalEntityId: string, input: StockAdjustmentCreate, idempotencyKey: string) {
    return runIdempotent(legalEntityId, `inventory:adjustment:create:${legalEntityId}`, idempotencyKey, input, async (db, context) => {
      const inventoryLines: InventoryPostingLine[] = [];
      const accountingLines: AccountingPostingLine[] = [];
      for (const [index, line] of input.lines.entries()) {
        const [item, warehouse] = await Promise.all([
          db.erpItem.findFirst({ where: { id: line.itemId, legalEntityId, active: true } }),
          db.erpWarehouse.findFirst({ where: { id: line.warehouseId, legalEntityId, active: true } }),
        ]);
        if (!item || !warehouse || !item.inventoryAccount) throw new ApiError(422, 'inventory_mapping_missing', `Adjustment line ${index + 1} is not fully mapped.`);
        const signed = quantity(line.quantity);
        const absolute = signed.abs();
        const trace = { batchNumber: line.batchNumber, serialNumber: line.serialNumber, ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}) };
        const value = signed.greaterThan(0)
          ? money(absolute.times(line.unitCost!))
          : await estimateIssueValue(db, legalEntityId, input.businessDate, { itemId: item.id, warehouseId: warehouse.id, quantity: absolute.toString(), uom: line.uom, ...trace });
        const direction = signed.greaterThan(0) ? 'in' as const : 'out' as const;
        inventoryLines.push({ key: `adjustment-${index + 1}`, direction, movementType: 'stock_adjustment', itemId: item.id, warehouseId: warehouse.id, quantity: absolute.toString(), uom: line.uom, ...(direction === 'in' ? { unitCost: rate(line.unitCost!).toString() } : {}), expectedValue: value.toString(), ...trace, originMetadata: { reason: input.reason } });
        accountingLines.push(
          { account: direction === 'in' ? item.inventoryAccount : line.adjustmentAccount, debit: value.toString(), credit: '0', narration: input.reason, dimensions: { itemId: item.id, warehouseId: warehouse.id } },
          { account: direction === 'in' ? line.adjustmentAccount : item.inventoryAccount, debit: '0', credit: value.toString(), narration: input.reason, dimensions: { itemId: item.id, warehouseId: warehouse.id } },
        );
      }
      const sourceId = randomUUID();
      const inventoryPlan: InventoryPostingPlan = { version: 1, sourceType: 'stock_adjustment', sourceId, businessDate: input.businessDate, lines: inventoryLines };
      return ensureSourcePostingDraft(db, context, legalEntityId, {
        sourceType: 'stock_adjustment', sourceId, voucherType: 'stock_journal', businessDate: input.businessDate,
        currency: (await requireEntity(db, context, legalEntityId)).baseCurrency, reference: input.reference,
        narration: input.reason, sourceSnapshot: input, accountingLines, inventoryPlan,
      });
    });
  }

  createTransfer(legalEntityId: string, input: StockTransferCreate, idempotencyKey: string) {
    return runIdempotent(legalEntityId, `inventory:transfer:create:${legalEntityId}`, idempotencyKey, input, async (db, context) => {
      const [from, to] = await Promise.all([
        db.erpWarehouse.findFirst({ where: { id: input.fromWarehouseId, legalEntityId, active: true } }),
        db.erpWarehouse.findFirst({ where: { id: input.toWarehouseId, legalEntityId, active: true } }),
      ]);
      if (!from || !to) throw new ApiError(422, 'warehouse_not_found', 'Transfer source or destination warehouse is missing or inactive.');
      const inventoryLines: InventoryPostingLine[] = [];
      const accountingLines: AccountingPostingLine[] = [];
      for (const [index, line] of input.lines.entries()) {
        const item = await db.erpItem.findFirst({ where: { id: line.itemId, legalEntityId, active: true } });
        if (!item || !item.inventoryAccount) throw new ApiError(422, 'inventory_mapping_missing', `Transfer line ${index + 1} is not fully mapped.`);
        const trace = { batchNumber: line.batchNumber, serialNumber: line.serialNumber, ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}) };
        const value = await estimateIssueValue(db, legalEntityId, input.businessDate, { itemId: item.id, warehouseId: from.id, quantity: line.quantity, uom: line.uom, ...trace });
        const unitCost = rate(value.dividedBy(line.quantity));
        inventoryLines.push(
          { key: `transfer-out-${index + 1}`, direction: 'out', movementType: 'warehouse_transfer_out', itemId: item.id, warehouseId: from.id, quantity: line.quantity, uom: line.uom, expectedValue: value.toString(), ...trace },
          { key: `transfer-in-${index + 1}`, direction: 'in', movementType: 'warehouse_transfer_in', itemId: item.id, warehouseId: to.id, quantity: line.quantity, uom: line.uom, unitCost: unitCost.toString(), expectedValue: value.toString(), ...trace },
        );
        accountingLines.push(
          { account: item.inventoryAccount, debit: value.toString(), credit: '0', narration: `Transfer to ${to.code}`, dimensions: { itemId: item.id, warehouseId: to.id } },
          { account: item.inventoryAccount, debit: '0', credit: value.toString(), narration: `Transfer from ${from.code}`, dimensions: { itemId: item.id, warehouseId: from.id } },
        );
      }
      const sourceId = randomUUID();
      const inventoryPlan: InventoryPostingPlan = { version: 1, sourceType: 'stock_transfer', sourceId, businessDate: input.businessDate, lines: inventoryLines };
      return ensureSourcePostingDraft(db, context, legalEntityId, {
        sourceType: 'stock_transfer', sourceId, voucherType: 'stock_journal', businessDate: input.businessDate,
        currency: (await requireEntity(db, context, legalEntityId)).baseCurrency, reference: input.reference,
        narration: `Valued transfer ${from.code} to ${to.code}.`, sourceSnapshot: input, accountingLines, inventoryPlan,
      });
    });
  }

  createPhysicalCount(legalEntityId: string, input: PhysicalCountCreate, idempotencyKey: string) {
    return runIdempotent(legalEntityId, `inventory:count:create:${legalEntityId}`, idempotencyKey, input, async (db, context) => {
      const businessDate = dateOnly(input.businessDate);
      const warehouse = await db.erpWarehouse.findFirst({ where: { id: input.warehouseId, legalEntityId, active: true } });
      if (!warehouse) throw new ApiError(422, 'warehouse_not_found', 'Physical-count warehouse is missing or inactive.');
      const { year, number } = input.countNumber
        ? { year: await yearFor(db, legalEntityId, businessDate), number: input.countNumber }
        : await allocateCountNumber(db, context, legalEntityId, businessDate);
      const countLines: Array<Record<string, unknown>> = [];
      const adjustmentInput: StockAdjustmentCreate['lines'] = [];
      for (const line of input.lines) {
        const item = await db.erpItem.findFirst({ where: { id: line.itemId, legalEntityId, active: true } });
        if (!item) throw new ApiError(422, 'inventory_item_not_found', `Physical-count item ${line.itemId} is missing or inactive.`);
        const movements = await db.erpStockMovement.findMany({ where: {
          legalEntityId, itemId: item.id, warehouseId: warehouse.id,
          ...(item.batchTracked ? { batchNumber: line.batchNumber } : {}), ...(item.serialTracked ? { serialNumber: line.serialNumber } : {}),
          businessDate: { lte: businessDate },
        }, select: { quantity: true } });
        const book = quantity(sum(movements.map((movement) => movement.quantity)));
        const counted = quantity(line.countedQuantity);
        const variance = quantity(counted.minus(book));
        countLines.push({ itemId: item.id, uom: item.baseUom, batchNumber: line.batchNumber, serialNumber: line.serialNumber, expiryDate: line.expiryDate ?? '', bookQuantity: book.toString(), countedQuantity: counted.toString(), varianceQuantity: variance.toString() });
        if (!variance.isZero()) {
          if (variance.greaterThan(0) && line.receiptUnitCost === undefined) throw new ApiError(422, 'count_receipt_cost_required', `Positive variance for ${item.itemCode} requires a receipt unit cost.`);
          adjustmentInput.push({ itemId: item.id, warehouseId: warehouse.id, quantity: variance.toString(), uom: item.baseUom, batchNumber: line.batchNumber, serialNumber: line.serialNumber, ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}), ...(variance.greaterThan(0) ? { unitCost: line.receiptUnitCost! } : {}), adjustmentAccount: line.adjustmentAccount });
        }
      }
      const snapshot = { countNumber: number, businessDate: input.businessDate, warehouseId: warehouse.id, reference: input.reference, lines: countLines };
      const sourceSnapshotHash = hashCanonical(snapshot);
      const count = await db.erpInventoryCount.create({ data: {
        organizationId: context.organizationId, legalEntityId, financialYearId: year.id, warehouseId: warehouse.id,
        countNumber: number, businessDate, status: adjustmentInput.length ? 'adjustment_pending' : 'reconciled',
        lines: json(countLines), sourceSnapshotHash, createIdempotencyKey: `count:${idempotencyKey}`,
        requestHash: hashCanonical(input), createdBy: context.membershipId,
      } });
      let posting = null;
      if (adjustmentInput.length) {
        const inventoryLines: InventoryPostingLine[] = [];
        const accountingLines: AccountingPostingLine[] = [];
        for (const [index, line] of adjustmentInput.entries()) {
          const item = await db.erpItem.findUniqueOrThrow({ where: { id: line.itemId } });
          const signed = quantity(line.quantity); const absolute = signed.abs();
          const trace = { batchNumber: line.batchNumber, serialNumber: line.serialNumber, ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}) };
          const value = signed.greaterThan(0) ? money(absolute.times(line.unitCost!)) : await estimateIssueValue(db, legalEntityId, input.businessDate, { itemId: item.id, warehouseId: warehouse.id, quantity: absolute.toString(), uom: line.uom, ...trace });
          const direction = signed.greaterThan(0) ? 'in' as const : 'out' as const;
          inventoryLines.push({ key: `count-${index + 1}`, direction, movementType: 'physical_count_adjustment', itemId: item.id, warehouseId: warehouse.id, quantity: absolute.toString(), uom: line.uom, ...(direction === 'in' ? { unitCost: rate(line.unitCost!).toString() } : {}), expectedValue: value.toString(), ...trace, originMetadata: { countId: count.id } });
          accountingLines.push(
            { account: direction === 'in' ? item.inventoryAccount : line.adjustmentAccount, debit: value.toString(), credit: '0', narration: `Count ${number}`, dimensions: { itemId: item.id, warehouseId: warehouse.id } },
            { account: direction === 'in' ? line.adjustmentAccount : item.inventoryAccount, debit: '0', credit: value.toString(), narration: `Count ${number}`, dimensions: { itemId: item.id, warehouseId: warehouse.id } },
          );
        }
        const inventoryPlan: InventoryPostingPlan = { version: 1, sourceType: 'physical_count', sourceId: count.id, businessDate: input.businessDate, lines: inventoryLines };
        posting = await ensureSourcePostingDraft(db, context, legalEntityId, {
          sourceType: 'physical_count', sourceId: count.id, voucherType: 'stock_journal', businessDate: input.businessDate,
          currency: (await requireEntity(db, context, legalEntityId)).baseCurrency, reference: input.reference,
          narration: `Physical-count adjustment ${number}.`, sourceSnapshot: snapshot, accountingLines, inventoryPlan,
        });
        await db.$executeRaw(Prisma.sql`UPDATE "ErpInventoryCount" SET "voucherId" = ${posting.voucherId} WHERE "id" = ${count.id}`);
      }
      const response = { id: count.id, legalEntityId, warehouseId: count.warehouseId, countNumber: count.countNumber, businessDate: day(count.businessDate), status: count.status, lines: countLines, sourceSnapshotHash, rowVersion: count.rowVersion, createdAt: count.createdAt.toISOString(), posting };
      await audit(db, { action: 'mesaerp.inventory_count.create', entity: 'ErpInventoryCount', entityId: count.id, after: response });
      return response;
    });
  }

  async getPhysicalCount(legalEntityId: string, countId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const count = await db.erpInventoryCount.findFirst({ where: { id: countId, organizationId: context.organizationId, legalEntityId } });
      if (!count) throw new ApiError(404, 'inventory_count_not_found', 'Physical count not found in this company.');
      const link = await db.erpPostingLink.findFirst({ where: { legalEntityId, sourceType: 'physical_count', sourceId: count.id }, include: { voucher: { include: { lines: true } } } });
      return { id: count.id, legalEntityId, warehouseId: count.warehouseId, countNumber: count.countNumber, businessDate: day(count.businessDate), status: count.status, lines: structuredClone(count.lines), sourceSnapshotHash: count.sourceSnapshotHash, voucherId: count.voucherId, rowVersion: count.rowVersion, createdAt: count.createdAt.toISOString(), ...(link ? { posting: postingLinkDto(link) } : {}) };
    });
  }

  async getPostingLink(legalEntityId: string, sourceType: string, sourceId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const link = await db.erpPostingLink.findFirst({ where: { organizationId: context.organizationId, legalEntityId, sourceType, sourceId }, include: { voucher: { include: { lines: { orderBy: { lineNumber: 'asc' } } } } } });
      if (!link) throw new ApiError(404, 'source_posting_not_found', 'Source posting not found in this company.');
      return postingLinkDto(link);
    });
  }
}
