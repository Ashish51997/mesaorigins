import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Link2,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ErpPurchaseMatchCase,
  ErpSourceToPayDocument,
  ErpSourceToPayDocumentCreate,
  ErpSourceToPayDocumentLine,
  ErpSourceToPayDocumentType,
} from '../../lib/queries/mesaerp';
import { createErpIdempotencyKey } from '../../lib/queries/mesaerp';
import type { Vendor } from './model';

const inputClass = 'min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
const primaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300';
const secondaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300';

const DOCUMENT_LABELS: Record<ErpSourceToPayDocumentType, { singular: string; short: string }> = {
  purchase_requisition: { singular: 'Purchase requisition', short: 'PR' },
  purchase_order: { singular: 'Purchase order', short: 'PO' },
  goods_receipt: { singular: 'Goods receipt', short: 'GRN' },
  supplier_invoice: { singular: 'Supplier invoice', short: 'Invoice' },
};

const DOCUMENT_ORDER: ErpSourceToPayDocumentType[] = [
  'purchase_requisition',
  'purchase_order',
  'goods_receipt',
  'supplier_invoice',
];

function stateTone(state: string): string {
  if (['approved', 'matched'].includes(state)) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (['variance', 'disputed', 'cancelled'].includes(state)) return 'border-rose-200 bg-rose-50 text-rose-700';
  if (['submitted', 'pending'].includes(state)) return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-blue-200 bg-blue-50 text-blue-700';
}

function label(value: string): string {
  return value.replace(/[-_.]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatePill({ state }: { state: string }) {
  return <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 text-[10px] font-extrabold uppercase tracking-wide ${stateTone(state)}`}>{label(state)}</span>;
}

function Notice({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'amber' | 'rose' | 'emerald' }) {
  const tones = {
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return <div className={`rounded-xl border px-4 py-3 text-sm leading-6 ${tones[tone]}`}>{children}</div>;
}

function vendorName(vendorId: string | undefined, vendors: Vendor[]): string {
  if (!vendorId) return 'No vendor';
  return vendors.find((vendor) => vendor.id === vendorId)?.name ?? 'Vendor unavailable';
}

function amount(document: ErpSourceToPayDocument): string {
  return `${document.currency} ${document.grandTotal}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface LineDraft {
  sourceLineId?: string;
  itemId?: string;
  description: string;
  hsnSacCode: string;
  quantity: string;
  uom: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
  warehouseCode: string;
  batchNumber: string;
  promisedOn: string;
}

const emptyLine = (): LineDraft => ({
  description: '',
  hsnSacCode: '',
  quantity: '1',
  uom: 'unit',
  unitPrice: '0',
  discountAmount: '0',
  taxRate: '0',
  warehouseCode: '',
  batchNumber: '',
  promisedOn: '',
});

function lineFromSource(line: ErpSourceToPayDocumentLine): LineDraft {
  return {
    sourceLineId: line.id,
    ...(line.itemId ? { itemId: line.itemId } : {}),
    description: line.description,
    hsnSacCode: line.hsnSacCode,
    quantity: line.quantity,
    uom: line.uom,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    taxRate: line.taxRate,
    warehouseCode: line.warehouseCode,
    batchNumber: line.batchNumber,
    promisedOn: line.promisedOn ?? '',
  };
}

function sourceTypes(type: ErpSourceToPayDocumentType): ErpSourceToPayDocumentType[] {
  if (type === 'purchase_order') return ['purchase_requisition'];
  if (type === 'goods_receipt') return ['purchase_order'];
  if (type === 'supplier_invoice') return ['purchase_order', 'goods_receipt'];
  return [];
}

function DocumentCreateDialog({
  documents,
  vendors,
  currencyCode,
  onClose,
  onCreate,
}: {
  documents: ErpSourceToPayDocument[];
  vendors: Vendor[];
  currencyCode: string;
  onClose: () => void;
  onCreate: (documentType: ErpSourceToPayDocumentType, input: ErpSourceToPayDocumentCreate, requestKey: string) => Promise<void>;
}) {
  const [requestKey] = useState(() => createErpIdempotencyKey('source-document-create'));
  const [documentType, setDocumentType] = useState<ErpSourceToPayDocumentType>('purchase_requisition');
  const [documentNumber, setDocumentNumber] = useState('');
  const [documentDate, setDocumentDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [sourceDocumentId, setSourceDocumentId] = useState('');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [terms, setTerms] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const sources = documents.filter((document) => (
    document.status === 'approved' && sourceTypes(documentType).includes(document.documentType)
  ));
  const needsVendor = documentType !== 'purchase_requisition';
  const eligibleVendors = documentType === 'purchase_order'
    ? vendors.filter((vendor) => ['approved', 'conditionally_approved'].includes(vendor.lifecycleStatus ?? ''))
    : vendors.filter((vendor) => vendor.lifecycleStatus !== 'blocked');

  const selectType = (next: ErpSourceToPayDocumentType) => {
    setDocumentType(next);
    setSourceDocumentId('');
    setVendorId('');
    setLines([emptyLine()]);
  };

  const selectSource = (id: string) => {
    setSourceDocumentId(id);
    const source = documents.find((document) => document.id === id);
    if (!source) {
      setLines((current) => current.map(({ sourceLineId: _sourceLineId, ...line }) => line));
      return;
    }
    setVendorId(source.vendorId ?? '');
    setLines(source.lines.length ? source.lines.map(lineFromSource) : [emptyLine()]);
  };

  const updateLine = (index: number, change: Partial<LineDraft>) => {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...change } : line));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !lines.length || (needsVendor && !vendorId)) return;
    setSaving(true);
    setError('');
    try {
      await onCreate(documentType, {
        ...(documentNumber.trim() ? { documentNumber: documentNumber.trim() } : {}),
        documentDate,
        ...(dueDate ? { dueDate } : {}),
        ...(vendorId ? { vendorId } : {}),
        ...(sourceDocumentId ? { sourceDocumentId } : {}),
        currency: currencyCode,
        exchangeRate,
        terms: terms.split('\n').map((entry) => entry.trim()).filter(Boolean),
        shipping: {},
        originType: 'manual',
        originMetadata: {},
        lines: lines.map((line) => ({
          ...(line.itemId ? { itemId: line.itemId } : {}),
          ...(line.sourceLineId ? { sourceLineId: line.sourceLineId } : {}),
          description: line.description.trim(),
          hsnSacCode: line.hsnSacCode.trim(),
          quantity: line.quantity,
          uom: line.uom.trim(),
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          taxRate: line.taxRate,
          warehouseCode: line.warehouseCode.trim(),
          batchNumber: line.batchNumber.trim(),
          ...(line.promisedOn ? { promisedOn: line.promisedOn } : {}),
          dimensions: {},
        })),
      }, requestKey);
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'The source-to-pay document could not be created.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="source-document-create-title">
      <form onSubmit={(event) => void submit(event)} className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div><p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Independent source-to-pay record</p><h2 id="source-document-create-title" className="text-lg font-extrabold text-slate-900">New {DOCUMENT_LABELS[documentType].singular.toLowerCase()}</h2></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close source-to-pay document"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Document type *</span><select aria-label="Document type" className={inputClass} value={documentType} onChange={(event) => selectType(event.target.value as ErpSourceToPayDocumentType)}>{DOCUMENT_ORDER.map((type) => <option key={type} value={type}>{DOCUMENT_LABELS[type].singular}</option>)}</select></label>
            <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Document date *</span><input required aria-label="Document date" type="date" className={inputClass} value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} /></label>
            <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Due date</span><input aria-label="Document due date" type="date" min={documentDate} className={inputClass} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
            <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Document number</span><input aria-label="Document number" className={inputClass} value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} placeholder="Leave blank for company series" /></label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Approved source</span><select aria-label="Approved source document" disabled={!sources.length} className={inputClass} value={sourceDocumentId} onChange={(event) => selectSource(event.target.value)}><option value="">Independent start — no source</option>{sources.map((source) => <option key={source.id} value={source.id}>{DOCUMENT_LABELS[source.documentType].short} · {source.documentNumber} · {source.currency} {source.grandTotal}</option>)}</select><span className="mt-1 block text-[10px] leading-4 text-slate-500">A source creates immutable line links; it never shares lifecycle state.</span></label>
            <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Vendor {needsVendor ? '*' : ''}</span><select aria-label="Purchase vendor" required={needsVendor} className={inputClass} value={vendorId} onChange={(event) => setVendorId(event.target.value)}><option value="">{needsVendor ? 'Select an eligible vendor' : 'No vendor yet'}</option>{eligibleVendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.code || vendor.id} · {vendor.name} · {label(vendor.lifecycleStatus ?? 'review')}</option>)}</select></label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Currency</span><input readOnly className={`${inputClass} bg-slate-50`} value={currencyCode} /></label>
            <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Exchange rate *</span><input required aria-label="Exchange rate" inputMode="decimal" className={inputClass} value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} /></label>
          </div>

          <section className="rounded-xl border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><p className="text-[10px] font-extrabold uppercase tracking-wide text-blue-700">Server-calculated lines</p><h3 className="text-sm font-extrabold text-slate-900">Items, quantity, rate and tax</h3></div><button type="button" className={secondaryButton} onClick={() => setLines((current) => [...current, emptyLine()])}><Plus className="h-4 w-4" /> Add line</button></div>
            <div className="space-y-4 p-4">
              {lines.map((line, index) => (
                <article key={`${line.sourceLineId ?? 'new'}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="mb-3 flex items-center justify-between"><p className="text-xs font-extrabold text-slate-700">Line {index + 1}{line.sourceLineId ? ' · linked snapshot' : ''}</p><button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_item, lineIndex) => lineIndex !== index))} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <label className="sm:col-span-2"><span className="mb-1 block text-[11px] font-bold text-slate-600">Description *</span><input required aria-label={`Description ${index + 1}`} className={inputClass} value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} /></label>
                    <label><span className="mb-1 block text-[11px] font-bold text-slate-600">HSN / SAC</span><input aria-label={`HSN SAC ${index + 1}`} className={inputClass} value={line.hsnSacCode} onChange={(event) => updateLine(index, { hsnSacCode: event.target.value })} /></label>
                    <label><span className="mb-1 block text-[11px] font-bold text-slate-600">Promised on</span><input aria-label={`Promised on ${index + 1}`} type="date" className={inputClass} value={line.promisedOn} onChange={(event) => updateLine(index, { promisedOn: event.target.value })} /></label>
                    <label><span className="mb-1 block text-[11px] font-bold text-slate-600">Quantity *</span><input required aria-label={`Quantity ${index + 1}`} inputMode="decimal" className={inputClass} value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
                    <label><span className="mb-1 block text-[11px] font-bold text-slate-600">UOM *</span><input required aria-label={`UOM ${index + 1}`} className={inputClass} value={line.uom} onChange={(event) => updateLine(index, { uom: event.target.value })} /></label>
                    <label><span className="mb-1 block text-[11px] font-bold text-slate-600">Unit rate *</span><input required aria-label={`Unit rate ${index + 1}`} inputMode="decimal" className={inputClass} value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: event.target.value })} /></label>
                    <label><span className="mb-1 block text-[11px] font-bold text-slate-600">Discount</span><input required aria-label={`Discount ${index + 1}`} inputMode="decimal" className={inputClass} value={line.discountAmount} onChange={(event) => updateLine(index, { discountAmount: event.target.value })} /></label>
                    <label><span className="mb-1 block text-[11px] font-bold text-slate-600">Tax rate %</span><input required aria-label={`Tax rate ${index + 1}`} inputMode="decimal" className={inputClass} value={line.taxRate} onChange={(event) => updateLine(index, { taxRate: event.target.value })} /></label>
                    <label><span className="mb-1 block text-[11px] font-bold text-slate-600">Warehouse code</span><input aria-label={`Warehouse code ${index + 1}`} className={inputClass} value={line.warehouseCode} onChange={(event) => updateLine(index, { warehouseCode: event.target.value })} /></label>
                    <label><span className="mb-1 block text-[11px] font-bold text-slate-600">Batch / lot</span><input aria-label={`Batch lot ${index + 1}`} className={inputClass} value={line.batchNumber} onChange={(event) => updateLine(index, { batchNumber: event.target.value })} /></label>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Commercial terms</span><textarea aria-label="Commercial terms" className={`${inputClass} min-h-20 resize-y`} value={terms} onChange={(event) => setTerms(event.target.value)} placeholder="One term per line" /></label>
          {error && <Notice tone="rose">{error}</Notice>}
          <Notice><strong>Independent by design.</strong> This record owns its number, version and approval lifecycle. Optional source links accelerate entry but cannot roll this record back.</Notice>
        </div>
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white p-4"><button type="button" onClick={onClose} className={secondaryButton}>Cancel</button><button type="submit" disabled={saving || !lines.length || (needsVendor && !vendorId)} className={primaryButton}>{saving ? 'Creating…' : `Create ${DOCUMENT_LABELS[documentType].short} draft`}</button></div>
      </form>
    </div>
  );
}

function DocumentDetailDialog({
  document,
  vendors,
  onClose,
  onTransition,
}: {
  document: ErpSourceToPayDocument;
  vendors: Vendor[];
  onClose: () => void;
  onTransition: (document: ErpSourceToPayDocument, action: 'submit' | 'approve', requestKey: string) => Promise<void>;
}) {
  const [requestKey] = useState(() => createErpIdempotencyKey(`source-document-${document.status === 'draft' ? 'submit' : 'approve'}`));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const action = document.status === 'draft' ? 'submit' : document.status === 'submitted' ? 'approve' : null;
  const transition = async () => {
    if (!action || saving) return;
    setSaving(true);
    setError('');
    try { await onTransition(document, action, requestKey); onClose(); }
    catch (transitionError) { setError(transitionError instanceof Error ? transitionError.message : 'The lifecycle action could not be saved.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="source-document-detail-title">
      <section className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">{DOCUMENT_LABELS[document.documentType].singular}</p><h2 id="source-document-detail-title" className="font-mono text-lg font-extrabold text-slate-900">{document.documentNumber}</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close document detail"><X className="h-5 w-5" /></button></div>
        <div className="space-y-5 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
            ['Status', <StatePill key="status" state={document.status} />],
            ['Vendor', vendorName(document.vendorId, vendors)],
            ['Document date', document.documentDate],
            ['Grand total', amount(document)],
            ['Subtotal', `${document.currency} ${document.subtotal}`],
            ['Discount', `${document.currency} ${document.discountTotal}`],
            ['Tax', `${document.currency} ${document.taxTotal}`],
            ['Row version', String(document.rowVersion)],
          ].map(([heading, value]) => <div key={String(heading)} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{heading}</p><div className="mt-1 text-sm font-bold text-slate-900">{value}</div></div>)}</div>
          <section className="rounded-xl border border-slate-200"><div className="border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-extrabold text-slate-900">Persisted lines</h3></div><div className="divide-y divide-slate-100">{document.lines.map((line) => <article key={line.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]"><div><p className="text-sm font-bold text-slate-900">{line.lineNumber}. {line.description}</p><p className="mt-1 text-xs text-slate-500">{line.quantity} {line.uom} × {document.currency} {line.unitPrice} · tax {line.taxRate}%</p>{(line.warehouseCode || line.batchNumber) && <p className="mt-1 text-xs text-slate-500">Warehouse {line.warehouseCode || '—'} · batch {line.batchNumber || '—'}</p>}</div><div className="text-left sm:text-right"><p className="text-sm font-extrabold text-slate-900">{document.currency} {line.lineTotal}</p><p className="mt-1 text-[10px] text-slate-400">Tax {line.taxAmount}</p></div></article>)}</div></section>
          {document.links.length > 0 && <section className="rounded-xl border border-blue-100 bg-blue-50 p-4"><div className="flex items-center gap-2 text-sm font-extrabold text-blue-900"><Link2 className="h-4 w-4" /> Immutable document links</div>{document.links.map((link) => <p key={link.id} className="mt-2 break-all font-mono text-[10px] text-blue-800">{link.relationship} · {link.fromDocumentId} → {link.toDocumentId} · {link.snapshotHash}</p>)}</section>}
          {error && <Notice tone="rose">{error}</Notice>}
          {action === 'approve' && <Notice tone="amber"><strong>Maker-checker applies.</strong> The creator cannot approve this document. A stale row version or same-actor attempt is rejected without changing the record.</Notice>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-4"><button type="button" onClick={onClose} className={secondaryButton}>Close</button>{action && <button type="button" onClick={() => void transition()} disabled={saving} className={primaryButton}>{saving ? 'Saving…' : action === 'submit' ? 'Submit for approval' : 'Approve document'}</button>}</div>
      </section>
    </div>
  );
}

export function LivePurchaseRegister({
  documents,
  vendors,
  currencyCode,
  loading = false,
  onCreate,
  onTransition,
}: {
  documents: ErpSourceToPayDocument[];
  vendors: Vendor[];
  currencyCode: string;
  loading?: boolean;
  onCreate: (documentType: ErpSourceToPayDocumentType, input: ErpSourceToPayDocumentCreate, requestKey: string) => Promise<void>;
  onTransition: (document: ErpSourceToPayDocument, action: 'submit' | 'approve', requestKey: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'all' | ErpSourceToPayDocumentType>('all');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ErpSourceToPayDocument | null>(null);
  const filtered = documents.filter((document) => {
    const matchType = type === 'all' || document.documentType === type;
    const haystack = `${document.documentNumber} ${document.lines.map((line) => line.description).join(' ')} ${vendorName(document.vendorId, vendors)}`.toLowerCase();
    return matchType && haystack.includes(search.toLowerCase());
  });

  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Live source-to-pay</p><h2 className="mt-0.5 text-base font-extrabold text-slate-900">Purchase document register</h2></div><button type="button" onClick={() => setCreating(true)} className={primaryButton}><Plus className="h-4 w-4" /> New document</button></div>
      <div className="border-b border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900 sm:px-5"><strong>Requisitions, orders, receipts and supplier invoices are persisted.</strong> Each can start independently where its own validation permits; optional source links copy approved context without sharing status.</div>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[1fr_220px] sm:px-5"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className={`${inputClass} pl-9`} placeholder="Search number, item or vendor" aria-label="Search purchase documents" /></div><select aria-label="Filter document type" className={inputClass} value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="all">All document types</option>{DOCUMENT_ORDER.map((documentType) => <option key={documentType} value={documentType}>{DOCUMENT_LABELS[documentType].singular}</option>)}</select></div>

      <div className="hidden overflow-x-auto md:block"><table className="min-w-[900px] w-full text-left text-sm"><thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Document</th><th className="px-4 py-3">Vendor / first line</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Version</th><th className="px-5 py-3 text-right">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map((document) => <tr key={document.id} onClick={() => setSelected(document)} className="cursor-pointer hover:bg-slate-50"><td className="px-5 py-4"><p className="font-mono text-xs font-bold text-blue-700">{document.documentNumber}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{DOCUMENT_LABELS[document.documentType].singular}</p></td><td className="px-4 py-4"><p className="font-bold text-slate-900">{vendorName(document.vendorId, vendors)}</p><p className="mt-1 max-w-xs truncate text-xs text-slate-500">{document.lines[0]?.description ?? 'No lines'}</p></td><td className="px-4 py-4 text-slate-600">{document.documentDate}</td><td className="px-4 py-4"><StatePill state={document.status} /></td><td className="px-4 py-4 text-slate-600">v{document.rowVersion}</td><td className="px-5 py-4 text-right font-extrabold text-slate-900">{amount(document)}</td></tr>)}</tbody></table></div>

      <div className="divide-y divide-slate-100 md:hidden">{filtered.map((document) => <button key={document.id} type="button" onClick={() => setSelected(document)} className="w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs font-bold text-blue-700">{document.documentNumber}</p><p className="mt-1 text-sm font-extrabold text-slate-900">{DOCUMENT_LABELS[document.documentType].singular}</p></div><StatePill state={document.status} /></div><p className="mt-3 text-xs text-slate-500">{vendorName(document.vendorId, vendors)} · {document.documentDate}</p><div className="mt-3 flex items-center justify-between"><p className="truncate text-xs font-bold text-slate-700">{document.lines[0]?.description}</p><p className="ml-3 shrink-0 text-sm font-extrabold text-slate-900">{amount(document)}</p></div></button>)}</div>
      {!filtered.length && <div className="p-10 text-center">{loading ? <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" /> : <FileText className="mx-auto h-8 w-8 text-slate-300" />}<p className="mt-3 text-sm font-bold text-slate-700">{loading ? 'Loading permitted purchase documents…' : 'No persisted documents match this view.'}</p>{!loading && <p className="mt-1 text-xs text-slate-500">Create an independent requisition or another document your role permits.</p>}</div>}
      {creating && <DocumentCreateDialog documents={documents} vendors={vendors} currencyCode={currencyCode} onClose={() => setCreating(false)} onCreate={onCreate} />}
      {selected && <DocumentDetailDialog document={selected} vendors={vendors} onClose={() => setSelected(null)} onTransition={onTransition} />}
    </section>
  );
}

function MatchCreateDialog({
  documents,
  onClose,
  onCreate,
}: {
  documents: ErpSourceToPayDocument[];
  onClose: () => void;
  onCreate: (input: { purchaseOrderId: string; goodsReceiptId: string; supplierInvoiceId: string }, requestKey: string) => Promise<void>;
}) {
  const [requestKey] = useState(() => createErpIdempotencyKey('purchase-match-create'));
  const purchaseOrders = documents.filter((document) => document.documentType === 'purchase_order' && document.status === 'approved');
  const receipts = documents.filter((document) => document.documentType === 'goods_receipt' && document.status === 'approved');
  const invoices = documents.filter((document) => document.documentType === 'supplier_invoice' && ['submitted', 'approved'].includes(document.status));
  const [purchaseOrderId, setPurchaseOrderId] = useState(purchaseOrders[0]?.id ?? '');
  const [goodsReceiptId, setGoodsReceiptId] = useState(receipts[0]?.id ?? '');
  const [supplierInvoiceId, setSupplierInvoiceId] = useState(invoices[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!purchaseOrderId || !goodsReceiptId || !supplierInvoiceId || saving) return;
    setSaving(true); setError('');
    try { await onCreate({ purchaseOrderId, goodsReceiptId, supplierInvoiceId }, requestKey); onClose(); }
    catch (createError) { setError(createError instanceof Error ? createError.message : 'The three-way match could not be evaluated.'); }
    finally { setSaving(false); }
  };
  const option = (document: ErpSourceToPayDocument) => `${document.documentNumber} · ${document.currency} ${document.grandTotal}`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="purchase-match-create-title"><form onSubmit={(event) => void submit(event)} className="w-full max-w-xl rounded-t-2xl bg-white sm:rounded-2xl"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">One PO · one GRN · one invoice</p><h2 id="purchase-match-create-title" className="text-lg font-extrabold text-slate-900">Evaluate three-way match</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close purchase match"><X className="h-5 w-5" /></button></div><div className="space-y-4 p-5">
      <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Approved purchase order *</span><select required aria-label="Match purchase order" className={inputClass} value={purchaseOrderId} onChange={(event) => setPurchaseOrderId(event.target.value)}><option value="">Select purchase order</option>{purchaseOrders.map((document) => <option key={document.id} value={document.id}>{option(document)}</option>)}</select></label>
      <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Approved goods receipt *</span><select required aria-label="Match goods receipt" className={inputClass} value={goodsReceiptId} onChange={(event) => setGoodsReceiptId(event.target.value)}><option value="">Select goods receipt</option>{receipts.map((document) => <option key={document.id} value={document.id}>{option(document)}</option>)}</select></label>
      <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Submitted supplier invoice *</span><select required aria-label="Match supplier invoice" className={inputClass} value={supplierInvoiceId} onChange={(event) => setSupplierInvoiceId(event.target.value)}><option value="">Select supplier invoice</option>{invoices.map((document) => <option key={document.id} value={document.id}>{option(document)}</option>)}</select></label>
      {error && <Notice tone="rose">{error}</Notice>}<Notice><strong>Lineage is verified server-side.</strong> Same-vendor documents are not enough: the receipt and invoice must reference the selected order or receipt.</Notice>
    </div><div className="flex justify-end gap-2 border-t border-slate-200 p-4"><button type="button" onClick={onClose} className={secondaryButton}>Cancel</button><button type="submit" disabled={!purchaseOrderId || !goodsReceiptId || !supplierInvoiceId || saving} className={primaryButton}>{saving ? 'Evaluating…' : 'Evaluate match'}</button></div></form></div>
  );
}

function MatchDetailDialog({
  match,
  documents,
  onClose,
  onApprove,
}: {
  match: ErpPurchaseMatchCase;
  documents: ErpSourceToPayDocument[];
  onClose: () => void;
  onApprove: (match: ErpPurchaseMatchCase, reason: string, requestKey: string) => Promise<void>;
}) {
  const [requestKey] = useState(() => createErpIdempotencyKey('purchase-match-approve'));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const documentNumber = (id: string) => documents.find((document) => document.id === id)?.documentNumber ?? id;
  const approvable = ['variance', 'disputed'].includes(match.status);
  const approve = async (event: FormEvent) => {
    event.preventDefault();
    if (!approvable || reason.trim().length < 5 || saving) return;
    setSaving(true); setError('');
    try { await onApprove(match, reason.trim(), requestKey); onClose(); }
    catch (approveError) { setError(approveError instanceof Error ? approveError.message : 'The match variance could not be approved.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="purchase-match-detail-title"><form onSubmit={(event) => void approve(event)} className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Three-way match case</p><h2 id="purchase-match-detail-title" className="font-mono text-lg font-extrabold text-slate-900">{match.id}</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close match detail"><X className="h-5 w-5" /></button></div><div className="space-y-5 p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
        ['Status', <StatePill key="status" state={match.status} />],
        ['Purchase order', documentNumber(match.purchaseOrderId)],
        ['Goods receipt', documentNumber(match.goodsReceiptId)],
        ['Supplier invoice', documentNumber(match.supplierInvoiceId)],
        ['Quantity variance', match.quantityVariance],
        ['Rate variance', match.priceVariance],
        ['Tax variance', match.taxVariance],
        ['Total variance', match.totalVariance],
      ].map(([heading, value]) => <div key={String(heading)} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{heading}</p><div className="mt-1 break-words text-sm font-bold text-slate-900">{value}</div></div>)}</div>
      <section className="rounded-xl border border-slate-200"><div className="border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-extrabold text-slate-900">Persisted line comparison evidence</h3></div><div className="divide-y divide-slate-100">{match.details.map((detail, index) => <article key={index} className="grid gap-2 p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">{Object.entries(detail).filter(([, value]) => !Array.isArray(value) && typeof value !== 'object').map(([key, value]) => <div key={key}><p className="font-bold uppercase tracking-wide text-slate-400">{label(key)}</p><p className="mt-1 break-all font-semibold text-slate-800">{String(value)}</p></div>)}</article>)}{!match.details.length && <p className="p-5 text-sm text-slate-500">No line-detail evidence was returned.</p>}</div></section>
      {match.status === 'matched' && <Notice tone="emerald"><strong>Exact match recorded.</strong> No exception approval is required; the result remains auditable.</Notice>}
      {approvable && <><Notice tone="amber"><strong>Separate checker required.</strong> Approving a variance records your reason and identity; it does not approve or post a finance voucher.</Notice><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Variance approval reason *</span><textarea required minLength={5} aria-label="Variance approval reason" className={`${inputClass} min-h-24 resize-y`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the evidence supporting this exception" /></label></>}
      {error && <Notice tone="rose">{error}</Notice>}
    </div><div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-4"><button type="button" onClick={onClose} className={secondaryButton}>Close</button>{approvable && <button type="submit" disabled={reason.trim().length < 5 || saving} className={primaryButton}>{saving ? 'Approving…' : 'Approve variance'}</button>}</div></form></div>
  );
}

export function LivePurchaseMatch({
  documents,
  matches,
  loading = false,
  onCreate,
  onApprove,
}: {
  documents: ErpSourceToPayDocument[];
  matches: ErpPurchaseMatchCase[];
  loading?: boolean;
  onCreate: (input: { purchaseOrderId: string; goodsReceiptId: string; supplierInvoiceId: string }, requestKey: string) => Promise<void>;
  onApprove: (match: ErpPurchaseMatchCase, reason: string, requestKey: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ErpPurchaseMatchCase | null>(null);
  const documentById = useMemo(() => new Map(documents.map((document) => [document.id, document])), [documents]);
  const ready = documents.some((document) => document.documentType === 'purchase_order' && document.status === 'approved')
    && documents.some((document) => document.documentType === 'goods_receipt' && document.status === 'approved')
    && documents.some((document) => document.documentType === 'supplier_invoice' && ['submitted', 'approved'].includes(document.status));
  return (
    <div className="space-y-5">
      <Notice><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><div><strong>Three persisted sources, one controlled result.</strong> Exact-zero matches are recorded automatically; variances require a different checker and a reason. No ledger posting happens here.</div></div></Notice>
      <section className="rounded-xl border border-slate-200 bg-white"><div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Line-level Decimal comparison</p><h2 className="mt-0.5 text-base font-extrabold text-slate-900">Purchase match cases</h2></div><button type="button" onClick={() => setCreating(true)} disabled={!ready} className={primaryButton}><ClipboardCheck className="h-4 w-4" /> Evaluate match</button></div>
        {!ready && <div className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900 sm:px-5">An approved PO, approved GRN and submitted supplier invoice are required before a three-way case can be evaluated.</div>}
        <div className="hidden overflow-x-auto md:block"><table className="min-w-[920px] w-full text-left text-sm"><thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Invoice</th><th className="px-4 py-3">PO → GRN</th><th className="px-4 py-3">Quantity</th><th className="px-4 py-3">Rate</th><th className="px-4 py-3">Tax</th><th className="px-4 py-3">Total</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{matches.map((match) => <tr key={match.id} onClick={() => setSelected(match)} className="cursor-pointer hover:bg-slate-50"><td className="px-5 py-4"><p className="font-mono text-xs font-bold text-blue-700">{documentById.get(match.supplierInvoiceId)?.documentNumber ?? match.supplierInvoiceId}</p><p className="mt-1 text-[10px] text-slate-400">v{match.rowVersion}</p></td><td className="px-4 py-4 text-xs text-slate-600">{documentById.get(match.purchaseOrderId)?.documentNumber ?? match.purchaseOrderId}<ArrowRight className="mx-1 inline h-3.5 w-3.5" />{documentById.get(match.goodsReceiptId)?.documentNumber ?? match.goodsReceiptId}</td><td className="px-4 py-4 font-bold text-slate-800">{match.quantityVariance}</td><td className="px-4 py-4 font-bold text-slate-800">{match.priceVariance}</td><td className="px-4 py-4 font-bold text-slate-800">{match.taxVariance}</td><td className="px-4 py-4 font-bold text-slate-800">{match.totalVariance}</td><td className="px-5 py-4"><StatePill state={match.status} /></td></tr>)}</tbody></table></div>
        <div className="divide-y divide-slate-100 md:hidden">{matches.map((match) => <button key={match.id} type="button" onClick={() => setSelected(match)} className="w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs font-bold text-blue-700">{documentById.get(match.supplierInvoiceId)?.documentNumber ?? match.supplierInvoiceId}</p><p className="mt-1 text-xs text-slate-500">PO {documentById.get(match.purchaseOrderId)?.documentNumber ?? match.purchaseOrderId}</p></div><StatePill state={match.status} /></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><p>Total variance <strong>{match.totalVariance}</strong></p><p>Tax variance <strong>{match.taxVariance}</strong></p></div></button>)}</div>
        {!matches.length && <div className="p-10 text-center">{loading ? <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" /> : <CheckCircle2 className="mx-auto h-8 w-8 text-slate-300" />}<p className="mt-3 text-sm font-bold text-slate-700">{loading ? 'Loading permitted purchase match cases…' : 'No purchase match cases have been evaluated.'}</p>{!loading && <p className="mt-1 text-xs text-slate-500">Create a case when the linked document trio reaches the required statuses.</p>}</div>}
      </section>
      <Notice tone="amber"><strong>Current model boundary.</strong> This release evaluates one PO, one GRN and one supplier invoice per case with exact-zero tolerance. Multi-receipt allocation and policy tolerances require an additive allocation model.</Notice>
      {creating && <MatchCreateDialog documents={documents} onClose={() => setCreating(false)} onCreate={onCreate} />}
      {selected && <MatchDetailDialog match={selected} documents={documents} onClose={() => setSelected(null)} onApprove={onApprove} />}
    </div>
  );
}
