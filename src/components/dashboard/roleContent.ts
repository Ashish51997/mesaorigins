/**
 * roleContent.ts — what each role sees on "Today".
 *
 * One builder per role, each returning the same RoleHomeContent shape so
 * RoleHome can stay a single template. The rules that hold across all of them:
 *
 *   • Lead with work. Tasks and alerts are built first; figures come last.
 *   • Speak in physical quantities — rolls, kg, tonnes, °C, days — never indices.
 *   • Every KPI and task carries an onOpen. A KPI whose target the role cannot
 *     open is dropped here (see `visibleKpis`) rather than rendered dead.
 *   • An alert is a short headline + chips + one action line, never a run-on
 *     sentence welding three facts together.
 *   • A task states its count once: the numeral is large and alone, and the
 *     sentence beside it never repeats the number.
 */

import {
  AlertTriangle, Beaker, Boxes, ClipboardCheck, ClipboardList, FileSpreadsheet,
  Gauge, PackageCheck, PauseCircle, Send, ShieldAlert, Thermometer, Truck, Wrench,
  Factory, Users, Layers, ClipboardPen, PackagePlus, ArrowDownToLine, CalendarClock,
} from 'lucide-react';
import type { LiveMachine } from '../../lib/simulation';
import type { RoleHomeContent, DashboardAlert, DashboardTask, KpiSpec } from './model';
import type { LineStatusView } from './LineStatusCard';
import type { PlantData, DashLogbook } from './plantData';
import { totalOnHand } from './plantData';
import {
  ORDER_STATUS, daysSince, daysUntil, responseClock, toLineState, qty, kg, tonnes, pct,
} from './statusLanguage';

export type { PlantData } from './plantData';

export interface RoleContext {
  role: string;
  user: string;
  shift: string;
  data: PlantData;
  live: LiveMachine[];
  /** True when the role may open that screen — drives card visibility. */
  canOpen: (screen: string) => boolean;
  /** Navigate, optionally seeding the destination's filter. */
  open: (screen: string, filter?: string) => void;
  now: Date;
}

/* ---------------------------------------------------------------- helpers */

const byId = <T extends { id: string }>(rows: T[], id: string): T | undefined =>
  rows.find((r) => r.id === id);

const customerName = (data: PlantData, id: string): string =>
  byId(data.customers, id)?.name ?? id;

/** Drop cards the role cannot open — a card must never lead to a locked door. */
const visibleKpis = (ctx: RoleContext, kpis: KpiSpec[]): KpiSpec[] =>
  kpis.filter((k) => ctx.canOpen(k.target));

/** Drop tasks whose screen the role cannot open, for the same reason. */
const visibleTasks = (ctx: RoleContext, entries: { task: DashboardTask; target: string }[]): DashboardTask[] =>
  entries.filter((e) => ctx.canOpen(e.target)).map((e) => e.task);

/** Rolls still awaiting a QA verdict, across every shift logbook. */
function rollsAwaitingQa(data: PlantData): number {
  let n = 0;
  for (const lb of data.machineLogbooks) {
    for (const r of lb.rolls) if (r.status === 'pending') n += 1;
  }
  return n;
}

/** The first few rolls behind that count, so the queue row is concrete. */
function rollsWaitingPreview(data: PlantData): string[] {
  const out: string[] = [];
  for (const lb of data.machineLogbooks) {
    for (const r of lb.rolls) {
      if (r.status !== 'pending') continue;
      out.push(`${r.rollNumber} · ${lb.machineId}`);
      if (out.length === 3) return out;
    }
  }
  return out;
}

/** The lower end of a machine's melt range; the simulation only carries the limit. */
const meltFloor = (limit: number): number => limit - 20;

/**
 * Join a sentence to a trailing clause without doubling its full stop — the
 * source text (a CAPA lock reason, a stop reason) often already ends in one.
 */
function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Live machine alerts. The headline carries the single fact; the machine and
 * the reason travel as chips so the headline stays one readable line.
 * `only` restricts to one operator's machines; empty means the whole plant.
 */
function machineAlerts(ctx: RoleContext, only: string[]): DashboardAlert[] {
  const scope = only.length > 0 ? ctx.live.filter((m) => only.includes(m.id)) : ctx.live;
  const out: DashboardAlert[] = [];

  for (const m of scope) {
    const line = m.id.replace(/^M/, '');
    if (m.status === 'stopped') {
      out.push({
        id: `line-stopped-${m.id}`,
        headline: `Line ${line} is stopped`,
        chips: [`Machine ${m.id}`, ...(m.reason ? [m.reason] : [])],
        todo: 'Tell the maintenance head now and record the stop reason in the log book.',
        tone: 'red',
        critical: true,
        ...(ctx.canOpen('machine_tasks') ? { onOpen: () => ctx.open('machine_tasks') } : {}),
      });
    } else if (m.status === 'attention' || m.zoneTemp > m.limit) {
      out.push({
        id: `line-temp-${m.id}`,
        headline: `Line ${line} is ${Math.round(m.zoneTemp)} °C, over the limit`,
        chips: [`Machine ${m.id}`, `Limit ${m.limit} °C`],
        todo: 'Inform the shift supervisor before winding the next roll.',
        tone: 'amber',
        critical: true,
        ...(ctx.canOpen('machine_tasks') ? { onOpen: () => ctx.open('machine_tasks') } : {}),
      });
    }
  }
  return out;
}

/** Machines this person is running this shift, from the plan board. */
function machinesForOperator(data: PlantData, user: string): string[] {
  const mine = data.productionPlans
    .filter((p) => p.operatorName === user && p.status !== 'completed')
    .map((p) => p.machineId);
  return mine.length > 0 ? [...new Set(mine)] : [];
}

/** Turn live machine state into the LineStatusCard view model. */
export function lineViews(ctx: RoleContext, machineIds: string[]): LineStatusView[] {
  return machineIds.flatMap((id) => {
    const liveMachine = ctx.live.find((m) => m.id === id);
    if (!liveMachine) return [];
    const registry = ctx.data.machines.find((m) => m.id === id);
    const plan = ctx.data.productionPlans.find((p) => p.machineId === id && p.status === 'running')
      ?? ctx.data.productionPlans.find((p) => p.machineId === id);
    const order = plan ? byId(ctx.data.salesOrders, plan.salesOrderId) : undefined;

    // Produced weight for this machine comes from the shift log book's roll register.
    const logbook = plan
      ? ctx.data.machineLogbooks.find((lb) => lb.productionPlanId === plan.id)
      : undefined;
    const producedKg = logbook
      ? logbook.rolls.reduce((sum, r) => sum + r.weight, 0)
      : liveMachine.rollsDone * 25;

    return [{
      machineId: id,
      line: registry?.line ?? 'Extrusion line',
      state: liveMachine.status,
      reason: liveMachine.reason ?? registry?.statusReason,
      operator: plan?.operatorName ?? 'Not assigned',
      orderLabel: order
        ? `${order.soNumber} · ${order.product}`
        : registry?.currentProduct ?? 'No order loaded',
      producedKg,
      targetKg: order?.quantity ?? 2000,
      meltTemp: liveMachine.zoneTemp,
      meltMin: meltFloor(liveMachine.limit),
      meltMax: liveMachine.limit,
      updatedAt: liveMachine.updatedAt,
      onOpen: () => ctx.open('machine_tasks'),
    }];
  });
}

/* ------------------------------------------------------------- Operator */

function operatorHome(ctx: RoleContext): RoleHomeContent {
  const mine = machinesForOperator(ctx.data, ctx.user);
  // Fall back to the running machines so a demo operator is never shown a blank
  // floor just because the seeded plan names somebody else.
  const lines = mine.length > 0
    ? mine
    : ctx.live.filter((m) => m.status !== 'stopped').slice(0, 1).map((m) => m.id);

  const myPlans = ctx.data.productionPlans.filter((p) => lines.includes(p.machineId));
  const myLogbooks = ctx.data.machineLogbooks.filter((lb) =>
    myPlans.some((p) => p.id === lb.productionPlanId));

  const rollsToday = myLogbooks.reduce((n, lb) => n + lb.rolls.length, 0);
  const kgToday = myLogbooks.reduce((n, lb) => n + lb.rolls.reduce((s, r) => s + r.weight, 0), 0);
  const unfinished = myLogbooks.filter((lb) => lb.status === 'draft').length;
  const hour = ctx.now.getHours();
  const slot = `${String(hour).padStart(2, '0')}:00`;

  const tasks = visibleTasks(ctx, [
    {
      target: 'machine_tasks',
      task: {
        id: 'op-hourly',
        label: `Hour ${slot} reading not yet entered`,
        icon: ClipboardPen,
        tone: 'amber',
        onOpen: () => ctx.open('machine_tasks'),
      },
    },
    ...(unfinished > 0 ? [{
      target: 'machine_tasks',
      task: {
        id: 'op-logbook',
        label: `log ${unfinished === 1 ? 'book' : 'books'} still being filled in — submit before shift end`,
        preview: myLogbooks.filter((lb) => lb.status === 'draft').slice(0, 3).map((lb) => `${lb.machineId} · ${lb.date}`),
        count: unfinished,
        icon: ClipboardList,
        tone: 'amber' as const,
        onOpen: () => ctx.open('machine_tasks'),
      },
    }] : []),
    {
      target: 'machines',
      task: {
        id: 'op-breakdown',
        label: 'Raise a breakdown for a machine that has stopped',
        icon: Wrench,
        tone: 'red',
        onOpen: () => ctx.open('machines'),
      },
    },
  ]);

  const lastEntry = myLogbooks.length > 0 ? myLogbooks[myLogbooks.length - 1] : undefined;

  return {
    title: `Your shift on ${lines.length === 1 ? `Machine ${lines[0]?.replace(/^M/, '') ?? ''}` : 'your machines'}`,
    subtitle: 'Everything below is yours to do.',
    alerts: machineAlerts(ctx, lines),
    tasks,
    kpis: visibleKpis(ctx, [
      {
        id: 'op-rolls', label: 'Rolls wound today', value: qty(rollsToday),
        sub: 'on your machines this shift', icon: Layers, tone: 'green',
        target: 'machine_tasks', onOpen: () => ctx.open('machine_tasks'),
      },
      {
        id: 'op-plan', label: 'Your shift plan', value: qty(myPlans.length),
        sub: 'orders scheduled on your machines', icon: CalendarClock, tone: 'green',
        target: 'machine_tasks', onOpen: () => ctx.open('machine_tasks'),
      },
    ]),
    primary: {
      label: 'Enter hourly reading',
      icon: ClipboardPen,
      onOpen: () => ctx.open('machine_tasks'),
    },
    shiftFigures: [
      { label: 'Rolls wound', value: qty(rollsToday) },
      { label: 'Total weight', value: kg(kgToday) },
      { label: 'Last entry', value: lastEntry?.meterCheckTime || 'Not yet' },
    ],
    lineIds: lines,
    emptyHint: 'Readings, rolls and breakdowns you record on your machine appear here through the shift.',
  };
}

/* ----------------------------------------------------- Quality Inspector */

function qualityHome(ctx: RoleContext): RoleHomeContent {
  const waiting = rollsAwaitingQa(ctx.data);
  const holds = ctx.data.inspections.filter((i) => i.decision === 'hold');
  const failed = ctx.data.inspections.filter((i) => i.decision === 'fail');
  // Raw-material grades sitting in the store are what an inspector samples from.
  const rmIn = ctx.data.rawMaterialStock.filter((r) => r.onHand > 0);

  // Oldest first — the queue is worked in the order the rolls came off the line.
  const oldestHold = [...holds].sort((a, b) => a.date.localeCompare(b.date))[0];

  const alerts: DashboardAlert[] = [];
  if (oldestHold) {
    alerts.push({
      id: `qa-hold-${oldestHold.id}`,
      headline: `Roll ${oldestHold.rollNumber} has been on hold for ${daysSince(oldestHold.date, ctx.now)} days`,
      chips: [`Lot ${oldestHold.lotNumber}`, oldestHold.remarks || 'Reason not recorded'],
      todo: 'Decide pass or reject today so the lot can move to packing.',
      tone: 'red',
      critical: true,
      ...(ctx.canOpen('holds') ? { onOpen: () => ctx.open('holds') } : {}),
    });
  }

  return {
    title: 'Your inspection queue',
    subtitle: 'Oldest rolls first.',
    alerts,
    tasks: visibleTasks(ctx, [
      {
        target: 'roll_queue',
        task: {
          id: 'qa-rolls',
          label: `${waiting === 1 ? 'roll' : 'rolls'} waiting for QA check`,
          zeroLabel: 'No rolls waiting for QA check',
          preview: rollsWaitingPreview(ctx.data).slice(0, 3),
          count: waiting, icon: ClipboardCheck, tone: waiting > 0 ? 'amber' : 'green',
          onOpen: () => ctx.open('roll_queue'),
        },
      },
      {
        target: 'holds',
        task: {
          id: 'qa-holds',
          label: `${holds.length === 1 ? 'lot' : 'lots'} on hold waiting for your decision`,
          zeroLabel: 'No lots on hold',
          preview: holds.slice(0, 3).map((h) => `${h.rollNumber} · ${daysSince(h.date, ctx.now)}d`),
          count: holds.length, icon: PauseCircle, tone: holds.length > 0 ? 'red' : 'green',
          onOpen: () => ctx.open('holds'),
        },
      },
      {
        target: 'receive',
        task: {
          id: 'qa-rm',
          label: `raw-material ${rmIn.length === 1 ? 'grade' : 'grades'} to inspect`,
          zeroLabel: 'No raw material waiting to be inspected',
          preview: rmIn.slice(0, 3).map((r) => r.itemName),
          count: rmIn.length, icon: ArrowDownToLine, tone: 'amber',
          onOpen: () => ctx.open('receive'),
        },
      },
    ]),
    kpis: visibleKpis(ctx, [
      {
        id: 'qa-failed', label: 'Rejected this month', value: qty(failed.length),
        sub: 'rolls that failed inspection', icon: ShieldAlert, tone: failed.length > 0 ? 'red' : 'green',
        target: 'holds', onOpen: () => ctx.open('holds'),
      },
      {
        id: 'qa-passed', label: 'Passed this month',
        value: qty(ctx.data.inspections.filter((i) => i.decision === 'pass').length),
        sub: 'rolls cleared to packing', icon: PackageCheck, tone: 'green',
        target: 'roll_queue', onOpen: () => ctx.open('roll_queue'),
      },
    ]),
    primary: {
      label: 'Inspect next roll',
      icon: ClipboardCheck,
      onOpen: () => ctx.open('roll_queue'),
      ...(waiting === 0 ? { disabledReason: 'No rolls are waiting — this unlocks when a roll is wound and registered.' } : {}),
    },
    shiftFigures: [
      { label: 'Waiting for check', value: qty(waiting) },
      { label: 'On hold', value: qty(holds.length) },
      { label: 'Checked today', value: qty(ctx.data.inspections.length) },
    ],
    lineIds: [],
    emptyHint: 'Rolls appear here as operators wind and register them against a shift log book.',
  };
}

/* -------------------------------------------------------- Store Manager */

function storeHome(ctx: RoleContext): RoleHomeContent {
  const rmStock = ctx.data.rawMaterialStock;
  const fgStock = ctx.data.finishedGoodsStock;
  const toIssue = ctx.data.productionPlans.filter((p) => p.status === 'scheduled');
  const pallets = ctx.data.packingRecords.filter((r) => !r.labelGenerated);
  // A pallet whose roll was held must not move — it is the red row on this screen.
  const heldRolls = new Set(ctx.data.inspections.filter((i) => i.decision === 'hold').map((i) => i.rollNumber));
  const heldPallets = ctx.data.packingRecords.filter((r) => heldRolls.has(r.rollNumber));

  const alerts: DashboardAlert[] = heldPallets.length > 0 ? [{
    id: 'store-held',
    headline: `${heldPallets.length} ${heldPallets.length === 1 ? 'pallet is' : 'pallets are'} on quality hold`,
    chips: heldPallets.slice(0, 3).map((p) => p.palletNumber),
    todo: 'Keep them in the hold bay until quality releases them.',
    tone: 'red',
    critical: true,
    ...(ctx.canOpen('holds') ? { onOpen: () => ctx.open('holds') } : {}),
  }] : [];

  return {
    title: 'Your store today',
    subtitle: 'Lots to issue and pallets to put away.',
    alerts,
    tasks: visibleTasks(ctx, [
      {
        target: 'issue_lot',
        task: {
          id: 'store-issue',
          label: `${toIssue.length === 1 ? 'lot' : 'lots'} to issue to machines`,
          zeroLabel: 'Nothing waiting to be issued',
          preview: toIssue.slice(0, 3).map((p) => `${p.machineId} · shift ${p.shift}`),
          count: toIssue.length, icon: Boxes, tone: toIssue.length > 0 ? 'amber' : 'green',
          onOpen: () => ctx.open('issue_lot'),
        },
      },
      {
        target: 'rm_stock',
        task: {
          id: 'store-putaway',
          label: `${pallets.length === 1 ? 'pallet' : 'pallets'} to put away`,
          zeroLabel: 'No pallets waiting to be put away',
          preview: pallets.slice(0, 3).map((r) => r.palletNumber),
          count: pallets.length, icon: PackagePlus, tone: 'amber',
          onOpen: () => ctx.open('rm_stock'),
        },
      },
      {
        target: 'receive',
        task: {
          id: 'store-receive',
          label: 'Receive material arriving at the gate',
          icon: ArrowDownToLine, tone: 'green',
          onOpen: () => ctx.open('receive'),
        },
      },
    ]),
    kpis: visibleKpis(ctx, [
      {
        id: 'store-rm', label: 'Raw material on hand', value: kg(totalOnHand(rmStock)),
        sub: `${rmStock.length} ${rmStock.length === 1 ? 'grade' : 'grades'} in the store`,
        icon: Boxes, tone: 'green', target: 'rm_stock', onOpen: () => ctx.open('rm_stock'),
      },
      {
        id: 'store-fg', label: 'Finished goods on hand', value: tonnes(totalOnHand(fgStock)),
        sub: 'ready for dispatch', icon: PackageCheck, tone: 'green',
        target: 'rm_stock', onOpen: () => ctx.open('rm_stock'),
      },
    ]),
    primary: {
      label: 'Issue lot to machine',
      icon: Boxes,
      onOpen: () => ctx.open('issue_lot'),
    },
    shiftFigures: [
      { label: 'Lots to issue', value: qty(toIssue.length) },
      { label: 'Pallets to put away', value: qty(pallets.length) },
      { label: 'Held pallets', value: qty(heldPallets.length) },
    ],
    lineIds: [],
    emptyHint: 'Lots to issue appear when the planner schedules an order; pallets appear when packing registers them.',
  };
}

/* ---------------------------------------------------- Dispatch Executive */

function dispatchHome(ctx: RoleContext): RoleHomeContent {
  const today = ctx.now.toISOString().slice(0, 10);
  const expected = ctx.data.dispatches.filter((d) => d.dispatchDate === today || d.status === 'shipped');
  const readyOrders = ctx.data.salesOrders.filter((o) => o.status === 'packed');
  // A gate pass is outstanding while the order is packed but no invoice has been
  // raised against it yet — that invoice is what the gate actually checks.
  const invoicedOrders = new Set(ctx.data.dispatches.map((d) => d.invoiceNumber));
  const gatePassPending = expected.filter((d) => !invoicedOrders.has(d.invoiceNumber) || d.status === 'shipped');

  const alerts: DashboardAlert[] = gatePassPending.slice(0, 2).map((d) => ({
    id: `dispatch-gate-${d.id}`,
    headline: `Vehicle ${d.vehicleNumber} has no gate pass yet`,
    chips: [d.transporter, `Invoice ${d.invoiceNumber}`],
    todo: 'Prepare the gate pass before the vehicle reaches the gate.',
    tone: 'amber',
    critical: false,
    ...(ctx.canOpen('ready') ? { onOpen: () => ctx.open('ready') } : {}),
  }));

  return {
    title: 'Your dispatches today',
    subtitle: 'Vehicles, checklists and gate passes.',
    alerts,
    tasks: visibleTasks(ctx, [
      {
        target: 'ready',
        task: {
          id: 'dispatch-ready',
          label: `${readyOrders.length === 1 ? 'order' : 'orders'} packed and ready to load`,
          zeroLabel: 'Nothing packed and waiting to load',
          preview: readyOrders.slice(0, 3).map((o) => `${o.soNumber} · ${customerName(ctx.data, o.customerId)}`),
          count: readyOrders.length, icon: PackageCheck, tone: readyOrders.length > 0 ? 'amber' : 'green',
          onOpen: () => ctx.open('ready'),
        },
      },
      {
        target: 'ready',
        task: {
          id: 'dispatch-gate',
          label: `gate ${gatePassPending.length === 1 ? 'pass' : 'passes'} still to prepare`,
          zeroLabel: 'Every gate pass is ready',
          preview: gatePassPending.slice(0, 3).map((d) => `${d.vehicleNumber}`),
          count: gatePassPending.length, icon: ClipboardList, tone: gatePassPending.length > 0 ? 'amber' : 'green',
          onOpen: () => ctx.open('ready'),
        },
      },
      {
        target: 'dispatch_history',
        task: {
          id: 'dispatch-track',
          label: `${expected.length === 1 ? 'vehicle' : 'vehicles'} expected today`,
          zeroLabel: 'No vehicles expected today',
          preview: expected.slice(0, 3).map((d) => `${d.vehicleNumber} · ${d.transporter}`),
          count: expected.length, icon: Truck, tone: 'green',
          onOpen: () => ctx.open('dispatch_history'),
        },
      },
    ]),
    kpis: visibleKpis(ctx, [
      {
        id: 'dispatch-sent', label: 'Dispatched this month',
        value: qty(ctx.data.dispatches.length), sub: 'invoices raised',
        icon: Truck, tone: 'green', target: 'dispatch_history', onOpen: () => ctx.open('dispatch_history'),
      },
      {
        id: 'dispatch-delivered', label: 'Delivered',
        value: qty(ctx.data.dispatches.filter((d) => d.status === 'delivered').length),
        sub: 'confirmed by the customer', icon: PackageCheck, tone: 'green',
        target: 'dispatch_history', onOpen: () => ctx.open('dispatch_history'),
      },
    ]),
    primary: {
      label: 'Prepare gate pass',
      icon: ClipboardList,
      onOpen: () => ctx.open('ready'),
      ...(readyOrders.length === 0 ? { disabledReason: 'This unlocks when an order is packed and ready to load.' } : {}),
    },
    shiftFigures: [
      { label: 'Ready to load', value: qty(readyOrders.length) },
      { label: 'Vehicles today', value: qty(expected.length) },
      { label: 'Gate passes left', value: qty(gatePassPending.length) },
    ],
    lineIds: [],
    emptyHint: 'Orders appear here once packing is finished and the order is marked ready to dispatch.',
  };
}

/* --------------------------------------------------- Production Planner */

function plannerHome(ctx: RoleContext): RoleHomeContent {
  const unplanned = ctx.data.salesOrders.filter((o) => o.status === 'pending');
  const running = ctx.live.filter((m) => m.status === 'running').length;
  const stopped = ctx.live.filter((m) => m.status === 'stopped');
  const capacityPct = ctx.live.length > 0 ? (running / ctx.live.length) * 100 : 0;
  const lockedFormulas = ctx.data.formulations.filter((f) => f.locked);

  const alerts: DashboardAlert[] = [];

  for (const f of lockedFormulas.slice(0, 2)) {
    const next = ctx.data.formulations
      .filter((o) => o.code === f.code && !o.locked && o.rev > f.rev)
      .sort((a, b) => a.rev - b.rev)[0];
    alerts.push({
      id: `planner-locked-${f.id}`,
      headline: `${f.code} Rev ${f.rev} is locked${f.capaId ? ` by ${f.capaId}` : ''}`,
      // `sentence()` keeps the seeded lock reason from ending in "..".
      chips: [f.product, ...(f.lockReason ? [sentence(f.lockReason)] : [])],
      todo: next ? `Use Rev ${next.rev} when planning this product.` : 'Do not plan this product until quality releases a new revision.',
      tone: 'amber',
      critical: false,
      ...(ctx.canOpen('formulations') ? { onOpen: () => ctx.open('formulations') } : {}),
    });
  }

  for (const m of stopped.slice(0, 1)) {
    alerts.push({
      id: `planner-stopped-${m.id}`,
      headline: `Machine ${m.id} is stopped, so its capacity is gone`,
      chips: [...(m.reason ? [m.reason] : [])],
      todo: 'Move its scheduled orders to another line or hold the plan.',
      tone: 'red',
      critical: true,
      ...(ctx.canOpen('plan_board') ? { onOpen: () => ctx.open('plan_board') } : {}),
    });
  }

  return {
    title: 'Orders waiting for a machine',
    subtitle: 'Confirmed orders against the capacity you actually have.',
    alerts,
    tasks: visibleTasks(ctx, [
      {
        target: 'orders_to_plan',
        task: {
          id: 'plan-unplanned',
          label: `confirmed ${unplanned.length === 1 ? 'order is' : 'orders are'} waiting for planning`,
          zeroLabel: 'Every confirmed order has a machine',
          preview: unplanned.slice(0, 3).map((o) => `${o.soNumber} · ${customerName(ctx.data, o.customerId)}`),
          count: unplanned.length, icon: ClipboardList, tone: unplanned.length > 0 ? 'amber' : 'green',
          onOpen: () => ctx.open('orders_to_plan'),
        },
      },
      {
        target: 'plan_board',
        task: {
          id: 'plan-board',
          label: `of ${ctx.live.length} lines running — check the board before you commit`,
          count: running,
          preview: stopped.slice(0, 3).map((m) => `${m.id} stopped`),
          icon: Factory, tone: stopped.length > 0 ? 'amber' : 'green',
          onOpen: () => ctx.open('plan_board'),
        },
      },
      ...(lockedFormulas.length > 0 ? [{
        target: 'formulations',
        task: {
          id: 'plan-locked',
          label: `${lockedFormulas.length === 1 ? 'formulation is' : 'formulations are'} locked by a CAPA`,
          preview: lockedFormulas.slice(0, 3).map((f) => `${f.code} Rev ${f.rev}`),
          count: lockedFormulas.length, icon: Beaker, tone: 'amber' as const,
          onOpen: () => ctx.open('formulations'),
        },
      }] : []),
    ]),
    kpis: visibleKpis(ctx, [
      {
        id: 'plan-capacity', label: 'Lines running now', value: `${running} of ${ctx.live.length}`,
        sub: `${pct(capacityPct)} of the floor is producing`, icon: Gauge,
        tone: stopped.length > 0 ? 'amber' : 'green',
        target: 'plan_board', onOpen: () => ctx.open('plan_board'),
      },
      {
        id: 'plan-scheduled', label: 'Scheduled but not started',
        value: qty(ctx.data.productionPlans.filter((p) => p.status === 'scheduled').length),
        sub: 'plans queued on machines', icon: CalendarClock, tone: 'green',
        target: 'plan_board', onOpen: () => ctx.open('plan_board'),
      },
      {
        id: 'plan-unplanned-kpi', label: 'Waiting for planning', value: qty(unplanned.length),
        sub: 'confirmed orders with no machine', icon: ClipboardList,
        tone: unplanned.length > 0 ? 'amber' : 'green',
        target: 'orders_to_plan', onOpen: () => ctx.open('orders_to_plan'),
      },
    ]),
    primary: {
      label: 'Plan the next order',
      icon: CalendarClock,
      onOpen: () => ctx.open('orders_to_plan'),
      ...(unplanned.length === 0 ? { disabledReason: 'This unlocks when sales confirms an order that has no machine yet.' } : {}),
    },
    shiftFigures: [
      { label: 'Waiting for planning', value: qty(unplanned.length) },
      { label: 'Lines running', value: `${running} / ${ctx.live.length}` },
      { label: 'Locked formulas', value: qty(lockedFormulas.length) },
    ],
    lineIds: ctx.live.map((m) => m.id).slice(0, 4),
    emptyHint: 'Orders appear here the moment sales confirms them and they have no machine allocated.',
  };
}

/* ------------------------------------------------------ Sales Executive */

function salesHome(ctx: RoleContext): RoleHomeContent {
  const open = ctx.data.inquiries.filter((i) => i.status === 'draft' || i.status === 'submitted');
  const quoted = ctx.data.inquiries.filter((i) => i.status === 'quotation');
  const awaitingConfirmation = ctx.data.salesOrders.filter((o) => o.status === 'pending');
  const openComplaints = ctx.data.complaints.filter((c) => c.status !== 'resolved');

  // Age is what makes an inquiry urgent, so it leads the alert.
  const stale = [...open]
    .map((i) => ({ inquiry: i, age: daysSince(i.expectedDeliveryDate, ctx.now) }))
    .sort((a, b) => b.age - a.age)[0];

  const alerts: DashboardAlert[] = [];
  if (stale && stale.age > 0) {
    alerts.push({
      id: `sales-stale-${stale.inquiry.id}`,
      headline: `Inquiry ${stale.inquiry.inquiryNumber} has been open ${stale.age} days`,
      chips: [customerName(ctx.data, stale.inquiry.customerId)],
      todo: 'Send the quotation today or tell the customer when it will reach them.',
      tone: 'amber',
      critical: false,
      ...(ctx.canOpen('inquiries') ? { onOpen: () => ctx.open('inquiries', 'open') } : {}),
    });
  }
  const urgentComplaint = openComplaints[0];
  if (urgentComplaint) {
    const clock = responseClock(urgentComplaint.date, urgentComplaint.severity === 'high' ? 3 : 7, ctx.now);
    alerts.push({
      id: `sales-complaint-${urgentComplaint.id}`,
      headline: `Complaint ${urgentComplaint.complaintNumber} is still open`,
      chips: [customerName(ctx.data, urgentComplaint.customerId), clock.word],
      todo: 'Reply to the customer and record what you told them.',
      tone: clock.tone,
      critical: clock.tone === 'red',
      ...(ctx.canOpen('sales_complaints') ? { onOpen: () => ctx.open('sales_complaints', 'open') } : {}),
    });
  }

  return {
    title: 'Your customers today',
    subtitle: 'Inquiries, quotations and orders.',
    alerts,
    tasks: visibleTasks(ctx, [
      {
        target: 'inquiries',
        task: {
          id: 'sales-open',
          label: `open ${open.length === 1 ? 'inquiry' : 'inquiries'} to quote`,
          zeroLabel: 'No inquiries waiting for a quotation',
          preview: open.slice(0, 3).map((i) => `${i.inquiryNumber} · ${customerName(ctx.data, i.customerId)}`),
          count: open.length, icon: FileSpreadsheet, tone: open.length > 0 ? 'amber' : 'green',
          onOpen: () => ctx.open('inquiries', 'open'),
        },
      },
      {
        target: 'quotations',
        task: {
          id: 'sales-quoted',
          label: `${quoted.length === 1 ? 'quotation is' : 'quotations are'} awaiting the customer`,
          zeroLabel: 'No quotations waiting on a customer',
          preview: quoted.slice(0, 3).map((i) => `${i.inquiryNumber} · ${customerName(ctx.data, i.customerId)}`),
          count: quoted.length, icon: Send, tone: 'green',
          onOpen: () => ctx.open('quotations'),
        },
      },
      {
        target: 'orders',
        task: {
          id: 'sales-confirm',
          label: `${awaitingConfirmation.length === 1 ? 'order is' : 'orders are'} waiting for planning`,
          zeroLabel: 'No orders waiting for planning',
          preview: awaitingConfirmation.slice(0, 3).map((o) => `${o.soNumber} · ${customerName(ctx.data, o.customerId)}`),
          count: awaitingConfirmation.length, icon: ClipboardList, tone: 'green',
          onOpen: () => ctx.open('orders', 'pending'),
        },
      },
    ]),
    kpis: visibleKpis(ctx, [
      {
        id: 'sales-inquiries', label: 'Open inquiries', value: qty(open.length),
        sub: stale ? `oldest is ${stale.age} days old` : 'none waiting', icon: FileSpreadsheet,
        tone: open.length > 0 ? 'amber' : 'green',
        target: 'inquiries', onOpen: () => ctx.open('inquiries', 'open'),
      },
      {
        id: 'sales-complaints', label: 'Open complaints', value: qty(openComplaints.length),
        sub: 'awaiting a reply to the customer', icon: ShieldAlert,
        tone: openComplaints.length > 0 ? 'red' : 'green',
        target: 'sales_complaints', onOpen: () => ctx.open('sales_complaints', 'open'),
      },
      {
        id: 'sales-customers', label: 'Customers on file',
        value: qty(ctx.data.customers.length), sub: 'active accounts', icon: Users, tone: 'green',
        target: 'sales_customers', onOpen: () => ctx.open('sales_customers'),
      },
    ]),
    primary: {
      label: 'Record a new inquiry',
      icon: FileSpreadsheet,
      onOpen: () => ctx.open('inquiries'),
    },
    shiftFigures: [
      { label: 'Open inquiries', value: qty(open.length) },
      { label: 'Quotations out', value: qty(quoted.length) },
      { label: 'Orders to plan', value: qty(awaitingConfirmation.length) },
    ],
    lineIds: [],
    emptyHint: 'Inquiries you record for a customer appear here until they become a quotation and then an order.',
  };
}

/* ----------------------------------------------------- Managing Director */

function directorHome(ctx: RoleContext): RoleHomeContent {
  const fg = ctx.data.finishedGoodsStock;
  const rm = ctx.data.rawMaterialStock;
  const openComplaints = ctx.data.complaints.filter((c) => c.status !== 'resolved');
  const openCapas = ctx.data.capas.filter((c) => c.status !== 'closed');
  const overdueCapas = openCapas.filter((c) => daysUntil(c.dueDate, ctx.now) < 0);

  // This month's rejections, in kg off the shift log books.
  const rejectedKg = ctx.data.machineLogbooks
    .reduce((sum, lb) => sum + (Number(lb.rejectionKg) || 0), 0);
  const producedKg = ctx.data.machineLogbooks
    .reduce((sum, lb) => sum + (Number(lb.totalRollKgs) || 0), 0);
  const rejectionPct = producedKg > 0 ? (rejectedKg / producedKg) * 100 : 0;

  const alerts: DashboardAlert[] = [];
  const breached = openComplaints
    .map((c) => ({ c, clock: responseClock(c.date, c.severity === 'high' ? 3 : 7, ctx.now) }))
    .filter((x) => x.clock.tone === 'red')[0];
  if (breached) {
    alerts.push({
      id: `md-complaint-${breached.c.complaintNumber}`,
      headline: `Complaint ${breached.c.complaintNumber} has passed its response time`,
      chips: [customerName(ctx.data, breached.c.customerId), breached.clock.word],
      todo: 'Ask sales for the reply that went to the customer.',
      tone: 'red',
      critical: true,
      ...(ctx.canOpen('sales_complaints') ? { onOpen: () => ctx.open('sales_complaints', 'open') } : {}),
    });
  }
  const oldestCapa = [...openCapas].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (oldestCapa && daysUntil(oldestCapa.dueDate, ctx.now) < 0) {
    alerts.push({
      id: `md-capa-${oldestCapa.id}`,
      headline: `A CAPA is ${-daysUntil(oldestCapa.dueDate, ctx.now)} days overdue`,
      chips: [oldestCapa.responsiblePerson, `Due ${oldestCapa.dueDate}`],
      todo: 'Ask for a closing date at the review meeting.',
      tone: 'red',
      critical: false,
      ...(ctx.canOpen('sales_complaints') ? { onOpen: () => ctx.open('sales_complaints', 'capa_open') } : {}),
    });
  }

  // FG by grade, biggest first — the management review reads tonnes, not kg.
  const fgByGrade = fg.filter((r) => r.onHand > 0).sort((a, b) => b.onHand - a.onHand);

  const gradeKpis: KpiSpec[] = fgByGrade.slice(0, 3).map((row, i) => ({
    id: `md-fg-${i}`,
    label: `FG · ${row.itemName}`,
    value: tonnes(row.onHand),
    sub: 'finished goods on hand',
    icon: Boxes,
    tone: 'green' as const,
    target: 'rm_stock',
    onOpen: () => ctx.open('rm_stock'),
  }));

  return {
    title: 'The plant this month',
    subtitle: 'The management-review numbers, live.',
    alerts,
    tasks: visibleTasks(ctx, [
      {
        target: 'sales_complaints',
        task: {
          id: 'md-complaints',
          label: `open ${openComplaints.length === 1 ? 'complaint' : 'complaints'} on the response clock`,
          zeroLabel: 'No open complaints',
          preview: openComplaints.slice(0, 3).map((c) =>
            `${c.complaintNumber} · ${responseClock(c.date, c.severity === 'high' ? 3 : 7, ctx.now).word}`),
          count: openComplaints.length, icon: ShieldAlert,
          tone: openComplaints.length > 0 ? 'amber' : 'green',
          onOpen: () => ctx.open('sales_complaints', 'open'),
        },
      },
      {
        target: 'sales_complaints',
        task: {
          id: 'md-capas',
          label: `open ${openCapas.length === 1 ? 'CAPA' : 'CAPAs'}${overdueCapas.length > 0 ? `, ${overdueCapas.length} overdue` : ''}`,
          zeroLabel: 'No open CAPAs',
          preview: openCapas.slice(0, 3).map((c) => `${c.responsiblePerson} · due ${c.dueDate}`),
          count: openCapas.length, icon: ClipboardCheck,
          tone: overdueCapas.length > 0 ? 'red' : 'amber',
          onOpen: () => ctx.open('sales_complaints', 'capa_open'),
        },
      },
    ]),
    kpis: visibleKpis(ctx, [
      ...gradeKpis,
      {
        id: 'md-fg-total', label: 'Finished goods total', value: tonnes(totalOnHand(fg)),
        sub: `${fgByGrade.length} ${fgByGrade.length === 1 ? 'grade' : 'grades'} in the warehouse`,
        icon: PackageCheck, tone: 'green', target: 'rm_stock', onOpen: () => ctx.open('rm_stock'),
      },
      {
        id: 'md-rm', label: 'Raw material', value: tonnes(totalOnHand(rm)),
        sub: 'on hand across all grades', icon: Boxes, tone: 'green',
        target: 'rm_stock', onOpen: () => ctx.open('rm_stock'),
      },
      {
        id: 'md-rejection', label: 'Rejection this month', value: pct(rejectionPct),
        sub: `${kg(rejectedKg)} rejected of ${kg(producedKg)} produced`, icon: ShieldAlert,
        tone: rejectionPct > 3 ? 'red' : rejectionPct > 1 ? 'amber' : 'green',
        target: 'quality_memory', onOpen: () => ctx.open('quality_memory'),
      },
      {
        id: 'md-complaints-kpi', label: 'Open complaints', value: qty(openComplaints.length),
        sub: 'with days left to respond', icon: ShieldAlert,
        tone: openComplaints.length > 0 ? 'amber' : 'green',
        target: 'sales_complaints', onOpen: () => ctx.open('sales_complaints', 'open'),
      },
      {
        id: 'md-capa-kpi', label: 'Open CAPAs', value: qty(openCapas.length),
        sub: oldestCapa ? `oldest with ${oldestCapa.responsiblePerson}` : 'none open',
        icon: ClipboardCheck, tone: overdueCapas.length > 0 ? 'red' : 'green',
        target: 'quality_memory', onOpen: () => ctx.open('quality_memory'),
      },
      {
        id: 'md-dispatch', label: 'Dispatched this month',
        value: qty(ctx.data.dispatches.length), sub: 'invoices raised', icon: Truck, tone: 'green',
        target: 'dispatch_history', onOpen: () => ctx.open('dispatch_history'),
      },
    ]),
    shiftFigures: [
      { label: 'Finished goods', value: tonnes(totalOnHand(fg)) },
      { label: 'Raw material', value: tonnes(totalOnHand(rm)) },
      { label: 'Rejection', value: pct(rejectionPct) },
    ],
    lineIds: ctx.live.map((m) => m.id).slice(0, 2),
    emptyHint: 'Stock, complaints and CAPAs roll up here as the plant records them through the month.',
  };
}

/* ------------------------------------------------------ Maintenance Head */

function maintenanceHome(ctx: RoleContext): RoleHomeContent {
  const overdue = ctx.data.maintenanceTasks.filter((t) => t.status === 'overdue');
  const scheduled = ctx.data.maintenanceTasks.filter((t) => t.status === 'scheduled');
  const stopped = ctx.live.filter((m) => m.status === 'stopped');

  const alerts: DashboardAlert[] = stopped.map((m) => ({
    id: `maint-stopped-${m.id}`,
    headline: `Machine ${m.id} is stopped`,
    chips: [...(m.reason ? [m.reason] : [])],
    todo: 'Attend the machine and close the breakdown when it runs again.',
    tone: 'red' as const,
    critical: true,
    ...(ctx.canOpen('machines') ? { onOpen: () => ctx.open('machines') } : {}),
  }));

  return {
    title: 'Your machines today',
    subtitle: 'Breakdowns first, then the schedule.',
    alerts,
    tasks: visibleTasks(ctx, [
      {
        target: 'preventive',
        task: {
          id: 'maint-overdue',
          label: `preventive ${overdue.length === 1 ? 'job is' : 'jobs are'} overdue`,
          zeroLabel: 'No preventive jobs overdue',
          preview: overdue.slice(0, 3).map((t) => `${t.machineId} · ${t.type}`),
          count: overdue.length, icon: Wrench, tone: overdue.length > 0 ? 'red' : 'green',
          onOpen: () => ctx.open('preventive'),
        },
      },
      {
        target: 'preventive',
        task: {
          id: 'maint-scheduled',
          label: `scheduled ${scheduled.length === 1 ? 'job' : 'jobs'} coming up`,
          zeroLabel: 'Nothing on the preventive schedule',
          preview: scheduled.slice(0, 3).map((t) => `${t.machineId} · ${t.dueDate}`),
          count: scheduled.length, icon: CalendarClock, tone: 'green',
          onOpen: () => ctx.open('preventive'),
        },
      },
    ]),
    kpis: visibleKpis(ctx, [
      {
        id: 'maint-stopped', label: 'Lines stopped', value: qty(stopped.length),
        sub: 'not producing right now', icon: AlertTriangle,
        tone: stopped.length > 0 ? 'red' : 'green',
        target: 'machines', onOpen: () => ctx.open('machines'),
      },
      {
        id: 'maint-overdue-kpi', label: 'Overdue jobs', value: qty(overdue.length),
        sub: 'past their due date', icon: Wrench, tone: overdue.length > 0 ? 'red' : 'green',
        target: 'preventive', onOpen: () => ctx.open('preventive'),
      },
    ]),
    primary: {
      label: 'Close a breakdown',
      icon: Wrench,
      onOpen: () => ctx.open('machines'),
      ...(stopped.length === 0 ? { disabledReason: 'This unlocks when a machine is stopped and a breakdown is open.' } : {}),
    },
    shiftFigures: [
      { label: 'Lines stopped', value: qty(stopped.length) },
      { label: 'Overdue jobs', value: qty(overdue.length) },
      { label: 'Scheduled jobs', value: qty(scheduled.length) },
    ],
    lineIds: ctx.live.map((m) => m.id).slice(0, 4),
    emptyHint: 'Breakdowns raised by operators and preventive jobs falling due both appear here.',
  };
}

/* ------------------------------------------------------------ Whole plant */

/** Owner and Administrator see the plant, not one desk's work. */
function wholePlantHome(ctx: RoleContext): RoleHomeContent {
  const director = directorHome(ctx);
  const planner = plannerHome(ctx);
  return {
    ...director,
    title: 'The whole plant',
    subtitle: "Every desk's work, in one place.",
    alerts: [...director.alerts, ...planner.alerts].slice(0, 5),
    tasks: [...director.tasks, ...planner.tasks],
    lineIds: ctx.live.map((m) => m.id),
    emptyHint: 'Work recorded anywhere in the plant surfaces here.',
  };
}

/* ------------------------------------------------------------ the switch */

/**
 * The one entry point. Every role home goes through the same template, so a
 * new role means a new builder here — never a new screen.
 */
export function buildRoleHome(ctx: RoleContext): RoleHomeContent {
  switch (ctx.role) {
    case 'Operator': return operatorHome(ctx);
    case 'Quality Inspector': return qualityHome(ctx);
    case 'Store Manager': return storeHome(ctx);
    case 'Dispatch Executive': return dispatchHome(ctx);
    case 'Production Planner': return plannerHome(ctx);
    case 'Sales Executive': return salesHome(ctx);
    case 'Managing Director': return directorHome(ctx);
    case 'Maintenance Head': return maintenanceHome(ctx);
    case 'Owner':
    case 'Administrator': return wholePlantHome(ctx);
    default: return directorHome(ctx);
  }
}

/** Re-exported so screens can show an order status as a sentence. */
export { ORDER_STATUS };
