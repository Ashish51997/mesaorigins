import { Prisma } from '@prisma/client';
import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { appendMesaOpsOutboxEvent, type MesaOpsSourceLinkEvidence } from '../../lib/mesaOpsOutbox';
import { ApiError } from '../../middleware/error';
import { plantCodeFilter, resolveMesaOpsPlantScope } from '../../lib/mesaOpsScope';
import type { InspectionCreate } from './schemas';

function ctx() {
  const c = tenantContext.getStore();
  if (!c) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return c;
}
const today = () => new Date().toISOString().slice(0, 10);

interface TraceRow { lotNumber?: string; colour?: string; code?: string; winderPackedBy?: string }
export interface QueueItem {
  lotNumber: string;
  colour: string;
  code: string;
  machineId: string;
  date: string;
  product: string;
  plantCode: string;
  logbookId: string;
  productionPlanId: string;
  operationalOrderId: string;
  operationalOrderNumber: string;
  productCode: string;
  legalEntityId: string | null;
  sourceLink: MesaOpsSourceLinkEvidence | null;
}

/** Packed rolls (lots) from submitted logbooks that haven't been inspected yet.
 *  This is what closes the audit's "produced rolls never reach the QA queue". */
export async function listQueue(): Promise<QueueItem[]> {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  const logbooks = await prisma.machineLogbook.findMany({
    where: { status: 'submitted', ...(plants ? { productionPlan: { operationalOrder: { plantCode: plants } } } : {}) },
    select: {
      id: true, machineId: true, date: true, productName: true, traceabilityRows: true,
      productionPlan: {
        select: {
          id: true,
          operationalOrder: {
            select: {
              id: true, orderNumber: true, productCode: true, productName: true, plantCode: true,
              sourceLink: {
                select: {
                  id: true, legalEntityId: true, sourceService: true, sourceType: true,
                  sourceId: true, sourceSnapshotHash: true, correlationId: true,
                },
              },
            },
          },
        },
      },
    },
  });
  const inspected = new Set((await prisma.qualityInspection.findMany({
    where: plants ? { plantCode: plants } : undefined, select: { plantCode: true, lotNumber: true },
  })).map((i) => `${i.plantCode}\u0000${i.lotNumber}`));
  const queue: QueueItem[] = [];
  for (const lb of logbooks) {
    for (const r of (lb.traceabilityRows as unknown as TraceRow[]) ?? []) {
      const lot = (r.lotNumber ?? '').trim();
      const order = lb.productionPlan.operationalOrder;
      if (lot && !inspected.has(`${order.plantCode}\u0000${lot}`)) {
        const link = order.sourceLink;
        queue.push({
          lotNumber: lot,
          colour: r.colour ?? '',
          code: r.code ?? '',
          machineId: lb.machineId,
          date: lb.date,
          product: lb.productName,
          plantCode: order.plantCode,
          logbookId: lb.id,
          productionPlanId: lb.productionPlan.id,
          operationalOrderId: order.id,
          operationalOrderNumber: order.orderNumber,
          productCode: order.productCode || r.code || order.orderNumber,
          legalEntityId: link?.legalEntityId ?? null,
          sourceLink: link ? {
            sourceLinkId: link.id,
            sourceService: link.sourceService,
            sourceType: link.sourceType,
            sourceId: link.sourceId,
            sourceSnapshotHash: link.sourceSnapshotHash,
            correlationId: link.correlationId,
          } : null,
        });
      }
    }
  }
  return queue;
}

/** Inspection history (includes holds). */
export async function listInspections() {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  return prisma.qualityInspection.findMany({ where: plants ? { plantCode: plants } : undefined, orderBy: { createdAt: 'desc' } });
}

/** Record a QA decision for a packed roll. A pass books finished-goods stock. */
export async function createInspection(input: InspectionCreate) {
  const c = ctx();
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  const candidates = (await listQueue()).filter((q) => q.lotNumber === input.lotNumber);
  if (candidates.length > 1) {
    throw new ApiError(409, 'lot_plant_ambiguous', 'This lot number is awaiting inspection in more than one accessible plant; use a plant-specific assignment before deciding it.');
  }
  const item = candidates[0];
  if (!item) {
    const existing = await prisma.qualityInspection.findFirst({
      where: {
        organizationId: c.organizationId,
        lotNumber: input.lotNumber,
        ...(plants ? { plantCode: plants } : {}),
      },
      select: { plantCode: true },
    });
    if (existing) {
      throw new ApiError(409, 'already_inspected', `Lot ${input.lotNumber} has already been inspected in plant ${existing.plantCode}.`);
    }
    throw new ApiError(422, 'unknown_lot', 'That lot is not a packed roll awaiting inspection.');
  }

  return tenantTx(async (tx) => {
    // Serialize the complete QA decision and finished-goods booking for this
    // tenant/plant/packed unit. The unique roll index in the companion
    // migration is the database backstop for import and alternate writer paths.
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${c.organizationId}:${item.plantCode}:${input.lotNumber}:qa-final`}, 0)
      )
    `);
    const existing = await tx.qualityInspection.findFirst({
      where: {
        organizationId: c.organizationId,
        plantCode: item.plantCode,
        lotNumber: input.lotNumber,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ApiError(409, 'already_inspected', `Lot ${input.lotNumber} has already been inspected in plant ${item.plantCode}.`);
    }
    const inspection = await tx.qualityInspection.create({
      data: {
        organizationId: c.organizationId,
        plantCode: item.plantCode,
        rollNumber: input.lotNumber, lotNumber: input.lotNumber, dimensions: input.dimensions,
        finish: input.finish, weight: input.weight, colour: input.colour, tearingTest: input.tearingTest,
        remarks: input.remarks, decision: input.decision, inspectedBy: c.email, date: today(),
      },
    });
    // A pass makes the roll real, dispatchable finished-goods stock (fixes the
    // audit's "QA pass books no inventory / no dispatchable pallet" blocker).
    if (input.decision === 'pass') {
      await tx.inventoryTransaction.create({
        data: {
          organizationId: c.organizationId, plantCode: item.plantCode, type: 'finished_goods', direction: 'in',
          itemCode: item.code || item.lotNumber, itemName: item.product || 'Finished roll',
          quantity: input.weight, unit: 'kg', lotNumber: input.lotNumber,
          reference: `QA pass · ${input.lotNumber}`, date: today(), handler: c.email,
        },
      });
    }
    await audit(tx, { action: `qa.${input.decision}`, entity: 'QualityInspection', entityId: inspection.id, after: inspection });
    const snapshot = {
      businessDate: inspection.date || today(),
      inspectionId: inspection.id,
      inspectionVersion: inspection.version,
      operationalOrderId: item.operationalOrderId,
      operationalOrderNumber: item.operationalOrderNumber,
      productionPlanId: item.productionPlanId,
      logbookId: item.logbookId,
      plantCode: item.plantCode,
      productCode: item.productCode,
      productName: item.product,
      lotNumber: inspection.lotNumber,
      quantity: new Prisma.Decimal(String(input.weight || 0)).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toString(),
      uom: 'KG',
      disposition: input.decision === 'pass' ? 'accepted' : input.decision === 'hold' ? 'hold' : 'rejected',
      tests: {
        dimensions: structuredClone(inspection.dimensions),
        finish: inspection.finish,
        colour: inspection.colour,
        tearingTest: inspection.tearingTest,
      },
      remarks: inspection.remarks,
      inspectedBy: inspection.inspectedBy,
      originLegalEntityId: item.legalEntityId,
    };
    await appendMesaOpsOutboxEvent(tx as unknown as Prisma.TransactionClient, {
      legalEntityId: item.legalEntityId,
      aggregateType: 'QualityInspection',
      aggregateId: inspection.id,
      eventType: 'mesaops.qa-disposition.recorded.v1',
      sourceLink: item.sourceLink,
      snapshot,
      causationId: item.logbookId,
    });
    return inspection;
  });
}
