/**
 * QualityMemory.tsx — Layer 2. What the plant has already learned.
 *
 * A rejection that nobody counts twice is a rejection the plant will make
 * again. This tab is the memory: which reasons actually cost the most, whether
 * they are getting better or worse month on month, what customers complained
 * about, and which CAPAs are still open and with whom.
 *
 * Every bar is a button. Tapping one lists the records behind it — the whole
 * point is that a number can always be taken back to the shift and the machine
 * that produced it.
 */

import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import {
  BarChart3, ShieldAlert, ClipboardCheck, Wrench, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import type {
  DashLogbook, DashComplaint, DashCapa, DashMaintenance, DashCustomer, DashPlan,
} from './plantData';
import { SectionHeading, StatusChip, DashboardEmptyState, toneClass, toneSolid } from './primitives';
import {
  complaintStatus, capaStatus, responseClock, countdown, daysSince, qty, kg, pct,
} from './statusLanguage';
import { TraceLink } from '../TraceLink';

/** How the rejection Pareto is sliced. */
type Cut = 'reason' | 'machine' | 'shift' | 'product';

const CUT_LABEL: Record<Cut, string> = {
  reason: 'By reason',
  machine: 'By machine',
  shift: 'By shift',
  product: 'By product',
};

interface Bucket {
  key: string;
  /** Rejected weight in kg attributed to this bucket. */
  value: number;
  /** The log books behind the bar, for drill-through. */
  records: DashLogbook[];
}

/** Month key ("2026-07") → readable label ("Jul 2026"). */
function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  if (!y || !m) return key;
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/**
 * Group rejections into buckets along one cut. Rejection weight is the honest
 * measure — a count of "reason ticks" would rank a frequent-but-light reason
 * above the one actually burning material.
 */
function bucketise(logbooks: DashLogbook[], cut: Cut, plans: DashPlan[]): Bucket[] {
  const map = new Map<string, Bucket>();

  const add = (key: string, value: number, lb: DashLogbook): void => {
    if (value <= 0) return;
    const existing = map.get(key);
    if (existing) {
      existing.value += value;
      existing.records.push(lb);
    } else {
      map.set(key, { key, value, records: [lb] });
    }
  };

  for (const lb of logbooks) {
    const totalRejected = Number(lb.rejectionKg) || 0;
    if (cut === 'reason') {
      // Split the shift's rejected weight across its reasons, in proportion to
      // the counts recorded against each.
      const entries = Object.entries(lb.rejectionCounts)
        .map(([reason, raw]) => ({ reason, count: Number(raw) || 0 }))
        .filter((e) => e.count > 0);
      const totalCount = entries.reduce((s, e) => s + e.count, 0);
      if (totalCount === 0) {
        if (totalRejected > 0) add('Reason not recorded', totalRejected, lb);
        continue;
      }
      for (const e of entries) add(e.reason, (totalRejected * e.count) / totalCount, lb);
      continue;
    }

    if (cut === 'machine') { add(`Machine ${lb.machineId.replace(/^M/, '')}`, totalRejected, lb); continue; }
    if (cut === 'shift') { add(`Shift ${lb.shift || '—'}`, totalRejected, lb); continue; }

    const plan = plans.find((p) => p.id === lb.productionPlanId);
    add(lb.productName || plan?.machineId || 'Product not recorded', totalRejected, lb);
  }

  return [...map.values()].sort((a, b) => b.value - a.value);
}

/* -------------------------------------------------------------- the tab */

export function QualityMemory({
  logbooks, complaints, capas, maintenance, customers, plans, onOpen, onTrace, canOpen,
}: {
  logbooks: DashLogbook[];
  complaints: DashComplaint[];
  capas: DashCapa[];
  maintenance: DashMaintenance[];
  customers: DashCustomer[];
  plans: DashPlan[];
  onOpen: (screen: string, filter?: string) => void;
  onTrace: (query: string) => void;
  canOpen: (screen: string) => boolean;
}): ReactElement {
  const [cut, setCut] = useState<Cut>('reason');
  const [drill, setDrill] = useState<Bucket | null>(null);

  const buckets = useMemo(() => bucketise(logbooks, cut, plans), [logbooks, cut, plans]);
  const worst = buckets[0];
  const totalRejected = buckets.reduce((s, b) => s + b.value, 0);

  // Month on month, so a reason that is being fixed can be seen to be shrinking.
  const byMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const lb of logbooks) {
      const key = lb.date.slice(0, 7);
      if (key.length !== 7) continue;
      map.set(key, (map.get(key) ?? 0) + (Number(lb.rejectionKg) || 0));
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
  }, [logbooks]);

  const latest = byMonth[byMonth.length - 1];
  const previous = byMonth[byMonth.length - 2];
  const trendDelta = latest && previous && previous[1] > 0
    ? ((latest[1] - previous[1]) / previous[1]) * 100
    : null;

  const openComplaints = complaints.filter((c) => c.status !== 'resolved');
  const openCapas = capas.filter((c) => c.status !== 'closed');
  const customerName = (id: string): string => customers.find((c) => c.id === id)?.name ?? id;

  // Maintenance load per machine per category. The data model records jobs and
  // cost, not hours on the floor, so this counts jobs and says so.
  const downtime = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const t of maintenance) {
      const perMachine = map.get(t.machineId) ?? new Map<string, number>();
      perMachine.set(t.type, (perMachine.get(t.type) ?? 0) + 1);
      map.set(t.machineId, perMachine);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [maintenance]);

  return (
    <div className="space-y-6 pb-24 lg:pb-6">
      <div>
        <h2 className="font-display text-[24px] leading-tight font-bold text-slate-900">Quality memory</h2>
        <p className="text-[15px] text-slate-600 mt-0.5">
          What the plant has rejected, what customers complained about, and what was done about it.
        </p>
      </div>

      {/* ------------------------------------------------ rejection Pareto */}
      <section aria-label="Rejections">
        <SectionHeading
          icon={BarChart3}
          right={
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Slice rejections by">
              {(Object.keys(CUT_LABEL) as Cut[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setCut(c); setDrill(null); }}
                  aria-pressed={cut === c}
                  className={`min-h-[48px] px-3 rounded-lg border text-[14px] font-bold transition
                    ${cut === c ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-900 border-slate-200 hover:border-blue-500'}`}
                >
                  {CUT_LABEL[c]}
                </button>
              ))}
            </div>
          }
        >
          Rejections — worst first
        </SectionHeading>

        {buckets.length === 0 ? (
          <DashboardEmptyState
            icon={<BarChart3 className="w-8 h-8" aria-hidden="true" />}
            title="No rejections recorded yet"
            whatFillsThis="Rejected weight and its reason are entered on the shift log book. Once operators submit a log book with a rejection, it appears here ranked worst first."
          />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[15px] text-slate-600">
                {kg(totalRejected)} rejected in total
                {worst && <> · worst is <span className="font-semibold text-slate-900">{worst.key}</span> at {pct((worst.value / totalRejected) * 100)}</>}
              </p>
              {trendDelta !== null && latest && (
                <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[14px] font-semibold ${toneClass(trendDelta > 5 ? 'red' : trendDelta < -5 ? 'green' : 'amber')}`}>
                  {trendDelta > 5 ? <TrendingUp className="w-4 h-4" aria-hidden="true" />
                    : trendDelta < -5 ? <TrendingDown className="w-4 h-4" aria-hidden="true" />
                      : <Minus className="w-4 h-4" aria-hidden="true" />}
                  {trendDelta > 0 ? 'Up' : trendDelta < 0 ? 'Down' : 'Level'} {pct(Math.abs(trendDelta))} on last month
                </span>
              )}
            </div>

            <ul className="space-y-2">
              {buckets.map((b) => {
                const share = totalRejected > 0 ? (b.value / totalRejected) * 100 : 0;
                const isOpen = drill?.key === b.key;
                return (
                  <li key={b.key}>
                    <button
                      type="button"
                      onClick={() => setDrill(isOpen ? null : b)}
                      aria-expanded={isOpen}
                      className={`w-full text-left min-h-[56px] px-3 py-2 rounded-xl border transition
                        ${isOpen ? 'border-blue-600 bg-blue-50/40' : 'border-slate-200 bg-white hover:border-blue-500'}`}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-[16px] font-medium text-slate-900 truncate">{b.key}</span>
                        <span className="font-display text-[20px] font-bold data-value tabular-nums shrink-0">
                          {kg(b.value)} <span className="text-[15px] font-normal text-slate-600">({pct(share)})</span>
                        </span>
                      </span>
                      <span className="mt-1.5 block h-3 w-full rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                        <span
                          className={`block h-full ${toneSolid(share > 40 ? 'red' : share > 20 ? 'amber' : 'green')}`}
                          style={{ width: `${Math.max(2, share)}%` }}
                        />
                      </span>
                      <span className="mt-1 block text-[13px] text-slate-600">
                        {b.records.length} shift {b.records.length === 1 ? 'log book' : 'log books'} — tap to {isOpen ? 'hide' : 'see'} them
                      </span>
                    </button>

                    {/* Drill-through: the records behind the bar. */}
                    {isOpen && (
                      <ul className="mt-1.5 ml-3 space-y-1.5 border-l-2 border-blue-200 pl-3">
                        {b.records.map((lb) => (
                          <li key={lb.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                            <span className="text-[15px] text-slate-900">
                              <TraceLink id={lb.machineId} onTrace={onTrace} className="font-mono font-semibold" />
                              {' · '}{lb.date} · Shift {lb.shift || '—'}
                              {lb.productName ? ` · ${lb.productName}` : ''}
                            </span>
                            <span className="font-mono text-[14px] text-slate-900">{kg(Number(lb.rejectionKg) || 0)}</span>
                          </li>
                        ))}
                        {canOpen('machine_tasks') && (
                          <li>
                            <button
                              type="button"
                              onClick={() => onOpen('machine_tasks')}
                              className="min-h-[48px] px-3 rounded-lg border border-slate-200 bg-white text-[14px] font-bold text-blue-700 hover:border-blue-500"
                            >
                              Open the log books
                            </button>
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Month on month */}
            {byMonth.length > 1 && (
              <div className="pt-2 border-t border-slate-200">
                <p className="text-[13px] font-bold uppercase tracking-wide text-slate-600 mb-2">Month on month</p>
                <ul className="flex items-end gap-2 h-28">
                  {byMonth.map(([month, value]) => {
                    const max = Math.max(...byMonth.map((m) => m[1]), 1);
                    return (
                      <li key={month} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                        <span className="font-mono text-[12px] text-slate-900">{Math.round(value)}</span>
                        <span
                          className={`w-full rounded-t ${toneSolid('amber')}`}
                          style={{ height: `${Math.max(4, (value / max) * 70)}%` }}
                          title={`${monthLabel(month)}: ${kg(value)} rejected`}
                        />
                        <span className="text-[12px] text-slate-600 text-center">{monthLabel(month)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------- complaints */}
      <section aria-label="Complaints">
        <SectionHeading icon={ShieldAlert}>Customer complaints</SectionHeading>
        {complaints.length === 0 ? (
          <DashboardEmptyState
            icon={<ShieldAlert className="w-8 h-8" aria-hidden="true" />}
            title="No complaints on record"
            whatFillsThis="Complaints logged by sales against a dispatched batch appear here with the days left to respond."
          />
        ) : (
          <ul className="space-y-2">
            {complaints.map((c) => {
              const windowDays = c.severity === 'high' ? 3 : c.severity === 'medium' ? 7 : 14;
              const clock = responseClock(c.date, windowDays);
              return (
                <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[16px] font-semibold text-slate-900">
                        <TraceLink id={c.complaintNumber} onTrace={onTrace} className="font-mono" />
                        {' — '}{customerName(c.customerId)}
                      </p>
                      <p className="text-[15px] text-slate-600 mt-0.5">{c.description}</p>
                      <p className="text-[14px] text-slate-600 mt-1">
                        Batch <TraceLink id={c.batchNumber} onTrace={onTrace} className="font-mono text-slate-900" />
                        {' · raised '}{daysSince(c.date)} days ago
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <StatusChip status={complaintStatus(c.status)} size="sm" />
                      {c.status !== 'resolved' && <StatusChip status={clock} size="sm" />}
                    </div>
                  </div>
                  {canOpen('sales_complaints') && (
                    <button
                      type="button"
                      onClick={() => onOpen('sales_complaints', 'open')}
                      className="mt-2.5 min-h-[48px] px-3 rounded-lg border border-slate-200 bg-white text-[14px] font-bold text-blue-700 hover:border-blue-500"
                    >
                      Open this complaint
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* --------------------------------------------------------- CAPAs */}
      <section aria-label="CAPA register">
        <SectionHeading icon={ClipboardCheck}>
          CAPA register — {openCapas.length} open of {capas.length}
        </SectionHeading>
        {capas.length === 0 ? (
          <DashboardEmptyState
            icon={<ClipboardCheck className="w-8 h-8" aria-hidden="true" />}
            title="No CAPAs raised"
            whatFillsThis="A CAPA is raised from a complaint or a production rejection. It appears here with the person responsible and how long it has been open."
          />
        ) : (
          <ul className="space-y-2">
            {[...capas].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((c) => (
              <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold text-slate-900">{c.rootCause || 'Root cause not recorded'}</p>
                    <p className="text-[15px] text-slate-600 mt-0.5">{c.correctiveAction}</p>
                    <p className="text-[14px] text-slate-900 mt-1">
                      <span className="font-semibold">{c.responsiblePerson}</span>
                      {' · open '}{daysSince(c.dueDate) > 0 ? `${daysSince(c.dueDate)} days past due` : `until ${c.dueDate}`}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <StatusChip status={capaStatus(c.status)} size="sm" />
                    {c.status !== 'closed' && <StatusChip status={countdown(c.dueDate)} size="sm" />}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ----------------------------------------------------- maintenance */}
      <section aria-label="Maintenance by category">
        <SectionHeading icon={Wrench}>Maintenance jobs by category, per machine</SectionHeading>
        <p className="text-[14px] text-slate-600 mb-2">
          Counted as jobs, not hours — the log books record when a job was done, not how long the line stood.
        </p>
        {downtime.length === 0 ? (
          <DashboardEmptyState
            icon={<Wrench className="w-8 h-8" aria-hidden="true" />}
            title="No maintenance jobs recorded"
            whatFillsThis="Preventive, calibration and overhaul jobs raised against a machine appear here grouped by machine."
          />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <ul className="space-y-2.5">
              {downtime.map(([machineId, categories]) => {
                const total = [...categories.values()].reduce((s, n) => s + n, 0);
                return (
                  <li key={machineId} className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-[15px] font-semibold text-slate-900 w-16 shrink-0">{machineId}</span>
                    <span className="flex-1 flex items-center gap-1 min-w-[140px]">
                      {[...categories.entries()].map(([type, count]) => (
                        <span
                          key={type}
                          className={`h-6 rounded ${toneSolid(type === 'Overhaul' ? 'red' : type === 'Calibration' ? 'amber' : 'green')} flex items-center justify-center text-[12px] font-bold px-1.5`}
                          style={{ flexGrow: count }}
                          title={`${type}: ${count} ${count === 1 ? 'job' : 'jobs'}`}
                        >
                          {count}
                        </span>
                      ))}
                    </span>
                    <span className="font-mono text-[14px] text-slate-900 shrink-0">{qty(total)} jobs</span>
                    {canOpen('preventive') && (
                      <button
                        type="button"
                        onClick={() => onOpen('preventive')}
                        className="min-h-[48px] px-3 rounded-lg border border-slate-200 text-[14px] font-bold text-blue-700 hover:border-blue-500 shrink-0"
                      >
                        Open
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 flex flex-wrap gap-3 text-[13px] text-slate-600">
              <span className="inline-flex items-center gap-1.5"><span className={`w-3 h-3 rounded ${toneSolid('green')}`} /> Preventive</span>
              <span className="inline-flex items-center gap-1.5"><span className={`w-3 h-3 rounded ${toneSolid('amber')}`} /> Calibration</span>
              <span className="inline-flex items-center gap-1.5"><span className={`w-3 h-3 rounded ${toneSolid('red')}`} /> Overhaul</span>
            </p>
          </div>
        )}
      </section>

      {openComplaints.length === 0 && openCapas.length === 0 && buckets.length === 0 && (
        <p className="text-[15px] text-slate-600">Nothing has been rejected or complained about yet.</p>
      )}
    </div>
  );
}
