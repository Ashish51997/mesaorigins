/**
 * Managing Director home — full Figma management dashboard redesign (no finance).
 * Mobile-first: stacked sections, snap KPI strip, vertical passport timeline.
 * Data from GET /api/management/overview.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bell,
  Box,
  ChevronRight,
  Cpu,
  FolderOpen,
  Minus,
  Package,
  Search,
  Truck,
  User,
} from 'lucide-react';
import { D3GroupedBarChart } from './D3Charts';
import { useManagementOverview } from '../lib/queries/dashboard';
import { StatusBadge } from './ui/StatusBadge';

function formatKg(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatDayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function formatLongDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function TrendBadge({
  trendPct,
  invertGood,
}: {
  trendPct: number | null;
  invertGood?: boolean;
}) {
  if (trendPct == null) {
    return (
      <StatusBadge tone="neutral">
        <Minus className="h-2.5 w-2.5" aria-hidden /> Stable
      </StatusBadge>
    );
  }
  const up = trendPct >= 0;
  const good = invertGood ? !up : up;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <StatusBadge tone={good ? 'success' : 'error'}>
      <Icon className="h-2.5 w-2.5" aria-hidden />
      {up ? '+' : ''}
      {trendPct}%
    </StatusBadge>
  );
}

function KpiCard({
  label,
  value,
  trendPct,
  vs,
  invertGood,
  sub,
  className = '',
}: {
  label: string;
  value: string;
  trendPct?: number | null;
  vs?: string;
  invertGood?: boolean;
  sub?: string;
  className?: string;
}) {
  return (
    <article
      className={`flex min-h-[112px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 sm:min-h-[125px] sm:p-5 ${className}`}
    >
      <p className="text-[12px] font-medium leading-snug text-slate-500">{label}</p>
      <p className="mt-2 font-sans text-[24px] font-extrabold leading-none tracking-tight text-slate-900 sm:text-[28px]">
        {value}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        {trendPct !== undefined && <TrendBadge trendPct={trendPct} invertGood={invertGood} />}
        {vs && <span className="text-[12px] text-slate-500">{vs}</span>}
        {sub && <span className="w-full text-[12px] text-slate-500 sm:w-auto">{sub}</span>}
      </div>
    </article>
  );
}

function SectionCard({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`rounded-xl border border-slate-200 bg-white p-4 sm:p-5 ${className}`}>
      {children}
    </section>
  );
}

function PrimaryButton({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700 ${className}`}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-sky-600 bg-white px-4 text-sm font-medium text-sky-700 hover:bg-sky-50 ${className}`}
    >
      {children}
    </button>
  );
}

const PASSPORT_STEPS = [
  { id: 'rm', label: 'Raw Material', detail: 'Intake & lot', Icon: Package },
  { id: 'issue', label: 'Store Issue', detail: 'Issue to line', Icon: FolderOpen },
  { id: 'prod', label: 'Production', detail: 'Extrusion & QA', Icon: Cpu },
  { id: 'pack', label: 'Packing', detail: 'Finish & label', Icon: Box },
  { id: 'dispatch', label: 'Dispatch', detail: 'Vehicle & invoice', Icon: Truck },
  { id: 'customer', label: 'Customer', detail: 'Delivery', Icon: User },
] as const;

function PassportStepper({ activeStepIndex, activeBatch }: { activeStepIndex: number; activeBatch: string }) {
  return (
    <SectionCard>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-slate-900">End-to-End Traceability</h3>
        <p className="mt-0.5 text-[13px] text-slate-500">
          {activeBatch
            ? `Batch Passport · ${activeBatch}`
            : 'Trace a batch above to follow its passport across the plant.'}
        </p>
      </div>

      {/* Mobile: vertical timeline */}
      <ol className="space-y-0 sm:hidden" aria-label="Batch passport stages">
        {PASSPORT_STEPS.map((step, i) => {
          const done = activeStepIndex >= 0 && i < activeStepIndex;
          const current = i === activeStepIndex;
          const Icon = step.Icon;
          return (
            <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < PASSPORT_STEPS.length - 1 && (
                <span
                  className={`absolute left-[17px] top-10 bottom-0 w-0.5 ${done || current ? 'bg-sky-200' : 'bg-slate-200'}`}
                  aria-hidden
                />
              )}
              <div
                className={`relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                  current
                    ? 'border-2 border-sky-600 bg-sky-50 text-sky-700'
                    : done
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm font-semibold ${current || done ? 'text-slate-900' : 'text-slate-500'}`}>
                    {step.label}
                  </p>
                  <StatusBadge tone={done ? 'success' : current ? 'info' : 'neutral'} className="uppercase tracking-wide">
                    {done ? 'Completed' : current ? 'In progress' : 'Pending'}
                  </StatusBadge>
                </div>
                <p className="mt-0.5 text-[12px] text-slate-500">{step.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Tablet+: horizontal stepper with scroll affordance */}
      <div className="hidden -mx-1 overflow-x-auto pb-1 sm:block">
        <ol className="flex min-w-[560px] items-stretch gap-1 px-1 md:min-w-0 md:gap-2" aria-label="Batch passport stages">
          {PASSPORT_STEPS.map((step, i) => {
            const done = activeStepIndex >= 0 && i < activeStepIndex;
            const current = i === activeStepIndex;
            const pending = !done && !current;
            const Icon = step.Icon;
            return (
              <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1 md:gap-2">
                <div
                  className={`flex min-h-[88px] w-full flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-center ${
                    current
                      ? 'border-2 border-sky-600 bg-sky-50'
                      : done
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 ${current ? 'text-sky-700' : done ? 'text-emerald-700' : 'text-slate-400'}`}
                    aria-hidden
                  />
                  <span className={`text-[12px] font-medium ${pending ? 'text-slate-500' : 'text-slate-800'}`}>
                    {step.label}
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    {done ? 'Completed' : current ? 'In progress' : 'Pending'}
                  </span>
                </div>
                {i < PASSPORT_STEPS.length - 1 && (
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </SectionCard>
  );
}

export default function ManagementDashboard({
  userName,
  onOpen,
  onTrace,
  passportQuery,
}: {
  userName: string;
  onOpen: (moduleId: string) => void;
  onTrace: (query: string) => void;
  passportQuery?: string | null;
}) {
  const q = useManagementOverview(true);
  const [traceInput, setTraceInput] = useState('');
  const [quickTrace, setQuickTrace] = useState('');
  const [chartHeight, setChartHeight] = useState(220);

  useEffect(() => {
    const sync = () => setChartHeight(window.matchMedia('(min-width: 640px)').matches ? 220 : 200);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const chartData = useMemo(() => {
    const series = q.data?.productionSeries ?? [];
    return series.map((row) => ({
      label: formatDayLabel(row.date),
      productionKg: row.productionKg,
      scrapKg: row.scrapKg,
    }));
  }, [q.data?.productionSeries]);

  if (q.isLoading) {
    return (
      <div className="space-y-4 pb-4" data-testid="management-dashboard-loading" aria-busy="true">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-4 w-full max-w-md animate-pulse rounded bg-slate-100" />
        <div className="h-11 w-full animate-pulse rounded-lg bg-slate-200" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[112px] animate-pulse rounded-xl bg-slate-200" />
          ))}
        </div>
        <div className="h-56 animate-pulse rounded-xl bg-slate-200" />
        <p className="text-sm text-slate-400">Loading plant overview…</p>
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
        Could not load the management overview. Try refreshing, or open Stock & Inventory from the menu.
      </div>
    );
  }

  const { context, kpis, feedbackOpen, queues, alerts } = q.data;
  const shiftLabel = context.shift === 'D' ? 'Day' : 'Night';
  const firstName = userName.trim().split(/\s+/)[0] || 'Manager';
  const activeBatch = (passportQuery || '').trim();
  const activeStepIndex = activeBatch ? 2 : -1;

  const submitTrace = (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    onTrace(clean);
  };

  return (
    <div
      className="mx-auto w-full max-w-[1116px] space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:space-y-5 lg:space-y-6"
      data-testid="management-dashboard"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 bg-transparent sm:gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Hi {firstName}</h1>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500 sm:text-sm">
              High level overview of business, quality, and extrusion performance
            </p>
          </div>
          <p className="shrink-0 text-[12px] leading-relaxed text-slate-500 sm:max-w-[220px] sm:text-right sm:text-[13px]">
            <span className="font-medium text-slate-700">{userName}</span>
            <span className="text-slate-300"> · </span>
            Shift {context.shift} · {shiftLabel}
            <span className="text-slate-300"> · </span>
            Today, {formatLongDate(context.asOf)}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <label className="relative min-h-11 flex-1">
            <span className="sr-only">Trace anything (Batch Passport search)</span>
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              value={traceInput}
              onChange={(e) => setTraceInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitTrace(traceInput);
              }}
              placeholder="Trace Anything (Batch Passport Search)..."
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-base text-slate-800 placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600 sm:text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => submitTrace(traceInput)}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-sky-600 px-6 text-sm font-medium text-white hover:bg-sky-700 sm:flex-none sm:min-w-[120px] lg:min-w-[160px]"
            >
              Trace
            </button>
            <button
              type="button"
              aria-label={alerts.length ? `${alerts.length} alerts` : 'Notifications'}
              onClick={() => {
                document.getElementById('management-alerts')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }}
              className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-700"
            >
              <Bell className="h-[18px] w-[18px]" aria-hidden />
              {alerts.length > 0 && (
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500" aria-hidden />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* KPI row — snap strip on narrow phones, 2×2 then 4-col */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 min-[400px]:mx-0 min-[400px]:grid min-[400px]:grid-cols-2 min-[400px]:overflow-visible min-[400px]:px-0 min-[400px]:pb-0 xl:grid-cols-4">
        <KpiCard
          className="w-[min(78vw,240px)] shrink-0 snap-start min-[400px]:w-auto"
          label="Production (Kg)"
          value={formatKg(kpis.productionKg.value)}
          trendPct={kpis.productionKg.trendPct}
          vs={kpis.productionKg.vs}
        />
        <KpiCard
          className="w-[min(78vw,240px)] shrink-0 snap-start min-[400px]:w-auto"
          label="Scrap Rate"
          value={`${kpis.scrapRatePct.value.toFixed(2)}%`}
          trendPct={kpis.scrapRatePct.trendPct}
          vs={kpis.scrapRatePct.vs}
          invertGood
        />
        <KpiCard
          className="w-[min(78vw,240px)] shrink-0 snap-start min-[400px]:w-auto"
          label="On-Time Delivery"
          value={`${kpis.onTimeDeliveryPct.value.toFixed(1)}%`}
          trendPct={kpis.onTimeDeliveryPct.trendPct}
          vs={kpis.onTimeDeliveryPct.vs}
        />
        <KpiCard
          className="w-[min(78vw,240px)] shrink-0 snap-start min-[400px]:w-auto"
          label="Active Complaints"
          value={String(kpis.complaints.open)}
          trendPct={null}
          sub={`${kpis.complaints.high} High | ${kpis.complaints.medium} Medium`}
        />
      </div>

      {/* Chart + feedback */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-5">
        <SectionCard className="lg:col-span-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Production Overview</h2>
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-sky-600" aria-hidden /> Production (Kg)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" aria-hidden /> Scrap (Kg)
              </span>
            </div>
          </div>
          <p className="sr-only">Last 7 days production and scrap in kilograms.</p>
          {chartData.every((d) => d.productionKg === 0 && d.scrapKg === 0) ? (
            <p className="py-12 text-center text-sm text-slate-500">No submitted production in the last 7 days.</p>
          ) : (
            <div className="min-h-[200px] w-full overflow-x-auto">
              <div className="min-w-[280px]">
                <D3GroupedBarChart data={chartData} height={chartHeight} />
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Customer Feedback Open</h2>
            <button
              type="button"
              onClick={() => onOpen('sales_complaints')}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 px-1 text-xs font-medium text-sky-700 hover:text-sky-800"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {feedbackOpen.length === 0 ? (
            <p className="py-8 text-sm text-slate-500">No open complaints right now.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {feedbackOpen.map((row) => (
                <li key={row.rank} className="flex min-h-11 items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600">
                    {row.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug text-slate-800">{row.title}</p>
                    <p className="mt-0.5 text-[12px] text-slate-500">{row.occurrences} this month</p>
                  </div>
                  <StatusBadge tone="warn">Open: {row.openCount}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Task queues */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        <SectionCard>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Task Queues</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <h2 className="text-lg font-semibold text-slate-900">QA Gate</h2>
            <StatusBadge tone="info">
              {queues.qa.waitingRolls} roll{queues.qa.waitingRolls === 1 ? '' : 's'}
            </StatusBadge>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
            {(queues.qa.alerts.length > 0
              ? queues.qa.alerts
              : [`${queues.qa.waitingRolls} rolls waiting for QA check`]
            ).map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <PrimaryButton onClick={() => onOpen('roll_queue')}>Certify roll</PrimaryButton>
            <SecondaryButton onClick={() => onOpen('roll_queue')}>Enter reading</SecondaryButton>
          </div>
        </SectionCard>

        <SectionCard>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Task Queues</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Dispatch</h2>
            <StatusBadge tone="info">
              {queues.dispatch.vehicles} vehicle{queues.dispatch.vehicles === 1 ? '' : 's'}
            </StatusBadge>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
            {(queues.dispatch.alerts.length > 0
              ? queues.dispatch.alerts
              : queues.dispatch.vehicles > 0
                ? [`${queues.dispatch.vehicles} order(s) ready — gate pass not released`]
                : ['No vehicles waiting for release']
            ).map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <PrimaryButton onClick={() => onOpen('ready')}>Release vehicle</PrimaryButton>
            <SecondaryButton onClick={() => onOpen('dispatch_history')}>View manifest</SecondaryButton>
          </div>
        </SectionCard>
      </div>

      {/* Alerts + quick trace */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        <SectionCard id="management-alerts">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Key Alerts</h2>
            {alerts.length > 0 && (
              <StatusBadge tone="error">
                {alerts.length} Alert{alerts.length === 1 ? '' : 's'}
              </StatusBadge>
            )}
          </div>
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-500">No urgent alerts.</p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => a.href && onOpen(a.href)}
                    disabled={!a.href}
                    className={`flex w-full min-h-11 items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm ${
                      a.severity === 'critical'
                        ? 'border-rose-200 bg-rose-50 text-rose-900'
                        : a.severity === 'warning'
                          ? 'border-amber-200 bg-amber-50 text-amber-950'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                    } ${a.href ? 'hover:opacity-90' : 'cursor-default'}`}
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
                    <span className="leading-snug">{a.message}</span>
                    {a.href && <ChevronRight className="ml-auto mt-0.5 h-4 w-4 shrink-0 opacity-50" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard>
          <h2 className="text-lg font-semibold text-slate-900">Traceability Quick Search</h2>
          <p className="mt-1 text-[13px] text-slate-500">Search by complaint, invoice, roll, or pallet ID.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label className="relative min-h-11 flex-1">
              <span className="sr-only">Quick trace ID</span>
              <input
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                value={quickTrace}
                onChange={(e) => setQuickTrace(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitTrace(quickTrace);
                }}
                placeholder="Complaint / Invoice / Roll / Pallet ID"
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base text-slate-800 placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600 sm:text-sm"
              />
            </label>
            <PrimaryButton className="sm:flex-none sm:px-6" onClick={() => submitTrace(quickTrace)}>
              Search
            </PrimaryButton>
          </div>
        </SectionCard>
      </div>

      <PassportStepper activeStepIndex={activeStepIndex} activeBatch={activeBatch} />
    </div>
  );
}
