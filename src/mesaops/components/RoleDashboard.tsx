/**
 * RoleDashboard — tenant-scoped home for non-MD roles.
 * Live KPIs from GET /api/summary. Mobile-first MesaOrigins layout.
 */
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  FileSpreadsheet,
  Gauge,
  Package2,
  QrCode,
  ShieldAlert,
  Truck,
  Users,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useSummary } from '@mesaops/lib/queries/dashboard';
import { useLogbookTasks } from '@mesaops/lib/queries/logbook';
import MachineQrScanner from './MachineQrScanner';
import { StatusBadge } from '@shared/components/ui/StatusBadge';

type KpiTone = 'primary' | 'success' | 'warn' | 'error' | 'neutral';

const TONE_ICON: Record<KpiTone, string> = {
  primary: 'bg-[#DBEAFE] text-[#1E40AF]',
  success: 'bg-[#D1FAE5] text-[#065F46]',
  warn: 'bg-[#FEF3C7] text-[#92400E]',
  error: 'bg-[#FEE2E2] text-[#991B1B]',
  neutral: 'bg-[#F1F5F9] text-[#475569]',
};

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone = 'primary',
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  tone?: KpiTone;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={[
        'group flex min-h-[112px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 text-left',
        'sm:min-h-[120px] sm:p-5',
        'snap-center shrink-0',
        'w-[min(78vw,280px)] min-[400px]:w-full',
        interactive
          ? 'cursor-pointer transition-colors hover:border-[#93C5FD] hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E40AF]'
          : 'cursor-default',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}
          aria-hidden
        >
          {icon}
        </span>
        {interactive && (
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 group-hover:text-[#1E40AF]" aria-hidden />
        )}
      </div>
      <div className="mt-3 min-w-0">
        <p className="text-[12px] font-medium leading-snug text-slate-600">{label}</p>
        <p className="mt-1 font-sans text-[24px] font-extrabold leading-none tracking-tight text-slate-900 tabular-nums sm:text-[28px]">
          {value}
        </p>
        {sub && <p className="mt-1.5 text-[12px] leading-snug text-slate-500">{sub}</p>}
      </div>
    </button>
  );
}

function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading plant KPIs">
      <div className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded-md bg-slate-200" />
        <div className="h-4 w-64 max-w-full animate-pulse rounded-md bg-slate-100" />
      </div>
      <div className="flex gap-3 overflow-hidden sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="min-h-[112px] min-w-[240px] animate-pulse rounded-xl border border-slate-200 bg-white p-4 sm:min-w-0">
            <div className="h-9 w-9 rounded-lg bg-slate-100" />
            <div className="mt-4 h-3 w-20 rounded bg-slate-100" />
            <div className="mt-2 h-7 w-16 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingTasks({ userName, onOpen }: { userName: string; onOpen: (m: string) => void }) {
  const q = useLogbookTasks();
  const rows = useMemo(() => {
    const groups = q.data ?? [];
    const mine = userName.trim();
    return groups.flatMap((g) => g.tasks.map((t) => ({
      id: t.id,
      machine: g.machine,
      so: t.salesOrder?.soNumber ?? '—',
      product: t.salesOrder?.product ?? '—',
      shift: t.shift === 'D' ? 'Day' : 'Night',
      start: (t.scheduledStartDate || '').slice(0, 10),
      status: t.logbook?.status ?? 'not_started',
      operatorName: t.operatorName ?? '',
    }))).filter((t) => {
      if (t.status === 'submitted') return false;
      if (!mine) return false;
      return namesMatch(t.operatorName, mine);
    }).slice(0, 6);
  }, [q.data, userName]);

  if (q.isLoading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <p className="text-sm text-slate-400">Loading tasks…</p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Your queue</p>
          <h3 className="mt-0.5 text-lg font-semibold text-slate-900">Pending machine tasks</h3>
          <p className="mt-1 text-[13px] text-slate-500">
            Assigned plans waiting for a logbook — open one to fill from your device.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpen('machine_tasks')}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-[#1E40AF] hover:bg-[#EFF6FF]"
        >
          All tasks <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center sm:px-5">
          <p className="text-sm font-medium text-slate-700">You&apos;re clear</p>
          <p className="mt-1 text-[13px] text-slate-500">No pending machine tasks assigned to you right now.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-semibold text-slate-900">
                    {r.machine}
                    <span className="font-normal text-slate-400"> · </span>
                    {r.shift}
                  </p>
                  <StatusBadge tone={r.status === 'draft' ? 'warn' : 'neutral'}>
                    {r.status === 'draft' ? 'Draft' : 'Ready'}
                  </StatusBadge>
                </div>
                <p className="mt-0.5 truncate font-mono text-[12px] text-slate-500">
                  {r.so} · {r.product} · {r.start}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpen('machine_tasks')}
                className="inline-flex min-h-9 w-full items-center justify-center gap-1 rounded-lg bg-[#1E40AF] px-4 text-sm font-medium text-white hover:bg-[#1E3A8A] sm:w-auto"
              >
                Open <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function RoleDashboard({
  role,
  userName,
  canAccess,
  onOpen,
  onScanMachine,
}: {
  role: string;
  userName: string;
  canAccess: (screenId: string) => boolean;
  onOpen: (m: string) => void;
  /** Navigate to machine hub after QR / typed code. */
  onScanMachine?: (machineCode: string) => void;
}) {
  const q = useSummary();
  const s = q.data;
  const showTasks = canAccess('machine_tasks');
  const [scanOpen, setScanOpen] = useState(false);

  if (q.isLoading || !s) {
    return <DashboardSkeleton />;
  }

  const go = (m: string) => () => onOpen(m);
  const firstName = userName.trim().split(/\s+/)[0] || role;

  const kpis = [
    canAccess('orders') && {
      key: 'orders',
      el: (
        <KpiCard
          icon={<Briefcase className="h-4 w-4" />}
          label="Orders pending"
          value={s.orders.pending}
          sub={`${s.orders.planned} planned · ${s.orders.dispatched} dispatched`}
          tone="primary"
          onClick={go('orders')}
        />
      ),
    },
    (canAccess('enquiry_desk') || canAccess('inquiries') || canAccess('quotations')) && {
      key: 'enquiry_desk',
      el: (
        <KpiCard
          icon={<FileSpreadsheet className="h-4 w-4" />}
          label="Open enquiries"
          value={s.inquiriesOpen}
          sub="Awaiting quote or order"
          tone="primary"
          onClick={go('enquiry_desk')}
        />
      ),
    },
    canAccess('plan_board') && {
      key: 'plan_board',
      el: (
        <KpiCard
          icon={<CalendarDays className="h-4 w-4" />}
          label="Plans running"
          value={s.plans.running}
          sub={`${s.plans.scheduled} scheduled`}
          tone="primary"
          onClick={go('plan_board')}
        />
      ),
    },
    canAccess('logbook_ledger') && {
      key: 'logbook_ledger',
      el: (
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Logbooks submitted"
          value={s.logbooksSubmitted}
          sub="Production recorded"
          tone="success"
          onClick={go('logbook_ledger')}
        />
      ),
    },
    canAccess('sales_complaints') && {
      key: 'sales_complaints',
      el: (
        <KpiCard
          icon={<ShieldAlert className="h-4 w-4" />}
          label="Open complaints"
          value={s.complaintsOpen}
          sub={`${s.capasOpen} CAPA open`}
          tone="error"
          onClick={go('sales_complaints')}
        />
      ),
    },
    canAccess('rm_stock') && {
      key: 'rm_stock',
      el: (
        <KpiCard
          icon={<Package2 className="h-4 w-4" />}
          label="RM stock"
          value={`${s.stock.rawMaterialKg.toLocaleString('en-IN')} kg`}
          sub="Raw material on hand"
          tone="warn"
          onClick={go('rm_stock')}
        />
      ),
    },
    canAccess('rm_stock') && {
      key: 'fg_stock',
      el: (
        <KpiCard
          icon={<Truck className="h-4 w-4" />}
          label="FG stock"
          value={`${s.stock.finishedGoodsKg.toLocaleString('en-IN')} kg`}
          sub="Finished goods on hand"
          tone="warn"
          onClick={go('rm_stock')}
        />
      ),
    },
    canAccess('preventive') && {
      key: 'preventive',
      el: (
        <KpiCard
          icon={<Gauge className="h-4 w-4" />}
          label="Maintenance due"
          value={s.maintenanceOpen}
          sub="Scheduled or overdue"
          tone="error"
          onClick={go('preventive')}
        />
      ),
    },
    canAccess('sales_customers') && {
      key: 'sales_customers',
      el: (
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          label="Customers"
          value={s.customers}
          sub="On file"
          tone="neutral"
          onClick={go('sales_customers')}
        />
      ),
    },
  ].filter(Boolean) as Array<{ key: string; el: ReactNode }>;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-slate-500">
            Hello{firstName ? `, ${firstName}` : ''}
          </p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
            Plant at a glance
          </h2>
          <p className="mt-1 text-[14px] leading-relaxed text-slate-600">
            Live figures from the screens you can open
            <span className="text-slate-400"> · </span>
            <span className="font-medium text-slate-700">{role}</span>
          </p>
        </div>

        {showTasks && onScanMachine && (
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            className="inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-[#1E40AF] px-4 text-sm font-medium text-white hover:bg-[#1E3A8A] sm:min-h-9 sm:w-auto"
            data-testid="dashboard-scan-qr"
          >
            <QrCode className="h-4 w-4" />
            Scan machine QR
          </button>
        )}
      </div>

      {/* KPIs — horizontal snap on narrow phones; grid from ~400px */}
      {kpis.length > 0 ? (
        <section aria-label="Key metrics">
          <div
            className={[
              'flex gap-3 overflow-x-auto pb-1 -mx-4 px-4',
              'snap-x snap-mandatory scroll-px-4',
              'min-[400px]:mx-0 min-[400px]:grid min-[400px]:grid-cols-2 min-[400px]:overflow-visible min-[400px]:px-0 min-[400px]:pb-0 min-[400px]:snap-none',
              'md:grid-cols-3',
              'xl:grid-cols-4',
              '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            ].join(' ')}
          >
            {kpis.map((k) => (
              <div key={k.key} className="min-[400px]:contents">
                {k.el}
              </div>
            ))}
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400 min-[400px]:hidden">
            Swipe for more metrics
          </p>
        </section>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center">
          <p className="text-sm font-medium text-slate-700">No KPI screens in your menu</p>
          <p className="mt-1 text-[13px] text-slate-500">
            Open a module from the sidebar when you need detail.
          </p>
        </div>
      )}

      {showTasks && <PendingTasks userName={userName} onOpen={onOpen} />}

      {showTasks && onScanMachine && (
        <MachineQrScanner
          open={scanOpen}
          onClose={() => setScanOpen(false)}
          onScan={(code) => {
            setScanOpen(false);
            onScanMachine(code);
          }}
        />
      )}
    </div>
  );
}
