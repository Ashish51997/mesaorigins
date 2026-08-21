/**
 * StoreScreens.tsx — Store Manager (PROMPT 05, light). Home · Receive Material ·
 * Issue Lot to Machine (scan-first, 2 taps; rejected/held lots refused with the
 * reason) · RM Stock Board (the identification board) · FG Put-away (tonnage
 * echoes the MD dashboard live) · Regrind Lots. Issuing reduces store stock,
 * which the Planner's Material Availability reads.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ScanLine, Boxes, PackagePlus, PackageCheck, AlertTriangle, CheckCircle2, XCircle, ArrowRight, Recycle, Search
} from 'lucide-react';
import { initialMachines } from '@mesaops/mockData';
import { pushToast } from '@shared/components/Notify';
import { useCan } from '@mesaops/lib/accessStore';
import { EmptyState } from '@shared/components/EmptyState';
import { TraceLink } from '../TraceLink';
import { ApiError } from '@shared/lib/apiClient';
import { useMachines } from '@mesaops/lib/queries/maintenance';
import { useStock, useReceive, useIssue } from '@mesaops/lib/queries/inventory';

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong — please try again.');
const invInp = 'w-full h-11 px-3 rounded-lg border border-slate-300 text-sm';
const invLbl = 'block text-[11px] font-bold text-slate-500 mb-1';

export interface StoreData { onOpen: (m: string) => void; onTrace: (q: string) => void; }

const MACHINES = initialMachines.map((m) => m.id);
function Card({ title, children }: { title: string; children: ReactNode }) {
  return <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">{title}</div>{children}</div>;
}

/* ---------------------------------------------------------------- Home */


/* ---------------------------------------------------------------- Issue Lot (scan-first) */

export function IssueLot(_p: StoreData) {
  const stockQ = useStock();
  const machinesQ = useMachines();
  const issueM = useIssue();
  const canIssue = useCan('action:lot.issue');
  const rm = stockQ.data?.rawMaterials ?? [];
  const machines = machinesQ.data ?? [];
  const [material, setMaterial] = useState('');
  const [qty, setQty] = useState('');
  const [machineId, setMachineId] = useState('');
  const selMaterial = material || rm[0]?.itemName || '';
  const mId = machineId || machines[0]?.id || '';
  const row = rm.find((r) => r.itemName === selMaterial);
  const onHand = row?.onHand ?? 0;
  const unit = row?.unit ?? 'kg';
  const valid = !!selMaterial && Number(qty) > 0 && !!mId && Number(qty) <= onHand;

  const submit = () => {
    if (!valid || !canIssue || issueM.isPending) return;
    issueM.mutate(
      { itemName: selMaterial, quantity: Number(qty), unit, machineId: mId },
      {
        onSuccess: () => { pushToast(`Issued ${qty} ${unit} of ${selMaterial} to ${machines.find((m) => m.id === mId)?.code ?? 'machine'}.`); setQty(''); },
        onError: (e) => pushToast(errMsg(e)),
      },
    );
  };

  return (
    <Card title="Issue raw material to a machine">
      {stockQ.isLoading ? (
        <div className="text-[12px] text-slate-400 py-6 text-center">Loading…</div>
      ) : rm.length === 0 ? (
        <EmptyState icon={<ScanLine className="w-8 h-8" />} title="No raw material in store." hint="Receive some material first, then issue it to a machine." />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block"><span className={invLbl}>Material</span>
              <select value={selMaterial} onChange={(e) => setMaterial(e.target.value)} className={invInp}>{rm.map((r) => <option key={r.itemName} value={r.itemName}>{r.itemName} ({r.onHand} {r.unit})</option>)}</select>
            </label>
            <label className="block"><span className={invLbl}>Machine</span>
              <select value={mId} onChange={(e) => setMachineId(e.target.value)} className={invInp}>{machines.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.line}</option>)}</select>
            </label>
            <label className="block"><span className={invLbl}>Quantity ({unit})</span>
              <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder={`Max ${onHand}`} className={`${invInp} font-mono`} />
            </label>
            <div className="flex items-end text-[12px] text-slate-500">On hand: <span className="font-mono font-bold ml-1">{onHand} {unit}</span></div>
          </div>
          {Number(qty) > onHand && <div className="text-[11px] font-bold text-amber-700 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Only {onHand} {unit} available.</div>}
          <button onClick={submit} disabled={!valid || !canIssue || issueM.isPending} title={canIssue ? undefined : 'No access — ask your administrator'} className="h-12 px-5 rounded-lg bg-indigo-600 text-white font-bold text-sm inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"><ScanLine className="w-4 h-4" /> {canIssue ? 'Issue to machine' : 'No access to issue'}</button>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- RM Stock Board */

export function RMStockBoard(_p: StoreData) {
  const stockQ = useStock();
  const [q, setQ] = useState('');
  const rm = stockQ.data?.rawMaterials ?? [];
  const fg = stockQ.data?.finishedGoods ?? [];
  const match = (name: string) => name.toLowerCase().includes(q.toLowerCase());
  const rmRows = rm.filter((r) => match(r.itemName));
  const fgRows = fg.filter((r) => match(r.itemName));

  const table = (rows: { itemName: string; unit: string; onHand: number }[], low: number) => (
    <table className="w-full text-[12px]">
      <thead><tr className="text-slate-400 text-[10px] uppercase"><th className="text-left py-1">Material</th><th className="text-right py-1">On hand</th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={`${r.itemName}-${r.unit}`}>
            <td className="py-2 text-slate-700">{r.itemName}</td>
            <td className={`py-2 text-right font-mono font-bold ${r.onHand < low ? 'text-amber-600' : 'text-slate-700'}`}>{r.onHand} {r.unit}{r.onHand < low ? ' · low' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-3">
      <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search material" className="w-full pl-8 h-10 rounded-lg border border-slate-300 text-sm" /></div>
      <Card title="Raw material — on hand (from the ledger)">
        {stockQ.isLoading ? <div className="text-[12px] text-slate-400 py-6 text-center">Loading…</div> : rmRows.length === 0 ? <EmptyState icon={<Boxes className="w-8 h-8" />} title="No raw material in store." hint="Receive material to build stock." /> : table(rmRows, 1000)}
      </Card>
      <Card title="Finished goods — on hand (QA passes in, dispatches out)">
        {stockQ.isLoading ? <div className="text-[12px] text-slate-400 py-6 text-center">Loading…</div> : fgRows.length === 0 ? <EmptyState icon={<PackageCheck className="w-8 h-8" />} title="No finished goods yet." hint="A QA pass books finished stock here." /> : table(fgRows, 0)}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- FG Put-away */


/* ---------------------------------------------------------------- Regrind Lots */


/* ---------------------------------------------------------------- Receive Material */

export function ReceiveMaterial(_p: StoreData) {
  const receive = useReceive();
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('kg');
  const [lot, setLot] = useState('');
  const [ref, setRef] = useState('');
  const valid = name.trim() !== '' && Number(qty) > 0;

  const submit = () => {
    if (!valid || receive.isPending) return;
    receive.mutate(
      { itemName: name.trim(), quantity: Number(qty), unit, lotNumber: lot.trim() || undefined, reference: ref.trim() },
      {
        onSuccess: () => { pushToast(`Received ${qty} ${unit} of ${name.trim()} into store.`); setName(''); setQty(''); setLot(''); setRef(''); },
        onError: (e) => pushToast(errMsg(e)),
      },
    );
  };

  return (
    <Card title="Receive raw material into store">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2"><span className={invLbl}>Material</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. RPVC resin" className={invInp} />
        </label>
        <label className="block"><span className={invLbl}>Quantity</span>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="1000" className={`${invInp} font-mono`} />
        </label>
        <label className="block"><span className={invLbl}>Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={invInp}><option value="kg">kg</option><option value="tonnes">tonnes</option><option value="units">units</option></select>
        </label>
        <label className="block"><span className={invLbl}>Supplier lot (optional)</span>
          <input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="Supplier batch no." className={invInp} />
        </label>
        <label className="block"><span className={invLbl}>Reference (supplier / PO)</span>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. PO-2026-4402" className={invInp} />
        </label>
      </div>
      <button onClick={submit} disabled={!valid || receive.isPending} className="mt-3 h-12 px-5 rounded-lg bg-indigo-600 text-white font-bold text-sm inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"><PackagePlus className="w-4 h-4" /> Receive into store</button>
    </Card>
  );
}
