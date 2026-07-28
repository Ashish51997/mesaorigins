/**
 * TemplateBuilder — admin UI to create/edit/clone logbook templates in two
 * layout families (Pipe/Nos, Coil/Roll). Backed by /logbook/templates.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { FileSpreadsheet, Plus, X, Trash2, Copy } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/apiClient';
import { pushToast } from './Notify';
import { EmptyState } from './EmptyState';
import { DataTable } from './DataTable';
import type { LogbookTemplate } from '../types';

interface ApiTemplate extends LogbookTemplate { _count?: { productionPlans: number; logbooks: number } }

function useTemplates() {
  return useQuery({ queryKey: ['logbook', 'templates'], queryFn: () => api.get<ApiTemplate[]>('/logbook/templates') });
}
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const CSV = (a?: string[]) => (a ?? []).join(', ');
const arr = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const num = (s: string) => { const n = Number.parseFloat(s); return Number.isFinite(n) ? n : 0; };

const inCls = 'w-full min-h-[38px] px-2.5 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200';

export default function TemplateBuilder() {
  const q = useTemplates();
  const templates = q.data ?? [];
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/logbook/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logbook', 'templates'] }),
  });
  const [edit, setEdit] = useState<ApiTemplate | 'new' | null>(null);
  const [clone, setClone] = useState<ApiTemplate | null>(null);

  const remove = (t: ApiTemplate) => {
    if (!window.confirm(`Delete template "${t.productName}"?`)) return;
    del.mutate(t.id, { onSuccess: () => pushToast('Template deleted.'), onError: (e) => pushToast(errMsg(e)) });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Logbook Templates</h2>
        <button onClick={() => setEdit('new')} className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold"><Plus className="w-4 h-4" /> New template</button>
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
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${(t.layout ?? 'coil') === 'pipe' ? 'bg-amber-100 text-amber-800' : 'bg-cyan-100 text-cyan-800'}`}>{(t.layout ?? 'coil') === 'pipe' ? 'Pipe/Nos' : 'Coil/Roll'}</span>
          ) },
          { key: 'shore', header: 'Shore', cell: (t) => t.hardnessType ?? 'A' },
          { key: 'plans', header: 'Plans', align: 'right', cell: (t) => t._count?.productionPlans ?? 0 },
          { key: 'act', header: '', align: 'right', className: 'whitespace-nowrap', cell: (t) => (
            <div className="inline-flex items-center gap-1.5">
              <button onClick={() => setClone(t)} className="text-slate-400 hover:text-indigo-600 p-1" title="Clone"><Copy className="w-4 h-4" /></button>
              <button onClick={() => setEdit(t)} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 text-xs font-bold">Edit</button>
              <button onClick={() => remove(t)} className="text-slate-400 hover:text-rose-600 p-1" title="Delete"><Trash2 className="w-4 h-4" /></button>
            </div>
          ) },
        ]}
      />
      {edit && <TemplateModal template={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {clone && <TemplateModal template={{ ...clone, id: '', productName: `${clone.productName} (copy)` }} cloneOf onClose={() => setClone(null)} />}
    </div>
  );
}

function TemplateModal({ template, cloneOf, onClose }: { template: ApiTemplate | null; cloneOf?: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!template?.id && !cloneOf;
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => isEdit ? api.patch(`/logbook/templates/${template!.id}`, body) : api.post('/logbook/templates', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logbook', 'templates'] }),
  });
  const t = template;
  const [f, setF] = useState({
    productName: t?.productName ?? '', docNo: t?.docNo ?? 'QR/MFG/013', revNo: t?.revNo ?? '', revDate: t?.revDate ?? '',
    brandName: t?.brandName ?? 'MASS POLYMERS', location: t?.location ?? 'BENGALURU',
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
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-lg w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-slate-900 dark:text-white">{isEdit ? 'Edit template' : cloneOf ? 'Clone template' : 'New template'}</h3><button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><X className="w-4 h-4" /></button></div>

        <Row><Field label="Product name" span><input value={f.productName} onChange={(e) => set('productName', e.target.value)} className={inCls} placeholder="e.g. 007 SM RPVC010.C 11MM…" /></Field></Row>
        <Row>
          <Field label="Layout"><select value={f.layout} onChange={(e) => set('layout', e.target.value)} className={inCls}><option value="coil">Coil / Roll</option><option value="pipe">Pipe / Nos</option></select></Field>
          <Field label="Hardness"><select value={f.hardnessType} onChange={(e) => set('hardnessType', e.target.value)} className={inCls}><option value="A">Shore A</option><option value="D">Shore D</option></select></Field>
          <Field label="Production unit"><select value={f.productionUnit} onChange={(e) => set('productionUnit', e.target.value)} className={inCls}><option value="roll">Rolls</option><option value="nos">Nos</option></select></Field>
        </Row>
        <Row>
          <Field label="Doc No"><input value={f.docNo} onChange={(e) => set('docNo', e.target.value)} className={inCls} /></Field>
          <Field label="Rev No"><input value={f.revNo} onChange={(e) => set('revNo', e.target.value)} className={inCls} /></Field>
          <Field label="Rev Date"><input value={f.revDate} onChange={(e) => set('revDate', e.target.value)} className={inCls} /></Field>
        </Row>
        <Row><Field label="Packing note" span><input value={f.packingNote} onChange={(e) => set('packingNote', e.target.value)} className={inCls} placeholder="Packing 200 Nos / Packing 2 Rolls" /></Field></Row>
        <Row><Field label="Die zones (comma)"><input value={f.dieZones} onChange={(e) => set('dieZones', e.target.value)} className={inCls} /></Field>
          <Field label="Barrel zones (comma)" span><input value={f.barrelZones} onChange={(e) => set('barrelZones', e.target.value)} className={inCls} /></Field></Row>
        <Row><Field label="Hourly time slots (comma)"><input value={f.slots} onChange={(e) => set('slots', e.target.value)} className={inCls} /></Field>
          <Field label="Supervisors (comma)" span><input value={f.supervisors} onChange={(e) => set('supervisors', e.target.value)} className={inCls} /></Field></Row>
        <Row><Field label="Rejection reasons (comma)" span><input value={f.rejections} onChange={(e) => set('rejections', e.target.value)} className={inCls} placeholder="Finishing Issue, Weight Issue, …" /></Field></Row>
        <Row><Field label="Traceability tables"><input value={f.traceTables} onChange={(e) => set('traceTables', e.target.value)} className={inCls} /></Field>
          <Field label="Rows per table"><input value={f.traceRows} onChange={(e) => set('traceRows', e.target.value)} className={inCls} /></Field><div /></Row>

        {isPipe ? (
          <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
            <div className="text-[11px] font-bold text-slate-500 mb-2">Pipe specs</div>
            <Row><Field label="OD nominal"><input value={f.odNom} onChange={(e) => set('odNom', e.target.value)} className={inCls} /></Field>
              <Field label="OD ±tol"><input value={f.odTol} onChange={(e) => set('odTol', e.target.value)} className={inCls} /></Field>
              <Field label="Die & Sizer Gap"><input value={f.gap} onChange={(e) => set('gap', e.target.value)} className={inCls} /></Field></Row>
            <Row><Field label="OD range lo"><input value={f.odLo} onChange={(e) => set('odLo', e.target.value)} className={inCls} /></Field>
              <Field label="OD range hi"><input value={f.odHi} onChange={(e) => set('odHi', e.target.value)} className={inCls} /></Field><div /></Row>
            <Row><Field label="Weight lo (g)"><input value={f.wLo} onChange={(e) => set('wLo', e.target.value)} className={inCls} /></Field>
              <Field label="Weight hi (g)"><input value={f.wHi} onChange={(e) => set('wHi', e.target.value)} className={inCls} /></Field><div /></Row>
          </div>
        ) : (
          <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
            <div className="text-[11px] font-bold text-slate-500 mb-2">Coil specs</div>
            <Row><Field label="Per / M"><input value={f.coilPerM} onChange={(e) => set('coilPerM', e.target.value)} className={inCls} /></Field>
              <Field label="Target kg"><input value={f.coilKg} onChange={(e) => set('coilKg', e.target.value)} className={inCls} /></Field>
              <Field label="Coil count"><input value={f.coilCount} onChange={(e) => set('coilCount', e.target.value)} className={inCls} /></Field></Row>
            <Row><Field label="Weight range lo"><input value={f.coilLo} onChange={(e) => set('coilLo', e.target.value)} className={inCls} /></Field>
              <Field label="Weight range hi"><input value={f.coilHi} onChange={(e) => set('coilHi', e.target.value)} className={inCls} /></Field>
              <Field label="Thickness cols"><input value={f.thickCount} onChange={(e) => set('thickCount', e.target.value)} className={inCls} /></Field></Row>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="min-h-[42px] px-4 rounded-full border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={submit} disabled={!f.productName.trim() || save.isPending} className="min-h-[42px] px-5 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold inline-flex items-center gap-1.5"><FileSpreadsheet className="w-4 h-4" /> {isEdit ? 'Save template' : 'Create template'}</button>
        </div>
      </div>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) { return <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{children}</div>; }
function Field({ label, children, span }: { label: string; children: ReactNode; span?: boolean }) {
  return <label className={span ? 'sm:col-span-2 block' : 'block'}><span className="block text-[11px] font-bold text-slate-500 mb-1">{label}</span>{children}</label>;
}
