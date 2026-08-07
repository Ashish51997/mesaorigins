/**
 * GuidedPreviewSheet.tsx — read-only live preview on the left of Guided mode.
 * Active section and field use MesaDesk primary soft/blue; amber is reserved for
 * out-of-range values. Clicking a field drives the wizard via onSelectField.
 */

import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { Building2, Cpu, Flame, Clock, Layers, AlertTriangle, Sparkles, Eye, Printer, MousePointerClick, CheckCircle2, XCircle, Paperclip } from 'lucide-react';
import { LogbookTemplate, MachineLogbook } from '../types';
import { StatusBadge } from './ui/StatusBadge';

const PROCESS_KEYS = ['motorSpeed', 'ampere', 'takeupSpeed', 'vacuum', 'extruderStartTime', 'productSetTime', 'shoreHardness', 'productionPerHour'];

export function sectionOfPreview(f: string | null): number {
  if (!f) return 1;
  if (f.startsWith('die:') || f.startsWith('barrel:') || PROCESS_KEYS.includes(f) || f === 'coil' || f.startsWith('coil')) return 2;
  if (f.startsWith('hourly')) return 3;
  if (f === 'rolls' || f.startsWith('roll') || f === 'traceability' || f.startsWith('trace')) return 4;
  if (f === 'signoff' || f === 'production' || f.startsWith('scrap') || f.startsWith('rej') || f.startsWith('meter') || f.startsWith('process') || f.startsWith('lumps')) return 5;
  return 1;
}

const focusField = 'bg-[#DBEAFE] border-[#1E40AF] ring-2 ring-[#1E40AF]/font-semibold';
const idleField = 'bg-white border-slate-200 hover:border-slate-300';

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
      <div
        ref={boxRef}
        onClick={sel(prefix)}
        className={`relative cursor-pointer rounded-xl border p-3 transition-colors ${
          on
            ? 'border-[#1E40AF] bg-[#DBEAFE]/40 ring-1 ring-[#1E40AF]'
            : 'border-slate-200 bg-slate-50/40 hover:border-slate-300'
        }`}
      >
        {on && (
          <span className="absolute -top-2 right-2 inline-flex items-center gap-0.5 rounded-md bg-[#1E40AF] px-1.5 py-0.5 text-[10px] font-medium uppercase text-white">
            <Sparkles className="h-2.5 w-2.5" /> {badge}
          </span>
        )}
        <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-1.5">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-800">
            {icon}{title}
          </span>
          {right}
        </div>
        {children}
      </div>
    );
  };

  const Field = ({ k, label, value, span = 1, mono = true }: { k: string; label: string; value: ReactNode; span?: number; mono?: boolean }): ReactElement => (
    <div
      onClick={sel(k)}
      className={`${span === 2 ? 'col-span-2' : ''} cursor-pointer rounded-lg border p-1.5 transition-colors ${focused(k) ? focusField : idleField}`}
    >
      <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`mt-0.5 block text-[12px] text-slate-900 ${mono ? 'font-mono' : 'font-medium'}`}>{value || '—'}</span>
    </div>
  );

  return (
    <div className="sheet-wrap rounded-xl border border-slate-200 bg-white p-3 text-xs">
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#BFDBFE] bg-[#DBEAFE] px-2.5 py-1 text-[11px] font-semibold text-[#1E40AF]">
            <Eye className="h-3.5 w-3.5" /> Live sheet preview
          </span>
          <span className="hidden text-[11px] text-slate-400 sm:inline">ISO 9001:2015 production log</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
            <MousePointerClick className="h-3 w-3 text-[#1E40AF]" /> Fill on the right — it highlights here
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-2.5 sm:p-3">
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="grid grid-cols-12 border-b border-slate-200 bg-slate-50 text-center">
            <div className="col-span-3 flex flex-col items-center justify-center border-r border-slate-200 p-2">
              <div className="flex items-center gap-1 text-xs font-extrabold tracking-wide text-slate-900 sm:text-sm">
                <Building2 className="h-3.5 w-3.5 text-[#1E40AF]" /> {t.brandName || 'MesaDesk'}
              </div>
              <span className="text-[10px] font-medium uppercase text-slate-500">Quality Management System</span>
            </div>
            <div className="col-span-6 flex flex-col justify-center border-r border-slate-200 p-2">
              <h1 className="text-[11px] font-extrabold uppercase tracking-wide text-slate-900 sm:text-xs">{t.title || 'MACHINE PRODUCTION SHIFT LOG BOOK SHEET'}</h1>
              <span className="font-mono text-[11px] font-semibold text-slate-600">{l.productName || t.productName}</span>
            </div>
            <div className="col-span-3 space-y-0.5 bg-white p-2 text-left font-mono text-[10px]">
              <div><strong className="text-slate-600">DOC NO:</strong> {t.docNo}</div>
              <div><strong className="text-slate-600">REV NO:</strong> {t.revNo}</div>
              <div><strong className="text-slate-600">DATE:</strong> {l.date}</div>
              <div><strong className="text-slate-600">PAGE:</strong> 1 of 1</div>
            </div>
          </div>
        </div>

        <SectionCard n={1} prefix="machineId" boxRef={refs[0]} badge="Shift header" icon={<Cpu className="h-3.5 w-3.5 text-[#1E40AF]" />} title="1. Machine & shift"
          right={<StatusBadge tone={l.status === 'submitted' ? 'success' : 'warn'}>{l.status === 'submitted' ? 'Closed' : 'Draft'}</StatusBadge>}>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Field k="machineId" label="Machine No" value={l.machineId} />
            <Field k="shift" label="Shift" value={l.shift} />
            <Field k="date" label="Shift Date" value={l.date} />
            <Field k="supervisor" label="Supervisor" value={l.supervisor} mono={false} />
            <Field k="drawingNo" label="Drawing No" value={l.drawingNo} />
            <Field k="formulaNo" label="Formula No" value={l.formulaNo} />
            <Field k="moldNo" label="Mold No" value={l.moldNo} />
            <Field k="productName" label="Target Product" value={l.productName} mono={false} />
          </div>
        </SectionCard>

        <SectionCard n={2} prefix="die:" boxRef={refs[1]} badge="Process" icon={<Flame className="h-3.5 w-3.5 text-[#1E40AF]" />} title="2. Zones & process"
          right={<span className="font-mono text-[11px] text-slate-500">{t.dieZones.length + t.barrelZones.length} zones</span>}>
          <div className="mb-3">
            <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Zone temperature (°C)</span>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
              {[...t.dieZones.map((z) => ({ z, k: `die:${z}`, v: l.dieZoneTemps[z] ?? '' })), ...t.barrelZones.map((z) => ({ z, k: `barrel:${z}`, v: l.barrelZoneTemps[z] ?? '' }))].map(({ z, k, v }) => {
                const zs = t.zoneSpecs?.[z];
                const ranged = zs && zs.max > zs.min;
                const oor = ranged && v.trim() !== '' && !Number.isNaN(num(v)) && (num(v) < zs!.min || num(v) > zs!.max);
                return (
                  <div
                    key={k}
                    onClick={sel(k)}
                    className={`cursor-pointer rounded-lg border p-1.5 text-center transition-colors ${
                      focused(k)
                        ? focusField
                        : oor
                          ? 'border-rose-300 bg-rose-50 text-rose-900'
                          : idleField
                    }`}
                  >
                    <span className="block text-[9px] font-medium uppercase text-slate-500">{z}</span>
                    <span className={`font-mono text-[12px] ${oor ? 'font-bold text-rose-700' : 'font-semibold text-slate-900'}`}>{v || '—'}{v ? '°C' : ''}</span>
                    {ranged && <span className="block font-mono text-[9px] text-slate-400">Target {zs!.target}°</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
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

        <SectionCard n={3} prefix="hourly" boxRef={refs[2]} badge="Hourly checks" icon={<Clock className="h-3.5 w-3.5 text-[#1E40AF]" />} title="3. Hourly inspection"
          right={<span className="font-mono text-[11px] text-slate-500">{l.hourlyInspections.filter((r) => r.inspectionBy || r.finish).length} recorded</span>}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-slate-200 text-left text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="border-r border-slate-200 p-2">Time</th>
                  <th className="border-r border-slate-200 p-2">{t.dimensionSpecs.top.label}</th>
                  <th className="border-r border-slate-200 p-2">{t.dimensionSpecs.bottom.label}</th>
                  <th className="border-r border-slate-200 p-2">Finish</th>
                  <th className="border-r border-slate-200 p-2">Colour</th>
                  <th className="p-2">Inspector</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {l.hourlyInspections.map((r, i) => (
                  <tr key={i} className="bg-white">
                    <td className="border-r border-slate-100 p-2 font-semibold text-slate-800">{r.timeSlot}</td>
                    <td className="border-r border-slate-100 p-2">{r.topDim || '—'}</td>
                    <td className="border-r border-slate-100 p-2">{r.bottomDim || '—'}</td>
                    <td className="border-r border-slate-100 p-2">{r.finish || '—'}</td>
                    <td className="border-r border-slate-100 p-2">{r.colour || '—'}</td>
                    <td className="p-2 font-sans text-slate-700">{r.inspectionBy || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard n={4} prefix="rolls" boxRef={refs[3]} badge="Finished rolls" icon={<Layers className="h-3.5 w-3.5 text-[#1E40AF]" />} title="4. Finished rolls"
          right={<span className="font-mono text-[11px] text-slate-500">Output: {l.rolls.reduce((s, r) => s + (r.weight || 0), 0).toFixed(1)} kg</span>}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-slate-200 text-left text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="border-r border-slate-200 p-2">Roll No</th>
                  <th className="border-r border-slate-200 p-2">Weight</th>
                  <th className="border-r border-slate-200 p-2">Length</th>
                  <th className="border-r border-slate-200 p-2">Winder</th>
                  <th className="p-2">QC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {l.rolls.length > 0 ? l.rolls.map((r, i) => (
                  <tr key={i} className="bg-white">
                    <td className="border-r border-slate-100 p-2 font-bold text-[#1E40AF]">{r.rollNumber}</td>
                    <td className="border-r border-slate-100 p-2">{r.weight} kg</td>
                    <td className="border-r border-slate-100 p-2">{r.length} m</td>
                    <td className="border-r border-slate-100 p-2 font-sans">{r.winderBy || '—'}</td>
                    <td className="p-2">
                      <StatusBadge tone={r.status === 'passed' ? 'success' : r.status === 'failed' ? 'error' : 'warn'} className="uppercase">
                        {r.status === 'passed' ? <CheckCircle2 className="h-2.5 w-2.5" /> : r.status === 'failed' ? <XCircle className="h-2.5 w-2.5" /> : null}
                        {r.status}
                      </StatusBadge>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="bg-slate-50 p-3 text-center font-sans italic text-slate-400">No rolls yet — register them on the right.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard n={5} prefix="signoff" boxRef={refs[4]} badge="Sign-off" icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-600" />} title="5. Scrap, rejections & sign-off"
          right={<span className="font-mono text-[11px] text-slate-500">Consumed: {l.totalConsumedKg || 0} kg</span>}>
          <div className="grid grid-cols-1 gap-3 text-[12px] md:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-700">Material balance</span>
              <div className="grid grid-cols-3 gap-2 text-center font-mono">
                <div onClick={sel('scrap')} className={`cursor-pointer rounded-lg border p-1.5 ${focused('scrap') ? focusField : 'border-slate-200 bg-slate-50'}`}>
                  <span className="block text-[9px] font-medium text-slate-500">Start scrap</span>
                  <span className="font-bold text-slate-800">{l.scrapKg || 0} kg</span>
                </div>
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-1.5">
                  <span className="block text-[9px] font-medium text-rose-700">Rejections</span>
                  <span className="font-bold text-rose-800">{rej.toFixed(1)} kg</span>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-1.5">
                  <span className="block text-[9px] font-medium text-emerald-700">Good rolls</span>
                  <span className="font-bold text-emerald-800">{good.toFixed(1)} kg</span>
                </div>
              </div>
              <div className="pt-1">
                <span className="mb-1.5 block text-[10px] font-bold uppercase text-slate-600">Defect reasons</span>
                <div className="flex flex-wrap gap-1">
                  {t.rejectionReasons.map((reason) => {
                    const cnt = l.rejectionCounts[reason];
                    const flagged = cnt != null && cnt.trim() !== '' && cnt.trim() !== '0';
                    return (
                      <span
                        key={reason}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                          flagged
                            ? 'border-rose-300 bg-rose-50 font-semibold text-rose-800'
                            : 'border-slate-200 bg-slate-50 text-slate-400'
                        }`}
                      >
                        {flagged ? `${reason} (${cnt})` : reason}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex flex-col justify-between space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <div>
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-700">Scanned physical sheet</span>
                {l.attachedImage ? (
                  <div className="flex items-center gap-2 rounded-lg border border-[#BFDBFE] bg-[#DBEAFE]/60 p-2">
                    <Paperclip className="h-4 w-4 text-[#1E40AF]" />
                    <span className="truncate text-[11px] font-semibold text-[#1E40AF]">Physical copy attached</span>
                  </div>
                ) : (
                  <span className="text-[11px] italic text-slate-400">No physical sheet image attached</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-2">
                <div onClick={sel('signoff')} className={`cursor-pointer rounded-lg border p-2 text-center ${focused('signoff') ? focusField : 'border-slate-200 bg-slate-50'}`}>
                  <span className="block text-[9px] font-medium uppercase text-slate-400">Operator</span>
                  <div className="flex h-7 items-center justify-center font-serif text-xs italic text-slate-800">{l.operatorSignature || '—'}</div>
                </div>
                <div onClick={sel('signoff')} className={`cursor-pointer rounded-lg border p-2 text-center ${focused('signoff') ? focusField : 'border-slate-200 bg-slate-50'}`}>
                  <span className="block text-[9px] font-medium uppercase text-slate-400">Shift supervisor</span>
                  <div className="flex h-7 items-center justify-center text-xs font-bold text-[#1E40AF]">{l.supervisorSignature || l.supervisor || '—'}</div>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
