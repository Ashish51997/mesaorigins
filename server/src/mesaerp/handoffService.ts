import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type ErpHandoffEventRoute,
  type ErpHandoffInboxEvent,
  type ErpHandoffMapping,
  type ErpItem,
  type ErpWarehouse,
} from '@prisma/client';
import { basePrisma, tenantTx } from '../db';
import { audit } from '../lib/audit';
import { canonicalHash } from '../lib/canonical';
import { tenantContext, type TenantCtx } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import { hasMesaErpPermission } from './access';
import { ensureDocumentPostingDraft, estimateIssueValue } from './inventoryPosting';
import type {
  HandoffAccept,
  HandoffEventRouteApprove,
  HandoffEventRouteCreate,
  HandoffMappingApprove,
  HandoffMappingCreate,
  HandoffMappingUpdate,
  HandoffReceive,
  HandoffReject,
  HandoffRetry,
} from './handoffTdsSchemas';

type Db = typeof basePrisma;
type JsonRecord = Record<string, unknown>;

const EVENT_TYPES = [
  'mesaops.production-actuals.submitted.v1',
  'mesaops.qa-disposition.recorded.v1',
  'mesaops.physical-dispatch.completed.v1',
] as const;

function actor(): TenantCtx {
  const current = tenantContext.getStore();
  if (!current) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return current;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function array(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function day(value: unknown): string {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ApiError(422, 'handoff_business_date_invalid', 'The event business date is not a valid ISO date.');
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new ApiError(422, 'handoff_business_date_invalid', 'The event business date is not a valid calendar date.');
  }
  return text;
}

function decimal(value: unknown, subject: string, positive = false): Prisma.Decimal {
  try {
    const result = new Prisma.Decimal(String(value ?? '')).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
    if (result.isNegative() || (positive && !result.greaterThan(0))) throw new Error('range');
    return result;
  } catch {
    throw new ApiError(422, 'handoff_decimal_invalid', `${subject} must be a ${positive ? 'positive ' : ''}Decimal string.`);
  }
}

function money(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function rate(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
}

function sum(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));
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
  try { return await once(); } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    return tenantTx(async (db) => {
      const existing = await replay<T>(db, context.organizationId, input.scope, input.key, requestHash);
      if (existing) return existing;
      throw error;
    });
  }
}

function mappingDto(row: ErpHandoffMapping) {
  return {
    ...row,
    sourceEvidence: structuredClone(row.sourceEvidence),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mappingProposal(input: Pick<ErpHandoffMapping,
  'mappingType' | 'sourceKey' | 'targetId' | 'targetValue' | 'sourceEvidence' | 'requestedActive'
>) {
  return {
    version: 1,
    mappingType: input.mappingType,
    sourceKey: input.sourceKey,
    targetId: input.targetId,
    targetValue: input.targetValue,
    sourceEvidence: structuredClone(input.sourceEvidence),
    requestedActive: input.requestedActive,
  };
}

function inboxDto(row: ErpHandoffInboxEvent) {
  return {
    ...row,
    payload: structuredClone(row.payload),
    exceptionDetails: structuredClone(row.exceptionDetails),
    createdArtifacts: structuredClone(row.createdArtifacts),
    occurredAt: row.occurredAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function eventRouteDto(row: ErpHandoffEventRoute) {
  return {
    ...row,
    routingEvidence: structuredClone(row.routingEvidence),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface Envelope {
  eventId: string;
  eventType: typeof EVENT_TYPES[number];
  schemaVersion: number;
  organizationId: string;
  legalEntityId: string | null;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  occurredAt: string;
  sourceSnapshotHash: string;
  sourceLink: JsonRecord | null;
  snapshot: JsonRecord;
}

function parseEnvelope(value: unknown): Envelope {
  const wrapper = record(value);
  const eventType = String(wrapper.eventType ?? '') as Envelope['eventType'];
  const snapshot = record(wrapper.snapshot);
  if (
    typeof wrapper.eventId !== 'string'
    || !EVENT_TYPES.includes(eventType)
    || wrapper.schemaVersion !== 1
    || typeof wrapper.organizationId !== 'string'
    || (wrapper.legalEntityId !== null && typeof wrapper.legalEntityId !== 'string')
    || typeof wrapper.aggregateType !== 'string'
    || typeof wrapper.aggregateId !== 'string'
    || typeof wrapper.correlationId !== 'string'
    || typeof wrapper.occurredAt !== 'string'
    || typeof wrapper.sourceSnapshotHash !== 'string'
    || Object.keys(snapshot).length === 0
  ) {
    throw new ApiError(409, 'handoff_payload_invalid', 'The durable MesaOps event does not match handoff schema version 1.');
  }
  return {
    eventId: wrapper.eventId,
    eventType,
    schemaVersion: 1,
    organizationId: wrapper.organizationId,
    legalEntityId: wrapper.legalEntityId as string | null,
    aggregateType: wrapper.aggregateType,
    aggregateId: wrapper.aggregateId,
    correlationId: wrapper.correlationId,
    occurredAt: wrapper.occurredAt,
    sourceSnapshotHash: wrapper.sourceSnapshotHash,
    sourceLink: wrapper.sourceLink === null ? null : record(wrapper.sourceLink),
    snapshot,
  };
}

function assertEnvelopeIntegrity(event: {
  id: string;
  organizationId: string;
  legalEntityId: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  schemaVersion: number;
  correlationId: string;
  occurredAt: Date;
  payload: Prisma.JsonValue;
  payloadHash: string;
}, legalEntityId: string, explicitlyRouted = false): Envelope {
  if (canonicalHash(event.payload) !== event.payloadHash) throw new ApiError(409, 'handoff_payload_hash_mismatch', 'The stored event payload failed its SHA-256 integrity check.');
  const envelope = parseEnvelope(event.payload);
  if (
    envelope.eventId !== event.id
    || envelope.organizationId !== event.organizationId
    || envelope.legalEntityId !== event.legalEntityId
    || (event.legalEntityId !== legalEntityId && !(explicitlyRouted && event.legalEntityId === null))
    || envelope.aggregateType !== event.aggregateType
    || envelope.aggregateId !== event.aggregateId
    || envelope.eventType !== event.eventType
    || envelope.schemaVersion !== event.schemaVersion
    || envelope.correlationId !== event.correlationId
    || envelope.occurredAt !== event.occurredAt.toISOString()
  ) throw new ApiError(409, 'handoff_event_identity_mismatch', 'The MesaOps event wrapper does not match its durable outbox identity.');
  if (canonicalHash(envelope.snapshot) !== envelope.sourceSnapshotHash) {
    throw new ApiError(409, 'handoff_source_hash_mismatch', 'The MesaOps source snapshot failed its immutable hash check.');
  }
  return envelope;
}

async function appendAcceptedOutbox(db: Db, context: TenantCtx, legalEntityId: string, inbox: ErpHandoffInboxEvent, artifacts: unknown) {
  const eventId = randomUUID();
  const payload = {
    eventId,
    sourceEventId: inbox.sourceEventId,
    sourcePayloadHash: inbox.payloadHash,
    handoffInboxId: inbox.id,
    legalEntityId,
    artifacts,
  };
  await db.integrationOutboxEvent.create({
    data: {
      id: eventId,
      organizationId: context.organizationId,
      legalEntityId,
      serviceId: 'mesaerp',
      aggregateType: 'ErpHandoffInboxEvent',
      aggregateId: inbox.id,
      eventType: 'mesaerp.handoff.accepted.v1',
      schemaVersion: 1,
      correlationId: inbox.correlationId,
      causationId: inbox.sourceEventId,
      payload: json(payload),
      payloadHash: canonicalHash(payload),
    },
  });
}

async function validateMappingTarget(db: Db, legalEntityId: string, mappingType: string, targetId: string, targetValue: string) {
  if (mappingType === 'uom') {
    if (!normalized(targetValue)) throw new ApiError(422, 'handoff_uom_mapping_invalid', 'A UOM mapping requires a target UOM value.');
    return { targetId: '', targetValue: normalized(targetValue) };
  }
  const delegates = {
    item: db.erpItem,
    warehouse: db.erpWarehouse,
    customer: db.erpCustomer,
  } as const;
  const delegate = delegates[mappingType as keyof typeof delegates];
  if (!delegate) throw new ApiError(422, 'handoff_mapping_type_invalid', 'Unsupported handoff mapping type.');
  const row = await (delegate as unknown as { findFirst(args: unknown): Promise<{ id: string } | null> }).findFirst({
    where: { id: targetId, legalEntityId, ...(mappingType !== 'customer' ? { active: true } : { status: 'active' }) },
  });
  if (!row) throw new ApiError(422, 'handoff_mapping_target_invalid', `The mapped ${mappingType} is not active in this company.`);
  return { targetId: row.id, targetValue: targetValue.trim() };
}

interface ResolvedMaps {
  itemBySource: Map<string, ErpItem>;
  uomBySource: Map<string, string>;
  warehouseBySource: Map<string, ErpWarehouse>;
  customerBySource: Map<string, { id: string; customerCode: string; legalName: string }>;
}

async function resolveMappings(db: Db, legalEntityId: string, snapshot: JsonRecord): Promise<ResolvedMaps> {
  const itemKeys = [...new Set([
    ...array(snapshot.materialConsumption), ...array(snapshot.materialReturns), ...array(snapshot.outputs),
    ...array(snapshot.scrap), ...array(snapshot.byproducts),
  ].map((line) => normalized(line.itemCode)).filter(Boolean))];
  const headerProductCode = normalized(snapshot.productCode);
  if (headerProductCode && !itemKeys.includes(headerProductCode)) itemKeys.push(headerProductCode);
  const uomKeys = [...new Set([
    ...array(snapshot.materialConsumption), ...array(snapshot.materialReturns), ...array(snapshot.outputs),
    ...array(snapshot.scrap), ...array(snapshot.byproducts),
  ].map((line) => normalized(line.uom)).filter(Boolean))];
  if (snapshot.uom) uomKeys.push(normalized(snapshot.uom));
  const warehouseKeys = [...new Set([normalized(snapshot.plantCode), normalized(snapshot.warehouseSource)].filter(Boolean))];
  const customerKeys = [...new Set([normalized(snapshot.customerReference)].filter(Boolean))];
  const allKeys = [...itemKeys, ...uomKeys, ...warehouseKeys, ...customerKeys];
  const rows = await db.erpHandoffMapping.findMany({
    where: { legalEntityId, active: true, sourceKey: { in: allKeys } },
  });
  const byTypeKey = new Map(rows.map((row) => [`${row.mappingType}:${row.sourceKey}`, row]));
  const missing: Array<{ mappingType: string; sourceKey: string }> = [];
  const itemMappings = itemKeys.map((key) => {
    const row = byTypeKey.get(`item:${key}`); if (!row) missing.push({ mappingType: 'item', sourceKey: key }); return row;
  }).filter(Boolean) as ErpHandoffMapping[];
  const uomMappings = uomKeys.map((key) => {
    const row = byTypeKey.get(`uom:${key}`); if (!row) missing.push({ mappingType: 'uom', sourceKey: key }); return row;
  }).filter(Boolean) as ErpHandoffMapping[];
  const warehouseMappings = warehouseKeys.map((key) => {
    const row = byTypeKey.get(`warehouse:${key}`); if (!row) missing.push({ mappingType: 'warehouse', sourceKey: key }); return row;
  }).filter(Boolean) as ErpHandoffMapping[];
  const customerMappings = customerKeys.map((key) => {
    const row = byTypeKey.get(`customer:${key}`); if (!row) missing.push({ mappingType: 'customer', sourceKey: key }); return row;
  }).filter(Boolean) as ErpHandoffMapping[];
  if (missing.length) throw new ApiError(422, 'handoff_mapping_missing', 'One or more MesaOps master values are not mapped.', missing);
  const [items, warehouses, customers] = await Promise.all([
    db.erpItem.findMany({ where: { legalEntityId, active: true, id: { in: itemMappings.map((mapping) => mapping.targetId) } } }),
    db.erpWarehouse.findMany({ where: { legalEntityId, active: true, id: { in: warehouseMappings.map((mapping) => mapping.targetId) } } }),
    db.erpCustomer.findMany({ where: { legalEntityId, status: 'active', id: { in: customerMappings.map((mapping) => mapping.targetId) } } }),
  ]);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  if (
    itemMappings.some((mapping) => !itemById.has(mapping.targetId))
    || warehouseMappings.some((mapping) => !warehouseById.has(mapping.targetId))
    || customerMappings.some((mapping) => !customerById.has(mapping.targetId))
  ) {
    throw new ApiError(422, 'handoff_mapping_target_invalid', 'A handoff mapping points to an inactive or cross-company master.');
  }
  const itemBySource = new Map(itemMappings.map((mapping) => [mapping.sourceKey, itemById.get(mapping.targetId)!]));
  const uomBySource = new Map(uomMappings.map((mapping) => [mapping.sourceKey, normalized(mapping.targetValue)]));
  const warehouseBySource = new Map(warehouseMappings.map((mapping) => [mapping.sourceKey, warehouseById.get(mapping.targetId)!]));
  const customerBySource = new Map(customerMappings.map((mapping) => [mapping.sourceKey, customerById.get(mapping.targetId)!]));
  for (const sourceItem of itemKeys) {
    const item = itemBySource.get(sourceItem)!;
    for (const line of [
      ...array(snapshot.materialConsumption), ...array(snapshot.materialReturns), ...array(snapshot.outputs),
      ...array(snapshot.scrap), ...array(snapshot.byproducts),
    ].filter((candidate) => normalized(candidate.itemCode) === sourceItem)) {
      const mappedUom = uomBySource.get(normalized(line.uom));
      const conversions = array(item.uomConversions).map((entry) => normalized(entry.uom));
      if (!mappedUom || (mappedUom !== normalized(item.baseUom) && !conversions.includes(mappedUom))) {
        throw new ApiError(422, 'handoff_uom_mapping_invalid', `${sourceItem} cannot use mapped UOM ${mappedUom || '(missing)'}.`);
      }
    }
  }
  return { itemBySource, uomBySource, warehouseBySource, customerBySource };
}

function rateMap(input: HandoffAccept): Map<string, Prisma.Decimal> {
  return new Map(input.costRates.map((entry) => [`${entry.kind}:${normalized(entry.reference)}`, rate(entry.rate)]));
}

async function effectiveQaDisposition(db: Db, legalEntityId: string, operationalOrderId: string, outputLines: JsonRecord[]) {
  const requiredLots = [...new Set(outputLines.flatMap((line) => array(line.lots).map((lot) => String(lot.lotNumber ?? '').trim()).filter(Boolean)))];
  const evidence = await db.erpPlantQaEvidence.findMany({
    where: { legalEntityId, operationalOrderId, ...(requiredLots.length ? { lotNumber: { in: requiredLots } } : {}) },
    orderBy: { acceptedAt: 'asc' },
  });
  if (!evidence.length) return { status: 'pending', reference: '', notes: 'Awaiting accepted MesaOps QA evidence.' };
  const byLot = new Map(evidence.map((row) => [row.lotNumber, row]));
  const considered = requiredLots.length ? requiredLots.map((lot) => byLot.get(lot)).filter(Boolean) : evidence;
  if (requiredLots.length && considered.length !== requiredLots.length) return { status: 'pending', reference: '', notes: 'QA evidence is missing for one or more output lots.' };
  if (considered.some((row) => row!.disposition === 'rejected')) return { status: 'rejected', reference: considered.map((row) => row!.inspectionId).join(','), notes: 'MesaOps rejected one or more output lots.' };
  if (considered.some((row) => row!.disposition === 'hold')) return { status: 'hold', reference: considered.map((row) => row!.inspectionId).join(','), notes: 'MesaOps placed one or more output lots on hold.' };
  return { status: 'accepted', reference: considered.map((row) => row!.inspectionId).join(','), notes: 'Accepted from immutable MesaOps QA evidence.' };
}

async function financialYearFor(db: Db, legalEntityId: string, businessDate: string) {
  const date = new Date(`${businessDate}T00:00:00.000Z`);
  const year = await db.financialYear.findFirst({ where: { legalEntityId, startsOn: { lte: date }, endsOn: { gte: date } } });
  if (!year) throw new ApiError(409, 'financial_year_missing', 'No financial year covers the MesaOps business date.');
  return year;
}

async function createExecutionArtifacts(db: Db, context: TenantCtx, legalEntityId: string, inbox: ErpHandoffInboxEvent, envelope: Envelope, input: HandoffAccept) {
  const snapshot = envelope.snapshot;
  const businessDate = day(snapshot.businessDate);
  const year = await financialYearFor(db, legalEntityId, businessDate);
  const maps = await resolveMappings(db, legalEntityId, snapshot);
  const warehouse = maps.warehouseBySource.get(normalized(snapshot.plantCode));
  if (!warehouse) throw new ApiError(422, 'handoff_warehouse_mapping_missing', 'The production plant is not mapped to an ERP warehouse.');
  const costRates = rateMap(input);
  const batchNumber = String(snapshot.batchNumber ?? '').trim();
  if (!batchNumber) throw new ApiError(422, 'handoff_batch_missing', 'Production actuals require a batch number.');
  const operationalOrderId = String(snapshot.operationalOrderId ?? '');
  const outputSource = [...array(snapshot.outputs), ...array(snapshot.scrap), ...array(snapshot.byproducts)];
  if (!outputSource.length) throw new ApiError(422, 'handoff_output_missing', 'Production actuals require at least one output, scrap or by-product line.');

  let productionDemandId = input.productionDemandId;
  const sourceLink = envelope.sourceLink ?? {};
  const linkedProductionDemandId = sourceLink.sourceService === 'mesaerp' && sourceLink.sourceType === 'ProductionDemand'
    ? String(sourceLink.sourceId ?? '')
    : '';
  if (productionDemandId && linkedProductionDemandId && productionDemandId !== linkedProductionDemandId) {
    throw new ApiError(409, 'handoff_production_demand_source_conflict', 'The selected production demand differs from the immutable MesaERP source link.');
  }
  if (!productionDemandId && linkedProductionDemandId) productionDemandId = linkedProductionDemandId;
  if (productionDemandId) {
    const demand = await db.erpProductionDemand.findFirst({ where: { id: productionDemandId, legalEntityId } });
    if (!demand) throw new ApiError(422, 'handoff_production_demand_invalid', 'The linked production demand is not in this company.');
    if (!['released', 'partially_completed'].includes(demand.status)) throw new ApiError(409, 'handoff_production_demand_not_open', 'The linked production demand is not released for completion.');
    if (linkedProductionDemandId && demand.sourceSnapshotHash && sourceLink.sourceSnapshotHash !== demand.sourceSnapshotHash) {
      throw new ApiError(409, 'handoff_production_demand_snapshot_stale', 'The MesaOps source link no longer matches the released production-demand snapshot.');
    }
    const finishedOutputs = array(snapshot.outputs).filter((line) => !line.outputType || line.outputType === 'finished_good');
    const finishedMappings = finishedOutputs.map((line) => ({
      item: maps.itemBySource.get(normalized(line.itemCode)),
      uom: maps.uomBySource.get(normalized(line.uom)),
    }));
    if (!finishedMappings.length || finishedMappings.some((line) => !line.item || !line.uom)
      || finishedMappings.some((line) => line.item!.id !== demand.itemId || line.uom !== normalized(demand.uom))) {
      throw new ApiError(422, 'handoff_production_demand_output_mismatch', 'Finished output item and UOM must match the linked production demand.');
    }
  }

  const materialLines = [] as Array<JsonRecord>;
  for (const source of array(snapshot.materialConsumption)) {
    const sourceItemCode = normalized(source.itemCode);
    const item = maps.itemBySource.get(sourceItemCode)!;
    const mappedUom = maps.uomBySource.get(normalized(source.uom))!;
    const quantity = decimal(source.quantity, `Consumption quantity for ${sourceItemCode}`, true);
    const batch = String(source.lotNumber ?? batchNumber);
    const value = await estimateIssueValue(db, legalEntityId, businessDate, {
      itemId: item.id, warehouseId: warehouse.id, quantity: quantity.toString(), uom: mappedUom, batchNumber: batch,
    });
    const unitRate = rate(value.dividedBy(quantity));
    materialLines.push({
      itemId: item.id, description: String(source.description ?? item.name), quantity: quantity.toString(),
      uom: mappedUom, rate: unitRate.toString(), amount: money(value).toString(), warehouseCode: warehouse.code,
      batchNumber: batch, dimensions: { mesaOpsItemCode: sourceItemCode, mesaOpsLotNumber: String(source.lotNumber ?? '') },
    });
  }
  const outputLines = outputSource.map((source) => {
    const sourceItemCode = normalized(source.itemCode);
    const item = maps.itemBySource.get(sourceItemCode)!;
    const outputType = source.outputType === 'finished_good'
      ? 'finished_good'
      : array(snapshot.scrap).includes(source) || source.kind ? 'scrap' : 'by_product';
    return {
      itemId: item.id,
      description: String(source.description ?? item.name),
      quantity: decimal(source.quantity, `Output quantity for ${sourceItemCode}`, true).toString(),
      uom: maps.uomBySource.get(normalized(source.uom))!,
      warehouseCode: warehouse.code,
      batchNumber,
      outputType,
      dimensions: { mesaOpsItemCode: sourceItemCode, lots: structuredClone(source.lots ?? []) },
    };
  });
  const valuedActual = (kind: 'labor' | 'machine', source: JsonRecord) => {
    const reference = normalized(source.reference || source.description);
    const quantity = decimal(source.quantity, `${kind} quantity ${reference}`, true);
    const lineRate = costRates.get(`${kind}:${reference}`) ?? new Prisma.Decimal(0);
    return {
      description: String(source.description ?? source.reference ?? kind),
      quantity: quantity.toString(),
      uom: normalized(source.uom) || 'UNIT',
      rate: lineRate.toString(),
      amount: money(quantity.times(lineRate)).toString(),
      warehouseCode: '', batchNumber, dimensions: { mesaOpsReference: reference, readings: structuredClone(source.readings ?? {}) },
    };
  };
  const laborLines = array(snapshot.laborActuals).map((source) => valuedActual('labor', source));
  const resourceLines = array(snapshot.machineActuals).map((source) => valuedActual('machine', source));
  const recoveryCredits = [...array(snapshot.scrap), ...array(snapshot.byproducts)].flatMap((source) => {
    const reference = normalized(source.itemCode);
    const recoveryRate = costRates.get(`recovery:${reference}`);
    if (!recoveryRate || recoveryRate.isZero()) return [];
    const quantity = decimal(source.quantity, `Recovery quantity for ${reference}`, true);
    const item = maps.itemBySource.get(reference)!;
    return [{
      itemId: item.id, description: `Recovery credit · ${String(source.description ?? item.name)}`,
      quantity: quantity.toString(), uom: maps.uomBySource.get(normalized(source.uom))!, rate: recoveryRate.toString(),
      amount: money(quantity.times(recoveryRate)).toString(), warehouseCode: warehouse.code, batchNumber, dimensions: { mesaOpsItemCode: reference },
    }];
  });
  const qaDisposition = await effectiveQaDisposition(db, legalEntityId, operationalOrderId, outputSource);
  const materialValue = money(sum(materialLines.map((line) => new Prisma.Decimal(String(line.amount)))));
  const conversionValue = money(sum([...laborLines, ...resourceLines].map((line) => new Prisma.Decimal(String(line.amount)))));
  const recoveryValue = money(sum(recoveryCredits.map((line) => new Prisma.Decimal(String(line.amount)))));
  const actualCost = money(materialValue.plus(conversionValue).minus(recoveryValue));
  if (actualCost.isNegative()) throw new ApiError(422, 'handoff_negative_actual_cost', 'Recovery credits cannot make the draft actual cost negative.');
  const originMetadata = {
    mesaerpControl: { makerMembershipId: context.membershipId },
    handoffInboxId: inbox.id,
    sourceEventId: inbox.sourceEventId,
    sourcePayloadHash: inbox.payloadHash,
    operationalOrderId,
    productionPlanId: String(snapshot.productionPlanId ?? ''),
    packingEvidence: structuredClone(snapshot.packingEvidence ?? {}),
    scrapEvidence: structuredClone(snapshot.scrap ?? []),
    byproductEvidence: structuredClone(snapshot.byproducts ?? []),
    notes: input.notes,
  };
  const returns = array(snapshot.materialReturns);
  const returnLines = returns.map((source) => {
    const sourceItemCode = normalized(source.itemCode);
    const item = maps.itemBySource.get(sourceItemCode)!;
    const quantity = decimal(source.quantity, `Return quantity for ${sourceItemCode}`, true);
    const returnRate = costRates.get(`material_return:${sourceItemCode}`);
    if (!returnRate || !returnRate.greaterThan(0)) throw new ApiError(422, 'handoff_return_rate_missing', `Material return ${sourceItemCode} requires an explicit immutable rate.`);
    return {
      itemId: item.id, description: String(source.description ?? item.name), quantity: quantity.toString(),
      uom: maps.uomBySource.get(normalized(source.uom))!, rate: returnRate.toString(), amount: money(quantity.times(returnRate)).toString(),
      warehouseCode: warehouse.code, batchNumber: String(source.lotNumber ?? batchNumber), dimensions: { mesaOpsItemCode: sourceItemCode },
    };
  });
  const returnValue = money(sum(returnLines.map((line) => new Prisma.Decimal(line.amount))));
  const returnVoucherIds: string[] = [];
  if (returnLines.length) {
    const returned = await db.erpManufacturingVoucher.create({
      data: {
        organizationId: context.organizationId, legalEntityId, financialYearId: year.id,
        productionDemandId: productionDemandId || null,
        voucherNumber: `OPS-RET-${inbox.sourceEventId}`, voucherType: 'return',
        businessDate: new Date(`${businessDate}T00:00:00.000Z`), batchNumber,
        materialLines: json(returnLines), outputLines: [], laborLines: [], resourceLines: [], overheadLines: [], subcontractLines: [], recoveryCredits: [],
        qaDisposition: { status: 'not_applicable', reference: inbox.sourceEventId, notes: 'Material return from accepted MesaOps evidence.' },
        materialValue: returnValue, conversionValue: 0, recoveryValue: 0, actualCost: returnValue,
        originType: 'mesaops_snapshot', originMetadata: json(originMetadata), sourceSnapshotHash: envelope.sourceSnapshotHash,
        createIdempotencyKey: `handoff:${inbox.sourceEventId}:return`,
      },
    });
    returnVoucherIds.push(returned.id);
  }
  const completion = await db.erpManufacturingVoucher.create({
    data: {
      organizationId: context.organizationId,
      legalEntityId,
      financialYearId: year.id,
      productionDemandId: productionDemandId || null,
      voucherNumber: `OPS-CMP-${inbox.sourceEventId}`,
      voucherType: 'completion',
      businessDate: new Date(`${businessDate}T00:00:00.000Z`),
      batchNumber,
      materialLines: json(materialLines),
      outputLines: json(outputLines),
      laborLines: json(laborLines),
      resourceLines: json(resourceLines),
      overheadLines: [],
      subcontractLines: [],
      recoveryCredits: json(recoveryCredits),
      qaDisposition: json(qaDisposition),
      materialValue,
      conversionValue,
      recoveryValue,
      actualCost,
      originType: 'mesaops_snapshot',
      originMetadata: json(originMetadata),
      sourceSnapshotHash: envelope.sourceSnapshotHash,
      createIdempotencyKey: `handoff:${inbox.sourceEventId}:completion`,
    },
  });
  await audit(db, {
    action: 'mesaerp.handoff.execution.accept', entity: 'ErpHandoffInboxEvent', entityId: inbox.id,
    after: { sourceEventId: inbox.sourceEventId, manufacturingVoucherId: completion.id, returnVoucherIds },
  });
  return { kind: 'manufacturing_draft', manufacturingVoucherIds: [completion.id], returnVoucherIds };
}

async function refreshDraftQa(db: Db, legalEntityId: string, operationalOrderId: string) {
  const executions = await db.erpHandoffInboxEvent.findMany({
    where: { legalEntityId, eventType: 'mesaops.production-actuals.submitted.v1', state: 'accepted' },
    orderBy: { occurredAt: 'desc' }, take: 500,
  });
  for (const execution of executions) {
    const envelope = parseEnvelope(execution.payload);
    if (String(envelope.snapshot.operationalOrderId ?? '') !== operationalOrderId) continue;
    const artifacts = record(execution.createdArtifacts);
    const voucherIds = Array.isArray(artifacts.manufacturingVoucherIds)
      ? artifacts.manufacturingVoucherIds.filter((value): value is string => typeof value === 'string')
      : [];
    const disposition = await effectiveQaDisposition(db, legalEntityId, operationalOrderId, array(envelope.snapshot.outputs));
    for (const voucherId of voucherIds) {
      const voucher = await db.erpManufacturingVoucher.findFirst({ where: { id: voucherId, legalEntityId, status: 'draft' } });
      if (!voucher) continue;
      await db.erpManufacturingVoucher.update({ where: { id: voucher.id }, data: { qaDisposition: json(disposition), rowVersion: { increment: 1 } } });
    }
  }
}

async function createQaEvidence(db: Db, context: TenantCtx, legalEntityId: string, inbox: ErpHandoffInboxEvent, envelope: Envelope) {
  const snapshot = envelope.snapshot;
  const disposition = String(snapshot.disposition ?? '');
  if (!['accepted', 'hold', 'rejected'].includes(disposition)) throw new ApiError(422, 'handoff_qa_disposition_invalid', 'QA disposition must be accepted, hold or rejected.');
  const evidence = await db.erpPlantQaEvidence.create({
    data: {
      organizationId: context.organizationId,
      legalEntityId,
      handoffInboxEventId: inbox.id,
      inspectionId: String(snapshot.inspectionId ?? envelope.aggregateId),
      operationalOrderId: String(snapshot.operationalOrderId ?? ''),
      productionPlanId: String(snapshot.productionPlanId ?? ''),
      logbookId: String(snapshot.logbookId ?? ''),
      productCode: normalized(snapshot.productCode),
      lotNumber: String(snapshot.lotNumber ?? ''),
      quantity: decimal(snapshot.quantity, 'QA quantity'),
      uom: normalized(snapshot.uom),
      disposition,
      businessDate: new Date(`${day(snapshot.businessDate)}T00:00:00.000Z`),
      evidenceSnapshot: json(snapshot),
      evidenceHash: envelope.sourceSnapshotHash,
      acceptedBy: context.membershipId,
    },
  });
  await refreshDraftQa(db, legalEntityId, evidence.operationalOrderId);
  await audit(db, { action: 'mesaerp.handoff.qa.accept', entity: 'ErpPlantQaEvidence', entityId: evidence.id, after: { inspectionId: evidence.inspectionId, disposition } });
  return { kind: 'qa_evidence', qaEvidenceId: evidence.id };
}

async function createDispatchEvidence(db: Db, context: TenantCtx, legalEntityId: string, inbox: ErpHandoffInboxEvent, envelope: Envelope) {
  const snapshot = envelope.snapshot;
  const maps = await resolveMappings(db, legalEntityId, snapshot);
  const item = maps.itemBySource.get(normalized(snapshot.productCode));
  const warehouse = maps.warehouseBySource.get(normalized(snapshot.warehouseSource || snapshot.plantCode));
  const customer = maps.customerBySource.get(normalized(snapshot.customerReference));
  if (!item || !warehouse || !customer) throw new ApiError(422, 'handoff_dispatch_mapping_missing', 'Dispatch requires item, source warehouse and customer mappings.');
  const mappedUom = maps.uomBySource.get(normalized(snapshot.uom));
  if (!mappedUom) throw new ApiError(422, 'handoff_uom_mapping_missing', 'Dispatch UOM is not mapped.');
  const invoiceReference = String(snapshot.invoiceReference ?? '');
  const candidateInvoice = invoiceReference ? await db.erpDocument.findFirst({
    where: { legalEntityId, documentType: 'sales_invoice', documentNumber: invoiceReference },
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
  }) : null;
  if (candidateInvoice?.customerId && candidateInvoice.customerId !== customer.id) {
    throw new ApiError(409, 'handoff_dispatch_customer_conflict', 'The physical dispatch customer differs from the linked sales invoice.');
  }
  const sourceLink = envelope.sourceLink ?? {};
  let linkedDemand: Awaited<ReturnType<typeof db.erpProductionDemand.findFirst>> = null;
  if (sourceLink.sourceService === 'mesaerp' && sourceLink.sourceType === 'ProductionDemand' && sourceLink.sourceId) {
    linkedDemand = await db.erpProductionDemand.findFirst({ where: { id: String(sourceLink.sourceId), legalEntityId } });
    if (!linkedDemand) throw new ApiError(422, 'handoff_dispatch_demand_invalid', 'The dispatch source production demand is not in this company.');
    if (linkedDemand.sourceSnapshotHash && sourceLink.sourceSnapshotHash !== linkedDemand.sourceSnapshotHash) {
      throw new ApiError(409, 'handoff_dispatch_demand_snapshot_stale', 'The dispatch source link no longer matches the released production-demand snapshot.');
    }
    if (linkedDemand.itemId !== item.id || normalized(linkedDemand.uom) !== mappedUom) {
      throw new ApiError(422, 'handoff_dispatch_demand_item_mismatch', 'The dispatched item and UOM differ from the linked production demand.');
    }
  }

  let salesInvoice = null as typeof candidateInvoice;
  if (candidateInvoice) {
    const demandMetadata = linkedDemand ? record(linkedDemand.originMetadata) : {};
    const sourceOrderSnapshot = record(demandMetadata.sourceOrderSnapshot);
    const sourceSalesOrderId = typeof sourceOrderSnapshot.salesOrderId === 'string' ? sourceOrderSnapshot.salesOrderId : '';
    const sourceLineId = typeof sourceOrderSnapshot.sourceLineId === 'string' ? sourceOrderSnapshot.sourceLineId : '';
    const invoiceOrigin = record(candidateInvoice.originMetadata);
    const explicitOperationalOrderId = typeof invoiceOrigin.operationalOrderId === 'string' ? invoiceOrigin.operationalOrderId : '';
    const hasExactSalesOrderLink = sourceSalesOrderId && sourceLineId
      ? Boolean(await db.erpDocumentLink.findFirst({
          where: {
            legalEntityId,
            fromDocumentId: sourceSalesOrderId,
            toDocumentId: candidateInvoice.id,
            relationship: 'sales_order_to_sales_invoice',
          },
          select: { id: true },
        })) && candidateInvoice.lines.some((line) => line.sourceLineId === sourceLineId && line.itemId === item.id && normalized(line.uom) === mappedUom)
      : false;
    const hasExplicitOperationalOrderLink = explicitOperationalOrderId
      && explicitOperationalOrderId === String(snapshot.operationalOrderId ?? '');
    if (hasExactSalesOrderLink || hasExplicitOperationalOrderLink) {
      const eligibleLines = candidateInvoice.lines.filter((line) => line.itemId === item.id && normalized(line.uom) === mappedUom
        && (!sourceLineId || line.sourceLineId === sourceLineId));
      if (!eligibleLines.length) throw new ApiError(409, 'handoff_dispatch_invoice_line_mismatch', 'The linked invoice has no matching item and UOM line for this dispatch.');
      const invoicedQuantity = sum(eligibleLines.map((line) => line.quantity));
      await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.organizationId}:${legalEntityId}:${candidateInvoice.id}:${item.id}:${mappedUom}:dispatch-cap`}, 0))`);
      const previouslyAccepted = await db.erpPlantDispatchEvidence.aggregate({
        where: { legalEntityId, salesInvoiceId: candidateInvoice.id, itemId: item.id, uom: mappedUom },
        _sum: { quantity: true },
      });
      const dispatchedQuantity = decimal(snapshot.quantity, 'Dispatch quantity', true);
      if (new Prisma.Decimal(previouslyAccepted._sum.quantity ?? 0).plus(dispatchedQuantity).greaterThan(invoicedQuantity)) {
        throw new ApiError(409, 'handoff_dispatch_invoice_quantity_exceeded', 'Accepted dispatch quantity exceeds the exact linked invoice line quantity.');
      }
      salesInvoice = candidateInvoice;
    }
  }
  const evidence = await db.erpPlantDispatchEvidence.create({
    data: {
      organizationId: context.organizationId,
      legalEntityId,
      handoffInboxEventId: inbox.id,
      sourceDispatchId: String(snapshot.dispatchId ?? envelope.aggregateId),
      operationalOrderId: String(snapshot.operationalOrderId ?? ''),
      itemId: item.id,
      warehouseId: warehouse.id,
      customerId: customer.id,
      salesInvoiceId: salesInvoice?.id ?? null,
      businessDate: new Date(`${day(snapshot.businessDate)}T00:00:00.000Z`),
      quantity: decimal(snapshot.quantity, 'Dispatch quantity', true),
      uom: mappedUom,
      invoiceReference,
      gatePassNumber: String(snapshot.gatePassNumber ?? ''),
      vehicleNumber: String(snapshot.vehicleNumber ?? ''),
      evidenceSnapshot: json(snapshot),
      evidenceHash: envelope.sourceSnapshotHash,
      acceptedBy: context.membershipId,
    },
  });
  let posting = salesInvoice ? await db.erpPostingLink.findFirst({
    where: { legalEntityId, sourceType: 'sales_invoice', sourceId: salesInvoice.id },
    include: { voucher: true },
  }) : null;
  if (salesInvoice?.status === 'approved' && !posting) {
    await ensureDocumentPostingDraft(db, context, salesInvoice);
    posting = await db.erpPostingLink.findFirst({
      where: { legalEntityId, sourceType: 'sales_invoice', sourceId: salesInvoice.id },
      include: { voucher: true },
    });
  }
  const financialPostingState = posting?.voucher.status === 'posted'
    ? 'posted'
    : posting
      ? 'draft_requires_maker_checker_posting'
      : salesInvoice
        ? 'invoice_requires_approval'
        : 'invoice_match_required';
  await audit(db, {
    action: 'mesaerp.handoff.dispatch.accept', entity: 'ErpPlantDispatchEvidence', entityId: evidence.id,
    after: {
      sourceDispatchId: evidence.sourceDispatchId, salesInvoiceId: evidence.salesInvoiceId,
      financialPostingState, postingVoucherId: posting?.voucherId ?? null,
      duplicateStockOrCogsCreatedByHandoff: false,
    },
  });
  return {
    kind: 'physical_dispatch_evidence', dispatchEvidenceId: evidence.id,
    salesInvoiceId: salesInvoice?.id ?? null, postingVoucherId: posting?.voucherId ?? null,
    financialPostingState,
    stockAndCogsPolicy: posting?.voucher.status === 'posted'
      ? 'already_posted_once_from_sales_invoice'
      : 'explicit_financial_posting_required',
    stockMovementCreatedByHandoff: false,
    cogsCreatedByHandoff: false,
  };
}

async function markReceipt(db: Db, context: TenantCtx, legalEntityId: string, inbox: ErpHandoffInboxEvent, status: string, lastError: string) {
  const consumer = `mesaerp:${legalEntityId}`;
  await db.integrationInboxReceipt.update({
    where: { organizationId_consumer_eventId: { organizationId: context.organizationId, consumer, eventId: inbox.sourceEventId } },
    data: { status, attemptCount: { increment: 1 }, lastError, ...(status === 'processed' || status === 'rejected' ? { processedAt: new Date() } : {}) },
  });
}

export class PrismaMesaErpHandoffService {
  hasPermission(input: { organizationId: string; membershipId: string; legalEntityId: string; permission: string }) {
    return hasMesaErpPermission(input);
  }

  async listMappings(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      return (await db.erpHandoffMapping.findMany({ where: { legalEntityId }, orderBy: [{ mappingType: 'asc' }, { sourceKey: 'asc' }], take: 2000 })).map(mappingDto);
    });
  }

  async listEventRoutes(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      return (await db.erpHandoffEventRoute.findMany({ where: { legalEntityId }, orderBy: { createdAt: 'desc' }, take: 500 })).map(eventRouteDto);
    });
  }

  createEventRoute(legalEntityId: string, input: HandoffEventRouteCreate, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `handoff:event-route:create:${legalEntityId}`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      const event = await db.integrationOutboxEvent.findFirst({ where: {
        id: input.sourceEventId, organizationId: context.organizationId, legalEntityId: null,
        serviceId: 'mesaops', eventType: { in: [...EVENT_TYPES] },
      } });
      if (!event) throw new ApiError(404, 'unrouted_handoff_event_not_found', 'An unrouted MesaOps event with this identity was not found in the tenant.');
      if (event.payloadHash !== input.expectedPayloadHash) throw new ApiError(409, 'handoff_payload_changed', 'The event payload hash differs from the reviewed evidence.');
      assertEnvelopeIntegrity(event, legalEntityId, true);
      if (await db.erpHandoffEventRoute.findFirst({ where: { organizationId: context.organizationId, sourceEventId: event.id } })) {
        throw new ApiError(409, 'handoff_event_already_routed', 'This standalone MesaOps event already has a company-routing decision.');
      }
      const routingEvidence = {
        version: 1, sourceEventId: event.id, sourcePayloadHash: event.payloadHash,
        eventType: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId,
        targetLegalEntityId: legalEntityId, reason: input.reason, evidence: input.routingEvidence,
      };
      const row = await db.erpHandoffEventRoute.create({ data: {
        organizationId: context.organizationId, legalEntityId, sourceEventId: event.id,
        sourcePayloadHash: event.payloadHash, reason: input.reason, routingEvidence: json(routingEvidence),
        evidenceHash: canonicalHash(routingEvidence), status: 'draft', createIdempotencyKey: idempotencyKey,
        requestHash: canonicalHash(input), createdBy: context.membershipId,
      } });
      await audit(db, { action: 'mesaerp.handoff.event_route.create', entity: 'ErpHandoffEventRoute', entityId: row.id, after: eventRouteDto(row) });
      return eventRouteDto(row);
    } });
  }

  approveEventRoute(legalEntityId: string, routeId: string, input: HandoffEventRouteApprove, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `handoff:event-route:${routeId}:approve`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpHandoffEventRoute" WHERE "id" = ${routeId} FOR UPDATE`);
      const current = await db.erpHandoffEventRoute.findFirst({ where: { id: routeId, legalEntityId } });
      if (!current) throw new ApiError(404, 'handoff_event_route_not_found', 'Event routing decision not found in this company.');
      if (current.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Event routing decision changed since it was loaded.');
      if (current.status !== 'draft') throw new ApiError(409, 'handoff_event_route_not_transitionable', `The event routing decision is ${current.status}.`);
      if (!current.createdBy || current.createdBy === context.membershipId) throw new ApiError(409, 'maker_checker_required', 'The event-routing maker cannot approve the same decision.');
      if (canonicalHash(current.routingEvidence) !== current.evidenceHash) throw new ApiError(409, 'handoff_route_evidence_changed', 'Event routing evidence failed its immutable hash check.');
      const event = await db.integrationOutboxEvent.findFirst({ where: {
        id: current.sourceEventId, organizationId: context.organizationId, legalEntityId: null,
        serviceId: 'mesaops', payloadHash: current.sourcePayloadHash,
      } });
      if (!event) throw new ApiError(409, 'handoff_route_source_changed', 'The exact standalone MesaOps event is no longer available.');
      assertEnvelopeIntegrity(event, legalEntityId, true);
      const changed = await db.erpHandoffEventRoute.updateMany({
        where: { id: routeId, legalEntityId, status: 'draft', rowVersion: input.expectedRowVersion },
        data: { status: 'approved', approvedBy: context.membershipId, approvedAt: new Date(), rowVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Event routing decision changed while approval was saved.');
      const row = await db.erpHandoffEventRoute.findUniqueOrThrow({ where: { id: routeId } });
      await audit(db, { action: 'mesaerp.handoff.event_route.approve', entity: 'ErpHandoffEventRoute', entityId: row.id, before: eventRouteDto(current), after: eventRouteDto(row) });
      const eventId = randomUUID();
      const payload = {
        eventId, eventRouteId: row.id, sourceEventId: row.sourceEventId,
        sourcePayloadHash: row.sourcePayloadHash, targetLegalEntityId: legalEntityId,
      };
      await db.integrationOutboxEvent.create({ data: {
        id: eventId, organizationId: context.organizationId, legalEntityId, serviceId: 'mesaerp',
        aggregateType: 'ErpHandoffEventRoute', aggregateId: row.id,
        eventType: 'mesaerp.handoff-event-route.approved.v1', schemaVersion: 1,
        correlationId: row.sourceEventId, causationId: row.sourceEventId,
        payload: json(payload), payloadHash: canonicalHash(payload),
      } });
      return eventRouteDto(row);
    } });
  }

  createMapping(legalEntityId: string, input: HandoffMappingCreate, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `handoff:mapping:create:${legalEntityId}`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      const sourceKey = normalized(input.sourceKey);
      const target = await validateMappingTarget(db, legalEntityId, input.mappingType, input.targetId, input.targetValue);
      const duplicate = await db.erpHandoffMapping.findFirst({ where: { legalEntityId, sourceService: 'mesaops', mappingType: input.mappingType, sourceKey } });
      if (duplicate) throw new ApiError(409, 'handoff_mapping_exists', 'This MesaOps source value is already mapped in the company.');
      const proposal = {
        version: 1,
        mappingType: input.mappingType,
        sourceKey,
        ...target,
        sourceEvidence: json(input.sourceEvidence),
        requestedActive: true,
      };
      const row = await db.erpHandoffMapping.create({ data: {
        organizationId: context.organizationId, legalEntityId, sourceService: 'mesaops', mappingType: input.mappingType,
        sourceKey, ...target, sourceEvidence: json(input.sourceEvidence), status: 'draft', active: false, requestedActive: true,
        createIdempotencyKey: idempotencyKey, requestHash: canonicalHash(input), createdBy: context.membershipId,
        proposedBy: context.membershipId, proposalHash: canonicalHash(proposal),
      } });
      await audit(db, { action: 'mesaerp.handoff.mapping.propose', entity: 'ErpHandoffMapping', entityId: row.id, after: mappingDto(row) });
      return mappingDto(row);
    } });
  }

  updateMapping(legalEntityId: string, mappingId: string, input: HandoffMappingUpdate, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `handoff:mapping:${mappingId}:update`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpHandoffMapping" WHERE "id" = ${mappingId} AND "legalEntityId" = ${legalEntityId} FOR UPDATE`);
      const current = await db.erpHandoffMapping.findFirst({ where: { id: mappingId, legalEntityId } });
      if (!current) throw new ApiError(404, 'handoff_mapping_not_found', 'Handoff mapping not found in this company.');
      if (current.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Handoff mapping changed since it was loaded.');
      if (current.status === 'draft' && current.proposedBy !== context.membershipId) {
        throw new ApiError(409, 'handoff_mapping_proposal_pending', 'Another maker already has an unapproved mapping proposal.');
      }
      const requestedActive = input.active ?? (current.status === 'approved' ? current.active : current.requestedActive);
      const changesTarget = input.targetId !== undefined || input.targetValue !== undefined;
      const target = changesTarget || requestedActive
        ? await validateMappingTarget(db, legalEntityId, current.mappingType, input.targetId ?? current.targetId, input.targetValue ?? current.targetValue)
        : { targetId: current.targetId, targetValue: current.targetValue };
      const sourceEvidence = json(input.sourceEvidence ?? current.sourceEvidence ?? {});
      const proposal = {
        version: 1,
        mappingType: current.mappingType,
        sourceKey: current.sourceKey,
        ...target,
        sourceEvidence,
        requestedActive,
      };
      const changed = await db.erpHandoffMapping.updateMany({
        where: { id: mappingId, legalEntityId, rowVersion: input.expectedRowVersion },
        data: {
          ...target,
          sourceEvidence,
          status: 'draft',
          active: false,
          requestedActive,
          proposedBy: context.membershipId,
          approvedBy: '',
          approvedAt: null,
          approvalReason: '',
          proposalHash: canonicalHash(proposal),
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Handoff mapping changed while it was saved.');
      const row = await db.erpHandoffMapping.findUniqueOrThrow({ where: { id: mappingId } });
      await audit(db, { action: 'mesaerp.handoff.mapping.propose_update', entity: 'ErpHandoffMapping', entityId: row.id, before: mappingDto(current), after: mappingDto(row) });
      return mappingDto(row);
    } });
  }

  approveMapping(legalEntityId: string, mappingId: string, input: HandoffMappingApprove, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `handoff:mapping:${mappingId}:approve`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpHandoffMapping" WHERE "id" = ${mappingId} AND "legalEntityId" = ${legalEntityId} FOR UPDATE`);
      const current = await db.erpHandoffMapping.findFirst({ where: { id: mappingId, legalEntityId } });
      if (!current) throw new ApiError(404, 'handoff_mapping_not_found', 'Handoff mapping not found in this company.');
      if (current.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Handoff mapping changed since it was loaded.');
      if (current.status !== 'draft') throw new ApiError(409, 'handoff_mapping_not_approvable', 'Only a draft mapping proposal can be approved.');
      if (!current.proposedBy || current.proposedBy === context.membershipId) {
        throw new ApiError(409, 'maker_checker_required', 'The mapping proposer cannot approve the same proposal.');
      }
      if (current.requestedActive) {
        await validateMappingTarget(db, legalEntityId, current.mappingType, current.targetId, current.targetValue);
      }
      const proposal = mappingProposal(current);
      if (canonicalHash(proposal) !== current.proposalHash) {
        throw new ApiError(409, 'handoff_mapping_evidence_changed', 'The mapping proposal no longer matches its evidence hash.');
      }
      const changed = await db.erpHandoffMapping.updateMany({
        where: { id: mappingId, legalEntityId, status: 'draft', rowVersion: input.expectedRowVersion },
        data: {
          status: 'approved',
          active: current.requestedActive,
          approvedBy: context.membershipId,
          approvedAt: new Date(),
          approvalReason: input.reason,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Handoff mapping changed while approval was saved.');
      const row = await db.erpHandoffMapping.findUniqueOrThrow({ where: { id: mappingId } });
      await audit(db, { action: 'mesaerp.handoff.mapping.approve', entity: 'ErpHandoffMapping', entityId: row.id, before: mappingDto(current), after: mappingDto(row) });
      return mappingDto(row);
    } });
  }

  async listInbox(legalEntityId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const [rows, routes] = await Promise.all([
        db.erpHandoffInboxEvent.findMany({ where: { legalEntityId }, orderBy: { receivedAt: 'desc' }, take: 500 }),
        db.erpHandoffEventRoute.findMany({ where: { legalEntityId, status: 'approved' }, select: { sourceEventId: true } }),
      ]);
      const routedIds = routes.map((route) => route.sourceEventId);
      const events = await db.integrationOutboxEvent.findMany({
        where: {
          serviceId: 'mesaops', eventType: { in: [...EVENT_TYPES] },
          OR: [{ legalEntityId }, ...(routedIds.length ? [{ legalEntityId: null, id: { in: routedIds } }] : [])],
        },
        orderBy: { occurredAt: 'desc' }, take: 500,
      });
      const received = new Set(rows.map((row) => row.sourceEventId));
      return {
        inbox: rows.map(inboxDto),
        available: events.filter((event) => !received.has(event.id)).map((event) => ({
          eventId: event.id, eventType: event.eventType, schemaVersion: event.schemaVersion,
          aggregateType: event.aggregateType, aggregateId: event.aggregateId, payloadHash: event.payloadHash,
          occurredAt: event.occurredAt.toISOString(), state: 'available',
        })),
      };
    });
  }

  async getInbox(legalEntityId: string, inboxId: string) {
    const context = actor();
    return tenantTx(async (db) => {
      await requireEntity(db, context, legalEntityId);
      const row = await db.erpHandoffInboxEvent.findFirst({ where: { id: inboxId, legalEntityId } });
      if (!row) throw new ApiError(404, 'handoff_event_not_found', 'Handoff event not found in this company.');
      return inboxDto(row);
    });
  }

  receive(legalEntityId: string, eventId: string, input: HandoffReceive, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `handoff:receive:${eventId}`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      const event = await db.integrationOutboxEvent.findFirst({ where: { id: eventId, organizationId: context.organizationId, serviceId: 'mesaops' } });
      if (!event) throw new ApiError(404, 'handoff_event_not_found', 'MesaOps event not found for this company.');
      const route = event.legalEntityId === null ? await db.erpHandoffEventRoute.findFirst({ where: {
        legalEntityId, sourceEventId: event.id, sourcePayloadHash: event.payloadHash, status: 'approved',
      } }) : null;
      if (event.legalEntityId !== legalEntityId && !route) throw new ApiError(404, 'handoff_event_not_found', 'MesaOps event not found for this company.');
      if (event.eventType !== input.expectedEventType || event.schemaVersion !== input.expectedSchemaVersion) {
        throw new ApiError(409, 'handoff_event_contract_mismatch', 'The event type or schema version changed after the inbox was loaded.');
      }
      if (event.payloadHash !== input.expectedPayloadHash) throw new ApiError(409, 'handoff_payload_changed', 'The event payload hash changed after the inbox was loaded.');
      const envelope = assertEnvelopeIntegrity(event, legalEntityId, Boolean(route));
      const prior = await db.erpHandoffInboxEvent.findFirst({ where: { legalEntityId, sourceEventId: event.id } });
      if (prior) {
        if (prior.payloadHash !== event.payloadHash) throw new ApiError(409, 'handoff_event_id_conflict', 'This event id was already received with a different payload hash.');
        return inboxDto(prior);
      }
      const aggregateConflict = await db.erpHandoffInboxEvent.findFirst({
        where: { legalEntityId, eventType: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId, sourceEventId: { not: event.id } },
      });
      const state = aggregateConflict ? 'conflict' : 'received';
      const exceptionCode = aggregateConflict ? 'aggregate_event_conflict' : '';
      const row = await db.erpHandoffInboxEvent.create({ data: {
        organizationId: context.organizationId, legalEntityId, sourceEventId: event.id, sourceService: 'mesaops',
        eventType: event.eventType, schemaVersion: event.schemaVersion, aggregateType: event.aggregateType,
        aggregateId: event.aggregateId, correlationId: event.correlationId, occurredAt: event.occurredAt,
        sourceSnapshotHash: envelope.sourceSnapshotHash, payloadHash: event.payloadHash, payload: json(event.payload),
        state, exceptionCode, exceptionDetails: aggregateConflict ? { conflictingInboxId: aggregateConflict.id } : {},
        attemptCount: 0, receivedBy: context.membershipId,
      } });
      await db.integrationInboxReceipt.create({ data: {
        organizationId: context.organizationId, legalEntityId, consumer: `mesaerp:${legalEntityId}`,
        eventId: event.id, eventType: event.eventType, payloadHash: event.payloadHash,
        status: state === 'received' ? 'received' : 'conflict', lastError: exceptionCode,
      } });
      await audit(db, { action: 'mesaerp.handoff.receive', entity: 'ErpHandoffInboxEvent', entityId: row.id, after: { sourceEventId: row.sourceEventId, state, payloadHash: row.payloadHash } });
      return inboxDto(row);
    } });
  }

  accept(legalEntityId: string, inboxId: string, input: HandoffAccept, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `handoff:${inboxId}:accept`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "ErpHandoffInboxEvent" WHERE "id" = ${inboxId} FOR UPDATE`);
      const inbox = await db.erpHandoffInboxEvent.findFirst({ where: { id: inboxId, legalEntityId } });
      if (!inbox) throw new ApiError(404, 'handoff_event_not_found', 'Handoff event not found in this company.');
      if (inbox.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Handoff event changed since it was loaded.');
      if (inbox.state !== 'received') throw new ApiError(409, 'handoff_event_not_acceptible', `Only received events can be accepted; this event is ${inbox.state}.`);
      if (canonicalHash(inbox.payload) !== inbox.payloadHash) throw new ApiError(409, 'handoff_payload_hash_mismatch', 'Stored inbox evidence failed its immutable hash check.');
      const envelope = parseEnvelope(inbox.payload);
      if (canonicalHash(envelope.snapshot) !== inbox.sourceSnapshotHash || envelope.eventId !== inbox.sourceEventId) {
        throw new ApiError(409, 'handoff_event_identity_mismatch', 'Stored inbox evidence no longer matches its source identity.');
      }
      await db.$executeRawUnsafe('SAVEPOINT mesaerp_handoff_accept_artifacts');
      try {
        const artifacts = inbox.eventType === 'mesaops.production-actuals.submitted.v1'
          ? await createExecutionArtifacts(db, context, legalEntityId, inbox, envelope, input)
          : inbox.eventType === 'mesaops.qa-disposition.recorded.v1'
            ? await createQaEvidence(db, context, legalEntityId, inbox, envelope)
            : await createDispatchEvidence(db, context, legalEntityId, inbox, envelope);
        const changed = await db.erpHandoffInboxEvent.updateMany({
          where: { id: inbox.id, legalEntityId, state: 'received', rowVersion: input.expectedRowVersion },
          data: { state: 'accepted', exceptionCode: '', exceptionDetails: {}, createdArtifacts: json(artifacts), attemptCount: { increment: 1 }, resolvedBy: context.membershipId, resolvedAt: new Date(), rowVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Handoff event changed while acceptance was saved.');
        await markReceipt(db, context, legalEntityId, inbox, 'processed', '');
        const updated = await db.erpHandoffInboxEvent.findUniqueOrThrow({ where: { id: inbox.id } });
        await appendAcceptedOutbox(db, context, legalEntityId, updated, artifacts);
        await db.$executeRawUnsafe('RELEASE SAVEPOINT mesaerp_handoff_accept_artifacts');
        return inboxDto(updated);
      } catch (error) {
        if (!(error instanceof ApiError) || ![409, 422].includes(error.status)) throw error;
        await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT mesaerp_handoff_accept_artifacts');
        await db.$executeRawUnsafe('RELEASE SAVEPOINT mesaerp_handoff_accept_artifacts');
        await db.erpHandoffInboxEvent.update({
          where: { id: inbox.id },
          data: {
            state: 'retry', exceptionCode: error.code,
            exceptionDetails: json({ message: error.message, details: error.details ?? null }),
            attemptCount: { increment: 1 }, rowVersion: { increment: 1 },
          },
        });
        await markReceipt(db, context, legalEntityId, inbox, 'retry', error.code);
        await audit(db, { action: 'mesaerp.handoff.retry_required', entity: 'ErpHandoffInboxEvent', entityId: inbox.id, after: { error: error.code, message: error.message } });
        const retry = await db.erpHandoffInboxEvent.findUniqueOrThrow({ where: { id: inbox.id } });
        return inboxDto(retry);
      }
    } });
  }

  reject(legalEntityId: string, inboxId: string, input: HandoffReject, idempotencyKey: string) {
    return this.transitionException(legalEntityId, inboxId, 'rejected', input, idempotencyKey);
  }

  retry(legalEntityId: string, inboxId: string, input: HandoffRetry, idempotencyKey: string) {
    return this.transitionException(legalEntityId, inboxId, 'received', input, idempotencyKey);
  }

  private transitionException(legalEntityId: string, inboxId: string, target: 'rejected' | 'received', input: HandoffReject | HandoffRetry, idempotencyKey: string) {
    return runIdempotent({ legalEntityId, scope: `handoff:${inboxId}:${target}`, key: idempotencyKey, payload: input, execute: async (db, context) => {
      const current = await db.erpHandoffInboxEvent.findFirst({ where: { id: inboxId, legalEntityId } });
      if (!current) throw new ApiError(404, 'handoff_event_not_found', 'Handoff event not found in this company.');
      if (current.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Handoff event changed since it was loaded.');
      const allowed = target === 'rejected' ? ['received', 'retry', 'conflict'] : ['retry', 'conflict'];
      if (!allowed.includes(current.state)) throw new ApiError(409, 'handoff_state_invalid', `The ${current.state} event cannot move to ${target}.`);
      const changed = await db.erpHandoffInboxEvent.updateMany({
        where: { id: inboxId, legalEntityId, state: current.state, rowVersion: input.expectedRowVersion },
        data: {
          state: target,
          exceptionCode: target === 'rejected' ? 'manually_rejected' : '',
          exceptionDetails: json({ reason: input.reason }),
          resolvedBy: target === 'rejected' ? context.membershipId : '',
          resolvedAt: target === 'rejected' ? new Date() : null,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Handoff event changed while the transition was saved.');
      await markReceipt(db, context, legalEntityId, current, target === 'rejected' ? 'rejected' : 'received', target === 'rejected' ? input.reason : '');
      const row = await db.erpHandoffInboxEvent.findUniqueOrThrow({ where: { id: inboxId } });
      await audit(db, { action: `mesaerp.handoff.${target === 'received' ? 'retry' : 'reject'}`, entity: 'ErpHandoffInboxEvent', entityId: row.id, before: inboxDto(current), after: inboxDto(row) });
      return inboxDto(row);
    } });
  }
}
