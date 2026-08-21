import { prisma } from '../../db';
import { plantCodeFilter, resolveMesaOpsPlantScope } from '../../lib/mesaOpsScope';
import { listQueue } from '../quality/service';
import { listReady } from '../dispatch/service';
import { listCapas, listComplaints } from '../capa/service';

/** Real, tenant-scoped KPI aggregates that back every role's dashboard. All
 *  counts come from the live value-chain tables (no mock data). */
export async function summary() {
  const plants = plantCodeFilter(await resolveMesaOpsPlantScope());
  const [
    ordersPending, ordersPlanned, ordersDispatched,
    inquiriesOpen, plansScheduled, plansRunning,
    logbooksSubmitted, complaints, capas,
    customers, maintenanceOpen,
  ] = await Promise.all([
    plants
      ? prisma.operationalOrder.count({ where: { plantCode: plants, status: { in: ['ready_to_plan', 'partially_planned'] } } })
      : prisma.salesOrder.count({ where: { status: 'pending' } }),
    plants
      ? prisma.operationalOrder.count({ where: { plantCode: plants, status: 'planned' } })
      : prisma.salesOrder.count({ where: { status: 'planned' } }),
    plants
      ? prisma.operationalOrder.count({ where: { plantCode: plants, status: 'dispatched' } })
      : prisma.salesOrder.count({ where: { status: 'dispatched' } }),
    prisma.inquiry.count({ where: { status: { in: ['submitted', 'quotation'] } } }),
    prisma.productionPlan.count({ where: { status: 'scheduled', ...(plants ? { operationalOrder: { plantCode: plants } } : {}) } }),
    prisma.productionPlan.count({ where: { status: 'running', ...(plants ? { operationalOrder: { plantCode: plants } } : {}) } }),
    prisma.machineLogbook.count({ where: { status: 'submitted', ...(plants ? { productionPlan: { operationalOrder: { plantCode: plants } } } : {}) } }),
    listComplaints(),
    listCapas(),
    prisma.customer.count(),
    prisma.maintenanceTask.count({ where: { status: { in: ['scheduled', 'overdue'] }, ...(plants ? { machine: { plantCode: plants } } : {}) } }),
  ]);

  // RM / FG on-hand from the append-only inventory ledger (in − out).
  const txns = await prisma.inventoryTransaction.findMany({
    where: plants ? { plantCode: plants } : undefined,
    select: { type: true, direction: true, quantity: true },
  });
  const net = (type: string) =>
    txns.filter((t) => t.type === type).reduce((s, t) => s + (t.direction === 'in' ? t.quantity : -t.quantity), 0);

  return {
    orders: { pending: ordersPending, planned: ordersPlanned, dispatched: ordersDispatched },
    inquiriesOpen,
    plans: { scheduled: plansScheduled, running: plansRunning },
    logbooksSubmitted,
    complaintsOpen: complaints.filter((complaint) => complaint.status !== 'resolved').length,
    capasOpen: capas.filter((capa) => capa.status !== 'closed').length,
    customers,
    maintenanceOpen,
    stock: { rawMaterialKg: Math.round(net('raw_material')), finishedGoodsKg: Math.round(net('finished_goods')) },
  };
}

// ── Management overview (MD home) ───────────────────────────────────────────

function todayIso(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return todayIso(d);
}

function currentShift(): 'D' | 'N' {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18 ? 'D' : 'N';
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function scrapKgOf(lb: {
  scrapKg: string;
  rejectionKg: string;
  processWasteKg: string;
  lumpsWasteKg: string;
}): number {
  return num(lb.scrapKg) + num(lb.rejectionKg) + num(lb.processWasteKg) + num(lb.lumpsWasteKg);
}

function scrapRateOf(lbs: Array<{
  scrapKg: string;
  rejectionKg: string;
  processWasteKg: string;
  lumpsWasteKg: string;
  totalConsumedKg: string;
  totalRollKgs: string;
}>): number {
  let scrap = 0;
  let base = 0;
  for (const lb of lbs) {
    scrap += scrapKgOf(lb);
    const consumed = num(lb.totalConsumedKg);
    const produced = num(lb.totalRollKgs);
    base += consumed > 0 ? consumed : produced;
  }
  if (base <= 0) return 0;
  return Math.round((scrap / base) * 10000) / 100;
}

type LogbookSlice = {
  date: string;
  scrapKg: string;
  rejectionKg: string;
  processWasteKg: string;
  lumpsWasteKg: string;
  totalConsumedKg: string;
  totalRollKgs: string;
};

async function submittedLogbooks(plants?: { in: string[] }): Promise<LogbookSlice[]> {
  return prisma.machineLogbook.findMany({
    where: { status: 'submitted', ...(plants ? { productionPlan: { operationalOrder: { plantCode: plants } } } : {}) },
    select: {
      date: true,
      scrapKg: true,
      rejectionKg: true,
      processWasteKg: true,
      lumpsWasteKg: true,
      totalConsumedKg: true,
      totalRollKgs: true,
    },
  });
}

function filterByDate(lbs: LogbookSlice[], date: string): LogbookSlice[] {
  return lbs.filter((lb) => lb.date === date);
}

async function otdForWindow(fromDate: string, toDate: string, plants?: { in: string[] }): Promise<number | null> {
  const rows = await prisma.dispatchRecord.findMany({
    where: { dispatchDate: { gte: fromDate, lte: toDate }, ...(plants ? { operationalOrder: { plantCode: plants } } : {}) },
    select: {
      dispatchDate: true,
      operationalOrder: { select: { dueDate: true } },
      salesOrder: { select: { deliveryDate: true } },
    },
  });
  if (rows.length === 0) return null;
  const onTime = rows.filter((r) => {
    const due = r.operationalOrder.dueDate?.toISOString().slice(0, 10)
      ?? (r.salesOrder?.deliveryDate || '').trim();
    if (!due) return true;
    return r.dispatchDate <= due;
  }).length;
  return Math.round((onTime / rows.length) * 1000) / 10;
}

/** Managing Director plant overview — live aggregates, no finance figures. */
export async function managementOverview() {
  const plants = plantCodeFilter(await resolveMesaOpsPlantScope());
  const asOf = todayIso();
  const yesterday = daysAgoIso(1);
  const shift = currentShift();
  const seriesStart = daysAgoIso(6);

  const [lbs, complaints, qaQueue, readyOrders, holds, overdueMaint, stockSummary] = await Promise.all([
    submittedLogbooks(plants),
    listComplaints().then((rows) => rows.filter((complaint) => complaint.status !== 'resolved')),
    listQueue(),
    listReady(),
    prisma.qualityInspection.findMany({
      where: { decision: 'hold', ...(plants ? { plantCode: plants } : {}) },
      select: { id: true, lotNumber: true, remarks: true },
      take: 10,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.maintenanceTask.findMany({
      where: { status: 'overdue', ...(plants ? { machine: { plantCode: plants } } : {}) },
      select: { id: true, taskName: true, machineId: true },
      take: 5,
    }),
    summary(),
  ]);

  const todayLbs = filterByDate(lbs, asOf);
  const ydayLbs = filterByDate(lbs, yesterday);

  const productionToday = todayLbs.reduce((s, lb) => s + num(lb.totalRollKgs), 0);
  const productionYday = ydayLbs.reduce((s, lb) => s + num(lb.totalRollKgs), 0);
  const scrapToday = scrapRateOf(todayLbs);
  const scrapYday = scrapRateOf(ydayLbs);

  // Prefer today; if empty, fall back to all-time submitted so the KPI isn't blank on a quiet day.
  const productionValue = productionToday > 0
    ? productionToday
    : lbs.reduce((s, lb) => s + num(lb.totalRollKgs), 0);
  const scrapValue = todayLbs.length > 0 ? scrapToday : scrapRateOf(lbs);

  const otdToday = await otdForWindow(asOf, asOf, plants);
  const otdYday = await otdForWindow(yesterday, yesterday, plants);
  const otdWeek = await otdForWindow(seriesStart, asOf, plants);
  const otdValue = otdToday ?? otdWeek ?? 0;

  const sev = (s: string) => s.trim().toLowerCase();
  const high = complaints.filter((c) => sev(c.severity) === 'high' || sev(c.severity) === 'critical').length;
  const medium = complaints.filter((c) => sev(c.severity) === 'medium').length;

  // 7-day production / scrap series (oldest → newest).
  const productionSeries: Array<{ date: string; productionKg: number; scrapKg: number }> = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = daysAgoIso(i);
    const dayLbs = filterByDate(lbs, date);
    productionSeries.push({
      date,
      productionKg: Math.round(dayLbs.reduce((s, lb) => s + num(lb.totalRollKgs), 0) * 10) / 10,
      scrapKg: Math.round(dayLbs.reduce((s, lb) => s + scrapKgOf(lb), 0) * 10) / 10,
    });
  }

  // Top open feedback themes by product + first line of description.
  const themeMap = new Map<string, { title: string; occurrences: number; openCount: number }>();
  for (const c of complaints) {
    const desc = (c.description || '').trim();
    const product = (c.product || '').trim();
    const title = desc
      ? (desc.length > 64 ? `${desc.slice(0, 61)}…` : desc)
      : (product || 'Unspecified quality issue');
    const key = title.toLowerCase();
    const cur = themeMap.get(key) ?? { title, occurrences: 0, openCount: 0 };
    cur.occurrences += 1;
    cur.openCount += 1;
    themeMap.set(key, cur);
  }
  const feedbackOpen = [...themeMap.values()]
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 5)
    .map((row, i) => ({ rank: i + 1, ...row }));

  const qaAlerts: string[] = [];
  if (qaQueue.length > 0) qaAlerts.push(`${qaQueue.length} roll${qaQueue.length === 1 ? '' : 's'} waiting for QA check`);
  if (holds.length > 0) qaAlerts.push(`${holds.length} roll${holds.length === 1 ? '' : 's'} on hold`);

  const dispatchAlerts: string[] = [];
  for (const o of readyOrders.slice(0, 3)) {
    dispatchAlerts.push(`${o.soNumber} ready — gate pass not released`);
  }

  const alerts: Array<{ id: string; severity: 'critical' | 'warning' | 'info'; message: string; href?: string }> = [];
  for (const t of overdueMaint) {
    alerts.push({
      id: `maint-${t.id}`,
      severity: 'critical',
      message: `Maintenance overdue: ${t.taskName || t.id}`,
      href: 'preventive',
    });
  }
  for (const h of holds.slice(0, 3)) {
    alerts.push({
      id: `hold-${h.id}`,
      severity: 'warning',
      message: `QA hold on lot ${h.lotNumber}${h.remarks ? ` — ${h.remarks}` : ''}`,
      href: 'holds',
    });
  }
  for (const c of complaints.filter((x) => sev(x.severity) === 'high' || sev(x.severity) === 'critical').slice(0, 3)) {
    alerts.push({
      id: `complaint-${c.id}`,
      severity: 'critical',
      message: c.description?.trim() || `High-severity complaint (${c.product || 'unknown product'})`,
      href: 'sales_complaints',
    });
  }
  if (stockSummary.stock.rawMaterialKg < 500) {
    alerts.push({
      id: 'rm-low',
      severity: 'warning',
      message: `Raw material on hand is low (${stockSummary.stock.rawMaterialKg} kg)`,
      href: 'rm_stock',
    });
  }

  return {
    context: { shift, asOf },
    kpis: {
      productionKg: {
        value: Math.round(productionValue * 10) / 10,
        trendPct: pctChange(productionToday, productionYday),
        vs: 'vs Yesterday',
      },
      scrapRatePct: {
        value: scrapValue,
        trendPct: todayLbs.length && ydayLbs.length ? pctChange(scrapToday, scrapYday) : null,
        vs: 'vs Yesterday',
      },
      onTimeDeliveryPct: {
        value: otdValue,
        trendPct: otdToday != null && otdYday != null ? pctChange(otdToday, otdYday) : null,
        vs: 'vs Yesterday',
      },
      complaints: {
        open: complaints.length,
        high,
        medium,
        low: Math.max(0, complaints.length - high - medium),
      },
    },
    productionSeries,
    feedbackOpen,
    queues: {
      qa: {
        waitingRolls: qaQueue.length,
        alerts: qaAlerts,
        actions: ['roll_queue'] as const,
      },
      dispatch: {
        vehicles: readyOrders.length,
        alerts: dispatchAlerts,
        actions: ['ready', 'dispatch_history'] as const,
      },
    },
    alerts: alerts.slice(0, 8),
  };
}
