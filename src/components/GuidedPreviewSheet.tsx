/**
 * GuidedPreviewSheet.tsx — the read-only "Live Digital Sheet Preview" shown on the left
 * of GUIDED mode. Mirrors the reference UX: 5 step-highlighted section cards, amber
 * field-focus boxes, "Step N" badges, and smooth scroll to the active section. Driven by
 * the wizard's activeField; clicking a field/section also drives the wizard (onSelectField).
 * Adapted to the current MachineLogbook / LogbookTemplate model + new theme.
 */

import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { Building2, Cpu, Flame, Clock, Layers, AlertTriangle, Sparkles, Eye, Printer, MousePointerClick, CheckCircle2, XCircle, Paperclip } from 'lucide-react';
import { LogbookTemplate, MachineLogbook } from '../types';

const PROCESS_KEYS = ['motorSpeed', 'ampere', 'takeupSpeed', 'vacuum', 'extruderStartTime', 'productSetTime', 'shoreHardness', 'productionPerHour'];

export function sectionOfPreview(f: string | null): number {
  if (!f) return 1;
  if (f.startsWith('die:') || f.startsWith('barrel:') || PROCESS_KEYS.includes(f) || f === 'coil' || f.startsWith('coil')) return 2;
  if (f.startsWith('hourly')) return 3;
  if (f === 'rolls' || f.startsWith('roll') || f === 'traceability' || f.startsWith('trace')) return 4;
  if (f === 'signoff' || f === 'production' || f.startsWith('scrap') || f.startsWith('rej') || f.startsWith('meter') || f.startsWith('process') || f.startsWith('lumps')) return 5;
  return 1;
}

export default function GuidedPreviewSheet({ logbook: l, template: t, activeField, onSelectField }: {
  logbook: MachineLogbook; template: LogbookTemplate; activeField: string | null; onSelectField?: (f: string) => void;
}): ReactElement {
  const refs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const activeSection = sectionOfPreview(activeField);

  useEffect(() => {
    refs[activeSection - 1]?.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeField]);

  const focused = (key: string): boolean => activeField === key;
  const sel = (key: string) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); onSelectField?.(key); };
  const num = (v: string): number => Number.parseFloat(v);

  const good = l.rolls.filter((r) => r.status === 'passed').reduce((s, r) => s + (r.weight || 0), 0);
  const rej = l.rolls.filter((r) => r.status === 'failed').reduce((s, r) => s + (r.weight || 0), 0);

  const SectionCard = ({ n, prefix, boxRef, badge, title, icon, right, children }: {
    n: number; prefix: string; boxRef: RefObject<HTMLDivElement | null>; badge: string; title: string; icon: ReactNode; right?: ReactNode; children: ReactNode;
  }): ReactElement => {
    const on = activeSection === n;
    return (
      <div ref={boxRef} onClick={sel(prefix)} className={`transition-all rounded-md p-2 border cursor-pointer relative ${on ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 ring-1 ring-indigo-400 shadow-3xs' : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-slate-50/30 dark:bg-slate-900/40'}`}>
        {on && (
          <span className="absolute -top-2 right-2 bg-indigo-600 text-white font-bold text-[8px] uppercase px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Sparkles className="w-2 h-2" /> {badge}
          </span>
        )}
        <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-700 pb-1 mb-1.5">
          <span className="font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wide text-[10px] flex items-center gap-1">{icon}{title}</span>
          {right}
        </div>
        {children}
      </div>
    );
  };

  const Field = ({ k, label, value, span = 1, mono = true }: { k: string; label: string; value: ReactNode; span?: number; mono?: boolean }): ReactElement => (
    <div onClick={sel(k)} className={`${span === 2 ? 'col-span-2' : ''} p-1 rounded border transition-all cursor-pointer ${focused(k) ? 'bg-amber-100 border-amber-400 font-bold ring-1 ring-amber-400' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}>
      <span className="text-slate-500 font-semibold block text-[8px] uppercase">{label}</span>
      <span className={`text-slate-900 dark:text-slate-100 ${mono ? 'font-mono' : 'font-medium'}`}>{value || '—'}</span>
    </div>
  );

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-3xs border border-slate-200 dark:border-slate-800 p-3 text-xs sheet-wrap">
      {/* control bar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2 pb-2 border-b border-slate-200 dark:border-slate-800 no-print">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 font-bold rounded text-[10px]"><Eye className="w-3 h-3" /> Live Digital Sheet Preview</span>
          <span className="text-slate-400 text-[9px] hidden sm:inline-block">ISO 9001:2015 Production Log</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[9px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200"><MousePointerClick className="w-2.5 h-2.5 animate-bounce" /> Fill on the right — it lights up here</span>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded"><Printer className="w-3 h-3" /> Print</button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-800 dark:border-slate-600 p-2 sm:p-3 rounded space-y-2.5">
        {/* document header */}
        <div className="border border-slate-800 dark:border-slate-600 rounded overflow-hidden">
          <div className="grid grid-cols-12 border-b border-slate-800 dark:border-slate-600 text-center bg-slate-50 dark:bg-slate-950">
            <div className="col-span-3 p-1.5 border-r border-slate-800 dark:border-slate-600 flex flex-col justify-center items-center">
              <div className="flex items-center gap-1 font-black text-indigo-900 dark:text-indigo-300 tracking-wider text-xs sm:text-sm"><Building2 className="w-3.5 h-3.5 text-indigo-600" /> {t.brandName || 'MASS POLIMER'}</div>
              <span className="text-[8px] uppercase font-bold text-slate-500">Quality Management System</span>
            </div>
            <div className="col-span-6 p-1 border-r border-slate-800 dark:border-slate-600 flex flex-col justify-center">
              <h1 className="font-extrabold text-slate-900 dark:text-white uppercase tracking-wide text-[11px] sm:text-xs">{t.title || 'MACHINE PRODUCTION SHIFT LOG BOOK SHEET'}</h1>
              <span className="text-[9px] text-slate-600 dark:text-slate-300 font-mono font-semibold">{l.productName || t.productName}</span>
            </div>
            <div className="col-span-3 p-1 text-left text-[8px] font-mono space-y-0.5 bg-white dark:bg-slate-900">
              <div><strong className="text-slate-700 dark:text-slate-300">DOC NO:</strong> {t.docNo}</div>
              <div><strong className="text-slate-700 dark:text-slate-300">REV NO:</strong> {t.revNo}</div>
              <div><strong className="text-slate-700 dark:text-slate-300">DATE:</strong> {l.date}</div>
              <div><strong className="text-slate-700 dark:text-slate-300">PAGE:</strong> 1 of 1</div>
            </div>
          </div>
        </div>

        {/* Section 1 — header */}
        <SectionCard n={1} prefix="machineId" boxRef={refs[0]} badge="Step 1: Shift Header" icon={<Cpu className="w-3 h-3 text-indigo-600" />} title="1. Machine Identification & Shift Header"
          right={<span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${l.status === 'submitted' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>Status: {l.status.toUpperCase()}</span>}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px]">
            <Field k="machineId" label="Machine No" value={l.machineId} />
            <Field k="shift" label="Shift" value={l.shift} />
            <Field k="date" label="Shift Date" value={l.date} />
            <Field k="supervisor" label="Supervisor" value={l.supervisor} mono={false} />
            <Field k="drawingNo" label="Drawing No" value={l.drawingNo} />
            <Field k="formulaNo" label="Formula No" value={l.formulaNo} />
            <Field k="moldNo" label="Mold No" value={l.moldNo} />
            <Field k="productName" label="Target Product" value={l.productName} span={1} mono={false} />
          </div>
        </SectionCard>

        {/* Section 2 — process + zones */}
        <SectionCard n={2} prefix="die:" boxRef={refs[1]} badge="Step 2: Process Settings" icon={<Flame className="w-3.5 h-3.5 text-rose-500 animate-pulse" />} title="2. Barrel & Die Temperature (°C) & Process Parameters"
          right={<span className="text-[10px] text-slate-500 font-mono">{t.dieZones.length + t.barrelZones.length} zones</span>}>
          <div className="mb-3">
            <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Zone Temperature Profile (°C)</span>
            <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-8 gap-1.5">
              {[...t.dieZones.map((z) => ({ z, k: `die:${z}`, v: l.dieZoneTemps[z] ?? '' })), ...t.barrelZones.map((z) => ({ z, k: `barrel:${z}`, v: l.barrelZoneTemps[z] ?? '' }))].map(({ z, k, v }) => {
                const zs = t.zoneSpecs?.[z];
                const ranged = zs && zs.max > zs.min;
                const oor = ranged && v.trim() !== '' && !Number.isNaN(num(v)) && (num(v) < zs!.min || num(v) > zs!.max);
                return (
                  <div key={k} onClick={sel(k)} className={`p-1.5 rounded text-center border transition-all cursor-pointer ${focused(k) ? 'bg-amber-100 border-amber-500 ring-2 ring-amber-400 font-bold scale-105' : oor ? 'bg-rose-50 border-rose-300 text-rose-900' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}>
                    <span className="block text-[8px] font-bold uppercase text-slate-500">{z}</span>
                    <span className={`font-mono text-xs ${oor ? 'text-rose-700 font-bold' : 'text-slate-900 dark:text-slate-100 font-semibold'}`}>{v || '—'}{v ? '°C' : ''}</span>
                    {ranged && <span className="block text-[7px] text-slate-400 font-mono">Target: {zs!.target}°C</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
            <Field k="motorSpeed" label="Motor Speed" value={l.motorSpeed} />
            <Field k="ampere" label="Load (Ampere)" value={l.ampere} />
            <Field k="takeupSpeed" label="Takeup Speed" value={l.takeupSpeed} />
            <Field k="vacuum" label="Vacuum" value={l.vacuum} />
            <Field k="extruderStartTime" label="Extruder Start" value={l.extruderStartTime} />
            <Field k="productSetTime" label="Product Set Time" value={l.productSetTime} />
            <Field k="shoreHardness" label="Shore A Hardness" value={l.shoreHardness} />
            <Field k="productionPerHour" label="Production / Hour" value={l.productionPerHour} />
          </div>
        </SectionCard>

        {/* Section 3 — hourly */}
        <SectionCard n={3} prefix="hourly" boxRef={refs[2]} badge="Step 3: Hourly Checks" icon={<Clock className="w-3.5 h-3.5 text-indigo-600" />} title="3. Hourly Quality & Dimensional Inspection Log"
          right={<span className="text-[10px] text-slate-500 font-mono">{l.hourlyInspections.filter((r) => r.inspectionBy || r.finish).length} recorded</span>}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[10px] border-collapse border border-slate-300 dark:border-slate-700">
              <thead><tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold border-b border-slate-300 dark:border-slate-700">
                <th className="p-1.5 border-r border-slate-300 dark:border-slate-700">Time</th>
                <th className="p-1.5 border-r border-slate-300 dark:border-slate-700">{t.dimensionSpecs.top.label}</th>
                <th className="p-1.5 border-r border-slate-300 dark:border-slate-700">{t.dimensionSpecs.bottom.label}</th>
                <th className="p-1.5 border-r border-slate-300 dark:border-slate-700">Finish</th>
                <th className="p-1.5 border-r border-slate-300 dark:border-slate-700">Colour</th>
                <th className="p-1.5">Inspector</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono">
                {l.hourlyInspections.map((r, i) => (
                  <tr key={i} className="bg-white dark:bg-slate-900">
                    <td className="p-1.5 border-r border-slate-200 dark:border-slate-800 font-semibold">{r.timeSlot}</td>
                    <td className="p-1.5 border-r border-slate-200 dark:border-slate-800">{r.topDim || '—'}</td>
                    <td className="p-1.5 border-r border-slate-200 dark:border-slate-800">{r.bottomDim || '—'}</td>
                    <td className="p-1.5 border-r border-slate-200 dark:border-slate-800">{r.finish || '—'}</td>
                    <td className="p-1.5 border-r border-slate-200 dark:border-slate-800">{r.colour || '—'}</td>
                    <td className="p-1.5 font-sans text-slate-700 dark:text-slate-300">{r.inspectionBy || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* Section 4 — rolls */}
        <SectionCard n={4} prefix="rolls" boxRef={refs[3]} badge="Step 4: Finished Rolls" icon={<Layers className="w-3.5 h-3.5 text-indigo-600" />} title="4. Finished Goods Roll / Spool Output Register"
          right={<span className="text-[10px] text-slate-500 font-mono">Output: {l.rolls.reduce((s, r) => s + (r.weight || 0), 0).toFixed(1)} kg</span>}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[10px] border-collapse border border-slate-300 dark:border-slate-700">
              <thead><tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold border-b border-slate-300 dark:border-slate-700">
                <th className="p-1.5 border-r border-slate-300 dark:border-slate-700">Roll No</th>
                <th className="p-1.5 border-r border-slate-300 dark:border-slate-700">Weight</th>
                <th className="p-1.5 border-r border-slate-300 dark:border-slate-700">Length</th>
                <th className="p-1.5 border-r border-slate-300 dark:border-slate-700">Winder</th>
                <th className="p-1.5">QC</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono">
                {l.rolls.length > 0 ? l.rolls.map((r, i) => (
                  <tr key={i} className="bg-white dark:bg-slate-900">
                    <td className="p-1.5 border-r border-slate-200 dark:border-slate-800 font-bold text-indigo-900 dark:text-indigo-300">{r.rollNumber}</td>
                    <td className="p-1.5 border-r border-slate-200 dark:border-slate-800">{r.weight} kg</td>
                    <td className="p-1.5 border-r border-slate-200 dark:border-slate-800">{r.length} m</td>
                    <td className="p-1.5 border-r border-slate-200 dark:border-slate-800 font-sans">{r.winderBy || '—'}</td>
                    <td className="p-1.5"><span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold inline-flex items-center gap-1 ${r.status === 'passed' ? 'bg-emerald-100 text-emerald-800' : r.status === 'failed' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>{r.status === 'passed' ? <CheckCircle2 className="w-2.5 h-2.5" /> : r.status === 'failed' ? <XCircle className="w-2.5 h-2.5" /> : null}{r.status}</span></td>
                  </tr>
                )) : <tr><td colSpan={5} className="p-3 text-center text-slate-400 italic bg-slate-50 dark:bg-slate-950 font-sans">No rolls yet — register them on the right at Step 4.</td></tr>}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* Section 5 — mass balance + sign-off */}
        <SectionCard n={5} prefix="signoff" boxRef={refs[4]} badge="Step 5: Rejections & Sign-off" icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-500" />} title="5. Rejections, Scrap Summary & Supervisor Authorization"
          right={<span className="text-[10px] text-slate-500 font-mono">Consumed: {l.totalConsumedKg || 0} kg</span>}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
            <div className="space-y-2 bg-white dark:bg-slate-900 p-2.5 rounded border border-slate-200 dark:border-slate-700">
              <span className="block font-bold text-slate-700 dark:text-slate-200 text-[10px] uppercase">Material Balance</span>
              <div className="grid grid-cols-3 gap-2 font-mono text-center">
                <div onClick={sel('scrap')} className={`p-1 rounded border cursor-pointer ${focused('scrap') ? 'bg-amber-100 border-amber-400 font-bold' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                  <span className="block text-[8px] text-slate-500 font-semibold">Start Scrap</span>
                  <span className="font-bold text-slate-800 dark:text-slate-100">{l.scrapKg || 0} kg</span>
                </div>
                <div className="p-1 bg-rose-50 rounded border border-rose-200"><span className="block text-[8px] text-rose-600 font-semibold">Rejections</span><span className="font-bold text-rose-800">{rej.toFixed(1)} kg</span></div>
                <div className="p-1 bg-emerald-50 rounded border border-emerald-200"><span className="block text-[8px] text-emerald-600 font-semibold">Good Rolls</span><span className="font-bold text-emerald-800">{good.toFixed(1)} kg</span></div>
              </div>
              <div className="pt-1">
                <span className="block text-[9px] font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">Defect reasons</span>
                <div className="flex flex-wrap gap-1">
                  {t.rejectionReasons.map((reason) => {
                    const cnt = l.rejectionCounts[reason];
                    const flagged = cnt != null && cnt.trim() !== '' && cnt.trim() !== '0';
                    return <span key={reason} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium border ${flagged ? 'bg-rose-100 text-rose-800 border-rose-300 font-bold' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-70'}`}>{flagged ? `✓ ${reason} (${cnt})` : `○ ${reason}`}</span>;
                  })}
                </div>
              </div>
            </div>
            <div className="space-y-2 bg-white dark:bg-slate-900 p-2.5 rounded border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
              <div>
                <span className="block font-bold text-slate-700 dark:text-slate-200 text-[10px] uppercase mb-1">Scanned physical sheet</span>
                {l.attachedImage ? (
                  <div className="flex items-center gap-2 bg-indigo-50/50 dark:bg-indigo-950/30 p-2 rounded border border-indigo-200 dark:border-indigo-900"><Paperclip className="w-4 h-4 text-indigo-600" /><span className="text-[10px] font-semibold text-indigo-900 dark:text-indigo-300 truncate">Physical copy attached</span></div>
                ) : <span className="text-[10px] text-slate-400 italic">No physical sheet image attached</span>}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                <div onClick={sel('signoff')} className={`border rounded p-1.5 text-center cursor-pointer ${focused('signoff') ? 'bg-amber-100 border-amber-400' : 'border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800'}`}>
                  <span className="block text-[8px] font-bold text-slate-400 uppercase">Operator</span>
                  <div className="h-6 flex items-center justify-center text-xs font-serif italic text-slate-800 dark:text-slate-100">{l.operatorSignature || '—'}</div>
                </div>
                <div onClick={sel('signoff')} className={`border rounded p-1.5 text-center cursor-pointer ${focused('signoff') ? 'bg-amber-100 border-amber-400' : 'border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800'}`}>
                  <span className="block text-[8px] font-bold text-slate-400 uppercase">Shift Supervisor</span>
                  <div className="h-6 flex items-center justify-center text-xs font-serif italic text-indigo-900 dark:text-indigo-300 font-bold">{l.supervisorSignature || l.supervisor || '—'}</div>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
