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

import { useState, useEffect, useMemo } from 'react';
import {
  Inbox, FileText, ClipboardList, Users, MessageSquareWarning, Camera, ArrowRight, Send, CheckCircle2, Plus, X, Paperclip, Search
} from 'lucide-react';
import { Inquiry, SalesOrder, CustomerComplaint, Customer } from '../../types';
import { pushToast, pushNudge } from '../Notify';
import { useCan } from '../../lib/accessStore';
import { EmptyState } from '../EmptyState';
import { TraceLink } from '../TraceLink';
import { DataTable, formatTableDate } from '../DataTable';
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

const Loading = () => <div className="text-[12px] text-slate-400 px-1 py-6 text-center">Loading…</div>;

function orderStatusMeta(s: string): { label: string; hint: string; className: string } {
  const map: Record<string, { label: string; hint: string; className: string }> = {
    pending: { label: 'Awaiting planning', hint: 'Confirmed — in planning queue', className: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300' },
    planned: { label: 'Planned', hint: 'Waiting for operator to start', className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300' },
    in_production: { label: 'In production', hint: 'Running on the line', className: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' },
    inspected: { label: 'QC passed', hint: 'Moving to packing', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' },
    packed: { label: 'Packed', hint: 'Ready in warehouse', className: 'bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300' },
    dispatched: { label: 'Dispatched', hint: 'Sent to the customer', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  };
  return map[s] ?? { label: s, hint: '', className: 'bg-slate-100 text-slate-700' };
}

function OrderStatusBadge({ status }: { status: string }) {
  const m = orderStatusMeta(status);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${m.className}`} title={m.hint || undefined}>
      {m.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls =
    priority === 'high'
      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
      : priority === 'medium'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  const label = priority === 'high' ? 'High' : priority === 'medium' ? 'Medium' : 'Low';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{label}</span>;
}

type OrderStatusFilter = 'all' | 'active' | 'pending' | 'in_production' | 'dispatched' | 'high';

/* ---------------------------------------------------------------- Home (legacy) */


/* ---------------------------------------------------------------- Inquiries */

const PRIMARY = 'bg-blue-600 hover:bg-blue-700 text-white';
const PRIMARY_OUTLINE = 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-blue-400 hover:text-blue-600';
const inqLbl = 'block text-[12px] font-medium text-slate-600 dark:text-slate-300 mb-1.5';
const inqInp = 'w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500';
const req = <span className="text-rose-500"> *</span>;

type InquiryStatusFilter = 'all' | 'open' | 'pending_quote' | 'quotation' | 'converted';

function inquiryStatusMeta(status: string): { label: string; className: string; bucket: Exclude<InquiryStatusFilter, 'all' | 'open'> | 'open' } {
  if (status === 'ordered') {
    return { label: 'Converted', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300', bucket: 'converted' };
  }
  if (status === 'quotation') {
    return { label: 'Quotation sent', className: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300', bucket: 'quotation' };
  }
  if (status === 'approved') {
    return { label: 'Needs quoting', className: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200', bucket: 'pending_quote' };
  }
  // submitted / new
  return { label: 'New inquiry', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', bucket: 'pending_quote' };
}

function InquiryStatusBadge({ status }: { status: string }) {
  const m = inquiryStatusMeta(status);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${m.className}`}>
      {m.label}
    </span>
  );
}

const SALES_TABS: { id: string; label: string }[] = [
  { id: 'inquiries', label: 'Inquiries' },
  { id: 'quotations', label: 'Quotations' },
  { id: 'orders', label: 'Orders' },
  { id: 'sales_customers', label: 'Customers' },
  { id: 'sales_complaints', label: 'Complaints' },
];

function SalesPipelineTabs({ active, onOpen }: { active: string; onOpen: (m: string) => void }) {
  return (
    <nav
      className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800 -mx-1 px-1"
      aria-label="Sales"
    >
      {SALES_TABS.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpen(t.id)}
            className={[
              'shrink-0 px-3 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors',
              on
                ? 'border-blue-600 text-blue-600 dark:border-slate-200 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
            ].join(' ')}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

export function Inquiries(p: SalesData) {
  const customersQ = useCustomers();
  const inquiriesQ = useInquiries();
  const createInquiry = useCreateInquiry();
  const customers = customersQ.data ?? [];
  const inquiries = inquiriesQ.data ?? [];

  const [panelOpen, setPanelOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<InquiryStatusFilter>('all');

  const [cust, setCust] = useState('');
  const [product, setProduct] = useState('');
  const [drawingRef, setDrawingRef] = useState('');
  const [qty, setQty] = useState('5000');
  const [deliver, setDeliver] = useState(now());
  const [remarks, setRemarks] = useState('');
  const [attachment, setAttachment] = useState('');
  const customerId = cust || customers[0]?.id || '';
  const valid = !!customerId && product.trim() !== '' && Number(qty) > 0 && deliver !== '';

  const resetForm = () => {
    setProduct(''); setDrawingRef(''); setRemarks(''); setAttachment(''); setQty('5000'); setDeliver(now());
  };

  const closePanel = () => { setPanelOpen(false); };

  const log = () => {
    if (!valid || createInquiry.isPending) return;
    createInquiry.mutate(
      { customerId, product: product.trim(), drawingRef: drawingRef.trim(), quantity: Number(qty), expectedDeliveryDate: deliver, remarks: remarks.trim(), attachment: attachment || undefined },
      {
        onSuccess: (inq) => {
          resetForm();
          setPanelOpen(false);
          pushToast(`Inquiry ${inq.inquiryNumber} logged for ${nameOf(customers, customerId)}.`);
        },
        onError: (e) => pushToast(errMsg(e)),
      },
    );
  };

  const stats = useMemo(() => {
    let open = 0;
    let pendingQuote = 0;
    let quotation = 0;
    let converted = 0;
    for (const i of inquiries) {
      if (i.status === 'ordered') converted += 1;
      else {
        open += 1;
        if (i.status === 'quotation') quotation += 1;
        else pendingQuote += 1; // submitted | approved
      }
    }
    return { open, pendingQuote, quotation, converted };
  }, [inquiries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inquiries.filter((i) => {
      const meta = inquiryStatusMeta(i.status);
      if (statusFilter === 'open' && i.status === 'ordered') return false;
      if (statusFilter === 'pending_quote' && !(i.status === 'submitted' || i.status === 'approved' || (!i.status))) return false;
      if (statusFilter === 'quotation' && i.status !== 'quotation') return false;
      if (statusFilter === 'converted' && i.status !== 'ordered') return false;
      if (!q) return true;
      const custName = nameOf(customers, i.customerId).toLowerCase();
      return (
        i.product.toLowerCase().includes(q)
        || custName.includes(q)
        || i.inquiryNumber.toLowerCase().includes(q)
        || meta.label.toLowerCase().includes(q)
      );
    });
  }, [inquiries, customers, search, statusFilter]);

  const filterChips: { id: InquiryStatusFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'pending_quote', label: 'Pending quote' },
    { id: 'quotation', label: 'Quotation sent' },
    { id: 'converted', label: 'Converted' },
  ];

  return (
    <div className="space-y-4">
      <SalesPipelineTabs active="inquiries" onOpen={p.onOpen} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Inquiries</h2>
          <p className="text-[13px] text-slate-500 mt-0.5">Track new enquiries through quotation and order conversion.</p>
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className={`inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-sm font-medium shadow-sm ${PRIMARY}`}
        >
          <Plus className="w-4 h-4" /> Log inquiry
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Open inquiries', value: stats.open, hint: 'Not yet converted' },
          { label: 'Pending quote', value: stats.pendingQuote, hint: 'Needs a rate' },
          { label: 'Quotation sent', value: stats.quotation, hint: 'Awaiting confirm' },
          { label: 'Converted', value: stats.converted, hint: 'Became orders' },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3"
          >
            <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white tracking-tight">{s.value}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{s.hint}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product or customer"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status filter">
          {filterChips.map((c) => {
            const on = statusFilter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setStatusFilter(c.id)}
                className={[
                  'h-8 px-3 rounded-full text-[12px] font-medium border transition-colors',
                  on
                    ? 'bg-blue-600 text-white border-blue-600 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300',
                ].join(' ')}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <DataTable
        title="Inquiry list"
        loading={inquiriesQ.isLoading}
        rows={filtered}
        rowKey={(i) => i.id}
        empty={<EmptyState icon={<Inbox className="w-8 h-8" />} title="No inquiries match." hint="Try clearing filters, or log a new inquiry." />}
        columns={[
          { key: 'inq', header: 'Inquiry', cell: (i) => <TraceLink id={i.inquiryNumber} onTrace={p.onTrace} className="font-medium font-mono text-[12px]" /> },
          { key: 'product', header: 'Product', cell: (i) => <span className="font-medium">{i.product}</span> },
          { key: 'customer', header: 'Customer', cell: (i) => nameOf(customers, i.customerId) },
          { key: 'qty', header: 'Qty', align: 'right', cell: (i) => i.quantity.toLocaleString('en-IN') },
          { key: 'due', header: 'Delivery', className: 'whitespace-nowrap', cell: (i) => formatTableDate(i.expectedDeliveryDate) },
          { key: 'status', header: 'Status', cell: (i) => <InquiryStatusBadge status={i.status} /> },
          { key: 'file', header: 'Attachment', cell: (i) => i.attachment ? (
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 inline-flex items-center gap-1 max-w-[140px]"><Paperclip className="w-3 h-3 shrink-0" /><span className="truncate">{i.attachment}</span></span>
          ) : <span className="text-slate-300">—</span> },
        ]}
      />

      {/* Side panel — log inquiry */}
      {panelOpen && (
        <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="log-inquiry-title">
          <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" aria-label="Close" onClick={closePanel} />
          <div className="relative w-full max-w-lg h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-xl flex flex-col animate-in slide-in-from-right">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 id="log-inquiry-title" className="text-[15px] font-semibold text-slate-900 dark:text-white">Log inquiry</h3>
                <p className="text-[12px] text-slate-500 mt-0.5">Capture product, qty, and delivery for a customer.</p>
              </div>
              <button type="button" onClick={closePanel} className={`h-9 w-9 rounded-lg inline-flex items-center justify-center ${PRIMARY_OUTLINE}`}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              {customers.length === 0 && (
                <div className="text-[12px] text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
                  Add a customer first (Customers tab) — an enquiry needs a customer.
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block sm:col-span-2">
                  <span className={inqLbl}>Customer{req}</span>
                  <select value={customerId} onChange={(e) => setCust(e.target.value)} className={inqInp}>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className={inqLbl}>Product{req}</span>
                  <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. RPVC pipe 20mm" className={inqInp} />
                </label>
                <label className="block">
                  <span className={inqLbl}>Quantity (units){req}</span>
                  <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" placeholder="5000" className={`${inqInp} font-mono tabular-nums`} />
                </label>
                <label className="block">
                  <span className={inqLbl}>Expected delivery{req}</span>
                  <input type="date" value={deliver} onChange={(e) => setDeliver(e.target.value)} className={inqInp} />
                </label>
                <label className="block sm:col-span-2">
                  <span className={inqLbl}>Drawing / spec reference</span>
                  <input value={drawingRef} onChange={(e) => setDrawingRef(e.target.value)} placeholder="e.g. DRG-2026-114" className={inqInp} />
                </label>
                <label className="block sm:col-span-2">
                  <span className={inqLbl}>Remarks</span>
                  <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any notes for this enquiry" className={inqInp} />
                </label>
              </div>

              <div>
                <span className={inqLbl}>Attach drawing / spec sheet</span>
                {attachment ? (
                  <div className="flex items-center gap-2 text-[13px] bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5">
                    <Paperclip className="w-4 h-4 text-slate-500 shrink-0" />
                    <span className="flex-1 truncate font-medium text-slate-800 dark:text-slate-200">{attachment}</span>
                    <button type="button" onClick={() => setAttachment('')} className="text-slate-400 hover:text-rose-600 shrink-0" title="Remove file"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 cursor-pointer text-[13px] text-slate-500 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2.5 hover:border-blue-400 hover:text-blue-600 transition-colors">
                    <Paperclip className="w-4 h-4 shrink-0" /> Choose a file — PDF, image or drawing
                    <input type="file" accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) setAttachment(file.name); e.target.value = ''; }} />
                  </label>
                )}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50/80 dark:bg-slate-950/40">
              <button type="button" onClick={closePanel} className={`h-10 px-4 rounded-lg text-sm font-medium ${PRIMARY_OUTLINE}`}>
                Cancel
              </button>
              <button
                type="button"
                onClick={log}
                disabled={!valid || createInquiry.isPending}
                className={`h-10 px-4 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 ${PRIMARY} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <Plus className="w-4 h-4" /> Save inquiry
              </button>
            </div>
          </div>
        </div>
      )}
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
      <DataTable
        title="Ready to quote"
        loading={inquiriesQ.isLoading}
        rows={toQuote}
        rowKey={(i) => i.id}
        empty={<EmptyState icon={<FileText className="w-8 h-8" />} title="No inquiries waiting for a quotation." hint="Log an inquiry first, then quote it here." />}
        columns={[
          { key: 'inq', header: 'Inquiry', cell: (i) => <TraceLink id={i.inquiryNumber} onTrace={p.onTrace} className="font-bold font-mono" /> },
          { key: 'product', header: 'Product', cell: (i) => <span className="font-semibold">{i.product}</span> },
          { key: 'customer', header: 'Customer', cell: (i) => nameOf(customers, i.customerId) },
          { key: 'qty', header: 'Qty', align: 'right', className: 'font-mono whitespace-nowrap', cell: (i) => i.quantity.toLocaleString('en-IN') },
          { key: 'due', header: 'Delivery', className: 'whitespace-nowrap', cell: (i) => i.expectedDeliveryDate },
          { key: 'rate', header: 'Rate / unit', cell: (i) => (
            <label className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500">₹
              <input value={rate[i.id] ?? ''} onChange={(e) => setRate((x) => ({ ...x, [i.id]: e.target.value }))} inputMode="decimal" placeholder="rate" className="w-24 h-9 px-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-mono bg-white dark:bg-slate-800" />
            </label>
          ) },
          { key: 'total', header: 'Total', align: 'right', className: 'font-mono whitespace-nowrap text-slate-400', cell: (i) => {
            const r = Number(rate[i.id]) || 0;
            return r > 0 ? `₹${(r * i.quantity).toLocaleString('en-IN')}` : '—';
          } },
          { key: 'act', header: '', align: 'right', cell: (i) => {
            const r = Number(rate[i.id]) || 0;
            return (
              <button disabled={r <= 0 || quote.isPending} onClick={() => sendQuote(i)} className={`h-9 px-4 rounded-lg bg-indigo-600 text-white font-bold text-xs inline-flex items-center gap-1 ${r <= 0 || quote.isPending ? 'opacity-40 cursor-not-allowed' : 'hover:bg-indigo-500'}`}>
                <Send className="w-3.5 h-3.5" /> Send
              </button>
            );
          } },
        ]}
      />
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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>('all');
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

  const stats = useMemo(() => {
    let active = 0;
    let awaitingPlan = 0;
    let inProd = 0;
    let high = 0;
    let dispatched = 0;
    for (const o of orders) {
      if (o.status === 'dispatched') dispatched += 1;
      else {
        active += 1;
        if (o.status === 'pending') awaitingPlan += 1;
        if (o.status === 'in_production') inProd += 1;
      }
      if (o.priority === 'high' && o.status !== 'dispatched') high += 1;
    }
    return { awaitingConfirm: quotes.length, active, awaitingPlan, inProd, high, dispatched };
  }, [orders, quotes.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter === 'active' && o.status === 'dispatched') return false;
      if (statusFilter === 'pending' && o.status !== 'pending') return false;
      if (statusFilter === 'in_production' && o.status !== 'in_production') return false;
      if (statusFilter === 'dispatched' && o.status !== 'dispatched') return false;
      if (statusFilter === 'high' && o.priority !== 'high') return false;
      if (!q) return true;
      const cust = nameOf(customers, o.customerId).toLowerCase();
      const st = orderStatusMeta(o.status).label.toLowerCase();
      return (
        o.soNumber.toLowerCase().includes(q)
        || o.product.toLowerCase().includes(q)
        || cust.includes(q)
        || st.includes(q)
      );
    });
  }, [orders, customers, search, statusFilter]);

  const filterChips: { id: OrderStatusFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'pending', label: 'Awaiting planning' },
    { id: 'in_production', label: 'In production' },
    { id: 'high', label: 'High priority' },
    { id: 'dispatched', label: 'Dispatched' },
  ];

  return (
    <div className="space-y-4">
      <SalesPipelineTabs active="orders" onOpen={p.onOpen} />

      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Orders</h2>
        <p className="text-[13px] text-slate-500 mt-0.5">Confirm quoted work, then track each SO through production and dispatch.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Awaiting confirm', value: stats.awaitingConfirm, hint: 'Quotes ready to book' },
          { label: 'Active orders', value: stats.active, hint: 'Not yet dispatched' },
          { label: 'High priority', value: stats.high, hint: 'Need attention' },
          { label: 'Dispatched', value: stats.dispatched, hint: 'Delivered to customer' },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3"
          >
            <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white tracking-tight">{s.value}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{s.hint}</div>
          </div>
        ))}
      </div>

      {quotes.length > 0 && (
        <DataTable
          title="Ready to confirm"
          toolbar={
            <span className="text-[12px] text-slate-500">
              Set priority, then confirm to send to planning
            </span>
          }
          dense
          rows={quotes}
          rowKey={(i) => i.id}
          columns={[
            {
              key: 'inq',
              header: 'Inquiry',
              cell: (i) => <TraceLink id={i.inquiryNumber} onTrace={p.onTrace} className="font-medium font-mono text-[12px]" />,
            },
            {
              key: 'product',
              header: 'Product',
              cell: (i) => <span className="font-medium">{i.product}</span>,
            },
            {
              key: 'customer',
              header: 'Customer',
              cell: (i) => nameOf(customers, i.customerId),
            },
            {
              key: 'qty',
              header: 'Qty',
              align: 'right',
              cell: (i) => i.quantity.toLocaleString('en-IN'),
            },
            {
              key: 'rate',
              header: 'Rate',
              align: 'right',
              className: 'whitespace-nowrap font-mono text-[12px]',
              cell: (i) => (i.quotationPrice != null ? `₹${Number(i.quotationPrice).toLocaleString('en-IN')}` : '—'),
            },
            {
              key: 'prio',
              header: 'Priority',
              cell: (i) => {
                const selected = prio[i.id] ?? 'medium';
                return (
                  <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-900/60" role="group" aria-label="Priority">
                    {(['low', 'medium', 'high'] as const).map((pr) => (
                      <button
                        key={pr}
                        type="button"
                        onClick={() => setPrio((x) => ({ ...x, [i.id]: pr }))}
                        className={[
                          'h-7 px-2 rounded text-[11px] font-medium capitalize transition-colors',
                          selected === pr
                            ? pr === 'high'
                              ? 'bg-rose-600 text-white'
                              : pr === 'medium'
                                ? 'bg-amber-500 text-white'
                                : 'bg-slate-600 text-white'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
                        ].join(' ')}
                      >
                        {pr}
                      </button>
                    ))}
                  </div>
                );
              },
            },
            {
              key: 'act',
              header: '',
              align: 'right',
              cell: (i) => (
                <button
                  type="button"
                  disabled={!canConfirm || confirmOrder.isPending}
                  title={canConfirm ? undefined : 'No access — ask your administrator'}
                  onClick={() => confirm(i)}
                  className={`h-8 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 ${PRIMARY} ${canConfirm && !confirmOrder.isPending ? '' : 'opacity-50 cursor-not-allowed'}`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Confirm order
                </button>
              ),
            },
          ]}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SO, product, or customer"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status filter">
          {filterChips.map((c) => {
            const on = statusFilter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setStatusFilter(c.id)}
                className={[
                  'h-8 px-3 rounded-full text-[12px] font-medium border transition-colors',
                  on
                    ? 'bg-blue-600 text-white border-blue-600 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300',
                ].join(' ')}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <DataTable
        title="Order list"
        loading={ordersQ.isLoading}
        rows={filtered}
        rowKey={(o) => o.id}
        empty={<EmptyState icon={<ClipboardList className="w-8 h-8" />} title="No orders match." hint={quotes.length > 0 ? 'Confirm a quotation above to create the first sales order.' : 'Send a quotation first, then confirm it here.'} />}
        columns={[
          { key: 'so', header: 'SO', cell: (o) => <TraceLink id={o.soNumber} onTrace={p.onTrace} className="font-medium font-mono text-[12px]" /> },
          { key: 'product', header: 'Product', cell: (o) => <span className="font-medium">{o.product}</span> },
          { key: 'customer', header: 'Customer', cell: (o) => nameOf(customers, o.customerId) },
          { key: 'qty', header: 'Qty', align: 'right', cell: (o) => o.quantity.toLocaleString('en-IN') },
          { key: 'due', header: 'Delivery', className: 'whitespace-nowrap', cell: (o) => formatTableDate(o.deliveryDate) },
          { key: 'status', header: 'Status', cell: (o) => <OrderStatusBadge status={o.status} /> },
          { key: 'prio', header: 'Priority', cell: (o) => <PriorityBadge priority={o.priority} /> },
          { key: 'act', header: '', align: 'right', cell: (o) => o.status === 'pending' ? (
            <button
              type="button"
              onClick={() => cancel(o)}
              disabled={cancelOrder.isPending}
              className={`h-8 px-3 rounded-lg text-[12px] font-medium ${PRIMARY_OUTLINE} hover:border-rose-300 hover:text-rose-700 dark:hover:text-rose-300`}
              title="Cancel this order (only before planning)"
            >
              Cancel
            </button>
          ) : <span className="text-slate-300 text-[12px]">—</span> },
        ]}
      />
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
      <DataTable
        title={`${customers.length} on file`}
        loading={customersQ.isLoading}
        rows={customers}
        rowKey={(c) => c.id}
        empty={<EmptyState icon={<Users className="w-8 h-8" />} title="No customers yet." hint="Add your first customer to start raising enquiries and orders." />}
        columns={[
          { key: 'name', header: 'Customer', cell: (c) => <span className="font-bold">{c.name}</span> },
          { key: 'contact', header: 'Contact', cell: (c) => c.contactPerson || '—' },
          { key: 'phone', header: 'Phone', cell: (c) => c.phone || '—' },
          { key: 'email', header: 'Email', cell: (c) => c.email || '—' },
          { key: 'status', header: 'Status', align: 'right', cell: (c) => (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${c.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{c.status === 'active' ? 'Active' : 'Inactive'}</span>
          ) },
        ]}
      />
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

const sevChip = (s: string) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
    s === 'high'
      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
      : s === 'medium'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }`}
  >
    {s === 'high' ? 'High' : s === 'medium' ? 'Medium' : 'Low'}
  </span>
);

const capaBadge = (status?: string) => {
  const cls: Record<string, string> = {
    open: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300',
    in_progress: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    closed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  };
  const lab: Record<string, string> = { open: 'CAPA open', in_progress: 'CAPA in progress', closed: 'CAPA closed' };
  const s = status ?? 'open';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls[s] ?? 'bg-slate-100 text-slate-700'}`}>{lab[s] ?? s}</span>;
};

type ComplaintFilter = 'all' | 'open' | 'high' | 'capa_open' | 'resolved';

export function SalesComplaints(p: SalesData) {
  const batchesQ = useComplaintBatches();
  const complaintsQ = useComplaints();
  const logComplaint = useLogComplaint();
  const resolve = useResolveComplaint();
  const batches = batchesQ.data ?? [];
  const complaints = complaintsQ.data ?? [];

  const [panelOpen, setPanelOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ComplaintFilter>('open');
  const [batchId, setBatchId] = useState('');
  const [sev, setSev] = useState<'low' | 'medium' | 'high'>('high');
  const [desc, setDesc] = useState('');
  const [capaFor, setCapaFor] = useState<ApiComplaint | null>(null);

  useEffect(() => { if (!batchId && batches.length) setBatchId(batches[0].salesOrderId); }, [batchId, batches]);
  const capaComplaint = capaFor ? complaints.find((c) => c.id === capaFor.id) ?? capaFor : null;

  const days = sev === 'high' ? 3 : sev === 'medium' ? 7 : 14;

  const stats = useMemo(() => {
    let open = 0;
    let high = 0;
    let capaOpen = 0;
    let resolved = 0;
    for (const c of complaints) {
      if (c.status === 'resolved') resolved += 1;
      else {
        open += 1;
        if (c.severity === 'high') high += 1;
        if ((c.capa?.status ?? 'open') !== 'closed') capaOpen += 1;
      }
    }
    return { open, high, capaOpen, resolved, total: complaints.length };
  }, [complaints]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return complaints.filter((c) => {
      if (filter === 'open' && c.status === 'resolved') return false;
      if (filter === 'high' && (c.severity !== 'high' || c.status === 'resolved')) return false;
      if (filter === 'capa_open' && ((c.capa?.status ?? 'open') === 'closed' || c.status === 'resolved')) return false;
      if (filter === 'resolved' && c.status !== 'resolved') return false;
      if (!q) return true;
      return (
        c.complaintNumber.toLowerCase().includes(q)
        || (c.product || '').toLowerCase().includes(q)
        || (c.batchNumber || '').toLowerCase().includes(q)
        || (c.description || '').toLowerCase().includes(q)
      );
    });
  }, [complaints, search, filter]);

  const submit = () => {
    if (!batchId || logComplaint.isPending) return;
    logComplaint.mutate(
      { salesOrderId: batchId, severity: sev, description: desc.trim() },
      {
        onSuccess: (c) => {
          pushNudge('attention', `New complaint ${c.complaintNumber} registered — answer within ${days} days.`);
          pushToast(`Complaint ${c.complaintNumber} logged. A CAPA has been opened — respond within ${days} days.`);
          setDesc('');
          setPanelOpen(false);
        },
        onError: (e) => pushToast(errMsg(e)),
      },
    );
  };

  const doResolve = (c: ApiComplaint) => resolve.mutate(c.id, {
    onSuccess: () => pushToast(`Complaint ${c.complaintNumber} marked resolved.`),
    onError: (e) => pushToast(errMsg(e)),
  });

  const filterChips: { id: ComplaintFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'high', label: 'High severity' },
    { id: 'capa_open', label: 'CAPA open' },
    { id: 'resolved', label: 'Resolved' },
  ];

  return (
    <div className="space-y-4">
      <SalesPipelineTabs active="sales_complaints" onOpen={p.onOpen} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Complaints &amp; CAPA</h2>
          <p className="text-[13px] text-slate-500 mt-0.5">Log customer defects against dispatched batches and close the CAPA loop.</p>
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className={`inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-sm font-medium shadow-sm ${PRIMARY}`}
        >
          <Plus className="w-4 h-4" /> Log complaint
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Open complaints', value: stats.open, hint: 'Still investigating' },
          { label: 'High severity', value: stats.high, hint: 'Respond within 3 days' },
          { label: 'CAPA open', value: stats.capaOpen, hint: 'Needs root cause' },
          { label: 'Resolved', value: stats.resolved, hint: 'Closed cases' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
            <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white tracking-tight">{s.value}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search complaint, product, or batch"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Complaint filter">
          {filterChips.map((c) => {
            const on = filter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setFilter(c.id)}
                className={[
                  'h-8 px-3 rounded-full text-[12px] font-medium border transition-colors',
                  on
                    ? 'bg-blue-600 text-white border-blue-600 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300',
                ].join(' ')}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <DataTable
        title="Complaint list"
        loading={complaintsQ.isLoading}
        rows={filtered}
        rowKey={(c) => c.id}
        empty={<EmptyState icon={<MessageSquareWarning className="w-8 h-8" />} title="No complaints match." hint="Try clearing filters, or log a new complaint against a dispatched batch." />}
        columns={[
          { key: 'sev', header: 'Severity', cell: (c) => sevChip(c.severity) },
          { key: 'no', header: 'Complaint', cell: (c) => (
            <button onClick={() => p.onTrace(c.complaintNumber)} className="text-left font-medium font-mono text-[12px] inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-slate-100" title={`Trace ${c.complaintNumber}`}>
              {c.complaintNumber} <ArrowRight className="w-3 h-3 text-slate-400" />
            </button>
          ) },
          { key: 'product', header: 'Product', cell: (c) => <span className="font-medium">{c.product}</span> },
          { key: 'batch', header: 'Batch', cell: (c) => <span className="font-mono text-[12px] text-slate-600 dark:text-slate-300">{c.batchNumber}</span> },
          { key: 'capa', header: 'CAPA', cell: (c) => capaBadge(c.capa?.status) },
          { key: 'act', header: '', align: 'right', className: 'whitespace-nowrap', cell: (c) => (
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCapaFor(c)}
                className={`inline-flex items-center gap-1 h-8 px-3 rounded-lg text-xs font-medium ${PRIMARY_OUTLINE}`}
              >
                Work CAPA
              </button>
              <button
                type="button"
                onClick={() => doResolve(c)}
                disabled={c.capa?.status !== 'closed' || resolve.isPending || c.status === 'resolved'}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium"
                title={c.capa?.status === 'closed' ? 'Mark this complaint resolved' : 'Close the CAPA first'}
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Resolve
              </button>
            </div>
          ) },
        ]}
      />

      {panelOpen && (
        <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="log-complaint-title">
          <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" aria-label="Close" onClick={() => setPanelOpen(false)} />
          <div className="relative w-full max-w-lg h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-xl flex flex-col">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 id="log-complaint-title" className="text-[15px] font-semibold text-slate-900 dark:text-white">Log complaint</h3>
                <p className="text-[12px] text-slate-500 mt-0.5">Tie the defect to a dispatched batch and set severity.</p>
              </div>
              <button type="button" onClick={() => setPanelOpen(false)} className={`h-9 w-9 rounded-lg inline-flex items-center justify-center ${PRIMARY_OUTLINE}`}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              <button
                type="button"
                className="w-full rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-800/40 px-4 py-8 flex flex-col items-center justify-center gap-2 text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <Camera className="w-8 h-8 text-slate-400" />
                <span className="text-sm font-medium">Take a photo of the defect</span>
                <span className="text-[11px] text-slate-400">Optional — attach later if needed</span>
              </button>

              <label className="block">
                <span className={inqLbl}>Against dispatched batch{req}</span>
                {batchesQ.isLoading ? (
                  <div className="mt-1"><Loading /></div>
                ) : batches.length === 0 ? (
                  <div className="h-10 px-3 flex items-center rounded-lg border border-slate-200 dark:border-slate-700 text-[12px] text-slate-400">Nothing dispatched yet</div>
                ) : (
                  <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={inqInp}>
                    {batches.map((b) => (
                      <option key={b.id} value={b.salesOrderId}>
                        {b.invoiceNumber} · {b.salesOrder.product} · {b.salesOrder.customer.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>

              <div>
                <span className={inqLbl}>Severity{req}</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {([
                    ['high', 'High', '3 days'],
                    ['medium', 'Medium', '7 days'],
                    ['low', 'Low', '14 days'],
                  ] as const).map(([v, lab, due]) => {
                    const on = sev === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setSev(v)}
                        className={[
                          'rounded-lg border px-3 py-2.5 text-left transition-colors',
                          on
                            ? v === 'high'
                              ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/30'
                              : v === 'medium'
                                ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                                : 'border-slate-500 bg-slate-100 dark:bg-slate-800'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300',
                        ].join(' ')}
                      >
                        <div className="text-[13px] font-medium text-slate-800 dark:text-slate-100">{lab}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">Respond within {due}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className={inqLbl}>What did the customer report?</span>
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={3}
                  placeholder="Defect description, customer feedback, lot notes…"
                  className={`${inqInp} h-auto py-2.5 resize-y min-h-[88px]`}
                />
              </label>
            </div>

            <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50/80 dark:bg-slate-950/40">
              <button type="button" onClick={() => setPanelOpen(false)} className={`h-10 px-4 rounded-lg text-sm font-medium ${PRIMARY_OUTLINE}`}>
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!batchId || logComplaint.isPending}
                className={`h-10 px-4 rounded-lg text-sm font-medium ${PRIMARY} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                Save complaint · {days}d SLA
              </button>
            </div>
          </div>
        </div>
      )}

      {capaComplaint && <CapaModal complaint={capaComplaint} onClose={() => setCapaFor(null)} />}
    </div>
  );
}

function ModalArea({ label, value, onChange, ph, disabled }: { label: string; value: string; onChange: (v: string) => void; ph?: string; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-slate-600 dark:text-slate-300 mb-1.5">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} disabled={disabled} rows={2} className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 placeholder-slate-400 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
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
  if (!capa) return null;
  const closed = capa.status === 'closed';
  const complete = !!(f.rootCause.trim() && f.correctiveAction.trim() && f.preventiveAction.trim());

  const save = () => {
    if (closed || updateCapa.isPending) return;
    updateCapa.mutate({ id: capa.id, patch: { ...f } }, { onSuccess: () => pushToast('CAPA saved.'), onError: (e) => pushToast(errMsg(e)) });
  };
  const doClose = () => {
    if (closeCapa.isPending) return;
    updateCapa.mutate({ id: capa.id, patch: { ...f } }, {
      onSuccess: () => closeCapa.mutate(capa.id, { onSuccess: () => { pushToast('CAPA closed. You can now resolve the complaint.'); onClose(); }, onError: (e) => pushToast(errMsg(e)) }),
      onError: (e) => pushToast(errMsg(e)),
    });
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">CAPA · {complaint.complaintNumber}</h3>
            <div className="text-[12px] text-slate-500 mt-1 flex flex-wrap items-center gap-1.5">
              {complaint.product} · {complaint.batchNumber} {capaBadge(capa.status)}
              <span className="text-slate-400">Due {formatTableDate(capa.dueDate)}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className={`h-9 w-9 rounded-lg inline-flex items-center justify-center shrink-0 ${PRIMARY_OUTLINE}`}><X className="w-4 h-4" /></button>
        </div>
        {closed && (
          <div className="text-[12px] font-medium text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-lg px-3 py-2">
            This CAPA is closed{capa.closedDate ? ` (${formatTableDate(capa.closedDate)})` : ''}. The complaint can be resolved.
          </div>
        )}
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
            <button type="button" onClick={save} disabled={updateCapa.isPending} className={`h-10 px-4 rounded-lg text-sm font-medium disabled:opacity-40 ${PRIMARY_OUTLINE}`}>Save</button>
            <button
              type="button"
              onClick={doClose}
              disabled={!complete || closeCapa.isPending || updateCapa.isPending}
              title={complete ? 'Close this CAPA' : 'Root cause, corrective and preventive actions are all required'}
              className={`h-10 px-4 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-40 ${PRIMARY}`}
            >
              <CheckCircle2 className="w-4 h-4" /> Close CAPA
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
