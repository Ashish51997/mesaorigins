import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import { ApiError } from '../../lib/apiClient';
import {
  createLeadFulfillment,
  createLeadQuote,
  reviseLeadQuote,
  sendLeadQuote,
  updateFulfillmentMilestone,
  updateLeadFulfillment,
  updateLeadQuote,
  type QuoteWrite,
} from './api';
import { humanize } from './constants';
import type { LeadFulfillment, LeadQuote, MesaLead, QuoteStatus } from './types';

const inputClass = 'mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
const labelClass = 'text-[10px] font-bold uppercase tracking-wide text-slate-400';

type ComposerItem = {
  description: string;
  specification: string;
  hsnSacCode: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
};

type Composer = {
  title: string;
  currency: string;
  validUntil: string;
  summary: string;
  organizationRemarks: string;
  terms: Array<{ label: string; value: string }>;
  lineItems: ComposerItem[];
};

const newItem = (): ComposerItem => ({
  description: '', specification: '', hsnSacCode: '', quantity: '1', unit: 'unit', unitPrice: '', discountAmount: '0', taxRate: '18',
});

function nextValidityDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

function emptyComposer(): Composer {
  return {
    title: 'Technical and commercial quotation',
    currency: 'INR',
    validUntil: nextValidityDate(),
    summary: '',
    organizationRemarks: '',
    terms: [
      { label: 'Payment', value: '' },
      { label: 'Taxes', value: '' },
      { label: 'Delivery', value: '' },
      { label: 'Warranty', value: '' },
    ],
    lineItems: [newItem()],
  };
}

function composerFromQuote(quote: LeadQuote): Composer {
  return {
    title: quote.title,
    currency: quote.currency,
    validUntil: quote.validUntil ?? '',
    summary: quote.summary,
    organizationRemarks: quote.organizationRemarks,
    terms: quote.terms.map((term) => ({ label: term.label, value: term.value })),
    lineItems: quote.lineItems.map((item) => ({
      description: item.description,
      specification: item.specification,
      hsnSacCode: item.hsnSacCode,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      taxRate: item.taxRate,
    })),
  };
}

function requestKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The quotation workspace could not be updated.';
}

function statusTone(status: QuoteStatus): string {
  if (status === 'approved') return 'bg-emerald-100 text-emerald-800';
  if (status === 'sent') return 'bg-blue-100 text-blue-800';
  if (status === 'revision_requested') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-600';
}

export default function QuoteAndFulfillment({ lead, onChanged }: { lead: MesaLead; onChanged: () => Promise<void> | void }) {
  const draftQuote = useMemo(() => lead.quotes?.find((quote) => quote.status === 'draft') ?? null, [lead.quotes]);
  const [composer, setComposer] = useState<Composer>(() => draftQuote ? composerFromQuote(draftQuote) : emptyComposer());
  const [localDraft, setLocalDraft] = useState<LeadQuote | null>(draftQuote);
  const [busy, setBusy] = useState<'save' | 'send' | 'revise' | 'fulfillment' | 'milestone' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const quoteCreateKey = useRef(requestKey());
  const [fulfillment, setFulfillment] = useState<LeadFulfillment | null>(lead.fulfillment ?? null);

  useEffect(() => {
    setLocalDraft(draftQuote);
    if (draftQuote) setComposer(composerFromQuote(draftQuote));
  }, [draftQuote]);

  useEffect(() => setFulfillment(lead.fulfillment ?? null), [lead.fulfillment]);

  const patchComposer = <K extends keyof Composer>(key: K, value: Composer[K]) => {
    setComposer((current) => ({ ...current, [key]: value }));
    setError('');
    setNotice('');
  };

  const patchItem = (index: number, key: keyof ComposerItem, value: string) => {
    patchComposer('lineItems', composer.lineItems.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  };

  const validate = (): boolean => {
    if (!composer.title.trim()) { setError('Add a quotation title.'); return false; }
    if (composer.lineItems.length === 0 || composer.lineItems.some((item) => !item.description.trim() || !item.quantity || !item.unitPrice)) {
      setError('Every line item needs a description, quantity and unit price.');
      return false;
    }
    return true;
  };

  const payload = (idempotencyKey: string): QuoteWrite => ({
    idempotencyKey,
    title: composer.title.trim(),
    currency: composer.currency,
    ...(composer.validUntil ? { validUntil: composer.validUntil } : {}),
    summary: composer.summary.trim(),
    organizationRemarks: composer.organizationRemarks.trim(),
    terms: composer.terms.filter((term) => term.label.trim() && term.value.trim()).map((term) => ({ label: term.label.trim(), value: term.value.trim() })),
    lineItems: composer.lineItems.map((item) => ({
      description: item.description.trim(),
      specification: item.specification.trim(),
      ...(item.hsnSacCode.trim() ? { hsnSacCode: item.hsnSacCode.trim() } : {}),
      quantity: item.quantity,
      unit: item.unit.trim(),
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount || '0',
      taxRate: item.taxRate || '0',
    })),
  });

  const persistDraft = async (): Promise<LeadQuote | null> => {
    if (!validate()) return null;
    const input = payload(quoteCreateKey.current);
    const quote = localDraft
      ? await updateLeadQuote(lead.id, localDraft.id, {
          rowVersion: localDraft.rowVersion,
          title: input.title,
          currency: input.currency,
          validUntil: input.validUntil,
          summary: input.summary,
          organizationRemarks: input.organizationRemarks,
          terms: input.terms,
          lineItems: input.lineItems,
        })
      : await createLeadQuote(lead.id, input);
    setLocalDraft(quote);
    quoteCreateKey.current = requestKey();
    return quote;
  };

  const saveDraft = async () => {
    if (busy) return;
    setBusy('save'); setError(''); setNotice('');
    try {
      const quote = await persistDraft();
      if (!quote) return;
      setNotice(`Quotation version ${quote.versionNumber} saved as a draft.`);
      await onChanged();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(null);
    }
  };

  const sendDraft = async () => {
    if (busy) return;
    setBusy('send'); setError(''); setNotice('');
    try {
      const draft = await persistDraft();
      if (!draft) return;
      const sent = await sendLeadQuote(lead.id, draft.id, { rowVersion: draft.rowVersion, idempotencyKey: requestKey() });
      setLocalDraft(null);
      setComposer(emptyComposer());
      setNotice(`Quotation version ${sent.versionNumber} sent to the customer portal.`);
      await onChanged();
    } catch (sendError) {
      setError(errorMessage(sendError));
    } finally {
      setBusy(null);
    }
  };

  const revise = async (quote: LeadQuote) => {
    if (busy) return;
    setBusy('revise'); setError(''); setNotice('');
    try {
      const nextDraft = await reviseLeadQuote(lead.id, quote.id, { rowVersion: quote.rowVersion, idempotencyKey: requestKey() });
      setLocalDraft(nextDraft);
      setComposer(composerFromQuote(nextDraft));
      setNotice(`Version ${nextDraft.versionNumber} draft created. The prior version remains read-only.`);
      await onChanged();
    } catch (reviseError) {
      setError(errorMessage(reviseError));
    } finally {
      setBusy(null);
    }
  };

  const startFulfillment = async () => {
    if (busy) return;
    setBusy('fulfillment'); setError(''); setNotice('');
    try {
      const next = await createLeadFulfillment(lead.id, {
        idempotencyKey: requestKey(),
        status: 'in_progress',
        customerSummary: 'Your approved project is now in progress.',
      });
      setFulfillment(next);
      setNotice('Fulfilment tracker started with the standard project milestones.');
      await onChanged();
    } catch (fulfillmentError) {
      setError(errorMessage(fulfillmentError));
    } finally {
      setBusy(null);
    }
  };

  const saveFulfillment = async () => {
    if (!fulfillment || busy) return;
    setBusy('fulfillment'); setError(''); setNotice('');
    try {
      const next = await updateLeadFulfillment(lead.id, {
        rowVersion: fulfillment.rowVersion,
        status: fulfillment.status,
        customerSummary: fulfillment.customerSummary,
        ...(fulfillment.estimatedCompletionDate ? { estimatedCompletionDate: fulfillment.estimatedCompletionDate } : {}),
      });
      setFulfillment(next);
      setNotice('Customer fulfilment status updated.');
      await onChanged();
    } catch (fulfillmentError) {
      setError(errorMessage(fulfillmentError));
    } finally {
      setBusy(null);
    }
  };

  const setMilestoneStatus = async (milestoneId: string, status: LeadFulfillment['milestones'][number]['status']) => {
    if (!fulfillment || busy) return;
    const milestone = fulfillment.milestones.find((item) => item.id === milestoneId);
    if (!milestone) return;
    setBusy('milestone'); setError(''); setNotice('');
    try {
      const next = await updateFulfillmentMilestone(lead.id, milestone.id, { rowVersion: milestone.rowVersion, status });
      setFulfillment(next);
      setNotice(`${milestone.name} updated.`);
      await onChanged();
    } catch (milestoneError) {
      setError(errorMessage(milestoneError));
    } finally {
      setBusy(null);
    }
  };

  const quoteHistory = [...(lead.quotes ?? [])].filter((quote) => quote.status !== 'draft').sort((a, b) => b.versionNumber - a.versionNumber);
  const approvedQuote = quoteHistory.find((quote) => quote.status === 'approved');

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="quotation-delivery-heading">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><CircleDollarSign className="h-4 w-4 text-blue-700" /><h2 id="quotation-delivery-heading">Quotation & delivery</h2></div>
      <p className="mt-1 text-xs leading-5 text-slate-500">Build a versioned quotation, send it for a recorded customer decision, then track the approved work.</p>
      {error && <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-800">{error}</div>}
      {notice && <div role="status" className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" /> {notice}</div>}

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-xs font-extrabold text-slate-900">{localDraft ? `Draft version ${localDraft.versionNumber}` : 'New quotation draft'}</h3><p className="mt-1 text-[11px] text-slate-500">Only drafts are editable. Sending locks this version.</p></div>{localDraft && <span className="rounded-md bg-slate-200 px-2 py-1 text-[10px] font-bold uppercase text-slate-600">Draft</span>}</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className={labelClass}>Quotation title *</span><input value={composer.title} onChange={(event) => patchComposer('title', event.target.value)} className={inputClass} /></label>
          <label><span className={labelClass}>Currency</span><select value={composer.currency} onChange={(event) => patchComposer('currency', event.target.value)} className={inputClass}><option value="INR">INR</option><option value="USD">USD</option><option value="EUR">EUR</option></select></label>
          <label><span className={labelClass}>Valid until</span><input type="date" value={composer.validUntil} onChange={(event) => patchComposer('validUntil', event.target.value)} className={inputClass} /></label>
          <label className="sm:col-span-2"><span className={labelClass}>Customer-facing summary</span><textarea value={composer.summary} onChange={(event) => patchComposer('summary', event.target.value)} rows={2} className={`${inputClass} resize-y`} placeholder="Recommended solution, scope and key assumptions" /></label>
        </div>

        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between"><h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Line items</h4><button type="button" onClick={() => patchComposer('lineItems', [...composer.lineItems, newItem()])} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-blue-700"><Plus className="h-3.5 w-3.5" /> Add item</button></div>
          {composer.lineItems.map((item, index) => (
            <fieldset key={index} className="rounded-lg border border-slate-200 bg-white p-3">
              <legend className="px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Item {index + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-6">
                <label className="sm:col-span-4"><span className={labelClass}>Description *</span><input aria-label={`Item ${index + 1} description`} value={item.description} onChange={(event) => patchItem(index, 'description', event.target.value)} className={inputClass} /></label>
                <label className="sm:col-span-2"><span className={labelClass}>HSN / SAC</span><input value={item.hsnSacCode} onChange={(event) => patchItem(index, 'hsnSacCode', event.target.value)} className={inputClass} /></label>
                <label className="sm:col-span-6"><span className={labelClass}>Specification</span><textarea value={item.specification} onChange={(event) => patchItem(index, 'specification', event.target.value)} rows={2} className={`${inputClass} resize-y`} /></label>
                <label><span className={labelClass}>Quantity *</span><input aria-label={`Item ${index + 1} quantity`} inputMode="decimal" value={item.quantity} onChange={(event) => patchItem(index, 'quantity', event.target.value)} className={inputClass} /></label>
                <label><span className={labelClass}>Unit</span><input value={item.unit} onChange={(event) => patchItem(index, 'unit', event.target.value)} className={inputClass} /></label>
                <label className="sm:col-span-2"><span className={labelClass}>Unit price *</span><input aria-label={`Item ${index + 1} unit price`} inputMode="decimal" value={item.unitPrice} onChange={(event) => patchItem(index, 'unitPrice', event.target.value)} className={inputClass} /></label>
                <label><span className={labelClass}>Discount</span><input inputMode="decimal" value={item.discountAmount} onChange={(event) => patchItem(index, 'discountAmount', event.target.value)} className={inputClass} /></label>
                <label><span className={labelClass}>Tax %</span><input inputMode="decimal" value={item.taxRate} onChange={(event) => patchItem(index, 'taxRate', event.target.value)} className={inputClass} /></label>
              </div>
              {composer.lineItems.length > 1 && <button type="button" onClick={() => patchComposer('lineItems', composer.lineItems.filter((_, itemIndex) => itemIndex !== index))} className="mt-3 inline-flex min-h-9 items-center gap-1 text-[11px] font-bold text-rose-700"><Trash2 className="h-3.5 w-3.5" /> Remove item</button>}
            </fieldset>
          ))}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {composer.terms.map((term, index) => <label key={`${term.label}-${index}`}><span className={labelClass}>{term.label || `Term ${index + 1}`}</span><textarea value={term.value} onChange={(event) => patchComposer('terms', composer.terms.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} rows={2} className={`${inputClass} resize-y`} /></label>)}
          <label className="sm:col-span-2"><span className={labelClass}>Customer-visible remarks</span><textarea value={composer.organizationRemarks} onChange={(event) => patchComposer('organizationRemarks', event.target.value)} rows={2} className={`${inputClass} resize-y`} /><span className="mt-1 block text-[11px] leading-5 text-slate-500">Shown on the customer portal. Keep internal notes in Activity.</span></label>
        </div>
        <div className="mt-4 flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={() => void saveDraft()} disabled={Boolean(busy)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 disabled:opacity-50">{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft</button><button type="button" onClick={() => void sendDraft()} disabled={Boolean(busy)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-xs font-bold text-white disabled:opacity-50">{busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send quotation</button></div>
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-extrabold text-slate-900">Version history</h3>
        {quoteHistory.length === 0 ? <p className="mt-2 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-xs text-slate-500">No quotation has been sent yet.</p> : <div className="mt-2 space-y-2">{quoteHistory.map((quote) => <article key={quote.id} className="rounded-lg border border-slate-200 px-3 py-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold text-slate-800">Version {quote.versionNumber} · {quote.title}</p><p className="mt-1 text-[10px] text-slate-500">{quote.currency} {quote.grandTotal} · Sent {quote.sentAt ? new Date(quote.sentAt).toLocaleDateString('en-IN') : '—'} · Read-only</p></div><span className={`rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${statusTone(quote.status)}`}>{humanize(quote.status)}</span></div>{quote.customerRemark && <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-[11px] leading-5 text-amber-900">Customer: {quote.customerRemark}</p>}{['sent', 'revision_requested'].includes(quote.status) && !localDraft && <button type="button" onClick={() => void revise(quote)} disabled={Boolean(busy)} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[11px] font-bold text-blue-700 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Create revised draft</button>}</article>)}</div>}
      </div>

      <div className="mt-5 border-t border-slate-200 pt-5">
        <div className="flex items-center gap-2"><PackageCheck className="h-4 w-4 text-blue-700" /><h3 className="text-xs font-extrabold text-slate-900">Fulfilment milestones</h3></div>
        {!fulfillment ? (
          approvedQuote ? <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-900">Quotation approved by the customer</p><p className="mt-1 text-[11px] leading-5 text-emerald-800">Start the delivery tracker to publish project milestones to the customer portal.</p><button type="button" onClick={() => void startFulfillment()} disabled={Boolean(busy)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50">{busy === 'fulfillment' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Start fulfilment</button></div> : <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-xs text-slate-500">Milestones become available after the customer approves a quotation.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2"><label><span className={labelClass}>Project status</span><select value={fulfillment.status} onChange={(event) => setFulfillment({ ...fulfillment, status: event.target.value as LeadFulfillment['status'] })} className={inputClass}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="on_hold">On hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label><label><span className={labelClass}>Estimated completion</span><input type="date" value={fulfillment.estimatedCompletionDate ?? ''} onChange={(event) => setFulfillment({ ...fulfillment, estimatedCompletionDate: event.target.value })} className={inputClass} /></label><label className="sm:col-span-2"><span className={labelClass}>Customer-facing project summary</span><textarea value={fulfillment.customerSummary} onChange={(event) => setFulfillment({ ...fulfillment, customerSummary: event.target.value })} rows={2} className={`${inputClass} resize-y`} /></label><button type="button" onClick={() => void saveFulfillment()} disabled={Boolean(busy)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-50 sm:col-start-2">{busy === 'fulfillment' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save project status</button></div>
            <ol className="space-y-2">{[...fulfillment.milestones].sort((a, b) => a.sortOrder - b.sortOrder).map((milestone) => <li key={milestone.id} className="grid gap-2 rounded-lg border border-slate-200 px-3 py-3 sm:grid-cols-[minmax(0,1fr),180px] sm:items-center"><div><p className="text-xs font-bold text-slate-800">{milestone.name}</p><p className="mt-1 text-[10px] text-slate-500"><CalendarClock className="mr-1 inline h-3 w-3" /> Target {milestone.targetDate || 'not set'}{milestone.customerNote ? ` · ${milestone.customerNote}` : ''}</p></div><label><span className="sr-only">{milestone.name} status</span><select aria-label={`${milestone.name} status`} value={milestone.status} onChange={(event) => void setMilestoneStatus(milestone.id, event.target.value as typeof milestone.status)} disabled={Boolean(busy)} className={`${inputClass} mt-0 disabled:opacity-50`}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label></li>)}</ol>
          </div>
        )}
      </div>
    </section>
  );
}
