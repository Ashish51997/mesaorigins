/**
 * RoleDashboard — the real, tenant-scoped home for every role. All numbers come
 * from GET /api/summary (live value-chain aggregates); no mock data.
 */
import {
  Briefcase, CalendarDays, FileSpreadsheet, CheckCircle2, ShieldAlert, Package2, Users, Gauge, Truck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useSummary } from '../lib/queries/dashboard';

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

export default function RoleDashboard({ role, onOpen }: { role: string; onOpen: (m: string) => void }) {
  const q = useSummary();
  const s = q.data;

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
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        <Kpi icon={<Briefcase className="w-3.5 h-3.5" />} label="Orders pending" value={s.orders.pending} sub={`${s.orders.planned} planned · ${s.orders.dispatched} dispatched`} tone="indigo" onClick={go('orders')} />
        <Kpi icon={<FileSpreadsheet className="w-3.5 h-3.5" />} label="Open inquiries" value={s.inquiriesOpen} sub="awaiting quote / order" tone="indigo" onClick={go('inquiries')} />
        <Kpi icon={<CalendarDays className="w-3.5 h-3.5" />} label="Plans running" value={s.plans.running} sub={`${s.plans.scheduled} scheduled`} tone="cyan" onClick={go('plan_board')} />
        <Kpi icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Logbooks submitted" value={s.logbooksSubmitted} sub="production recorded" tone="emerald" onClick={go('logbooks')} />
        <Kpi icon={<ShieldAlert className="w-3.5 h-3.5" />} label="Open complaints" value={s.complaintsOpen} sub={`${s.capasOpen} CAPA open`} tone="rose" onClick={go('sales_complaints')} />
        <Kpi icon={<Package2 className="w-3.5 h-3.5" />} label="RM stock" value={`${s.stock.rawMaterialKg} kg`} sub="raw material on hand" tone="amber" onClick={go('rm_stock')} />
        <Kpi icon={<Truck className="w-3.5 h-3.5" />} label="FG stock" value={`${s.stock.finishedGoodsKg} kg`} sub="finished goods on hand" tone="amber" />
        <Kpi icon={<Gauge className="w-3.5 h-3.5" />} label="Maintenance due" value={s.maintenanceOpen} sub="scheduled / overdue" tone="rose" onClick={go('preventive')} />
        <Kpi icon={<Users className="w-3.5 h-3.5" />} label="Customers" value={s.customers} sub="on file" tone="slate" onClick={go('sales_customers')} />
      </div>
    </div>
  );
}
