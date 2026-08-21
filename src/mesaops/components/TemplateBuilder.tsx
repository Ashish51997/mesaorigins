/**
 * TemplateBuilder — admin UI to create/edit/clone logbook templates in two
 * layout families (Pipe/Nos, Coil/Roll). Backed by /logbook/templates.
 * Create/edit opens a split form + live Machine Log Book sheet preview.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, Eye, FileSpreadsheet, Plus, Trash2, Copy } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@shared/lib/apiClient';
import { mesaOpsPath } from '@mesaops/lib/apiBase';
import { pushToast } from '@shared/components/Notify';
import { EmptyState } from '@shared/components/EmptyState';
import { DataTable } from '@shared/components/DataTable';
import MachineLogBookSheet, { type LogbookHandlers } from './MachineLogBookSheet';
import PageHeader from '@shared/components/ui/PageHeader';
import { StatusBadge } from '@shared/components/ui/StatusBadge';
import type { LogbookTemplate, MachineLogbook } from '@mesaops/types';

interface ApiTemplate extends LogbookTemplate { _count?: { productionPlans: number; logbooks: number } }

function useTemplates() {
  return useQuery({ queryKey: ['logbook', 'templates'], queryFn: () => api.get<ApiTemplate[]>('/logbook/templates') });
}
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const CSV = (a?: string[]) => (a ?? []).join(', ');
const arr = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const num = (s: string) => { const n = Number.parseFloat(s); return Number.isFinite(n) ? n : 0; };

const inCls = 'w-full min-h-[38px] px-2.5 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200';

const NOOP_HANDLERS: LogbookHandlers = {
  scalar: () => {}, dieZone: () => {}, barrelZone: () => {}, coil: () => {},
  hourly: () => {}, hourlyThickness: () => {}, trace: () => {}, rejection: () => {},
};

function blankPreviewLogbook(t: LogbookTemplate): MachineLogbook {
  const traceLen = Math.max(1, t.traceability.tableCount) * Math.max(1, t.traceability.rowsPerTable);
  const thick = Math.max(0, t.dimensionSpecs.thickness.count);
  return {
    id: 'preview',
    productionPlanId: '',
    templateId: t.id,
    status: 'draft',
    rolls: [],
    scrapKg: '',
    operatorSignature: '',
    supervisorSignature: '',
    machineId: 'M01',
    date: new Date().toISOString().slice(0, 10),
    shift: t.shifts[0] ?? 'D',
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
    productName: t.productName || 'Product name',
    coilWeights: Array.from({ length: Math.max(0, t.coil.count) }, () => ''),
    hourlyInspections: t.inspectionTimeSlots.map((slot) => ({
      timeSlot: slot,
      topDim: '',
      bottomDim: '',
      thickness: Array.from({ length: thick }, () => ''),
      finish: '',
      perMeter: '',
      colour: '',
      tearing: '',
      od: '',
      weight: '',
      okNotOk: '',
      inspectionBy: '',
    })),
    traceabilityRows: Array.from({ length: traceLen }, () => ({ lotNumber: '', colour: '', code: '', winderPackedBy: '', packedBy: '' })),
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
    meterCountSet: '',
  };
}

export default function TemplateBuilder() {
  const q = useTemplates();
  const templates = q.data ?? [];
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/logbook/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logbook', 'templates'] }),
  });
  type EditorState =
    | { mode: 'new'; template: null }
    | { mode: 'edit'; template: ApiTemplate }
    | { mode: 'clone'; template: ApiTemplate };
  const [editor, setEditor] = useState<EditorState | null>(null);

  const remove = (t: ApiTemplate) => {
    if (!window.confirm(`Delete template "${t.productName}"?`)) return;
    del.mutate(t.id, { onSuccess: () => pushToast('Template deleted.'), onError: (e) => pushToast(errMsg(e)) });
  };

  if (editor) {
    const template =
      editor.mode === 'new' ? null
        : editor.mode === 'clone' ? { ...editor.template, id: '', productName: `${editor.template.productName} (copy)` }
          : editor.template;
    return (
      <TemplateEditor
        template={template}
        cloneOf={editor.mode === 'clone'}
        onClose={() => setEditor(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Logbook Templates</h2>
        <button onClick={() => setEditor({ mode: 'new', template: null })} className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium"><Plus className="w-4 h-4" /> New template</button>
      </div>
      <DataTable
        title="Templates"
        loading={q.isLoading}
        rows={templates}
        rowKey={(t) => t.id}
        empty={<EmptyState icon={<FileSpreadsheet className="w-8 h-8" />} title="No templates yet." />}
        columns={[
          { key: 'name', header: 'Product', cell: (t) => <span className="font-bold">{t.productName}</span> },
          { key: 'doc', header: 'Doc / Rev', className: 'font-mono whitespace-nowrap', cell: (t) => `${t.docNo} Rev ${t.revNo}` },
          { key: 'layout', header: 'Layout', cell: (t) => (
            <StatusBadge tone={(t.layout ?? 'coil') === 'pipe' ? 'warn' : 'info'}>
              {(t.layout ?? 'coil') === 'pipe' ? 'Pipe/Nos' : 'Coil/Roll'}
            </StatusBadge>
          ) },
          { key: 'shore', header: 'Shore', cell: (t) => t.hardnessType ?? 'A' },
          { key: 'plans', header: 'Plans', align: 'right', cell: (t) => t._count?.productionPlans ?? 0 },
          { key: 'act', header: '', align: 'right', className: 'whitespace-nowrap', cell: (t) => (
            <div className="inline-flex items-center gap-1.5">
              <button onClick={() => setEditor({ mode: 'clone', template: t })} className="text-slate-400 hover:text-indigo-600 p-1" title="Clone"><Copy className="w-4 h-4" /></button>
              <button onClick={() => setEditor({ mode: 'edit', template: t })} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 text-xs font-bold">Edit</button>
              <button onClick={() => remove(t)} className="text-slate-400 hover:text-rose-600 p-1" title="Delete"><Trash2 className="w-4 h-4" /></button>
            </div>
          ) },
        ]}
      />
    </div>
  );
}

function TemplateEditor({ template, cloneOf, onClose }: { template: ApiTemplate | null; cloneOf?: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!template?.id && !cloneOf;
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => isEdit ? api.patch(mesaOpsPath(`/logbook/templates/${template!.id}`), body) : api.post(mesaOpsPath('/logbook/templates'), body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logbook', 'templates'] }),
  });
  const t = template;
  const [f, setF] = useState({
    productName: t?.productName ?? '', docNo: t?.docNo ?? 'QR/MFG/013', revNo: t?.revNo ?? '', revDate: t?.revDate ?? '',
    brandName: t?.brandName ?? 'MesaOrigins', location: t?.location ?? 'BENGALURU',
    layout: (t?.layout ?? 'coil') as 'pipe' | 'coil', hardnessType: (t?.hardnessType ?? 'A') as 'A' | 'D',
    productionUnit: (t?.productionUnit ?? 'roll') as 'nos' | 'roll', packingNote: t?.packingNote ?? '',
    shifts: CSV(t?.shifts) || 'D, N', supervisors: CSV(t?.supervisors), dieZones: CSV(t?.dieZones) || 'Die 6, Die 5',
    barrelZones: CSV(t?.barrelZones) || 'Zone 4, Zone 3, Zone 2, Zone 1', slots: CSV(t?.inspectionTimeSlots) || '9–10, 12–1, 3–4, 6–7, 8–9',
    rejections: CSV(t?.rejectionReasons), traceRows: String(t?.traceability?.rowsPerTable ?? 14), traceTables: String(t?.traceability?.tableCount ?? (t?.layout === 'pipe' ? 1 : 2)),
    // pipe
    odNom: String(t?.pipeSpecs?.od?.nominal ?? ''), odTol: String(t?.pipeSpecs?.od?.tol ?? ''), odLo: String(t?.pipeSpecs?.od?.lo ?? ''), odHi: String(t?.pipeSpecs?.od?.hi ?? ''),
    wLo: String(t?.pipeSpecs?.weight?.lo ?? ''), wHi: String(t?.pipeSpecs?.weight?.hi ?? ''), gap: t?.pipeSpecs?.dieSizerGap ?? '',
    // coil
    coilPerM: String(t?.coil?.perM ?? '150'), coilKg: String(t?.coil?.targetKg ?? ''), coilCount: String(t?.coil?.count ?? '44'),
    coilLo: String(t?.coil?.rangeLo ?? ''), coilHi: String(t?.coil?.rangeHi ?? ''),
    thickCount: String(t?.dimensionSpecs?.thickness?.count ?? '3'),
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const isPipe = f.layout === 'pipe';

  const draftTemplate = useMemo((): LogbookTemplate => {
    const dieZones = arr(f.dieZones);
    const barrelZones = arr(f.barrelZones);
    const slots = arr(f.slots);
    const rejections = arr(f.rejections);
    const shifts = arr(f.shifts);
    const supervisors = arr(f.supervisors);
    const thickCount = Math.max(0, Math.round(num(f.thickCount)));
    return {
      id: t?.id || 'preview-template',
      docNo: f.docNo.trim() || 'QR/MFG/013',
      revNo: f.revNo.trim() || '01',
      revDate: f.revDate.trim(),
      brandName: f.brandName.trim() || 'MesaOrigins',
      location: f.location.trim() || 'BENGALURU',
      title: t?.title ?? 'MACHINE LOG BOOK',
      productName: f.productName.trim() || 'Product name',
      shifts: shifts.length ? shifts : ['D', 'N'],
      supervisors,
      lotNumberNote: t?.lotNumberNote ?? 'Refer to QR/Store/022',
      dieZones: dieZones.length ? dieZones : ['Die 6', 'Die 5'],
      barrelZones: barrelZones.length ? barrelZones : ['Zone 4', 'Zone 3', 'Zone 2', 'Zone 1'],
      zoneSpecs: t?.zoneSpecs,
      coil: {
        perM: num(f.coilPerM) || 150,
        targetKg: num(f.coilKg),
        bobbinGms: t?.coil?.bobbinGms ?? 0,
        rangeLo: num(f.coilLo),
        rangeHi: num(f.coilHi),
        count: Math.max(0, Math.round(num(f.coilCount))),
      },
      inspectionTimeSlots: slots.length ? slots : ['9–10', '12–1', '3–4', '6–7', '8–9'],
      dimensionSpecs: {
        top: t?.dimensionSpecs?.top ?? { label: 'Top Dim', nominal: 0, tol: 0, lo: 0, hi: 0 },
        bottom: t?.dimensionSpecs?.bottom ?? { label: 'Bottom Dim', nominal: 0, tol: 0, lo: 0, hi: 0 },
        thickness: { label: 'Thickness', count: thickCount, lo: t?.dimensionSpecs?.thickness?.lo ?? 0, hi: t?.dimensionSpecs?.thickness?.hi ?? 0 },
      },
      finishSpec: t?.finishSpec ?? '',
      perMeterSpec: t?.perMeterSpec ?? '',
      traceability: {
        tableCount: Math.max(1, Math.round(num(f.traceTables)) || 1),
        rowsPerTable: Math.max(1, Math.round(num(f.traceRows)) || 1),
      },
      rejectionReasons: rejections,
      notes: t?.notes ?? [],
      layout: f.layout,
      hardnessType: f.hardnessType,
      productionUnit: f.productionUnit,
      packingNote: f.packingNote.trim(),
      pipeSpecs: isPipe
        ? {
          od: { label: 'OD', nominal: num(f.odNom), tol: num(f.odTol), lo: num(f.odLo), hi: num(f.odHi) },
          weight: { label: 'Weight', nominal: num(f.wHi), lo: num(f.wLo), hi: num(f.wHi) },
          dieSizerGap: f.gap.trim(),
        }
        : undefined,
    };
  }, [f, t, isPipe]);

  const previewLogbook = useMemo(() => blankPreviewLogbook(draftTemplate), [draftTemplate]);

  const submit = () => {
    if (!f.productName.trim() || save.isPending) return;
    const body: Record<string, unknown> = {
      productName: f.productName.trim(), docNo: f.docNo.trim(), revNo: f.revNo.trim(), revDate: f.revDate.trim(),
      brandName: f.brandName.trim(), location: f.location.trim(), layout: f.layout, hardnessType: f.hardnessType,
      productionUnit: f.productionUnit, packingNote: f.packingNote.trim(),
      shifts: arr(f.shifts), supervisors: arr(f.supervisors), dieZones: arr(f.dieZones), barrelZones: arr(f.barrelZones),
      inspectionTimeSlots: arr(f.slots), rejectionReasons: arr(f.rejections),
      traceability: { tableCount: Math.max(1, Math.round(num(f.traceTables))), rowsPerTable: Math.max(1, Math.round(num(f.traceRows))) },
    };
    if (isPipe) {
      body.pipeSpecs = { od: { label: 'OD', nominal: num(f.odNom), tol: num(f.odTol), lo: num(f.odLo), hi: num(f.odHi) }, weight: { label: 'Weight', nominal: num(f.wHi), lo: num(f.wLo), hi: num(f.wHi) }, dieSizerGap: f.gap.trim() };
    } else {
      body.coil = { perM: num(f.coilPerM), targetKg: num(f.coilKg), bobbinGms: t?.coil?.bobbinGms ?? 0, rangeLo: num(f.coilLo), rangeHi: num(f.coilHi), count: Math.max(0, Math.round(num(f.coilCount))) };
      body.dimensionSpecs = { top: t?.dimensionSpecs?.top ?? { label: 'Top Dim', nominal: 0, tol: 0, lo: 0, hi: 0 }, bottom: t?.dimensionSpecs?.bottom ?? { label: 'Bottom Dim', nominal: 0, tol: 0, lo: 0, hi: 0 }, thickness: { label: 'Thickness', count: Math.max(0, Math.round(num(f.thickCount))), lo: t?.dimensionSpecs?.thickness?.lo ?? 0, hi: t?.dimensionSpecs?.thickness?.hi ?? 0 } };
    }
    save.mutate(body, { onSuccess: () => { pushToast(`Template "${f.productName.trim()}" ${isEdit ? 'saved' : 'created'}.`); onClose(); }, onError: (e) => pushToast(errMsg(e)) });
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title={isEdit ? 'Edit template' : cloneOf ? 'Clone template' : 'New template'}
        onBack={onClose}
        actions={
          <>
            <button onClick={onClose} className="min-h-11 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-slate-300">Cancel</button>
            <button onClick={submit} disabled={!f.productName.trim() || save.isPending} className="min-h-11 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium inline-flex items-center gap-1.5">
              <FileSpreadsheet className="w-4 h-4" /> {isEdit ? 'Save template' : 'Create template'}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-10 gap-4 items-start">
        {/* Preview — 7/10 (below editor on small screens) */}
        <div className="xl:col-span-7 space-y-2 min-w-0 order-2 xl:order-1">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-700">
            <Eye className="w-3.5 h-3.5" /> Logbook preview
          </div>
          <div className="w-full overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white xl:sticky xl:top-2 xl:max-h-[calc(100vh-9rem)]">
            <MachineLogBookSheet
              logbook={previewLogbook}
              template={draftTemplate}
              on={NOOP_HANDLERS}
              readOnly
              activeSection={0}
              onSelectSection={() => {}}
              activeField={null}
              onSelectField={() => {}}
            />
          </div>
        </div>

        {/* Editor — 3/10 (first on small screens) */}
        <div className="xl:col-span-3 min-w-0 order-1 xl:order-2">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2 xl:sticky xl:top-2 xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto">
            <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Template editor</div>

            <EditorSection title="1. Product & layout" hint="What this logbook is for">
              <Field label="Product name"><input value={f.productName} onChange={(e) => set('productName', e.target.value)} className={inCls} placeholder="e.g. 007 SM RPVC010.C 11MM…" /></Field>
              <Field label="Layout"><select value={f.layout} onChange={(e) => set('layout', e.target.value)} className={inCls}><option value="coil">Coil / Roll</option><option value="pipe">Pipe / Nos</option></select></Field>
              <Field label="Hardness"><select value={f.hardnessType} onChange={(e) => set('hardnessType', e.target.value)} className={inCls}><option value="A">Shore A</option><option value="D">Shore D</option></select></Field>
              <Field label="Production unit"><select value={f.productionUnit} onChange={(e) => set('productionUnit', e.target.value)} className={inCls}><option value="roll">Rolls</option><option value="nos">Nos</option></select></Field>
              <Field label="Packing note"><input value={f.packingNote} onChange={(e) => set('packingNote', e.target.value)} className={inCls} placeholder="Packing 200 Nos / Packing 2 Rolls" /></Field>
            </EditorSection>

            <EditorSection title="2. Document identity" hint="Header printed on the sheet">
              <Field label="Doc No"><input value={f.docNo} onChange={(e) => set('docNo', e.target.value)} className={inCls} /></Field>
              <Field label="Rev No"><input value={f.revNo} onChange={(e) => set('revNo', e.target.value)} className={inCls} /></Field>
              <Field label="Rev Date"><input value={f.revDate} onChange={(e) => set('revDate', e.target.value)} className={inCls} /></Field>
            </EditorSection>

            <EditorSection title="3. Process zones" hint="Die & barrel temperature columns">
              <Field label="Die zones (comma)"><input value={f.dieZones} onChange={(e) => set('dieZones', e.target.value)} className={inCls} placeholder="Die 6, Die 5" /></Field>
              <Field label="Barrel zones (comma)"><input value={f.barrelZones} onChange={(e) => set('barrelZones', e.target.value)} className={inCls} placeholder="Zone 4, Zone 3, …" /></Field>
            </EditorSection>

            <EditorSection title="4. Inspection & staff" hint="Hourly checks and who can be assigned">
              <Field label="Hourly time slots (comma)"><input value={f.slots} onChange={(e) => set('slots', e.target.value)} className={inCls} placeholder="9–10, 12–1, …" /></Field>
              <Field label="Supervisors (comma)"><input value={f.supervisors} onChange={(e) => set('supervisors', e.target.value)} className={inCls} placeholder="Names for dropdowns" /></Field>
            </EditorSection>

            <EditorSection title="5. Traceability & rejections" hint="Packing rows and defect reasons">
              <Field label="Traceability tables"><input value={f.traceTables} onChange={(e) => set('traceTables', e.target.value)} className={inCls} /></Field>
              <Field label="Rows per table"><input value={f.traceRows} onChange={(e) => set('traceRows', e.target.value)} className={inCls} /></Field>
              <Field label="Rejection reasons (comma)"><input value={f.rejections} onChange={(e) => set('rejections', e.target.value)} className={inCls} placeholder="Finishing Issue, Weight Issue, …" /></Field>
            </EditorSection>

            {isPipe ? (
              <EditorSection title="6. Pipe specs" hint="OD, weight ranges, die gap" defaultOpen>
                <Field label="OD nominal"><input value={f.odNom} onChange={(e) => set('odNom', e.target.value)} className={inCls} /></Field>
                <Field label="OD ±tol"><input value={f.odTol} onChange={(e) => set('odTol', e.target.value)} className={inCls} /></Field>
                <Field label="Die & Sizer Gap"><input value={f.gap} onChange={(e) => set('gap', e.target.value)} className={inCls} /></Field>
                <Field label="OD range lo"><input value={f.odLo} onChange={(e) => set('odLo', e.target.value)} className={inCls} /></Field>
                <Field label="OD range hi"><input value={f.odHi} onChange={(e) => set('odHi', e.target.value)} className={inCls} /></Field>
                <Field label="Weight lo (g)"><input value={f.wLo} onChange={(e) => set('wLo', e.target.value)} className={inCls} /></Field>
                <Field label="Weight hi (g)"><input value={f.wHi} onChange={(e) => set('wHi', e.target.value)} className={inCls} /></Field>
              </EditorSection>
            ) : (
              <EditorSection title="6. Coil specs" hint="Coil weights & thickness columns" defaultOpen>
                <Field label="Per / M"><input value={f.coilPerM} onChange={(e) => set('coilPerM', e.target.value)} className={inCls} /></Field>
                <Field label="Target kg"><input value={f.coilKg} onChange={(e) => set('coilKg', e.target.value)} className={inCls} /></Field>
                <Field label="Coil count"><input value={f.coilCount} onChange={(e) => set('coilCount', e.target.value)} className={inCls} /></Field>
                <Field label="Weight range lo"><input value={f.coilLo} onChange={(e) => set('coilLo', e.target.value)} className={inCls} /></Field>
                <Field label="Weight range hi"><input value={f.coilHi} onChange={(e) => set('coilHi', e.target.value)} className={inCls} /></Field>
                <Field label="Thickness cols"><input value={f.thickCount} onChange={(e) => set('thickCount', e.target.value)} className={inCls} /></Field>
              </EditorSection>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorSection({ title, hint, children, defaultOpen = true }: {
  title: string; hint?: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-2 px-3 py-2.5 text-left bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <span className="min-w-0">
          <span className="block text-[12px] font-bold text-slate-800 dark:text-slate-100">{title}</span>
          {hint && <span className="block text-[10px] text-slate-500 mt-0.5">{hint}</span>}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 mt-0.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-3 pb-3 pt-2 space-y-2.5 border-t border-slate-100 dark:border-slate-700">{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="block text-[11px] font-bold text-slate-500 mb-1">{label}</span>{children}</label>;
}
