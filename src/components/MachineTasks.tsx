/**
 * MachineTasks — scheduled/running production plans grouped by machine. Each task
 * opens that plan's logbook sheet (template-driven) to fill and submit. Floor QR
 * deep-links and in-app scans land on MachineHub first (info + log CTA).
 */
import { useEffect, useMemo, useState } from 'react';
import { Gauge, ArrowLeft, ArrowRight, Lock, FileSpreadsheet } from 'lucide-react';
import { useLogbookTasks } from '../lib/queries/logbook';
import { EmptyState } from './EmptyState';
import { DataTable } from './DataTable';
import LogbookModule from './LogbookModule';
import MachineHub from './MachineHub';

const STUB = {
  templates: [], setTemplates: () => {}, machineLogbooks: [], setMachineLogbooks: () => {},
  productionPlans: [], salesOrders: [],
};

const statusPill = (s?: string) => {
  if (s === 'submitted') return <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800"><Lock className="w-3 h-3" /> Submitted</span>;
  if (s === 'draft') return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Draft</span>;
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Not started</span>;
};

type FlatTask = {
  id: string;
  machine: string;
  line: string;
  soNumber: string;
  product: string;
  shift: string;
  date: string;
  templateLabel?: string;
  logStatus?: string;
};

export default function MachineTasks({
  initialMachineCode,
  onMachineCodeConsumed,
}: {
  initialMachineCode?: string | null;
  onMachineCodeConsumed?: () => void;
} = {}) {
  const q = useLogbookTasks();
  const groups = q.data ?? [];
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [hubCode, setHubCode] = useState<string | null>(null);

  useEffect(() => {
    const code = (initialMachineCode ?? '').trim().toUpperCase();
    if (!code) return;
    setHubCode(code);
    setOpenPlan(null);
    onMachineCodeConsumed?.();
  }, [initialMachineCode, onMachineCodeConsumed]);

  const rows: FlatTask[] = useMemo(() => groups.flatMap((g) => g.tasks.map((task) => ({
    id: task.id,
    machine: g.machine,
    line: g.line,
    soNumber: task.salesOrder?.soNumber ?? 'No order',
    product: task.salesOrder?.product ?? '—',
    shift: task.shift === 'D' ? 'Day' : 'Night',
    date: task.scheduledStartDate.split('T')[0],
    templateLabel: task.logbookTemplate ? `${task.logbookTemplate.docNo} · ${task.logbookTemplate.layout}` : undefined,
    logStatus: task.logbook?.status,
  }))), [groups]);

  if (hubCode) {
    return (
      <MachineHub
        machineCode={hubCode}
        onBack={() => setHubCode(null)}
      />
    );
  }

  if (openPlan) {
    return (
      <div className="space-y-3">
        <button onClick={() => setOpenPlan(null)} className="inline-flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-500"><ArrowLeft className="w-4 h-4" /> Back to machine tasks</button>
        <LogbookModule {...STUB} initialTab="operator" initialPlanId={openPlan} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Machine Tasks</h2>
        <p className="text-[12px] text-slate-500">Scheduled production on each line — open a task to fill its log book.</p>
      </div>
      <DataTable
        loading={q.isLoading}
        rows={rows}
        rowKey={(t) => t.id}
        empty={<EmptyState icon={<Gauge className="w-8 h-8" />} title="No scheduled tasks." hint="Plans scheduled by Planning appear here per machine." />}
        columns={[
          { key: 'machine', header: 'Machine', cell: (t) => (
            <div>
              <div className="font-bold">{t.machine}</div>
              <div className="text-[11px] text-slate-500">{t.line}</div>
            </div>
          ) },
          { key: 'so', header: 'SO', cell: (t) => <span className="font-mono font-bold">{t.soNumber}</span> },
          { key: 'product', header: 'Product', cell: (t) => t.product },
          { key: 'shift', header: 'Shift', cell: (t) => t.shift },
          { key: 'date', header: 'Date', className: 'whitespace-nowrap font-mono', cell: (t) => t.date },
          { key: 'tpl', header: 'Template', cell: (t) => t.templateLabel ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold"><FileSpreadsheet className="w-3 h-3" /> {t.templateLabel}</span>
          ) : '—' },
          { key: 'status', header: 'Logbook', cell: (t) => statusPill(t.logStatus) },
          { key: 'act', header: '', align: 'right', cell: (t) => (
            <div className="inline-flex gap-1.5">
              <button
                type="button"
                onClick={() => setHubCode(t.machine)}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50"
              >
                Hub
              </button>
              <button onClick={() => setOpenPlan(t.id)} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold">
                {t.logStatus === 'submitted' ? 'View' : 'Log'} <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) },
        ]}
      />
    </div>
  );
}
