import { useMemo, useRef, useState } from 'react';
import {
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  FileCheck2,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Printer,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { ApiError } from '../../lib/apiClient';
import { createPublicDecisionChallenge, decidePublicQuote, getPublicLeadPortal } from './api';
import { humanize } from './constants';
import type { CustomerRequestPortal, PublicLeadQuote } from './types';

function idempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function dateLabel(value?: string | null): string {
  if (!value) return 'Not scheduled';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function money(currency: string, value: string): string {
  const [whole = '0', fraction] = String(value).split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${sign}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

function safeHttpUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function quoteExpired(quote: PublicLeadQuote): boolean {
  if (!quote.validUntil) return false;
  const today = new Date();
  const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return quote.validUntil < localToday;
}

const reviewSteps = [
  { id: 'pending', label: 'Requirement received' },
  { id: 'in_review', label: 'Technical review' },
  { id: 'quoted', label: 'Quotation' },
  { id: 'approved', label: 'Fulfilment' },
] as const;

function reviewIndex(status: CustomerRequestPortal['review']['status']): number {
  if (status === 'closed') return -1;
  if (status === 'revision_requested') return 2;
  return reviewSteps.findIndex((step) => step.id === status);
}

export default function CustomerRequestPortal({
  token,
  initialPortal,
  justSubmitted = false,
}: {
  token: string;
  initialPortal: CustomerRequestPortal;
  justSubmitted?: boolean;
}) {
  const [portal, setPortal] = useState(initialPortal);
  const [decisionQuote, setDecisionQuote] = useState<PublicLeadQuote | null>(null);
  const [decision, setDecision] = useState<'approve' | 'request_revision' | null>(null);
  const [remark, setRemark] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [challenge, setChallenge] = useState<{ accepted: true; challengeId: string; expiresAt: string; devVerificationCode?: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState('');
  const [error, setError] = useState('');
  const decisionKey = useRef(idempotencyKey());
  const currentIndex = reviewIndex(portal.review.status);
  const requestClosed = portal.review.status === 'closed';
  const organizationName = portal.organization.profile.brandName || portal.organization.name;
  const organizationLogo = safeHttpUrl(portal.organization.profile.branding.logoUrl);
  const organizationWebsite = safeHttpUrl(portal.organization.profile.website);
  const quotes = useMemo(
    () => [...portal.quotes].sort((a, b) => b.versionNumber - a.versionNumber),
    [portal.quotes],
  );
  const currentQuote = quotes.find((quote) => quote.status === 'sent');

  const openDecision = (quote: PublicLeadQuote, nextDecision: 'approve' | 'request_revision') => {
    setDecisionQuote(quote);
    setDecision(nextDecision);
    setRemark('');
    setConfirmed(false);
    setChallenge(null);
    setVerificationCode('');
    setError('');
    decisionKey.current = idempotencyKey();
  };

  const closeDecision = () => {
    if (busy) return;
    setDecisionQuote(null);
    setDecision(null);
    setError('');
  };

  const refreshPortal = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshNotice('');
    setError('');
    try {
      const response = await getPublicLeadPortal(token);
      setPortal(response.portal);
      setRefreshNotice('Status updated.');
      window.setTimeout(() => setRefreshNotice(''), 2500);
    } catch (refreshError) {
      setError(refreshError instanceof ApiError ? refreshError.message : 'The latest status could not be loaded. Please try again.');
    } finally {
      setRefreshing(false);
    }
  };

  const requestChallenge = async () => {
    if (!verificationEmail.trim() || busy) {
      if (!verificationEmail.trim()) setError('Enter the email address that should receive the verification code.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const nextChallenge = await createPublicDecisionChallenge(token, { email: verificationEmail.trim() });
      setChallenge(nextChallenge);
      setSignerEmail((current) => current || verificationEmail.trim());
      setVerificationCode(import.meta.env.DEV ? nextChallenge.devVerificationCode ?? '' : '');
    } catch (challengeError) {
      setError(challengeError instanceof ApiError ? challengeError.message : 'A verification code could not be sent. Please contact the organization.');
    } finally {
      setBusy(false);
    }
  };

  const submitDecision = async () => {
    if (!decisionQuote || !decision || busy) return;
    if (decision === 'request_revision' && !remark.trim()) {
      setError('Tell the organization what should change in the quotation.');
      return;
    }
    if (decision === 'approve' && (!confirmed || !signerName.trim() || !signerEmail.trim())) {
      setError('Confirm acceptance and enter the approving person’s name and email.');
      return;
    }
    if (!challenge || !verificationCode.trim()) {
      setError('Verify your email with the one-time code before recording this decision.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await decidePublicQuote(token, decisionQuote.quoteActionId, {
        decision,
        remark: remark.trim(),
        idempotencyKey: decisionKey.current,
        quoteRowVersion: decisionQuote.quoteRowVersion,
        acceptanceConfirmed: decision === 'approve' && confirmed,
        signerName: decision === 'approve' ? signerName.trim() : '',
        signerEmail: decision === 'approve' ? signerEmail.trim() : '',
        challengeId: challenge.challengeId,
        verificationCode: verificationCode.trim(),
      });
      setPortal(response.portal);
      closeDecision();
    } catch (decisionError) {
      setError(decisionError instanceof ApiError ? decisionError.message : 'Your decision could not be recorded. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10 print:max-w-none print:px-0 print:py-0">
      {justSubmitted && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900 print:hidden">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div><h2 className="text-sm font-extrabold">Requirement submitted</h2><p className="mt-0.5 text-xs leading-5">Bookmark this exact URL. Return here to review status, customer follow-ups, quotations and delivery progress.</p></div>
        </div>
      )}

      {(error || refreshNotice) && !decisionQuote && <div className="mb-4 print:hidden">{error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-800">{error}</div>}{refreshNotice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-800">{refreshNotice}</div>}</div>}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div style={{ backgroundColor: portal.organization.profile.branding.primaryColor || '#102A65' }} className="grid gap-6 px-5 py-6 text-white sm:px-7 lg:grid-cols-[minmax(0,1fr),auto] lg:items-center print:bg-white print:text-slate-900">
          <div className="flex items-start gap-4">
            {organizationLogo && <img src={organizationLogo} alt={`${organizationName} logo`} referrerPolicy="no-referrer" className="hidden h-12 w-12 rounded-lg bg-white object-contain p-1 sm:block print:block" />}
            <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-200 print:text-slate-500">Customer request portal</p>
            <h1 className="mt-2 text-2xl font-extrabold !text-white print:!text-slate-900">{portal.lead.reference}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100 print:text-slate-600">{portal.lead.product || 'Technical and commercial requirement'}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row print:hidden">
            <button type="button" onClick={() => void refreshPortal()} disabled={refreshing} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/25 bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/20 disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> {refreshing ? 'Checking…' : 'Check for updates'}
            </button>
            <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/25 bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/20">
              <Printer className="h-4 w-4" /> Print / save quotation
            </button>
          </div>
        </div>

        <div className="px-5 py-5 sm:px-7">
          <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${requestClosed ? 'border-slate-300 bg-slate-100' : 'border-blue-200 bg-blue-50'}`}>
            <Clock3 className={`mt-0.5 h-5 w-5 shrink-0 ${requestClosed ? 'text-slate-600' : 'text-blue-700'}`} />
            <div>
              <h2 className={`text-sm font-extrabold ${requestClosed ? 'text-slate-900' : 'text-blue-950'}`}>{portal.review.status === 'pending' ? `Pending review by ${organizationName}` : portal.review.message || humanize(portal.review.status)}</h2>
              {portal.review.status === 'pending' && <p className="mt-1 text-xs leading-5 text-blue-800">Your requirement is safely recorded. The organization will share an update after technical review.</p>}
            </div>
          </div>

          <ol aria-label="Request progress" className="mt-6 grid gap-2 sm:grid-cols-4">
            {reviewSteps.map((step, index) => {
              const complete = !requestClosed && (index < currentIndex || portal.review.status === 'approved');
              const current = !requestClosed && index === currentIndex && portal.review.status !== 'approved';
              return (
                <li key={step.id} aria-current={current ? 'step' : undefined} className={`rounded-lg border px-3 py-3 ${complete ? 'border-emerald-200 bg-emerald-50' : current ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-center gap-2">
                    {complete ? <CheckCircle2 className="h-4 w-4 text-emerald-700" /> : current ? <Clock3 className="h-4 w-4 text-blue-700" /> : <Circle className="h-4 w-4 text-slate-300" />}
                    <span className="text-[11px] font-bold text-slate-700">{step.label}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.45fr),minmax(280px,0.55fr)] print:block">
        <div className="space-y-5">
          <section aria-labelledby="quotation-heading" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 id="quotation-heading" className="text-lg font-extrabold text-slate-900">Quotation</h2><p className="mt-1 text-xs text-slate-500">Each sent version is locked to preserve a clear commercial record.</p></div>
              {quotes.length > 0 && <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">{quotes.length} version{quotes.length === 1 ? '' : 's'}</span>}
            </div>

            {quotes.length === 0 ? (
              <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                <FileCheck2 className="mx-auto h-7 w-7 text-slate-400" />
                <p className="mt-3 text-sm font-bold text-slate-700">Quotation is being prepared</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">You will be able to review and respond here when it is sent.</p>
              </div>
            ) : quotes.map((quote, index) => {
              const expired = quoteExpired(quote) || quote.status === 'expired';
              const isCurrentSent = currentQuote?.quoteActionId === quote.quoteActionId && quote.status === 'sent' && !expired;
              const actionable = isCurrentSent && portal.decision.decisionAllowed;
              return (
                <article key={quote.quoteActionId} className={`mt-5 overflow-hidden rounded-xl border ${actionable ? 'border-blue-300' : 'border-slate-200'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div><p className="text-xs font-extrabold text-slate-900">{quote.title || `Quotation version ${quote.versionNumber}`}</p><p className="mt-1 text-[10px] text-slate-500">Version {quote.versionNumber} · {quote.sentAt ? `Sent ${dateLabel(quote.sentAt)}` : 'Not sent'} · Valid until {dateLabel(quote.validUntil)}</p></div>
                    <span className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${quote.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : actionable ? 'bg-blue-100 text-blue-800' : quote.status === 'revision_requested' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-600'}`}>{expired && quote.status === 'sent' ? 'Expired' : humanize(quote.status)}</span>
                  </div>
                  <div className="p-4">
                    {quote.summary && <p className="text-sm leading-6 text-slate-600">{quote.summary}</p>}
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[560px] text-left text-xs">
                        <thead><tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400"><th className="pb-2 pr-3">Item</th><th className="pb-2 pr-3 text-right">Qty</th><th className="pb-2 pr-3 text-right">Unit price</th><th className="pb-2 text-right">Total</th></tr></thead>
                        <tbody>{quote.lineItems.map((item, itemIndex) => <tr key={`${item.description}-${itemIndex}`} className="border-b border-slate-100 align-top"><td className="py-3 pr-3"><p className="font-bold text-slate-800">{item.description}</p>{item.specification && <p className="mt-1 max-w-md whitespace-pre-wrap text-[11px] leading-5 text-slate-500">{item.specification}</p>}</td><td className="py-3 pr-3 text-right tabular-nums text-slate-600">{item.quantity} {item.unit}</td><td className="py-3 pr-3 text-right tabular-nums text-slate-600">{money(quote.currency, item.unitPrice)}</td><td className="py-3 text-right font-bold tabular-nums text-slate-800">{money(quote.currency, item.total)}</td></tr>)}</tbody>
                      </table>
                    </div>
                    <dl className="ml-auto mt-4 max-w-xs space-y-2 text-xs"><div className="flex justify-between gap-4"><dt className="text-slate-500">Subtotal</dt><dd className="font-semibold tabular-nums">{money(quote.currency, quote.subtotal)}</dd></div>{quote.discountTotal !== '0' && quote.discountTotal !== '0.00' && <div className="flex justify-between gap-4"><dt className="text-slate-500">Discount</dt><dd className="font-semibold tabular-nums">− {money(quote.currency, quote.discountTotal)}</dd></div>}<div className="flex justify-between gap-4"><dt className="text-slate-500">Tax</dt><dd className="font-semibold tabular-nums">{money(quote.currency, quote.taxTotal)}</dd></div><div className="flex justify-between gap-4 border-t border-slate-200 pt-2 text-sm"><dt className="font-extrabold text-slate-900">Grand total</dt><dd className="font-extrabold tabular-nums text-slate-900">{money(quote.currency, quote.grandTotal)}</dd></div></dl>
                    {quote.terms.length > 0 && <dl className="mt-5 grid gap-2 sm:grid-cols-2">{quote.terms.map((term, termIndex) => <div key={`${term.label}-${termIndex}`} className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{term.label}</dt><dd className="mt-1 text-xs leading-5 text-slate-700">{term.value}</dd></div>)}</dl>}
                    {quote.customerMessage && <div className="mt-4 rounded-lg border border-slate-200 px-3 py-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Message from the organization</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-700">{quote.customerMessage}</p></div>}
                    {quote.customerRemark && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Customer response</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-amber-900">{quote.customerRemark}</p></div>}
                    {actionable && <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end print:hidden"><button type="button" onClick={() => openDecision(quote, 'request_revision')} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700 hover:border-amber-400 hover:bg-amber-50">Request revision</button><button type="button" onClick={() => openDecision(quote, 'approve')} className="min-h-11 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800">Approve quotation</button></div>}
                    {isCurrentSent && !portal.decision.decisionAllowed && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold leading-5 text-amber-900">{portal.decision.unavailableMessage || `Online decisions are temporarily unavailable. Contact ${organizationName} to respond to this quotation.`}</p>}
                    {expired && index === 0 && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">This quotation has expired. Contact {organizationName} for a revised version.</p>}
                  </div>
                </article>
              );
            })}
          </section>

          {portal.fulfillment && (
            <section aria-labelledby="fulfilment-heading" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="fulfilment-heading" className="text-lg font-extrabold text-slate-900">Project & delivery</h2><p className="mt-1 text-xs leading-5 text-slate-500">{portal.fulfillment.customerSummary || 'Track the approved work through delivery.'}</p></div><span className="rounded-md bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-800">{humanize(portal.fulfillment.status)}</span></div>
              {portal.fulfillment.estimatedCompletionDate && <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-600"><CalendarClock className="h-4 w-4 text-blue-700" /> Estimated completion {dateLabel(portal.fulfillment.estimatedCompletionDate)}</p>}
              <ol className="mt-5 space-y-2">{[...portal.fulfillment.milestones].sort((a, b) => a.sortOrder - b.sortOrder).map((milestone) => <li key={milestone.publicId} className="flex gap-3 rounded-lg border border-slate-200 px-3 py-3"><div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${milestone.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : milestone.status === 'in_progress' ? 'bg-blue-100 text-blue-700' : milestone.status === 'blocked' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-400'}`}>{milestone.status === 'completed' ? <Check className="h-4 w-4" /> : milestone.status === 'in_progress' ? <Wrench className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><p className="text-xs font-bold text-slate-800">{milestone.name}</p><span className="text-[10px] font-semibold text-slate-400">{humanize(milestone.status)} · {dateLabel(milestone.targetDate)}</span></div>{milestone.customerNote && <p className="mt-1 text-xs leading-5 text-slate-500">{milestone.customerNote}</p>}</div></li>)}</ol>
            </section>
          )}
        </div>

        <aside className="space-y-5 print:mt-5">
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-700" /><h2 className="text-sm font-extrabold text-slate-900">{organizationName}</h2></div>
            {portal.organization.profile.summary && <p className="mt-3 text-xs leading-5 text-slate-600">{portal.organization.profile.summary}</p>}
            {organizationWebsite && <a href={organizationWebsite} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-bold text-blue-700 hover:underline">Visit organization website</a>}
            {portal.organization.profile.capabilities.length > 0 && <ul className="mt-3 flex flex-wrap gap-1.5">{portal.organization.profile.capabilities.map((capability) => <li key={capability} className="rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-800">{capability}</li>)}</ul>}
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-600">
              {portal.organization.profile.contact.name && <p className="font-bold text-slate-800">{portal.organization.profile.contact.name}{portal.organization.profile.contact.title ? ` · ${portal.organization.profile.contact.title}` : ''}</p>}
              {portal.organization.profile.emails[0] && <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-slate-400" /> {portal.organization.profile.emails[0]}</p>}
              {portal.organization.profile.phones[0] && <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-slate-400" /> {portal.organization.profile.phones[0]}</p>}
              {portal.organization.profile.address.city && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> {[portal.organization.profile.address.city, portal.organization.profile.address.state, portal.organization.profile.address.country].filter(Boolean).join(', ')}</p>}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-700" /><h2 className="text-sm font-extrabold text-slate-900">Activity timeline</h2></div>
            <ol className="mt-4 space-y-4">{portal.timeline.length === 0 ? <li className="text-xs text-slate-500">Your submitted requirement is awaiting its first update.</li> : portal.timeline.map((item, itemIndex) => <li key={`${item.type}-${item.occurredAt}-${itemIndex}`} className="flex gap-3"><div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-600" /><div><p className="text-xs font-bold text-slate-800">{item.title}</p>{item.message && <p className="mt-1 text-[11px] leading-5 text-slate-500">{item.message}</p>}{item.nextUpdateAt && <p className="mt-1 text-[11px] font-semibold text-blue-700">Next update by {dateLabel(item.nextUpdateAt)}</p>}<p className="mt-1 text-[10px] text-slate-400">{dateLabel(item.occurredAt)}</p></div></li>)}</ol>
          </section>
        </aside>
      </div>

      {decisionQuote && decision && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4 print:hidden" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="quote-decision-title" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6">
            <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Quotation version {decisionQuote.versionNumber}</p><h2 id="quote-decision-title" className="mt-1 text-lg font-extrabold text-slate-900">{decision === 'approve' ? 'Approve this quotation' : 'Request a revision'}</h2></div><button type="button" onClick={closeDecision} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600">Cancel</button></div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{decision === 'approve' ? `You are accepting a total of ${money(decisionQuote.currency, decisionQuote.grandTotal)} and the commercial terms shown in this version.` : `Describe the changes ${organizationName} should make. This creates a clear revision record.`}</p>
            {error && <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-800">{error}</div>}
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs font-extrabold text-blue-950">Verify this decision</p>
              <p className="mt-1 text-[11px] leading-5 text-blue-800">We send a one-time code before recording a commercial decision.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <label className="min-w-0 flex-1"><span className="sr-only">Verification email</span><input type="email" aria-label="Verification email" value={verificationEmail} onChange={(event) => { setVerificationEmail(event.target.value); setChallenge(null); setVerificationCode(''); setError(''); }} placeholder="name@company.com" className="min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label>
                <button type="button" onClick={() => void requestChallenge()} disabled={busy} className="min-h-11 rounded-lg border border-blue-300 bg-white px-3 text-xs font-bold text-blue-800 disabled:opacity-50">{challenge ? 'Resend code' : 'Send code'}</button>
              </div>
              {challenge && <div className="mt-3"><p role="status" className="text-[11px] font-semibold text-blue-900">If the address matches this request, a code has been sent.</p><label className="mt-2 block"><span className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Verification code *</span><input inputMode="numeric" autoComplete="one-time-code" value={verificationCode} onChange={(event) => { setVerificationCode(event.target.value); setError(''); }} className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3 text-sm tracking-[0.2em] outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label></div>}
            </div>
            {decision === 'request_revision' ? (
              <label className="mt-4 block"><span className="text-xs font-bold text-slate-700">Revision request *</span><textarea value={remark} onChange={(event) => { setRemark(event.target.value); setError(''); }} rows={4} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" placeholder="For example: revise the delivery schedule and separate mold pricing." /></label>
            ) : (
              <div className="mt-4 space-y-4">
                <label className="block"><span className="text-xs font-bold text-slate-700">Approving person’s name *</span><input value={signerName} onChange={(event) => { setSignerName(event.target.value); setError(''); }} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label>
                <label className="block"><span className="text-xs font-bold text-slate-700">Approving person’s email *</span><input type="email" required value={signerEmail} onChange={(event) => { setSignerEmail(event.target.value); setError(''); }} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); setError(''); }} className="mt-0.5 h-4 w-4 rounded text-emerald-700 focus:ring-emerald-500" /><span className="text-xs leading-5 text-slate-700">I confirm I am authorized to approve this quotation and accept its price, scope and terms.</span></label>
              </div>
            )}
            <button type="button" onClick={() => void submitDecision()} disabled={busy} className={`mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold text-white disabled:opacity-50 ${decision === 'approve' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-blue-700 hover:bg-blue-800'}`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : decision === 'approve' ? <CheckCircle2 className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}{busy ? 'Recording…' : decision === 'approve' ? 'Confirm approval' : 'Send revision request'}</button>
          </section>
        </div>
      )}
    </main>
  );
}
