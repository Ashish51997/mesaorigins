/**
 * DispatchScreens.tsx — Dispatch Executive (PROMPT 07, light). Built so the gate
 * guard can run it. Home · Ready to Dispatch · Gate Pass (checklist) · Vehicles
 * Today · Dispatch History. Release is impossible until every row is green; held
 * pallets are refused at scan; release advances the Sales order + writes the
 * dispatch into the Batch Passport (via markDispatched + nudge). Gate pass prints.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Truck, ClipboardCheck, ScanLine, Printer, CheckCircle2, XCircle, AlertTriangle, Clock, ArrowRight
} from 'lucide-react';
import { isOnline } from '../../lib/simulation';
import { useOnline } from '../../lib/simulation';
import { pushToast, pushNudge } from '../Notify';
import { useCan } from '../../lib/accessStore';
import { EmptyState } from '../EmptyState';
import { TraceLink } from '../TraceLink';
import { ApiError } from '../../lib/apiClient';
import { useReadyOrders, useDispatches, useCreateDispatch, type ApiReadyOrder } from '../../lib/queries/dispatch';

export interface DispatchData { onOpen: (m: string) => void; onTrace: (q: string) => void; }

const VEHICLES = [
  { plate: 'KA-05-AB-1234', transporter: 'Om Sai Logistics', eta: '3:00 pm', ready: false, order: 'SO-2026-141' },
  { plate: 'KA-01-AB-4412', transporter: 'Sri Balaji Transport', eta: '5:30 pm', ready: true, order: 'SO-2026-143' }
];

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">{title}</div>{children}</div>;
}

/* ---------------------------------------------------------------- Home */


/* ---------------------------------------------------------------- Ready to Dispatch */

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong — please try again.');

// API-backed: orders whose production is complete (submitted logbook) and not yet
// shipped. Dispatching creates the record + invoice and flips the order.
export function ReadyToDispatch(p: DispatchData) {
  const readyQ = useReadyOrders();
  const [dispatching, setDispatching] = useState<ApiReadyOrder | null>(null);
  const ready = readyQ.data ?? [];
  return (
    <div className="space-y-3">
      {readyQ.isLoading ? (
        <div className="text-[12px] text-slate-400 py-6 text-center">Loading…</div>
      ) : ready.length === 0 ? (
        <EmptyState icon={<Truck className="w-8 h-8" />} title="Nothing ready to dispatch yet." hint="Orders whose production logbook is submitted appear here." />
      ) : ready.map((o) => (
        <div key={o.id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-bold"><TraceLink id={o.soNumber} onTrace={p.onTrace} className="font-bold" /> · {o.product}</div>
            <div className="text-[12px] text-slate-500">{o.customer.name} · {o.quantity} units · due {o.deliveryDate}</div>
          </div>
          <button onClick={() => setDispatching(o)} className="h-12 px-5 rounded-lg bg-indigo-600 text-white font-bold text-sm inline-flex items-center gap-1"><Truck className="w-4 h-4" /> Dispatch</button>
        </div>
      ))}
      {dispatching && <DispatchModal order={dispatching} onClose={() => setDispatching(null)} />}
    </div>
  );
}

function DispatchModal({ order, onClose }: { order: ApiReadyOrder; onClose: () => void }) {
  const create = useCreateDispatch();
  const canDispatch = useCan('action:dispatch.mark');
  const [vehicle, setVehicle] = useState('');
  const [transporter, setTransporter] = useState('');
  const [driver, setDriver] = useState('');
  const [eta, setEta] = useState('');
  const valid = vehicle.trim() !== '';

  const submit = () => {
    if (!valid || !canDispatch || create.isPending) return;
    create.mutate(
      { salesOrderId: order.id, vehicleNumber: vehicle.trim(), transporter: transporter.trim(), driverName: driver.trim(), etaDate: eta },
      {
        onSuccess: (d) => {
          pushNudge('good', `${order.soNumber} dispatched — invoice ${d.invoiceNumber}, vehicle ${vehicle}. Sales is updated.`);
          pushToast(`${order.soNumber} dispatched · ${d.invoiceNumber}.`);
          onClose();
        },
        onError: (e) => pushToast(errMsg(e)),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md my-10 bg-white rounded-xl shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between px-5 h-14 border-b border-slate-200">
          <span className="font-bold text-sm">Dispatch {order.soNumber}</span>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><XCircle className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-[12px] text-slate-500">{order.product} · {order.quantity} units · {order.customer.name}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Vehicle plate" value={vehicle} onChange={setVehicle} ph="KA-01-AB-1234" />
            <Field label="Transporter" value={transporter} onChange={setTransporter} ph="e.g. Blue Dart" />
            <Field label="Driver name" value={driver} onChange={setDriver} ph="Driver" />
            <Field label="ETA date" value={eta} onChange={setEta} ph="YYYY-MM-DD" />
          </div>
          <button onClick={submit} disabled={!valid || !canDispatch || create.isPending} title={canDispatch ? undefined : 'No access — ask your administrator'} className="w-full h-14 rounded-xl bg-indigo-600 text-white font-bold text-base hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1">
            <Truck className="w-5 h-5" /> {canDispatch ? 'Dispatch & raise invoice' : 'No access to dispatch'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Gate Pass (checklist) */


function Field({ label, value, onChange, ph }: { label: string; value: string; onChange: (v: string) => void; ph?: string }) {
  return (
    <label className="flex flex-col gap-1 flex-1">
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} className="h-11 px-3 rounded-lg border border-slate-300 text-sm" />
    </label>
  );
}
function Line({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between border-b border-dashed border-slate-300 py-1"><span className="text-slate-500">{k}</span><span className="font-mono text-slate-800">{v}</span></div>;
}

/* ---------------------------------------------------------------- Vehicles Today */


/* ---------------------------------------------------------------- Dispatch History */

export function DispatchHistory(p: DispatchData) {
  const dispQ = useDispatches();
  const done = dispQ.data ?? [];
  return (
    <Card title="Dispatch history">
      {dispQ.isLoading ? <div className="text-[12px] text-slate-400 py-6 text-center">Loading…</div> : done.length === 0 ? (
        <EmptyState icon={<Truck className="w-8 h-8" />} title="No dispatches yet." hint="Dispatched orders land here with their invoice." />
      ) : (
        <div className="space-y-2">
          {done.map((d) => (
            <button key={d.id} onClick={() => p.onTrace(d.invoiceNumber)} className="w-full flex flex-wrap items-center gap-3 text-left border border-slate-200 rounded-lg p-3 text-[13px]">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-bold">{d.salesOrder.soNumber}</span>
              <span className="font-mono text-[11px] text-slate-500">{d.invoiceNumber}</span>
              <span className="text-[12px] text-slate-500 truncate">{d.salesOrder.customer.name} · {d.vehicleNumber || 'no vehicle'}</span>
              <span className="ml-auto text-[11px] font-bold text-indigo-600 shrink-0">Trace</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
