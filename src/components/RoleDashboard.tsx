/**
 * RoleDashboard — the real, tenant-scoped home for every role. All numbers come
 * from GET /api/summary (live value-chain aggregates); no mock data.
 */
import {
  Briefcase, CalendarDays, FileSpreadsheet, CheckCircle2, ShieldAlert, Package2, Users, Gauge, Truck, ArrowRight,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useSummary } from '../lib/queries/dashboard';
import { useLogbookTasks } from '../lib/queries/logbook';

function Kpi({ icon, label, value, sub, tone = 'slate', onClick }: {
  icon: ReactNode; label: string; value: string | number; sub?: string; tone?: string; onClick?: () => void;
}) {
  const ring: Record<string, string> = {
    slate: 'text-slate-500', indigo: 'text-indigo-600', emerald: 'text-emerald-600',
    amber: 'text-amber-600', rose: 'text-rose-600', cyan: 'text-cyan-600',
  };
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 ${onClick ? 'hover:border-indigo-300 cursor-pointer' : 'cursor-default'}`}
    >
      <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide ${ring[tone]}`}>{icon}{label}</div>
      <div className="mt-1 font-display text-3xl font-bold text-slate-900 dark:text-white">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </button>
  );
}

function UpcomingTasks({ onOpen }: { onOpen: (m: string) => void }) {
  const q = useLogbookTasks();
  const rows = useMemo(() => {
    const groups = q.data ?? [];
    return groups.flatMap((g) => g.tasks.map((t) => ({
      id: t.id,
      machine: g.machine,
      so: t.salesOrder?.soNumber ?? '—',
      product: t.salesOrder?.product ?? '—',
      shift: t.shift === 'D' ? 'Day' : 'Night',
      start: (t.scheduledStartDate || '').slice(0, 10),
      status: t.logbook?.status ?? 'not_started',
    }))).slice(0, 6);
  }, [q.data]);

  if (q.isLoading) {
    return <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm text-slate-400">Loading tasks…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Upcoming machine tasks</div>
        <p className="text-sm text-slate-500">No scheduled work yet. New plans appear here for operators.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Upcoming machine tasks</div>
          <p className="text-[11px] text-slate-500">Open a task to fill the shift logbook from your device.</p>
        </div>
        <button type="button" onClick={() => onOpen('machine_tasks')} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-500">
          All tasks <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((r) => (
          <li key={r.id} className="py-2.5 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{r.machine} · {r.shift}</div>
              <div className="text-[11px] text-slate-500 truncate font-mono">{r.so} · {r.product} · {r.start}</div>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              r.status === 'submitted' ? 'bg-emerald-100 text-emerald-800'
                : r.status === 'draft' ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-600'
            }`}>
              {r.status === 'submitted' ? 'Submitted' : r.status === 'draft' ? 'Draft' : 'Ready'}
            </span>
            <button
              type="button"
              onClick={() => onOpen('machine_tasks')}
              className="h-8 px-3 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500"
            >
              Open
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RoleDashboard({ role, onOpen }: { role: string; onOpen: (m: string) => void }) {
  const q = useSummary();
  const s = q.data;
  const showTasks = role === 'Operator' || role === 'Production Planner' || role === 'Administrator' || role === 'Managing Director';

  if (q.isLoading || !s) {
    return <div className="p-10 text-center text-sm text-slate-400">Loading plant KPIs…</div>;
  }

  const go = (m: string) => () => onOpen(m);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Plant at a glance</h2>
        <p className="text-[12px] text-slate-500">Live figures from the value chain — {role}.</p>
      </div>
      <div className="grid grid-cols-1 min-[400px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        <Kpi icon={<Briefcase className="w-3.5 h-3.5" />} label="Orders pending" value={s.orders.pending} sub={`${s.orders.planned} planned · ${s.orders.dispatched} dispatched`} tone="indigo" onClick={go('orders')} />
        <Kpi icon={<FileSpreadsheet className="w-3.5 h-3.5" />} label="Open inquiries" value={s.inquiriesOpen} sub="awaiting quote / order" tone="indigo" onClick={go('inquiries')} />
        <Kpi icon={<CalendarDays className="w-3.5 h-3.5" />} label="Plans running" value={s.plans.running} sub={`${s.plans.scheduled} scheduled`} tone="cyan" onClick={go('plan_board')} />
        <Kpi icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Logbooks submitted" value={s.logbooksSubmitted} sub="production recorded" tone="emerald" onClick={go('logbook_ledger')} />
        <Kpi icon={<ShieldAlert className="w-3.5 h-3.5" />} label="Open complaints" value={s.complaintsOpen} sub={`${s.capasOpen} CAPA open`} tone="rose" onClick={go('sales_complaints')} />
        <Kpi icon={<Package2 className="w-3.5 h-3.5" />} label="RM stock" value={`${s.stock.rawMaterialKg} kg`} sub="raw material on hand" tone="amber" onClick={go('rm_stock')} />
        <Kpi icon={<Truck className="w-3.5 h-3.5" />} label="FG stock" value={`${s.stock.finishedGoodsKg} kg`} sub="finished goods on hand" tone="amber" />
        <Kpi icon={<Gauge className="w-3.5 h-3.5" />} label="Maintenance due" value={s.maintenanceOpen} sub="scheduled / overdue" tone="rose" onClick={go('preventive')} />
        <Kpi icon={<Users className="w-3.5 h-3.5" />} label="Customers" value={s.customers} sub="on file" tone="slate" onClick={go('sales_customers')} />
      </div>
      {showTasks && <UpcomingTasks onOpen={onOpen} />}
    </div>
  );
}
