/**
 * MachineTasks — scheduled/running production plans grouped by machine. Each task
 * opens that plan's logbook sheet (template-driven) to fill and submit. The
 * operator's main logging entry.
 */
import { useState } from 'react';
import { Gauge, ArrowLeft, ArrowRight, Lock, FileSpreadsheet } from 'lucide-react';
import { useLogbookTasks } from '../lib/queries/logbook';
import { EmptyState } from './EmptyState';
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

export default function MachineTasks() {
  const q = useLogbookTasks();
  const groups = q.data ?? [];
  const [openPlan, setOpenPlan] = useState<string | null>(null);

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
      {q.isLoading ? <div className="py-10 text-center text-sm text-slate-400">Loading tasks…</div> : groups.length === 0 ? (
        <EmptyState icon={<Gauge className="w-8 h-8" />} title="No scheduled tasks." hint="Plans scheduled by Planning appear here per machine." />
      ) : groups.map((g) => (
        <div key={g.machine} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><Gauge className="w-4 h-4" /></div>
            <div><div className="font-bold text-[14px] text-slate-900 dark:text-white">Machine {g.machine}</div><div className="text-[11px] text-slate-500">{g.line}</div></div>
            <span className="ml-auto text-[11px] text-slate-400">{g.tasks.length} task{g.tasks.length === 1 ? '' : 's'}</span>
          </div>
          <div className="space-y-2">
            {g.tasks.map((task) => {
              const locked = task.logbook?.status === 'submitted';
              return (
                <div key={task.id} className="flex items-center gap-3 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[13px] text-slate-800 dark:text-slate-100 truncate">{task.salesOrder?.soNumber ?? 'No order'} · {task.salesOrder?.product ?? '—'}</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                      {task.shift === 'D' ? 'Day' : 'Night'} shift · {task.scheduledStartDate.split('T')[0]}
                      {task.logbookTemplate && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold"><FileSpreadsheet className="w-3 h-3" /> {task.logbookTemplate.docNo} · {task.logbookTemplate.layout}</span>}
                      {statusPill(task.logbook?.status)}
                    </div>
                  </div>
                  <button onClick={() => setOpenPlan(task.id)} className="shrink-0 inline-flex items-center gap-1 h-9 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold">
                    {locked ? 'View log' : 'Log'} <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
