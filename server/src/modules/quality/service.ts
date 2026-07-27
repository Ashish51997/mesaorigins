import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { ApiError } from '../../middleware/error';
import type { InspectionCreate } from './schemas';

function ctx() {
  const c = tenantContext.getStore();
  if (!c) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return c;
}
const today = () => new Date().toISOString().slice(0, 10);

interface TraceRow { lotNumber?: string; colour?: string; code?: string; winderPackedBy?: string }
export interface QueueItem { lotNumber: string; colour: string; code: string; machineId: string; date: string; product: string }

/** Packed rolls (lots) from submitted logbooks that haven't been inspected yet.
 *  This is what closes the audit's "produced rolls never reach the QA queue". */
export async function listQueue(): Promise<QueueItem[]> {
  const logbooks = await prisma.machineLogbook.findMany({
    where: { status: 'submitted' },
    select: { machineId: true, date: true, productName: true, traceabilityRows: true },
  });
  const inspected = new Set((await prisma.qualityInspection.findMany({ select: { lotNumber: true } })).map((i) => i.lotNumber));
  const queue: QueueItem[] = [];
  for (const lb of logbooks) {
    for (const r of (lb.traceabilityRows as unknown as TraceRow[]) ?? []) {
      const lot = (r.lotNumber ?? '').trim();
      if (lot && !inspected.has(lot)) {
        queue.push({ lotNumber: lot, colour: r.colour ?? '', code: r.code ?? '', machineId: lb.machineId, date: lb.date, product: lb.productName });
      }
    }
  }
  return queue;
}

/** Inspection history (includes holds). */
export function listInspections() {
  return prisma.qualityInspection.findMany({ orderBy: { createdAt: 'desc' } });
}

/** Record a QA decision for a packed roll. A pass books finished-goods stock. */
export async function createInspection(input: InspectionCreate) {
  const c = ctx();
  if (await prisma.qualityInspection.findFirst({ where: { lotNumber: input.lotNumber } })) {
    throw new ApiError(409, 'already_inspected', `Lot ${input.lotNumber} has already been inspected.`);
  }
  const item = (await listQueue()).find((q) => q.lotNumber === input.lotNumber);
  if (!item) throw new ApiError(422, 'unknown_lot', 'That lot is not a packed roll awaiting inspection.');

  return tenantTx(async (tx) => {
    const inspection = await tx.qualityInspection.create({
      data: {
        organizationId: c.organizationId,
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
          organizationId: c.organizationId, type: 'finished_goods', direction: 'in',
          itemCode: item.code || item.lotNumber, itemName: item.product || 'Finished roll',
          quantity: input.weight, unit: 'kg', lotNumber: input.lotNumber,
          reference: `QA pass · ${input.lotNumber}`, date: today(), handler: c.email,
        },
      });
    }
    await audit(tx, { action: `qa.${input.decision}`, entity: 'QualityInspection', entityId: inspection.id, after: inspection });
    return inspection;
  });
}
