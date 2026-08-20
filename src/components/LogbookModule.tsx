/**
 * LogbookModule.tsx — "Production (LOG BOOK)" feature.
 *
 * Operator tab (desktop md+): two-column workspace — QR/MFG/013 sheet (or Guided
 * preview) on the left, fill panel / GuidedWizard on the right. Both bind to one
 * `activeLogbook` via shared handlers.
 *
 * Operator tab (narrow): thumb-first MobileLogEntry section cards only — no paper
 * sheet or GuidedWizard in the main column. Optional sheet preview via BottomSheet.
 *
 * Admin tab: pragmatic editor for the seeded template's per-product specs.
 * Full generalization of the template builder is deferred — see SPEC_LOGBOOK.md.
 */

import React, { useState, useEffect, useRef, useContext, createContext, useCallback } from 'react';
import { FileSpreadsheet, Save, RotateCcw, CheckCircle2, Eye, ChevronDown, Lock, Plus, Trash2, AlertTriangle, CalendarClock, X, Wand2, ArrowLeft, ArrowRight, Printer, MoreHorizontal } from 'lucide-react';
import { LogbookTemplate, MachineLogbook, ProductionPlan, SalesOrder, RollRecord } from '../types';
import MachineLogBookSheet, { LogbookHandlers } from './MachineLogBookSheet';
import GuidedPreviewSheet from './GuidedPreviewSheet';
import MobileLogEntry from './MobileLogEntry';
import BottomSheet from './ui/BottomSheet';
import PageHeader from './ui/PageHeader';
import { StatusBadge } from './ui/StatusBadge';
import { pushToast } from './Notify';
import { ApiError } from '../lib/apiClient';
import { useLogbookTemplates, useLogbookPlans, useLogbookFormulas, useOpenLogbook, useSaveLogbook, useSubmitLogbook } from '../lib/queries/logbook';
import { useDirectory } from '../lib/queries/admin';
import { useIsNarrow } from '../hooks/useIsNarrow';
import { isInvalidNumber, isOutOfRange, sanitizeDecimal, sanitizeMeter, summarizeLogbookIssues, validateLogbookForSubmit, normalizeLogbookFormats, normalizeDate, normalizeTime, isInvalidDate, isInvalidTime, isInvalidMeter, type LogbookFieldIssue } from '../lib/logbookValidation';

interface LogbookModuleProps {
  templates: LogbookTemplate[];
  setTemplates: React.Dispatch<React.SetStateAction<LogbookTemplate[]>>;
  machineLogbooks: MachineLogbook[];
  setMachineLogbooks: React.Dispatch<React.SetStateAction<MachineLogbook[]>>;
  productionPlans: ProductionPlan[];
  salesOrders: SalesOrder[];
  initialTab?: 'operator' | 'admin';
  initialPlanId?: string;
  /** page = full module; sheet = compact fill UI for bottom sheets. */
  presentation?: 'page' | 'sheet';
  /** Mobile section chrome — accordion used inside bottom-sheet log entry. */
  mobileLayout?: 'pager' | 'accordion';
  /** Full-screen log entry — hide app chrome; show back on the log header. */
  immersive?: boolean;
  onLeave?: () => void;
}

/* ---------------------------------------------------------------- helpers */

const todayISO = (): string => new Date().toISOString().split('T')[0];

function blankLogbook(t: LogbookTemplate, plan?: ProductionPlan): MachineLogbook {
  const traceLen = t.traceability.tableCount * t.traceability.rowsPerTable;
  return {
    id: `log-${Date.now()}`,
    productionPlanId: plan?.id ?? '',
    templateId: t.id,
    status: 'draft',
    rolls: [],
    scrapKg: '',
    operatorSignature: plan?.operatorName && !plan.operatorName.startsWith('(') ? plan.operatorName : '',
    supervisorSignature: '',
    machineId: plan?.machineId ?? '',
    date: todayISO(),
    shift: t.shifts[0] ?? 'A',
    supervisor: '',
    drawingNo: '',
    tag: '',
    formulaNo: '',
    dieZoneTemps: Object.fromEntries(t.dieZones.map((z) => [z, ''])),
    barrelZoneTemps: Object.fromEntries(t.barrelZones.map((z) => [z, ''])),
    motorSpeed: '',
    ampere: '',
    takeupSpeed: '',
    vacuum: '',
    extruderStartTime: '',
    productSetTime: '',
    shoreHardness: '',
    productionPerHour: '',
    moldNo: '',
    productName: t.productName,
    coilWeights: Array.from({ length: t.coil.count }, () => ''),
    hourlyInspections: t.inspectionTimeSlots.map((slot) => ({
      timeSlot: slot,
      topDim: '',
      bottomDim: '',
      thickness: Array.from({ length: t.dimensionSpecs.thickness.count }, () => ''),
      finish: '',
      perMeter: '',
      colour: '',
      tearing: '',
      inspectionBy: ''
    })),
    traceabilityRows: Array.from({ length: traceLen }, () => ({ lotNumber: '', colour: '', code: '', winderPackedBy: '' })),
    totalRollsProduced: '',
    totalRollKgs: '',
    processWasteKg: '',
    lumpsWasteKg: '',
    rejectionKg: '',
    totalConsumedKg: '',
    rejectionCounts: Object.fromEntries(t.rejectionReasons.map((r) => [r, ''])),
    meterCheckedBy: '',
    meterCheckTime: '',
    meter: '',
    meterCountSet: ''
  };
}

// Fill in fields that older persisted logbooks may lack, so the new register/sign-off
// code never hits undefined.
function hydrate(lb: MachineLogbook): MachineLogbook {
  return normalizeLogbookFormats({
    ...lb,
    rolls: lb.rolls ?? [],
    scrapKg: lb.scrapKg ?? '',
    operatorSignature: lb.operatorSignature ?? '',
    supervisorSignature: lb.supervisorSignature ?? '',
    attachedImage: lb.attachedImage ?? undefined,
  });
}

// Which numbered section a field key belongs to (drives the band/group highlight).
function sectionOfField(f?: string | null): number {
  if (!f) return 1;
  if (f.startsWith('coil') || f.startsWith('hourly')) return 2;
  if (f.startsWith('trace')) return 3;
  if (f.startsWith('rej:') || ['totalRollsProduced', 'totalRollKgs', 'processWasteKg', 'lumpsWasteKg', 'rejectionKg', 'totalConsumedKg', 'meterCheckedBy', 'meterCheckTime', 'meter', 'meterCountSet'].includes(f)) return 4;
  return 1;
}

// First field of a section — used when a section band/header is clicked.
function firstFieldOfSection(n: number): string {
  if (n === 2) return 'coil:0';
  if (n === 3) return 'trace:0:lotNumber';
  if (n === 4) return 'totalRollsProduced';
  return 'machineId';
}

const inputCls = 'w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white';

/* Selection context so panel fields can highlight/scroll the active input and
 * report focus without threading props through every field. */
interface PanelFieldCtxValue {
  active?: string | null;
  select?: (f: string) => void;
  setActiveEl?: (el: HTMLElement | null) => void;
  locked?: boolean;
}
const PanelFieldCtx = createContext<PanelFieldCtxValue>({});

function PText({ label, value, onChange, ph, field, lo, hi, readOnly, numeric, kind = 'text' }: { label: string; value: string; onChange: (v: string) => void; ph?: string; field?: string; lo?: number; hi?: number; readOnly?: boolean; numeric?: boolean; kind?: 'text' | 'number' | 'date' | 'time' | 'meter' }) {
  const { active, select, setActiveEl, locked } = useContext(PanelFieldCtx);
  const isActive = field != null && field === active;
  const mode = kind === 'number' || numeric || (lo != null && hi != null) ? (kind === 'date' || kind === 'time' || kind === 'meter' ? kind : 'number') : kind;
  const display =
    mode === 'date' ? normalizeDate(value)
      : mode === 'time' ? normalizeTime(value)
        : (value ?? '');
  const badType =
    (mode === 'number' && isInvalidNumber(value))
    || (mode === 'date' && isInvalidDate(value))
    || (mode === 'time' && isInvalidTime(value))
    || (mode === 'meter' && isInvalidMeter(value));
  const ranged = lo != null && hi != null && hi > lo;
  const oor = !badType && mode === 'number' && ranged && isOutOfRange(value, lo, hi);
  const inputType = mode === 'date' ? 'date' : mode === 'time' ? 'time' : 'text';
  return (
    <label className={`flex flex-col gap-0.5 rounded ${isActive ? 'ring-2 ring-indigo-500 bg-indigo-50/70 p-1 -m-0.5' : ''}`}>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}{ranged ? <span className="text-slate-400 font-normal normal-case"> ({lo}–{hi})</span> : null}</span>
      <input
        ref={isActive && setActiveEl ? setActiveEl : undefined}
        type={inputType}
        className={`${inputCls}${oor || badType ? ' border-amber-400 bg-amber-50 text-amber-700 font-bold' : ''}${readOnly ? ' bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
        value={display}
        placeholder={ph ?? (mode === 'meter' ? 'e.g. 154/M' : undefined)}
        inputMode={mode === 'number' ? 'decimal' : undefined}
        readOnly={locked || readOnly}
        onFocus={() => { if (field) select?.(field); }}
        onChange={(e) => {
          const raw = e.target.value;
          if (mode === 'number') onChange(sanitizeDecimal(raw));
          else if (mode === 'date') onChange(normalizeDate(raw));
          else if (mode === 'time') onChange(normalizeTime(raw));
          else if (mode === 'meter') onChange(sanitizeMeter(raw));
          else onChange(raw);
        }}
      />
    </label>
  );
}

function PSelect({ label, value, onChange, options, field, readOnly }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[]; field?: string; readOnly?: boolean }) {
  const { active, select, setActiveEl, locked } = useContext(PanelFieldCtx);
  const isActive = field != null && field === active;
  const disabled = locked || !!readOnly;
  return (
    <label className={`flex flex-col gap-0.5 rounded ${isActive ? 'ring-2 ring-indigo-500 bg-indigo-50/70 p-1 -m-0.5' : ''}`}>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        ref={isActive && setActiveEl ? setActiveEl : undefined}
        className={inputCls}
        value={value ?? ''}
        disabled={disabled}
        onFocus={() => { if (field) select?.(field); }}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

/* ---------------------------------------------------------------- component */

export default function LogbookModule({
  templates,
  setTemplates,
  machineLogbooks,
  setMachineLogbooks,
  productionPlans,
  salesOrders,
  initialTab = 'operator',
  initialPlanId,
  presentation = 'page',
  mobileLayout = 'accordion',
  immersive = false,
  onLeave,
}: LogbookModuleProps) {
  const [activeTab, setActiveTab] = useState<'operator' | 'admin'>(initialTab);
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

  // Operator data comes from the API (tenant-scoped): templates, the scheduled-
  // plan gate, and the logbook (opened per plan). The admin tab still edits the
  // prop templates.
  const templatesQ = useLogbookTemplates();
  const plansQ = useLogbookPlans();
  const formulasQ = useLogbookFormulas();
  const directoryQ = useDirectory(activeTab === 'operator');
  const openLb = useOpenLogbook();
  const saveLb = useSaveLogbook();
  const submitLb = useSubmitLogbook();
  const apiTemplates = templatesQ.data ?? [];
  const scheduledPlans = plansQ.data ?? []; // API returns scheduled/running plans
  // Formula No is picked from the tenant's active formulations (BOM), e.g. "RF03 · Rev 2".
  const formulaOptions = (formulasQ.data ?? []).map((f) => `${f.code} · Rev ${f.rev}`);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id ?? '');
  const adminTemplate = templates.find((x) => x.id === selectedTemplateId) ?? templates[0];

  const [selectedPlanId, setSelectedPlanId] = useState<string>(initialPlanId ?? '');
  useEffect(() => {
    // Standalone LOG BOOK screen has no picker: default to the LATEST scheduled plan
    // (list is scheduledStartDate asc, so the last element). Machine Tasks passes initialPlanId.
    if (!selectedPlanId && (initialPlanId || scheduledPlans[0])) setSelectedPlanId(initialPlanId || scheduledPlans[scheduledPlans.length - 1].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledPlans.length]);

  const [activeLogbook, setActiveLogbook] = useState<MachineLogbook>(() => blankLogbook({ ...FALLBACK_TEMPLATE }));

  const [activeField, setActiveField] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<boolean>(false);
  const [err, setErr] = useState<string>('');
  const [submitIssues, setSubmitIssues] = useState<LogbookFieldIssue[]>([]);
  const [mode, setMode] = useState<'sheet' | 'guided'>('guided');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const isNarrow = useIsNarrow();
  const sheetMode = presentation === 'sheet';
  const useMobileFill = isNarrow || sheetMode;
  const fillLayout = sheetMode ? (mobileLayout === 'pager' ? 'pager' : 'accordion') : mobileLayout;
  const activeSection = sectionOfField(activeField);

  // The active panel input registers itself here so we can scroll it into view.
  const panelActiveElRef = useRef<HTMLElement | null>(null);
  const setActiveEl = useCallback((el: HTMLElement | null) => { if (el) panelActiveElRef.current = el; }, []);
  const selectField = useCallback((f: string) => setActiveField(f), []);
  useEffect(() => {
    if (activeField) panelActiveElRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeField]);

  // Open (get-or-create) the logbook for the selected scheduled plan.
  useEffect(() => {
    if (!selectedPlanId) return;
    setActiveField(null); setErr(''); setSubmitIssues([]);
    openLb.mutate(selectedPlanId, {
      onSuccess: (lb) => setActiveLogbook(hydrate(lb)),
      onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not open this logbook.'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanId]);

  const operatorTemplate = apiTemplates.find((x) => x.id === activeLogbook.templateId) ?? apiTemplates[0];
  const t: LogbookTemplate = (activeTab === 'admin' ? adminTemplate : operatorTemplate) ?? adminTemplate ?? apiTemplates[0] ?? { ...FALLBACK_TEMPLATE };
  const employeeOptions = Array.from(new Set((directoryQ.data ?? []).map((e) => e.name.trim()).filter(Boolean)));
  const peopleOptions = employeeOptions.length > 0 ? employeeOptions : t.supervisors;
  const isPipe = (t.layout ?? 'coil') === 'pipe';

  /* --- shared edit handlers (used by both the sheet and the fill panel) --- */
  const on: LogbookHandlers = {
    scalar: (key, v) => setActiveLogbook((p) => ({ ...p, [key]: v } as MachineLogbook)),
    dieZone: (z, v) => setActiveLogbook((p) => ({ ...p, dieZoneTemps: { ...p.dieZoneTemps, [z]: v } })),
    barrelZone: (z, v) => setActiveLogbook((p) => ({ ...p, barrelZoneTemps: { ...p.barrelZoneTemps, [z]: v } })),
    coil: (i, v) => setActiveLogbook((p) => { const a = [...p.coilWeights]; a[i] = v; return { ...p, coilWeights: a }; }),
    hourly: (i, f, v) => setActiveLogbook((p) => ({ ...p, hourlyInspections: p.hourlyInspections.map((r, idx) => (idx === i ? { ...r, [f]: v } : r)) })),
    hourlyThickness: (i, j, v) => setActiveLogbook((p) => ({
      ...p,
      hourlyInspections: p.hourlyInspections.map((r, idx) => {
        if (idx !== i) return r;
        const th = [...r.thickness]; th[j] = v; return { ...r, thickness: th };
      })
    })),
    trace: (i, f, v) => setActiveLogbook((p) => ({ ...p, traceabilityRows: p.traceabilityRows.map((r, idx) => (idx === i ? { ...r, [f]: v } : r)) })),
    rejection: (reason, v) => setActiveLogbook((p) => ({ ...p, rejectionCounts: { ...p.rejectionCounts, [reason]: v } }))
  };

  const locked = activeLogbook.status === 'submitted';

  // Recompute the production-report mass-balance from the roll register + start-up scrap.
  const withDerived = (lb: MachineLogbook): MachineLogbook => {
    const total = lb.rolls.reduce((s, r) => s + (r.weight || 0), 0);
    const rej = lb.rolls.filter((r) => r.status === 'failed').reduce((s, r) => s + (r.weight || 0), 0);
    const scrap = Number.parseFloat(lb.scrapKg) || 0;
    return {
      ...lb,
      totalRollsProduced: String(lb.rolls.length),
      totalRollKgs: total ? total.toFixed(1) : '',
      rejectionKg: rej ? rej.toFixed(1) : '',
      totalConsumedKg: total + scrap ? (total + scrap).toFixed(1) : ''
    };
  };

  const addRoll = (r: RollRecord) => { if (locked) return; setActiveLogbook((p) => withDerived({ ...p, rolls: [...p.rolls, r] })); };
  const removeRoll = (i: number) => { if (locked) return; setActiveLogbook((p) => withDerived({ ...p, rolls: p.rolls.filter((_, idx) => idx !== i) })); };
  const setScrap = (v: string) => setActiveLogbook((p) => withDerived({ ...p, scrapKg: v }));

  const passedKg = activeLogbook.rolls.filter((r) => r.status === 'passed').reduce((s, r) => s + (r.weight || 0), 0);
  const failedKg = activeLogbook.rolls.filter((r) => r.status === 'failed').reduce((s, r) => s + (r.weight || 0), 0);

  const handleSubmit = () => {
    if (locked || saveLb.isPending) return;
    // Submit = save progress only. Empty / partial data is allowed.
    setSubmitIssues([]);
    setErr('');
    const id = activeLogbook.id;
    saveLb.mutate({ id, patch: activeLogbook as Partial<MachineLogbook> }, {
      onSuccess: () => {
        pushToast(`Draft saved for Machine ${activeLogbook.machineId || '—'}.`);
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 2500);
      },
      onError: (e) => setErr(e instanceof ApiError ? e.message : 'Save failed.'),
    });
  };

  const handleClose = () => {
    if (locked || submitLb.isPending) return;
    const issues = validateLogbookForSubmit(activeLogbook, t);
    if (issues.length) {
      setSubmitIssues(issues);
      setErr(summarizeLogbookIssues(issues));
      const first = issues[0]?.field;
      if (first) setActiveField(first);
      return;
    }
    setSubmitIssues([]);
    setErr('');
    const id = activeLogbook.id;
    // Persist latest edits, then finalize + lock on the server.
    saveLb.mutate({ id, patch: activeLogbook as Partial<MachineLogbook> }, {
      onSuccess: () => submitLb.mutate(id, {
        onSuccess: (lb) => {
          setActiveLogbook(hydrate(lb));
          pushToast(`Shift logbook for Machine ${lb.machineId || '—'} closed and locked.`);
          setSavedFlash(true);
          window.setTimeout(() => setSavedFlash(false), 2500);
        },
        onError: (e) => { setErr(e instanceof ApiError ? e.message : 'Close failed.'); window.setTimeout(() => setErr(''), 4000); },
      }),
      onError: (e) => setErr(e instanceof ApiError ? e.message : 'Save failed.'),
    });
  };

  // Revert local edits to the last saved server state for this plan.
  const handleNew = () => { if (locked) return; openLb.mutate(selectedPlanId, { onSuccess: (lb) => setActiveLogbook(hydrate(lb)) }); setActiveField(null); setErr(''); setSubmitIssues([]); };

  const filledCoils = activeLogbook.coilWeights.filter((c) => c.trim() !== '').length;
  const filledTrace = activeLogbook.traceabilityRows.filter((r) => r.lotNumber.trim() !== '').length;
  const filledHourly = activeLogbook.hourlyInspections.filter((r) =>
    [r.topDim, r.bottomDim, r.finish, r.colour, r.inspectionBy, r.od, r.weight, r.okNotOk].some((v) => (v ?? '').toString().trim() !== '')
    || (r.thickness ?? []).some((v) => (v ?? '').trim() !== '')
  ).length;
  const currentPlan = scheduledPlans.find((p) => p.id === selectedPlanId);

  /* ---------------------------------------------------------------- render */
  return (
    <div className="space-y-3">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .logbook-print-scope, .logbook-print-scope * { visibility: visible !important; }
          .logbook-print-scope {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            background: #fff !important;
          }
          .logbook-print-hide { display: none !important; }
        }
      `}</style>
      {/* Tab switch */}
      {activeTab === 'operator' ? (
        plansQ.isLoading ? (
          <div className="p-10 text-center text-sm text-slate-400">Loading scheduled extruders…</div>
        ) : scheduledPlans.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 max-w-lg mx-auto mt-8 text-center space-y-4" id="logbook-no-schedule">
            <div className="mx-auto h-14 w-14 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center border border-amber-100 dark:border-amber-900/40">
              <CalendarClock className="h-7 w-7 text-amber-600" />
            </div>
            <h3 className="font-sans text-lg font-bold text-slate-900 dark:text-white">No extruder scheduled</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">A shift logbook can only be started for a machine Planning has scheduled. Ask the Production Planner to plan an order onto a line — it will appear here the moment it's scheduled.</p>
          </div>
        ) : (
        <>
          {useMobileFill ? (
            /* —— Mobile / sheet: section-card entry only (no paper sheet, no guided wizard) —— */
            <div className={`logbook-print-hide space-y-3 ${
              sheetMode
                ? 'pb-2'
                : immersive
                  ? 'px-4 pt-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))]'
                  : 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]'
            }`}>
              {!sheetMode && (
              <PageHeader
                sticky={immersive}
                className={immersive ? 'mx-0 px-4 lg:px-4' : undefined}
                title={currentPlan ? `Machine ${currentPlan.machine.code}` : activeLogbook.machineId || 'Log book'}
                subtitle={
                  currentPlan
                    ? `${currentPlan.shift === 'D' ? 'Day' : 'Night'} · ${currentPlan.salesOrder?.soNumber ?? 'no order'} · ${currentPlan.scheduledStartDate.split('T')[0]}`
                    : `${activeLogbook.date || '—'} · shift ${activeLogbook.shift || '—'}`
                }
                onBack={immersive ? onLeave : undefined}
                backLabel="Tasks"
                actions={
                  <>
                    <StatusBadge tone={locked ? 'success' : 'warn'}>
                      {locked ? <><Lock className="h-3 w-3" /> Closed</> : 'Draft'}
                    </StatusBadge>
                    <button
                      type="button"
                      onClick={() => setMobileMoreOpen(true)}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                      aria-label="More actions"
                    >
                      <MoreHorizontal className="h-5 w-5" />
                    </button>
                  </>
                }
              />
              )}

              {(err || savedFlash) && (
                <div className="flex flex-wrap items-center gap-2 px-0.5">
                  {err && <span className="inline-flex items-center gap-1 text-[13px] font-medium text-rose-600"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {err}</span>}
                  {savedFlash && <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Saved</span>}
                </div>
              )}

              {submitIssues.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3" role="alert">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-amber-900">Fix these before closing</p>
                      <ul className="mt-1.5 max-h-28 space-y-1 overflow-y-auto">
                        {submitIssues.slice(0, 8).map((issue) => (
                          <li key={`${issue.field}:${issue.message}`}>
                            <button type="button" onClick={() => setActiveField(issue.field)} className="text-left text-[12px] text-amber-800 hover:underline">
                              <span className="font-medium">{issue.label}</span>
                              {' — '}
                              {issue.message}
                            </button>
                          </li>
                        ))}
                        {submitIssues.length > 8 && <li className="text-[12px] text-amber-700">+{submitIssues.length - 8} more</li>}
                      </ul>
                    </div>
                    <button type="button" onClick={() => setSubmitIssues([])} className="shrink-0 text-amber-500 hover:text-amber-700" aria-label="Dismiss">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {locked && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Machine</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">{activeLogbook.machineId || currentPlan?.machine.code || '—'}</div>
                    <div className="text-[12px] text-slate-500">{currentPlan?.salesOrder?.product ?? activeLogbook.productName ?? '—'}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Production</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">{activeLogbook.totalRollKgs || '0'} kg</div>
                    <div className="text-[12px] text-slate-500">{activeLogbook.totalRollsProduced || '0'} rolls</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Shift</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">{activeLogbook.date || '—'} · {activeLogbook.shift || '—'}</div>
                    <div className="text-[12px] text-slate-500">{activeLogbook.supervisor || currentPlan?.operatorName || 'No supervisor'}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Completion</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">{filledHourly}/{activeLogbook.hourlyInspections.length} checks</div>
                    <div className="text-[12px] text-slate-500">{filledCoils} coils · {filledTrace} trace</div>
                  </div>
                </div>
              )}

              {!locked && (
                <MobileLogEntry
                  logbook={activeLogbook}
                  template={t}
                  on={on}
                  locked={locked}
                  headerLocked={!!activeLogbook.productionPlanId}
                  formulaOptions={formulaOptions}
                  employeeOptions={peopleOptions}
                  addRoll={addRoll}
                  removeRoll={removeRoll}
                  setScrap={setScrap}
                  onSelectField={selectField}
                  focusField={activeField}
                  layout={fillLayout}
                />
              )}

              {locked && (
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[14px] font-semibold text-slate-700"
                >
                  <Eye className="h-4 w-4" /> Preview paper sheet
                </button>
              )}

              {!locked && (
                <div className={sheetMode
                  ? 'sticky bottom-0 z-10 -mx-1 border-t border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur-sm'
                  : immersive
                    ? 'fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] backdrop-blur-sm'
                    : 'fixed inset-x-0 bottom-[calc(48px+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur-sm md:hidden'}>
                  <div className="mx-auto flex max-w-lg gap-2">
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={locked || saveLb.isPending}
                      className="inline-flex flex-1 min-h-11 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 text-[15px] font-semibold text-white disabled:opacity-40"
                    >
                      <Save className="h-4 w-4" /> Save
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      disabled={locked || submitLb.isPending}
                      className="inline-flex flex-1 min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white text-[15px] font-semibold text-slate-800 disabled:opacity-40"
                    >
                      <Lock className="h-4 w-4" /> Close
                    </button>
                  </div>
                </div>
              )}

              <BottomSheet open={mobileMoreOpen} onClose={() => setMobileMoreOpen(false)} title="Actions">
                <div className="space-y-2 pb-2">
                  <button type="button" onClick={() => { setMobileMoreOpen(false); setPreviewOpen(true); }} className="flex w-full min-h-11 items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium text-slate-800 hover:bg-slate-50">
                    <Eye className="h-5 w-5 text-slate-500" /> Preview sheet
                  </button>
                  <button type="button" onClick={() => { setMobileMoreOpen(false); setPreviewOpen(true); window.setTimeout(() => window.print(), 300); }} className="flex w-full min-h-11 items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium text-slate-800 hover:bg-slate-50">
                    <Printer className="h-5 w-5 text-slate-500" /> Print
                  </button>
                  {!locked && (
                    <button type="button" onClick={() => { setMobileMoreOpen(false); handleNew(); }} className="flex w-full min-h-11 items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium text-slate-800 hover:bg-slate-50">
                      <RotateCcw className="h-5 w-5 text-slate-500" /> Clear draft
                    </button>
                  )}
                </div>
              </BottomSheet>

              <BottomSheet open={previewOpen} onClose={() => setPreviewOpen(false)} title="Sheet preview" wide className="max-h-[92vh]">
                <div className="logbook-print-scope -mx-1 overflow-x-auto pb-4">
                  <MachineLogBookSheet
                    logbook={activeLogbook}
                    template={t}
                    on={on}
                    readOnly
                    headerLocked={!!activeLogbook.productionPlanId}
                    activeSection={0}
                    onSelectSection={() => {}}
                    activeField={null}
                    onSelectField={() => {}}
                    formulaOptions={formulaOptions}
                    employeeOptions={peopleOptions}
                  />
                </div>
              </BottomSheet>
            </div>
          ) : (
            /* —— Desktop: sheet | guided two-column workspace —— */
            <>
          {/* Toolbar — plan context + sheet/guided + print / submit / close */}
          <div className="logbook-print-hide flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-3 py-3">
            <div className="flex items-center gap-3 min-w-0">
              {immersive && onLeave && (
                <button
                  type="button"
                  onClick={onLeave}
                  className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-sky-600 hover:bg-slate-50 hover:text-sky-700 sm:px-3"
                  aria-label="Back to tasks"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden text-sm font-medium sm:inline">Tasks</span>
                </button>
              )}
              <span className="inline-flex items-center gap-2 text-[13px] font-medium text-slate-700 truncate">
                <FileSpreadsheet className="w-4 h-4 text-indigo-500 shrink-0" />
                {currentPlan ? <>Machine {currentPlan.machine.code} · {currentPlan.shift === 'D' ? 'Day' : 'Night'} shift · {currentPlan.salesOrder?.soNumber ?? 'no order'} · {currentPlan.scheduledStartDate.split('T')[0]}</> : 'Production log book'}
              </span>
              <StatusBadge tone={locked ? 'success' : 'warn'}>
                {locked ? <><Lock className="w-3 h-3" /> Closed</> : 'Draft'}
              </StatusBadge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {err && <span className="inline-flex items-center gap-1 text-[12px] font-medium text-rose-600 max-w-[200px] truncate" title={err}><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {err}</span>}
              {savedFlash && <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Saved</span>}
            {!locked && (
                <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                  <button type="button" onClick={() => setMode('sheet')} className={`inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium ${mode === 'sheet' ? 'border border-slate-200 bg-white text-[#1E40AF]' : 'text-slate-500 hover:text-slate-700'}`}><FileSpreadsheet className="h-3.5 w-3.5" /> Sheet</button>
                  <button type="button" onClick={() => setMode('guided')} className={`inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium ${mode === 'guided' ? 'bg-[#1E40AF] text-white' : 'text-slate-500 hover:text-slate-700'}`}><Wand2 className="h-3.5 w-3.5" /> Guided</button>
                </div>
              )}
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-[12px] font-medium text-slate-600 border border-slate-200 bg-white hover:bg-slate-50"
                title="Print the sheet"
              >
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
              {!locked && (
                <>
                  <button type="button" onClick={handleNew} disabled={locked} className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-[12px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"><RotateCcw className="w-3.5 h-3.5" /> Clear draft</button>
                  <button type="button" onClick={handleSubmit} disabled={locked || saveLb.isPending} className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-[12px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed" title="Save progress — empty fields are allowed"><Save className="w-3.5 h-3.5" /> Submit</button>
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={locked || submitLb.isPending}
                    title="Finalize and lock — empty required fields will be flagged"
                    className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-[12px] font-medium text-slate-700 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Lock className="w-3.5 h-3.5" /> Close
                  </button>
                </>
              )}
            </div>
          </div>

          {submitIssues.length > 0 && (
            <div className="logbook-print-hide sticky top-0 z-20 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3" role="alert">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-amber-900">Fix these before closing</p>
                  <ul className="mt-1.5 space-y-1 max-h-28 overflow-y-auto">
                    {submitIssues.slice(0, 8).map((issue) => (
                      <li key={`${issue.field}:${issue.message}`}>
                        <button
                          type="button"
                          onClick={() => setActiveField(issue.field)}
                          className="text-left text-[12px] text-amber-800 hover:underline"
                        >
                          <span className="font-medium">{issue.label}</span>
                          {' — '}
                          {issue.message}
                        </button>
                      </li>
                    ))}
                    {submitIssues.length > 8 && (
                      <li className="text-[12px] text-amber-700">+{submitIssues.length - 8} more</li>
                    )}
                  </ul>
                </div>
                <button type="button" onClick={() => setSubmitIssues([])} className="text-amber-500 hover:text-amber-700 shrink-0" aria-label="Dismiss">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {locked && (
            <div className="logbook-print-hide grid gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Machine</div>
                <div className="mt-1 text-sm font-bold text-slate-900">{activeLogbook.machineId || currentPlan?.machine.code || '—'}</div>
                <div className="text-[12px] text-slate-500">{currentPlan?.salesOrder?.product ?? activeLogbook.productName ?? '—'}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Shift Summary</div>
                <div className="mt-1 text-sm font-bold text-slate-900">{activeLogbook.date || '—'} · {activeLogbook.shift || '—'}</div>
                <div className="text-[12px] text-slate-500">{activeLogbook.supervisor || currentPlan?.operatorName || 'No supervisor set'}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Production</div>
                <div className="mt-1 text-sm font-bold text-slate-900">{activeLogbook.totalRollKgs || '0'} kg</div>
                <div className="text-[12px] text-slate-500">{activeLogbook.totalRollsProduced || '0'} rolls · {passedKg.toFixed(1)} good · {failedKg.toFixed(1)} rejected</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Completion</div>
                <div className="mt-1 text-sm font-bold text-slate-900">{filledHourly}/{activeLogbook.hourlyInspections.length} hourly checks</div>
                <div className="text-[12px] text-slate-500">{filledCoils} coils filled · {filledTrace} trace rows packed</div>
              </div>
            </div>
          )}

          {/* Two columns: BOTH the sheet and the fill panel scroll internally and are capped to
              the viewport, so the outer page stays put instead of growing to the panel's height. */}
          <div className="flex flex-col xl:flex-row gap-4 items-start">
            <div className="logbook-print-scope w-full xl:flex-1 min-w-0 overflow-auto xl:sticky xl:top-2 xl:self-start xl:max-h-[calc(100vh-10rem)]">
              {mode === 'guided' ? (
                <GuidedPreviewSheet logbook={activeLogbook} template={t} activeField={activeField} onSelectField={selectField} />
              ) : (
                <MachineLogBookSheet
                  logbook={activeLogbook}
                  template={t}
                  on={on}
                  readOnly={locked}
                  headerLocked={!!activeLogbook.productionPlanId}
                  activeSection={activeSection}
                  onSelectSection={(n) => selectField(firstFieldOfSection(n))}
                  activeField={activeField}
                  onSelectField={selectField}
                  formulaOptions={formulaOptions}
                  employeeOptions={peopleOptions}
                />
              )}
            </div>

            {/* Fill panel — hidden once the logbook is closed. */}
            {!locked && <div className="w-full overflow-y-auto pr-0.5 xl:w-[400px] xl:flex-none xl:sticky xl:top-2 xl:self-start xl:max-h-[calc(100vh-10rem)]">
              {mode === 'guided' ? (
                <GuidedWizard logbook={activeLogbook} template={t} on={on} addRoll={addRoll} removeRoll={removeRoll} setScrap={setScrap} onSelectField={selectField} locked={locked} headerLocked={!!activeLogbook.productionPlanId} activeField={activeField} formulaOptions={formulaOptions} employeeOptions={peopleOptions} />
              ) : (
              <>
              <div className="flex items-center gap-1.5 mb-3 text-[11px] font-medium tracking-wide text-slate-500">
                <Eye className="w-3.5 h-3.5" /> Fill panel — edits sync with the sheet
              </div>

              <PanelFieldCtx.Provider value={{ active: activeField, select: selectField, setActiveEl, locked }}>
                {/* §1 Process parameters */}
                <PanelSection n={1} title="Header & Process Parameters" activeSection={activeSection} onSelect={(n) => selectField(firstFieldOfSection(n))}>
                  <div className="grid grid-cols-2 gap-2">
                    <PText label="Machine No" field="machineId" value={activeLogbook.machineId} onChange={(v) => on.scalar('machineId', v)} readOnly />
                    <PText kind="date" label="Date" field="date" value={activeLogbook.date} onChange={(v) => on.scalar('date', v)} readOnly />
                    <PSelect label="Shift" field="shift" value={activeLogbook.shift} onChange={(v) => on.scalar('shift', v)} options={t.shifts} readOnly />
                    <PSelect label="Shift Supervisor" field="supervisor" value={activeLogbook.supervisor} onChange={(v) => on.scalar('supervisor', v)} options={peopleOptions} readOnly />
                    <PText label="Drawing No" field="drawingNo" value={activeLogbook.drawingNo} onChange={(v) => on.scalar('drawingNo', v)} readOnly />
                    <PText label="Tag" field="tag" value={activeLogbook.tag} onChange={(v) => on.scalar('tag', v)} />
                    <PSelect label="Formula No" field="formulaNo" value={activeLogbook.formulaNo} onChange={(v) => on.scalar('formulaNo', v)} options={formulaOptions} readOnly />
                    <PText label="Mold No" field="moldNo" value={activeLogbook.moldNo} onChange={(v) => on.scalar('moldNo', v)} readOnly />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {t.dieZones.map((z) => <div key={z} className="contents"><PText numeric label={`${z} (°C)`} field={`die:${z}`} value={activeLogbook.dieZoneTemps[z] ?? ''} onChange={(v) => on.dieZone(z, v)} lo={t.zoneSpecs?.[z]?.min} hi={t.zoneSpecs?.[z]?.max} /></div>)}
                    {t.barrelZones.map((z) => <div key={z} className="contents"><PText numeric label={`${z} (°C)`} field={`barrel:${z}`} value={activeLogbook.barrelZoneTemps[z] ?? ''} onChange={(v) => on.barrelZone(z, v)} lo={t.zoneSpecs?.[z]?.min} hi={t.zoneSpecs?.[z]?.max} /></div>)}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <PText numeric label="Main Motor Speed" field="motorSpeed" value={activeLogbook.motorSpeed} onChange={(v) => on.scalar('motorSpeed', v)} />
                    <PText numeric label="Ampere" field="ampere" value={activeLogbook.ampere} onChange={(v) => on.scalar('ampere', v)} />
                    <PText numeric label="Takeup Speed" field="takeupSpeed" value={activeLogbook.takeupSpeed} onChange={(v) => on.scalar('takeupSpeed', v)} />
                    <PText numeric label="Vacuum" field="vacuum" value={activeLogbook.vacuum} onChange={(v) => on.scalar('vacuum', v)} />
                    <PText kind="time" label="Extruder start time" field="extruderStartTime" value={activeLogbook.extruderStartTime} onChange={(v) => on.scalar('extruderStartTime', v)} />
                    <PText kind="time" label="Product / Item set time" field="productSetTime" value={activeLogbook.productSetTime} onChange={(v) => on.scalar('productSetTime', v)} />
                    <PText numeric label={`Shore ${t.hardnessType ?? 'A'} Hardness`} field="shoreHardness" value={activeLogbook.shoreHardness} onChange={(v) => on.scalar('shoreHardness', v)} />
                    <PText numeric label="Production Per Hour (kg)" field="productionPerHour" value={activeLogbook.productionPerHour} onChange={(v) => on.scalar('productionPerHour', v)} />
                  </div>
                  <div className="mt-2">
                    <PText label="Product Name" field="productName" value={activeLogbook.productName} onChange={(v) => on.scalar('productName', v)} readOnly />
                  </div>
                </PanelSection>

                {/* §2 Inspection */}
                <PanelSection n={2} title={isPipe ? 'Inspection — Hourly (OD · Weight)' : `Inspection — Coil Weights (${filledCoils}/${t.coil.count}) & Hourly`} activeSection={activeSection} onSelect={(n) => selectField(firstFieldOfSection(n))}>
                  {!isPipe && <>
                  <span className="block text-[9px] font-semibold uppercase text-slate-500 mb-1">Coil weight ({t.coil.rangeLo}–{t.coil.rangeHi} kg)</span>
                  <div className="grid grid-cols-4 gap-1 mb-3">
                    {activeLogbook.coilWeights.map((c, i) => {
                      const badType = isInvalidNumber(c);
                      const oor = !badType && isOutOfRange(c, t.coil.rangeLo, t.coil.rangeHi);
                      const fld = `coil:${i}`;
                      const isA = activeField === fld;
                      return (
                        <div key={i} className="flex items-center gap-0.5">
                          <span className="text-[8px] text-slate-400 w-4 text-right">{i + 1}</span>
                          <input
                            ref={isA ? setActiveEl : undefined}
                            className={`w-full border rounded px-1.5 py-1 text-xs text-center ${isA ? 'ring-2 ring-indigo-500 ' : ''}${oor || badType ? 'border-amber-400 bg-amber-50 text-amber-700 font-bold' : 'border-slate-200'}`}
                            inputMode="decimal"
                            value={c}
                            onFocus={() => selectField(fld)}
                            onChange={(e) => on.coil(i, sanitizeDecimal(e.target.value))}
                          />
                        </div>
                      );
                    })}
                  </div>
                  </>}
                  <span className="block text-[9px] font-semibold uppercase text-slate-500 mb-1">Hourly inspection</span>
                  <div className="space-y-2">
                    {activeLogbook.hourlyInspections.map((row, i) => (
                      <div key={i} className="border border-slate-200 rounded p-1.5">
                        <div className="text-[10px] font-bold text-slate-600 mb-1">{row.timeSlot}</div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {isPipe ? <>
                            <PText numeric label="OD" field={`hourly:${i}:od`} value={row.od ?? ''} onChange={(v) => on.hourly(i, 'od', v)} lo={t.pipeSpecs?.od?.lo} hi={t.pipeSpecs?.od?.hi} />
                            <PText numeric label="Weight" field={`hourly:${i}:weight`} value={row.weight ?? ''} onChange={(v) => on.hourly(i, 'weight', v)} lo={t.pipeSpecs?.weight?.lo} hi={t.pipeSpecs?.weight?.hi} />
                            <PText label="Colour" field={`hourly:${i}:colour`} value={row.colour} onChange={(v) => on.hourly(i, 'colour', v)} />
                            <PSelect label="Ok / Not ok" field={`hourly:${i}:okNotOk`} value={row.okNotOk ?? ''} onChange={(v) => on.hourly(i, 'okNotOk', v)} options={['Ok', 'Not ok']} />
                            <PSelect label="Inspection By" field={`hourly:${i}:inspectionBy`} value={row.inspectionBy} onChange={(v) => on.hourly(i, 'inspectionBy', v)} options={peopleOptions} />
                          </> : <>
                          <PText numeric label={t.dimensionSpecs.top.label} field={`hourly:${i}:topDim`} value={row.topDim ?? ''} onChange={(v) => on.hourly(i, 'topDim', v)} lo={t.dimensionSpecs.top.lo} hi={t.dimensionSpecs.top.hi} />
                          <PText numeric label={t.dimensionSpecs.bottom.label} field={`hourly:${i}:bottomDim`} value={row.bottomDim ?? ''} onChange={(v) => on.hourly(i, 'bottomDim', v)} lo={t.dimensionSpecs.bottom.lo} hi={t.dimensionSpecs.bottom.hi} />
                          {(row.thickness ?? []).map((th, j) => <div key={j} className="contents"><PText numeric label={`Thk ${j + 1}`} field={`hourly:${i}:thickness:${j}`} value={th} onChange={(v) => on.hourlyThickness(i, j, v)} lo={t.dimensionSpecs.thickness.lo} hi={t.dimensionSpecs.thickness.hi} /></div>)}
                          <PText label="Finish" field={`hourly:${i}:finish`} value={row.finish ?? ''} onChange={(v) => on.hourly(i, 'finish', v)} />
                          <PText numeric label="Per meter" field={`hourly:${i}:perMeter`} value={row.perMeter ?? ''} onChange={(v) => on.hourly(i, 'perMeter', v)} />
                          <PText label="Colour" field={`hourly:${i}:colour`} value={row.colour} onChange={(v) => on.hourly(i, 'colour', v)} />
                          <PText label="Tearing" field={`hourly:${i}:tearing`} value={row.tearing ?? ''} onChange={(v) => on.hourly(i, 'tearing', v)} />
                          <PSelect label="Inspection By" field={`hourly:${i}:inspectionBy`} value={row.inspectionBy} onChange={(v) => on.hourly(i, 'inspectionBy', v)} options={peopleOptions} />
                          </>}
                        </div>
                      </div>
                    ))}
                  </div>
                </PanelSection>

                {/* §3 Traceability */}
                <PanelSection n={3} title={`Traceability (${filledTrace} packed)`} activeSection={activeSection} onSelect={(n) => selectField(firstFieldOfSection(n))}>
                  <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                    {activeLogbook.traceabilityRows.map((row, i) => (
                      <div key={i} className="grid grid-cols-[16px_1fr_54px_64px] gap-1 items-center">
                        <span className="text-[8px] text-slate-400 text-right">{i + 1}</span>
                        <input ref={activeField === `trace:${i}:lotNumber` ? setActiveEl : undefined} className={`border rounded px-1.5 py-1 text-xs ${activeField === `trace:${i}:lotNumber` ? 'border-indigo-500 ring-1 ring-indigo-400' : 'border-slate-200'}`} placeholder="Lot Number" value={row.lotNumber} onFocus={() => selectField(`trace:${i}:lotNumber`)} onChange={(e) => on.trace(i, 'lotNumber', e.target.value)} />
                        <input ref={activeField === `trace:${i}:colour` ? setActiveEl : undefined} className={`border rounded px-1.5 py-1 text-xs ${activeField === `trace:${i}:colour` ? 'border-indigo-500 ring-1 ring-indigo-400' : 'border-slate-200'}`} placeholder="Col" value={row.colour} onFocus={() => selectField(`trace:${i}:colour`)} onChange={(e) => on.trace(i, 'colour', e.target.value)} />
                        <input ref={activeField === `trace:${i}:code` ? setActiveEl : undefined} className={`border rounded px-1.5 py-1 text-xs ${activeField === `trace:${i}:code` ? 'border-indigo-500 ring-1 ring-indigo-400' : 'border-slate-200'}`} placeholder="Code" value={row.code} onFocus={() => selectField(`trace:${i}:code`)} onChange={(e) => on.trace(i, 'code', e.target.value)} />
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-[9px] text-slate-400">Winder / packed-by is set per row on the sheet.</p>
                </PanelSection>

                {/* §4 Production report */}
                <PanelSection n={4} title="Production Report" activeSection={activeSection} onSelect={(n) => selectField(firstFieldOfSection(n))}>
                  <div className="grid grid-cols-2 gap-2">
                    <PText numeric label="Total Roll Produced" field="totalRollsProduced" value={activeLogbook.totalRollsProduced} onChange={(v) => on.scalar('totalRollsProduced', v)} />
                    <PText numeric label="Total Roll Kgs" field="totalRollKgs" value={activeLogbook.totalRollKgs} onChange={(v) => on.scalar('totalRollKgs', v)} />
                    <PText numeric label="Process waste (kgs)" field="processWasteKg" value={activeLogbook.processWasteKg} onChange={(v) => on.scalar('processWasteKg', v)} />
                    <PText numeric label="Lumps waste (kgs)" field="lumpsWasteKg" value={activeLogbook.lumpsWasteKg} onChange={(v) => on.scalar('lumpsWasteKg', v)} />
                    <PText numeric label="Rejections (kgs)" field="rejectionKg" value={activeLogbook.rejectionKg} onChange={(v) => on.scalar('rejectionKg', v)} />
                    <PText numeric label="Total material consumed" field="totalConsumedKg" value={activeLogbook.totalConsumedKg} onChange={(v) => on.scalar('totalConsumedKg', v)} />
                  </div>
                  <span className="block mt-2 text-[9px] font-semibold uppercase text-slate-500 mb-1">Reason for Rejections</span>
                  <div className="grid grid-cols-2 gap-2">
                    {t.rejectionReasons.map((r) => <div key={r} className="contents"><PText numeric label={r} field={`rej:${r}`} value={activeLogbook.rejectionCounts[r] ?? ''} onChange={(v) => on.rejection(r, v)} /></div>)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <PSelect label="Meter checked by" field="meterCheckedBy" value={activeLogbook.meterCheckedBy} onChange={(v) => on.scalar('meterCheckedBy', v)} options={peopleOptions} />
                    <PText kind="time" label="Meter check time" field="meterCheckTime" value={activeLogbook.meterCheckTime} onChange={(v) => on.scalar('meterCheckTime', v)} />
                    <PText kind="meter" label="Meter" field="meter" value={activeLogbook.meter} onChange={(v) => on.scalar('meter', v)} ph="e.g. 154/M" />
                    <PText numeric label="Meter Count Set" field="meterCountSet" value={activeLogbook.meterCountSet} onChange={(v) => on.scalar('meterCountSet', v)} />
                  </div>
                </PanelSection>

                {/* §5 Finished rolls / spool register + mass-balance */}
                <div className="rounded-lg border border-slate-200 bg-white mb-2">
                  <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 border-b border-slate-100">5. Finished Rolls · {activeLogbook.rolls.length} registered</div>
                  <div className="px-3 pb-3 pt-2">
                    <RollRegister rolls={activeLogbook.rolls} locked={locked} onAdd={addRoll} onRemove={removeRoll} employeeOptions={peopleOptions} />
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-emerald-50 border border-emerald-100 py-1.5"><div className="text-[9px] font-bold uppercase text-emerald-600">Good</div><div className="text-sm font-extrabold text-emerald-700">{passedKg.toFixed(1)}kg</div></div>
                      <div className="rounded-lg bg-rose-50 border border-rose-100 py-1.5"><div className="text-[9px] font-bold uppercase text-rose-600">Rejected</div><div className="text-sm font-extrabold text-rose-700">{failedKg.toFixed(1)}kg</div></div>
                      <label className="rounded-lg bg-slate-50 border border-slate-200 py-1 px-1 flex flex-col"><span className="text-[9px] font-bold uppercase text-slate-500">Scrap kg</span><input value={activeLogbook.scrapKg} onChange={(e) => setScrap(sanitizeDecimal(e.target.value))} readOnly={locked} inputMode="decimal" className="w-full text-center text-sm font-bold bg-transparent focus:outline-none" placeholder="0" /></label>
                    </div>
                    <div className="mt-2 text-[10px] text-slate-500">Total consumed (good + rejected + scrap) = <b className="text-slate-700">{activeLogbook.totalConsumedKg || '0'} kg</b> · auto-filled into the Production Report.</div>
                  </div>
                </div>

                {/* §6 Sign-off */}
                <div className="rounded-lg border border-slate-200 bg-white mb-2">
                  <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 border-b border-slate-100">6. Sign-off</div>
                  <div className="px-3 pb-3 pt-2 grid grid-cols-2 gap-2">
                    <PSelect label="Operator (signature)" field="operatorSignature" value={activeLogbook.operatorSignature} onChange={(v) => on.scalar('operatorSignature', v)} options={peopleOptions} />
                    <PSelect label="Shift supervisor (signature)" field="supervisorSignature" value={activeLogbook.supervisorSignature} onChange={(v) => on.scalar('supervisorSignature', v)} options={peopleOptions} />
                  </div>
                </div>
              </PanelFieldCtx.Provider>
              </>
              )}
            </div>}
          </div>
            </>
          )}
        </>
        )
      ) : (
        <AdminTemplateEditor template={t} templates={templates} selectedTemplateId={selectedTemplateId} setSelectedTemplateId={setSelectedTemplateId} setTemplates={setTemplates} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- roll register */

function RollRegister({ rolls, locked, onAdd, onRemove, employeeOptions }: { rolls: RollRecord[]; locked: boolean; onAdd: (r: RollRecord) => void; onRemove: (i: number) => void; employeeOptions: readonly string[] }) {
  const [num, setNum] = useState('');
  const [wt, setWt] = useState('');
  const [len, setLen] = useState('');
  const [winder, setWinder] = useState('');
  const [packed, setPacked] = useState('');
  const [status, setStatus] = useState<RollRecord['status']>('passed');
  const nextNum = `R-2026-${String(rolls.length + 1).padStart(3, '0')}`;
  const add = () => {
    onAdd({ rollNumber: num.trim() || nextNum, weight: Number.parseFloat(wt) || 0, length: Number.parseFloat(len) || 0, winderBy: winder, packedBy: packed, status });
    setNum(''); setWt(''); setLen(''); setWinder(''); setPacked(''); setStatus('passed');
  };
  const chipTone = (s: RollRecord['status']): 'success' | 'error' | 'warn' =>
    s === 'passed' ? 'success' : s === 'failed' ? 'error' : 'warn';
  return (
    <div>
      {rolls.length > 0 && (
        <div className="space-y-1 mb-2 max-h-48 overflow-y-auto pr-0.5">
          {rolls.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] border border-slate-100 rounded-lg px-2 py-1">
              <span className="font-mono font-bold text-slate-700">{r.rollNumber}</span>
              <span className="text-slate-500">{r.weight}kg · {r.length}m</span>
              <StatusBadge tone={chipTone(r.status)} className="ml-auto uppercase">{r.status}</StatusBadge>
              {!locked && <button onClick={() => onRemove(i)} className="text-slate-400 hover:text-rose-600 shrink-0" title="Remove roll"><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
        </div>
      )}
      {!locked && (
        <div className="grid grid-cols-2 gap-1.5">
          <input value={num} onChange={(e) => setNum(e.target.value)} placeholder={nextNum} className={inputCls} />
          <select value={status} onChange={(e) => setStatus(e.target.value as RollRecord['status'])} className={inputCls}><option value="passed">Passed</option><option value="pending">Pending QA</option><option value="failed">Rejected</option></select>
          <input value={wt} onChange={(e) => setWt(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Weight kg" className={inputCls} />
          <input value={len} onChange={(e) => setLen(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Length m" className={inputCls} />
          <select value={winder} onChange={(e) => setWinder(e.target.value)} className={inputCls}><option value="">Winder</option>{employeeOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select>
          <select value={packed} onChange={(e) => setPacked(e.target.value)} className={inputCls}><option value="">Packed by</option>{employeeOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select>
          <button onClick={add} className="col-span-2 inline-flex items-center justify-center gap-1 min-h-11 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700"><Plus className="w-3.5 h-3.5" /> Register roll</button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- guided wizard */

type WizItem =
  | { kind: 'field'; step: string; key: string; label: string; type: 'text' | 'select' | 'date' | 'time'; value: string; set: (v: string) => void; options?: readonly string[]; lo?: number; hi?: number; numeric?: boolean }
  | { kind: 'coil'; step: string }
  | { kind: 'hourly'; step: string }
  | { kind: 'traceability'; step: string }
  | { kind: 'production'; step: string }
  | { kind: 'rolls'; step: string }
  | { kind: 'signoff'; step: string };

const oorOf = (value: string, lo?: number, hi?: number): boolean => isOutOfRange(value, lo, hi);

function buildWizItems(lb: MachineLogbook, t: LogbookTemplate, on: LogbookHandlers, formulaOptions: readonly string[], employeeOptions: readonly string[]): WizItem[] {
  const items: WizItem[] = [];
  const f = (
    step: string, key: string, label: string, value: string, set: (v: string) => void,
    type: 'text' | 'select' | 'date' | 'time' = 'text', options?: readonly string[], lo?: number, hi?: number, numeric?: boolean,
  ): WizItem => ({ kind: 'field', step, key, label, value, set, type, options, lo, hi, numeric });
  items.push(f('Shift setup', 'machineId', 'Machine No', lb.machineId, (v) => on.scalar('machineId', v)));
  items.push(f('Shift setup', 'date', 'Date', lb.date, (v) => on.scalar('date', v), 'date'));
  items.push(f('Shift setup', 'shift', 'Shift', lb.shift, (v) => on.scalar('shift', v), 'select', t.shifts));
  items.push(f('Shift setup', 'supervisor', 'Shift Supervisor', lb.supervisor, (v) => on.scalar('supervisor', v), 'select', employeeOptions));
  items.push(f('Shift setup', 'productName', 'Product Name', lb.productName, (v) => on.scalar('productName', v)));
  items.push(f('Process', 'drawingNo', 'Drawing No', lb.drawingNo, (v) => on.scalar('drawingNo', v)));
  items.push(f('Process', 'tag', 'Tag', lb.tag, (v) => on.scalar('tag', v)));
  items.push(f('Process', 'formulaNo', 'Formula No', lb.formulaNo, (v) => on.scalar('formulaNo', v), 'select', formulaOptions));
  items.push(f('Process', 'moldNo', 'Mold No', lb.moldNo, (v) => on.scalar('moldNo', v)));
  t.dieZones.forEach((z) => items.push(f('Process — zones', `die:${z}`, `${z} (°C)`, lb.dieZoneTemps[z] ?? '', (v) => on.dieZone(z, v), 'text', undefined, t.zoneSpecs?.[z]?.min, t.zoneSpecs?.[z]?.max, true)));
  t.barrelZones.forEach((z) => items.push(f('Process — zones', `barrel:${z}`, `${z} (°C)`, lb.barrelZoneTemps[z] ?? '', (v) => on.barrelZone(z, v), 'text', undefined, t.zoneSpecs?.[z]?.min, t.zoneSpecs?.[z]?.max, true)));
  items.push(f('Process', 'motorSpeed', 'Main Motor Speed', lb.motorSpeed, (v) => on.scalar('motorSpeed', v), 'text', undefined, undefined, undefined, true));
  items.push(f('Process', 'ampere', 'Ampere', lb.ampere, (v) => on.scalar('ampere', v), 'text', undefined, undefined, undefined, true));
  items.push(f('Process', 'takeupSpeed', 'Takeup Speed', lb.takeupSpeed, (v) => on.scalar('takeupSpeed', v), 'text', undefined, undefined, undefined, true));
  items.push(f('Process', 'vacuum', 'Vacuum', lb.vacuum, (v) => on.scalar('vacuum', v), 'text', undefined, undefined, undefined, true));
  items.push(f('Process', 'extruderStartTime', 'Extruder start time', lb.extruderStartTime, (v) => on.scalar('extruderStartTime', v), 'time'));
  items.push(f('Process', 'productSetTime', 'Product set time', lb.productSetTime, (v) => on.scalar('productSetTime', v), 'time'));
  items.push(f('Process', 'shoreHardness', `Shore ${t.hardnessType ?? 'A'} Hardness`, lb.shoreHardness, (v) => on.scalar('shoreHardness', v), 'text', undefined, undefined, undefined, true));
  items.push(f('Process', 'productionPerHour', 'Production Per Hour (kg)', lb.productionPerHour, (v) => on.scalar('productionPerHour', v), 'text', undefined, undefined, undefined, true));
  if ((t.layout ?? 'coil') !== 'pipe') items.push({ kind: 'coil', step: 'Coil weights' });
  items.push({ kind: 'hourly', step: 'Hourly inspection' });
  items.push({ kind: 'rolls', step: 'Finished rolls' });
  items.push({ kind: 'traceability', step: 'Traceability' });
  items.push({ kind: 'production', step: 'Production report' });
  items.push({ kind: 'signoff', step: 'Sign-off' });
  return items;
}

function GuidedWizard({ logbook, template, on, addRoll, removeRoll, setScrap, onSelectField, locked, headerLocked, activeField, formulaOptions, employeeOptions }: {
  logbook: MachineLogbook; template: LogbookTemplate; on: LogbookHandlers;
  addRoll: (r: RollRecord) => void; removeRoll: (i: number) => void; setScrap: (v: string) => void;
  onSelectField: (f: string) => void; locked: boolean; headerLocked?: boolean; activeField: string | null; formulaOptions: readonly string[]; employeeOptions: readonly string[];
}) {
  const items = buildWizItems(logbook, template, on, formulaOptions, employeeOptions);
  const HEADER_KEYS = new Set(['machineId', 'date', 'shift', 'supervisor', 'drawingNo', 'formulaNo', 'moldNo', 'productName']);
  const keyOf = (it: WizItem) => (it.kind === 'field' ? it.key : it.kind);
  const found = items.findIndex((it) => keyOf(it) === activeField);
  const idx = found >= 0 ? found : 0;
  const cur = items[idx];
  // activeField is the single source of truth — nav (and the preview) drive it.
  const go = (n: number) => onSelectField(keyOf(items[Math.max(0, Math.min(items.length - 1, n))]));
  // On entering guided mode, land on the first field if nothing wizard-relevant is active.
  useEffect(() => { if (found < 0) onSelectField(keyOf(items[0])); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const pct = Math.round(((idx + 1) / items.length) * 100);
  const fieldLocked = locked || (headerLocked && cur.kind === 'field' && HEADER_KEYS.has(cur.key));
  const fieldBad = cur.kind === 'field' && (oorOf(cur.value, cur.lo, cur.hi) || (!!cur.numeric && isInvalidNumber(cur.value)));
  const wizInput = [
    'w-full min-h-11 rounded-lg border bg-white px-3 text-[15px] text-slate-800',
    'placeholder:text-slate-400',
    'focus:outline-none focus:border-[#1E40AF] focus:ring-2 focus:ring-[#1E40AF]',
    'disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed',
    'read-only:bg-slate-100 read-only:text-slate-500',
  ].join(' ');

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="guided-wizard">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#DBEAFE] text-[#1E40AF]" aria-hidden>
              <Wand2 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-bold leading-tight text-slate-900">Guided entry</p>
              <p className="mt-0.5 truncate text-[13px] text-slate-500">{cur.step}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Step</p>
            <p className="text-[15px] font-bold tabular-nums text-[#1E40AF]">
              {idx + 1}
              <span className="font-medium text-slate-400">/{items.length}</span>
            </p>
          </div>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={items.length}
          aria-valuenow={idx + 1}
          aria-label={`Guided progress, step ${idx + 1} of ${items.length}`}
        >
          <div className="h-full rounded-full bg-[#1E40AF] transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <span className="mt-2 inline-flex items-center rounded-md bg-[#DBEAFE] px-2 py-0.5 text-[11px] font-medium text-[#1E40AF]">
          {cur.step}
        </span>
      </div>

      <div className="max-h-[46vh] min-h-[120px] space-y-3 overflow-y-auto px-4 py-4">
        {cur.kind === 'field' ? (
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
              {cur.label}
              {cur.lo != null && cur.hi != null && cur.hi > cur.lo ? (
                <span className="ml-1 font-normal text-slate-500">· permissible {cur.lo}–{cur.hi}</span>
              ) : null}
            </span>
            {cur.type === 'select' ? (
              <select
                key={cur.key}
                autoFocus
                disabled={fieldLocked}
                value={cur.value}
                onChange={(e) => cur.set(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') go(idx + 1); }}
                className={`${wizInput} border-slate-200`}
              >
                <option value="">—</option>
                {(cur.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                key={cur.key}
                autoFocus
                readOnly={fieldLocked}
                type={cur.type === 'date' ? 'date' : cur.type === 'time' ? 'time' : 'text'}
                inputMode={cur.numeric || (cur.lo != null && cur.hi != null) ? 'decimal' : undefined}
                value={cur.type === 'date' ? normalizeDate(cur.value) : cur.type === 'time' ? normalizeTime(cur.value) : cur.value}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (cur.type === 'date') cur.set(normalizeDate(raw));
                  else if (cur.type === 'time') cur.set(normalizeTime(raw));
                  else if (cur.numeric || (cur.lo != null && cur.hi != null)) cur.set(sanitizeDecimal(raw));
                  else cur.set(raw);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(idx + 1); } }}
                className={`${wizInput} ${fieldBad ? 'border-amber-400 bg-amber-50 text-amber-900 font-semibold focus:border-amber-500 focus:ring-amber-400' : 'border-slate-200'}`}
                placeholder={cur.type === 'date' || cur.type === 'time' ? undefined : 'Type, then press Enter'}
              />
            )}
            {fieldLocked && headerLocked && cur.kind === 'field' && HEADER_KEYS.has(cur.key) && (
              <span className="mt-2 block text-[12px] text-slate-500">Set at planning — not editable here.</span>
            )}
            {oorOf(cur.value, cur.lo, cur.hi) && (
              <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Outside the permissible range — check the setting.
              </span>
            )}
            {cur.numeric && isInvalidNumber(cur.value) && (
              <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Enter a number only.
              </span>
            )}
            {!fieldLocked && (
              <span className="mt-2 block text-[12px] text-slate-400">Press Enter to save and continue.</span>
            )}
          </label>
        ) : cur.kind === 'coil' ? (
          <div>
            <p className="mb-2 text-[13px] font-medium text-slate-700">
              Coil weights — {logbook.coilWeights.filter((c) => c.trim() !== '').length}/{logbook.coilWeights.length} filled
              <span className="ml-1 font-normal text-slate-500">({template.coil.rangeLo}–{template.coil.rangeHi} kg)</span>
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {logbook.coilWeights.map((c, i) => {
                const oor = oorOf(c, template.coil.rangeLo, template.coil.rangeHi);
                return (
                  <input
                    key={i}
                    readOnly={locked}
                    inputMode="decimal"
                    value={c}
                    onChange={(e) => on.coil(i, sanitizeDecimal(e.target.value))}
                    placeholder={String(i + 1)}
                    aria-label={`Coil ${i + 1}`}
                    className={`min-h-11 rounded-lg border px-1.5 text-center text-[13px] ${oor ? 'border-amber-400 bg-amber-50 font-semibold text-amber-900' : 'border-slate-200 bg-white text-slate-800'} focus:outline-none focus:border-[#1E40AF] focus:ring-2 focus:ring-[#1E40AF]`}
                  />
                );
              })}
            </div>
          </div>
        ) : cur.kind === 'hourly' ? (
          <div className="space-y-2.5">
            <p className="text-[13px] font-medium text-slate-700">Hourly inspection — {logbook.hourlyInspections.length} time slots</p>
            {logbook.hourlyInspections.map((row, i) => {
              const isPipe = (template.layout ?? 'coil') === 'pipe';
              const od = template.pipeSpecs?.od;
              const wt = template.pipeSpecs?.weight;
              return (
                <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5">
                  <div className="mb-2 text-[12px] font-semibold text-slate-800">{row.timeSlot}</div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {isPipe ? <>
                      <input readOnly={locked} inputMode="decimal" placeholder={`OD ${od ? `(${od.lo}–${od.hi})` : ''}`} value={row.od ?? ''} onChange={(e) => on.hourly(i, 'od', sanitizeDecimal(e.target.value))} className={`${wizInput} text-[13px] ${oorOf(row.od ?? '', od?.lo, od?.hi) ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`} />
                      <input readOnly={locked} inputMode="decimal" placeholder={`Wt ${wt ? `(${wt.lo}–${wt.hi})` : ''}`} value={row.weight ?? ''} onChange={(e) => on.hourly(i, 'weight', sanitizeDecimal(e.target.value))} className={`${wizInput} text-[13px] ${oorOf(row.weight ?? '', wt?.lo, wt?.hi) ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`} />
                      <input readOnly={locked} placeholder="Colour" value={row.colour} onChange={(e) => on.hourly(i, 'colour', e.target.value)} className={`${wizInput} border-slate-200 text-[13px]`} />
                      <select disabled={locked} value={row.okNotOk ?? ''} onChange={(e) => on.hourly(i, 'okNotOk', e.target.value)} className={`${wizInput} border-slate-200 text-[13px]`}><option value="">Ok / Not ok</option><option value="Ok">Ok</option><option value="Not ok">Not ok</option></select>
                      <select disabled={locked} value={row.inspectionBy} onChange={(e) => on.hourly(i, 'inspectionBy', e.target.value)} className={`${wizInput} border-slate-200 text-[13px]`}><option value="">Inspector</option>{employeeOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                    </> : <>
                      <input readOnly={locked} inputMode="decimal" placeholder={`${template.dimensionSpecs.top.label} (${template.dimensionSpecs.top.lo}–${template.dimensionSpecs.top.hi})`} value={row.topDim} onChange={(e) => on.hourly(i, 'topDim', sanitizeDecimal(e.target.value))} className={`${wizInput} text-[13px] ${oorOf(row.topDim, template.dimensionSpecs.top.lo, template.dimensionSpecs.top.hi) ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`} />
                      <input readOnly={locked} inputMode="decimal" placeholder={`${template.dimensionSpecs.bottom.label} (${template.dimensionSpecs.bottom.lo}–${template.dimensionSpecs.bottom.hi})`} value={row.bottomDim} onChange={(e) => on.hourly(i, 'bottomDim', sanitizeDecimal(e.target.value))} className={`${wizInput} text-[13px] ${oorOf(row.bottomDim, template.dimensionSpecs.bottom.lo, template.dimensionSpecs.bottom.hi) ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`} />
                      {row.thickness.map((th, j) => <input key={j} readOnly={locked} inputMode="decimal" placeholder={`Thk ${j + 1}`} value={th} onChange={(e) => on.hourlyThickness(i, j, sanitizeDecimal(e.target.value))} className={`${wizInput} text-[13px] ${oorOf(th, template.dimensionSpecs.thickness.lo, template.dimensionSpecs.thickness.hi) ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`} />)}
                      <input readOnly={locked} placeholder="Finish" value={row.finish} onChange={(e) => on.hourly(i, 'finish', e.target.value)} className={`${wizInput} border-slate-200 text-[13px]`} />
                      <input readOnly={locked} inputMode="decimal" placeholder="Per m" value={row.perMeter} onChange={(e) => on.hourly(i, 'perMeter', sanitizeDecimal(e.target.value))} className={`${wizInput} border-slate-200 text-[13px]`} />
                      <input readOnly={locked} placeholder="Colour" value={row.colour} onChange={(e) => on.hourly(i, 'colour', e.target.value)} className={`${wizInput} border-slate-200 text-[13px]`} />
                      <input readOnly={locked} placeholder="Tearing" value={row.tearing} onChange={(e) => on.hourly(i, 'tearing', e.target.value)} className={`${wizInput} border-slate-200 text-[13px]`} />
                      <select disabled={locked} value={row.inspectionBy} onChange={(e) => on.hourly(i, 'inspectionBy', e.target.value)} className={`${wizInput} border-slate-200 text-[13px]`}><option value="">Inspector</option>{employeeOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                    </>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : cur.kind === 'rolls' ? (
          <div>
            <p className="mb-2 text-[13px] font-medium text-slate-700">Register finished rolls</p>
            <RollRegister rolls={logbook.rolls} locked={locked} onAdd={addRoll} onRemove={removeRoll} employeeOptions={employeeOptions} />
          </div>
        ) : cur.kind === 'traceability' ? (
          <div>
            <p className="mb-2 text-[13px] font-medium text-slate-700">
              Traceability — {logbook.traceabilityRows.filter((r) => r.lotNumber.trim() !== '').length}/{logbook.traceabilityRows.length} packed
            </p>
            <div className="space-y-1.5">
              {logbook.traceabilityRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[20px_1fr_56px_64px] items-center gap-1.5">
                  <span className="text-right text-[11px] tabular-nums text-slate-400">{i + 1}</span>
                  <input readOnly={locked} placeholder="Lot Number" value={row.lotNumber} onChange={(e) => on.trace(i, 'lotNumber', e.target.value)} className={`${wizInput} border-slate-200 text-[13px]`} />
                  <input readOnly={locked} placeholder="Col" value={row.colour} onChange={(e) => on.trace(i, 'colour', e.target.value)} className={`${wizInput} border-slate-200 text-[13px]`} />
                  <input readOnly={locked} placeholder="Code" value={row.code} onChange={(e) => on.trace(i, 'code', e.target.value)} className={`${wizInput} border-slate-200 text-[13px]`} />
                </div>
              ))}
            </div>
          </div>
        ) : cur.kind === 'production' ? (
          <div className="space-y-3">
            <p className="text-[13px] font-medium text-slate-700">Production report</p>
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Total rolls</div>
                <div className="mt-0.5 text-[16px] font-bold tabular-nums text-slate-900">{logbook.totalRollsProduced || '0'}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Total kg</div>
                <div className="mt-0.5 text-[16px] font-bold tabular-nums text-slate-900">{logbook.totalRollKgs || '0'}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Consumed</div>
                <div className="mt-0.5 text-[16px] font-bold tabular-nums text-slate-900">{logbook.totalConsumedKg || '0'}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-slate-600">Process waste (kg)</span><input readOnly={locked} inputMode="decimal" value={logbook.processWasteKg} onChange={(e) => on.scalar('processWasteKg', sanitizeDecimal(e.target.value))} className={`${wizInput} border-slate-200`} /></label>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-slate-600">Lumps waste (kg)</span><input readOnly={locked} inputMode="decimal" value={logbook.lumpsWasteKg} onChange={(e) => on.scalar('lumpsWasteKg', sanitizeDecimal(e.target.value))} className={`${wizInput} border-slate-200`} /></label>
            </div>
            {template.rejectionReasons.length > 0 && <>
              <span className="block text-[12px] font-medium text-slate-600">Reason for rejections (counts)</span>
              <div className="grid grid-cols-2 gap-2">
                {template.rejectionReasons.map((r) => (
                  <label key={r} className="block"><span className="mb-1 block truncate text-[12px] text-slate-500">{r}</span><input readOnly={locked} inputMode="decimal" value={logbook.rejectionCounts[r] ?? ''} onChange={(e) => on.rejection(r, sanitizeDecimal(e.target.value))} className={`${wizInput} border-slate-200`} /></label>
                ))}
              </div>
            </>}
            <span className="block text-[12px] font-medium text-slate-600">Meter check</span>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="mb-1 block text-[12px] text-slate-500">Checked by</span><select disabled={locked} value={logbook.meterCheckedBy} onChange={(e) => on.scalar('meterCheckedBy', e.target.value)} className={`${wizInput} border-slate-200`}><option value="">—</option>{employeeOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className="block"><span className="mb-1 block text-[12px] text-slate-500">Time</span><input readOnly={locked} type="time" value={normalizeTime(logbook.meterCheckTime)} onChange={(e) => on.scalar('meterCheckTime', normalizeTime(e.target.value))} className={`${wizInput} border-slate-200`} /></label>
              <label className="block"><span className="mb-1 block text-[12px] text-slate-500">Meter</span><input readOnly={locked} placeholder="154/M" value={logbook.meter} onChange={(e) => on.scalar('meter', sanitizeMeter(e.target.value))} className={`${wizInput} border-slate-200`} /></label>
              <label className="block"><span className="mb-1 block text-[12px] text-slate-500">Meter Count Set</span><input readOnly={locked} inputMode="decimal" value={logbook.meterCountSet} onChange={(e) => on.scalar('meterCountSet', sanitizeDecimal(e.target.value))} className={`${wizInput} border-slate-200`} /></label>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            <label className="block"><span className="mb-1.5 block text-[13px] font-medium text-slate-700">Start-up scrap (kg)</span><input readOnly={locked} value={logbook.scrapKg} onChange={(e) => setScrap(sanitizeDecimal(e.target.value))} inputMode="decimal" className={`${wizInput} border-slate-200`} /></label>
            <label className="block"><span className="mb-1.5 block text-[13px] font-medium text-slate-700">Operator signature</span><select disabled={locked} value={logbook.operatorSignature} onChange={(e) => on.scalar('operatorSignature', e.target.value)} className={`${wizInput} border-slate-200`}><option value="">—</option>{employeeOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label className="block"><span className="mb-1.5 block text-[13px] font-medium text-slate-700">Shift supervisor signature</span><select disabled={locked} value={logbook.supervisorSignature} onChange={(e) => on.scalar('supervisorSignature', e.target.value)} className={`${wizInput} border-slate-200`}><option value="">—</option>{employeeOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-200 bg-slate-50 px-3 py-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => go(idx - 1)}
            disabled={idx === 0}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" /> Prev
          </button>
          <button
            type="button"
            onClick={() => go(idx + 1)}
            disabled={idx === items.length - 1}
            className="inline-flex min-h-11 flex-[1.4] items-center justify-center gap-1.5 rounded-lg bg-[#1E40AF] px-3 text-[13px] font-medium text-white hover:bg-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <label className="block">
          <span className="sr-only">Jump to step</span>
          <select
            value={idx}
            onChange={(e) => go(Number(e.target.value))}
            className={`${wizInput} border-slate-200 text-[13px]`}
            title="Jump to step"
          >
            {items.map((it, i) => (
              <option key={i} value={i}>{i + 1}. {it.kind === 'field' ? it.label : it.step}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- panel section */

function PanelSection({ n, title, activeSection, onSelect, children }: {
  n: number;
  title: string;
  activeSection: number;
  onSelect: (n: number) => void;
  children: React.ReactNode;
}) {
  const open = activeSection === n;
  return (
    <div className={`rounded-lg border mb-2 transition-all bg-white ${open ? 'border-indigo-400 ring-1 ring-indigo-300' : 'border-slate-200'}`}>
      <button
        type="button"
        onClick={() => onSelect(n)}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-wide ${open ? 'text-indigo-800' : 'text-slate-600 hover:text-slate-800'}`}
      >
        <span>{n}. {title}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180 text-indigo-600' : 'text-slate-400'}`} />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- admin editor (deferred generalization) */

const NOOP_HANDLERS: LogbookHandlers = {
  scalar: () => {}, dieZone: () => {}, barrelZone: () => {}, coil: () => {},
  hourly: () => {}, hourlyThickness: () => {}, trace: () => {}, rejection: () => {}
};

// Add/remove chip editor for a string list (zones, reasons, time slots).
function ChipEditor({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  const [val, setVal] = useState('');
  const add = () => { const v = val.trim(); if (!v || items.includes(v)) { setVal(''); return; } onChange([...items, v]); setVal(''); };
  return (
    <div>
      <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</span>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {items.map((it, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md px-2 py-0.5 text-[11px] font-medium">
            {it}
            <button onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-indigo-400 hover:text-rose-600" title="Remove"><X className="w-3 h-3" /></button>
          </span>
        ))}
        {items.length === 0 && <span className="text-[10px] text-slate-400">none yet</span>}
      </div>
      <div className="flex gap-1.5">
        <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder={placeholder} className={inputCls} />
        <button onClick={add} className="px-2.5 rounded-lg bg-slate-800 text-white text-xs font-bold shrink-0 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>
      </div>
    </div>
  );
}

function AdminTemplateEditor({ template, templates, selectedTemplateId, setSelectedTemplateId, setTemplates }: {
  template: LogbookTemplate;
  templates: LogbookTemplate[];
  selectedTemplateId: string;
  setSelectedTemplateId: (id: string) => void;
  setTemplates: React.Dispatch<React.SetStateAction<LogbookTemplate[]>>;
}) {
  const [draft, setDraft] = useState<LogbookTemplate>({ ...template });
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => { setDraft({ ...template }); }, [template.id]);

  const set = <K extends keyof LogbookTemplate>(k: K, v: LogbookTemplate[K]) => setDraft((p) => ({ ...p, [k]: v }));

  const save = () => {
    setTemplates((prev) => (prev.some((t) => t.id === draft.id) ? prev.map((t) => (t.id === draft.id ? draft : t)) : [...prev, draft]));
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2500);
    pushToast(`Template ${draft.productName} saved.`);
  };

  const addTemplate = () => {
    const id = `tmpl-${Date.now()}`;
    const nt: LogbookTemplate = { ...draft, id, productName: 'New Product', docNo: draft.docNo };
    setTemplates((prev) => [...prev, nt]);
    setSelectedTemplateId(id);
    pushToast('New template created — edit and save it.');
  };

  const preview = blankLogbook(draft);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl p-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Template</span>
          <select className={inputCls + ' !w-auto min-w-[220px]'} value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
            {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.productName} · {tpl.docNo}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {savedFlash && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Saved</span>}
          <button onClick={addTemplate} className="inline-flex items-center gap-1 min-h-11 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200"><Plus className="w-3.5 h-3.5" /> New template</button>
          <button onClick={save} className="inline-flex items-center gap-1 min-h-11 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700"><Save className="w-3.5 h-3.5" /> Save template</button>
        </div>
      </div>

      {/* Two columns: builder form (left) + live preview (right, sticky) */}
      <div className="flex flex-col xl:flex-row gap-4 items-start">
        <div className="w-full xl:flex-1 min-w-0 space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3 grid grid-cols-2 md:grid-cols-3 gap-2.5">
            <PText label="Doc No" value={draft.docNo} onChange={(v) => set('docNo', v)} />
            <PText label="Rev No" value={draft.revNo} onChange={(v) => set('revNo', v)} />
            <PText label="Rev Date" value={draft.revDate} onChange={(v) => set('revDate', v)} />
            <PText label="Brand Name" value={draft.brandName} onChange={(v) => set('brandName', v)} />
            <PText label="Location" value={draft.location} onChange={(v) => set('location', v)} />
            <PText label="Title" value={draft.title} onChange={(v) => set('title', v)} />
            <div className="col-span-2 md:col-span-3"><PText label="Product Name" value={draft.productName} onChange={(v) => set('productName', v)} /></div>
            <PText label="Finish spec" value={draft.finishSpec} onChange={(v) => set('finishSpec', v)} />
            <PText label="Per meter spec" value={draft.perMeterSpec} onChange={(v) => set('perMeterSpec', v)} />
            <PText label="Lot number note" value={draft.lotNumberNote} onChange={(v) => set('lotNumberNote', v)} />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3">
            <ChipEditor label="Shifts" items={draft.shifts} onChange={(n) => set('shifts', n)} placeholder="D / N …" />
            <ChipEditor label="Supervisors" items={draft.supervisors} onChange={(n) => set('supervisors', n)} placeholder="Add a name" />
            <ChipEditor label="Die zones" items={draft.dieZones} onChange={(n) => set('dieZones', n)} placeholder="e.g. Die 6" />
            <ChipEditor label="Barrel zones" items={draft.barrelZones} onChange={(n) => set('barrelZones', n)} placeholder="e.g. Zone 1" />
            <ChipEditor label="Inspection time slots" items={draft.inspectionTimeSlots} onChange={(n) => set('inspectionTimeSlots', n)} placeholder="e.g. 9–10" />
            <ChipEditor label="Rejection reasons" items={draft.rejectionReasons} onChange={(n) => set('rejectionReasons', n)} placeholder="Add a defect reason" />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-2">Zone temperature setpoints (°C) — flags out-of-range temps on the sheet</span>
            <div className="space-y-1.5">
              <div className="grid grid-cols-[1fr_64px_64px_64px] gap-1.5 text-[9px] font-bold uppercase text-slate-400 px-0.5"><span>Zone</span><span className="text-center">Target</span><span className="text-center">Min</span><span className="text-center">Max</span></div>
              {[...draft.dieZones, ...draft.barrelZones].map((z) => {
                const zs = draft.zoneSpecs?.[z] ?? { target: 0, min: 0, max: 0 };
                const setZ = (patch: Partial<{ target: number; min: number; max: number }>) => set('zoneSpecs', { ...(draft.zoneSpecs ?? {}), [z]: { ...zs, ...patch } });
                return (
                  <div key={z} className="grid grid-cols-[1fr_64px_64px_64px] gap-1.5 items-center">
                    <span className="text-[11px] font-semibold text-slate-600 truncate">{z}</span>
                    <input value={String(zs.target)} onChange={(e) => setZ({ target: Number(e.target.value) || 0 })} inputMode="decimal" className={inputCls + ' text-center'} />
                    <input value={String(zs.min)} onChange={(e) => setZ({ min: Number(e.target.value) || 0 })} inputMode="decimal" className={inputCls + ' text-center'} />
                    <input value={String(zs.max)} onChange={(e) => setZ({ max: Number(e.target.value) || 0 })} inputMode="decimal" className={inputCls + ' text-center'} />
                  </div>
                );
              })}
              {[...draft.dieZones, ...draft.barrelZones].length === 0 && <span className="text-[10px] text-slate-400">Add die / barrel zones above first.</span>}
            </div>
            <p className="mt-1.5 text-[9px] text-slate-400">Leave a zone at max ≤ min to skip range-checking it.</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-2">Coil weight spec</span>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
              <PText label="Per M" value={String(draft.coil.perM)} onChange={(v) => set('coil', { ...draft.coil, perM: Number(v) || 0 })} />
              <PText label="Target Kg" value={String(draft.coil.targetKg)} onChange={(v) => set('coil', { ...draft.coil, targetKg: Number(v) || 0 })} />
              <PText label="Bobbin gms" value={String(draft.coil.bobbinGms)} onChange={(v) => set('coil', { ...draft.coil, bobbinGms: Number(v) || 0 })} />
              <PText label="Range Lo" value={String(draft.coil.rangeLo)} onChange={(v) => set('coil', { ...draft.coil, rangeLo: Number(v) || 0 })} />
              <PText label="Range Hi" value={String(draft.coil.rangeHi)} onChange={(v) => set('coil', { ...draft.coil, rangeHi: Number(v) || 0 })} />
              <PText label="Cell count" value={String(draft.coil.count)} onChange={(v) => set('coil', { ...draft.coil, count: Number(v) || 0 })} />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-2">Dimension specs (lo/hi auto = nominal ± tol)</span>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <PText label="Top nominal" value={String(draft.dimensionSpecs.top.nominal)} onChange={(v) => set('dimensionSpecs', dimWith(draft, 'top', { nominal: Number(v) || 0 }))} />
              <PText label="Top tol" value={String(draft.dimensionSpecs.top.tol)} onChange={(v) => set('dimensionSpecs', dimWith(draft, 'top', { tol: Number(v) || 0 }))} />
              <PText label="Bottom nominal" value={String(draft.dimensionSpecs.bottom.nominal)} onChange={(v) => set('dimensionSpecs', dimWith(draft, 'bottom', { nominal: Number(v) || 0 }))} />
              <PText label="Bottom tol" value={String(draft.dimensionSpecs.bottom.tol)} onChange={(v) => set('dimensionSpecs', dimWith(draft, 'bottom', { tol: Number(v) || 0 }))} />
              <PText label="Thickness count" value={String(draft.dimensionSpecs.thickness.count)} onChange={(v) => set('dimensionSpecs', { ...draft.dimensionSpecs, thickness: { ...draft.dimensionSpecs.thickness, count: Number(v) || 0 } })} />
              <PText label="Thickness lo" value={String(draft.dimensionSpecs.thickness.lo)} onChange={(v) => set('dimensionSpecs', { ...draft.dimensionSpecs, thickness: { ...draft.dimensionSpecs.thickness, lo: Number(v) || 0 } })} />
              <PText label="Thickness hi" value={String(draft.dimensionSpecs.thickness.hi)} onChange={(v) => set('dimensionSpecs', { ...draft.dimensionSpecs, thickness: { ...draft.dimensionSpecs.thickness, hi: Number(v) || 0 } })} />
              <PText label="Traceability rows/table" value={String(draft.traceability.rowsPerTable)} onChange={(v) => set('traceability', { ...draft.traceability, rowsPerTable: Number(v) || 0 })} />
            </div>
          </div>
        </div>

        <div className="w-full xl:w-[46%] xl:flex-none xl:sticky xl:top-2 xl:self-start xl:max-h-[calc(100vh-9rem)] overflow-auto">
          <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
            <Eye className="w-3.5 h-3.5" /> Live preview — updates as you edit
          </div>
          <MachineLogBookSheet logbook={preview} template={draft} on={NOOP_HANDLERS} readOnly activeSection={0} onSelectSection={() => {}} activeField={null} onSelectField={() => {}} />
        </div>
      </div>
    </div>
  );
}

// Update one dimension spec (top|bottom) and recompute its lo/hi from nominal ± tol.
function dimWith(draft: LogbookTemplate, key: 'top' | 'bottom', patch: { nominal?: number; tol?: number }) {
  const cur = draft.dimensionSpecs[key];
  const nominal = patch.nominal ?? cur.nominal;
  const tol = patch.tol ?? cur.tol;
  return {
    ...draft.dimensionSpecs,
    [key]: { ...cur, nominal, tol, lo: Number((nominal - tol).toFixed(3)), hi: Number((nominal + tol).toFixed(3)) }
  };
}

// Minimal safety fallback if no template exists at first render (should not happen — one is seeded).
const FALLBACK_TEMPLATE: LogbookTemplate = {
  id: 'fallback', docNo: 'QR/MFG/013', revNo: '02', revDate: '', brandName: 'MesaOrigins', location: '', title: 'MACHINE LOG BOOK',
  productName: 'Untitled', shifts: ['D', 'N'], supervisors: [], lotNumberNote: '', dieZones: ['Die 6', 'Die 5'],
  barrelZones: ['Zone 4', 'Zone 3', 'Zone 2', 'Zone 1'],
  coil: { perM: 150, targetKg: 0, bobbinGms: 0, rangeLo: 0, rangeHi: 0, count: 44 },
  inspectionTimeSlots: ['9–10', '12–1', '3–4', '6–7', '8–9'],
  dimensionSpecs: { top: { label: 'Top Dim', nominal: 0, tol: 0, lo: 0, hi: 0 }, bottom: { label: 'Bottom Dim', nominal: 0, tol: 0, lo: 0, hi: 0 }, thickness: { label: 'Thickness', count: 3, lo: 0, hi: 0 } },
  finishSpec: '', perMeterSpec: '', traceability: { tableCount: 2, rowsPerTable: 15 }, rejectionReasons: [], notes: []
};
