import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Archive,
  BarChart3,
  BellRing,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  ClipboardList,
  FileText,
  Filter,
  LayoutDashboard,
  ListFilter,
  Loader2,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Target,
  TrendingUp,
  UsersRound,
  X,
} from 'lucide-react';
import Logo from '@shared/components/Logo';
import { DataTable, formatTableDate } from '@shared/components/DataTable';
import { EmptyState } from '@shared/components/EmptyState';
import ResponsiveOverlay from '@shared/components/ui/ResponsiveOverlay';
import { StatusBadge, type StatusTone } from '@shared/components/ui/StatusBadge';
import { ApiError } from '@shared/lib/apiClient';
import { setDevUser, setOrganizationId } from '@shared/lib/apiIdentity';
import {
  archiveLeadForm,
  cloneLeadForm,
  createLeadFormLink,
  createMesaLead,
  getLeadForm,
  getLeadForms,
  getMesaLeads,
  getMesaSummary,
} from './api';
import { humanize, LEAD_STAGES } from './constants';
import FormBuilder from './FormBuilder';
import LeadDetail from './LeadDetail';
import type { LeadForm, LeadStage, LeadSummary, MesaLead } from './types';

type View = 'overview' | 'leads' | 'forms';

const inputClass = 'min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100';

const NAV: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'leads', label: 'All leads', icon: UsersRound },
  { id: 'forms', label: 'Questionnaires', icon: ClipboardList },
];

const OPEN_STAGES = new Set<LeadStage>(LEAD_STAGES.filter((stage) => !['won', 'lost'].includes(stage.id)).map((stage) => stage.id));

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
}

function stageLabel(stage: string): string {
  return LEAD_STAGES.find((item) => item.id === stage)?.label ?? humanize(stage);
}

function stageTone(stage: string): StatusTone {
  if (stage === 'won') return 'success';
  if (stage === 'lost') return 'error';
  if (['questionnaire_sent', 'mold_sourcing', 'follow_up'].includes(stage)) return 'warn';
  if (['requirements_received', 'technical_review', 'quotation'].includes(stage)) return 'info';
  return 'neutral';
}

function scopeLabel(scope: MesaLead['scope']): string {
  if (scope === 'machine_mold') return 'Machine + mold';
  if (scope === 'machine_only') return 'Machine only';
  if (scope === 'mold_only') return 'Mold only';
  return 'Not confirmed';
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'MesaLeads could not load. Please try again.';
}

type AccessFailure = 'session' | 'service';

function accessFailureFor(error: unknown): AccessFailure | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 401 || ['invalid_token', 'unauthenticated'].includes(error.code)) return 'session';
  if (error.status === 403 || ['service_not_enabled', 'service_required', 'forbidden'].includes(error.code)) return 'service';
  return null;
}

function latchAccessFailure(current: AccessFailure | null, incoming: AccessFailure): AccessFailure {
  // A session failure invalidates every organization, so it takes precedence
  // if concurrent protected requests report different access failures.
  return incoming === 'session' || !current ? incoming : current;
}

function MetricCard({ icon, label, value, detail, tone = 'blue' }: { icon: ReactNode; label: string; value: string; detail: string; tone?: 'blue' | 'amber' | 'emerald' | 'rose' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
  }[tone];
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colors}`}>{icon}</div>
      </div>
    </article>
  );
}

function NewLeadDialog({
  open,
  forms,
  onClose,
  onCreated,
}: {
  open: boolean;
  forms: LeadForm[];
  onClose: () => void;
  onCreated: (lead: MesaLead) => void;
}) {
  const publishedForms = forms.filter((form) => form.status === 'published');
  const [form, setForm] = useState({
    contactName: '', companyName: '', phone: '', email: '', source: 'direct', product: '', requirement: '', scope: 'machine_only', priority: 'medium', formId: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdLink, setCreatedLink] = useState('');
  const [createdLinkExpiresAt, setCreatedLinkExpiresAt] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const set = (key: keyof typeof form, value: string) => { setForm((current) => ({ ...current, [key]: value })); setError(''); };
  const selectedTemplate = publishedForms.find((item) => item.id === form.formId);
  const closeDialog = () => {
    // The journey URL is returned only by the atomic create response. Keep the
    // dialog open while that request is pending so the organization cannot
    // accidentally dismiss and lose the one-time secret.
    if (saving) return;
    setForm({ contactName: '', companyName: '', phone: '', email: '', source: 'direct', product: '', requirement: '', scope: 'machine_only', priority: 'medium', formId: '' });
    setCreatedLink('');
    setCreatedLinkExpiresAt(null);
    setLinkCopied(false);
    setError('');
    onClose();
  };
  const copyCreatedLink = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      setError('The link is ready below, but your browser blocked copying. Select and copy it manually.');
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!form.formId) {
      setError('Select a published questionnaire template before creating this lead.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await createMesaLead({
        contactName: form.contactName.trim(),
        companyName: form.companyName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        source: form.source,
        product: form.product.trim(),
        requirement: form.requirement.trim(),
        scope: form.scope as MesaLead['scope'],
        priority: form.priority as MesaLead['priority'],
        formId: form.formId,
        stage: 'new',
      });
      const url = `${window.location.origin}${result.link.publicPath || `/mesaleads/q/${result.link.token ?? ''}`}`;
      setCreatedLink(url);
      setCreatedLinkExpiresAt(result.link.expiresAt ?? null);
      onCreated(result.lead);
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveOverlay open={open} onClose={closeDialog} title={createdLink ? 'Lead created' : 'New lead'} wide>
      {createdLink ? (
        <div className="py-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-6 w-6" /></div>
          <h3 className="mt-4 text-lg font-extrabold text-slate-900">Customer journey link ready</h3>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">Share this private, lead-specific URL with the customer. They fill the selected questionnaire first, then return to this exact same URL for review status, quotations, follow-ups and delivery progress.</p>
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-left">
            <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Persistent customer URL</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-5 text-blue-900">{createdLink}</span>
              <button type="button" onClick={() => void copyCreatedLink()} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 text-xs font-bold text-white hover:bg-blue-800"><Clipboard className="h-4 w-4" /> {linkCopied ? 'Copied' : 'Copy link'}</button>
            </div>
          </div>
          {selectedTemplate && <p className="mt-3 text-xs text-slate-500">Questionnaire: <span className="font-bold text-slate-700">{selectedTemplate.name} · Rev {selectedTemplate.revision}</span></p>}
          <p className="mt-2 text-xs font-semibold text-amber-700">For security, this URL is shown only now. Copy it and share it securely.{createdLinkExpiresAt ? ` It expires ${new Date(createdLinkExpiresAt).toLocaleString('en-IN')}.` : ''}</p>
          {error && <div role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-xs font-semibold text-amber-900">{error}</div>}
          <div className="mt-5 flex flex-col-reverse justify-center gap-2 sm:flex-row"><button onClick={closeDialog} className="min-h-11 rounded-lg border border-slate-200 px-5 text-sm font-bold text-slate-600 hover:border-blue-300">Done</button><a href={createdLink} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-5 text-sm font-bold text-white hover:bg-blue-800">Preview customer page</a></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-800">{error}</div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="text-xs font-bold text-slate-700">Contact name *</span><input required value={form.contactName} onChange={(event) => set('contactName', event.target.value)} className={`mt-1.5 ${inputClass}`} /></label>
            <label><span className="text-xs font-bold text-slate-700">Company *</span><input required value={form.companyName} onChange={(event) => set('companyName', event.target.value)} className={`mt-1.5 ${inputClass}`} /></label>
            <label><span className="text-xs font-bold text-slate-700">Phone</span><input value={form.phone} onChange={(event) => set('phone', event.target.value)} className={`mt-1.5 ${inputClass}`} /></label>
            <label><span className="text-xs font-bold text-slate-700">Email</span><input type="email" value={form.email} onChange={(event) => set('email', event.target.value)} className={`mt-1.5 ${inputClass}`} /></label>
            <label><span className="text-xs font-bold text-slate-700">Source *</span><select value={form.source} onChange={(event) => set('source', event.target.value)} className={`mt-1.5 ${inputClass}`}><option value="direct">Direct</option><option value="indiamart">IndiaMART</option><option value="website">Website</option><option value="referral">Referral</option><option value="other">Other</option></select></label>
            <label><span className="text-xs font-bold text-slate-700">Scope</span><select value={form.scope} onChange={(event) => set('scope', event.target.value)} className={`mt-1.5 ${inputClass}`}><option value="machine_only">Machine only</option><option value="machine_mold">Machine + mold</option><option value="mold_only">Mold only</option></select></label>
            <label className="sm:col-span-2"><span className="text-xs font-bold text-slate-700">Product / broad requirement *</span><input required value={form.product} onChange={(event) => set('product', event.target.value)} className={`mt-1.5 ${inputClass}`} placeholder="What does the customer want to manufacture?" /></label>
            <label className="sm:col-span-2"><span className="text-xs font-bold text-slate-700">Discovery notes</span><textarea value={form.requirement} onChange={(event) => set('requirement', event.target.value)} rows={3} className={`mt-1.5 ${inputClass} resize-y`} /></label>
            <label className="sm:col-span-2"><span className="text-xs font-bold text-slate-700">Questionnaire template *</span><select required value={form.formId} onChange={(event) => set('formId', event.target.value)} className={`mt-1.5 ${inputClass}`}><option value="">Select a published questionnaire</option>{publishedForms.map((item) => <option key={item.id} value={item.id}>{item.name} · Rev {item.revision}</option>)}</select><span className="mt-1 block text-[11px] leading-5 text-slate-500">Required. MesaLeads creates one private URL for this lead. The customer uses it for the questionnaire and keeps using the same URL for every later update.</span></label>
            {selectedTemplate && <div className="sm:col-span-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5"><p className="text-xs font-bold text-blue-950">{selectedTemplate.name} · Revision {selectedTemplate.revision}</p><p className="mt-1 text-[11px] leading-5 text-blue-800">{selectedTemplate.questions?.filter((question) => question.type !== 'section').length ?? 0} customer questions. Only this published revision will be attached to the lead.</p></div>}
            {publishedForms.length === 0 && <div role="alert" className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold leading-5 text-amber-900">No published questionnaire is available. Publish a questionnaire template before creating a lead.</div>}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={closeDialog} disabled={saving} className="min-h-11 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50">Cancel</button><button type="submit" disabled={saving || publishedForms.length === 0 || !form.formId} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-5 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create lead & journey link</button></div>
        </form>
      )}
    </ResponsiveOverlay>
  );
}

export default function MesaLeadsApp() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>(() => {
    const hash = window.location.hash.replace('#', '') as View;
    return NAV.some((item) => item.id === hash) ? hash : 'overview';
  });
  const [mobileNav, setMobileNav] = useState(false);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | LeadStage>('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [editor, setEditor] = useState<{ form: LeadForm | null } | null>(null);
  const [loadingEditor, setLoadingEditor] = useState(false);
  const [notice, setNotice] = useState('');
  const [latchedAccessFailure, setLatchedAccessFailure] = useState<AccessFailure | null>(null);

  const summaryQ = useQuery({ queryKey: ['mesaleads', 'summary'], queryFn: getMesaSummary, enabled: !latchedAccessFailure });
  const leadsQ = useQuery({ queryKey: ['mesaleads', 'leads'], queryFn: getMesaLeads, enabled: !latchedAccessFailure });
  const formsQ = useQuery({ queryKey: ['mesaleads', 'forms'], queryFn: getLeadForms, enabled: !latchedAccessFailure });
  const leads = leadsQ.data ?? [];
  const forms = formsQ.data ?? [];

  useEffect(() => {
    document.title = 'MesaLeads · MesaOrigins';
    document.documentElement.classList.remove('dark');
  }, []);

  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryKey[0] !== 'mesaleads') return;
    const failure = accessFailureFor(event.query.state.error);
    if (failure) setLatchedAccessFailure((current) => latchAccessFailure(current, failure));
  }), [queryClient]);

  const navigate = (next: View) => {
    setView(next);
    setMobileNav(false);
    window.history.replaceState(null, '', `${window.location.pathname}#${next}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const filteredLeads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return leads.filter((lead) => (
      (stageFilter === 'all' || lead.stage === stageFilter) &&
      (sourceFilter === 'all' || lead.source === sourceFilter) &&
      (!normalized || [lead.leadNumber, lead.companyName, lead.contactName, lead.phone, lead.email, lead.product]
        .some((value) => String(value ?? '').toLowerCase().includes(normalized)))
    ));
  }, [leads, query, sourceFilter, stageFilter]);

  const computed = useMemo(() => {
    const now = Date.now();
    const open = leads.filter((lead) => OPEN_STAGES.has(lead.stage));
    const won = leads.filter((lead) => lead.stage === 'won');
    const closed = leads.filter((lead) => ['won', 'lost'].includes(lead.stage));
    return {
      total: leads.length,
      open: open.length,
      awaiting: leads.filter((lead) => lead.stage === 'questionnaire_sent').length,
      overdue: open.filter((lead) => lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < now).length,
      pipelineValue: open.reduce((sum, lead) => sum + Number(lead.quotationAmount ?? 0), 0),
      winRate: closed.length ? Math.round((won.length / closed.length) * 100) : 0,
      completionRate: leads.length ? Math.round((leads.filter((lead) => (lead.submissions?.length ?? 0) > 0).length / leads.length) * 100) : 0,
    };
  }, [leads]);

  const summary: LeadSummary = summaryQ.data ?? {};
  const closedFromSummary = (summary.kpis?.wonLeads ?? 0) + (summary.kpis?.lostLeads ?? 0);
  const kpis = {
    total: summary.kpis?.totalLeads ?? summary.kpis?.total ?? computed.total,
    open: summary.kpis?.openLeads ?? summary.kpis?.open ?? computed.open,
    awaiting: summary.kpis?.awaitingResponse ?? computed.awaiting,
    overdue: summary.kpis?.overdueFollowUps ?? computed.overdue,
    pipelineValue: summary.kpis?.openPipelineValue ?? summary.kpis?.pipelineValue ?? computed.pipelineValue,
    winRate: summary.kpis?.winRate ?? (closedFromSummary ? Math.round(((summary.kpis?.wonLeads ?? 0) / closedFromSummary) * 100) : computed.winRate),
    completionRate: summary.kpis?.questionnaireCompletionRate ?? computed.completionRate,
  };

  const stageCounts = useMemo(() => Object.fromEntries(LEAD_STAGES.map((stage) => [stage.id, leads.filter((lead) => lead.stage === stage.id).length])) as Record<LeadStage, number>, [leads]);
  const attention = useMemo(() => leads.filter((lead) => (
    lead.stage === 'questionnaire_sent' ||
    (lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < Date.now() && OPEN_STAGES.has(lead.stage))
  )).slice(0, 5), [leads]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['mesaleads'] });
  const signOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      window.localStorage.removeItem('erp_session');
      setDevUser('');
      setOrganizationId('');
      window.location.assign('/');
    }
  };
  const openForm = async (form?: LeadForm) => {
    if (!form) { setEditor({ form: null }); return; }
    if (form.questions?.length) { setEditor({ form }); return; }
    setLoadingEditor(true);
    try { setEditor({ form: await getLeadForm(form.id) }); } finally { setLoadingEditor(false); }
  };

  const createFormRevision = async (form: LeadForm) => {
    setLoadingEditor(true);
    setNotice('');
    try {
      setEditor({ form: await cloneLeadForm(form.id) });
      refresh();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setLoadingEditor(false);
    }
  };

  const copyFormLink = async (form: LeadForm) => {
    try {
      // Raw bearer tokens are intentionally returned only when a link is
      // created, so list metadata can never be reused as a public URL.
      const link = await createLeadFormLink(form.id, { kind: 'generic' });
      const url = `${window.location.origin}${link.publicPath || `/mesaleads/q/${link.token ?? ''}`}`;
      await navigator.clipboard.writeText(url);
      setNotice(`${form.name} link copied.`);
      window.setTimeout(() => setNotice(''), 2500);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const archiveQuestionnaire = async (form: LeadForm) => {
    if (!window.confirm(`Archive ${form.name}? All active customer links for this form will stop working.`)) return;
    setNotice('');
    try {
      await archiveLeadForm(form.id);
      setNotice(`${form.name} archived and its active links revoked.`);
      refresh();
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const loadError = summaryQ.error ?? leadsQ.error ?? formsQ.error;
  const detectedAccessFailure = useMemo(() => {
    for (const error of [summaryQ.error, leadsQ.error, formsQ.error]) {
      const failure = accessFailureFor(error);
      if (failure) return failure;
    }
    return null;
  }, [summaryQ.error, leadsQ.error, formsQ.error]);
  const accessFailure = latchedAccessFailure ?? detectedAccessFailure;
  const sessionExpired = accessFailure === 'session';

  useEffect(() => {
    if (!detectedAccessFailure) return;
    setLatchedAccessFailure((current) => latchAccessFailure(current, detectedAccessFailure));
  }, [detectedAccessFailure]);

  useEffect(() => {
    if (!latchedAccessFailure) return;
    void queryClient.cancelQueries({ queryKey: ['mesaleads'] });
    queryClient.removeQueries({ queryKey: ['mesaleads'] });
    setEditor(null);
    setSelectedLeadId(null);
    setNewLeadOpen(false);
    setLoadingEditor(false);
    setNotice('');
    setQuery('');
    if (latchedAccessFailure === 'session') {
      window.localStorage.removeItem('erp_session');
      setDevUser('');
      setOrganizationId('');
    }
  }, [latchedAccessFailure, queryClient]);

  if (accessFailure) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 font-sans">
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center sm:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Settings2 className="h-6 w-6" /></div>
          <h1 className="mt-5 text-xl font-extrabold text-slate-900">{sessionExpired ? 'Session expired' : 'MesaLeads is not assigned'}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{sessionExpired ? 'Sign in again to continue to your organization services.' : 'MesaLeads is not active for this organization. Return to your available services or ask a MesaOrigins administrator for access.'}</p>
          <div className="mt-5 flex justify-center gap-2"><a href="/login" className="inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 text-sm font-bold text-white">Back to sign in</a></div>
        </div>
      </div>
    );
  }

  if (editor) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 font-sans sm:p-6 lg:p-8">
        <div className="mx-auto max-w-[1500px]"><FormBuilder form={editor.form} onClose={() => { setEditor(null); refresh(); }} onSaved={() => refresh()} /></div>
      </div>
    );
  }

  if (loadError && leads.length === 0 && forms.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 font-sans">
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center sm:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Settings2 className="h-6 w-6" /></div>
          <h1 className="mt-5 text-xl font-extrabold text-slate-900">MesaLeads could not load</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{errorMessage(loadError)}</p>
          <div className="mt-5 flex justify-center gap-2"><a href="/login" className="inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 text-sm font-bold text-white">All services</a><button onClick={refresh} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-600"><RefreshCw className="h-4 w-4" /> Retry</button></div>
        </div>
      </div>
    );
  }

  const leadColumns = [
    { key: 'lead', header: 'Lead', mobile: 'title' as const, cell: (lead: MesaLead) => <div><p className="font-bold text-slate-900">{lead.companyName || lead.contactName}</p><p className="mt-0.5 font-mono text-[10px] text-slate-400">{lead.leadNumber}</p></div> },
    { key: 'requirement', header: 'Requirement', mobile: 'subtitle' as const, cell: (lead: MesaLead) => <div><p className="max-w-xs truncate text-sm font-semibold text-slate-700">{lead.product || 'Requirement not captured'}</p><p className="mt-0.5 text-[11px] text-slate-400">{scopeLabel(lead.scope)}</p></div> },
    { key: 'source', header: 'Source', cell: (lead: MesaLead) => <span className="text-xs font-semibold text-slate-600">{humanize(lead.source)}</span> },
    { key: 'stage', header: 'Stage', mobile: 'badge' as const, cell: (lead: MesaLead) => <StatusBadge tone={stageTone(lead.stage)}>{stageLabel(lead.stage)}</StatusBadge> },
    { key: 'followup', header: 'Next follow-up', cell: (lead: MesaLead) => lead.nextFollowUpAt ? <span className={new Date(lead.nextFollowUpAt).getTime() < Date.now() && OPEN_STAGES.has(lead.stage) ? 'font-bold text-rose-700' : 'text-xs text-slate-600'}>{formatTableDate(lead.nextFollowUpAt)}</span> : <span className="text-slate-300">—</span> },
    { key: 'value', header: 'Quote value', align: 'right' as const, cell: (lead: MesaLead) => <span className="text-xs font-bold tabular-nums text-slate-700">{lead.quotationAmount ? formatCurrency(lead.quotationAmount) : '—'}</span> },
    { key: 'open', header: '', mobile: 'action' as const, align: 'right' as const, cell: (lead: MesaLead) => <button onClick={() => setSelectedLeadId(lead.id)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-bold text-blue-700 hover:border-blue-300">Open <ChevronRight className="h-3.5 w-3.5" /></button> },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-700">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5"><Logo className="h-9 w-9" /><div><p className="font-extrabold leading-none text-slate-900">MesaLeads</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">by MesaOrigins</p></div><button onClick={() => setMobileNav(false)} className="ml-auto p-2 text-slate-400 lg:hidden" aria-label="Close navigation"><X className="h-5 w-5" /></button></div>
        <nav aria-label="MesaLeads navigation" className="flex-1 space-y-1 p-3">{NAV.map((item) => { const Icon = item.icon; const active = view === item.id; return <button key={item.id} onClick={() => navigate(item.id)} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold transition ${active ? 'bg-blue-50 text-blue-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}><Icon className="h-4 w-4" /> {item.label}{item.id === 'leads' && <span className="ml-auto rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{leads.length}</span>}</button>; })}</nav>
        <div className="border-t border-slate-200 p-3"><a href="/login" className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-500 hover:bg-slate-100"><Building2 className="h-4 w-4" /> All services</a><button type="button" onClick={() => void signOut()} className="mt-1 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-500 hover:bg-slate-100"><LogOut className="h-4 w-4" /> Sign out</button></div>
      </aside>
      {mobileNav && <button aria-label="Close navigation" onClick={() => setMobileNav(false)} className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" />}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8"><button onClick={() => setMobileNav(true)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{NAV.find((item) => item.id === view)?.label}</p><p className="mt-0.5 hidden text-xs text-slate-400 sm:block">Industrial lead qualification and RFQ workspace</p></div>{notice && <span role="status" className="hidden rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 md:block">{notice}</span>}<button onClick={() => setNewLeadOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-700 px-3.5 text-sm font-bold text-white hover:bg-blue-800"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">New lead</span></button></header>

        <main className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6 lg:p-8">
          {view === 'overview' && (
            <>
              <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><div className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-800"><Target className="h-3.5 w-3.5" /> Lead command center</div><h1 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900">Turn requirements into qualified RFQs</h1><p className="mt-1 max-w-2xl text-sm text-slate-500">Capture customer needs, coordinate machine and mold review, quote, and follow up from one workspace.</p></div><button onClick={refresh} className="inline-flex min-h-10 items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:border-blue-300"><RefreshCw className={`h-4 w-4 ${leadsQ.isFetching ? 'animate-spin' : ''}`} /> Refresh</button></section>
              <section aria-label="Lead summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard icon={<UsersRound className="h-5 w-5" />} label="Open leads" value={String(kpis.open)} detail={`${kpis.total} total captured`} /><MetricCard icon={<Send className="h-5 w-5" />} label="Questionnaire completion" value={`${kpis.completionRate}%`} detail={`${kpis.awaiting} awaiting response`} tone="amber" /><MetricCard icon={<TrendingUp className="h-5 w-5" />} label="Open quote value" value={formatCurrency(kpis.pipelineValue)} detail={`${kpis.winRate}% win rate`} tone="emerald" /><MetricCard icon={<BellRing className="h-5 w-5" />} label="Overdue follow-ups" value={String(kpis.overdue)} detail="Needs attention today" tone={kpis.overdue ? 'rose' : 'blue'} /></section>

              <section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5"><div><h2 className="text-sm font-bold text-slate-900">Pipeline</h2><p className="mt-0.5 text-[11px] text-slate-500">Every stage has a clear operational outcome.</p></div><button onClick={() => navigate('leads')} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700">View all <ArrowRight className="h-3.5 w-3.5" /></button></div><div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-5">{LEAD_STAGES.map((stage) => <button key={stage.id} onClick={() => { setStageFilter(stage.id); navigate('leads'); }} className="bg-white px-4 py-4 text-left transition hover:bg-blue-50"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{stage.short}</span><ChevronRight className="h-3.5 w-3.5 text-slate-300" /></div><p className="mt-2 text-2xl font-extrabold text-slate-900">{stageCounts[stage.id]}</p></button>)}</div></section>

              <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr),minmax(300px,0.6fr)]"><DataTable title="Recent leads" loading={leadsQ.isLoading} rows={leads.slice(0, 8)} rowKey={(lead) => lead.id} columns={leadColumns} onRowClick={(lead) => setSelectedLeadId(lead.id)} empty={<EmptyState icon={<UsersRound className="h-8 w-8" />} title="No leads yet" hint="Create a lead or publish a questionnaire to start capturing requirements." action={{ label: 'Create first lead', onClick: () => setNewLeadOpen(true) }} />} /><div className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-4 py-3"><h2 className="text-sm font-bold text-slate-900">Needs attention</h2><p className="mt-0.5 text-[11px] text-slate-500">Overdue actions and unanswered forms.</p></div><div className="divide-y divide-slate-100">{attention.length === 0 ? <EmptyState icon={<CheckCircle2 className="h-8 w-8" />} title="Nothing overdue" hint="Your active follow-ups are on schedule." /> : attention.map((lead) => <button key={lead.id} onClick={() => setSelectedLeadId(lead.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"><div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${lead.stage === 'questionnaire_sent' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{lead.stage === 'questionnaire_sent' ? <Send className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-slate-800">{lead.companyName || lead.contactName}</p><p className="mt-1 text-[11px] text-slate-500">{lead.stage === 'questionnaire_sent' ? 'Awaiting questionnaire response' : `Follow-up was due ${formatTableDate(lead.nextFollowUpAt)}`}</p></div><ChevronRight className="mt-2 h-4 w-4 text-slate-300" /></button>)}</div></div></section>
            </>
          )}

          {view === 'leads' && (
            <>
              <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-extrabold text-slate-900">All leads</h1><p className="mt-1 text-sm text-slate-500">Search, qualify and move requirements through the machine and mold workflow.</p></div><button onClick={() => setNewLeadOpen(true)} className="inline-flex min-h-10 items-center gap-2 self-start rounded-lg bg-blue-700 px-4 text-sm font-bold text-white"><Plus className="h-4 w-4" /> New lead</button></section>
              <section className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center"><label className="relative flex-1"><span className="sr-only">Search leads</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search lead, company, phone or product" className={`${inputClass} pl-9`} /></label><label className="relative"><span className="sr-only">Filter stage</span><Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as 'all' | LeadStage)} className={`${inputClass} min-w-48 pl-9`}><option value="all">All stages</option>{LEAD_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label><label><span className="sr-only">Filter source</span><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className={`${inputClass} min-w-36`}><option value="all">All sources</option><option value="direct">Direct</option><option value="indiamart">IndiaMART</option><option value="website">Website</option><option value="referral">Referral</option><option value="other">Other</option></select></label></section>
              <DataTable title="Lead pipeline" loading={leadsQ.isLoading} rows={filteredLeads} rowKey={(lead) => lead.id} columns={leadColumns} onRowClick={(lead) => setSelectedLeadId(lead.id)} empty={<EmptyState icon={<ListFilter className="h-8 w-8" />} title={leads.length ? 'No leads match these filters' : 'No leads yet'} hint={leads.length ? 'Clear a filter or try another search.' : 'Create a lead or publish a questionnaire to start your pipeline.'} />} />
            </>
          )}

          {view === 'forms' && (
            <>
              <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-extrabold text-slate-900">Questionnaires</h1><p className="mt-1 text-sm text-slate-500">Create typed, conditional customer forms and publish secure links.</p></div><button onClick={() => void openForm()} className="inline-flex min-h-10 items-center gap-2 self-start rounded-lg bg-blue-700 px-4 text-sm font-bold text-white"><Plus className="h-4 w-4" /> New questionnaire</button></section>
              {formsQ.isLoading || loadingEditor ? <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-20 text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-700" /> Loading questionnaires…</div> : forms.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white"><EmptyState icon={<ClipboardList className="h-9 w-9" />} title="Build your first customer questionnaire" hint="Start with the IMM requirement template based on your paper process, then customize every question." action={{ label: 'Create IMM questionnaire', onClick: () => void openForm() }} /></div> : <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{forms.map((form) => <article key={form.id} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><FileText className="h-5 w-5" /></div><StatusBadge tone={form.status === 'published' ? 'success' : form.status === 'draft' ? 'warn' : 'neutral'}>{humanize(form.status)}</StatusBadge></div><h2 className="mt-4 text-base font-extrabold text-slate-900">{form.name}</h2><p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-slate-500">{form.description}</p><dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3"><div><dt className="text-[9px] font-bold uppercase text-slate-400">Revision</dt><dd className="mt-1 text-xs font-bold text-slate-700">{form.revision}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Questions</dt><dd className="mt-1 text-xs font-bold text-slate-700">{form.questions?.filter((question) => question.type !== 'section').length ?? '—'}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Responses</dt><dd className="mt-1 text-xs font-bold text-slate-700">{form._count?.submissions ?? 0}</dd></div></dl><div className="mt-4 flex gap-2"><button onClick={() => void (form.status === 'draft' ? openForm(form) : createFormRevision(form))} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:border-blue-300"><Settings2 className="h-4 w-4" /> {form.status === 'draft' ? 'Edit draft' : 'New version'}</button>{form.status === 'published' && <button onClick={() => void copyFormLink(form)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-700 text-xs font-bold text-white hover:bg-blue-800"><Clipboard className="h-4 w-4" /> Copy link</button>}{form.status !== 'archived' && <button onClick={() => void archiveQuestionnaire(form)} aria-label={`Archive ${form.name}`} title="Archive and revoke links" className="inline-flex min-h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"><Archive className="h-4 w-4" /></button>}</div></article>)}</div>}
            </>
          )}
        </main>
      </div>

      <NewLeadDialog open={newLeadOpen} forms={forms} onClose={() => setNewLeadOpen(false)} onCreated={() => refresh()} />
      <LeadDetail leadId={selectedLeadId} forms={forms} onClose={() => setSelectedLeadId(null)} onUpdated={() => refresh()} />
    </div>
  );
}
