import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { basePrisma, tenantTx } from '../db';
import { audit } from '../lib/audit';
import { tenantContext, type TenantCtx } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import { hasMesaErpPermission } from './access';
import { hashCanonical } from './repository';
import type {
  AtpQuery,
  DemandForecastCreate,
  MrpRunCreate,
  PlanningBomCreate,
  PlanningBomRevisionCreate,
  PlanningBomRevisionUpdate,
  PlanningPolicyUpdate,
  PlanningRowVersion,
  StockReservationCreate,
} from './planningSchemas';

type Db = typeof basePrisma;
type JsonRecord = Record<string, unknown>;

const zero = () => new Prisma.Decimal(0);
const qty = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
const positive = (value: Prisma.Decimal) => value.greaterThan(0);
const day = (value: Date) => value.toISOString().slice(0, 10);
const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const sorted = <T>(rows: T[], key: (row: T) => string) => rows.slice().sort((a, b) => key(a).localeCompare(key(b)));

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

async function yearFor(db: Db, legalEntityId: string, businessDate: Date) {
  const year = await db.financialYear.findFirst({
    where: { legalEntityId, startsOn: { lte: businessDate }, endsOn: { gte: businessDate }, status: { not: 'locked' } },
  });
  if (!year) throw new ApiError(409, 'financial_year_missing', 'No unlocked financial year covers the planning date.');
  return year;
}

async function replay<T>(db: Db, organizationId: string, scope: string, key: string, requestHash: string): Promise<T | null> {
  const existing = await db.erpIdempotencyRecord.findUnique({ where: { organizationId_scope_key: { organizationId, scope, key } } });
  if (!existing) return null;
  if (existing.requestHash !== requestHash) throw new ApiError(409, 'idempotency_conflict', 'This Idempotency-Key was already used with a different planning request.');
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
  const requestHash = hashCanonical({ legalEntityId: input.legalEntityId, payload: input.payload });
  const once = () => tenantTx(async (db) => {
    const existing = await replay<T>(db, context.organizationId, input.scope, input.key, requestHash);
    if (existing) return existing;
    await requireEntity(db, context, input.legalEntityId);
    await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.organizationId}:${input.scope}:${input.key}`}))`);
    const afterLock = await replay<T>(db, context.organizationId, input.scope, input.key, requestHash);
    if (afterLock) return afterLock;
    const response = await input.execute(db, context);
    await db.erpIdempotencyRecord.create({
      data: {
        organizationId: context.organizationId,
        legalEntityId: input.legalEntityId,
        scope: input.scope,
        key: input.key,
        requestHash,
        response: json(response),
      },
    });
    return response;
  });
  try {
    return await once();
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
      payloadHash: hashCanonical(payload),
    },
  });
}

async function allocateNumber(
  db: Db,
  context: TenantCtx,
  legalEntity: { id: string; code: string },
  financialYear: { id: string; code: string },
  documentType: string,
  shortCode: string,
) {
  const prefix = `${legalEntity.code}-${shortCode}-${financialYear.code}-`;
  const rows = await db.$queryRaw<Array<{ nextValue: number }>>(Prisma.sql`
    INSERT INTO "ErpNumberSeries" (
      "id", "organizationId", "legalEntityId", "financialYearId", "documentType", "prefix", "padding", "nextValue", "createdAt", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${context.organizationId}, ${legalEntity.id}, ${financialYear.id}, ${documentType}, ${prefix}, 6, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organizationId", "legalEntityId", "financialYearId", "documentType")
    DO UPDATE SET "nextValue" = "ErpNumberSeries"."nextValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "nextValue"
  `);
  return `${prefix}${String((rows[0]?.nextValue ?? 2) - 1).padStart(6, '0')}`;
}

function planningPolicyDto(item: {
  id: string; legalEntityId: string; itemCode: string; name: string; baseUom: string; rowVersion: number;
  planningLeadTimeDays: number; planningSafetyStock: Prisma.Decimal; planningMinimumStock: Prisma.Decimal;
  planningMaximumStock: Prisma.Decimal | null; planningLotSizing: string; planningFixedLotSize: Prisma.Decimal;
  planningMinimumOrder: Prisma.Decimal; planningOrderMultiple: Prisma.Decimal; planningSupplyPolicy: string;
  planningWarehouseId: string | null; transferSourceWarehouseId: string | null; planningPreferredVendorId: string;
  planningPolicyUpdatedAt: Date | null;
}) {
  return {
    itemId: item.id,
    legalEntityId: item.legalEntityId,
    itemCode: item.itemCode,
    itemName: item.name,
    baseUom: item.baseUom,
    leadTimeDays: item.planningLeadTimeDays,
    safetyStock: item.planningSafetyStock.toString(),
    minimumStock: item.planningMinimumStock.toString(),
    maximumStock: item.planningMaximumStock?.toString(),
    lotSizing: item.planningLotSizing,
    fixedLotSize: item.planningFixedLotSize.toString(),
    minimumOrderQuantity: item.planningMinimumOrder.toString(),
    orderMultiple: item.planningOrderMultiple.toString(),
    supplyPolicy: item.planningSupplyPolicy,
    planningWarehouseId: item.planningWarehouseId,
    transferSourceWarehouseId: item.transferSourceWarehouseId,
    preferredVendorId: item.planningPreferredVendorId || undefined,
    rowVersion: item.rowVersion,
    updatedAt: item.planningPolicyUpdatedAt?.toISOString(),
  };
}

const bomInclude = {
  parentItem: true,
  revisions: {
    include: { components: { include: { componentItem: true, issueWarehouse: true }, orderBy: { lineNumber: 'asc' as const } } },
    orderBy: { revisionNumber: 'desc' as const },
  },
} as const;

function componentDto(component: {
  id: string; lineNumber: number; componentItemId: string; issueWarehouseId: string | null; quantity: Prisma.Decimal;
  uom: string; scrapPercentage: Prisma.Decimal; componentType: string; phase: string; dimensions: Prisma.JsonValue;
  componentItem: { itemCode: string; name: string }; issueWarehouse: { code: string } | null;
}) {
  return {
    id: component.id,
    lineNumber: component.lineNumber,
    componentItemId: component.componentItemId,
    componentItemCode: component.componentItem.itemCode,
    componentItemName: component.componentItem.name,
    issueWarehouseId: component.issueWarehouseId,
    issueWarehouseCode: component.issueWarehouse?.code,
    quantity: component.quantity.toString(),
    uom: component.uom,
    scrapPercentage: component.scrapPercentage.toString(),
    componentType: component.componentType,
    phase: component.phase,
    dimensions: structuredClone(component.dimensions),
  };
}

function revisionSnapshot(revision: {
  id: string; revisionNumber: number; revisionCode: string; status: string; effectiveFrom: Date; effectiveTo: Date | null;
  outputQuantity: Prisma.Decimal; outputUom: string; yieldPercentage: Prisma.Decimal; notes: string;
  formulaParameters: Prisma.JsonValue; components: Parameters<typeof componentDto>[0][];
}) {
  return {
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    revisionCode: revision.revisionCode,
    effectiveFrom: day(revision.effectiveFrom),
    effectiveTo: revision.effectiveTo ? day(revision.effectiveTo) : undefined,
    outputQuantity: revision.outputQuantity.toString(),
    outputUom: revision.outputUom,
    yieldPercentage: revision.yieldPercentage.toString(),
    notes: revision.notes,
    formulaParameters: structuredClone(revision.formulaParameters),
    components: revision.components.map(componentDto),
  };
}

function bomDto(bom: {
  id: string; legalEntityId: string; bomCode: string; parentItemId: string; bomType: string; description: string; active: boolean;
  rowVersion: number; createdBy: string; createdAt: Date; updatedAt: Date; parentItem: { itemCode: string; name: string; baseUom: string };
  revisions: Array<Parameters<typeof revisionSnapshot>[0] & {
    sourceSnapshotHash: string; rowVersion: number; createdBy: string; approvedBy: string; submittedAt: Date | null;
    approvedAt: Date | null; createdAt: Date; updatedAt: Date;
  }>;
}) {
  return {
    id: bom.id,
    legalEntityId: bom.legalEntityId,
    bomCode: bom.bomCode,
    parentItemId: bom.parentItemId,
    parentItemCode: bom.parentItem.itemCode,
    parentItemName: bom.parentItem.name,
    parentUom: bom.parentItem.baseUom,
    bomType: bom.bomType,
    description: bom.description,
    active: bom.active,
    rowVersion: bom.rowVersion,
    revisions: bom.revisions.map((revision) => ({
      ...revisionSnapshot(revision),
      status: revision.status,
      sourceSnapshotHash: revision.sourceSnapshotHash,
      rowVersion: revision.rowVersion,
      createdBy: revision.createdBy,
      submittedAt: revision.submittedAt?.toISOString(),
      approvedBy: revision.approvedBy,
      approvedAt: revision.approvedAt?.toISOString(),
      createdAt: revision.createdAt.toISOString(),
      updatedAt: revision.updatedAt.toISOString(),
    })),
    createdBy: bom.createdBy,
    createdAt: bom.createdAt.toISOString(),
    updatedAt: bom.updatedAt.toISOString(),
  };
}

function forecastDto(row: {
  id: string; legalEntityId: string; financialYearId: string; forecastNumber: string; itemId: string; warehouseId: string;
  forecastDate: Date; quantity: Prisma.Decimal; uom: string; status: string; notes: string; sourceSnapshotHash: string;
  rowVersion: number; createdBy: string; submittedAt: Date | null; approvedBy: string; approvedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: row.id, legalEntityId: row.legalEntityId, financialYearId: row.financialYearId,
    forecastNumber: row.forecastNumber, itemId: row.itemId, warehouseId: row.warehouseId,
    forecastDate: day(row.forecastDate), quantity: row.quantity.toString(), uom: row.uom,
    status: row.status, notes: row.notes, sourceSnapshotHash: row.sourceSnapshotHash,
    rowVersion: row.rowVersion, createdBy: row.createdBy, submittedAt: row.submittedAt?.toISOString(),
    approvedBy: row.approvedBy, approvedAt: row.approvedAt?.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function reservationDto(row: {
  id: string; legalEntityId: string; reservationNumber: string; itemId: string; warehouseId: string; quantity: Prisma.Decimal;
  uom: string; batchNumber: string; serialNumber: string; sourceType: string; sourceId: string; sourceLineId: string;
  requiredOn: Date | null; status: string; sourceSnapshotHash: string; rowVersion: number; createdBy: string;
  releasedBy: string; releasedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: row.id, legalEntityId: row.legalEntityId, reservationNumber: row.reservationNumber,
    itemId: row.itemId, warehouseId: row.warehouseId, quantity: row.quantity.toString(), uom: row.uom,
    batchNumber: row.batchNumber, serialNumber: row.serialNumber, sourceType: row.sourceType,
    sourceId: row.sourceId || undefined, sourceLineId: row.sourceLineId || undefined,
    requiredOn: row.requiredOn ? day(row.requiredOn) : undefined, status: row.status,
    sourceSnapshotHash: row.sourceSnapshotHash, rowVersion: row.rowVersion, createdBy: row.createdBy,
    releasedBy: row.releasedBy, releasedAt: row.releasedAt?.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

async function validateRevisionInput(
  db: Db,
  legalEntityId: string,
  parentItemId: string,
  input: PlanningBomRevisionCreate,
) {
  const itemIds = [...new Set([parentItemId, ...input.components.map((line) => line.componentItemId)])];
  const warehouseIds = [...new Set(input.components.flatMap((line) => line.issueWarehouseId ? [line.issueWarehouseId] : []))];
  const [items, warehouses] = await Promise.all([
    db.erpItem.findMany({ where: { legalEntityId, active: true, id: { in: itemIds } } }),
    db.erpWarehouse.findMany({ where: { legalEntityId, active: true, id: { in: warehouseIds } } }),
  ]);
  if (items.length !== itemIds.length) throw new ApiError(422, 'bom_item_not_found', 'One or more BOM items are missing or inactive in this company.');
  if (warehouses.length !== warehouseIds.length) throw new ApiError(422, 'bom_warehouse_not_found', 'One or more issue warehouses are missing or inactive in this company.');
  if (input.components.some((line) => line.componentItemId === parentItemId)) {
    throw new ApiError(422, 'bom_self_reference', 'A BOM cannot directly consume its own parent item.');
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  const parent = byId.get(parentItemId)!;
  if (parent.itemType !== 'inventory') throw new ApiError(422, 'bom_parent_not_inventory', 'A planning BOM parent must be an inventory item.');
  if (parent.baseUom.toUpperCase() !== input.outputUom.toUpperCase()) {
    throw new ApiError(422, 'bom_output_uom_mismatch', `BOM output must use ${parent.baseUom}; planning UOM conversion is not implicit.`);
  }
  for (const [index, line] of input.components.entries()) {
    const component = byId.get(line.componentItemId)!;
    if (component.itemType !== 'inventory') throw new ApiError(422, 'bom_component_not_inventory', `BOM component ${index + 1} is not an inventory item.`);
    if (component.baseUom.toUpperCase() !== line.uom.toUpperCase()) {
      throw new ApiError(422, 'bom_component_uom_mismatch', `BOM component ${component.itemCode} must use ${component.baseUom}.`);
    }
  }
}

async function assertNoBomCycle(db: Db, legalEntityId: string, parentItemId: string, candidateComponents: string[], candidateRevisionId: string) {
  const revisions = await db.erpPlanningBomRevision.findMany({
    where: { legalEntityId, status: 'approved', id: { not: candidateRevisionId } },
    include: { bom: true, components: true },
  });
  const graph = new Map<string, Set<string>>();
  for (const revision of revisions) {
    const children = graph.get(revision.bom.parentItemId) ?? new Set<string>();
    revision.components.forEach((line) => children.add(line.componentItemId));
    graph.set(revision.bom.parentItemId, children);
  }
  graph.set(parentItemId, new Set(candidateComponents));
  const visit = (itemId: string, path: Set<string>): boolean => {
    if (path.has(itemId)) return true;
    const nextPath = new Set(path).add(itemId);
    return [...(graph.get(itemId) ?? [])].some((child) => visit(child, nextPath));
  };
  if (visit(parentItemId, new Set())) throw new ApiError(409, 'bom_cycle_detected', 'Approving this revision would create a cyclic multi-level BOM.');
}

type SnapshotDemand = {
  sourceType: 'sales_order' | 'forecast' | 'production_demand';
  sourceId: string;
  sourceLineId: string;
  sourceNumber: string;
  itemId: string;
  warehouseId: string;
  requiredOn: string;
  quantity: string;
};

type SnapshotReservation = {
  id: string;
  itemId: string;
  warehouseId: string;
  quantity: string;
  sourceType: string;
  sourceId: string;
  sourceLineId: string;
  batchNumber: string;
  serialNumber: string;
  requiredOn?: string;
};

type SnapshotSupply = {
  sourceType: 'on_hand' | 'purchase_order' | 'production_order';
  sourceId: string;
  sourceLineId: string;
  itemId: string;
  warehouseId: string;
  availableOn: string;
  quantity: string;
};

type SnapshotPolicy = {
  itemId: string;
  itemCode: string;
  baseUom: string;
  leadTimeDays: number;
  safetyStock: string;
  minimumStock: string;
  maximumStock?: string;
  lotSizing: string;
  fixedLotSize: string;
  minimumOrderQuantity: string;
  orderMultiple: string;
  supplyPolicy: string;
  planningWarehouseId: string;
  transferSourceWarehouseId?: string;
  preferredVendorId?: string;
  preferredVendorStatus?: string;
  rowVersion: number;
};

type SnapshotBom = {
  bomId: string;
  parentItemId: string;
  bomType: string;
  revisionId: string;
  revisionNumber: number;
  effectiveFrom: string;
  effectiveTo?: string;
  outputQuantity: string;
  yieldPercentage: string;
  sourceSnapshotHash: string;
  components: Array<{
    componentItemId: string;
    issueWarehouseId?: string;
    quantity: string;
    uom: string;
    scrapPercentage: string;
    componentType: string;
    phase: string;
  }>;
};

type PlanningInputs = {
  parameters: MrpRunCreate;
  demands: SnapshotDemand[];
  reservations: SnapshotReservation[];
  supplies: SnapshotSupply[];
  policies: SnapshotPolicy[];
  boms: SnapshotBom[];
  sourceSnapshotHash: string;
};

type CalculatedRequirement = {
  key: string;
  itemId: string;
  warehouseId: string;
  bomRevisionId?: string;
  level: number;
  requiredOn: string;
  grossRequirement: string;
  includedReservation: string;
  onHandQuantity: string;
  externalReservation: string;
  openPurchaseSupply: string;
  openProductionSupply: string;
  safetyStock: string;
  netRequirement: string;
  sourceRefs: JsonRecord[];
  calculationSnapshot: JsonRecord;
  snapshotHash: string;
  suggestion?: {
    suggestionType: 'make' | 'purchase' | 'transfer';
    sourceWarehouseId?: string;
    quantity: string;
    uom: string;
    orderOn: string;
    planningSnapshot: JsonRecord;
    sourceSnapshotHash: string;
  };
};

function clampPlanningDate(value: Date | null | undefined, asOfDate: string, _horizonEnd: string) {
  const source = value ? day(value) : asOfDate;
  if (source < asOfDate) return asOfDate;
  return source;
}

function subtractDays(value: string, count: number) {
  const result = dateOnly(value);
  result.setUTCDate(result.getUTCDate() - count);
  return day(result);
}

async function collectPlanningInputs(db: Db, legalEntityId: string, input: MrpRunCreate): Promise<PlanningInputs> {
  const asOf = dateOnly(input.asOfDate);
  const horizon = dateOnly(input.horizonEnd);
  const warehouses = await db.erpWarehouse.findMany({
    where: { legalEntityId, active: true, ...(input.warehouseIds ? { id: { in: input.warehouseIds } } : {}) },
    orderBy: [{ code: 'asc' }, { id: 'asc' }],
  });
  if (input.warehouseIds && warehouses.length !== new Set(input.warehouseIds).size) {
    throw new ApiError(422, 'mrp_warehouse_not_found', 'One or more MRP warehouses are missing or inactive in this company.');
  }
  const warehouseIds = warehouses.map((row) => row.id);
  const warehouseByCode = new Map(warehouses.map((row) => [row.code.toUpperCase(), row.id]));
  const items = await db.erpItem.findMany({ where: { legalEntityId, active: true, itemType: 'inventory' }, orderBy: [{ itemCode: 'asc' }, { id: 'asc' }] });
  const itemById = new Map(items.map((row) => [row.id, row]));
  const preferredVendorIds = [...new Set(items.flatMap((row) => row.planningPreferredVendorId ? [row.planningPreferredVendorId] : []))];
  const planningVendors = preferredVendorIds.length ? await db.erpVendor.findMany({
    where: { legalEntityId, id: { in: preferredVendorIds } }, select: { id: true, lifecycleStatus: true },
  }) : [];
  const vendorStatusById = new Map(planningVendors.map((row) => [row.id, row.lifecycleStatus]));
  const policies: SnapshotPolicy[] = items.map((item) => ({
    itemId: item.id, itemCode: item.itemCode, baseUom: item.baseUom, leadTimeDays: item.planningLeadTimeDays,
    safetyStock: item.planningSafetyStock.toString(), minimumStock: item.planningMinimumStock.toString(),
    ...(item.planningMaximumStock ? { maximumStock: item.planningMaximumStock.toString() } : {}),
    lotSizing: item.planningLotSizing, fixedLotSize: item.planningFixedLotSize.toString(),
    minimumOrderQuantity: item.planningMinimumOrder.toString(), orderMultiple: item.planningOrderMultiple.toString(),
    supplyPolicy: item.planningSupplyPolicy, planningWarehouseId: item.planningWarehouseId ?? '',
    ...(item.transferSourceWarehouseId ? { transferSourceWarehouseId: item.transferSourceWarehouseId } : {}),
    ...(item.planningPreferredVendorId ? { preferredVendorId: item.planningPreferredVendorId } : {}), rowVersion: item.rowVersion,
    ...(item.planningPreferredVendorId ? { preferredVendorStatus: vendorStatusById.get(item.planningPreferredVendorId) ?? 'missing' } : {}),
  }));

  const revisions = await db.erpPlanningBomRevision.findMany({
    where: { legalEntityId, status: 'approved', effectiveFrom: { lte: horizon }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }], bom: { active: true } },
    include: { bom: true, components: { orderBy: { lineNumber: 'asc' } } },
    orderBy: [{ effectiveFrom: 'asc' }, { revisionNumber: 'asc' }, { id: 'asc' }],
  });
  const boms: SnapshotBom[] = revisions.map((revision) => ({
    bomId: revision.bomId, parentItemId: revision.bom.parentItemId, bomType: revision.bom.bomType,
    revisionId: revision.id, revisionNumber: revision.revisionNumber, effectiveFrom: day(revision.effectiveFrom),
    ...(revision.effectiveTo ? { effectiveTo: day(revision.effectiveTo) } : {}), outputQuantity: revision.outputQuantity.toString(),
    yieldPercentage: revision.yieldPercentage.toString(), sourceSnapshotHash: revision.sourceSnapshotHash,
    components: revision.components.map((line) => ({
      componentItemId: line.componentItemId, ...(line.issueWarehouseId ? { issueWarehouseId: line.issueWarehouseId } : {}),
      quantity: line.quantity.toString(), uom: line.uom, scrapPercentage: line.scrapPercentage.toString(),
      componentType: line.componentType, phase: line.phase,
    })),
  }));

  const demands: SnapshotDemand[] = [];
  if (input.includeSalesOrders) {
    const orders = await db.erpDocument.findMany({
      where: { legalEntityId, documentType: 'sales_order', status: 'approved', documentDate: { lte: horizon } },
      include: { lines: { orderBy: { lineNumber: 'asc' } } }, orderBy: [{ documentNumber: 'asc' }, { id: 'asc' }],
    });
    for (const order of orders) for (const line of order.lines) {
      if (!line.itemId || !itemById.has(line.itemId)) continue;
      const requiredOn = clampPlanningDate(line.promisedOn ?? order.dueDate ?? order.documentDate, input.asOfDate, input.horizonEnd);
      const policyWarehouseId = itemById.get(line.itemId)?.planningWarehouseId ?? '';
      const warehouseId = warehouseByCode.get(line.warehouseCode.toUpperCase()) ?? policyWarehouseId;
      if (!warehouseId || !warehouseIds.includes(warehouseId) || requiredOn > input.horizonEnd) continue;
      demands.push({ sourceType: 'sales_order', sourceId: order.id, sourceLineId: line.id, sourceNumber: order.documentNumber, itemId: line.itemId, warehouseId, requiredOn, quantity: line.quantity.toString() });
    }
  }
  if (input.includeForecasts) {
    const forecasts = await db.erpDemandForecast.findMany({
      where: { legalEntityId, status: 'approved', warehouseId: { in: warehouseIds }, forecastDate: { gte: asOf, lte: horizon } },
      orderBy: [{ forecastDate: 'asc' }, { forecastNumber: 'asc' }, { id: 'asc' }],
    });
    forecasts.forEach((row) => demands.push({ sourceType: 'forecast', sourceId: row.id, sourceLineId: '', sourceNumber: row.forecastNumber, itemId: row.itemId, warehouseId: row.warehouseId, requiredOn: day(row.forecastDate), quantity: row.quantity.toString() }));
  }
  if (input.includeProductionDemands) {
    const productionDemands = await db.erpProductionDemand.findMany({
      where: { legalEntityId, status: 'approved', OR: [{ requiredOn: null }, { requiredOn: { lte: horizon } }] }, orderBy: [{ requiredOn: 'asc' }, { demandNumber: 'asc' }, { id: 'asc' }],
    });
    productionDemands.forEach((row) => {
      const metadata = row.originMetadata && typeof row.originMetadata === 'object' && !Array.isArray(row.originMetadata)
        ? row.originMetadata as JsonRecord : {};
      const sourceOrder = metadata.sourceOrderSnapshot && typeof metadata.sourceOrderSnapshot === 'object' && !Array.isArray(metadata.sourceOrderSnapshot)
        ? metadata.sourceOrderSnapshot as JsonRecord : {};
      const sourceSalesOrderId = typeof sourceOrder.salesOrderId === 'string' ? sourceOrder.salesOrderId : '';
      const sourceSalesOrderLineId = typeof sourceOrder.sourceLineId === 'string' ? sourceOrder.sourceLineId : '';
      if (input.includeSalesOrders && demands.some((demand) => demand.sourceType === 'sales_order'
        && demand.sourceId === sourceSalesOrderId && demand.sourceLineId === sourceSalesOrderLineId)) return;
      const warehouseId = itemById.get(row.itemId)?.planningWarehouseId ?? '';
      if (warehouseId && warehouseIds.includes(warehouseId)) demands.push({ sourceType: 'production_demand', sourceId: row.id, sourceLineId: '', sourceNumber: row.demandNumber, itemId: row.itemId, warehouseId, requiredOn: clampPlanningDate(row.requiredOn, input.asOfDate, input.horizonEnd), quantity: row.quantity.toString() });
    });
  }

  const reservationsRaw = await db.erpStockReservation.findMany({
    where: { legalEntityId, status: 'active', warehouseId: { in: warehouseIds } }, orderBy: [{ itemId: 'asc' }, { warehouseId: 'asc' }, { id: 'asc' }],
  });
  const reservations: SnapshotReservation[] = reservationsRaw.map((row) => ({
    id: row.id, itemId: row.itemId, warehouseId: row.warehouseId, quantity: row.quantity.toString(), sourceType: row.sourceType,
    sourceId: row.sourceId, sourceLineId: row.sourceLineId, batchNumber: row.batchNumber, serialNumber: row.serialNumber,
    ...(row.requiredOn ? { requiredOn: day(row.requiredOn) } : {}),
  }));

  const supplies: SnapshotSupply[] = [];
  const movements = await db.erpStockMovement.groupBy({ by: ['itemId', 'warehouseId'], where: { legalEntityId, warehouseId: { in: warehouseIds }, businessDate: { lte: asOf } }, _sum: { quantity: true } });
  movements.forEach((row) => supplies.push({ sourceType: 'on_hand', sourceId: `${row.itemId}:${row.warehouseId}`, sourceLineId: '', itemId: row.itemId, warehouseId: row.warehouseId, availableOn: input.asOfDate, quantity: (row._sum.quantity ?? zero()).toString() }));

  const purchaseOrders = await db.erpDocument.findMany({
    where: { legalEntityId, documentType: 'purchase_order', status: 'approved', documentDate: { lte: horizon } },
    include: { lines: { orderBy: { lineNumber: 'asc' } } }, orderBy: [{ documentNumber: 'asc' }, { id: 'asc' }],
  });
  const poLineIds = purchaseOrders.flatMap((order) => order.lines.map((line) => line.id));
  const receipts = poLineIds.length ? await db.erpDocumentLine.groupBy({
    by: ['sourceLineId'], where: { sourceLineId: { in: poLineIds }, document: { legalEntityId, documentType: 'goods_receipt', status: { in: ['approved', 'posted'] } } }, _sum: { quantity: true },
  }) : [];
  const receivedByLine = new Map(receipts.map((row) => [row.sourceLineId ?? '', row._sum.quantity ?? zero()]));
  for (const order of purchaseOrders) for (const line of order.lines) {
    if (!line.itemId || !itemById.has(line.itemId)) continue;
    const open = qty(line.quantity.minus(receivedByLine.get(line.id) ?? zero()));
    if (!positive(open)) continue;
    const warehouseId = warehouseByCode.get(line.warehouseCode.toUpperCase()) ?? itemById.get(line.itemId)?.planningWarehouseId ?? '';
    if (!warehouseId || !warehouseIds.includes(warehouseId)) continue;
    const availableOn = clampPlanningDate(line.promisedOn ?? order.dueDate ?? order.documentDate, input.asOfDate, input.horizonEnd);
    if (availableOn > input.horizonEnd) continue;
    supplies.push({ sourceType: 'purchase_order', sourceId: order.id, sourceLineId: line.id, itemId: line.itemId, warehouseId, availableOn, quantity: open.toString() });
  }

  const openProduction = await db.erpProductionDemand.findMany({
    where: { legalEntityId, status: { in: ['released', 'partially_completed'] }, OR: [{ requiredOn: null }, { requiredOn: { lte: horizon } }] },
    include: { batchCosts: { where: { status: 'approved' }, select: { outputQuantity: true } } },
    orderBy: [{ requiredOn: 'asc' }, { demandNumber: 'asc' }, { id: 'asc' }],
  });
  for (const demand of openProduction) {
    const completed = demand.batchCosts.reduce((sum, row) => sum.plus(row.outputQuantity), zero());
    const open = qty(demand.quantity.minus(completed));
    const warehouseId = itemById.get(demand.itemId)?.planningWarehouseId ?? '';
    if (positive(open) && warehouseId && warehouseIds.includes(warehouseId)) supplies.push({ sourceType: 'production_order', sourceId: demand.id, sourceLineId: '', itemId: demand.itemId, warehouseId, availableOn: clampPlanningDate(demand.requiredOn, input.asOfDate, input.horizonEnd), quantity: open.toString() });
  }

  const normalized = {
    parameters: input,
    demands: sorted(demands, (row) => `${row.requiredOn}:${row.itemId}:${row.warehouseId}:${row.sourceType}:${row.sourceId}:${row.sourceLineId}`),
    reservations,
    supplies: sorted(supplies, (row) => `${row.availableOn}:${row.itemId}:${row.warehouseId}:${row.sourceType}:${row.sourceId}:${row.sourceLineId}`),
    policies,
    boms,
  };
  return { ...normalized, sourceSnapshotHash: hashCanonical(normalized) };
}

function selectBom(inputs: PlanningInputs, itemId: string, requiredOn: string) {
  return inputs.boms.filter((row) => row.parentItemId === itemId && row.effectiveFrom <= requiredOn && (!row.effectiveTo || row.effectiveTo >= requiredOn))
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom) || right.revisionNumber - left.revisionNumber)[0];
}

function applyLotSizing(netRequirement: Prisma.Decimal, availableAfterNet: Prisma.Decimal, policy: SnapshotPolicy) {
  let planned = netRequirement;
  if (policy.lotSizing === 'fixed') {
    const fixed = qty(policy.fixedLotSize);
    planned = fixed.times(netRequirement.dividedBy(fixed).ceil());
  } else if (policy.lotSizing === 'min_max' && policy.maximumStock) {
    planned = Prisma.Decimal.max(netRequirement, qty(policy.maximumStock).minus(availableAfterNet));
  }
  planned = Prisma.Decimal.max(planned, qty(policy.minimumOrderQuantity));
  const multiple = qty(policy.orderMultiple);
  if (positive(multiple)) planned = multiple.times(planned.dividedBy(multiple).ceil());
  return qty(planned);
}

function calculateMrp(inputs: PlanningInputs): CalculatedRequirement[] {
  type GeneratedDemand = {
    itemId: string; warehouseId: string; requiredOn: string; level: number; quantity: string; ref: JsonRecord;
  };
  type Bucket = {
    itemId: string; warehouseId: string; requiredOn: string; level: number; gross: Prisma.Decimal; refs: JsonRecord[];
  };
  const policyByItem = new Map(inputs.policies.map((row) => [row.itemId, row]));
  let generated: GeneratedDemand[] = [];

  for (let iteration = 0; iteration <= 25; iteration += 1) {
    const buckets = new Map<string, Bucket>();
    const add = (itemId: string, warehouseId: string, requiredOn: string, level: number, amount: Prisma.Decimal, ref: JsonRecord) => {
      const bucketKey = `${requiredOn}:${itemId}:${warehouseId}`;
      const existing = buckets.get(bucketKey);
      if (existing) {
        existing.gross = qty(existing.gross.plus(amount));
        existing.level = Math.max(existing.level, level);
        existing.refs.push(ref);
      } else buckets.set(bucketKey, { itemId, warehouseId, requiredOn, level, gross: qty(amount), refs: [ref] });
    };
    inputs.demands.forEach((demand) => add(demand.itemId, demand.warehouseId, demand.requiredOn, 0, qty(demand.quantity), {
      sourceType: demand.sourceType, sourceId: demand.sourceId, sourceLineId: demand.sourceLineId, sourceNumber: demand.sourceNumber,
    }));
    generated.forEach((demand) => add(demand.itemId, demand.warehouseId, demand.requiredOn, demand.level, qty(demand.quantity), demand.ref));
    const includedDemandSourceKeys = new Set(inputs.demands.map((demand) =>
      `${demand.sourceType}:${demand.sourceId}:${demand.sourceLineId}`));
    inputs.reservations.filter((reservation) => !includedDemandSourceKeys.has(
      `${reservation.sourceType}:${reservation.sourceId}:${reservation.sourceLineId}`,
    )).forEach((reservation) => {
      const requiredOn = !reservation.requiredOn || reservation.requiredOn < inputs.parameters.asOfDate
        ? inputs.parameters.asOfDate : reservation.requiredOn;
      if (requiredOn <= inputs.parameters.horizonEnd) add(
        reservation.itemId,
        reservation.warehouseId,
        requiredOn,
        0,
        zero(),
        { sourceType: 'external_reservation', reservationId: reservation.id },
      );
    });

    const groups = new Map<string, Bucket[]>();
    for (const bucket of buckets.values()) {
      const groupKey = `${bucket.itemId}:${bucket.warehouseId}`;
      const rows = groups.get(groupKey) ?? [];
      rows.push(bucket);
      groups.set(groupKey, rows);
    }
    const results: CalculatedRequirement[] = [];
    const nextGenerated: GeneratedDemand[] = [];
    for (const [groupKey, groupBuckets] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [itemId, warehouseId] = groupKey.split(':');
      const policy = policyByItem.get(itemId);
      if (!policy || !policy.planningWarehouseId) continue;
      const relatedReservations = inputs.reservations.filter((row) => row.itemId === itemId && row.warehouseId === warehouseId);
      const externalReservations = relatedReservations.filter((row) => !includedDemandSourceKeys.has(
        `${row.sourceType}:${row.sourceId}:${row.sourceLineId}`,
      ));
      let projectedBalance = zero();
      const releasedReservationIds = new Set<string>();
      const appliedExternalReservationIds = new Set<string>();
      const addedSupplyKeys = new Set<string>();
      const supplies = inputs.supplies.filter((row) => row.itemId === itemId && row.warehouseId === warehouseId)
        .sort((left, right) => left.availableOn.localeCompare(right.availableOn) || left.sourceType.localeCompare(right.sourceType) || left.sourceId.localeCompare(right.sourceId));

      for (const bucket of groupBuckets.sort((left, right) => left.requiredOn.localeCompare(right.requiredOn))) {
        let onHand = zero(); let purchase = zero(); let production = zero();
        for (const supply of supplies) {
          const supplyKey = `${supply.sourceType}:${supply.sourceId}:${supply.sourceLineId}`;
          if (addedSupplyKeys.has(supplyKey) || supply.availableOn > bucket.requiredOn) continue;
          addedSupplyKeys.add(supplyKey);
          const amount = qty(supply.quantity);
          projectedBalance = qty(projectedBalance.plus(amount));
          if (supply.sourceType === 'on_hand') onHand = onHand.plus(Prisma.Decimal.max(zero(), amount));
          else if (supply.sourceType === 'purchase_order') purchase = purchase.plus(amount);
          else production = production.plus(amount);
        }
        const demandSourceKeys = new Set(bucket.refs.map((ref) => `${String(ref.sourceType)}:${String(ref.sourceId)}:${String(ref.sourceLineId ?? '')}`));
        const includedRows = relatedReservations.filter((row) => !releasedReservationIds.has(row.id)
          && demandSourceKeys.has(`${row.sourceType}:${row.sourceId}:${row.sourceLineId}`));
        includedRows.forEach((row) => releasedReservationIds.add(row.id));
        const includedReservation = includedRows.reduce((sum, row) => sum.plus(row.quantity), zero());
        const externalRows = externalReservations.filter((row) => {
          if (appliedExternalReservationIds.has(row.id)) return false;
          const requiredOn = !row.requiredOn || row.requiredOn < inputs.parameters.asOfDate
            ? inputs.parameters.asOfDate : row.requiredOn;
          return requiredOn <= bucket.requiredOn;
        });
        externalRows.forEach((row) => appliedExternalReservationIds.add(row.id));
        const externalReservation = externalRows.reduce((sum, row) => sum.plus(row.quantity), zero());
        projectedBalance = qty(projectedBalance.minus(externalReservation));
        const openingProjectedBalance = projectedBalance;
        const reorderPoint = policy.lotSizing === 'min_max'
          ? Prisma.Decimal.max(qty(policy.safetyStock), qty(policy.minimumStock)) : qty(policy.safetyStock);
        const rawNet = bucket.gross.plus(reorderPoint).minus(openingProjectedBalance);
        const net = qty(Prisma.Decimal.max(zero(), rawNet));
        const bom = policy.supplyPolicy === 'make' ? selectBom(inputs, bucket.itemId, bucket.requiredOn) : undefined;
        if (positive(net) && policy.supplyPolicy === 'make' && !bom) throw new ApiError(409, 'approved_bom_missing', `Item ${policy.itemCode} requires an approved BOM effective on ${bucket.requiredOn}.`);
        const projectedAfterDemand = qty(openingProjectedBalance.minus(bucket.gross));
        const planned = positive(net) ? applyLotSizing(net, projectedAfterDemand, policy) : zero();
        const closingProjectedBalance = qty(projectedAfterDemand.plus(planned));
        projectedBalance = closingProjectedBalance;
        const orderOn = subtractDays(bucket.requiredOn, policy.leadTimeDays);
        const key = `${bucket.level}:${bucket.requiredOn}:${bucket.itemId}:${bucket.warehouseId}`;
        const calculationSnapshot: JsonRecord = {
          policy, forecastTreatment: inputs.parameters.forecastTreatment, grossRequirement: bucket.gross.toString(),
          includedReservation: includedReservation.toString(), externalReservationApplied: externalReservation.toString(),
          newOnHandSupply: onHand.toString(), newPurchaseSupply: purchase.toString(), newProductionSupply: production.toString(),
          openingProjectedBalance: openingProjectedBalance.toString(), reorderPoint: reorderPoint.toString(),
          netRequirement: net.toString(), plannedQuantity: planned.toString(), closingProjectedBalance: closingProjectedBalance.toString(),
        };
        const result: CalculatedRequirement = {
          key, itemId: bucket.itemId, warehouseId: bucket.warehouseId, ...(bom ? { bomRevisionId: bom.revisionId } : {}), level: bucket.level,
          requiredOn: bucket.requiredOn, grossRequirement: bucket.gross.toString(), includedReservation: includedReservation.toString(),
          onHandQuantity: onHand.toString(), externalReservation: externalReservation.toString(), openPurchaseSupply: purchase.toString(),
          openProductionSupply: production.toString(), safetyStock: policy.safetyStock, netRequirement: net.toString(),
          sourceRefs: bucket.refs, calculationSnapshot, snapshotHash: hashCanonical({ key, refs: bucket.refs, calculationSnapshot }),
        };
        if (positive(planned)) {
          const suggestionType: 'make' | 'purchase' | 'transfer' = policy.supplyPolicy === 'buy'
            ? 'purchase' : policy.supplyPolicy === 'make' ? 'make' : 'transfer';
          const planningSnapshot: JsonRecord = { requirementKey: key, policy, ...(bom ? { bom } : {}), sourceRefs: bucket.refs, calculationSnapshot };
          result.suggestion = {
            suggestionType, ...(suggestionType === 'transfer' && policy.transferSourceWarehouseId ? { sourceWarehouseId: policy.transferSourceWarehouseId } : {}),
            quantity: planned.toString(), uom: policy.baseUom, orderOn, planningSnapshot,
            sourceSnapshotHash: hashCanonical({ requirement: result.snapshotHash, planningSnapshot, quantity: planned.toString(), orderOn }),
          };
          if (suggestionType === 'make' && bom) {
            if (bucket.level >= 25) throw new ApiError(409, 'bom_depth_exceeded', 'BOM explosion exceeded 25 levels.');
            for (const component of bom.components) {
              const componentPolicy = policyByItem.get(component.componentItemId);
              const componentWarehouseId = component.issueWarehouseId ?? componentPolicy?.planningWarehouseId ?? '';
              if (!componentPolicy || !componentWarehouseId) throw new ApiError(409, 'component_planning_policy_missing', 'Every exploded BOM component requires a planning warehouse and policy.');
              const factor = qty(component.quantity).dividedBy(bom.outputQuantity)
                .dividedBy(qty(bom.yieldPercentage).dividedBy(100))
                .times(qty(1).plus(qty(component.scrapPercentage).dividedBy(100)));
              const componentRequiredOn = orderOn < inputs.parameters.asOfDate ? inputs.parameters.asOfDate : orderOn;
              const componentQuantity = qty(planned.times(factor));
              nextGenerated.push({
                itemId: component.componentItemId, warehouseId: componentWarehouseId, requiredOn: componentRequiredOn,
                level: bucket.level + 1, quantity: componentQuantity.toString(),
                ref: { sourceType: 'bom_explosion', parentItemId: bucket.itemId, parentRequirementKey: key, bomRevisionId: bom.revisionId, componentItemId: component.componentItemId },
              });
            }
          }
        }
        results.push(result);
      }
    }
    const normalizedGenerated = sorted(nextGenerated, (row) => `${row.requiredOn}:${row.itemId}:${row.warehouseId}:${row.level}:${hashCanonical(row.ref)}`);
    if (hashCanonical(normalizedGenerated) === hashCanonical(generated)) {
      return results.sort((left, right) => left.level - right.level || left.requiredOn.localeCompare(right.requiredOn) || left.itemId.localeCompare(right.itemId));
    }
    generated = normalizedGenerated;
  }
  throw new ApiError(409, 'bom_explosion_not_converged', 'Multi-level BOM explosion did not converge within 25 planning passes.');
}

function suggestionDto(row: {
  id: string; legalEntityId: string; mrpRunId: string; requirementId: string; suggestionType: string; itemId: string;
  warehouseId: string; sourceWarehouseId: string | null; quantity: Prisma.Decimal; uom: string; orderOn: Date; requiredOn: Date;
  status: string; planningSnapshot: Prisma.JsonValue; sourceSnapshotHash: string; releasedResourceType: string; releasedResourceId: string;
  rowVersion: number; createdBy: string; submittedAt: Date | null; approvedBy: string; approvedAt: Date | null;
  releasedBy: string; releasedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: row.id, legalEntityId: row.legalEntityId, mrpRunId: row.mrpRunId, requirementId: row.requirementId,
    suggestionType: row.suggestionType, itemId: row.itemId, warehouseId: row.warehouseId,
    sourceWarehouseId: row.sourceWarehouseId ?? undefined, quantity: row.quantity.toString(), uom: row.uom,
    orderOn: day(row.orderOn), requiredOn: day(row.requiredOn), status: row.status,
    planningSnapshot: structuredClone(row.planningSnapshot), sourceSnapshotHash: row.sourceSnapshotHash,
    releasedResourceType: row.releasedResourceType || undefined, releasedResourceId: row.releasedResourceId || undefined,
    rowVersion: row.rowVersion, createdBy: row.createdBy, submittedAt: row.submittedAt?.toISOString(),
    approvedBy: row.approvedBy || undefined, approvedAt: row.approvedAt?.toISOString(),
    releasedBy: row.releasedBy || undefined, releasedAt: row.releasedAt?.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

const mrpRunInclude = {
  requirements: { orderBy: [{ level: 'asc' }, { requiredOn: 'asc' }, { itemId: 'asc' }] },
  suggestions: { orderBy: [{ requiredOn: 'asc' }, { itemId: 'asc' }] },
} satisfies Prisma.ErpMrpRunInclude;

function mrpRunDto(row: {
  id: string; legalEntityId: string; financialYearId: string; runNumber: string; asOfDate: Date; horizonEnd: Date; status: string;
  parameters: Prisma.JsonValue; demandSnapshot: Prisma.JsonValue; supplySnapshot: Prisma.JsonValue; sourceSnapshotHash: string;
  resultSnapshot: Prisma.JsonValue; resultSnapshotHash: string; rowVersion: number; createdBy: string; calculatedAt: Date; createdAt: Date;
  requirements: Array<{
    id: string; itemId: string; warehouseId: string; bomRevisionId: string | null; level: number; requiredOn: Date;
    grossRequirement: Prisma.Decimal; includedReservation: Prisma.Decimal; onHandQuantity: Prisma.Decimal; externalReservation: Prisma.Decimal;
    openPurchaseSupply: Prisma.Decimal; openProductionSupply: Prisma.Decimal; safetyStock: Prisma.Decimal; netRequirement: Prisma.Decimal;
    sourceRefs: Prisma.JsonValue; calculationSnapshot: Prisma.JsonValue; snapshotHash: string;
  }>;
  suggestions: Parameters<typeof suggestionDto>[0][];
}) {
  return {
    id: row.id, legalEntityId: row.legalEntityId, financialYearId: row.financialYearId, runNumber: row.runNumber,
    asOfDate: day(row.asOfDate), horizonEnd: day(row.horizonEnd), status: row.status, parameters: structuredClone(row.parameters),
    demandSnapshot: structuredClone(row.demandSnapshot), supplySnapshot: structuredClone(row.supplySnapshot),
    sourceSnapshotHash: row.sourceSnapshotHash, resultSnapshot: structuredClone(row.resultSnapshot), resultSnapshotHash: row.resultSnapshotHash,
    rowVersion: row.rowVersion, createdBy: row.createdBy, calculatedAt: row.calculatedAt.toISOString(), createdAt: row.createdAt.toISOString(),
    demandBasis: { forecastTreatment: 'additive', linkedProductionDemandDeduplication: 'sales_order_line' },
    requirements: row.requirements.map((requirement) => ({
      id: requirement.id, itemId: requirement.itemId, warehouseId: requirement.warehouseId,
      bomRevisionId: requirement.bomRevisionId ?? undefined, level: requirement.level, requiredOn: day(requirement.requiredOn),
      grossRequirement: requirement.grossRequirement.toString(), includedReservation: requirement.includedReservation.toString(),
      onHandQuantity: requirement.onHandQuantity.toString(), externalReservation: requirement.externalReservation.toString(),
      openPurchaseSupply: requirement.openPurchaseSupply.toString(), openProductionSupply: requirement.openProductionSupply.toString(),
      safetyStock: requirement.safetyStock.toString(), netRequirement: requirement.netRequirement.toString(),
      sourceRefs: structuredClone(requirement.sourceRefs), calculationSnapshot: structuredClone(requirement.calculationSnapshot), snapshotHash: requirement.snapshotHash,
    })),
    suggestions: row.suggestions.map(suggestionDto),
  };
}

function transferProposalDto(row: {
  id: string; legalEntityId: string; suggestionId: string; proposalNumber: string; itemId: string; fromWarehouseId: string;
  toWarehouseId: string; quantity: Prisma.Decimal; uom: string; requiredOn: Date; status: string; sourceSnapshotHash: string;
  rowVersion: number; createdBy: string; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: row.id, legalEntityId: row.legalEntityId, suggestionId: row.suggestionId, proposalNumber: row.proposalNumber,
    itemId: row.itemId, fromWarehouseId: row.fromWarehouseId, toWarehouseId: row.toWarehouseId,
    quantity: row.quantity.toString(), uom: row.uom, requiredOn: day(row.requiredOn), status: row.status,
    sourceSnapshotHash: row.sourceSnapshotHash, rowVersion: row.rowVersion, createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export class PrismaMesaErpPlanningService {
  hasPermission(input: { organizationId: string; membershipId: string; legalEntityId: string; permission: string }) {
    return hasMesaErpPermission(input);
  }

  async getPlanningPolicy(legalEntityId: string, itemId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const item = await db.erpItem.findFirst({ where: { id: itemId, legalEntityId, active: true } });
      if (!item) throw new ApiError(404, 'inventory_item_not_found', 'Planning item not found in this company.');
      return planningPolicyDto(item);
    });
  }

  updatePlanningPolicy(legalEntityId: string, itemId: string, input: PlanningPolicyUpdate, idempotencyKey: string) {
    return runIdempotent({
      legalEntityId,
      scope: `planning:item-policy:${itemId}:update`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        const item = await db.erpItem.findFirst({ where: { id: itemId, legalEntityId, active: true } });
        if (!item) throw new ApiError(404, 'inventory_item_not_found', 'Planning item not found in this company.');
        if (item.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Item planning policy changed since it was loaded.');
        const warehouseIds = [input.planningWarehouseId, ...(input.transferSourceWarehouseId ? [input.transferSourceWarehouseId] : [])];
        const warehouses = await db.erpWarehouse.findMany({ where: { legalEntityId, active: true, id: { in: warehouseIds } } });
        if (warehouses.length !== warehouseIds.length) throw new ApiError(422, 'planning_warehouse_not_found', 'Planning or transfer warehouse is missing or inactive in this company.');
        if (input.preferredVendorId) {
          const vendor = await db.erpVendor.findFirst({ where: { id: input.preferredVendorId, legalEntityId, lifecycleStatus: { in: ['approved', 'conditionally_approved'] } } });
          if (!vendor) throw new ApiError(422, 'preferred_vendor_not_approved', 'Preferred planning vendor must be approved in this company.');
        }
        const before = planningPolicyDto(item);
        const changed = await db.erpItem.updateMany({
          where: { id: item.id, legalEntityId, rowVersion: input.expectedRowVersion },
          data: {
            planningLeadTimeDays: input.leadTimeDays,
            planningSafetyStock: input.safetyStock,
            planningMinimumStock: input.minimumStock,
            planningMaximumStock: input.maximumStock ?? null,
            planningLotSizing: input.lotSizing,
            planningFixedLotSize: input.fixedLotSize,
            planningMinimumOrder: input.minimumOrderQuantity,
            planningOrderMultiple: input.orderMultiple,
            planningSupplyPolicy: input.supplyPolicy,
            planningWarehouseId: input.planningWarehouseId,
            transferSourceWarehouseId: input.supplyPolicy === 'transfer' ? input.transferSourceWarehouseId : null,
            planningPreferredVendorId: input.preferredVendorId ?? '',
            planningPolicyUpdatedAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Item planning policy changed while it was being saved.');
        const updated = await db.erpItem.findUniqueOrThrow({ where: { id: item.id } });
        const response = planningPolicyDto(updated);
        await audit(db, { action: 'mesaerp.planning_policy.update', entity: 'ErpItem', entityId: item.id, before, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpItem', item.id, 'mesaerp.planning-policy.updated.v1', response);
        return response;
      },
    });
  }

  async listBoms(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const rows = await db.erpPlanningBom.findMany({ where: { legalEntityId }, include: bomInclude, orderBy: [{ bomCode: 'asc' }, { id: 'asc' }], take: 500 });
      return rows.map(bomDto);
    });
  }

  async getBom(legalEntityId: string, bomId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const row = await db.erpPlanningBom.findFirst({ where: { id: bomId, legalEntityId }, include: bomInclude });
      if (!row) throw new ApiError(404, 'planning_bom_not_found', 'Planning BOM not found in this company.');
      return bomDto(row);
    });
  }

  createBom(legalEntityId: string, input: PlanningBomCreate, idempotencyKey: string) {
    return runIdempotent({
      legalEntityId,
      scope: `planning:bom:create:${legalEntityId}`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        await validateRevisionInput(db, legalEntityId, input.parentItemId, input.revision);
        const activeForItem = await db.erpPlanningBom.findFirst({ where: { legalEntityId, parentItemId: input.parentItemId, active: true } });
        if (activeForItem) throw new ApiError(409, 'active_bom_exists', 'This item already has an active planning BOM.');
        const bom = await db.erpPlanningBom.create({
          data: {
            organizationId: context.organizationId, legalEntityId, bomCode: input.bomCode, parentItemId: input.parentItemId,
            bomType: input.bomType, description: input.description, createIdempotencyKey: `bom:${idempotencyKey}`,
            requestHash: hashCanonical(input), createdBy: context.membershipId,
            revisions: {
              create: {
                organizationId: context.organizationId, legalEntityId, revisionNumber: 1, revisionCode: input.revision.revisionCode,
                effectiveFrom: dateOnly(input.revision.effectiveFrom), effectiveTo: input.revision.effectiveTo ? dateOnly(input.revision.effectiveTo) : null,
                outputQuantity: input.revision.outputQuantity, outputUom: input.revision.outputUom,
                yieldPercentage: input.revision.yieldPercentage, notes: input.revision.notes, formulaParameters: json(input.revision.formulaParameters),
                createIdempotencyKey: `bom-revision:${idempotencyKey}`, requestHash: hashCanonical(input.revision), createdBy: context.membershipId,
                components: { create: input.revision.components.map((line, index) => ({
                  organizationId: context.organizationId, legalEntityId, lineNumber: index + 1, componentItemId: line.componentItemId,
                  issueWarehouseId: line.issueWarehouseId ?? null, quantity: line.quantity, uom: line.uom,
                  scrapPercentage: line.scrapPercentage, componentType: line.componentType, phase: line.phase, dimensions: json(line.dimensions),
                })) },
              },
            },
          },
          include: bomInclude,
        });
        const response = bomDto(bom);
        await audit(db, { action: 'mesaerp.planning_bom.create', entity: 'ErpPlanningBom', entityId: bom.id, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpPlanningBom', bom.id, 'mesaerp.planning-bom.created.v1', response);
        return response;
      },
    });
  }

  createBomRevision(legalEntityId: string, bomId: string, input: PlanningBomRevisionCreate, idempotencyKey: string) {
    return runIdempotent({
      legalEntityId,
      scope: `planning:bom:${bomId}:revision:create`,
      key: idempotencyKey,
      payload: input,
      execute: async (db, context) => {
        await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.organizationId}:planning-bom:${bomId}`}))`);
        const bom = await db.erpPlanningBom.findFirst({ where: { id: bomId, legalEntityId, active: true } });
        if (!bom) throw new ApiError(404, 'planning_bom_not_found', 'Active planning BOM not found in this company.');
        await validateRevisionInput(db, legalEntityId, bom.parentItemId, input);
        const latest = await db.erpPlanningBomRevision.findFirst({ where: { bomId }, orderBy: { revisionNumber: 'desc' }, select: { revisionNumber: true } });
        const revision = await db.erpPlanningBomRevision.create({
          data: {
            organizationId: context.organizationId, legalEntityId, bomId, revisionNumber: (latest?.revisionNumber ?? 0) + 1,
            revisionCode: input.revisionCode, effectiveFrom: dateOnly(input.effectiveFrom), effectiveTo: input.effectiveTo ? dateOnly(input.effectiveTo) : null,
            outputQuantity: input.outputQuantity, outputUom: input.outputUom, yieldPercentage: input.yieldPercentage,
            notes: input.notes, formulaParameters: json(input.formulaParameters), createIdempotencyKey: `bom-revision:${idempotencyKey}`,
            requestHash: hashCanonical(input), createdBy: context.membershipId,
            components: { create: input.components.map((line, index) => ({
              organizationId: context.organizationId, legalEntityId, lineNumber: index + 1, componentItemId: line.componentItemId,
              issueWarehouseId: line.issueWarehouseId ?? null, quantity: line.quantity, uom: line.uom,
              scrapPercentage: line.scrapPercentage, componentType: line.componentType, phase: line.phase, dimensions: json(line.dimensions),
            })) },
          },
          include: { components: { include: { componentItem: true, issueWarehouse: true }, orderBy: { lineNumber: 'asc' } } },
        });
        const response = { ...revisionSnapshot(revision), status: revision.status, rowVersion: revision.rowVersion, sourceSnapshotHash: revision.sourceSnapshotHash };
        await audit(db, { action: 'mesaerp.planning_bom_revision.create', entity: 'ErpPlanningBomRevision', entityId: revision.id, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpPlanningBomRevision', revision.id, 'mesaerp.planning-bom-revision.created.v1', response);
        return response;
      },
    });
  }

  updateBomRevision(legalEntityId: string, bomId: string, revisionId: string, input: PlanningBomRevisionUpdate, idempotencyKey: string) {
    return runIdempotent({
      legalEntityId,
      scope: `planning:bom-revision:${revisionId}:update`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        const existing = await db.erpPlanningBomRevision.findFirst({ where: { id: revisionId, bomId, legalEntityId }, include: { bom: true, components: { orderBy: { lineNumber: 'asc' } } } });
        if (!existing) throw new ApiError(404, 'planning_bom_revision_not_found', 'Planning BOM revision not found.');
        if (existing.status !== 'draft') throw new ApiError(409, 'bom_revision_immutable', `A ${existing.status} revision cannot be edited.`);
        if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'BOM revision changed since it was loaded.');
        const merged: PlanningBomRevisionCreate = {
          revisionCode: existing.revisionCode,
          effectiveFrom: input.effectiveFrom ?? day(existing.effectiveFrom),
          effectiveTo: input.effectiveTo ?? (existing.effectiveTo ? day(existing.effectiveTo) : undefined),
          outputQuantity: input.outputQuantity ?? existing.outputQuantity.toString(),
          outputUom: input.outputUom ?? existing.outputUom,
          yieldPercentage: input.yieldPercentage ?? existing.yieldPercentage.toString(),
          notes: input.notes ?? existing.notes,
          formulaParameters: input.formulaParameters ?? structuredClone(existing.formulaParameters) as JsonRecord,
          components: input.components ?? existing.components.map((line) => ({
            componentItemId: line.componentItemId, issueWarehouseId: line.issueWarehouseId ?? undefined,
            quantity: line.quantity.toString(), uom: line.uom, scrapPercentage: line.scrapPercentage.toString(),
            componentType: line.componentType as 'material' | 'packaging', phase: line.phase,
            dimensions: structuredClone(line.dimensions) as JsonRecord,
          })),
        };
        await validateRevisionInput(db, legalEntityId, existing.bom.parentItemId, merged);
        const changed = await db.erpPlanningBomRevision.updateMany({
          where: { id: revisionId, bomId, legalEntityId, status: 'draft', rowVersion: input.expectedRowVersion },
          data: {
            effectiveFrom: dateOnly(merged.effectiveFrom), effectiveTo: merged.effectiveTo ? dateOnly(merged.effectiveTo) : null,
            outputQuantity: merged.outputQuantity, outputUom: merged.outputUom, yieldPercentage: merged.yieldPercentage,
            notes: merged.notes, formulaParameters: json(merged.formulaParameters), requestHash: hashCanonical(merged), rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'BOM revision changed while it was being saved.');
        if (input.components) {
          await db.erpPlanningBomComponent.deleteMany({ where: { revisionId } });
          await db.erpPlanningBomComponent.createMany({ data: merged.components.map((line, index) => ({
            organizationId: context.organizationId, legalEntityId, revisionId, lineNumber: index + 1,
            componentItemId: line.componentItemId, issueWarehouseId: line.issueWarehouseId ?? null,
            quantity: line.quantity, uom: line.uom, scrapPercentage: line.scrapPercentage,
            componentType: line.componentType, phase: line.phase, dimensions: json(line.dimensions),
          })) });
        }
        const updated = await db.erpPlanningBomRevision.findUniqueOrThrow({ where: { id: revisionId }, include: { components: { include: { componentItem: true, issueWarehouse: true }, orderBy: { lineNumber: 'asc' } } } });
        const response = { ...revisionSnapshot(updated), status: updated.status, rowVersion: updated.rowVersion, sourceSnapshotHash: updated.sourceSnapshotHash };
        await audit(db, { action: 'mesaerp.planning_bom_revision.update', entity: 'ErpPlanningBomRevision', entityId: revisionId, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpPlanningBomRevision', revisionId, 'mesaerp.planning-bom-revision.updated.v1', response);
        return response;
      },
    });
  }

  transitionBomRevision(legalEntityId: string, bomId: string, revisionId: string, action: 'submit' | 'approve', input: PlanningRowVersion, idempotencyKey: string) {
    return runIdempotent({
      legalEntityId, scope: `planning:bom-revision:${revisionId}:${action}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        if (action === 'approve') {
          await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.organizationId}:planning-bom:${bomId}`}))`);
        }
        const existing = await db.erpPlanningBomRevision.findFirst({
          where: { id: revisionId, bomId, legalEntityId }, include: { bom: true, components: { include: { componentItem: true, issueWarehouse: true }, orderBy: { lineNumber: 'asc' } } },
        });
        if (!existing) throw new ApiError(404, 'planning_bom_revision_not_found', 'Planning BOM revision not found.');
        if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'BOM revision changed since it was loaded.');
        const expected = action === 'submit' ? 'draft' : 'submitted';
        if (existing.status !== expected) throw new ApiError(409, 'bom_revision_transition_invalid', `BOM revision is ${existing.status}.`);
        if (action === 'approve') {
          if (existing.createdBy === context.membershipId) throw new ApiError(409, 'maker_checker_required', 'BOM revision maker cannot approve the same revision.');
          const overlapping = await db.erpPlanningBomRevision.findFirst({
            where: {
              bomId, legalEntityId, id: { not: revisionId }, status: 'approved', effectiveFrom: { lte: existing.effectiveTo ?? new Date('9999-12-31T00:00:00.000Z') },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: existing.effectiveFrom } }],
            },
            select: { id: true, revisionCode: true },
          });
          if (overlapping) throw new ApiError(409, 'bom_effective_period_overlap', `Approved revision ${overlapping.revisionCode} already covers part of this effective period.`);
          await assertNoBomCycle(db, legalEntityId, existing.bom.parentItemId, existing.components.map((line) => line.componentItemId), existing.id);
        }
        const snapshot = revisionSnapshot(existing);
        const now = new Date();
        const changed = await db.erpPlanningBomRevision.updateMany({
          where: { id: revisionId, bomId, legalEntityId, status: expected, rowVersion: input.expectedRowVersion },
          data: action === 'submit'
            ? { status: 'submitted', submittedAt: now, rowVersion: { increment: 1 } }
            : { status: 'approved', approvedAt: now, approvedBy: context.membershipId, sourceSnapshotHash: hashCanonical(snapshot), rowVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'BOM revision changed while the transition was being saved.');
        const updated = await db.erpPlanningBomRevision.findUniqueOrThrow({ where: { id: revisionId }, include: { components: { include: { componentItem: true, issueWarehouse: true }, orderBy: { lineNumber: 'asc' } } } });
        const response = { ...revisionSnapshot(updated), status: updated.status, rowVersion: updated.rowVersion, sourceSnapshotHash: updated.sourceSnapshotHash, approvedBy: updated.approvedBy };
        await audit(db, { action: `mesaerp.planning_bom_revision.${action}`, entity: 'ErpPlanningBomRevision', entityId: revisionId, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpPlanningBomRevision', revisionId, `mesaerp.planning-bom-revision.${action === 'submit' ? 'submitted' : 'approved'}.v1`, response);
        return response;
      },
    });
  }

  async listForecasts(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const rows = await db.erpDemandForecast.findMany({ where: { legalEntityId }, orderBy: [{ forecastDate: 'asc' }, { forecastNumber: 'asc' }], take: 500 });
      return rows.map(forecastDto);
    });
  }

  async getForecast(legalEntityId: string, forecastId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const row = await db.erpDemandForecast.findFirst({ where: { id: forecastId, legalEntityId } });
      if (!row) throw new ApiError(404, 'demand_forecast_not_found', 'Demand forecast not found in this company.');
      return forecastDto(row);
    });
  }

  createForecast(legalEntityId: string, input: DemandForecastCreate, idempotencyKey: string) {
    return runIdempotent({
      legalEntityId, scope: `planning:forecast:create:${legalEntityId}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        const entity = await requireEntity(db, context, legalEntityId);
        const forecastDate = dateOnly(input.forecastDate);
        const financialYear = await yearFor(db, legalEntityId, forecastDate);
        const [item, warehouse] = await Promise.all([
          db.erpItem.findFirst({ where: { id: input.itemId, legalEntityId, active: true, itemType: 'inventory' } }),
          db.erpWarehouse.findFirst({ where: { id: input.warehouseId, legalEntityId, active: true } }),
        ]);
        if (!item) throw new ApiError(404, 'forecast_item_not_found', 'Forecast item is missing or inactive in this company.');
        if (!warehouse) throw new ApiError(404, 'forecast_warehouse_not_found', 'Forecast warehouse is missing or inactive in this company.');
        if (item.baseUom.toUpperCase() !== input.uom.toUpperCase()) throw new ApiError(422, 'forecast_uom_mismatch', `Forecast must use ${item.baseUom}.`);
        const forecastNumber = input.forecastNumber ?? await allocateNumber(db, context, entity, financialYear, 'planning:forecast', 'FC');
        const row = await db.erpDemandForecast.create({ data: {
          organizationId: context.organizationId, legalEntityId, financialYearId: financialYear.id, forecastNumber,
          itemId: item.id, warehouseId: warehouse.id, forecastDate, quantity: input.quantity, uom: item.baseUom,
          notes: input.notes, createIdempotencyKey: `forecast:${idempotencyKey}`, requestHash: hashCanonical(input), createdBy: context.membershipId,
        } });
        const response = forecastDto(row);
        await audit(db, { action: 'mesaerp.demand_forecast.create', entity: 'ErpDemandForecast', entityId: row.id, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpDemandForecast', row.id, 'mesaerp.demand-forecast.created.v1', response);
        return response;
      },
    });
  }

  transitionForecast(legalEntityId: string, forecastId: string, action: 'submit' | 'approve', input: PlanningRowVersion, idempotencyKey: string) {
    return runIdempotent({
      legalEntityId, scope: `planning:forecast:${forecastId}:${action}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        const existing = await db.erpDemandForecast.findFirst({ where: { id: forecastId, legalEntityId } });
        if (!existing) throw new ApiError(404, 'demand_forecast_not_found', 'Demand forecast not found in this company.');
        if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Demand forecast changed since it was loaded.');
        const expected = action === 'submit' ? 'draft' : 'submitted';
        if (existing.status !== expected) throw new ApiError(409, 'forecast_transition_invalid', `Demand forecast is ${existing.status}.`);
        if (action === 'approve' && existing.createdBy === context.membershipId) throw new ApiError(409, 'maker_checker_required', 'Forecast maker cannot approve the same forecast.');
        const snapshot = { forecastNumber: existing.forecastNumber, itemId: existing.itemId, warehouseId: existing.warehouseId, forecastDate: day(existing.forecastDate), quantity: existing.quantity.toString(), uom: existing.uom };
        const now = new Date();
        const changed = await db.erpDemandForecast.updateMany({
          where: { id: forecastId, legalEntityId, status: expected, rowVersion: input.expectedRowVersion },
          data: action === 'submit'
            ? { status: 'submitted', submittedAt: now, rowVersion: { increment: 1 } }
            : { status: 'approved', approvedAt: now, approvedBy: context.membershipId, sourceSnapshotHash: hashCanonical(snapshot), rowVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Demand forecast changed while its lifecycle action was being saved.');
        const updated = await db.erpDemandForecast.findUniqueOrThrow({ where: { id: forecastId } });
        const response = forecastDto(updated);
        await audit(db, { action: `mesaerp.demand_forecast.${action}`, entity: 'ErpDemandForecast', entityId: forecastId, before: forecastDto(existing), after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpDemandForecast', forecastId, `mesaerp.demand-forecast.${action === 'submit' ? 'submitted' : 'approved'}.v1`, response);
        return response;
      },
    });
  }

  async listReservations(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const rows = await db.erpStockReservation.findMany({ where: { legalEntityId }, orderBy: [{ createdAt: 'desc' }, { reservationNumber: 'asc' }], take: 500 });
      return rows.map(reservationDto);
    });
  }

  async getReservation(legalEntityId: string, reservationId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const row = await db.erpStockReservation.findFirst({ where: { id: reservationId, legalEntityId } });
      if (!row) throw new ApiError(404, 'stock_reservation_not_found', 'Stock reservation not found in this company.');
      return reservationDto(row);
    });
  }

  createReservation(legalEntityId: string, input: StockReservationCreate, idempotencyKey: string) {
    return runIdempotent({
      legalEntityId, scope: `planning:reservation:create:${legalEntityId}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        const entity = await requireEntity(db, context, legalEntityId);
        const [item, warehouse] = await Promise.all([
          db.erpItem.findFirst({ where: { id: input.itemId, legalEntityId, active: true, itemType: 'inventory' } }),
          db.erpWarehouse.findFirst({ where: { id: input.warehouseId, legalEntityId, active: true } }),
        ]);
        if (!item) throw new ApiError(404, 'reservation_item_not_found', 'Reservation item is missing or inactive in this company.');
        if (!warehouse) throw new ApiError(404, 'reservation_warehouse_not_found', 'Reservation warehouse is missing or inactive in this company.');
        if (item.baseUom.toUpperCase() !== input.uom.toUpperCase()) throw new ApiError(422, 'reservation_uom_mismatch', `Reservation must use ${item.baseUom}.`);
        if ((item.batchTracked || item.expiryTracked) && !input.batchNumber) throw new ApiError(422, 'reservation_batch_required', 'Batch number is required for batch- or expiry-tracked stock.');
        if (item.serialTracked && (!input.serialNumber || !qty(input.quantity).equals(1))) throw new ApiError(422, 'reservation_serial_required', 'Serial-tracked stock must reserve one identified serial number.');
        if (!item.serialTracked && input.serialNumber) throw new ApiError(422, 'reservation_serial_not_allowed', 'Serial number is only allowed for serial-tracked stock.');
        await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.organizationId}:reservation:${item.id}:${warehouse.id}:${input.batchNumber}:${input.serialNumber}`}))`);
        if (input.sourceType !== 'manual') {
          await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.organizationId}:reservation-source:${input.sourceType}:${input.sourceId ?? ''}:${input.sourceLineId ?? ''}`}))`);
        }

        let sourceSnapshot: JsonRecord = { sourceType: 'manual' };
        let sourceLimit: Prisma.Decimal | undefined;
        if (input.sourceType === 'sales_order') {
          const source = await db.erpDocument.findFirst({ where: { id: input.sourceId, legalEntityId, documentType: 'sales_order', status: 'approved' }, include: { lines: true } });
          const line = source?.lines.find((row) => row.id === input.sourceLineId);
          if (!source || !line) throw new ApiError(422, 'reservation_sales_source_invalid', 'Reservation requires an approved sales-order line in this company.');
          if (line.itemId !== item.id || line.uom.toUpperCase() !== item.baseUom.toUpperCase()) throw new ApiError(422, 'reservation_source_mismatch', 'Reservation item and UOM must match the sales-order line.');
          sourceLimit = line.quantity;
          sourceSnapshot = { sourceType: 'sales_order', sourceId: source.id, sourceLineId: line.id, sourceNumber: source.documentNumber, itemId: line.itemId, quantity: line.quantity.toString(), uom: line.uom, status: source.status };
        } else if (input.sourceType === 'production_demand') {
          const source = await db.erpProductionDemand.findFirst({ where: { id: input.sourceId, legalEntityId, status: { in: ['approved', 'released', 'partially_completed'] } } });
          if (!source) throw new ApiError(422, 'reservation_production_source_invalid', 'Reservation requires an approved or released production demand in this company.');
          if (source.itemId !== item.id || source.uom.toUpperCase() !== item.baseUom.toUpperCase()) throw new ApiError(422, 'reservation_source_mismatch', 'Reservation item and UOM must match the production demand.');
          sourceLimit = source.quantity;
          sourceSnapshot = { sourceType: 'production_demand', sourceId: source.id, sourceNumber: source.demandNumber, itemId: source.itemId, quantity: source.quantity.toString(), uom: source.uom, status: source.status };
        }
        if (sourceLimit) {
          const already = await db.erpStockReservation.aggregate({ where: { legalEntityId, sourceType: input.sourceType, sourceId: input.sourceId ?? '', sourceLineId: input.sourceLineId ?? '', status: 'active' }, _sum: { quantity: true } });
          if (qty(already._sum.quantity ?? zero()).plus(input.quantity).greaterThan(sourceLimit)) throw new ApiError(409, 'reservation_source_quantity_exceeded', 'Active reservations would exceed the source demand quantity.');
        }

        const availabilityDate = dateOnly(input.requiredOn ?? day(new Date()));
        const traceWhere = {
          legalEntityId, itemId: item.id, warehouseId: warehouse.id, businessDate: { lte: availabilityDate },
          ...(input.batchNumber ? { batchNumber: input.batchNumber } : {}), ...(input.serialNumber ? { serialNumber: input.serialNumber } : {}),
          ...(item.expiryTracked ? { OR: [{ expiryDate: null }, { expiryDate: { gte: availabilityDate } }] } : {}),
        };
        const [movementTotal, reservedTotal] = await Promise.all([
          db.erpStockMovement.aggregate({ where: traceWhere, _sum: { quantity: true } }),
          db.erpStockReservation.aggregate({ where: { legalEntityId, itemId: item.id, warehouseId: warehouse.id, status: 'active', ...(input.batchNumber ? { batchNumber: input.batchNumber } : {}), ...(input.serialNumber ? { serialNumber: input.serialNumber } : {}) }, _sum: { quantity: true } }),
        ]);
        const available = qty(movementTotal._sum.quantity ?? zero()).minus(reservedTotal._sum.quantity ?? zero());
        if (available.lessThan(input.quantity)) throw new ApiError(409, 'insufficient_available_stock', `Only ${available.toString()} ${item.baseUom} is available to reserve.`);
        const financialYear = await yearFor(db, legalEntityId, availabilityDate);
        const reservationNumber = input.reservationNumber ?? await allocateNumber(db, context, entity, financialYear, 'planning:reservation', 'RSV');
        const row = await db.erpStockReservation.create({ data: {
          organizationId: context.organizationId, legalEntityId, reservationNumber, itemId: item.id, warehouseId: warehouse.id,
          quantity: input.quantity, uom: item.baseUom, batchNumber: input.batchNumber, serialNumber: input.serialNumber,
          sourceType: input.sourceType, sourceId: input.sourceId ?? '', sourceLineId: input.sourceLineId ?? '',
          requiredOn: input.requiredOn ? dateOnly(input.requiredOn) : null, sourceSnapshotHash: hashCanonical(sourceSnapshot),
          createIdempotencyKey: `reservation:${idempotencyKey}`, requestHash: hashCanonical(input), createdBy: context.membershipId,
        } });
        const response = reservationDto(row);
        await audit(db, { action: 'mesaerp.stock_reservation.create', entity: 'ErpStockReservation', entityId: row.id, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpStockReservation', row.id, 'mesaerp.stock-reservation.created.v1', response);
        return response;
      },
    });
  }

  transitionReservation(legalEntityId: string, reservationId: string, action: 'release' | 'cancel', input: PlanningRowVersion, idempotencyKey: string) {
    return runIdempotent({
      legalEntityId, scope: `planning:reservation:${reservationId}:${action}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpStockReservation" WHERE "id" = ${reservationId} FOR UPDATE`);
        const existing = await db.erpStockReservation.findFirst({ where: { id: reservationId, legalEntityId } });
        if (!existing) throw new ApiError(404, 'stock_reservation_not_found', 'Stock reservation not found in this company.');
        if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Stock reservation changed since it was loaded.');
        if (existing.status !== 'active') throw new ApiError(409, 'reservation_transition_invalid', `Stock reservation is ${existing.status}.`);
        const now = new Date();
        const changed = await db.erpStockReservation.updateMany({
          where: { id: reservationId, legalEntityId, status: 'active', rowVersion: input.expectedRowVersion },
          data: { status: action === 'release' ? 'released' : 'cancelled', releasedAt: now, releasedBy: context.membershipId, rowVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Stock reservation changed while the action was being saved.');
        const updated = await db.erpStockReservation.findUniqueOrThrow({ where: { id: reservationId } });
        const response = reservationDto(updated);
        await audit(db, { action: `mesaerp.stock_reservation.${action}`, entity: 'ErpStockReservation', entityId: reservationId, before: reservationDto(existing), after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpStockReservation', reservationId, `mesaerp.stock-reservation.${action === 'release' ? 'released' : 'cancelled'}.v1`, response);
        return response;
      },
    });
  }

  async getAtp(legalEntityId: string, input: AtpQuery) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const [item, warehouse] = await Promise.all([
        db.erpItem.findFirst({ where: { id: input.itemId, legalEntityId, active: true, itemType: 'inventory' } }),
        db.erpWarehouse.findFirst({ where: { id: input.warehouseId, legalEntityId, active: true } }),
      ]);
      if (!item || !warehouse) throw new ApiError(404, 'atp_scope_not_found', 'ATP item or warehouse is missing or inactive in this company.');
      const asOfDate = input.asOfDate ?? day(new Date());
      const requiredOn = input.requiredOn ?? asOfDate;
      if (requiredOn < asOfDate) throw new ApiError(422, 'atp_date_invalid', 'ATP required-on date cannot precede its as-of date.');
      const movements = await db.erpStockMovement.aggregate({ where: { legalEntityId, itemId: item.id, warehouseId: warehouse.id, businessDate: { lte: dateOnly(asOfDate) } }, _sum: { quantity: true } });
      const reservations = await db.erpStockReservation.aggregate({ where: { legalEntityId, itemId: item.id, warehouseId: warehouse.id, status: 'active', OR: [{ requiredOn: null }, { requiredOn: { lte: dateOnly(requiredOn) } }] }, _sum: { quantity: true } });
      const planningInput: MrpRunCreate = {
        asOfDate, horizonEnd: requiredOn, warehouseIds: [warehouse.id], includeSalesOrders: false,
        includeForecasts: false, includeProductionDemands: false, forecastTreatment: 'additive',
      };
      const snapshot = await collectPlanningInputs(db, legalEntityId, planningInput);
      const onHand = qty(movements._sum.quantity ?? zero());
      const reserved = qty(reservations._sum.quantity ?? zero());
      const purchase = snapshot.supplies.filter((row) => row.sourceType === 'purchase_order' && row.itemId === item.id && row.warehouseId === warehouse.id && row.availableOn <= requiredOn).reduce((sum, row) => sum.plus(row.quantity), zero());
      const production = snapshot.supplies.filter((row) => row.sourceType === 'production_order' && row.itemId === item.id && row.warehouseId === warehouse.id && row.availableOn <= requiredOn).reduce((sum, row) => sum.plus(row.quantity), zero());
      const currentAvailable = qty(onHand.minus(reserved));
      const projectedAvailable = qty(currentAvailable.plus(purchase).plus(production));
      return {
        legalEntityId, itemId: item.id, itemCode: item.itemCode, warehouseId: warehouse.id, warehouseCode: warehouse.code,
        uom: item.baseUom, asOfDate, requiredOn, onHandQuantity: onHand.toString(), activeReservationQuantity: reserved.toString(),
        currentAvailableQuantity: currentAvailable.toString(), openPurchaseSupply: purchase.toString(), openProductionSupply: production.toString(),
        projectedAvailableQuantity: projectedAvailable.toString(), calculatedFromSnapshotHash: snapshot.sourceSnapshotHash,
      };
    });
  }

  async listMrpRuns(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const rows = await db.erpMrpRun.findMany({ where: { legalEntityId }, include: mrpRunInclude, orderBy: [{ calculatedAt: 'desc' }, { runNumber: 'desc' }], take: 100 });
      return rows.map(mrpRunDto);
    });
  }

  async getMrpRun(legalEntityId: string, runId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const row = await db.erpMrpRun.findFirst({ where: { id: runId, legalEntityId }, include: mrpRunInclude });
      if (!row) throw new ApiError(404, 'mrp_run_not_found', 'MRP run not found in this company.');
      return mrpRunDto(row);
    });
  }

  createMrpRun(legalEntityId: string, input: MrpRunCreate, idempotencyKey: string) {
    return runIdempotent({
      legalEntityId, scope: `planning:mrp-run:create:${legalEntityId}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        const entity = await requireEntity(db, context, legalEntityId);
        const financialYear = await yearFor(db, legalEntityId, dateOnly(input.asOfDate));
        await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.organizationId}:mrp-run:${legalEntityId}`}))`);
        const firstInputs = await collectPlanningInputs(db, legalEntityId, input);
        const calculations = calculateMrp(firstInputs);
        const confirmation = await collectPlanningInputs(db, legalEntityId, input);
        if (firstInputs.sourceSnapshotHash !== confirmation.sourceSnapshotHash) {
          throw new ApiError(409, 'planning_sources_changed', 'Planning inputs changed during calculation; retry the MRP run.');
        }
        const runNumber = input.runNumber ?? await allocateNumber(db, context, entity, financialYear, 'planning:mrp-run', 'MRP');
        const resultSnapshot = calculations.map((row) => ({
          key: row.key, itemId: row.itemId, warehouseId: row.warehouseId, level: row.level, requiredOn: row.requiredOn,
          netRequirement: row.netRequirement, ...(row.suggestion ? { suggestion: row.suggestion } : {}),
        }));
        const run = await db.erpMrpRun.create({ data: {
          organizationId: context.organizationId, legalEntityId, financialYearId: financialYear.id, runNumber,
          asOfDate: dateOnly(input.asOfDate), horizonEnd: dateOnly(input.horizonEnd), parameters: json(input),
          demandSnapshot: json({ demands: firstInputs.demands, reservations: firstInputs.reservations }),
          supplySnapshot: json({ supplies: firstInputs.supplies, policies: firstInputs.policies, boms: firstInputs.boms }),
          sourceSnapshotHash: firstInputs.sourceSnapshotHash, resultSnapshot: json(resultSnapshot), resultSnapshotHash: hashCanonical(resultSnapshot),
          createIdempotencyKey: `mrp-run:${idempotencyKey}`, requestHash: hashCanonical(input), createdBy: context.membershipId,
        } });
        for (const calculation of calculations) {
          const requirement = await db.erpMrpRequirement.create({ data: {
            organizationId: context.organizationId, legalEntityId, mrpRunId: run.id, itemId: calculation.itemId,
            warehouseId: calculation.warehouseId, bomRevisionId: calculation.bomRevisionId ?? null, level: calculation.level,
            requiredOn: dateOnly(calculation.requiredOn), grossRequirement: calculation.grossRequirement,
            includedReservation: calculation.includedReservation, onHandQuantity: calculation.onHandQuantity,
            externalReservation: calculation.externalReservation, openPurchaseSupply: calculation.openPurchaseSupply,
            openProductionSupply: calculation.openProductionSupply, safetyStock: calculation.safetyStock,
            netRequirement: calculation.netRequirement, sourceRefs: json(calculation.sourceRefs),
            calculationSnapshot: json(calculation.calculationSnapshot), snapshotHash: calculation.snapshotHash,
          } });
          if (calculation.suggestion) await db.erpMrpSuggestion.create({ data: {
            organizationId: context.organizationId, legalEntityId, mrpRunId: run.id, requirementId: requirement.id,
            suggestionType: calculation.suggestion.suggestionType, itemId: calculation.itemId, warehouseId: calculation.warehouseId,
            sourceWarehouseId: calculation.suggestion.sourceWarehouseId ?? null, quantity: calculation.suggestion.quantity,
            uom: calculation.suggestion.uom, orderOn: dateOnly(calculation.suggestion.orderOn), requiredOn: dateOnly(calculation.requiredOn),
            planningSnapshot: json(calculation.suggestion.planningSnapshot), sourceSnapshotHash: calculation.suggestion.sourceSnapshotHash,
            createdBy: context.membershipId,
          } });
        }
        const persisted = await db.erpMrpRun.findUniqueOrThrow({ where: { id: run.id }, include: mrpRunInclude });
        const response = mrpRunDto(persisted);
        await audit(db, { action: 'mesaerp.mrp_run.calculate', entity: 'ErpMrpRun', entityId: run.id, after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpMrpRun', run.id, 'mesaerp.mrp-run.calculated.v1', { id: run.id, runNumber: run.runNumber, sourceSnapshotHash: run.sourceSnapshotHash, resultSnapshotHash: run.resultSnapshotHash });
        return response;
      },
    });
  }

  async listMrpSuggestions(legalEntityId: string, runId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const run = await db.erpMrpRun.findFirst({ where: { id: runId, legalEntityId }, select: { id: true } });
      if (!run) throw new ApiError(404, 'mrp_run_not_found', 'MRP run not found in this company.');
      const rows = await db.erpMrpSuggestion.findMany({ where: { legalEntityId, mrpRunId: runId }, orderBy: [{ requiredOn: 'asc' }, { itemId: 'asc' }] });
      return rows.map(suggestionDto);
    });
  }

  private async assertRunFresh(db: Db, legalEntityId: string, run: { parameters: Prisma.JsonValue; sourceSnapshotHash: string }) {
    const parameters = structuredClone(run.parameters) as MrpRunCreate;
    const current = await collectPlanningInputs(db, legalEntityId, parameters);
    if (current.sourceSnapshotHash !== run.sourceSnapshotHash) {
      throw new ApiError(409, 'mrp_run_stale', 'Demand, supply, stock, reservation, policy, or approved BOM inputs changed after this MRP run. Recalculate before actioning suggestions.');
    }
  }

  transitionMrpSuggestion(legalEntityId: string, suggestionId: string, action: 'submit' | 'approve' | 'release', input: PlanningRowVersion, idempotencyKey: string) {
    return runIdempotent({
      legalEntityId, scope: `planning:mrp-suggestion:${suggestionId}:${action}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpMrpSuggestion" WHERE "id" = ${suggestionId} FOR UPDATE`);
        const existing = await db.erpMrpSuggestion.findFirst({
          where: { id: suggestionId, legalEntityId }, include: { mrpRun: true, requirement: true, item: true, warehouse: true, sourceWarehouse: true },
        });
        if (!existing) throw new ApiError(404, 'mrp_suggestion_not_found', 'MRP suggestion not found in this company.');
        if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'MRP suggestion changed since it was loaded.');
        const expected = action === 'submit' ? 'draft' : action === 'approve' ? 'submitted' : 'approved';
        if (existing.status !== expected) throw new ApiError(409, 'mrp_suggestion_transition_invalid', `MRP suggestion is ${existing.status}.`);
        if (action === 'approve' && existing.createdBy === context.membershipId) throw new ApiError(409, 'maker_checker_required', 'MRP suggestion maker cannot approve the same suggestion.');
        await this.assertRunFresh(db, legalEntityId, existing.mrpRun);

        let releasedResourceType = '';
        let releasedResourceId = '';
        const now = new Date();
        if (action === 'release') {
          const entity = await requireEntity(db, context, legalEntityId);
          const financialYear = await yearFor(db, legalEntityId, existing.orderOn);
          const planningSnapshot = structuredClone(existing.planningSnapshot) as JsonRecord;
          const bom = planningSnapshot.bom && typeof planningSnapshot.bom === 'object' && !Array.isArray(planningSnapshot.bom)
            ? planningSnapshot.bom as JsonRecord : {};
          if (existing.suggestionType === 'make') {
            const demandNumber = await allocateNumber(db, context, entity, financialYear, 'production:demand', 'PD');
            const demand = await db.erpProductionDemand.create({ data: {
              organizationId: context.organizationId, legalEntityId, financialYearId: financialYear.id, demandNumber,
              demandType: 'replenishment', itemId: existing.itemId, quantity: existing.quantity, uom: existing.uom,
              requiredOn: existing.requiredOn, bomSnapshot: json(bom),
              materialRequirements: json(bom.components ?? []), suggestions: json([{ mrpSuggestionId: existing.id, mrpRunId: existing.mrpRunId }]),
              originType: 'mrp', originMetadata: json({
                mrpRunId: existing.mrpRunId,
                mrpSuggestionId: existing.id,
                mesaerpControl: { makerMembershipId: context.membershipId },
              }),
              sourceSnapshotHash: existing.sourceSnapshotHash, createIdempotencyKey: `mrp-demand:${existing.id}`,
            } });
            releasedResourceType = 'production_demand'; releasedResourceId = demand.id;
          } else if (existing.suggestionType === 'purchase') {
            const documentNumber = await allocateNumber(db, context, entity, financialYear, 'document:purchase_requisition', 'PR');
            const preferredVendorId = typeof (planningSnapshot.policy as JsonRecord | undefined)?.preferredVendorId === 'string'
              ? String((planningSnapshot.policy as JsonRecord).preferredVendorId) : '';
            const document = await db.erpDocument.create({ data: {
              organizationId: context.organizationId, legalEntityId, financialYearId: financialYear.id,
              documentType: 'purchase_requisition', documentNumber, documentDate: existing.orderOn, dueDate: existing.requiredOn,
              status: 'draft', approvalState: 'not_required', partySnapshot: json({}), currency: entity.baseCurrency,
              exchangeRate: 1, subtotal: 0, taxTotal: 0, grandTotal: 0, baseCurrencyTotal: 0,
              taxSummary: json({}), terms: json([]), shipping: json({ destinationWarehouseId: existing.warehouseId }),
              originType: 'mrp', originMetadata: json({ mrpRunId: existing.mrpRunId, mrpSuggestionId: existing.id, preferredVendorId }),
              sourceSnapshotHash: existing.sourceSnapshotHash, createIdempotencyKey: `mrp-pr:${existing.id}`,
              requestHash: existing.sourceSnapshotHash, createdBy: context.membershipId,
            } });
            await db.erpDocumentLine.create({ data: {
              organizationId: context.organizationId, legalEntityId, documentId: document.id, lineNumber: 1, itemId: existing.itemId,
              description: existing.item.name, hsnSacCode: existing.item.hsnSacCode, quantity: existing.quantity, uom: existing.uom,
              unitPrice: 0, discountAmount: 0, taxableAmount: 0, taxRate: existing.item.gstRate, taxAmount: 0, lineTotal: 0,
              warehouseCode: existing.warehouse.code, promisedOn: existing.requiredOn,
              dimensions: json({ mrpSuggestionId: existing.id, preferredVendorId }),
            } });
            releasedResourceType = 'purchase_requisition'; releasedResourceId = document.id;
          } else if (existing.suggestionType === 'transfer') {
            if (!existing.sourceWarehouseId || !existing.sourceWarehouse) throw new ApiError(409, 'transfer_source_missing', 'Transfer suggestion has no valid source warehouse.');
            const proposalNumber = await allocateNumber(db, context, entity, financialYear, 'planning:transfer-proposal', 'TP');
            const proposal = await db.erpTransferProposal.create({ data: {
              organizationId: context.organizationId, legalEntityId, suggestionId: existing.id, proposalNumber,
              itemId: existing.itemId, fromWarehouseId: existing.sourceWarehouseId, toWarehouseId: existing.warehouseId,
              quantity: existing.quantity, uom: existing.uom, requiredOn: existing.requiredOn, status: 'draft',
              sourceSnapshotHash: existing.sourceSnapshotHash, createdBy: context.membershipId,
            } });
            releasedResourceType = 'transfer_proposal'; releasedResourceId = proposal.id;
          } else {
            throw new ApiError(409, 'mrp_suggestion_type_invalid', 'MRP suggestion has an unsupported type.');
          }
        }

        const changed = await db.erpMrpSuggestion.updateMany({
          where: { id: suggestionId, legalEntityId, status: expected, rowVersion: input.expectedRowVersion },
          data: action === 'submit'
            ? { status: 'submitted', submittedAt: now, rowVersion: { increment: 1 } }
            : action === 'approve'
              ? { status: 'approved', approvedAt: now, approvedBy: context.membershipId, rowVersion: { increment: 1 } }
              : { status: 'released', releasedAt: now, releasedBy: context.membershipId, releasedResourceType, releasedResourceId, rowVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'MRP suggestion changed while its lifecycle action was being saved.');
        const updated = await db.erpMrpSuggestion.findUniqueOrThrow({ where: { id: suggestionId } });
        const response = suggestionDto(updated);
        await audit(db, { action: `mesaerp.mrp_suggestion.${action}`, entity: 'ErpMrpSuggestion', entityId: suggestionId, before: suggestionDto(existing), after: response });
        await appendOutbox(db, context, legalEntityId, 'ErpMrpSuggestion', suggestionId, `mesaerp.mrp-suggestion.${action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : 'released'}.v1`, response);
        return response;
      },
    });
  }

  async listTransferProposals(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const rows = await db.erpTransferProposal.findMany({ where: { legalEntityId }, orderBy: [{ requiredOn: 'asc' }, { proposalNumber: 'asc' }], take: 500 });
      return rows.map(transferProposalDto);
    });
  }

  async getTransferProposal(legalEntityId: string, proposalId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      const row = await db.erpTransferProposal.findFirst({ where: { id: proposalId, legalEntityId } });
      if (!row) throw new ApiError(404, 'transfer_proposal_not_found', 'Transfer proposal not found in this company.');
      return transferProposalDto(row);
    });
  }

}
