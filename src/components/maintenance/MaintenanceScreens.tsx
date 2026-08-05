/**
 * MaintenanceScreens.tsx — Maintenance Head (PROMPT 08, light). Home ·
 * Machines · Preventive Schedule. Machine registry and schedule are API-backed.
 */

import { useEffect, useState } from 'react';
import {
  CalendarClock, CheckCircle2, Cpu, Plus, QrCode, Download, Copy, Eye
} from 'lucide-react';
import { EmptyState } from '../EmptyState';
import { DataTable } from '../DataTable';
import ResponsiveOverlay from '../ui/ResponsiveOverlay';
import { pushToast } from '../Notify';
import { ApiError } from '../../lib/apiClient';
import { useMachines, useCreateMachine, useMaintenanceTasks, useAddMaintenance, useCompleteMaintenance, type ApiMachine } from '../../lib/queries/maintenance';
import { downloadMachineQr, machineQrUrl, renderMachineQrPng } from '../../lib/machineQr';

export interface MaintData { onOpen: (m: string) => void; onTrace: (q: string) => void; user: string; }

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong — please try again.');
const typeChip = (t: string) => <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">{t}</span>;
const mtLbl = 'block text-[11px] font-bold text-slate-500 mb-1';
const mtInp = 'w-full h-11 px-3 rounded-lg border border-slate-300 text-sm bg-white text-slate-700';

const STATUS = { running: { dot: 'bg-emerald-500', word: 'Running' }, attention: { dot: 'bg-amber-500', word: 'Needs a look' }, stopped: { dot: 'bg-rose-500', word: 'Stopped' } } as const;
type MachineStatus = keyof typeof STATUS;

const FAMILIES = ['LDPE', 'PVC', 'SPVC', 'Other'] as const;
const TASK_TYPES = ['Preventive', 'Calibration', 'Overhaul', 'Breakdown'] as const;
const FREQS = ['Weekly', 'Monthly', 'Quarterly', 'Semiannually', 'Once (Breakdown)'] as const;

/* ---------------------------------------------------------------- Machine QR modal */

function MachineQrPanel({ machine, onDone }: { machine: Pick<ApiMachine, 'code' | 'line'>; onDone?: () => void }) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const link = machineQrUrl(machine.code);

  useEffect(() => {
    let cancelled = false;
    setDataUrl('');
    renderMachineQrPng(machine.code, 320).then((url) => {
      if (!cancelled) setDataUrl(url);
    }).catch(() => {
      if (!cancelled) pushToast('Could not render QR code.');
    });
    return () => { cancelled = true; };
  }, [machine.code]);

  const onDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await downloadMachineQr(machine.code);
      pushToast(`Downloaded Machine-${machine.code}-QR.png`);
    } catch {
      pushToast('Download failed.');
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      pushToast('Link copied.');
    } catch {
      pushToast('Could not copy link.');
    }
  };

  return (
    <div className="space-y-4" data-testid="machine-qr-panel">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5">
        {dataUrl ? (
          <img src={dataUrl} alt={`QR for machine ${machine.code}`} className="h-56 w-56 rounded-xl bg-white p-2 shadow-sm" />
        ) : (
          <div className="flex h-56 w-56 items-center justify-center rounded-xl bg-white text-sm text-slate-400">Generating…</div>
        )}
        <div className="text-center">
          <div className="font-mono text-xl font-bold text-slate-900">{machine.code}</div>
          {machine.line ? <p className="mt-0.5 text-[13px] text-slate-500">{machine.line}</p> : null}
          <p className="mt-2 max-w-xs text-[12px] text-slate-400">Print and paste on the machine. Authorized users who scan open the active shift log.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          <Download className="h-4 w-4" /> Download QR
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          <Copy className="h-4 w-4" /> Copy link
        </button>
      </div>
      {onDone && (
        <button type="button" onClick={onDone} className="w-full min-h-[44px] rounded-full border border-slate-200 text-sm font-bold text-slate-600">
          Done
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Machines registry */

export function MachinesBoard(_p: MaintData) {
  const machinesQ = useMachines();
  const [showAdd, setShowAdd] = useState(false);
  const [viewQr, setViewQr] = useState<ApiMachine | null>(null);
  const machines = machinesQ.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">Plant machines</h2>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold shadow-sm cursor-pointer shrink-0">
          <Plus className="w-4 h-4" /> Add machine
        </button>
      </div>
      <DataTable
        title={`${machines.length} machine(s)`}
        loading={machinesQ.isLoading}
        rows={machines}
        rowKey={(m) => m.id}
        empty={<EmptyState icon={<Cpu className="w-8 h-8" />} title="No machines registered yet." hint="Add a machine to use it on the schedule, plans, and issue screens." />}
        columns={[
          { key: 'code', header: 'Code', cell: (m) => <span className="font-bold inline-flex items-center gap-1"><Cpu className="w-3.5 h-3.5 text-slate-400" /> {m.code}</span> },
          { key: 'line', header: 'Line', cell: (m) => m.line || '—' },
          { key: 'family', header: 'Family', cell: (m) => <span className="text-[12px] font-bold text-slate-600">{m.family || '—'}</span> },
          { key: 'format', header: 'Logbook', cell: (m) => <span className="text-[12px] font-mono text-slate-500">{m.logbookFormat || '—'}</span> },
          { key: 'status', header: 'Status', cell: (m) => {
            const s = STATUS[(m.status as MachineStatus)] ?? STATUS.running;
            return <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-700"><span className={`w-2 h-2 rounded-full ${s.dot}`} />{s.word}</span>;
          } },
          { key: 'qr', header: 'QR', align: 'right', cell: (m) => (
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setViewQr(m)}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] font-bold text-slate-700 hover:bg-slate-50"
                title="View QR"
              >
                <Eye className="h-3.5 w-3.5" /> View
              </button>
              <button
                type="button"
                onClick={() => {
                  downloadMachineQr(m.code)
                    .then(() => pushToast(`Downloaded Machine-${m.code}-QR.png`))
                    .catch(() => pushToast('Download failed.'));
                }}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] font-bold text-slate-700 hover:bg-slate-50"
                title="Download QR"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </button>
            </div>
          ) },
        ]}
      />
      {showAdd && (
        <AddMachineModal
          onClose={() => setShowAdd(false)}
          onCreated={(m) => {
            setShowAdd(false);
            setViewQr(m);
          }}
        />
      )}
      {viewQr && (
        <ResponsiveOverlay open onClose={() => setViewQr(null)} title={`QR · ${viewQr.code}`} wide>
          <MachineQrPanel machine={viewQr} onDone={() => setViewQr(null)} />
        </ResponsiveOverlay>
      )}
    </div>
  );
}

function AddMachineModal({ onClose, onCreated }: { onClose: () => void; onCreated: (m: ApiMachine) => void }) {
  const create = useCreateMachine();
  const [code, setCode] = useState('');
  const [line, setLine] = useState('');
  const [family, setFamily] = useState<(typeof FAMILIES)[number]>('PVC');
  const [status, setStatus] = useState<MachineStatus>('running');
  const valid = code.trim() !== '' && line.trim() !== '';

  const submit = () => {
    if (!valid || create.isPending) return;
    create.mutate(
      { code: code.trim(), line: line.trim(), family, status },
      {
        onSuccess: (m) => {
          pushToast(`Machine ${m.code} registered — print its QR for the floor.`);
          onCreated(m);
        },
        onError: (e) => pushToast(errMsg(e)),
      },
    );
  };

  return (
    <ResponsiveOverlay open onClose={onClose} title="Add a machine">
      <div className="space-y-4">
        <label className="block"><span className={mtLbl}>Code</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. M10" className={`${mtInp} font-mono`} maxLength={16} />
        </label>
        <label className="block"><span className={mtLbl}>Line / description</span>
          <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="e.g. PVC / SPVC beading" className={mtInp} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={mtLbl}>Family</span>
            <select value={family} onChange={(e) => setFamily(e.target.value as typeof family)} className={mtInp}>{FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}</select>
          </label>
          <label className="block"><span className={mtLbl}>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as MachineStatus)} className={mtInp}>
              {(Object.keys(STATUS) as MachineStatus[]).map((k) => <option key={k} value={k}>{STATUS[k].word}</option>)}
            </select>
          </label>
        </div>
        <p className="inline-flex items-start gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-[12px] text-indigo-800">
          <QrCode className="mt-0.5 h-4 w-4 shrink-0" />
          After saving you can view and download a QR sticker for this machine.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="min-h-[44px] px-4 rounded-full border border-slate-200 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={!valid || create.isPending} className="min-h-[44px] px-5 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add machine</button>
        </div>
      </div>
    </ResponsiveOverlay>
  );
}

/* ---------------------------------------------------------------- Preventive Schedule */

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
      <DataTable
        title={`${pending.length} open task(s)`}
        loading={tasksQ.isLoading}
        rows={pending}
        rowKey={(t) => t.id}
        empty={<EmptyState icon={<CalendarClock className="w-8 h-8" />} title="No open maintenance tasks." hint="Add a machine maintenance task to schedule it." />}
        columns={[
          { key: 'machine', header: 'Machine', cell: (t) => <span className="font-bold inline-flex items-center gap-1"><Cpu className="w-3.5 h-3.5 text-slate-400" /> {t.machine.code}</span> },
          { key: 'task', header: 'Task', cell: (t) => t.taskName },
          { key: 'type', header: 'Type', cell: (t) => typeChip(t.type) },
          { key: 'freq', header: 'Frequency', cell: (t) => <span className="text-[12px] text-slate-500">{t.frequency}</span> },
          { key: 'due', header: 'Due', cell: (t) => {
            const overdue = t.status === 'overdue' || (t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10));
            return <span className={`text-[12px] font-bold ${overdue ? 'text-rose-700' : 'text-slate-500'}`}>{overdue ? 'overdue' : 'due'} {t.dueDate}</span>;
          } },
          { key: 'act', header: '', align: 'right', cell: (t) => (
            <button disabled={complete.isPending} onClick={() => complete.mutate(t.id, { onSuccess: () => pushToast(`${t.machine.code} · ${t.taskName} marked done.`), onError: (e) => pushToast(errMsg(e)) })} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Done</button>
          ) },
        ]}
      />
      {showAdd && <AddMaintenanceModal machines={machines} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

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
    <ResponsiveOverlay open onClose={onClose} title="Add a maintenance task">
      <div className="space-y-4">
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
    </ResponsiveOverlay>
  );
}
