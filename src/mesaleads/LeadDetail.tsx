import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Download,
  Factory,
  FileText,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Save,
  Send,
  UserRound,
  Wrench,
} from 'lucide-react';
import ResponsiveOverlay from '@shared/components/ui/ResponsiveOverlay';
import { ApiError } from '@shared/lib/apiClient';
import { addCustomerPortalUpdate, addLeadActivity, fetchLeadAttachment, getMesaLead, updateMesaLead } from './api';
import { humanize, LEAD_STAGES } from './constants';
import type { LeadForm, LeadSubmission, MesaLead } from './types';
import QuoteAndFulfillment from './QuoteAndFulfillment';

const inputClass = 'mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
const labelClass = 'text-[10px] font-bold uppercase tracking-wide text-slate-400';

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Could not update this lead.';
}

function asInputDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function answersOf(submission: LeadSubmission): Array<{ key: string; label: string; value: unknown }> {
  if (Array.isArray(submission.answers)) {
    return submission.answers.map((answer) => ({
      key: answer.questionKey,
      label: answer.label ?? humanize(answer.questionKey),
      value: answer.value,
    }));
  }
  const snapshot = Array.isArray(submission.formSnapshot)
    ? submission.formSnapshot
    : submission.formSnapshot?.questions ?? [];
  return Object.entries(submission.answers ?? {}).map(([key, value]) => ({
    key,
    label: snapshot.find((question) => question.key === key)?.label ?? humanize(key),
    value,
  }));
}

export default function LeadDetail({
  leadId,
  forms,
  onClose,
  onUpdated,
}: {
  leadId: string | null;
  forms: LeadForm[];
  onClose: () => void;
  onUpdated: (lead: MesaLead) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['mesaleads', 'lead', leadId],
    queryFn: () => getMesaLead(leadId!),
    enabled: Boolean(leadId),
  });
  const lead = query.data;
  const [draft, setDraft] = useState<Partial<MesaLead>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [note, setNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [portalUpdateTitle, setPortalUpdateTitle] = useState('');
  const [portalUpdateNote, setPortalUpdateNote] = useState('');
  const [portalNextUpdateAt, setPortalNextUpdateAt] = useState('');
  const [publishingPortalUpdate, setPublishingPortalUpdate] = useState(false);
  const [downloadingAttachment, setDownloadingAttachment] = useState<string | null>(null);

  useEffect(() => {
    if (!lead) return;
    setDraft({ ...lead, nextFollowUpAt: asInputDateTime(lead.nextFollowUpAt) });
  }, [lead]);

  const assignedForm = forms.find((form) => form.id === lead?.formId);
  const patch = <K extends keyof MesaLead>(key: K, value: MesaLead[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError('');
    setNotice('');
  };

  const save = async () => {
    if (!lead || saving) return;
    if (draft.stage === 'lost' && !String(draft.lostReason ?? '').trim()) {
      setError('A lost reason is required before closing this lead.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const updated = await updateMesaLead(lead.id, {
        version: lead.version,
        stage: draft.stage,
        priority: draft.priority,
        source: draft.source,
        contactName: draft.contactName,
        companyName: draft.companyName,
        phone: draft.phone,
        email: draft.email,
        companyAddress: draft.companyAddress,
        gstNumber: draft.gstNumber,
        product: draft.product,
        requirement: draft.requirement ?? draft.requirementsSummary,
        scope: draft.scope,
        machineRecommendation: draft.machineRecommendation,
        clampTonnage: draft.clampTonnage || null,
        shotCapacity: draft.shotCapacity || null,
        moldStatus: draft.moldStatus,
        moldSupplier: draft.moldSupplier,
        moldQuoteAmount: draft.moldQuoteAmount || null,
        nextFollowUpAt: draft.nextFollowUpAt ? new Date(draft.nextFollowUpAt).toISOString() : null,
        followUpNote: draft.followUpNote,
        lostReason: draft.lostReason,
        orderReference: draft.orderReference,
      });
      setNotice('Lead updated.');
      onUpdated(updated);
      await queryClient.invalidateQueries({ queryKey: ['mesaleads'] });
    } catch (updateError) {
      setError(messageFor(updateError));
    } finally {
      setSaving(false);
    }
  };

  const addNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!lead || !note.trim() || addingNote) return;
    setAddingNote(true);
    setError('');
    try {
      await addLeadActivity(lead.id, { type: 'note', message: note.trim() });
      setNote('');
      setNotice('Activity added.');
      await query.refetch();
      await queryClient.invalidateQueries({ queryKey: ['mesaleads', 'summary'] });
    } catch (activityError) {
      setError(messageFor(activityError));
    } finally {
      setAddingNote(false);
    }
  };

  const publishPortalUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (!lead || !portalUpdateTitle.trim() || publishingPortalUpdate) return;
    setPublishingPortalUpdate(true);
    setError('');
    setNotice('');
    try {
      await addCustomerPortalUpdate(lead.id, {
        title: portalUpdateTitle.trim(),
        note: portalUpdateNote.trim(),
        nextUpdateAt: portalNextUpdateAt ? new Date(portalNextUpdateAt).toISOString() : undefined,
      });
      setPortalUpdateTitle('');
      setPortalUpdateNote('');
      setPortalNextUpdateAt('');
      setNotice('Customer portal update published.');
      await query.refetch();
    } catch (updateError) {
      setError(messageFor(updateError));
    } finally {
      setPublishingPortalUpdate(false);
    }
  };

  const downloadAttachment = async (id: string, fileName: string) => {
    if (downloadingAttachment) return;
    setDownloadingAttachment(id);
    setError('');
    try {
      const blob = await fetchLeadAttachment(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName || 'attachment';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (downloadError) {
      setError(messageFor(downloadError));
    } finally {
      setDownloadingAttachment(null);
    }
  };

  const latestSubmission = lead?.submissions?.[0];
  const activity = [...(lead?.activities ?? [])].sort((a, b) => new Date(b.createdAt ?? b.occurredAt ?? 0).getTime() - new Date(a.createdAt ?? a.occurredAt ?? 0).getTime());

  return (
    <ResponsiveOverlay open={Boolean(leadId)} onClose={onClose} title={lead ? `${lead.leadNumber} · ${lead.companyName || lead.contactName}` : 'Lead details'} variant="drawer-right" wide panelClassName="max-w-3xl">
      {query.isLoading || !lead ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-700" /> Loading lead…</div>
      ) : (
        <div className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-5">
          <div className="space-y-4">
            {(error || notice) && (
              <div>
                {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</div>}
                {notice && <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" /> {notice}</div>}
              </div>
            )}

            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><UserRound className="h-4 w-4 text-blue-700" /> Lead and contact</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label><span className={labelClass}>Stage</span><select disabled={['won', 'lost'].includes(lead.stage)} value={draft.stage ?? lead.stage} onChange={(event) => patch('stage', event.target.value as MesaLead['stage'])} className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500`}>{LEAD_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select>{['won', 'lost'].includes(lead.stage) && <span className="mt-1 block text-[10px] text-slate-400">Closed leads cannot return to the open pipeline.</span>}</label>
                <label><span className={labelClass}>Priority</span><select value={draft.priority ?? lead.priority} onChange={(event) => patch('priority', event.target.value as MesaLead['priority'])} className={inputClass}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
                <label><span className={labelClass}>Contact name</span><input value={draft.contactName ?? ''} onChange={(event) => patch('contactName', event.target.value)} className={inputClass} /></label>
                <label><span className={labelClass}>Company</span><input value={draft.companyName ?? ''} onChange={(event) => patch('companyName', event.target.value)} className={inputClass} /></label>
                <label><span className={labelClass}>Phone</span><input value={draft.phone ?? ''} onChange={(event) => patch('phone', event.target.value)} className={inputClass} /></label>
                <label><span className={labelClass}>Email</span><input type="email" value={draft.email ?? ''} onChange={(event) => patch('email', event.target.value)} className={inputClass} /></label>
                <label><span className={labelClass}>Source</span><select value={draft.source ?? 'direct'} onChange={(event) => patch('source', event.target.value)} className={inputClass}><option value="direct">Direct</option><option value="indiamart">IndiaMART</option><option value="website">Website</option><option value="referral">Referral</option><option value="other">Other</option></select></label>
                <label><span className={labelClass}>Scope</span><select value={draft.scope ?? 'unknown'} onChange={(event) => patch('scope', event.target.value as MesaLead['scope'])} className={inputClass}><option value="unknown">Not confirmed</option><option value="machine_only">Machine only</option><option value="machine_mold">Machine + mold</option><option value="mold_only">Mold only</option></select></label>
                <label className="sm:col-span-2"><span className={labelClass}>Product</span><input value={draft.product ?? ''} onChange={(event) => patch('product', event.target.value)} className={inputClass} /></label>
                <label className="sm:col-span-2"><span className={labelClass}>Broad requirement</span><textarea value={draft.requirement ?? draft.requirementsSummary ?? ''} onChange={(event) => patch('requirement', event.target.value)} rows={3} className={`${inputClass} resize-y`} /></label>
                {draft.stage === 'lost' && <label className="sm:col-span-2"><span className={labelClass}>Lost reason *</span><select value={draft.lostReason ?? ''} onChange={(event) => patch('lostReason', event.target.value)} className={inputClass}><option value="">Select a reason</option><option value="budget">Budget</option><option value="competitor">Competitor selected</option><option value="timing">Timing / postponed</option><option value="technical_mismatch">Technical mismatch</option><option value="no_response">No response</option><option value="duplicate">Duplicate</option><option value="invalid">Invalid inquiry</option></select></label>}
                {draft.stage === 'won' && <label className="sm:col-span-2"><span className={labelClass}>Customer PO / order reference</span><input value={draft.orderReference ?? ''} onChange={(event) => patch('orderReference', event.target.value)} className={inputClass} /></label>}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><ClipboardList className="h-4 w-4 text-blue-700" /> Customer questionnaire</div>
              <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3">
                <p className="text-xs font-bold text-blue-950">{assignedForm ? `${assignedForm.name} · Revision ${assignedForm.revision}` : lead.form?.name ? `${lead.form.name} · Revision ${lead.form.revision}` : 'Questionnaire assigned when the lead was created'}</p>
                <p className="mt-1 text-[11px] leading-5 text-blue-800">The private customer journey URL was created together with this lead. It opens this questionnaire first and becomes the customer’s status, quotation and follow-up portal after submission.</p>
                <p className="mt-1 text-[10px] font-semibold text-blue-700">Raw secure URLs are shown only when issued; they are not stored here in reusable form.</p>
              </div>

              {latestSubmission ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-2"><p className={labelClass}>Latest response</p><span className="text-[10px] text-slate-400">{new Date(latestSubmission.submittedAt ?? latestSubmission.createdAt ?? '').toLocaleString('en-IN')}</span></div>
                  <dl className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {answersOf(latestSubmission).map((answer) => (
                      <div key={answer.key} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[0.42fr,0.58fr] sm:gap-3">
                        <dt className="text-[11px] font-semibold text-slate-500">{answer.label}</dt>
                        <dd className="break-words text-xs font-medium text-slate-800">{Array.isArray(answer.value) ? answer.value.join(', ') : String(answer.value ?? '—')}</dd>
                      </div>
                    ))}
                  </dl>
                  {(latestSubmission.attachments?.length ?? 0) > 0 && (
                    <div className="mt-3">
                      <p className={labelClass}>Customer attachments</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {latestSubmission.attachments?.map((attachment) => (
                          <button
                            key={attachment.id}
                            type="button"
                            onClick={() => void downloadAttachment(attachment.id, attachment.originalName ?? attachment.fileName ?? 'attachment')}
                            disabled={Boolean(downloadingAttachment)}
                            className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-800 disabled:opacity-50"
                          >
                            {downloadingAttachment === attachment.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Paperclip className="h-4 w-4 shrink-0" />}
                            <span className="min-w-0 flex-1 truncate">{attachment.originalName ?? attachment.fileName}</span>
                            <Download className="h-3.5 w-3.5 shrink-0" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : <p className="mt-3 text-xs text-slate-500">No customer response has been submitted yet.</p>}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Wrench className="h-4 w-4 text-blue-700" /> Technical and commercial review</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2"><span className={labelClass}>Machine recommendation</span><textarea value={draft.machineRecommendation ?? ''} onChange={(event) => patch('machineRecommendation', event.target.value)} rows={2} className={`${inputClass} resize-y`} placeholder="Recommended model and engineering rationale" /></label>
                <label><span className={labelClass}>Clamp tonnage</span><input type="number" value={draft.clampTonnage ?? ''} onChange={(event) => patch('clampTonnage', event.target.value ? Number(event.target.value) : null)} className={inputClass} /></label>
                <label><span className={labelClass}>Shot capacity (g)</span><input type="number" value={draft.shotCapacity ?? ''} onChange={(event) => patch('shotCapacity', event.target.value ? Number(event.target.value) : null)} className={inputClass} /></label>
                {(draft.scope === 'machine_mold' || draft.scope === 'mold_only') && (
                  <>
                    <label><span className={labelClass}>Mold status</span><select value={draft.moldStatus ?? 'requirements_pending'} onChange={(event) => patch('moldStatus', event.target.value)} className={inputClass}><option value="requirements_pending">Requirements pending</option><option value="supplier_sourcing">Supplier sourcing</option><option value="supplier_quoted">Supplier quoted</option><option value="included_in_offer">Included in offer</option><option value="approved">Approved</option></select></label>
                    <label><span className={labelClass}>Mold supplier</span><input value={draft.moldSupplier ?? ''} onChange={(event) => patch('moldSupplier', event.target.value)} className={inputClass} /></label>
                    <label><span className={labelClass}>Supplier mold quote (₹)</span><input type="number" value={draft.moldQuoteAmount ?? ''} onChange={(event) => patch('moldQuoteAmount', event.target.value ? Number(event.target.value) : null)} className={inputClass} /></label>
                  </>
                )}
              </div>
            </section>

            <QuoteAndFulfillment lead={lead} onChanged={async () => { await query.refetch(); await queryClient.invalidateQueries({ queryKey: ['mesaleads', 'summary'] }); }} />

            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><CalendarClock className="h-4 w-4 text-blue-700" /> Follow-up</div>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">Internal scheduling only. These fields are not shown to the customer.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label><span className={labelClass}>Next follow-up</span><input type="datetime-local" value={String(draft.nextFollowUpAt ?? '')} onChange={(event) => patch('nextFollowUpAt', event.target.value)} className={inputClass} /></label>
                <label><span className={labelClass}>Next action</span><input value={draft.followUpNote ?? ''} onChange={(event) => patch('followUpNote', event.target.value)} className={inputClass} placeholder="Call, email, technical clarification…" /></label>
              </div>
            </section>

            <section className="rounded-xl border border-blue-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Send className="h-4 w-4 text-blue-700" /> Customer portal update</div>
              <p className="mt-1 text-[11px] font-semibold leading-5 text-blue-700">Published updates appear immediately on the customer’s shared journey URL. Do not include internal notes.</p>
              <form onSubmit={publishPortalUpdate} className="mt-4 space-y-3">
                <label className="block"><span className={labelClass}>Update title *</span><input required maxLength={240} value={portalUpdateTitle} onChange={(event) => { setPortalUpdateTitle(event.target.value); setError(''); }} className={inputClass} placeholder="For example: Technical review completed" /></label>
                <label className="block"><span className={labelClass}>Customer-visible details</span><textarea maxLength={5000} value={portalUpdateNote} onChange={(event) => { setPortalUpdateNote(event.target.value); setError(''); }} rows={3} className={`${inputClass} resize-y`} placeholder="Explain the progress or action in customer-friendly language." /></label>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="min-w-0 flex-1"><span className={labelClass}>Promise next update by</span><input type="datetime-local" value={portalNextUpdateAt} onChange={(event) => setPortalNextUpdateAt(event.target.value)} className={inputClass} /></label>
                  <button type="submit" disabled={!portalUpdateTitle.trim() || publishingPortalUpdate} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50">{publishingPortalUpdate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publish to customer</button>
                </div>
              </form>
            </section>

            <div className="sticky bottom-0 z-10 flex justify-end border-t border-slate-200 bg-slate-50/95 py-3 backdrop-blur">
              <button onClick={() => void save()} disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save lead</button>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><MessageSquarePlus className="h-4 w-4 text-blue-700" /> Activity</div>
              <form onSubmit={addNote} className="mt-3 flex gap-2">
                <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a call, email, meeting or note…" className={`${inputClass} mt-0 flex-1`} />
                <button type="submit" disabled={!note.trim() || addingNote} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:border-blue-300 disabled:opacity-50">{addingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />} Add</button>
              </form>
              <div className="mt-4 space-y-3">
                {activity.length === 0 ? <p className="text-xs text-slate-500">No activity recorded.</p> : activity.map((item) => (
                  <div key={item.id} className="flex gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">{item.type.includes('stage') ? <Factory className="h-3.5 w-3.5" /> : item.type.includes('question') ? <ClipboardList className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}</div>
                    <div className="min-w-0 flex-1 border-b border-slate-100 pb-3">
                      <p className="text-xs font-semibold text-slate-800">{item.message ?? item.body ?? humanize(item.type)}</p>
                      <p className="mt-1 text-[10px] text-slate-400">{new Date(item.createdAt ?? item.occurredAt ?? '').toLocaleString('en-IN')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </ResponsiveOverlay>
  );
}
