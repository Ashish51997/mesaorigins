/**
 * QualityScreens.tsx — Quality Inspector (PROMPT 04, light). Home · Incoming
 * Inspection (QR/QC/025) · Roll Inspection Queue (PASS/HOLD/FAIL, override needs
 * a reason) · Holds · Disposal & Regrind · Calibration Due. Verdicts flow through
 * flowStore so a pass reaches the Store's put-away list and a hold blocks a pallet.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ClipboardCheck, PackageCheck, Boxes, AlertTriangle, CheckCircle2, XCircle, PauseCircle,
  ArrowRight, X, Thermometer, Recycle
} from 'lucide-react';
import { pushToast } from '../Notify';
import { useCan } from '../../lib/accessStore';
import { EmptyState } from '../EmptyState';
import { TraceLink } from '../TraceLink';
import { DataTable } from '../DataTable';
import { ApiError } from '../../lib/apiClient';
import { useQualityQueue, useQualityInspections, useCreateInspection, type ApiQueueItem } from '../../lib/queries/quality';

export interface QualityData { onOpen: (m: string) => void; onTrace: (q: string) => void; }

const mins = (since: number) => Math.round((Date.now() - since) / 60000);
const waited = (since: number) => { const m = mins(since); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m`; };
const oorCell = (o: { value: string; lo?: number; hi?: number }) => { if (o.lo === undefined || o.hi === undefined) return false; const n = parseFloat(o.value); return !Number.isNaN(n) && (n < o.lo || n > o.hi); };

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">{title}</div>{children}</div>;
}

const CALIBRATION = [
  { id: 'DT-02', name: 'Digital thermometer DT-02', dueInDays: 5 },
  { id: 'WS-01', name: 'Weighing scale WS-01', dueInDays: 22 },
  { id: 'DVC-03', name: 'Digital vernier caliper DVC-03', dueInDays: 60 }
];

/* ---------------------------------------------------------------- Home */


/* ---------------------------------------------------------------- Roll inspection queue + detail */

export function RollInspectionQueue(p: QualityData) {
  const queueQ = useQualityQueue();
  const [sel, setSel] = useState<ApiQueueItem | null>(null);
  const queue = queueQ.data ?? [];
  return (
    <div className="space-y-3">
      <DataTable
        title="Roll inspection queue"
        loading={queueQ.isLoading}
        rows={queue}
        rowKey={(r) => r.lotNumber}
        empty={<EmptyState icon={<ClipboardCheck className="w-8 h-8" />} title="No rolls waiting — packed rolls from submitted logbooks appear here." />}
        onRowClick={(r) => setSel(r)}
        columns={[
          { key: 'lot', header: 'Lot', cell: (r) => <TraceLink id={r.lotNumber} onTrace={p.onTrace} className="font-mono text-[13px] font-bold" /> },
          { key: 'machine', header: 'Machine', cell: (r) => r.machineId },
          { key: 'product', header: 'Product', cell: (r) => r.product || '—' },
          { key: 'colour', header: 'Colour', cell: (r) => r.colour || '—' },
          { key: 'date', header: 'Date', className: 'whitespace-nowrap', cell: (r) => r.date },
          { key: 'act', header: '', align: 'right', cell: () => <span className="h-8 px-3 rounded-lg bg-indigo-600 text-white text-xs font-bold inline-flex items-center">Inspect</span> },
        ]}
      />
      {sel && <RollInspectionModal item={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function RollInspectionModal({ item, onClose }: { item: ApiQueueItem; onClose: () => void }) {
  const create = useCreateInspection();
  const canPass = useCan('action:qa.pass');
  const canHold = useCan('action:qa.hold');
  const [weight, setWeight] = useState('7.8');
  const [remarks, setRemarks] = useState('');
  const [failReason, setFailReason] = useState('');
  const FAIL_REASONS = ['Finishing', 'Weight', 'Profile/Length', 'Cutting', 'Line mark', 'Coil weight', 'Bubble', 'Roughness'];

  const decide = (decision: 'pass' | 'hold' | 'fail') => {
    if (create.isPending) return;
    create.mutate(
      { lotNumber: item.lotNumber, decision, weight: Number(weight) || 0, remarks: decision === 'fail' ? failReason : remarks },
      {
        onSuccess: () => {
          pushToast(decision === 'pass' ? `Lot ${item.lotNumber} passed — booked to finished-goods stock.` : `Lot ${item.lotNumber} ${decision === 'hold' ? 'placed on hold' : 'failed'}.`);
          onClose();
        },
        onError: (e) => pushToast(e instanceof ApiError ? e.message : 'Could not record the decision.'),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md my-10 bg-white rounded-xl shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between px-5 h-14 border-b border-slate-200">
          <span className="font-bold text-sm font-mono">{item.lotNumber}</span>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-[12px] text-slate-500">Machine {item.machineId} · {item.product || '—'}{item.colour ? ` · ${item.colour}` : ''}{item.code ? ` · ${item.code}` : ''}</div>
          <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-500">Roll weight
            <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className="w-24 h-10 px-3 rounded-lg border border-slate-300 font-mono text-sm" /><span className="text-xs text-slate-400">kg</span>
          </label>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks (optional; reason for a hold)" className="w-full h-11 px-3 rounded-lg border border-slate-300 text-sm" />
          <div className="flex flex-wrap gap-1.5">{FAIL_REASONS.map((r) => <button key={r} onClick={() => setFailReason(r)} className={`px-2.5 h-8 rounded-lg text-[11px] font-bold border ${failReason === r ? 'border-rose-500 bg-rose-100 text-rose-800' : 'border-slate-200 text-slate-500'}`}>{r}</button>)}</div>
          <div className="grid grid-cols-3 gap-2">
            <button disabled={!canPass || create.isPending} title={canPass ? undefined : 'No access — ask your administrator'} onClick={() => decide('pass')} className={`h-14 rounded-xl bg-emerald-600 text-white font-bold inline-flex items-center justify-center gap-1 ${canPass && !create.isPending ? '' : 'opacity-50 cursor-not-allowed'}`}><CheckCircle2 className="w-5 h-5" /> PASS</button>
            <button disabled={!canHold || create.isPending} title={canHold ? undefined : 'No access — ask your administrator'} onClick={() => decide('hold')} className={`h-14 rounded-xl bg-amber-500 text-white font-bold inline-flex items-center justify-center gap-1 ${canHold && !create.isPending ? '' : 'opacity-50 cursor-not-allowed'}`}><PauseCircle className="w-5 h-5" /> HOLD</button>
            <button disabled={create.isPending} onClick={() => decide('fail')} className="h-14 rounded-xl bg-rose-600 text-white font-bold inline-flex items-center justify-center gap-1 disabled:opacity-50"><XCircle className="w-5 h-5" /> FAIL</button>
          </div>
          <div className="text-[11px] text-slate-400">A PASS books this roll to finished-goods stock.</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Incoming inspection (QR/QC/025) */


/* ---------------------------------------------------------------- Holds */

export function Holds(p: QualityData) {
  const inspQ = useQualityInspections();
  const held = (inspQ.data ?? []).filter((i) => i.decision === 'hold');
  return (
    <DataTable
      title="Quality holds"
      loading={inspQ.isLoading}
      rows={held}
      rowKey={(i) => i.id}
      empty={<EmptyState icon={<PauseCircle className="w-8 h-8" />} title="Nothing on hold. Good." hint="Rolls you place on hold appear here with their reason." />}
      columns={[
        { key: 'lot', header: 'Lot', cell: (i) => <span className="font-bold font-mono text-[13px]">{i.lotNumber}</span> },
        { key: 'remarks', header: 'Reason', cell: (i) => <span className="text-amber-700">{i.remarks || 'On hold'}</span> },
        { key: 'by', header: 'Inspected by', cell: (i) => i.inspectedBy },
        { key: 'act', header: '', align: 'right', cell: (i) => (
          <button onClick={() => p.onTrace(i.lotNumber)} className="text-[12px] font-bold text-indigo-600">Trace</button>
        ) },
      ]}
    />
  );
}

/* ---------------------------------------------------------------- Disposal & Regrind */


/* ---------------------------------------------------------------- Calibration Due */

