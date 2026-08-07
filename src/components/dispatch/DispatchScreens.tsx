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
import { DataTable } from '../DataTable';
import ResponsiveOverlay from '../ui/ResponsiveOverlay';
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
      <DataTable
        title="Ready to dispatch"
        loading={readyQ.isLoading}
        rows={ready}
        rowKey={(o) => o.id}
        empty={<EmptyState icon={<Truck className="w-8 h-8" />} title="Nothing ready to dispatch yet." hint="Orders whose production logbook is submitted appear here." />}
        columns={[
          { key: 'so', header: 'SO', cell: (o) => <TraceLink id={o.soNumber} onTrace={p.onTrace} className="font-bold font-mono" /> },
          { key: 'product', header: 'Product', cell: (o) => <span className="font-semibold">{o.product}</span> },
          { key: 'customer', header: 'Customer', cell: (o) => o.customer.name },
          { key: 'qty', header: 'Qty', align: 'right', className: 'font-mono', cell: (o) => o.quantity.toLocaleString('en-IN') },
          { key: 'due', header: 'Due', className: 'whitespace-nowrap', cell: (o) => o.deliveryDate },
          { key: 'act', header: '', align: 'right', cell: (o) => (
            <button onClick={() => setDispatching(o)} className="h-9 px-4 rounded-lg bg-indigo-600 text-white font-bold text-xs inline-flex items-center gap-1 hover:bg-indigo-500"><Truck className="w-3.5 h-3.5" /> Dispatch</button>
          ) },
        ]}
      />
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
    <ResponsiveOverlay open onClose={onClose} title={`Dispatch ${order.soNumber}`}>
      <div className="space-y-4">
          <div className="text-[12px] text-slate-500">{order.product} · {order.quantity} units · {order.customer.name}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Vehicle plate" value={vehicle} onChange={setVehicle} ph="KA-01-AB-1234" />
            <Field label="Transporter" value={transporter} onChange={setTransporter} ph="e.g. Blue Dart" />
            <Field label="Driver name" value={driver} onChange={setDriver} ph="Driver" />
            <Field label="ETA date" value={eta} onChange={setEta} ph="YYYY-MM-DD" />
          </div>
          <button onClick={submit} disabled={!valid || !canDispatch || create.isPending} title={canDispatch ? undefined : 'No access — ask your administrator'} className="w-full h-14 rounded-lg bg-indigo-600 text-white font-bold text-base hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1">
            <Truck className="w-5 h-5" /> {canDispatch ? 'Dispatch & raise invoice' : 'No access to dispatch'}
          </button>
      </div>
    </ResponsiveOverlay>
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
    <DataTable
      title="Dispatch history"
      loading={dispQ.isLoading}
      rows={done}
      rowKey={(d) => d.id}
      empty={<EmptyState icon={<Truck className="w-8 h-8" />} title="No dispatches yet." hint="Dispatched orders land here with their invoice." />}
      onRowClick={(d) => p.onTrace(d.invoiceNumber)}
      columns={[
        { key: 'ok', header: '', className: 'w-8', cell: () => <CheckCircle2 className="w-4 h-4 text-emerald-600" /> },
        { key: 'so', header: 'SO', cell: (d) => <span className="font-bold font-mono">{d.salesOrder.soNumber}</span> },
        { key: 'inv', header: 'Invoice', cell: (d) => <span className="font-mono text-[12px] text-slate-500">{d.invoiceNumber}</span> },
        { key: 'customer', header: 'Customer', cell: (d) => d.salesOrder.customer.name },
        { key: 'vehicle', header: 'Vehicle', cell: (d) => d.vehicleNumber || '—' },
        { key: 'trace', header: '', align: 'right', cell: () => <span className="text-[11px] font-bold text-indigo-600">Trace</span> },
      ]}
    />
  );
}
