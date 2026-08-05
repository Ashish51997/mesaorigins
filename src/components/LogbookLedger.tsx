/**
 * Logbook Ledger — submitted production history with date filters, summary KPIs,
 * trend charts, and a View action that opens the locked sheet (LogbookModule).
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  BookOpen, CheckCircle2, Gauge, Package2, Trash2, Factory, ArrowLeft, ArrowRight,
  CalendarRange, Percent,
} from 'lucide-react';
import { EmptyState } from './EmptyState';
import { DataTable } from './DataTable';
import { D3BarChart, D3DonutChart, D3LineChart } from './D3Charts';
import LogbookModule from './LogbookModule';
import { useLogbookLedger, type ApiLogbookLedgerRow } from '../lib/queries/logbook';

const STUB = {
  templates: [], setTemplates: () => {}, machineLogbooks: [], setMachineLogbooks: () => {},
  productionPlans: [], salesOrders: [],
};

type Preset = '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom';

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rangeForPreset(preset: Preset): { from?: string; to?: string } {
  const to = isoToday();
  if (preset === 'all') return {};
  if (preset === 'ytd') return { from: `${to.slice(0, 4)}-01-01`, to };
  if (preset === '7d') return { from: addDays(to, -6), to };
  if (preset === '30d') return { from: addDays(to, -29), to };
  if (preset === '90d') return { from: addDays(to, -89), to };
  return {};
}

function SummaryCard({ icon, label, value, sub }: {
  icon: ReactNode; label: string; value: string | number; sub?: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {icon}{label}
      </div>
      <div className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 min-h-[260px]">
      <div className="mb-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</div>
        {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function fmtKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

export default function LogbookLedger() {
  const [preset, setPreset] = useState<Preset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(isoToday());
  const [openPlan, setOpenPlan] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset === 'custom') {
      return {
        from: customFrom || undefined,
        to: customTo || undefined,
      };
    }
    return rangeForPreset(preset);
  }, [preset, customFrom, customTo]);

  const q = useLogbookLedger(range);
  const summary = q.data?.summary;
  const rows = q.data?.rows ?? [];
  const charts = q.data?.charts;

  const lineData = useMemo(
    () => (charts?.byDay ?? []).map((d) => ({
      date: d.date,
      value: d.producedKg,
      secondaryValue: d.consumedKg,
    })),
    [charts],
  );

  const machineBars = useMemo(
    () => (charts?.byMachine ?? []).slice(0, 8).map((m) => ({
      label: m.label,
      value: m.producedKg,
      color: '#0d9488',
    })),
    [charts],
  );

  const massDonut = useMemo(() => {
    const produced = summary?.producedKg ?? 0;
    const waste = summary?.wasteKg ?? 0;
    const data = [
      { label: 'Produced', value: produced, color: '#059669' },
      { label: 'Waste / reject', value: waste, color: '#e11d48' },
    ].filter((d) => d.value > 0);
    return data.length ? data : [{ label: 'No mass yet', value: 1, color: '#cbd5e1' }];
  }, [summary]);

  if (openPlan) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setOpenPlan(null)}
          className="inline-flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-500"
        >
          <ArrowLeft className="w-4 h-4" /> Back to logbook ledger
        </button>
        <LogbookModule {...STUB} initialTab="operator" initialPlanId={openPlan} />
      </div>
    );
  }

  const rangeLabel = range.from || range.to
    ? `${range.from ?? '…'} → ${range.to ?? '…'}`
    : 'All submitted sheets';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Logbook Ledger</h2>
          <p className="text-[12px] text-slate-500">
            Submitted production sheets — filter by date, read trends, open any entry.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <CalendarRange className="w-3.5 h-3.5" /> Period
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={`h-8 px-3 rounded-lg text-xs font-bold transition-colors ${
                preset === p.id
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {preset === 'custom' && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <label className="text-xs text-slate-500">
            From
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="mt-1 block h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-500">
            To
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="mt-1 block h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-sm"
            />
          </label>
          <p className="text-[11px] text-slate-400 pb-2">Showing sheets whose log date falls in this range.</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3">
        <SummaryCard
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          label="Submitted"
          value={summary?.submitted ?? '—'}
          sub={rangeLabel}
        />
        <SummaryCard
          icon={<Package2 className="w-3.5 h-3.5" />}
          label="Produced"
          value={summary ? `${fmtKg(summary.producedKg)} kg` : '—'}
          sub={summary ? `${fmtKg(summary.rolls)} rolls` : undefined}
        />
        <SummaryCard
          icon={<Gauge className="w-3.5 h-3.5" />}
          label="RM consumed"
          value={summary ? `${fmtKg(summary.consumedKg)} kg` : '—'}
          sub="from formulations"
        />
        <SummaryCard
          icon={<Trash2 className="w-3.5 h-3.5" />}
          label="Waste / reject"
          value={summary ? `${fmtKg(summary.wasteKg)} kg` : '—'}
          sub="process + lumps + scrap"
        />
        <SummaryCard
          icon={<Percent className="w-3.5 h-3.5" />}
          label="Yield"
          value={summary ? `${summary.yieldPct}%` : '—'}
          sub="produced ÷ (produced + waste)"
        />
        <SummaryCard
          icon={<Factory className="w-3.5 h-3.5" />}
          label="Machines"
          value={summary?.machines ?? '—'}
          sub={summary?.shifts?.length ? `shifts ${summary.shifts.join(' · ')}` : undefined}
        />
        <SummaryCard
          icon={<BookOpen className="w-3.5 h-3.5" />}
          label="Shifts"
          value={summary?.shifts?.length ?? '—'}
          sub={summary?.shifts?.length ? summary.shifts.join(', ') : 'none in range'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <ChartCard title="Production over time" hint="Produced kg (solid) vs RM consumed kg (dashed)">
            {lineData.length === 0 ? (
              <p className="text-sm text-slate-400 py-16 text-center">No submitted sheets in this period.</p>
            ) : (
              <D3LineChart data={lineData} height={220} yAxisLabel="Kg" color="#0d9488" />
            )}
          </ChartCard>
        </div>
        <ChartCard title="Mass balance" hint="Good output vs waste in the selected period">
          {summary && summary.submitted > 0 ? (
            <D3DonutChart
              data={massDonut}
              height={200}
              centerLabel="Yield"
              centerValue={`${summary.yieldPct}%`}
            />
          ) : (
            <p className="text-sm text-slate-400 py-16 text-center">No mass data yet.</p>
          )}
        </ChartCard>
        <div className="lg:col-span-3">
          <ChartCard title="Output by machine" hint="Produced kg ranked across machines in range">
            {machineBars.length === 0 ? (
              <p className="text-sm text-slate-400 py-12 text-center">No machine output in this period.</p>
            ) : (
              <D3BarChart data={machineBars} height={200} yAxisLabel="Kg" />
            )}
          </ChartCard>
        </div>
      </div>

      <DataTable
        title={`Submitted logbooks (${rows.length})`}
        loading={q.isLoading}
        rows={rows}
        rowKey={(r: ApiLogbookLedgerRow) => r.id}
        empty={
          <EmptyState
            icon={<BookOpen className="w-8 h-8" />}
            title="No submitted logbooks in this period."
            hint="Widen the date range, or close a shift sheet from Machine Tasks."
          />
        }
        columns={[
          {
            key: 'date',
            header: 'Date',
            mobile: 'title',
            cell: (r) => (
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-100">{r.isoDate || r.date || '—'}</div>
                {r.date && r.date !== r.isoDate && (
                  <div className="text-[10px] text-slate-400 font-mono">{r.date}</div>
                )}
              </div>
            ),
          },
          {
            key: 'machine',
            header: 'Machine',
            mobile: 'badge',
            cell: (r) => <span className="font-mono text-[12px] font-bold">{r.machineId || '—'}</span>,
          },
          {
            key: 'shift',
            header: 'Shift',
            cell: (r) => r.shift || '—',
          },
          {
            key: 'so',
            header: 'SO',
            mobile: 'subtitle',
            cell: (r) => <span className="font-mono text-[12px]">{r.soNumber || '—'}</span>,
          },
          {
            key: 'product',
            header: 'Product',
            className: 'min-w-[10rem]',
            cell: (r) => <span className="text-slate-700 dark:text-slate-200 line-clamp-1">{r.productName || '—'}</span>,
          },
          {
            key: 'formula',
            header: 'Formula',
            cell: (r) => <span className="font-mono text-[11px] text-slate-500">{r.formulaNo || '—'}</span>,
          },
          {
            key: 'rolls',
            header: 'Rolls',
            align: 'right',
            cell: (r) => r.totalRollsProduced || '—',
          },
          {
            key: 'kg',
            header: 'Produced kg',
            align: 'right',
            cell: (r) => <span className="font-semibold">{r.totalRollKgs || '—'}</span>,
          },
          {
            key: 'operator',
            header: 'Operator',
            mobile: 'meta',
            cell: (r) => r.operatorSignature || '—',
          },
          {
            key: 'view',
            header: '',
            align: 'right',
            mobile: 'action',
            cell: (r) => (
              <button
                type="button"
                onClick={() => setOpenPlan(r.productionPlanId)}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
              >
                View <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}
