import { Prisma } from '@prisma/client';
import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { nextNumber } from '../../lib/ids';
import { canonicalHash } from '../../lib/canonical';
import { runMesaOpsIdempotent } from '../../lib/mesaOpsIdempotency';
import { appendMesaOpsOutboxEvent } from '../../lib/mesaOpsOutbox';
import { plantCodeFilter, resolveMesaOpsPlantScope } from '../../lib/mesaOpsScope';
import { ApiError } from '../../middleware/error';
import type { DispatchCreate } from './schemas';
import { selectStatutoryProfile, verifyMesaOpsStatutoryEvidence } from './statutory';

type Tx = Prisma.TransactionClient;
type TraceRow = {
  lotNumber?: string;
  pktKg?: string | number;
  quantity?: string | number;
  pieces?: string | number;
  nos?: string | number;
};

function ctx() {
  const current = tenantContext.getStore();
  if (!current) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return current;
}
const today = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const decimal = (value: unknown): Prisma.Decimal => {
  try { return new Prisma.Decimal(String(value || 0)); } catch { return new Prisma.Decimal(0); }
};
const positive = (value: unknown): Prisma.Decimal => Prisma.Decimal.max(decimal(value), 0);
const isWeightUom = (uom: string) => ['kg', 'kgs', 'kilogram', 'kilograms'].includes(uom.trim().toLowerCase());

interface DispatchEvidence {
  completedQuantity: Prisma.Decimal;
  packedQuantity: Prisma.Decimal;
  qaReleasedQuantity: Prisma.Decimal;
  previouslyDispatchedQuantity: Prisma.Decimal;
  availableQuantity: Prisma.Decimal;
  snapshot: Record<string, unknown>;
}

async function dispatchEvidence(tx: Tx, operationalOrderId: string, plantCode: string, uom: string): Promise<DispatchEvidence> {
  const plans = await tx.productionPlan.findMany({
    where: { operationalOrderId, logbook: { status: 'submitted' } },
    select: {
      id: true,
      version: true,
      plannedQuantity: true,
      logbook: { select: { id: true, version: true, totalRollKgs: true, totalRollsProduced: true, traceabilityRows: true } },
    },
  });
  const weighted = isWeightUom(uom);
  let completedQuantity = new Prisma.Decimal(0);
  const lots = new Map<string, { planId: string; logbookId: string; packedQuantity: Prisma.Decimal }>();
  for (const plan of plans) {
    const logbook = plan.logbook;
    if (!logbook) continue;
    completedQuantity = completedQuantity.plus(positive(weighted ? logbook.totalRollKgs : logbook.totalRollsProduced));
    for (const row of (Array.isArray(logbook.traceabilityRows) ? logbook.traceabilityRows : []) as TraceRow[]) {
      const lotNumber = String(row.lotNumber || '').trim();
      if (!lotNumber || lots.has(lotNumber)) continue;
      const rowQuantity = weighted
        ? positive(row.pktKg)
        : positive(row.quantity ?? row.pieces ?? row.nos ?? 1);
      lots.set(lotNumber, { planId: plan.id, logbookId: logbook.id, packedQuantity: rowQuantity });
    }
  }

  const inspections = lots.size > 0
    ? await tx.qualityInspection.findMany({
      where: { lotNumber: { in: [...lots.keys()] }, plantCode, decision: 'pass' },
      select: { id: true, lotNumber: true, weight: true, version: true },
    })
    : [];
  const passedByLot = new Map(inspections.map((inspection) => [inspection.lotNumber, inspection]));
  let packedQuantity = new Prisma.Decimal(0);
  let qaReleasedQuantity = new Prisma.Decimal(0);
  const releasedLots: Array<Record<string, unknown>> = [];
  for (const [lotNumber, lot] of lots) {
    const inspection = passedByLot.get(lotNumber);
    if (!inspection) continue;
    const released = weighted ? positive(inspection.weight) : lot.packedQuantity;
    const packed = lot.packedQuantity.gt(0) ? lot.packedQuantity : released;
    packedQuantity = packedQuantity.plus(packed);
    qaReleasedQuantity = qaReleasedQuantity.plus(released);
    releasedLots.push({
      lotNumber,
      planId: lot.planId,
      logbookId: lot.logbookId,
      inspectionId: inspection.id,
      inspectionVersion: inspection.version,
      packedQuantity: packed.toString(),
      qaReleasedQuantity: released.toString(),
    });
  }

  const dispatched = await tx.dispatchRecord.aggregate({
    where: { operationalOrderId, status: { not: 'cancelled' } }, _sum: { quantity: true },
  });
  const previouslyDispatchedQuantity = dispatched._sum.quantity ?? new Prisma.Decimal(0);
  const boundedReleased = Prisma.Decimal.min(completedQuantity, packedQuantity, qaReleasedQuantity);
  const availableQuantity = Prisma.Decimal.max(boundedReleased.minus(previouslyDispatchedQuantity), 0);
  const snapshot = {
    policy: 'submitted-logbook+packed-lot+qa-pass:v1',
    uom,
    completedQuantity: completedQuantity.toString(),
    packedQuantity: packedQuantity.toString(),
    qaReleasedQuantity: qaReleasedQuantity.toString(),
    previouslyDispatchedQuantity: previouslyDispatchedQuantity.toString(),
    availableQuantity: availableQuantity.toString(),
    plans: plans.map((plan) => ({
      id: plan.id,
      version: plan.version,
      plannedQuantity: plan.plannedQuantity.toString(),
      logbookId: plan.logbook?.id,
      logbookVersion: plan.logbook?.version,
    })),
    releasedLots,
  };
  return { completedQuantity, packedQuantity, qaReleasedQuantity, previouslyDispatchedQuantity, availableQuantity, snapshot };
}

export async function listReady() {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  const orders = await prisma.operationalOrder.findMany({
    where: {
      status: { notIn: ['dispatched', 'cancelled'] },
      ...(plants ? { plantCode: plants } : {}),
      productionPlans: { some: { logbook: { status: 'submitted' } } },
    },
    include: { customer: { select: { name: true, deliveryAddress: true } } },
    orderBy: { dueDate: 'asc' },
  });
  const rows = [];
  for (const order of orders) {
    // Use an explicit tenant transaction for the cross-table evidence projection.
    const projected = await tenantTx((tx) => dispatchEvidence(tx as unknown as Tx, order.id, order.plantCode, order.uom));
    if (projected.availableQuantity.lte(0)) continue;
    rows.push({
      id: order.id,
      operationalOrderId: order.id,
      orderNumber: order.orderNumber,
      soNumber: order.orderNumber,
      product: order.productName,
      productName: order.productName,
      quantity: projected.availableQuantity.toString(),
      orderedQuantity: order.quantity.toString(),
      dispatchableQuantity: projected.availableQuantity.toString(),
      uom: order.uom,
      rowVersion: order.rowVersion,
      plantCode: order.plantCode,
      deliveryDate: order.dueDate?.toISOString().slice(0, 10) ?? '',
      priority: order.priority,
      sourceType: order.sourceType,
      customer: { name: order.customerName || order.customer?.name || 'Internal demand', deliveryAddress: order.customer?.deliveryAddress ?? '' },
    });
  }
  return rows;
}

export async function listDispatches() {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  const rows = await prisma.dispatchRecord.findMany({
    where: plants ? { operationalOrder: { plantCode: plants } } : undefined,
    include: {
      operationalOrder: { select: { orderNumber: true, productName: true, customerName: true, plantCode: true } },
      salesOrder: { select: { soNumber: true, product: true, customer: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((dispatch) => ({
    ...dispatch,
    quantity: dispatch.quantity.toString(),
    salesOrder: {
      soNumber: dispatch.operationalOrder.orderNumber,
      product: dispatch.operationalOrder.productName,
      customer: { name: dispatch.operationalOrder.customerName || dispatch.salesOrder?.customer.name || 'Internal demand' },
    },
  }));
}

/** Dispatch only the explicit quantity proven completed, packed and QA-passed. */
export async function createDispatch(input: DispatchCreate, idempotencyKey: string) {
  const current = ctx();
  const operationalOrderId = input.operationalOrderId ?? input.salesOrderId as string;
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  return runMesaOpsIdempotent({
    scope: 'dispatch.create', key: idempotencyKey, payload: input,
    execute: async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "OperationalOrder" WHERE "id" = ${operationalOrderId} FOR UPDATE`;
      const order = await tx.operationalOrder.findFirst({
        where: { id: operationalOrderId, ...(plants ? { plantCode: plants } : {}) },
        include: {
          customer: { select: { id: true, name: true, deliveryAddress: true } },
          sourceLink: {
            select: {
              id: true, legalEntityId: true, sourceService: true, sourceType: true,
              sourceId: true, sourceSnapshotHash: true, correlationId: true,
            },
          },
        },
      });
      if (!order) throw new ApiError(404, 'not_found', 'Order not found.');
      if (order.rowVersion !== input.expectedOrderVersion) {
        throw new ApiError(409, 'version_conflict', 'The operational order changed. Refresh dispatch readiness and try again.');
      }
      if (order.status === 'dispatched') throw new ApiError(409, 'already_dispatched', `${order.orderNumber} is already dispatched.`);

      const evidence = await dispatchEvidence(tx, order.id, order.plantCode, order.uom);
      const quantity = new Prisma.Decimal(input.quantity);
      const orderRemainingQuantity = Prisma.Decimal.max(order.quantity.minus(evidence.previouslyDispatchedQuantity), 0);
      const dispatchableQuantity = Prisma.Decimal.min(evidence.availableQuantity, orderRemainingQuantity);
      if (quantity.gt(dispatchableQuantity)) {
        throw new ApiError(409, 'quantity_not_released', `Only ${dispatchableQuantity.toString()} ${order.uom} remains ordered, completed, packed, QA-released and not yet dispatched.`);
      }

      const profile = await selectStatutoryProfile(tx, {
        businessDate: today(),
        countryCode: 'IN',
        plantCode: order.plantCode,
        movementType: input.movementType,
      });
      const verifiedEvidence = verifyMesaOpsStatutoryEvidence(
        current.organizationId,
        order.id,
        profile,
        input.statutoryEvidence,
      );

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${current.organizationId}:dispatch-number`}, 0))`;
      const nums = await tx.dispatchRecord.findMany({ select: { invoiceNumber: true, gatePassNumber: true } });
      const dispatchReference = verifiedEvidence?.invoiceReference
        || nextNumber(nums.map((record) => record.invoiceNumber), `NON-TAX-DSP-${new Date().getFullYear()}-`, 800);
      const gatePassNumber = nextNumber(nums.map((record) => record.gatePassNumber), `GP-${new Date().getFullYear()}-`, 1);
      const evidenceSnapshot = {
        ...evidence.snapshot,
        orderQuantity: order.quantity.toString(),
        orderRemainingQuantity: orderRemainingQuantity.toString(),
        dispatchableQuantity: dispatchableQuantity.toString(),
        dispatchQuantity: quantity.toString(),
      };
      const evidenceHash = canonicalHash(evidenceSnapshot);
      const statutoryArtifact = verifiedEvidence ? {
        source: verifiedEvidence.source,
        verificationId: verifiedEvidence.verificationId,
        verifiedAt: verifiedEvidence.verifiedAt,
        ...(verifiedEvidence.validUntil ? { validUntil: verifiedEvidence.validUntil } : {}),
        artifactHash: verifiedEvidence.artifactHash,
        artifact: verifiedEvidence.artifact,
      } : {};
      const dispatch = await tx.dispatchRecord.create({
        data: {
          organizationId: current.organizationId,
          invoiceNumber: dispatchReference,
          gatePassNumber,
          eWayBillNumber: verifiedEvidence?.eWayBillReference ?? '',
          statutoryRequired: profile.requiresInvoice || profile.requiresEWayBill,
          statutoryArtifact: statutoryArtifact as Prisma.InputJsonValue,
          statutoryProfileVersion: profile.version,
          statutoryEvidenceHash: verifiedEvidence ? canonicalHash(verifiedEvidence) : '',
          evidenceSnapshot: evidenceSnapshot as Prisma.InputJsonValue,
          evidenceHash,
          quantity,
          uom: order.uom,
          operationalOrderId: order.id,
          salesOrderId: order.legacySalesOrderId,
          vehicleNumber: input.vehicleNumber,
          transporter: input.transporter,
          driverName: input.driverName,
          dispatchDate: today(),
          deliveryAddress: order.customer?.deliveryAddress ?? '',
          etaDate: input.etaDate,
          status: 'shipped',
        },
        include: { operationalOrder: { select: { orderNumber: true } } },
      });

      const totalAfter = evidence.previouslyDispatchedQuantity.plus(quantity);
      const fullyDispatched = totalAfter.gte(order.quantity);
      const orderUpdate = await tx.operationalOrder.updateMany({
        where: { id: order.id, rowVersion: input.expectedOrderVersion },
        data: { status: fullyDispatched ? 'dispatched' : 'packed', rowVersion: { increment: 1 } },
      });
      if (orderUpdate.count !== 1) throw new ApiError(409, 'version_conflict', 'The operational order changed while dispatch was being recorded.');
      if (fullyDispatched && order.legacySalesOrderId) {
        await tx.salesOrder.update({ where: { id: order.legacySalesOrderId }, data: { status: 'dispatched', version: { increment: 1 } } });
      }
      await tx.inventoryTransaction.create({
        data: {
          organizationId: current.organizationId, plantCode: order.plantCode,
          type: 'finished_goods', direction: 'out', itemCode: order.productCode || order.orderNumber,
          itemName: order.productName, quantity: quantity.toNumber(), unit: order.uom,
          reference: `Dispatch ${dispatchReference}`, date: today(), handler: current.email,
        },
      });
      await audit(tx, { action: 'order.dispatch', entity: 'DispatchRecord', entityId: dispatch.id, after: { dispatch, evidenceHash, profile: profile.version } });
      const link = order.sourceLink;
      await appendMesaOpsOutboxEvent(tx, {
        legalEntityId: link?.legalEntityId,
        aggregateType: 'DispatchRecord',
        aggregateId: dispatch.id,
        eventType: 'mesaops.physical-dispatch.completed.v1',
        sourceLink: link ? {
          sourceLinkId: link.id,
          sourceService: link.sourceService,
          sourceType: link.sourceType,
          sourceId: link.sourceId,
          sourceSnapshotHash: link.sourceSnapshotHash,
          correlationId: link.correlationId,
        } : null,
        snapshot: {
          businessDate: dispatch.dispatchDate,
          dispatchId: dispatch.id,
          dispatchVersion: dispatch.version,
          operationalOrderId: order.id,
          operationalOrderNumber: order.orderNumber,
          plantCode: order.plantCode,
          warehouseSource: order.plantCode,
          productCode: order.productCode || order.orderNumber,
          productName: order.productName,
          customerReference: order.customerId || order.customerName,
          customerName: order.customerName || order.customer?.name || '',
          quantity: dispatch.quantity.toString(),
          uom: dispatch.uom.toUpperCase(),
          invoiceReference: dispatch.invoiceNumber,
          gatePassNumber: dispatch.gatePassNumber,
          eWayBillNumber: dispatch.eWayBillNumber,
          vehicleNumber: dispatch.vehicleNumber,
          transporter: dispatch.transporter,
          driverName: dispatch.driverName,
          deliveryAddress: dispatch.deliveryAddress,
          etaDate: dispatch.etaDate,
          statutoryRequired: dispatch.statutoryRequired,
          statutoryProfileVersion: dispatch.statutoryProfileVersion,
          statutoryEvidenceHash: dispatch.statutoryEvidenceHash,
          operationalEvidenceHash: evidenceHash,
          evidenceSnapshot,
          originLegalEntityId: link?.legalEntityId ?? null,
        },
        causationId: order.id,
      });
      return { ...dispatch, quantity: dispatch.quantity.toString() };
    },
  });
}
