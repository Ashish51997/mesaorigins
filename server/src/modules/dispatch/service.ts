import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { nextNumber } from '../../lib/ids';
import { ApiError } from '../../middleware/error';
import type { DispatchCreate } from './schemas';

function ctx() {
  const c = tenantContext.getStore();
  if (!c) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return c;
}
const today = () => new Date().toISOString().slice(0, 10);

// An order is dispatch-ready once its production is complete (a submitted
// logbook) and it hasn't shipped yet.
async function readyOrderIds(): Promise<string[]> {
  const plans = await prisma.productionPlan.findMany({ where: { logbook: { status: 'submitted' } }, select: { salesOrderId: true } });
  return [...new Set(plans.map((p) => p.salesOrderId))];
}

export async function listReady() {
  const ids = await readyOrderIds();
  if (ids.length === 0) return [];
  return prisma.salesOrder.findMany({
    where: { id: { in: ids }, status: { not: 'dispatched' } },
    include: { customer: { select: { name: true, deliveryAddress: true } } },
    orderBy: { deliveryDate: 'asc' },
  });
}

export function listDispatches() {
  return prisma.dispatchRecord.findMany({
    include: { salesOrder: { select: { soNumber: true, product: true, customer: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
}

/** Dispatch a produced order: create the record + invoice, mark the order
 *  dispatched, and book the finished-goods OUT movement. */
export async function createDispatch(input: DispatchCreate) {
  const c = ctx();
  const order = await prisma.salesOrder.findUnique({
    where: { id: input.salesOrderId },
    include: { customer: { select: { deliveryAddress: true } } },
  });
  if (!order) throw new ApiError(404, 'not_found', 'Order not found.');
  if (order.status === 'dispatched') throw new ApiError(409, 'already_dispatched', `${order.soNumber} is already dispatched.`);
  const produced = await prisma.productionPlan.findFirst({ where: { salesOrderId: order.id, logbook: { status: 'submitted' } } });
  if (!produced) throw new ApiError(409, 'not_ready', `${order.soNumber} is not ready — its production logbook has not been submitted.`);

  return tenantTx(async (tx) => {
    const nums = await tx.dispatchRecord.findMany({ select: { invoiceNumber: true } });
    const invoiceNumber = nextNumber(nums.map((d) => d.invoiceNumber), `INV-${new Date().getFullYear()}-`, 800);
    const dispatch = await tx.dispatchRecord.create({
      data: {
        organizationId: c.organizationId, invoiceNumber, salesOrderId: order.id,
        vehicleNumber: input.vehicleNumber, transporter: input.transporter, driverName: input.driverName,
        dispatchDate: today(), deliveryAddress: order.customer.deliveryAddress, etaDate: input.etaDate, status: 'shipped',
      },
      include: { salesOrder: { select: { soNumber: true } } },
    });
    await tx.salesOrder.update({ where: { id: order.id }, data: { status: 'dispatched', version: { increment: 1 } } });
    // Finished-goods leave stock (the dispatch ledger movement).
    await tx.inventoryTransaction.create({
      data: {
        organizationId: c.organizationId, type: 'finished_goods', direction: 'out',
        itemCode: order.soNumber, itemName: order.product, quantity: order.quantity, unit: 'units',
        reference: `Dispatch ${invoiceNumber}`, date: today(), handler: c.email,
      },
    });
    await audit(tx, { action: 'order.dispatch', entity: 'DispatchRecord', entityId: dispatch.id, after: dispatch });
    return dispatch;
  });
}
