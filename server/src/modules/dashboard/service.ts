import { prisma } from '../../db';

/** Real, tenant-scoped KPI aggregates that back every role's dashboard. All
 *  counts come from the live value-chain tables (no mock data). */
export async function summary() {
  const [
    ordersPending, ordersPlanned, ordersDispatched,
    inquiriesOpen, plansScheduled, plansRunning,
    logbooksSubmitted, complaintsOpen, capasOpen,
    customers, maintenanceOpen,
  ] = await Promise.all([
    prisma.salesOrder.count({ where: { status: 'pending' } }),
    prisma.salesOrder.count({ where: { status: 'planned' } }),
    prisma.salesOrder.count({ where: { status: 'dispatched' } }),
    prisma.inquiry.count({ where: { status: { in: ['submitted', 'quotation'] } } }),
    prisma.productionPlan.count({ where: { status: 'scheduled' } }),
    prisma.productionPlan.count({ where: { status: 'running' } }),
    prisma.machineLogbook.count({ where: { status: 'submitted' } }),
    prisma.complaint.count({ where: { status: { not: 'resolved' } } }),
    prisma.cAPARecord.count({ where: { status: { not: 'closed' } } }),
    prisma.customer.count(),
    prisma.maintenanceTask.count({ where: { status: { in: ['scheduled', 'overdue'] } } }),
  ]);

  // RM / FG on-hand from the append-only inventory ledger (in − out).
  const txns = await prisma.inventoryTransaction.findMany({ select: { type: true, direction: true, quantity: true } });
  const net = (type: string) =>
    txns.filter((t) => t.type === type).reduce((s, t) => s + (t.direction === 'in' ? t.quantity : -t.quantity), 0);

  return {
    orders: { pending: ordersPending, planned: ordersPlanned, dispatched: ordersDispatched },
    inquiriesOpen,
    plans: { scheduled: plansScheduled, running: plansRunning },
    logbooksSubmitted,
    complaintsOpen,
    capasOpen,
    customers,
    maintenanceOpen,
    stock: { rawMaterialKg: Math.round(net('raw_material')), finishedGoodsKg: Math.round(net('finished_goods')) },
  };
}
