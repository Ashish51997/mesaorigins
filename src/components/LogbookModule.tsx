/**
 * LogbookModule.tsx — "Production (LOG BOOK)" feature.
 *
 * Operator tab: a two-column workspace — the QR/MFG/013 sheet (editable in
 * place) on the left, and a grouped fill panel with an input for every field on
 * the right. Both bind to one `activeLogbook` via shared handlers, so editing
 * either side updates the other live. The right panel is sticky (stays in view
 * while the tall sheet scrolls). Selecting any section or input highlights it on
 * both sides and scrolls the matching panel input into view. Submitting upserts
 * into the shared machineLogbooks list (App.tsx state → debounced POST /api/data).
 *
 * Admin tab: a pragmatic editor for the seeded template's per-product specs.
 * Full generalization of the template builder is deferred — see SPEC_LOGBOOK.md.
 */

import React, { useState, useEffect, useRef, useContext, createContext, useCallback } from 'react';
import { FileSpreadsheet, Settings, Save, RotateCcw, CheckCircle2, Eye, ChevronDown, Lock, Plus, Trash2, AlertTriangle, CalendarClock, X, Wand2, ArrowLeft, ArrowRight } from 'lucide-react';
import { LogbookTemplate, MachineLogbook, ProductionPlan, SalesOrder, RollRecord } from '../types';
import MachineLogBookSheet, { LogbookHandlers } from './MachineLogBookSheet';
import GuidedPreviewSheet from './GuidedPreviewSheet';
import { pushToast } from './Notify';
import { ApiError } from '../lib/apiClient';
import { useLogbookTemplates, useLogbookPlans, useLogbookFormulas, useOpenLogbook, useSaveLogbook, useSubmitLogbook } from '../lib/queries/logbook';

interface LogbookModuleProps {
  templates: LogbookTemplate[];
  setTemplates: React.Dispatch<React.SetStateAction<LogbookTemplate[]>>;
  machineLogbooks: MachineLogbook[];
  setMachineLogbooks: React.Dispatch<React.SetStateAction<MachineLogbook[]>>;
  productionPlans: ProductionPlan[];
  salesOrders: SalesOrder[];
  initialTab?: 'operator' | 'admin';
  initialPlanId?: string;
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
  return {
    ...lb,
    rolls: lb.rolls ?? [],
    scrapKg: lb.scrapKg ?? '',
    operatorSignature: lb.operatorSignature ?? '',
    supervisorSignature: lb.supervisorSignature ?? ''
  };
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

const inputCls = 'w-full border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white';

/* Selection context so panel fields can highlight/scroll the active input and
 * report focus without threading props through every field. */
interface PanelFieldCtxValue {
  active?: string | null;
  select?: (f: string) => void;
  setActiveEl?: (el: HTMLElement | null) => void;
  locked?: boolean;
}
const PanelFieldCtx = createContext<PanelFieldCtxValue>({});

function PText({ label, value, onChange, ph, field, lo, hi, readOnly }: { label: string; value: string; onChange: (v: string) => void; ph?: string; field?: string; lo?: number; hi?: number; readOnly?: boolean }) {
  const { active, select, setActiveEl, locked } = useContext(PanelFieldCtx);
  const isActive = field != null && field === active;
  const n = Number.parseFloat(value);
  const ranged = lo != null && hi != null && hi > lo;
  const oor = ranged && (value ?? '').trim() !== '' && !Number.isNaN(n) && (n < lo! || n > hi!);
  return (
    <label className={`flex flex-col gap-0.5 rounded ${isActive ? 'ring-2 ring-indigo-500 bg-indigo-50/70 p-1 -m-0.5' : ''}`}>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}{ranged ? <span className="text-slate-400 font-normal normal-case"> ({lo}–{hi})</span> : null}</span>
      <input
        ref={isActive && setActiveEl ? setActiveEl : undefined}
        className={`${inputCls}${oor ? ' border-amber-400 bg-amber-50 text-amber-700 font-bold' : ''}${readOnly ? ' bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
        value={value ?? ''}
        placeholder={ph}
        readOnly={locked || readOnly}
        onFocus={() => { if (field) select?.(field); }}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function PSelect({ label, value, onChange, options, field }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[]; field?: string }) {
  const { active, select, setActiveEl, locked } = useContext(PanelFieldCtx);
  const isActive = field != null && field === active;
  return (
    <label className={`flex flex-col gap-0.5 rounded ${isActive ? 'ring-2 ring-indigo-500 bg-indigo-50/70 p-1 -m-0.5' : ''}`}>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        ref={isActive && setActiveEl ? setActiveEl : undefined}
        className={inputCls}
        value={value ?? ''}
        disabled={locked}
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
  initialPlanId
}: LogbookModuleProps) {
  const [activeTab, setActiveTab] = useState<'operator' | 'admin'>(initialTab);
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

  // Operator data comes from the API (tenant-scoped): templates, the scheduled-
  // plan gate, and the logbook (opened per plan). The admin tab still edits the
  // prop templates.
  const templatesQ = useLogbookTemplates();
  const plansQ = useLogbookPlans();
  const formulasQ = useLogbookFormulas();
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
  const [mode, setMode] = useState<'sheet' | 'guided'>('sheet');
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
    setActiveField(null); setErr('');
    openLb.mutate(selectedPlanId, {
      onSuccess: (lb) => setActiveLogbook(hydrate(lb)),
      onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not open this logbook.'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanId]);

  const loaded = !!selectedPlanId && activeLogbook.productionPlanId === selectedPlanId;

  // Debounced draft autosave (until the sheet is submitted/locked).
  useEffect(() => {
    if (!loaded || activeLogbook.status === 'submitted') return;
    const id = activeLogbook.id;
    const timer = setTimeout(() => { saveLb.mutate({ id, patch: activeLogbook as Partial<MachineLogbook> }); }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLogbook]);

  const operatorTemplate = apiTemplates.find((x) => x.id === activeLogbook.templateId) ?? apiTemplates[0];
  const t: LogbookTemplate = (activeTab === 'admin' ? adminTemplate : operatorTemplate) ?? adminTemplate ?? apiTemplates[0] ?? { ...FALLBACK_TEMPLATE };
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
    if (locked || submitLb.isPending) return;
    setErr('');
    const id = activeLogbook.id;
    // Persist the latest edits, then submit + lock (the server requires the
    // operator sign-off and advances the plan to 'running').
    saveLb.mutate({ id, patch: activeLogbook as Partial<MachineLogbook> }, {
      onSuccess: () => submitLb.mutate(id, {
        onSuccess: (lb) => {
          setActiveLogbook(hydrate(lb));
          pushToast(`Shift logbook for Machine ${lb.machineId || '—'} submitted and locked.`);
          setSavedFlash(true);
          window.setTimeout(() => setSavedFlash(false), 2500);
        },
        onError: (e) => { setErr(e instanceof ApiError ? e.message : 'Submit failed.'); window.setTimeout(() => setErr(''), 4000); },
      }),
      onError: (e) => setErr(e instanceof ApiError ? e.message : 'Save failed.'),
    });
  };

  // Revert local edits to the last saved server state for this plan.
  const handleNew = () => { if (locked) return; openLb.mutate(selectedPlanId, { onSuccess: (lb) => setActiveLogbook(hydrate(lb)) }); setActiveField(null); setErr(''); };

  const filledCoils = activeLogbook.coilWeights.filter((c) => c.trim() !== '').length;
  const filledTrace = activeLogbook.traceabilityRows.filter((r) => r.lotNumber.trim() !== '').length;

  /* ---------------------------------------------------------------- render */
  return (
    <div className="space-y-3">
      {/* Tab switch */}
      {activeTab === 'operator' ? (
        plansQ.isLoading ? (
          <div className="p-10 text-center text-sm text-slate-400">Loading scheduled extruders…</div>
        ) : scheduledPlans.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-10 max-w-lg mx-auto mt-8 text-center shadow-md space-y-4" id="logbook-no-schedule">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center border border-amber-100 dark:border-amber-900/40">
              <CalendarClock className="h-7 w-7 text-amber-600" />
            </div>
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">No extruder scheduled</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">A shift logbook can only be started for a machine Planning has scheduled. Ask the Production Planner to plan an order onto a line — it will appear here the moment it's scheduled.</p>
          </div>
        ) : (
        <>
          {/* Toolbar — read-only current-plan (no extruder picker; Machine Tasks selects the plan) + submit / lock */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-2xl p-2.5 shadow-md">
            <div className="flex items-center gap-2 min-w-0">
              {(() => {
                const cur = scheduledPlans.find((p) => p.id === selectedPlanId);
                return (
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-700 truncate">
                    <FileSpreadsheet className="w-4 h-4 text-indigo-500 shrink-0" />
                    {cur ? <>Machine {cur.machine.code} · {cur.shift === 'D' ? 'Day' : 'Night'} shift · {cur.salesOrder?.soNumber ?? 'no order'} · {cur.scheduledStartDate.split('T')[0]}</> : 'Production log book'}
                  </span>
                );
              })()}
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${locked ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {locked ? <><Lock className="w-3 h-3" /> Submitted &amp; locked</> : 'Draft'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {err && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600"><AlertTriangle className="w-3.5 h-3.5" /> {err}</span>}
              {savedFlash && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Saved</span>}
              <div className="flex items-center gap-0.5 p-0.5 rounded-full border border-slate-200 bg-slate-50">
                <button onClick={() => setMode('sheet')} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${mode === 'sheet' ? 'bg-white text-indigo-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}><FileSpreadsheet className="w-3.5 h-3.5" /> Sheet</button>
                <button onClick={() => setMode('guided')} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${mode === 'guided' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400'}`}><Wand2 className="w-3.5 h-3.5" /> Guided</button>
              </div>
              <button onClick={handleNew} disabled={locked} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"><RotateCcw className="w-3.5 h-3.5" /> Clear draft</button>
              <button onClick={handleSubmit} disabled={locked} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"><Save className="w-3.5 h-3.5" /> Submit &amp; lock</button>
            </div>
          </div>

          {/* Two columns: BOTH the sheet and the fill panel scroll internally and are capped to
              the viewport, so the outer page stays put instead of growing to the panel's height. */}
          <div className="flex flex-col xl:flex-row gap-4 items-start">
            <div className="w-full xl:flex-1 min-w-0 overflow-auto xl:sticky xl:top-2 xl:self-start xl:max-h-[calc(100vh-10rem)]">
              {mode === 'guided' ? (
                <GuidedPreviewSheet logbook={activeLogbook} template={t} activeField={activeField} onSelectField={selectField} />
              ) : (
                <MachineLogBookSheet
                  logbook={activeLogbook}
                  template={t}
                  on={on}
                  readOnly={locked}
                  activeSection={activeSection}
                  onSelectSection={(n) => selectField(firstFieldOfSection(n))}
                  activeField={activeField}
                  onSelectField={selectField}
                  formulaOptions={formulaOptions}
                />
              )}
            </div>

            {/* Fill panel — its own internal scroll, capped to the viewport, just like the sheet */}
            <div className="w-full xl:w-[380px] xl:flex-none overflow-y-auto xl:sticky xl:top-2 xl:self-start xl:max-h-[calc(100vh-10rem)] pr-0.5">
              {mode === 'guided' ? (
                <GuidedWizard logbook={activeLogbook} template={t} on={on} addRoll={addRoll} removeRoll={removeRoll} setScrap={setScrap} onSelectField={selectField} locked={locked} activeField={activeField} formulaOptions={formulaOptions} />
              ) : (
              <>
              <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
                <Eye className="w-3.5 h-3.5" /> Fill panel — edits sync with the sheet
              </div>

              <PanelFieldCtx.Provider value={{ active: activeField, select: selectField, setActiveEl, locked }}>
                {/* §1 Process parameters */}
                <PanelSection n={1} title="Header & Process Parameters" activeSection={activeSection} onSelect={(n) => selectField(firstFieldOfSection(n))}>
                  <div className="grid grid-cols-2 gap-2">
                    <PText label="Machine No" field="machineId" value={activeLogbook.machineId} onChange={(v) => on.scalar('machineId', v)} readOnly />
                    <PText label="Date" field="date" value={activeLogbook.date} onChange={(v) => on.scalar('date', v)} />
                    <PSelect label="Shift" field="shift" value={activeLogbook.shift} onChange={(v) => on.scalar('shift', v)} options={t.shifts} />
                    <PSelect label="Shift Supervisor" field="supervisor" value={activeLogbook.supervisor} onChange={(v) => on.scalar('supervisor', v)} options={t.supervisors} />
                    <PText label="Drawing No" field="drawingNo" value={activeLogbook.drawingNo} onChange={(v) => on.scalar('drawingNo', v)} />
                    <PText label="Tag" field="tag" value={activeLogbook.tag} onChange={(v) => on.scalar('tag', v)} />
                    <PSelect label="Formula No" field="formulaNo" value={activeLogbook.formulaNo} onChange={(v) => on.scalar('formulaNo', v)} options={formulaOptions} />
                    <PText label="Mold No" field="moldNo" value={activeLogbook.moldNo} onChange={(v) => on.scalar('moldNo', v)} />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {t.dieZones.map((z) => <div key={z} className="contents"><PText label={z} field={`die:${z}`} value={activeLogbook.dieZoneTemps[z] ?? ''} onChange={(v) => on.dieZone(z, v)} lo={t.zoneSpecs?.[z]?.min} hi={t.zoneSpecs?.[z]?.max} /></div>)}
                    {t.barrelZones.map((z) => <div key={z} className="contents"><PText label={z} field={`barrel:${z}`} value={activeLogbook.barrelZoneTemps[z] ?? ''} onChange={(v) => on.barrelZone(z, v)} lo={t.zoneSpecs?.[z]?.min} hi={t.zoneSpecs?.[z]?.max} /></div>)}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <PText label="Main Motor Speed" field="motorSpeed" value={activeLogbook.motorSpeed} onChange={(v) => on.scalar('motorSpeed', v)} />
                    <PText label="Ampere" field="ampere" value={activeLogbook.ampere} onChange={(v) => on.scalar('ampere', v)} />
                    <PText label="Takeup Speed" field="takeupSpeed" value={activeLogbook.takeupSpeed} onChange={(v) => on.scalar('takeupSpeed', v)} />
                    <PText label="Vaccum" field="vacuum" value={activeLogbook.vacuum} onChange={(v) => on.scalar('vacuum', v)} />
                    <PText label="Extruder start time" field="extruderStartTime" value={activeLogbook.extruderStartTime} onChange={(v) => on.scalar('extruderStartTime', v)} />
                    <PText label="Product / Item set time" field="productSetTime" value={activeLogbook.productSetTime} onChange={(v) => on.scalar('productSetTime', v)} />
                    <PText label="Shore A Hardness" field="shoreHardness" value={activeLogbook.shoreHardness} onChange={(v) => on.scalar('shoreHardness', v)} />
                    <PText label="Production Per Hour" field="productionPerHour" value={activeLogbook.productionPerHour} onChange={(v) => on.scalar('productionPerHour', v)} />
                  </div>
                  <div className="mt-2">
                    <PText label="Product Name" field="productName" value={activeLogbook.productName} onChange={(v) => on.scalar('productName', v)} />
                  </div>
                </PanelSection>

                {/* §2 Inspection */}
                <PanelSection n={2} title={isPipe ? 'Inspection — Hourly (OD · Weight)' : `Inspection — Coil Weights (${filledCoils}/${t.coil.count}) & Hourly`} activeSection={activeSection} onSelect={(n) => selectField(firstFieldOfSection(n))}>
                  {!isPipe && <>
                  <span className="block text-[9px] font-semibold uppercase text-slate-500 mb-1">Coil weight ({t.coil.rangeLo}–{t.coil.rangeHi} kg)</span>
                  <div className="grid grid-cols-4 gap-1 mb-3">
                    {activeLogbook.coilWeights.map((c, i) => {
                      const num = Number.parseFloat(c);
                      const oor = c.trim() !== '' && !Number.isNaN(num) && (num < t.coil.rangeLo || num > t.coil.rangeHi);
                      const fld = `coil:${i}`;
                      const isA = activeField === fld;
                      return (
                        <div key={i} className="flex items-center gap-0.5">
                          <span className="text-[8px] text-slate-400 w-4 text-right">{i + 1}</span>
                          <input
                            ref={isA ? setActiveEl : undefined}
                            className={`w-full border rounded px-1 py-0.5 text-[10px] text-center ${isA ? 'ring-2 ring-indigo-500 ' : ''}${oor ? 'border-amber-400 bg-amber-50 text-amber-700 font-bold' : 'border-slate-200'}`}
                            inputMode="decimal"
                            value={c}
                            onFocus={() => selectField(fld)}
                            onChange={(e) => on.coil(i, e.target.value)}
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
                            <PText label="OD" field={`hourly:${i}:od`} value={row.od ?? ''} onChange={(v) => on.hourly(i, 'od', v)} lo={t.pipeSpecs?.od?.lo} hi={t.pipeSpecs?.od?.hi} />
                            <PText label="Weight" field={`hourly:${i}:weight`} value={row.weight ?? ''} onChange={(v) => on.hourly(i, 'weight', v)} lo={t.pipeSpecs?.weight?.lo} hi={t.pipeSpecs?.weight?.hi} />
                            <PText label="Colour" field={`hourly:${i}:colour`} value={row.colour} onChange={(v) => on.hourly(i, 'colour', v)} />
                            <PText label="Ok / Not ok" field={`hourly:${i}:okNotOk`} value={row.okNotOk ?? ''} onChange={(v) => on.hourly(i, 'okNotOk', v)} />
                            <PSelect label="Inspection By" field={`hourly:${i}:inspectionBy`} value={row.inspectionBy} onChange={(v) => on.hourly(i, 'inspectionBy', v)} options={t.supervisors} />
                          </> : <>
                          <PText label={t.dimensionSpecs.top.label} field={`hourly:${i}:topDim`} value={row.topDim ?? ''} onChange={(v) => on.hourly(i, 'topDim', v)} />
                          <PText label={t.dimensionSpecs.bottom.label} field={`hourly:${i}:bottomDim`} value={row.bottomDim ?? ''} onChange={(v) => on.hourly(i, 'bottomDim', v)} />
                          {(row.thickness ?? []).map((th, j) => <div key={j} className="contents"><PText label={`Thk ${j + 1}`} field={`hourly:${i}:thickness:${j}`} value={th} onChange={(v) => on.hourlyThickness(i, j, v)} /></div>)}
                          <PText label="Finish" field={`hourly:${i}:finish`} value={row.finish ?? ''} onChange={(v) => on.hourly(i, 'finish', v)} />
                          <PText label="Per meter" field={`hourly:${i}:perMeter`} value={row.perMeter ?? ''} onChange={(v) => on.hourly(i, 'perMeter', v)} />
                          <PText label="Colour" field={`hourly:${i}:colour`} value={row.colour} onChange={(v) => on.hourly(i, 'colour', v)} />
                          <PText label="Tearing" field={`hourly:${i}:tearing`} value={row.tearing ?? ''} onChange={(v) => on.hourly(i, 'tearing', v)} />
                          <PSelect label="Inspection By" field={`hourly:${i}:inspectionBy`} value={row.inspectionBy} onChange={(v) => on.hourly(i, 'inspectionBy', v)} options={t.supervisors} />
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
                        <input ref={activeField === `trace:${i}:lotNumber` ? setActiveEl : undefined} className={`border rounded px-1 py-0.5 text-[10px] ${activeField === `trace:${i}:lotNumber` ? 'border-indigo-500 ring-1 ring-indigo-400' : 'border-slate-200'}`} placeholder="Lot Number" value={row.lotNumber} onFocus={() => selectField(`trace:${i}:lotNumber`)} onChange={(e) => on.trace(i, 'lotNumber', e.target.value)} />
                        <input ref={activeField === `trace:${i}:colour` ? setActiveEl : undefined} className={`border rounded px-1 py-0.5 text-[10px] ${activeField === `trace:${i}:colour` ? 'border-indigo-500 ring-1 ring-indigo-400' : 'border-slate-200'}`} placeholder="Col" value={row.colour} onFocus={() => selectField(`trace:${i}:colour`)} onChange={(e) => on.trace(i, 'colour', e.target.value)} />
                        <input ref={activeField === `trace:${i}:code` ? setActiveEl : undefined} className={`border rounded px-1 py-0.5 text-[10px] ${activeField === `trace:${i}:code` ? 'border-indigo-500 ring-1 ring-indigo-400' : 'border-slate-200'}`} placeholder="Code" value={row.code} onFocus={() => selectField(`trace:${i}:code`)} onChange={(e) => on.trace(i, 'code', e.target.value)} />
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-[9px] text-slate-400">Winder / packed-by is set per row on the sheet.</p>
                </PanelSection>

                {/* §4 Production report */}
                <PanelSection n={4} title="Production Report" activeSection={activeSection} onSelect={(n) => selectField(firstFieldOfSection(n))}>
                  <div className="grid grid-cols-2 gap-2">
                    <PText label="Total Roll Produced" field="totalRollsProduced" value={activeLogbook.totalRollsProduced} onChange={(v) => on.scalar('totalRollsProduced', v)} />
                    <PText label="Total Roll Kgs" field="totalRollKgs" value={activeLogbook.totalRollKgs} onChange={(v) => on.scalar('totalRollKgs', v)} />
                    <PText label="Process waste (kgs)" field="processWasteKg" value={activeLogbook.processWasteKg} onChange={(v) => on.scalar('processWasteKg', v)} />
                    <PText label="Lumps waste (kgs)" field="lumpsWasteKg" value={activeLogbook.lumpsWasteKg} onChange={(v) => on.scalar('lumpsWasteKg', v)} />
                    <PText label="Rejections (kgs)" field="rejectionKg" value={activeLogbook.rejectionKg} onChange={(v) => on.scalar('rejectionKg', v)} />
                    <PText label="Total material consumed" field="totalConsumedKg" value={activeLogbook.totalConsumedKg} onChange={(v) => on.scalar('totalConsumedKg', v)} />
                  </div>
                  <span className="block mt-2 text-[9px] font-semibold uppercase text-slate-500 mb-1">Reason for Rejections</span>
                  <div className="grid grid-cols-2 gap-2">
                    {t.rejectionReasons.map((r) => <div key={r} className="contents"><PText label={r} field={`rej:${r}`} value={activeLogbook.rejectionCounts[r] ?? ''} onChange={(v) => on.rejection(r, v)} /></div>)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <PSelect label="Meter checked by" field="meterCheckedBy" value={activeLogbook.meterCheckedBy} onChange={(v) => on.scalar('meterCheckedBy', v)} options={t.supervisors} />
                    <PText label="Time" field="meterCheckTime" value={activeLogbook.meterCheckTime} onChange={(v) => on.scalar('meterCheckTime', v)} />
                    <PText label="Meter" field="meter" value={activeLogbook.meter} onChange={(v) => on.scalar('meter', v)} />
                    <PText label="Meter Count Set" field="meterCountSet" value={activeLogbook.meterCountSet} onChange={(v) => on.scalar('meterCountSet', v)} />
                  </div>
                </PanelSection>

                {/* §5 Finished rolls / spool register + mass-balance */}
                <div className="rounded-lg border border-slate-200 bg-white mb-2">
                  <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 border-b border-slate-100">5. Finished Rolls · {activeLogbook.rolls.length} registered</div>
                  <div className="px-3 pb-3 pt-2">
                    <RollRegister rolls={activeLogbook.rolls} locked={locked} onAdd={addRoll} onRemove={removeRoll} />
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-emerald-50 border border-emerald-100 py-1.5"><div className="text-[9px] font-bold uppercase text-emerald-600">Good</div><div className="text-sm font-extrabold text-emerald-700">{passedKg.toFixed(1)}kg</div></div>
                      <div className="rounded-lg bg-rose-50 border border-rose-100 py-1.5"><div className="text-[9px] font-bold uppercase text-rose-600">Rejected</div><div className="text-sm font-extrabold text-rose-700">{failedKg.toFixed(1)}kg</div></div>
                      <label className="rounded-lg bg-slate-50 border border-slate-200 py-1 px-1 flex flex-col"><span className="text-[9px] font-bold uppercase text-slate-500">Scrap kg</span><input value={activeLogbook.scrapKg} onChange={(e) => setScrap(e.target.value)} readOnly={locked} inputMode="decimal" className="w-full text-center text-sm font-bold bg-transparent focus:outline-none" placeholder="0" /></label>
                    </div>
                    <div className="mt-2 text-[10px] text-slate-500">Total consumed (good + rejected + scrap) = <b className="text-slate-700">{activeLogbook.totalConsumedKg || '0'} kg</b> · auto-filled into the Production Report.</div>
                  </div>
                </div>

                {/* §6 Sign-off */}
                <div className="rounded-lg border border-slate-200 bg-white mb-2">
                  <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 border-b border-slate-100">6. Sign-off</div>
                  <div className="px-3 pb-3 pt-2 grid grid-cols-2 gap-2">
                    <PText label="Operator (signature)" field="operatorSignature" value={activeLogbook.operatorSignature} onChange={(v) => on.scalar('operatorSignature', v)} />
                    <PText label="Shift supervisor (signature)" field="supervisorSignature" value={activeLogbook.supervisorSignature} onChange={(v) => on.scalar('supervisorSignature', v)} />
                  </div>
                </div>
              </PanelFieldCtx.Provider>
              </>
              )}
            </div>
          </div>
        </>
        )
      ) : (
        <AdminTemplateEditor template={t} templates={templates} selectedTemplateId={selectedTemplateId} setSelectedTemplateId={setSelectedTemplateId} setTemplates={setTemplates} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- roll register */

function RollRegister({ rolls, locked, onAdd, onRemove }: { rolls: RollRecord[]; locked: boolean; onAdd: (r: RollRecord) => void; onRemove: (i: number) => void }) {
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
  const chip = (s: RollRecord['status']) => s === 'passed' ? 'bg-emerald-100 text-emerald-700' : s === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700';
  return (
    <div>
      {rolls.length > 0 && (
        <div className="space-y-1 mb-2 max-h-48 overflow-y-auto pr-0.5">
          {rolls.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] border border-slate-100 rounded-lg px-2 py-1">
              <span className="font-mono font-bold text-slate-700">{r.rollNumber}</span>
              <span className="text-slate-500">{r.weight}kg · {r.length}m</span>
              <span className={`ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${chip(r.status)}`}>{r.status}</span>
              {!locked && <button onClick={() => onRemove(i)} className="text-slate-400 hover:text-rose-600 shrink-0" title="Remove roll"><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
        </div>
      )}
      {!locked && (
        <div className="grid grid-cols-2 gap-1.5">
          <input value={num} onChange={(e) => setNum(e.target.value)} placeholder={nextNum} className={inputCls} />
          <select value={status} onChange={(e) => setStatus(e.target.value as RollRecord['status'])} className={inputCls}><option value="passed">Passed</option><option value="pending">Pending QA</option><option value="failed">Rejected</option></select>
          <input value={wt} onChange={(e) => setWt(e.target.value)} inputMode="decimal" placeholder="Weight kg" className={inputCls} />
          <input value={len} onChange={(e) => setLen(e.target.value)} inputMode="decimal" placeholder="Length m" className={inputCls} />
          <input value={winder} onChange={(e) => setWinder(e.target.value)} placeholder="Winder" className={inputCls} />
          <input value={packed} onChange={(e) => setPacked(e.target.value)} placeholder="Packed by" className={inputCls} />
          <button onClick={add} className="col-span-2 inline-flex items-center justify-center gap-1 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700"><Plus className="w-3.5 h-3.5" /> Register roll</button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- guided wizard */

type WizItem =
  | { kind: 'field'; step: string; key: string; label: string; type: 'text' | 'select'; value: string; set: (v: string) => void; options?: readonly string[]; lo?: number; hi?: number }
  | { kind: 'coil'; step: string }
  | { kind: 'hourly'; step: string }
  | { kind: 'traceability'; step: string }
  | { kind: 'production'; step: string }
  | { kind: 'rolls'; step: string }
  | { kind: 'signoff'; step: string };

const oorOf = (value: string, lo?: number, hi?: number): boolean => {
  if (lo == null || hi == null || hi <= lo) return false;
  const n = Number.parseFloat(value);
  return value.trim() !== '' && !Number.isNaN(n) && (n < lo || n > hi);
};

function buildWizItems(lb: MachineLogbook, t: LogbookTemplate, on: LogbookHandlers, formulaOptions: readonly string[]): WizItem[] {
  const items: WizItem[] = [];
  const f = (step: string, key: string, label: string, value: string, set: (v: string) => void, type: 'text' | 'select' = 'text', options?: readonly string[], lo?: number, hi?: number): WizItem =>
    ({ kind: 'field', step, key, label, value, set, type, options, lo, hi });
  items.push(f('Shift setup', 'machineId', 'Machine No', lb.machineId, (v) => on.scalar('machineId', v)));
  items.push(f('Shift setup', 'date', 'Date', lb.date, (v) => on.scalar('date', v)));
  items.push(f('Shift setup', 'shift', 'Shift', lb.shift, (v) => on.scalar('shift', v), 'select', t.shifts));
  items.push(f('Shift setup', 'supervisor', 'Shift Supervisor', lb.supervisor, (v) => on.scalar('supervisor', v), 'select', t.supervisors));
  items.push(f('Shift setup', 'productName', 'Product Name', lb.productName, (v) => on.scalar('productName', v)));
  items.push(f('Process', 'drawingNo', 'Drawing No', lb.drawingNo, (v) => on.scalar('drawingNo', v)));
  items.push(f('Process', 'tag', 'Tag', lb.tag, (v) => on.scalar('tag', v)));
  items.push(f('Process', 'formulaNo', 'Formula No', lb.formulaNo, (v) => on.scalar('formulaNo', v), 'select', formulaOptions));
  items.push(f('Process', 'moldNo', 'Mold No', lb.moldNo, (v) => on.scalar('moldNo', v)));
  t.dieZones.forEach((z) => items.push(f('Process — zones', `die:${z}`, `${z} (°C)`, lb.dieZoneTemps[z] ?? '', (v) => on.dieZone(z, v), 'text', undefined, t.zoneSpecs?.[z]?.min, t.zoneSpecs?.[z]?.max)));
  t.barrelZones.forEach((z) => items.push(f('Process — zones', `barrel:${z}`, `${z} (°C)`, lb.barrelZoneTemps[z] ?? '', (v) => on.barrelZone(z, v), 'text', undefined, t.zoneSpecs?.[z]?.min, t.zoneSpecs?.[z]?.max)));
  items.push(f('Process', 'motorSpeed', 'Main Motor Speed', lb.motorSpeed, (v) => on.scalar('motorSpeed', v)));
  items.push(f('Process', 'ampere', 'Ampere', lb.ampere, (v) => on.scalar('ampere', v)));
  items.push(f('Process', 'takeupSpeed', 'Takeup Speed', lb.takeupSpeed, (v) => on.scalar('takeupSpeed', v)));
  items.push(f('Process', 'vacuum', 'Vaccum', lb.vacuum, (v) => on.scalar('vacuum', v)));
  items.push(f('Process', 'extruderStartTime', 'Extruder start time', lb.extruderStartTime, (v) => on.scalar('extruderStartTime', v)));
  items.push(f('Process', 'productSetTime', 'Product set time', lb.productSetTime, (v) => on.scalar('productSetTime', v)));
  items.push(f('Process', 'shoreHardness', 'Shore A Hardness', lb.shoreHardness, (v) => on.scalar('shoreHardness', v)));
  items.push(f('Process', 'productionPerHour', 'Production Per Hour', lb.productionPerHour, (v) => on.scalar('productionPerHour', v)));
  items.push({ kind: 'coil', step: 'Coil weights' });
  items.push({ kind: 'hourly', step: 'Hourly inspection' });
  items.push({ kind: 'rolls', step: 'Finished rolls' });
  items.push({ kind: 'traceability', step: 'Traceability' });
  items.push({ kind: 'production', step: 'Production report' });
  items.push({ kind: 'signoff', step: 'Sign-off' });
  return items;
}

function GuidedWizard({ logbook, template, on, addRoll, removeRoll, setScrap, onSelectField, locked, activeField, formulaOptions }: {
  logbook: MachineLogbook; template: LogbookTemplate; on: LogbookHandlers;
  addRoll: (r: RollRecord) => void; removeRoll: (i: number) => void; setScrap: (v: string) => void;
  onSelectField: (f: string) => void; locked: boolean; activeField: string | null; formulaOptions: readonly string[];
}) {
  const items = buildWizItems(logbook, template, on, formulaOptions);
  const keyOf = (it: WizItem) => (it.kind === 'field' ? it.key : it.kind);
  const found = items.findIndex((it) => keyOf(it) === activeField);
  const idx = found >= 0 ? found : 0;
  const cur = items[idx];
  // activeField is the single source of truth — nav (and the preview) drive it.
  const go = (n: number) => onSelectField(keyOf(items[Math.max(0, Math.min(items.length - 1, n))]));
  // On entering guided mode, land on the first field if nothing wizard-relevant is active.
  useEffect(() => { if (found < 0) onSelectField(keyOf(items[0])); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const pct = Math.round(((idx + 1) / items.length) * 100);

  return (
    <div className="rounded-2xl border border-indigo-200 bg-white shadow-md p-3 space-y-3">
      <div>
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-indigo-700">
          <span className="inline-flex items-center gap-1"><Wand2 className="w-3.5 h-3.5" /> Guided entry</span>
          <span>Step {idx + 1} / {items.length}</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${pct}%` }} /></div>
        <div className="mt-1 inline-block text-[9px] font-bold uppercase tracking-wide bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{cur.step}</div>
      </div>

      <div className="min-h-[96px] max-h-[46vh] overflow-y-auto pr-0.5">
        {cur.kind === 'field' ? (
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-600 mb-1">{cur.label}{cur.lo != null && cur.hi != null && cur.hi > cur.lo ? <span className="text-slate-400 font-normal"> · permissible {cur.lo}–{cur.hi}</span> : null}</span>
            {cur.type === 'select' ? (
              <select key={cur.key} autoFocus disabled={locked} value={cur.value} onChange={(e) => cur.set(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(idx + 1); }} className={inputCls + ' !py-2'}>
                <option value="">—</option>
                {(cur.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input key={cur.key} autoFocus readOnly={locked} value={cur.value} onChange={(e) => cur.set(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(idx + 1); } }} className={`${inputCls} !py-2${oorOf(cur.value, cur.lo, cur.hi) ? ' border-amber-400 bg-amber-50 text-amber-700 font-bold' : ''}`} placeholder="Type, then press ↵" />
            )}
            {oorOf(cur.value, cur.lo, cur.hi) && <span className="block mt-1 text-[10px] font-bold text-amber-700">Outside the permissible range — check the setting.</span>}
            <span className="block mt-1 text-[9px] text-slate-400">Press ↵ to save &amp; go to the next field.</span>
          </label>
        ) : cur.kind === 'coil' ? (
          <div>
            <span className="block text-[11px] font-bold text-slate-600 mb-1">Coil weights — {logbook.coilWeights.filter((c) => c.trim() !== '').length}/{logbook.coilWeights.length} filled <span className="text-slate-400 font-normal">({template.coil.rangeLo}–{template.coil.rangeHi} kg)</span></span>
            <div className="grid grid-cols-4 gap-1">
              {logbook.coilWeights.map((c, i) => {
                const oor = oorOf(c, template.coil.rangeLo, template.coil.rangeHi);
                return <input key={i} readOnly={locked} inputMode="decimal" value={c} onChange={(e) => on.coil(i, e.target.value)} placeholder={String(i + 1)} className={`border rounded px-1 py-1 text-[10px] text-center ${oor ? 'border-amber-400 bg-amber-50 text-amber-700 font-bold' : 'border-slate-200'}`} />;
              })}
            </div>
          </div>
        ) : cur.kind === 'hourly' ? (
          <div className="space-y-2">
            <span className="block text-[11px] font-bold text-slate-600 mb-1">Hourly inspection — {logbook.hourlyInspections.length} time slots</span>
            {logbook.hourlyInspections.map((row, i) => (
              <div key={i} className="border border-slate-200 rounded-lg p-1.5">
                <div className="text-[10px] font-bold text-slate-600 mb-1">{row.timeSlot}</div>
                <div className="grid grid-cols-3 gap-1">
                  <input readOnly={locked} placeholder={template.dimensionSpecs.top.label} value={row.topDim} onChange={(e) => on.hourly(i, 'topDim', e.target.value)} className={inputCls} />
                  <input readOnly={locked} placeholder={template.dimensionSpecs.bottom.label} value={row.bottomDim} onChange={(e) => on.hourly(i, 'bottomDim', e.target.value)} className={inputCls} />
                  {row.thickness.map((th, j) => <input key={j} readOnly={locked} placeholder={`Thk ${j + 1}`} value={th} onChange={(e) => on.hourlyThickness(i, j, e.target.value)} className={inputCls} />)}
                  <input readOnly={locked} placeholder="Finish" value={row.finish} onChange={(e) => on.hourly(i, 'finish', e.target.value)} className={inputCls} />
                  <input readOnly={locked} placeholder="Per m" value={row.perMeter} onChange={(e) => on.hourly(i, 'perMeter', e.target.value)} className={inputCls} />
                  <input readOnly={locked} placeholder="Colour" value={row.colour} onChange={(e) => on.hourly(i, 'colour', e.target.value)} className={inputCls} />
                  <input readOnly={locked} placeholder="Tearing" value={row.tearing} onChange={(e) => on.hourly(i, 'tearing', e.target.value)} className={inputCls} />
                  <select disabled={locked} value={row.inspectionBy} onChange={(e) => on.hourly(i, 'inspectionBy', e.target.value)} className={inputCls}><option value="">Inspector</option>{template.supervisors.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                </div>
              </div>
            ))}
          </div>
        ) : cur.kind === 'rolls' ? (
          <div>
            <span className="block text-[11px] font-bold text-slate-600 mb-1">Register finished rolls</span>
            <RollRegister rolls={logbook.rolls} locked={locked} onAdd={addRoll} onRemove={removeRoll} />
          </div>
        ) : cur.kind === 'traceability' ? (
          <div>
            <span className="block text-[11px] font-bold text-slate-600 mb-1">Traceability — {logbook.traceabilityRows.filter((r) => r.lotNumber.trim() !== '').length}/{logbook.traceabilityRows.length} packed</span>
            <div className="space-y-1">
              {logbook.traceabilityRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[16px_1fr_52px_58px] gap-1 items-center">
                  <span className="text-[8px] text-slate-400 text-right">{i + 1}</span>
                  <input readOnly={locked} placeholder="Lot Number" value={row.lotNumber} onChange={(e) => on.trace(i, 'lotNumber', e.target.value)} className="border border-slate-200 rounded px-1 py-0.5 text-[10px]" />
                  <input readOnly={locked} placeholder="Col" value={row.colour} onChange={(e) => on.trace(i, 'colour', e.target.value)} className="border border-slate-200 rounded px-1 py-0.5 text-[10px]" />
                  <input readOnly={locked} placeholder="Code" value={row.code} onChange={(e) => on.trace(i, 'code', e.target.value)} className="border border-slate-200 rounded px-1 py-0.5 text-[10px]" />
                </div>
              ))}
            </div>
          </div>
        ) : cur.kind === 'production' ? (
          <div className="space-y-2">
            <span className="block text-[11px] font-bold text-slate-600 mb-1">Production report</span>
            <div className="grid grid-cols-3 gap-1.5 text-[10px] text-slate-500 bg-slate-50 rounded-lg p-2">
              <div>Total rolls<div className="font-bold text-slate-800 text-[12px]">{logbook.totalRollsProduced || '0'}</div></div>
              <div>Total kg<div className="font-bold text-slate-800 text-[12px]">{logbook.totalRollKgs || '0'}</div></div>
              <div>Consumed kg<div className="font-bold text-slate-800 text-[12px]">{logbook.totalConsumedKg || '0'}</div></div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Process waste (kg)</span><input readOnly={locked} value={logbook.processWasteKg} onChange={(e) => on.scalar('processWasteKg', e.target.value)} className={inputCls} /></label>
              <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Lumps waste (kg)</span><input readOnly={locked} value={logbook.lumpsWasteKg} onChange={(e) => on.scalar('lumpsWasteKg', e.target.value)} className={inputCls} /></label>
            </div>
            {template.rejectionReasons.length > 0 && <>
              <span className="block text-[9px] font-semibold uppercase text-slate-500">Reason for rejections (counts)</span>
              <div className="grid grid-cols-2 gap-1.5">
                {template.rejectionReasons.map((r) => (
                  <label key={r} className="block"><span className="block text-[9px] text-slate-500 truncate">{r}</span><input readOnly={locked} value={logbook.rejectionCounts[r] ?? ''} onChange={(e) => on.rejection(r, e.target.value)} className={inputCls} /></label>
                ))}
              </div>
            </>}
            <span className="block text-[9px] font-semibold uppercase text-slate-500">Meter check</span>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="block"><span className="block text-[9px] text-slate-500">Checked by</span><select disabled={locked} value={logbook.meterCheckedBy} onChange={(e) => on.scalar('meterCheckedBy', e.target.value)} className={inputCls}><option value="">—</option>{template.supervisors.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className="block"><span className="block text-[9px] text-slate-500">Time</span><input readOnly={locked} value={logbook.meterCheckTime} onChange={(e) => on.scalar('meterCheckTime', e.target.value)} className={inputCls} /></label>
              <label className="block"><span className="block text-[9px] text-slate-500">Meter</span><input readOnly={locked} value={logbook.meter} onChange={(e) => on.scalar('meter', e.target.value)} className={inputCls} /></label>
              <label className="block"><span className="block text-[9px] text-slate-500">Meter Count Set</span><input readOnly={locked} value={logbook.meterCountSet} onChange={(e) => on.scalar('meterCountSet', e.target.value)} className={inputCls} /></label>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            <label className="block"><span className="block text-[11px] font-bold text-slate-600 mb-1">Start-up scrap (kg)</span><input readOnly={locked} value={logbook.scrapKg} onChange={(e) => setScrap(e.target.value)} inputMode="decimal" className={inputCls + ' !py-2'} /></label>
            <label className="block"><span className="block text-[11px] font-bold text-slate-600 mb-1">Operator signature</span><input readOnly={locked} value={logbook.operatorSignature} onChange={(e) => on.scalar('operatorSignature', e.target.value)} className={inputCls + ' !py-2'} /></label>
            <label className="block"><span className="block text-[11px] font-bold text-slate-600 mb-1">Shift supervisor signature</span><input readOnly={locked} value={logbook.supervisorSignature} onChange={(e) => on.scalar('supervisorSignature', e.target.value)} className={inputCls + ' !py-2'} /></label>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => go(idx - 1)} disabled={idx === 0} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40"><ArrowLeft className="w-3.5 h-3.5" /> Prev</button>
        <button onClick={() => go(idx + 1)} disabled={idx === items.length - 1} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40">Next <ArrowRight className="w-3.5 h-3.5" /></button>
        <select value={idx} onChange={(e) => go(Number(e.target.value))} className={inputCls + ' !w-auto ml-auto'} title="Jump to step">
          {items.map((it, i) => <option key={i} value={i}>{i + 1}. {it.kind === 'field' ? it.label : it.step}</option>)}
        </select>
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
          <span key={i} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 text-[11px] font-semibold">
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
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-2xl p-2.5 shadow-md">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Template</span>
          <select className={inputCls + ' !w-auto min-w-[220px]'} value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
            {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.productName} · {tpl.docNo}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {savedFlash && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Saved</span>}
          <button onClick={addTemplate} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200"><Plus className="w-3.5 h-3.5" /> New template</button>
          <button onClick={save} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700"><Save className="w-3.5 h-3.5" /> Save template</button>
        </div>
      </div>

      {/* Two columns: builder form (left) + live preview (right, sticky) */}
      <div className="flex flex-col xl:flex-row gap-4 items-start">
        <div className="w-full xl:flex-1 min-w-0 space-y-3">
          <div className="bg-white border border-slate-200 rounded-2xl p-3 grid grid-cols-2 md:grid-cols-3 gap-2.5">
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

          <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-3">
            <ChipEditor label="Shifts" items={draft.shifts} onChange={(n) => set('shifts', n)} placeholder="D / N …" />
            <ChipEditor label="Supervisors" items={draft.supervisors} onChange={(n) => set('supervisors', n)} placeholder="Add a name" />
            <ChipEditor label="Die zones" items={draft.dieZones} onChange={(n) => set('dieZones', n)} placeholder="e.g. Die 6" />
            <ChipEditor label="Barrel zones" items={draft.barrelZones} onChange={(n) => set('barrelZones', n)} placeholder="e.g. Zone 1" />
            <ChipEditor label="Inspection time slots" items={draft.inspectionTimeSlots} onChange={(n) => set('inspectionTimeSlots', n)} placeholder="e.g. 9–10" />
            <ChipEditor label="Rejection reasons" items={draft.rejectionReasons} onChange={(n) => set('rejectionReasons', n)} placeholder="Add a defect reason" />
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-3">
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

          <div className="bg-white border border-slate-200 rounded-2xl p-3">
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

          <div className="bg-white border border-slate-200 rounded-2xl p-3">
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
  id: 'fallback', docNo: 'QR/MFG/013', revNo: '02', revDate: '', brandName: 'MASS POLYMERS', location: '', title: 'MACHINE LOG BOOK',
  productName: 'Untitled', shifts: ['D', 'N'], supervisors: [], lotNumberNote: '', dieZones: ['Die 6', 'Die 5'],
  barrelZones: ['Zone 4', 'Zone 3', 'Zone 2', 'Zone 1'],
  coil: { perM: 150, targetKg: 0, bobbinGms: 0, rangeLo: 0, rangeHi: 0, count: 44 },
  inspectionTimeSlots: ['9–10', '12–1', '3–4', '6–7', '8–9'],
  dimensionSpecs: { top: { label: 'Top Dim', nominal: 0, tol: 0, lo: 0, hi: 0 }, bottom: { label: 'Bottom Dim', nominal: 0, tol: 0, lo: 0, hi: 0 }, thickness: { label: 'Thickness', count: 3, lo: 0, hi: 0 } },
  finishSpec: '', perMeterSpec: '', traceability: { tableCount: 2, rowsPerTable: 15 }, rejectionReasons: [], notes: []
};
