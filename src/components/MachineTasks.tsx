/**
 * MachineTasks — scheduled/running production plans grouped by machine. Each task
 * opens that plan's logbook sheet (template-driven) to fill and submit. The
 * operator's main logging entry. Floor QR deep-links arrive via initialMachineCode.
 */
import { useEffect, useMemo, useState } from 'react';
import { Gauge, ArrowLeft, ArrowRight, Lock, FileSpreadsheet, QrCode, AlertTriangle } from 'lucide-react';
import { useLogbookTasks, useResolveMachineLogbook } from '../lib/queries/logbook';
import { ApiError } from '../lib/apiClient';
import { EmptyState } from './EmptyState';
import { DataTable } from './DataTable';
import LogbookModule from './LogbookModule';

// LogbookModule keeps legacy props for back-compat; the operator path uses the API.
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
  const [scanCode, setScanCode] = useState<string | null>(null);
  const [dismissedScan, setDismissedScan] = useState(false);

  useEffect(() => {
    const code = (initialMachineCode ?? '').trim().toUpperCase();
    if (!code) return;
    setScanCode(code);
    setDismissedScan(false);
    setOpenPlan(null);
  }, [initialMachineCode]);

  const resolveQ = useResolveMachineLogbook(dismissedScan ? null : scanCode);

  useEffect(() => {
    if (!scanCode || dismissedScan) return;
    if (resolveQ.isLoading || resolveQ.isFetching) return;
    if (resolveQ.isError) return;
    const data = resolveQ.data;
    if (!data) return;
    if (data.reason === 'ok' && data.planId) {
      setOpenPlan(data.planId);
      onMachineCodeConsumed?.();
      setScanCode(null);
    }
  }, [scanCode, dismissedScan, resolveQ.isLoading, resolveQ.isFetching, resolveQ.isError, resolveQ.data, onMachineCodeConsumed]);

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

  const clearScan = () => {
    setDismissedScan(true);
    setScanCode(null);
    onMachineCodeConsumed?.();
  };

  if (openPlan) {
    return (
      <div className="space-y-3">
        <button onClick={() => setOpenPlan(null)} className="inline-flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-500"><ArrowLeft className="w-4 h-4" /> Back to machine tasks</button>
        <LogbookModule {...STUB} initialTab="operator" initialPlanId={openPlan} />
      </div>
    );
  }

  if (scanCode && !dismissedScan) {
    if (resolveQ.isLoading || resolveQ.isFetching) {
      return (
        <div className="mx-auto mt-10 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm" data-testid="machine-qr-resolving">
          <QrCode className="mx-auto h-10 w-10 text-indigo-500" />
          <h3 className="mt-3 text-lg font-bold text-slate-900">Opening machine {scanCode}…</h3>
          <p className="mt-1 text-sm text-slate-500">Looking up the active shift log for this line.</p>
        </div>
      );
    }

    if (resolveQ.isError) {
      const err = resolveQ.error;
      const status = err instanceof ApiError ? err.status : 0;
      const isForbidden = status === 403;
      const isMissing = status === 404;
      return (
        <div className="mx-auto mt-10 max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm" data-testid="machine-qr-denied">
          <AlertTriangle className={`mx-auto h-10 w-10 ${isForbidden ? 'text-amber-500' : 'text-rose-500'}`} />
          <h3 className="text-lg font-bold text-slate-900">
            {isForbidden ? 'No access to log this machine' : isMissing ? `Machine ${scanCode} not found` : 'Could not open this QR'}
          </h3>
          <p className="text-sm text-slate-500">
            {isForbidden
              ? 'Your role cannot open Machine Tasks. Ask an admin for access, or sign in as an operator.'
              : isMissing
                ? 'This sticker does not match a machine in your plant registry.'
                : (err instanceof ApiError ? err.message : 'Something went wrong.')}
          </p>
          <button type="button" onClick={clearScan} className="inline-flex min-h-11 items-center justify-center rounded-full bg-indigo-600 px-5 text-sm font-bold text-white">
            Back to machine tasks
          </button>
        </div>
      );
    }

    if (resolveQ.data?.reason === 'no_active_plan') {
      return (
        <div className="mx-auto mt-10 max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm" data-testid="machine-qr-no-plan">
          <Gauge className="mx-auto h-10 w-10 text-slate-400" />
          <h3 className="text-lg font-bold text-slate-900">No shift scheduled for {scanCode}</h3>
          <p className="text-sm text-slate-500">
            {resolveQ.data.machine.line ? `${resolveQ.data.machine.line}. ` : ''}
            Planning has not scheduled an active plan on this machine yet.
          </p>
          <button type="button" onClick={clearScan} className="inline-flex min-h-11 items-center justify-center rounded-full bg-indigo-600 px-5 text-sm font-bold text-white">
            Back to machine tasks
          </button>
        </div>
      );
    }
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
            <button onClick={() => setOpenPlan(t.id)} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold">
              {t.logStatus === 'submitted' ? 'View' : 'Log'} <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) },
        ]}
      />
    </div>
  );
}
