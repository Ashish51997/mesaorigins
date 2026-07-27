/**
 * MaintenanceScreens.tsx — Maintenance Head (PROMPT 08, light). Home ·
 * Breakdowns · Preventive Schedule · Downtime Analytics · Machine History ·
 * Calibration Register. Reads operator-raised breakdowns (shared store): an
 * operator breakdown shows here with a red nudge → acknowledge → close, which
 * brings the machine back to running and clears the operator + MD views live.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Wrench, CalendarClock, BarChart3, History, Thermometer, AlertTriangle, CheckCircle2, ArrowRight, Cpu, Clock, Plus, X
} from 'lucide-react';
import { initialMachines } from '../../mockData';
import { useLiveMachines } from '../../lib/simulation';
import { useCan } from '../../lib/accessStore';
import { EmptyState } from '../EmptyState';
import { pushToast } from '../Notify';
import { ApiError } from '../../lib/apiClient';
import { useMachines, useMaintenanceTasks, useAddMaintenance, useCompleteMaintenance, type ApiMachine } from '../../lib/queries/maintenance';

export interface MaintData { onOpen: (m: string) => void; onTrace: (q: string) => void; user: string; }

const MACHINES = initialMachines.map((m) => m.id);
const lotOf = (id: string) => initialMachines.find((m) => m.id === id)?.currentLot ?? '';
const dur = (b: { startedAt: number; endedAt?: number }) => Math.round(((b.endedAt ?? Date.now()) - b.startedAt) / 60000);
function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="flex items-center justify-between mb-2"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{title}</div>{right}</div>{children}</div>;
}
const STATUS = { running: { dot: 'bg-emerald-500', word: 'Running' }, attention: { dot: 'bg-amber-500', word: 'Needs a look' }, stopped: { dot: 'bg-rose-500', word: 'Stopped' } };

/* ---------------------------------------------------------------- Home */

function topCategory(bs: { category: string; startedAt: number; endedAt?: number }[]): string | undefined {
  const t: Record<string, number> = {};
  bs.forEach((b) => { t[b.category] = (t[b.category] ?? 0) + dur(b); });
  return Object.entries(t).sort((a, b) => b[1] - a[1])[0]?.[0];
}

/* ---------------------------------------------------------------- Breakdowns */


/* ---------------------------------------------------------------- Preventive Schedule */

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong — please try again.');
const typeChip = (t: string) => <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">{t}</span>;

// Machine-linked maintenance tasks, backed by the API (tenant-scoped). Each task
// belongs to a machine (FR-MNT-02); "Add task" creates one against a machine.
export function PreventiveSchedule(_p: MaintData) {
  const machinesQ = useMachines();
  const tasksQ = useMaintenanceTasks();
  const complete = useCompleteMaintenance();
  const [showAdd, setShowAdd] = useState(false);
  const machines = machinesQ.data ?? [];
  const tasks = tasksQ.data ?? [];
  const pending = tasks.filter((t) => t.status !== 'completed');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">Machine maintenance schedule</h2>
        <button onClick={() => setShowAdd(true)} disabled={machines.length === 0} title={machines.length === 0 ? 'No machines in this plant yet' : undefined} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold shadow-sm cursor-pointer shrink-0">
          <Plus className="w-4 h-4" /> Add task
        </button>
      </div>
      <Card title={`${pending.length} open task(s)`}>
        {tasksQ.isLoading ? <div className="text-[12px] text-slate-400 py-6 text-center">Loading…</div> : pending.length === 0 ? <EmptyState icon={<CalendarClock className="w-8 h-8" />} title="No open maintenance tasks." hint="Add a machine maintenance task to schedule it." /> : (
          <div className="space-y-2">
            {pending.map((t) => {
              const overdue = t.status === 'overdue' || (t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10));
              return (
                <div key={t.id} className="flex flex-wrap items-center gap-3 border border-slate-200 rounded-lg p-3">
                  <span className="font-bold text-[13px] inline-flex items-center gap-1"><Cpu className="w-3.5 h-3.5 text-slate-400" /> {t.machine.code}</span>
                  <span className="text-[13px] text-slate-600">{t.taskName}</span>
                  {typeChip(t.type)}
                  <span className="text-[11px] text-slate-400">{t.frequency}</span>
                  <span className={`text-[11px] font-bold ${overdue ? 'text-rose-700' : 'text-slate-500'}`}>{overdue ? 'overdue' : 'due'} {t.dueDate}</span>
                  <button disabled={complete.isPending} onClick={() => complete.mutate(t.id, { onSuccess: () => pushToast(`${t.machine.code} · ${t.taskName} marked done.`), onError: (e) => pushToast(errMsg(e)) })} className="ml-auto h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-50"><CheckCircle2 className="w-4 h-4 inline -mt-0.5 mr-1" />Mark done</button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {showAdd && <AddMaintenanceModal machines={machines} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

const mtLbl = 'block text-[11px] font-bold text-slate-500 mb-1';
const mtInp = 'w-full h-11 px-3 rounded-lg border border-slate-300 text-sm bg-white text-slate-700';
const TASK_TYPES = ['Preventive', 'Calibration', 'Overhaul', 'Breakdown'] as const;
const FREQS = ['Weekly', 'Monthly', 'Quarterly', 'Semiannually', 'Once (Breakdown)'] as const;

function AddMaintenanceModal({ machines, onClose }: { machines: ApiMachine[]; onClose: () => void }) {
  const addTask = useAddMaintenance();
  const [machineId, setMachineId] = useState(machines[0]?.id ?? '');
  const [taskName, setTaskName] = useState('');
  const [type, setType] = useState<(typeof TASK_TYPES)[number]>('Preventive');
  const [frequency, setFrequency] = useState<(typeof FREQS)[number]>('Monthly');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState('0');
  const valid = !!machineId && taskName.trim() !== '' && dueDate !== '';

  const submit = () => {
    if (!valid || addTask.isPending) return;
    addTask.mutate(
      { machineId, taskName: taskName.trim(), type, frequency, dueDate, cost: Number(cost) || 0 },
      {
        onSuccess: (t) => { pushToast(`Task "${t.taskName}" scheduled for ${t.machine.code}.`); onClose(); },
        onError: (e) => pushToast(errMsg(e)),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Add a maintenance task</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        <label className="block"><span className={mtLbl}>Machine</span>
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)} className={mtInp}>{machines.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.line}</option>)}</select>
        </label>
        <label className="block"><span className={mtLbl}>Task</span>
          <input value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder="e.g. Gearbox oil flush & bearing inspection" className={mtInp} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={mtLbl}>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className={mtInp}>{TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          </label>
          <label className="block"><span className={mtLbl}>Frequency</span>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} className={mtInp}>{FREQS.map((f) => <option key={f} value={f}>{f}</option>)}</select>
          </label>
          <label className="block"><span className={mtLbl}>Due date</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={mtInp} />
          </label>
          <label className="block"><span className={mtLbl}>Est. cost</span>
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className={`${mtInp} font-mono`} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="min-h-[44px] px-4 rounded-full border border-slate-200 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={!valid || addTask.isPending} className="min-h-[44px] px-5 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Schedule task</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Downtime Analytics */


/* ---------------------------------------------------------------- Machine History */


/* ---------------------------------------------------------------- Calibration Register */

