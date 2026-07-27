/**
 * SalesScreens.tsx — Sales Executive. Home · Inquiries · Quotations · Orders ·
 * Customers · Complaints.
 *
 * Inquiries/Quotations/Orders/Customers/Complaints are backed by the real API
 * (Postgres, tenant-scoped) via TanStack Query hooks (src/lib/queries/*). A
 * complaint links to a dispatched batch and auto-opens a CAPA that must be
 * worked and closed before the complaint can be resolved. Home stays on the
 * legacy lifted-state path until its phase.
 */

import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  Inbox, FileText, ClipboardList, Users, MessageSquareWarning, Camera, ArrowRight, Send, CheckCircle2, Plus, X, Paperclip
} from 'lucide-react';
import { Inquiry, SalesOrder, CustomerComplaint, Customer } from '../../types';
import { pushToast, pushNudge } from '../Notify';
import { useCan } from '../../lib/accessStore';
import { EmptyState } from '../EmptyState';
import { TraceLink } from '../TraceLink';
import { ApiError } from '../../lib/apiClient';
import {
  useCustomers, useCreateCustomer, useInquiries, useCreateInquiry, useQuoteInquiry,
  useOrders, useConfirmOrder, useCancelOrder, type ApiCustomer, type ApiInquiry, type ApiOrder,
} from '../../lib/queries/sales';
import {
  useComplaintBatches, useComplaints, useLogComplaint, useResolveComplaint,
  useUpdateCapa, useCloseCapa, type ApiComplaint,
} from '../../lib/queries/capa';

type Dispatch<T> = (v: T | ((p: T) => T)) => void;
export interface SalesData {
  inquiries: Inquiry[]; setInquiries: Dispatch<Inquiry[]>;
  salesOrders: SalesOrder[]; setSalesOrders: Dispatch<SalesOrder[]>;
  complaints: CustomerComplaint[]; setComplaints: Dispatch<CustomerComplaint[]>;
  customers: Customer[]; setCustomers: Dispatch<Customer[]>;
  onOpen: (m: string) => void; onTrace: (q: string) => void;
}

const nameOf = (customers: ApiCustomer[], id: string) => customers.find((c) => c.id === id)?.name ?? id;
const now = () => new Date().toISOString().split('T')[0];
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong — please try again.');

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">{title}</div>{children}</div>;
}
const chip = (pr: string) => <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${pr === 'high' ? 'bg-rose-100 text-rose-800' : pr === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{pr === 'high' ? 'High priority' : pr === 'medium' ? 'Medium' : 'Low'}</span>;
const Loading = () => <div className="text-[12px] text-slate-400 px-1 py-6 text-center">Loading…</div>;

const orderSentence = (s: string): string => ({
  pending: 'Order confirmed — waiting for planning',
  planned: 'Planned — waiting for the operator to start',
  in_production: 'In production on the line',
  inspected: 'Passed quality — moving to packing',
  packed: 'Packed — ready in warehouse',
  dispatched: 'Dispatched to the customer'
} as Record<string, string>)[s] ?? s;

/* ---------------------------------------------------------------- Home (legacy) */


/* ---------------------------------------------------------------- Inquiries */

const inqLbl = 'block text-[11px] font-bold text-slate-500 mb-1';
const inqInp = 'w-full h-11 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200';
const req = <span className="text-rose-500"> *</span>;

export function Inquiries(p: SalesData) {
  const customersQ = useCustomers();
  const inquiriesQ = useInquiries();
  const createInquiry = useCreateInquiry();
  const customers = customersQ.data ?? [];
  const inquiries = inquiriesQ.data ?? [];

  const [cust, setCust] = useState('');
  const [product, setProduct] = useState('');
  const [drawingRef, setDrawingRef] = useState('');
  const [qty, setQty] = useState('5000');
  const [deliver, setDeliver] = useState(now());
  const [remarks, setRemarks] = useState('');
  const [attachment, setAttachment] = useState('');
  const customerId = cust || customers[0]?.id || '';
  const valid = !!customerId && product.trim() !== '' && Number(qty) > 0 && deliver !== '';

  const log = () => {
    if (!valid || createInquiry.isPending) return;
    createInquiry.mutate(
      { customerId, product: product.trim(), drawingRef: drawingRef.trim(), quantity: Number(qty), expectedDeliveryDate: deliver, remarks: remarks.trim(), attachment: attachment || undefined },
      {
        onSuccess: (inq) => {
          setProduct(''); setDrawingRef(''); setRemarks(''); setAttachment(''); setQty('5000'); setDeliver(now());
          pushToast(`Inquiry ${inq.inquiryNumber} logged for ${nameOf(customers, customerId)}.`);
        },
        onError: (e) => pushToast(errMsg(e)),
      },
    );
  };

  return (
    <div className="space-y-3">
      <Card title="Log a new inquiry">
        {customers.length === 0 && <div className="mb-3 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Add a customer first (Customers tab) — an enquiry needs a customer.</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block"><span className={inqLbl}>Customer{req}</span>
            <select value={customerId} onChange={(e) => setCust(e.target.value)} className={inqInp}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <label className="block"><span className={inqLbl}>Product{req}</span>
            <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. RPVC pipe 20mm" className={inqInp} />
          </label>
          <label className="block"><span className={inqLbl}>Quantity (units){req}</span>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" placeholder="5000" className={`${inqInp} font-mono`} />
          </label>
          <label className="block"><span className={inqLbl}>Expected delivery{req}</span>
            <input type="date" value={deliver} onChange={(e) => setDeliver(e.target.value)} className={inqInp} />
          </label>
          <label className="block"><span className={inqLbl}>Drawing / spec reference</span>
            <input value={drawingRef} onChange={(e) => setDrawingRef(e.target.value)} placeholder="e.g. DRG-2026-114" className={inqInp} />
          </label>
          <label className="block"><span className={inqLbl}>Remarks</span>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any notes for this enquiry" className={inqInp} />
          </label>
        </div>

        <div className="mt-3">
          <span className={inqLbl}>Attach drawing / spec sheet</span>
          {attachment ? (
            <div className="flex items-center gap-2 text-[13px] bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 rounded-lg px-3 py-2.5">
              <Paperclip className="w-4 h-4 text-indigo-600 shrink-0" />
              <span className="flex-1 truncate font-medium text-indigo-900 dark:text-indigo-300">{attachment}</span>
              <button onClick={() => setAttachment('')} className="text-slate-400 hover:text-rose-600 shrink-0" title="Remove file"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer text-[13px] text-slate-500 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2.5 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
              <Paperclip className="w-4 h-4 shrink-0" /> Choose a file — PDF, image or drawing
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) setAttachment(file.name); e.target.value = ''; }} />
            </label>
          )}
        </div>

        <button onClick={log} disabled={!valid || createInquiry.isPending} className={`mt-3 h-12 px-5 rounded-lg bg-indigo-600 text-white font-bold text-sm inline-flex items-center gap-1.5 ${valid && !createInquiry.isPending ? 'hover:bg-indigo-500' : 'opacity-40 cursor-not-allowed'}`}>
          <Plus className="w-4 h-4" /> Log inquiry
        </button>
      </Card>

      {inquiriesQ.isLoading ? <Loading /> : inquiries.length === 0 ? <EmptyState icon={<Inbox className="w-8 h-8" />} title="No inquiries waiting." hint="New inquiries appear here the moment they are logged." /> : inquiries.map((i) => (
        <div key={i.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-bold"><TraceLink id={i.inquiryNumber} onTrace={p.onTrace} className="font-bold" /> · {i.product}</div>
            <div className="text-[11px] text-slate-500 truncate">{nameOf(customers, i.customerId)} · {i.quantity} units · by {i.expectedDeliveryDate}{i.drawingRef ? ` · ${i.drawingRef}` : ''} · {i.status === 'quotation' ? 'quotation sent' : i.status === 'ordered' ? 'ordered' : i.status === 'approved' ? 'approved — quote it' : 'new inquiry'}</div>
          </div>
          {i.attachment && <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 shrink-0 max-w-[140px]"><Paperclip className="w-3 h-3 shrink-0" /> <span className="truncate">{i.attachment}</span></span>}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Quotations */

export function Quotations(p: SalesData) {
  const customers = useCustomers().data ?? [];
  const inquiriesQ = useInquiries();
  const quote = useQuoteInquiry();
  const toQuote = (inquiriesQ.data ?? []).filter((i) => i.status === 'submitted' || i.status === 'approved');
  const [rate, setRate] = useState<Record<string, string>>({});

  const sendQuote = (i: ApiInquiry) => {
    const r = Number(rate[i.id]);
    if (!r || r <= 0 || quote.isPending) return;
    quote.mutate({ id: i.id, quotationPrice: r }, {
      onSuccess: () => pushToast(`Quotation sent to ${nameOf(customers, i.customerId)} — ₹${r}/unit for ${i.product}.`),
      onError: (e) => pushToast(errMsg(e)),
    });
  };

  return (
    <div className="space-y-3">
      {inquiriesQ.isLoading ? <Loading /> : toQuote.length === 0 ? <EmptyState icon={<FileText className="w-8 h-8" />} title="No inquiries waiting for a quotation." hint="Log an inquiry first, then quote it here." /> : toQuote.map((i) => {
        const r = Number(rate[i.id]) || 0;
        return (
          <div key={i.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[150px]"><div className="font-bold"><TraceLink id={i.inquiryNumber} onTrace={p.onTrace} className="font-bold" /> · {i.product}</div><div className="text-[11px] text-slate-500">{nameOf(customers, i.customerId)} · {i.quantity} units · by {i.expectedDeliveryDate}</div></div>
            <label className="flex items-center gap-1 text-[13px] font-semibold text-slate-500">₹
              <input value={rate[i.id] ?? ''} onChange={(e) => setRate((x) => ({ ...x, [i.id]: e.target.value }))} inputMode="decimal" placeholder="rate/unit" className="w-24 h-11 px-2 rounded-lg border border-slate-300 text-sm font-mono" />
            </label>
            {r > 0 && <span className="text-[11px] text-slate-400 font-mono">= ₹{(r * i.quantity).toLocaleString('en-IN')}</span>}
            <button disabled={r <= 0 || quote.isPending} onClick={() => sendQuote(i)} className={`h-12 px-5 rounded-lg bg-indigo-600 text-white font-bold text-sm inline-flex items-center gap-1 ${r <= 0 || quote.isPending ? 'opacity-40 cursor-not-allowed' : ''}`}><Send className="w-4 h-4" /> Send quotation</button>
          </div>
        );
      })}
      <p className="text-[11px] text-slate-400">Enter a rate per unit, then send — the quotation moves to Orders for the customer to confirm.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- Orders */

export function Orders(p: SalesData) {
  const customers = useCustomers().data ?? [];
  const inquiriesQ = useInquiries();
  const ordersQ = useOrders();
  const confirmOrder = useConfirmOrder();
  const cancelOrder = useCancelOrder();
  const quotes = (inquiriesQ.data ?? []).filter((i) => i.status === 'quotation');
  const orders = ordersQ.data ?? [];
  const [prio, setPrio] = useState<Record<string, 'low' | 'medium' | 'high'>>({});
  const canConfirm = useCan('action:order.approve');

  const confirm = (i: ApiInquiry) => {
    if (confirmOrder.isPending) return;
    const priority = prio[i.id] ?? 'medium';
    confirmOrder.mutate({ inquiryId: i.id, priority }, {
      onSuccess: (so) => {
        pushNudge('good', `${so.soNumber} confirmed by sales — added to the planning queue.`);
        pushToast(`${so.soNumber} confirmed (${priority} priority) and sent to planning.`);
      },
      onError: (e) => pushToast(errMsg(e)),
    });
  };
  const cancel = (o: ApiOrder) => {
    if (cancelOrder.isPending) return;
    cancelOrder.mutate(o.id, {
      onSuccess: () => pushToast(`${o.soNumber} cancelled — returned to quotations.`),
      onError: (e) => pushToast(errMsg(e)),
    });
  };

  return (
    <div className="space-y-4">
      {quotes.length > 0 && (
        <Card title="Quotations waiting for customer confirmation">
          {quotes.map((i) => (
            <div key={i.id} className="border-b border-slate-100 dark:border-slate-800 py-3">
              <div className="font-bold text-[13px]"><TraceLink id={i.inquiryNumber} onTrace={p.onTrace} className="font-bold text-[13px]" /> · {i.product}</div>
              <div className="text-[11px] text-slate-500 mb-2">{nameOf(customers, i.customerId)} · {i.quantity} units</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-400">Priority:</span>
                {(['low', 'medium', 'high'] as const).map((pr) => <button key={pr} onClick={() => setPrio((x) => ({ ...x, [i.id]: pr }))} className={`h-9 px-3 rounded-lg text-[12px] font-bold border ${(prio[i.id] ?? 'medium') === pr ? (pr === 'high' ? 'bg-rose-600 text-white' : pr === 'medium' ? 'bg-amber-500 text-white' : 'bg-slate-600 text-white') : 'border-slate-200 text-slate-600'}`}>{pr}</button>)}
                <button disabled={!canConfirm || confirmOrder.isPending} title={canConfirm ? undefined : 'No access — ask your administrator'} onClick={() => confirm(i)} className={`ml-auto h-11 px-5 rounded-lg bg-indigo-600 text-white font-bold text-sm inline-flex items-center gap-1 ${canConfirm && !confirmOrder.isPending ? '' : 'opacity-50 cursor-not-allowed'}`}><CheckCircle2 className="w-4 h-4" /> Confirm order</button>
              </div>
            </div>
          ))}
        </Card>
      )}
      <Card title="Orders">
        {ordersQ.isLoading ? <Loading /> : orders.length === 0 ? <EmptyState icon={<ClipboardList className="w-8 h-8" />} title="No orders yet." /> : (
          <div className="space-y-2">
            {orders.map((o) => (
              <div key={o.id} className="flex items-center gap-3 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                <div className="flex-1 min-w-0"><div className="font-bold text-[13px]"><TraceLink id={o.soNumber} onTrace={p.onTrace} className="font-bold text-[13px]" /> · {o.product}</div><div className="text-[12px] text-emerald-600 font-semibold">{orderSentence(o.status)}</div></div>
                {chip(o.priority)}
                {o.status === 'pending' && <button onClick={() => cancel(o)} className="text-[11px] font-bold text-slate-400 hover:text-rose-600 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 shrink-0 transition-colors" title="Cancel this order (only before planning)">Cancel</button>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- Customers */

export function SalesCustomers(_p: SalesData) {
  const customersQ = useCustomers();
  const customers = customersQ.data ?? [];
  const [showAdd, setShowAdd] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Customers</h2>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold shadow-sm cursor-pointer shrink-0">
          <Plus className="w-4 h-4" /> Add customer
        </button>
      </div>
      <Card title={`${customers.length} on file`}>
        {customersQ.isLoading ? <Loading /> : customers.length === 0 ? <EmptyState icon={<Users className="w-8 h-8" />} title="No customers yet." hint="Add your first customer to start raising enquiries and orders." /> : (
          <div className="space-y-2">
            {customers.map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 py-2 text-[13px]">
                <div><div className="font-bold">{c.name}</div><div className="text-[11px] text-slate-500">{c.contactPerson || '—'} · {c.phone || 'no phone'}{c.email ? ` · ${c.email}` : ''}</div></div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${c.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{c.status === 'active' ? 'Active' : 'Inactive'}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      {showAdd && <AddCustomerModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// Module-level so it is NOT re-created on every keystroke (which would remount the input
// and drop focus). Controlled by the parent's value/onChange.
function ModalField({ label, value, onChange, ph, span }: { label: string; value: string; onChange: (v: string) => void; ph?: string; span?: boolean }) {
  return (
    <label className={span ? 'sm:col-span-2 block' : 'block'}>
      <span className="block text-[11px] font-bold text-slate-500 mb-1">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} className="w-full min-h-[42px] px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 placeholder-slate-400" />
    </label>
  );
}

function AddCustomerModal({ onClose }: { onClose: () => void }) {
  const createCustomer = useCreateCustomer();
  const [f, setF] = useState({ name: '', contactPerson: '', phone: '', email: '', gstNumber: '', billingAddress: '', deliveryAddress: '', paymentTerms: 'Net 30 days' });
  const set = (k: keyof typeof f, v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const submit = () => {
    if (!f.name.trim() || createCustomer.isPending) return;
    createCustomer.mutate(
      {
        name: f.name.trim(), gstNumber: f.gstNumber.trim(), contactPerson: f.contactPerson.trim(),
        phone: f.phone.trim(), email: f.email.trim(), billingAddress: f.billingAddress.trim(),
        deliveryAddress: (f.deliveryAddress || f.billingAddress).trim(), paymentTerms: f.paymentTerms.trim() || 'Net 30 days', status: 'active',
      },
      {
        onSuccess: (c) => { pushToast(`Customer ${c.name} added.`); onClose(); },
        onError: (e) => pushToast(errMsg(e)),
      },
    );
  };
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-lg w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Add a customer</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ModalField label="Company name" value={f.name} onChange={(v) => set('name', v)} ph="e.g. Sunrise Pipes Pvt Ltd" span />
          <ModalField label="Contact person" value={f.contactPerson} onChange={(v) => set('contactPerson', v)} ph="Name" />
          <ModalField label="Phone" value={f.phone} onChange={(v) => set('phone', v)} ph="+91 …" />
          <ModalField label="Email" value={f.email} onChange={(v) => set('email', v)} ph="name@company.com" />
          <ModalField label="GST number" value={f.gstNumber} onChange={(v) => set('gstNumber', v)} ph="29ABCDE1234F1Z5" />
          <ModalField label="Payment terms" value={f.paymentTerms} onChange={(v) => set('paymentTerms', v)} ph="Net 30 days" />
          <ModalField label="Billing address" value={f.billingAddress} onChange={(v) => set('billingAddress', v)} ph="Street, city, PIN" span />
          <ModalField label="Delivery address (optional)" value={f.deliveryAddress} onChange={(v) => set('deliveryAddress', v)} ph="Same as billing if blank" span />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="min-h-[44px] px-4 rounded-full border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300 cursor-pointer">Cancel</button>
          <button onClick={submit} disabled={!f.name.trim() || createCustomer.isPending} className="min-h-[44px] px-5 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold cursor-pointer inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add customer</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------ Complaints + CAPA (API-backed) */

const sevChip = (s: string) => <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${s === 'high' ? 'bg-rose-100 text-rose-800' : s === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{s.toUpperCase()}</span>;
const capaBadge = (status?: string) => {
  const cls: Record<string, string> = { open: 'bg-rose-100 text-rose-800', in_progress: 'bg-amber-100 text-amber-800', closed: 'bg-emerald-100 text-emerald-800' };
  const lab: Record<string, string> = { open: 'CAPA open', in_progress: 'CAPA in progress', closed: 'CAPA closed' };
  const s = status ?? 'open';
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${cls[s] ?? 'bg-slate-100 text-slate-700'}`}>{lab[s] ?? s}</span>;
};

export function SalesComplaints(p: SalesData) {
  const batchesQ = useComplaintBatches();
  const complaintsQ = useComplaints();
  const logComplaint = useLogComplaint();
  const resolve = useResolveComplaint();
  const batches = batchesQ.data ?? [];
  const complaints = complaintsQ.data ?? [];

  const [batchId, setBatchId] = useState('');
  const [sev, setSev] = useState<'low' | 'medium' | 'high'>('high');
  const [desc, setDesc] = useState('');
  const [capaFor, setCapaFor] = useState<ApiComplaint | null>(null);

  // Default the batch select to the first dispatched batch once loaded.
  useEffect(() => { if (!batchId && batches.length) setBatchId(batches[0].salesOrderId); }, [batchId, batches]);
  // Keep the open CAPA modal in sync with refetched complaint data.
  const capaComplaint = capaFor ? complaints.find((c) => c.id === capaFor.id) ?? capaFor : null;

  const days = sev === 'high' ? 3 : sev === 'medium' ? 7 : 14;
  const open = complaints.filter((c) => c.status !== 'resolved');

  const submit = () => {
    if (!batchId || logComplaint.isPending) return;
    logComplaint.mutate(
      { salesOrderId: batchId, severity: sev, description: desc.trim() },
      {
        onSuccess: (c) => {
          pushNudge('attention', `New complaint ${c.complaintNumber} registered — answer within ${days} days.`);
          pushToast(`Complaint ${c.complaintNumber} logged. A CAPA has been opened — respond within ${days} days.`);
          setDesc('');
        },
        onError: (e) => pushToast(errMsg(e)),
      },
    );
  };
  // Resolve 409s while the CAPA is still open — the error message tells the user to close it first.
  const doResolve = (c: ApiComplaint) => resolve.mutate(c.id, {
    onSuccess: () => pushToast(`Complaint ${c.complaintNumber} marked resolved.`),
    onError: (e) => pushToast(errMsg(e)),
  });

  return (
    <div className="space-y-4">
      <Card title="Log a customer complaint">
        <button className="w-full h-40 rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/40 flex flex-col items-center justify-center gap-2 hover:bg-indigo-50">
          <Camera className="w-12 h-12 text-indigo-500" />
          <span className="font-bold text-indigo-700">Take a photo of the defect</span>
        </button>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-[12px] font-semibold text-slate-500">Against dispatched batch
            {batchesQ.isLoading ? <div className="mt-1"><Loading /></div> : batches.length === 0 ? (
              <div className="mt-1 h-11 px-3 flex items-center rounded-lg border border-slate-200 text-[12px] text-slate-400">Nothing dispatched yet</div>
            ) : (
              <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className="mt-1 w-full h-11 px-3 rounded-lg border border-slate-300 text-sm font-mono">
                {batches.map((b) => <option key={b.id} value={b.salesOrderId}>{b.invoiceNumber} · {b.salesOrder.product} · {b.salesOrder.customer.name}</option>)}
              </select>
            )}
          </label>
          <div className="text-[12px] font-semibold text-slate-500">Severity
            <div className="mt-1 grid grid-cols-3 gap-1">
              {([['high', 'High — respond within 3 days'], ['medium', 'Medium — within 7 days'], ['low', 'Low — within 14 days']] as const).map(([v, lab]) => (
                <button key={v} onClick={() => setSev(v)} className={`h-11 rounded-lg text-[10px] font-bold border px-1 ${sev === v ? (v === 'high' ? 'bg-rose-600 text-white' : v === 'medium' ? 'bg-amber-500 text-white' : 'bg-slate-600 text-white') : 'border-slate-200 text-slate-600'}`}>{lab}</button>
              ))}
            </div>
          </div>
        </div>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What did the customer report?" className="mt-2 w-full h-11 px-3 rounded-lg border border-slate-300 text-sm" />
        <button onClick={submit} disabled={!batchId || logComplaint.isPending} className="mt-3 w-full h-14 rounded-xl bg-indigo-600 disabled:opacity-40 text-white font-bold text-base">Log complaint (answer within {days} days)</button>
      </Card>

      <Card title="Open complaints">
        {complaintsQ.isLoading ? <Loading /> : open.length === 0 ? <EmptyState icon={<MessageSquareWarning className="w-8 h-8" />} title="No open complaints." /> : (
          <div className="space-y-2">
            {open.map((c) => (
              <div key={c.id} className="flex items-center gap-3 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                {sevChip(c.severity)}
                <button onClick={() => p.onTrace(c.complaintNumber)} className="flex-1 min-w-0 text-left" title={`Trace ${c.complaintNumber}`}>
                  <div className="font-bold text-[13px] inline-flex items-center gap-1">{c.complaintNumber} · {c.product} <ArrowRight className="w-3 h-3 text-indigo-500" /></div>
                  <div className="text-[11px] text-slate-500 truncate flex items-center gap-1.5">against {c.batchNumber} {capaBadge(c.capa?.status)}</div>
                </button>
                <button onClick={() => setCapaFor(c)} className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs font-bold" title="Work the CAPA">Work CAPA</button>
                <button onClick={() => doResolve(c)} disabled={c.capa?.status !== 'closed' || resolve.isPending} className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold" title={c.capa?.status === 'closed' ? 'Mark this complaint resolved' : 'Close the CAPA first'}><CheckCircle2 className="w-3.5 h-3.5" /> Resolve</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {capaComplaint && <CapaModal complaint={capaComplaint} onClose={() => setCapaFor(null)} />}
    </div>
  );
}

function ModalArea({ label, value, onChange, ph, disabled }: { label: string; value: string; onChange: (v: string) => void; ph?: string; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold text-slate-500 mb-1">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} disabled={disabled} rows={2} className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 placeholder-slate-400 disabled:opacity-60" />
    </label>
  );
}

function CapaModal({ complaint, onClose }: { complaint: ApiComplaint; onClose: () => void }) {
  const capa = complaint.capa;
  const updateCapa = useUpdateCapa();
  const closeCapa = useCloseCapa();
  const [f, setF] = useState({
    rootCause: capa?.rootCause ?? '', correctiveAction: capa?.correctiveAction ?? '',
    preventiveAction: capa?.preventiveAction ?? '', responsiblePerson: capa?.responsiblePerson ?? '', dueDate: capa?.dueDate ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((prev) => ({ ...prev, [k]: v }));
  if (!capa) return null; // every complaint auto-opens a CAPA, so this is defensive
  const closed = capa.status === 'closed';
  const complete = !!(f.rootCause.trim() && f.correctiveAction.trim() && f.preventiveAction.trim());

  const save = () => {
    if (closed || updateCapa.isPending) return;
    updateCapa.mutate({ id: capa.id, patch: { ...f } }, { onSuccess: () => pushToast('CAPA saved.'), onError: (e) => pushToast(errMsg(e)) });
  };
  const doClose = () => {
    if (closeCapa.isPending) return;
    // Persist the latest edits first, then close — the server 422s if any mandatory field is blank.
    updateCapa.mutate({ id: capa.id, patch: { ...f } }, {
      onSuccess: () => closeCapa.mutate(capa.id, { onSuccess: () => { pushToast('CAPA closed. You can now resolve the complaint.'); onClose(); }, onError: (e) => pushToast(errMsg(e)) }),
      onError: (e) => pushToast(errMsg(e)),
    });
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-lg w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">CAPA · {complaint.complaintNumber}</h3>
            <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">{complaint.product} · against {complaint.batchNumber} {capaBadge(capa.status)} <span className="text-slate-400">due {capa.dueDate || '—'}</span></div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        {closed && <div className="text-[12px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">This CAPA is closed{capa.closedDate ? ` (${capa.closedDate})` : ''}. The complaint can be resolved.</div>}
        <div className="space-y-3">
          <ModalArea label="Root cause" value={f.rootCause} onChange={(v) => set('rootCause', v)} ph="Why did the defect happen?" disabled={closed} />
          <ModalArea label="Corrective action" value={f.correctiveAction} onChange={(v) => set('correctiveAction', v)} ph="What fixes this batch / issue?" disabled={closed} />
          <ModalArea label="Preventive action" value={f.preventiveAction} onChange={(v) => set('preventiveAction', v)} ph="What stops it recurring?" disabled={closed} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ModalField label="Responsible person" value={f.responsiblePerson} onChange={(v) => set('responsiblePerson', v)} ph="Owner" />
            <ModalField label="Due date" value={f.dueDate} onChange={(v) => set('dueDate', v)} ph="YYYY-MM-DD" />
          </div>
        </div>
        {!closed && (
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={save} disabled={updateCapa.isPending} className="min-h-[44px] px-4 rounded-full border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300 disabled:opacity-40 cursor-pointer">Save</button>
            <button onClick={doClose} disabled={!complete || closeCapa.isPending || updateCapa.isPending} title={complete ? 'Close this CAPA' : 'Root cause, corrective and preventive actions are all required'} className="min-h-[44px] px-5 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold cursor-pointer inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Close CAPA</button>
          </div>
        )}
      </div>
    </div>
  );
}
