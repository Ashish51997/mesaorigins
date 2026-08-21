import { Prisma } from '@prisma/client';
import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { ApiError } from '../../middleware/error';
import { seedDraftLogbook, syncDraftHeaderFromPlan } from '../logbook/service';
import { canonicalHash as hashCanonical } from '../../lib/canonical';
import { runMesaOpsIdempotent } from '../../lib/mesaOpsIdempotency';
import { assertMesaOpsPlantAccess, plantCodeFilter, resolveMesaOpsPlantScope, type MesaOpsPlantScope } from '../../lib/mesaOpsScope';
import { mesaErpOperationalOrderHandoffSchema, type MesaErpOperationalOrderHandoff, type MesaErpOutboxHandoffAccept, type OperationalOrderCreate, type PlanCreate, type PlanRelease, type PlanUpdate } from './schemas';

function org(): string {
  const ctx = tenantContext.getStore();
  if (!ctx) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return ctx.organizationId;
}
const dateOf = (s: string) => (s || '').slice(0, 10);

const planInclude = {
  machine: { select: { code: true, line: true, plantCode: true } },
  operationalOrder: {
    select: {
      id: true, orderNumber: true, sourceType: true, sourceReference: true, customerName: true,
      productCode: true, productName: true, quantity: true, uom: true, dueDate: true,
      priority: true, status: true, sourceSnapshotHash: true, plantCode: true, rowVersion: true,
    },
  },
  salesOrder: { select: { soNumber: true, product: true, deliveryDate: true, customer: { select: { name: true } } } },
  logbook: { select: { id: true, status: true } },
} as const;

type PlanWithContext = Prisma.ProductionPlanGetPayload<{ include: typeof planInclude }>;

function operationalOrderDto(order: {
  id: string; orderNumber: string; sourceType: string; sourceReference: string; customerName: string;
  productCode: string; productName: string; quantity: Prisma.Decimal; uom: string; dueDate: Date | null;
  priority: string; status: string; sourceSnapshotHash: string;
  plantCode: string; rowVersion: number;
  sourceLink?: { state: string } | null;
}) {
  return {
    ...order,
    quantity: order.quantity.toString(),
    dueDate: order.dueDate?.toISOString().slice(0, 10) ?? '',
    sourceLinkState: order.sourceLink?.state ?? (order.sourceType === 'mesaerp' ? 'unlinked' : 'independent'),
  };
}

function planDto(plan: PlanWithContext) {
  const order = operationalOrderDto(plan.operationalOrder);
  return {
    ...plan,
    plannedQuantity: plan.plannedQuantity.toString(),
    operationalOrder: order,
    // Transitional response alias keeps current MesaOps clients usable while
    // the visible UI moves to the operational-order terminology.
    salesOrder: {
      soNumber: order.orderNumber,
      product: order.productName,
      deliveryDate: order.dueDate,
      customer: { name: order.customerName || plan.salesOrder?.customer.name || 'Internal demand' },
    },
  };
}

/** Any local/imported/linked demand awaiting detailed plant planning. */
export async function listOrdersToPlan() {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  const waitingStatuses = ['ready_to_plan', 'partially_planned'];
  const [orders, plannedByOrder] = await Promise.all([
    prisma.operationalOrder.findMany({
      where: { status: { in: waitingStatuses }, ...(plants ? { plantCode: plants } : {}) },
      include: { sourceLink: { select: { state: true } } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.productionPlan.groupBy({
      by: ['operationalOrderId'],
      where: { operationalOrder: { status: { in: waitingStatuses }, ...(plants ? { plantCode: plants } : {}) } },
      _sum: { plannedQuantity: true },
    }),
  ]);
  const planned = new Map(plannedByOrder.map((row) => [row.operationalOrderId, row._sum.plannedQuantity ?? new Prisma.Decimal(0)]));
  return orders.map((order) => {
    const dto = operationalOrderDto(order);
    const plannedQuantity = planned.get(order.id) ?? new Prisma.Decimal(0);
    return {
      ...dto,
      plannedQuantity: plannedQuantity.toString(),
      remainingQuantity: Prisma.Decimal.max(order.quantity.minus(plannedQuantity), 0).toString(),
      soNumber: dto.orderNumber,
      product: dto.productName,
      deliveryDate: dto.dueDate,
      customer: { name: dto.customerName || 'Internal demand' },
    };
  });
}

/** Production plans with their machine + order + customer. */
export async function listPlans() {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  const plans = await prisma.productionPlan.findMany({
    where: plants ? { operationalOrder: { plantCode: plants } } : undefined,
    include: planInclude,
    orderBy: { scheduledStartDate: 'asc' },
  });
  return plans.map(planDto);
}

export async function listOperationalOrders() {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  const orders = await prisma.operationalOrder.findMany({
    where: plants ? { plantCode: plants } : undefined,
    include: { sourceLink: { select: { state: true } } },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
  });
  return orders.map(operationalOrderDto);
}

export async function createOperationalOrder(input: OperationalOrderCreate, idempotencyKey: string) {
  const scope = await resolveMesaOpsPlantScope();
  const normalizedPlantCode = input.plantCode.toUpperCase();
  assertMesaOpsPlantAccess(scope, normalizedPlantCode);
  const requestHash = hashCanonical(input);
  const replay = await prisma.operationalOrder.findFirst({ where: { createIdempotencyKey: idempotencyKey } });
  if (replay) {
    if (replay.sourceSnapshotHash !== requestHash) throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was already used with a different order.');
    return operationalOrderDto(replay);
  }
  const duplicate = await prisma.operationalOrder.findFirst({ where: { orderNumber: input.orderNumber } });
  if (duplicate) throw new ApiError(409, 'order_number_exists', 'That operational order number already exists.');
  const customer = input.customerId
    ? await prisma.customer.findUnique({ where: { id: input.customerId } })
    : null;
  if (input.customerId && !customer) throw new ApiError(422, 'bad_customer', 'That local customer does not exist.');
  const orgId = org();
  return tenantTx(async (tx) => {
    const order = await tx.operationalOrder.create({
      data: {
        organizationId: orgId,
        plantCode: normalizedPlantCode,
        orderNumber: input.orderNumber,
        sourceType: input.sourceType,
        sourceReference: input.sourceReference,
        customerId: input.customerId,
        customerName: input.customerName || customer?.name || '',
        productCode: input.productCode,
        productName: input.productName,
        quantity: input.quantity,
        uom: input.uom,
        dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null,
        priority: input.priority,
        requirements: input.requirements as Prisma.InputJsonValue,
        originMetadata: { createdInside: 'mesaops' },
        sourceSnapshotHash: requestHash,
        createIdempotencyKey: idempotencyKey,
        status: 'ready_to_plan',
      },
    });
    await audit(tx, { action: 'operational_order.create', entity: 'OperationalOrder', entityId: order.id, after: order });
    return operationalOrderDto(order);
  });
}

function parseMesaErpReleasePayload(value: unknown): MesaErpOperationalOrderHandoff {
  const parsed = mesaErpOperationalOrderHandoffSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(409, 'handoff_payload_invalid', 'The stored MesaERP release event does not match the operational-order handoff contract.');
  }
  return parsed.data;
}

/**
 * MesaOps-owned pull inbox. The event body is read from the durable MesaERP
 * outbox rather than supplied by a browser, so accepting a proposal never
 * trusts a user-authored source id, correlation id, snapshot or hash.
 */
export async function listMesaErpOperationalOrderHandoffs() {
  const orgId = org();
  const scope = await resolveMesaOpsPlantScope();
  return tenantTx(async (tx) => {
    const events = await tx.integrationOutboxEvent.findMany({
      where: { serviceId: 'mesaerp', eventType: 'mesaerp.production-demand.released.v1' },
      orderBy: { createdAt: 'desc' },
      take: 250,
    });
    const receipts = events.length
      ? await tx.integrationInboxReceipt.findMany({
        where: { consumer: 'mesaops', eventId: { in: events.map((event) => event.id) } },
      })
      : [];
    const receiptByEvent = new Map(receipts.map((receipt) => [receipt.eventId, receipt]));
    const result: Array<Record<string, unknown>> = [];
    for (const event of events) {
      const parsed = mesaErpOperationalOrderHandoffSchema.safeParse(event.payload);
      if (!parsed.success || hashCanonical(event.payload) !== event.payloadHash) {
        // A scoped planner must not see an untrusted payload whose plant cannot
        // be proven. Unrestricted administrators get a visible exception row.
        if (!scope.allPlants) continue;
        result.push({
          eventId: event.id,
          correlationId: event.correlationId,
          sourceId: event.aggregateId,
          sourceSnapshotHash: '',
          snapshot: null,
          state: 'conflict',
          reason: 'stored_event_integrity_failure',
          occurredAt: event.createdAt.toISOString(),
        });
        continue;
      }
      const payload = parsed.data;
      const normalizedPlantCode = payload.snapshot.plantCode.toUpperCase();
      if (!scope.allPlants && !scope.plantCodes.includes(normalizedPlantCode)) continue;
      const receipt = receiptByEvent.get(event.id);
      result.push({
        eventId: event.id,
        correlationId: payload.correlationId,
        sourceId: payload.sourceId,
        sourceSnapshotHash: payload.sourceSnapshotHash,
        snapshot: payload.snapshot,
        state: receipt?.status === 'processed' ? 'linked' : receipt?.status === 'conflict' ? 'conflict' : 'unlinked',
        reason: receipt?.lastError ?? '',
        occurredAt: event.createdAt.toISOString(),
      });
    }
    return result;
  });
}

export async function acceptMesaErpOperationalOrderFromOutbox(
  eventId: string,
  input: MesaErpOutboxHandoffAccept,
) {
  const orgId = org();
  const scope = await resolveMesaOpsPlantScope();
  const payload = await tenantTx(async (tx) => {
    const event = await tx.integrationOutboxEvent.findFirst({
      where: { id: eventId, serviceId: 'mesaerp', eventType: 'mesaerp.production-demand.released.v1' },
    });
    if (!event) throw new ApiError(404, 'handoff_event_not_found', 'MesaERP production-demand release event not found.');
    if (hashCanonical(event.payload) !== event.payloadHash) {
      throw new ApiError(409, 'handoff_event_integrity_failure', 'The stored MesaERP release event failed its immutable payload check.');
    }
    const stored = parseMesaErpReleasePayload(event.payload);
    if (stored.eventId !== event.id || stored.correlationId !== event.correlationId || stored.sourceId !== event.aggregateId) {
      throw new ApiError(409, 'handoff_event_identity_mismatch', 'The stored MesaERP release wrapper does not match its outbox identity.');
    }
    if (event.legalEntityId && stored.snapshot.legalEntityId !== event.legalEntityId) {
      throw new ApiError(409, 'handoff_event_identity_mismatch', 'The stored MesaERP release company does not match its outbox identity.');
    }
    if (stored.sourceSnapshotHash !== input.expectedSourceSnapshotHash) {
      throw new ApiError(409, 'handoff_source_changed', 'The MesaERP source snapshot changed after the inbox row was loaded.');
    }
    assertMesaOpsPlantAccess(scope, stored.snapshot.plantCode.toUpperCase());
    return stored;
  });
  return acceptMesaErpOperationalOrder(payload);
}

export async function acceptMesaErpOperationalOrder(input: MesaErpOperationalOrderHandoff) {
  const snapshotHash = hashCanonical(input.snapshot);
  const envelopeHash = hashCanonical(input);
  if (snapshotHash !== input.sourceSnapshotHash) {
    throw new ApiError(422, 'source_hash_mismatch', 'The MesaERP snapshot does not match its declared SHA-256 hash.');
  }
  const orgId = org();
  const scope = await resolveMesaOpsPlantScope();
  const normalizedPlantCode = input.snapshot.plantCode.toUpperCase();
  assertMesaOpsPlantAccess(scope, normalizedPlantCode);
  return tenantTx(async (tx) => {
    // Serialize all accepts for one immutable event across API instances. The
    // background publisher may have already created a received receipt, but it
    // never creates the destination order; only this human action does.
    await tx.$queryRaw(Prisma.sql`
      SELECT true AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`mesaops:erp-handoff:${orgId}:${input.eventId}`}, 0))) AS acquired
    `);
    const existingReceipt = await tx.integrationInboxReceipt.findUnique({
      where: { organizationId_consumer_eventId: { organizationId: orgId, consumer: 'mesaops', eventId: input.eventId } },
    });
    if (existingReceipt) {
      // The automatic publisher records the hash of the complete immutable
      // event envelope. Accept the historical snapshot-only evidence as well
      // so already-linked orders remain replayable after the publisher ships.
      if (![envelopeHash, snapshotHash].includes(existingReceipt.payloadHash)) {
        return { status: 'conflict' as const, reason: 'event_id_payload_conflict', operationalOrder: null };
      }
      if (existingReceipt.status !== 'received') {
        const existingLink = await tx.sourceLink.findFirst({
          where: { organizationId: orgId, correlationId: input.correlationId },
        });
        const existingOrder = existingLink?.destinationId
          ? await tx.operationalOrder.findFirst({
            where: { id: existingLink.destinationId }, include: { sourceLink: { select: { state: true } } },
          })
          : null;
        return {
          status: existingReceipt.status === 'processed' ? 'replayed' as const : 'conflict' as const,
          reason: existingReceipt.lastError,
          operationalOrder: existingOrder ? operationalOrderDto(existingOrder) : null,
        };
      }
    }

    const recordReceipt = async (status: 'processed' | 'conflict', lastError: string) => {
      if (existingReceipt) {
        return tx.integrationInboxReceipt.update({
          where: { id: existingReceipt.id },
          data: { status, attemptCount: { increment: 1 }, lastError, processedAt: new Date() },
        });
      }
      return tx.integrationInboxReceipt.create({
        data: {
          organizationId: orgId, legalEntityId: input.snapshot.legalEntityId,
          consumer: 'mesaops', eventId: input.eventId,
          eventType: 'mesaerp.production-demand.released.v1', payloadHash: envelopeHash,
          status, attemptCount: 1, lastError, processedAt: new Date(),
        },
      });
    };

    const existingLink = await tx.sourceLink.findFirst({
      where: {
        organizationId: orgId,
        sourceService: 'mesaerp',
        sourceType: { in: ['ProductionDemand', 'SalesOrder'] },
        sourceId: input.sourceId,
        destinationService: 'mesaops',
        destinationType: 'OperationalOrder',
      },
    });
    if (existingLink) {
      if (existingLink.sourceSnapshotHash !== snapshotHash) {
        await tx.sourceLink.update({
          where: { id: existingLink.id },
          data: { state: 'stale', conflictReason: 'MesaERP source snapshot changed after MesaOps accepted it.', lastEventAt: new Date(), rowVersion: { increment: 1 } },
        });
        await recordReceipt('conflict', 'source_snapshot_changed');
        return { status: 'conflict' as const, reason: 'source_snapshot_changed', operationalOrder: null };
      }
      const order = existingLink.destinationId
        ? await tx.operationalOrder.findFirst({
          where: { id: existingLink.destinationId }, include: { sourceLink: { select: { state: true } } },
        })
        : null;
      await recordReceipt(order ? 'processed' : 'conflict', order ? '' : 'destination_missing');
      return { status: order ? 'replayed' as const : 'conflict' as const, reason: order ? '' : 'destination_missing', operationalOrder: order ? operationalOrderDto(order) : null };
    }

    const orderNumberConflict = await tx.operationalOrder.findFirst({ where: { orderNumber: input.snapshot.orderNumber } });
    if (orderNumberConflict) {
      await tx.sourceLink.create({
        data: {
          organizationId: orgId, legalEntityId: input.snapshot.legalEntityId,
          sourceService: 'mesaerp', sourceType: 'ProductionDemand', sourceId: input.sourceId,
          destinationService: 'mesaops', destinationType: 'OperationalOrder', correlationId: input.correlationId,
          sourceSnapshotHash: snapshotHash, sourceSnapshot: input.snapshot as Prisma.InputJsonValue,
          state: 'conflict', conflictReason: `Operational order ${input.snapshot.orderNumber} already exists.`, lastEventAt: new Date(),
        },
      });
      await recordReceipt('conflict', 'order_number_conflict');
      return { status: 'conflict' as const, reason: 'order_number_conflict', operationalOrder: null };
    }

    const link = await tx.sourceLink.create({
      data: {
        organizationId: orgId, legalEntityId: input.snapshot.legalEntityId,
        sourceService: 'mesaerp', sourceType: 'ProductionDemand', sourceId: input.sourceId,
        destinationService: 'mesaops', destinationType: 'OperationalOrder', correlationId: input.correlationId,
        sourceSnapshotHash: snapshotHash, sourceSnapshot: input.snapshot as Prisma.InputJsonValue,
        state: 'unlinked', lastEventAt: new Date(),
      },
    });
    const order = await tx.operationalOrder.create({
      data: {
        organizationId: orgId, orderNumber: input.snapshot.orderNumber, sourceType: 'mesaerp',
        plantCode: normalizedPlantCode,
        sourceReference: input.sourceId, sourceLinkId: link.id, customerName: input.snapshot.customerName,
        productCode: input.snapshot.productCode, productName: input.snapshot.productName,
        quantity: input.snapshot.quantity, uom: input.snapshot.uom,
        dueDate: input.snapshot.dueDate ? new Date(`${input.snapshot.dueDate}T00:00:00.000Z`) : null,
        priority: input.snapshot.priority, requirements: input.snapshot.requirements as Prisma.InputJsonValue,
        originMetadata: { legalEntityId: input.snapshot.legalEntityId ?? '', eventId: input.eventId, correlationId: input.correlationId },
        sourceSnapshotHash: snapshotHash, createIdempotencyKey: input.eventId, status: 'ready_to_plan',
      },
    });
    await tx.sourceLink.update({
      where: { id: link.id },
      data: { destinationId: order.id, state: 'linked', rowVersion: { increment: 1 } },
    });
    await recordReceipt('processed', '');
    await audit(tx, { action: 'operational_order.accept_erp_snapshot', entity: 'OperationalOrder', entityId: order.id, after: { order, sourceLinkId: link.id } });
    const accepted = await tx.operationalOrder.findUniqueOrThrow({
      where: { id: order.id }, include: { sourceLink: { select: { state: true } } },
    });
    return { status: 'accepted' as const, reason: '', operationalOrder: operationalOrderDto(accepted) };
  });
}

/** Operators available for assignment (Membership is global — filter by org). */
export function listOperators() {
  return prisma.membership.findMany({
    where: { organizationId: org(), role: 'Operator', status: 'active' },
    include: { user: { select: { name: true } } },
    orderBy: { employeeCode: 'asc' },
  });
}

type Tx = Prisma.TransactionClient;

async function lockOrder(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "OperationalOrder" WHERE "id" = ${id} FOR UPDATE`;
}

async function lockPlan(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "ProductionPlan" WHERE "id" = ${id} FOR UPDATE`;
}

async function lockMachines(tx: Tx, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "Machine" WHERE "id" = ${id} FOR UPDATE`;
  }
}

async function assertNoClash(
  tx: Tx,
  scope: MesaOpsPlantScope,
  orderPlantCode: string,
  machineId: string,
  shift: string,
  start: string,
  excludePlanId?: string,
) {
  const plants = plantCodeFilter(scope);
  const machine = await tx.machine.findFirst({
    where: { id: machineId, ...(plants ? { plantCode: plants } : {}) },
  });
  if (!machine) throw new ApiError(422, 'bad_machine', 'That machine does not exist.');
  if (machine.plantCode !== orderPlantCode) {
    throw new ApiError(422, 'plant_mismatch', 'The operational order and machine must belong to the same plant.');
  }
  const clash = await tx.productionPlan.findFirst({
    where: {
      machineId,
      shift,
      status: 'scheduled',
      scheduledStartDate: { startsWith: dateOf(start) },
      ...(excludePlanId ? { id: { not: excludePlanId } } : {}),
    },
  });
  if (clash) {
    throw new ApiError(409, 'double_booked', `${machine.code} · shift ${shift} on ${dateOf(start)} is already booked.`);
  }
  return machine;
}

function assertEditable(plan: { status: string; scheduledStartDate: string; logbook?: { status: string } | null }) {
  if (plan.status !== 'scheduled') {
    throw new ApiError(409, 'plan_locked', `Only a scheduled plan can be edited (status: ${plan.status}).`);
  }
  if (plan.logbook?.status === 'submitted') {
    throw new ApiError(409, 'plan_locked', 'This plan’s logbook is submitted — schedule can no longer change.');
  }
  const start = Date.parse(plan.scheduledStartDate);
  if (Number.isFinite(start) && Date.now() >= start) {
    throw new ApiError(409, 'already_started', 'Schedule start time has passed — this plan can no longer be edited.');
  }
}

/** Schedule an order onto a machine/shift/date and seed a draft logbook with the shift header. */
function translateScheduleConflict(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if ((error as { code?: string })?.code === 'P2002' || message.includes('machine shift is already scheduled')) {
    throw new ApiError(409, 'double_booked', 'That machine and shift are already booked for this business date.');
  }
  throw error;
}

export async function createPlan(input: PlanCreate, idempotencyKey: string) {
  const operationalOrderId = input.operationalOrderId ?? input.salesOrderId as string;
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  const orgId = org();
  try {
    return await runMesaOpsIdempotent({
      scope: 'production-plan.create', key: idempotencyKey, payload: input,
      execute: async (tx) => {
        await lockOrder(tx, operationalOrderId);
        const order = await tx.operationalOrder.findFirst({
          where: { id: operationalOrderId, ...(plants ? { plantCode: plants } : {}) },
        });
        if (!order) throw new ApiError(404, 'not_found', 'Order not found.');
        if (order.rowVersion !== input.expectedOrderVersion) {
          throw new ApiError(409, 'version_conflict', 'The operational order changed. Refresh the planning queue and try again.');
        }
        if (!['ready_to_plan', 'partially_planned'].includes(order.status)) {
          throw new ApiError(409, 'not_plannable', `Order ${order.orderNumber} is not awaiting planning (status: ${order.status}).`);
        }
        await lockMachines(tx, [input.machineId]);
        await assertNoClash(tx, scope, order.plantCode, input.machineId, input.shift, input.scheduledStartDate);

        const alreadyPlanned = await tx.productionPlan.aggregate({
          where: { operationalOrderId: order.id }, _sum: { plannedQuantity: true },
        });
        const plannedBefore = alreadyPlanned._sum.plannedQuantity ?? new Prisma.Decimal(0);
        const remaining = order.quantity.minus(plannedBefore);
        const plannedQuantity = new Prisma.Decimal(input.plannedQuantity ?? remaining.toString());
        if (plannedQuantity.lte(0)) throw new ApiError(422, 'bad_quantity', 'Planned quantity must be greater than zero.');
        if (plannedQuantity.gt(remaining)) {
          throw new ApiError(409, 'over_planned', `Only ${remaining.toString()} ${order.uom} remains to be planned.`);
        }
        const productName = (input.productName || order.productName || '').trim();
        if (!productName) throw new ApiError(422, 'bad_product', 'Product name is required.');

        const plan = await tx.productionPlan.create({
      data: {
        organizationId: orgId,
        operationalOrderId: order.id,
        salesOrderId: order.legacySalesOrderId,
        machineId: input.machineId,
        plannedQuantity,
        shift: input.shift,
        operatorName: input.operatorName,
        scheduledStartDate: input.scheduledStartDate,
        scheduledEndDate: input.scheduledEndDate,
        logbookTemplateId: input.logbookTemplateId || null,
        supervisor: input.supervisor,
        drawingNo: input.drawingNo,
        formulaNo: input.formulaNo,
        moldNo: input.moldNo,
        productName,
        taskSequence: input.taskSequence as Prisma.InputJsonValue,
        executionSnapshot: {
          operationalOrder: {
            id: order.id,
            orderNumber: order.orderNumber,
            sourceType: order.sourceType,
            sourceReference: order.sourceReference,
            productCode: order.productCode,
            productName: order.productName,
            uom: order.uom,
            sourceSnapshotHash: order.sourceSnapshotHash,
          },
        },
        status: 'scheduled',
      },
          include: { machine: { select: { code: true } }, operationalOrder: { select: { orderNumber: true } } },
        });
        await seedDraftLogbook(tx as never, plan.id, orgId);
        const totalAfter = plannedBefore.plus(plannedQuantity);
        const nextStatus = totalAfter.gte(order.quantity) ? 'planned' : 'partially_planned';
        const updatedOrder = await tx.operationalOrder.updateMany({
          where: { id: order.id, rowVersion: input.expectedOrderVersion },
          data: { status: nextStatus, rowVersion: { increment: 1 } },
        });
        if (updatedOrder.count !== 1) throw new ApiError(409, 'version_conflict', 'The operational order changed while it was being planned.');
        if (order.legacySalesOrderId) {
          await tx.salesOrder.update({
            where: { id: order.legacySalesOrderId },
            data: { status: nextStatus === 'planned' ? 'planned' : 'pending', version: { increment: 1 } },
          });
        }
        await audit(tx, { action: 'order.plan', entity: 'ProductionPlan', entityId: plan.id, after: plan });
        const created = await tx.productionPlan.findUniqueOrThrow({ where: { id: plan.id }, include: planInclude });
        return planDto(created);
      },
    });
  } catch (error) {
    return translateScheduleConflict(error);
  }
}

/** Edit a scheduled plan until its start time (and while the logbook is still a draft). */
export async function updatePlan(id: string, patch: PlanUpdate, idempotencyKey: string) {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  const orgId = org();
  try {
    return await runMesaOpsIdempotent({
      scope: `production-plan.update:${id}`, key: idempotencyKey, payload: patch,
      execute: async (tx) => {
        const pointer = await tx.productionPlan.findFirst({
          where: { id, ...(plants ? { operationalOrder: { plantCode: plants } } : {}) },
          select: { operationalOrderId: true, machineId: true },
        });
        if (!pointer) throw new ApiError(404, 'not_found', 'Plan not found.');
        await lockOrder(tx, pointer.operationalOrderId);
        await lockPlan(tx, id);
        const plan = await tx.productionPlan.findFirst({
          where: { id, ...(plants ? { operationalOrder: { plantCode: plants } } : {}) },
          include: {
            logbook: { select: { id: true, status: true } }, machine: { select: { code: true, plantCode: true } },
            operationalOrder: { select: { id: true, quantity: true, plantCode: true } },
          },
        });
        if (!plan) throw new ApiError(404, 'not_found', 'Plan not found.');
        if (plan.version !== patch.expectedVersion) {
          throw new ApiError(409, 'version_conflict', 'The production plan changed. Refresh it and try again.');
        }
        assertEditable(plan);

        const nextMachineId = patch.machineId ?? plan.machineId;
        const nextShift = patch.shift ?? plan.shift;
        const nextStart = patch.scheduledStartDate ?? plan.scheduledStartDate;
        await lockMachines(tx, [plan.machineId, nextMachineId]);
        if (patch.machineId || patch.shift || patch.scheduledStartDate) {
          await assertNoClash(tx, scope, plan.operationalOrder.plantCode, nextMachineId, nextShift, nextStart, id);
        } else {
          const machine = await tx.machine.findFirst({
            where: { id: nextMachineId, ...(plants ? { plantCode: plants } : {}) },
          });
          if (!machine) throw new ApiError(422, 'bad_machine', 'That machine does not exist.');
        }

        const templateChanged = patch.logbookTemplateId !== undefined && patch.logbookTemplateId !== plan.logbookTemplateId;
        let nextPlannedQuantity: Prisma.Decimal | undefined;
        if (patch.plannedQuantity !== undefined) {
          nextPlannedQuantity = new Prisma.Decimal(patch.plannedQuantity);
          const others = await tx.productionPlan.aggregate({
            where: { operationalOrderId: plan.operationalOrderId, id: { not: id } }, _sum: { plannedQuantity: true },
          });
          const available = plan.operationalOrder.quantity.minus(others._sum.plannedQuantity ?? 0);
          if (nextPlannedQuantity.lte(0) || nextPlannedQuantity.gt(available)) {
            throw new ApiError(409, 'over_planned', `This plan may use at most ${available.toString()} units.`);
          }
        }

        const updateCount = await tx.productionPlan.updateMany({
          where: { id, version: patch.expectedVersion },
      data: {
        ...(patch.machineId !== undefined ? { machineId: patch.machineId } : {}),
        ...(patch.shift !== undefined ? { shift: patch.shift } : {}),
        ...(patch.operatorName !== undefined ? { operatorName: patch.operatorName } : {}),
        ...(patch.scheduledStartDate !== undefined ? { scheduledStartDate: patch.scheduledStartDate } : {}),
        ...(patch.scheduledEndDate !== undefined ? { scheduledEndDate: patch.scheduledEndDate } : {}),
        ...(patch.logbookTemplateId !== undefined ? { logbookTemplateId: patch.logbookTemplateId } : {}),
        ...(patch.supervisor !== undefined ? { supervisor: patch.supervisor } : {}),
        ...(patch.drawingNo !== undefined ? { drawingNo: patch.drawingNo } : {}),
        ...(patch.formulaNo !== undefined ? { formulaNo: patch.formulaNo } : {}),
        ...(patch.moldNo !== undefined ? { moldNo: patch.moldNo } : {}),
        ...(patch.productName !== undefined ? { productName: patch.productName } : {}),
        ...(nextPlannedQuantity !== undefined ? { plannedQuantity: nextPlannedQuantity } : {}),
        ...(patch.taskSequence !== undefined ? { taskSequence: patch.taskSequence as Prisma.InputJsonValue } : {}),
        version: { increment: 1 },
      },
        });
        if (updateCount.count !== 1) throw new ApiError(409, 'version_conflict', 'The production plan changed while it was being updated.');
        await syncDraftHeaderFromPlan(tx as never, id, orgId, { templateChanged });
        const updated = await tx.productionPlan.findUniqueOrThrow({ where: { id } });
        await audit(tx, { action: 'plan.update', entity: 'ProductionPlan', entityId: id, before: plan, after: updated });
        const currentTotal = await tx.productionPlan.aggregate({
          where: { operationalOrderId: plan.operationalOrderId }, _sum: { plannedQuantity: true },
        });
        await tx.operationalOrder.update({
          where: { id: plan.operationalOrderId },
          data: {
            status: (currentTotal._sum.plannedQuantity ?? new Prisma.Decimal(0)).gte(plan.operationalOrder.quantity) ? 'planned' : 'partially_planned',
            rowVersion: { increment: 1 },
          },
        });
        const result = await tx.productionPlan.findUniqueOrThrow({ where: { id }, include: planInclude });
        return planDto(result);
      },
    });
  } catch (error) {
    return translateScheduleConflict(error);
  }
}

/** Release a plan — remove draft logbook (if any) and return the order to the planning queue. */
export async function releasePlan(id: string, input: PlanRelease, idempotencyKey: string) {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  return runMesaOpsIdempotent({
    scope: `production-plan.release:${id}`, key: idempotencyKey, payload: input,
    execute: async (tx) => {
      const pointer = await tx.productionPlan.findFirst({
        where: { id, ...(plants ? { operationalOrder: { plantCode: plants } } : {}) },
        select: { operationalOrderId: true },
      });
      if (!pointer) throw new ApiError(404, 'not_found', 'Plan not found.');
      await lockOrder(tx, pointer.operationalOrderId);
      await lockPlan(tx, id);
      const plan = await tx.productionPlan.findFirst({
        where: { id, ...(plants ? { operationalOrder: { plantCode: plants } } : {}) },
        include: { logbook: { select: { id: true, status: true } }, operationalOrder: { select: { plantCode: true } } },
      });
      if (!plan) throw new ApiError(404, 'not_found', 'Plan not found.');
      if (plan.version !== input.expectedVersion) throw new ApiError(409, 'version_conflict', 'The production plan changed. Refresh it and try again.');
      if (plan.logbook?.status === 'submitted') {
        throw new ApiError(409, 'plan_locked', 'Cannot release a plan whose logbook is already submitted.');
      }
      if (plan.logbook) await tx.machineLogbook.delete({ where: { id: plan.logbook.id } });
      await tx.productionPlan.delete({ where: { id } });
      const remainingPlans = await tx.productionPlan.aggregate({
        where: { operationalOrderId: plan.operationalOrderId }, _sum: { plannedQuantity: true },
      });
      const order = await tx.operationalOrder.findUniqueOrThrow({ where: { id: plan.operationalOrderId } });
      const remainingTotal = remainingPlans._sum.plannedQuantity ?? new Prisma.Decimal(0);
      await tx.operationalOrder.update({
        where: { id: order.id },
        data: {
          status: remainingTotal.eq(0) ? 'ready_to_plan' : remainingTotal.gte(order.quantity) ? 'planned' : 'partially_planned',
          rowVersion: { increment: 1 },
        },
      });
      if (plan.salesOrderId) {
        await tx.salesOrder.update({ where: { id: plan.salesOrderId }, data: { status: remainingTotal.eq(0) ? 'pending' : 'planned', version: { increment: 1 } } });
      }
      await audit(tx, { action: 'plan.release', entity: 'ProductionPlan', entityId: id, before: plan });
      return { ok: true, releasedPlanId: id };
    },
  });
}
