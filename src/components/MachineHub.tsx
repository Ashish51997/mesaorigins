/**
 * MachineHub — post-QR operator screen: machine status, related logbooks,
 * maintenance history, and a bottom-sheet log entry when the line is active.
 */
import { useState } from 'react';
import {
  ArrowLeft, Gauge, Wrench, FileSpreadsheet, PlayCircle, AlertTriangle, Lock,
} from 'lucide-react';
import { ApiError } from '../lib/apiClient';
import { useMachineHub } from '../lib/queries/logbook';
import BottomSheet from './ui/BottomSheet';
import PageHeader from './ui/PageHeader';
import { StatusBadge, type StatusTone } from './ui/StatusBadge';
import LogbookModule from './LogbookModule';

const STUB = {
  templates: [] as never[],
  setTemplates: () => {},
  machineLogbooks: [] as never[],
  setMachineLogbooks: () => {},
  productionPlans: [] as never[],
  salesOrders: [] as never[],
};

function statusTone(status: string): StatusTone {
  if (status === 'running' || status === 'submitted' || status === 'completed') return 'success';
  if (status === 'down' || status === 'overdue' || status === 'stopped') return 'error';
  if (status === 'draft' || status === 'scheduled' || status === 'attention') return 'warn';
  return 'neutral';
}

export default function MachineHub({
  machineCode,
  onBack,
}: {
  machineCode: string;
  onBack: () => void;
}) {
  const code = machineCode.trim().toUpperCase();
  const q = useMachineHub(code);
  const [logPlanId, setLogPlanId] = useState<string | null>(null);

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4" data-testid="machine-hub-loading">
        <PageHeader title={code} subtitle="Loading…" onBack={onBack} />
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <Gauge className="mx-auto h-10 w-10 text-indigo-500 animate-pulse" />
          <h3 className="mt-3 text-lg font-bold text-slate-900 dark:text-white">Loading {code}…</h3>
        </div>
      </div>
    );
  }

  if (q.isError || !q.data) {
    const err = q.error;
    const status = err instanceof ApiError ? err.status : 0;
    return (
      <div className="mx-auto max-w-2xl space-y-4" data-testid="machine-hub-error">
        <PageHeader title={code} onBack={onBack} />
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            {status === 404 ? `Machine ${code} not found` : status === 403 ? 'No access' : 'Could not open machine'}
          </h3>
          <p className="text-sm text-slate-500">
            {err instanceof ApiError ? err.message : 'Something went wrong.'}
          </p>
          <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        </div>
      </div>
    );
  }

  const { machine, started, activePlan, logbooks, maintenance } = q.data;
  const canLog = !!activePlan && activePlan.logbook?.status !== 'submitted';
  const logLabel = activePlan?.logbook?.status === 'draft' ? 'Continue log entry' : 'Start log entry';
  const hubSubtitle = [machine.line, machine.family, machine.logbookFormat].filter(Boolean).join(' · ') || 'Plant line';

  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="machine-hub">
      <PageHeader
        title={machine.code}
        subtitle={hubSubtitle}
        onBack={onBack}
        actions={
          <StatusBadge tone={statusTone(machine.status)} className="uppercase">
            {machine.status}
          </StatusBadge>
        }
      />

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Machine</div>
            <h2 className="font-sans text-2xl font-bold text-slate-900 dark:text-white">{machine.code}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {hubSubtitle}
            </p>
          </div>
          <StatusBadge tone={statusTone(machine.status)} className="uppercase">
            {machine.status}
          </StatusBadge>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <div className="text-[10px] font-bold uppercase text-slate-400">Product</div>
            <div className="mt-0.5 text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {machine.currentProduct || activePlan?.salesOrder?.product || '—'}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <div className="text-[10px] font-bold uppercase text-slate-400">Formula</div>
            <div className="mt-0.5 text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {machine.currentFormula || '—'}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <div className="text-[10px] font-bold uppercase text-slate-400">Lot</div>
            <div className="mt-0.5 text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {machine.currentLot || '—'}
            </div>
          </div>
        </div>
        {machine.statusReason && (
          <p className="mt-3 text-[12px] text-amber-700">{machine.statusReason}</p>
        )}
      </div>

      {activePlan && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
          <div className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Active plan</div>
          <div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
            {activePlan.salesOrder?.soNumber ?? 'No order'} · {activePlan.shift === 'D' ? 'Day' : 'Night'}
          </div>
          <p className="text-[12px] text-slate-600 dark:text-slate-400">
            {activePlan.salesOrder?.product ?? '—'} · {(activePlan.scheduledStartDate || '').slice(0, 10)}
            {activePlan.operatorName ? ` · ${activePlan.operatorName}` : ''}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${statusTone(activePlan.status)}`}>
              {activePlan.status}
            </span>
            <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${statusTone(activePlan.logbook?.status ?? 'ready')}`}>
              Log: {activePlan.logbook?.status ?? 'not started'}
            </span>
          </div>
        </div>
      )}

      {(started || canLog) && canLog && (
        <button
          type="button"
          onClick={() => setLogPlanId(activePlan!.id)}
          className="inline-flex w-full min-h-12 items-center justify-center gap-2 rounded-lg bg-indigo-600 text-[15px] font-medium text-white hover:bg-indigo-500"
          data-testid="machine-hub-log-cta"
        >
          <PlayCircle className="h-5 w-5" />
          {logLabel}
        </button>
      )}

      {!activePlan && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          No scheduled or running plan on this machine right now. Log entry opens when Planning assigns a shift.
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-slate-400" />
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Logbooks on this machine</h3>
        </div>
        {logbooks.length === 0 ? (
          <p className="text-sm text-slate-500">No logbooks recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {logbooks.map((lb) => (
              <li key={lb.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                    {lb.soNumber ?? '—'} · {lb.productName || '—'}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {lb.date || '—'} · {lb.shift === 'D' ? 'Day' : lb.shift === 'N' ? 'Night' : lb.shift} · {lb.totalRollKgs || '0'} kg
                  </div>
                </div>
                <StatusBadge tone={statusTone(lb.status)}>
                  {lb.status === 'submitted' ? <><Lock className="h-3 w-3" /> Submitted</> : lb.status}
                </StatusBadge>
                {lb.status !== 'submitted' && lb.productionPlanId && (
                  <button
                    type="button"
                    onClick={() => setLogPlanId(lb.productionPlanId)}
                    className="shrink-0 min-h-11 px-3 rounded-lg bg-indigo-600 text-white text-xs font-medium"
                  >
                    Open
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center gap-2">
          <Wrench className="h-4 w-4 text-slate-400" />
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Maintenance history</h3>
        </div>
        {maintenance.length === 0 ? (
          <p className="text-sm text-slate-500">No maintenance tasks on file for this machine.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {maintenance.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{t.taskName}</div>
                  <div className="text-[11px] text-slate-500">
                    {t.type} · {t.frequency} · due {t.dueDate || '—'}
                  </div>
                </div>
                <StatusBadge tone={statusTone(t.status)}>{t.status}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BottomSheet
        open={!!logPlanId}
        onClose={() => { setLogPlanId(null); void q.refetch(); }}
        title={`${machine.code} · Log entry`}
        wide
        className="max-h-[95vh]"
      >
        {logPlanId && (
          <div className="-mx-1 pb-2" data-testid="machine-hub-log-sheet">
            <LogbookModule
              {...STUB}
              initialTab="operator"
              initialPlanId={logPlanId}
              presentation="sheet"
              mobileLayout="accordion"
            />
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
