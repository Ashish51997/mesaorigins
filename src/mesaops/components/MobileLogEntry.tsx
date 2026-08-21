/**
 * Thumb-first section-card log entry for narrow viewports.
 * Six collapsible sections; subsections open a bottom sheet to enter readings.
 * Hourly inspection & Traceability: one row at a time in the sheet.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, ChevronLeft, ChevronRight, ChevronDown, ClipboardPenLine,
} from 'lucide-react';
import type { LogbookTemplate, MachineLogbook, RollRecord, HourlyInspectionRow, TraceabilityRow } from '@mesaops/types';
import type { LogbookHandlers } from './MachineLogBookSheet';
import { StatusBadge } from '@shared/components/ui/StatusBadge';
import BottomSheet from '@shared/components/ui/BottomSheet';
import {
  isInvalidNumber,
  isOutOfRange,
  sanitizeDecimal,
  sanitizeMeter,
  normalizeDate,
  normalizeTime,
  isInvalidDate,
  isInvalidTime,
  isInvalidMeter,
} from '@mesaops/lib/logbookValidation';

export type MobileSectionId = 'header' | 'process' | 'inspection' | 'trace' | 'rolls' | 'report';

const SECTIONS: { id: MobileSectionId; label: string; short: string }[] = [
  { id: 'header', label: 'Header', short: '1' },
  { id: 'process', label: 'Process', short: '2' },
  { id: 'inspection', label: 'Inspection', short: '3' },
  { id: 'trace', label: 'Trace', short: '4' },
  { id: 'rolls', label: 'Rolls', short: '5' },
  { id: 'report', label: 'Sign-off', short: '6' },
];

const HEADER_KEYS = new Set([
  'machineId', 'date', 'shift', 'supervisor', 'drawingNo', 'formulaNo', 'moldNo', 'productName',
]);

type SheetTarget =
  | { kind: 'header' }
  | { kind: 'zones' }
  | { kind: 'settings' }
  | { kind: 'coils' }
  | { kind: 'hourly'; index: number }
  | { kind: 'trace'; index: number }
  | { kind: 'rolls' }
  | { kind: 'report' }
  | { kind: 'signoff' };

export function mobileSectionForField(field?: string | null): MobileSectionId {
  if (!field) return 'header';
  if (field.startsWith('coil') || field.startsWith('hourly')) return 'inspection';
  if (field.startsWith('trace')) return 'trace';
  if (field.startsWith('rej:') || [
    'totalRollsProduced', 'totalRollKgs', 'processWasteKg', 'lumpsWasteKg',
    'rejectionKg', 'totalConsumedKg', 'meterCheckedBy', 'meterCheckTime', 'meter', 'meterCountSet',
    'operatorSignature', 'supervisorSignature', 'scrapKg',
  ].includes(field)) return 'report';
  if (field.startsWith('die:') || field.startsWith('barrel:') || [
    'motorSpeed', 'ampere', 'takeupSpeed', 'vacuum', 'extruderStartTime',
    'productSetTime', 'shoreHardness', 'productionPerHour', 'tag',
  ].includes(field)) return 'process';
  if (field.startsWith('roll') || field === 'rolls') return 'rolls';
  return 'header';
}

const fieldCls =
  'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-[#1E40AF]';
const fieldWarn = ' border-amber-400 bg-amber-50 text-amber-800 font-semibold';
const fieldLocked = ' bg-slate-100 text-slate-500 cursor-not-allowed';

function MText({
  label, value, onChange, field, lo, hi, readOnly, locked, numeric, kind = 'text', ph, hint, onFocusField,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  field?: string;
  lo?: number;
  hi?: number;
  readOnly?: boolean;
  locked?: boolean;
  numeric?: boolean;
  kind?: 'text' | 'number' | 'date' | 'time' | 'meter';
  ph?: string;
  hint?: string;
  onFocusField?: (f: string) => void;
}) {
  const mode =
    kind === 'number' || numeric || (lo != null && hi != null)
      ? (kind === 'date' || kind === 'time' || kind === 'meter' ? kind : 'number')
      : kind;
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
  const disabled = locked || readOnly;

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-slate-700">
        {label}
        {ranged ? <span className="font-normal text-slate-400"> · {lo}–{hi}</span> : null}
      </span>
      <input
        type={inputType}
        className={`${fieldCls}${oor || badType ? fieldWarn : ''}${disabled ? fieldLocked : ''}`}
        value={display}
        placeholder={ph ?? (mode === 'meter' ? 'e.g. 154/M' : undefined)}
        inputMode={mode === 'number' ? 'decimal' : undefined}
        readOnly={disabled}
        onFocus={() => { if (field) onFocusField?.(field); }}
        onChange={(e) => {
          const raw = e.target.value;
          if (mode === 'number') onChange(sanitizeDecimal(raw));
          else if (mode === 'date') onChange(normalizeDate(raw));
          else if (mode === 'time') onChange(normalizeTime(raw));
          else if (mode === 'meter') onChange(sanitizeMeter(raw));
          else onChange(raw);
        }}
      />
      {hint ? <span className="text-[12px] text-slate-500">{hint}</span> : null}
      {oor ? <span className="text-[12px] font-semibold text-amber-700">Outside permissible range</span> : null}
      {badType && mode === 'number' ? <span className="text-[12px] font-semibold text-amber-700">Enter a number only</span> : null}
    </label>
  );
}

function MSelect({
  label, value, onChange, options, field, readOnly, locked, hint, onFocusField,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  field?: string;
  readOnly?: boolean;
  locked?: boolean;
  hint?: string;
  onFocusField?: (f: string) => void;
}) {
  const disabled = locked || !!readOnly;
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-slate-700">{label}</span>
      <select
        className={`${fieldCls}${disabled ? fieldLocked : ''}`}
        value={value ?? ''}
        disabled={disabled}
        onFocus={() => { if (field) onFocusField?.(field); }}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {hint ? <span className="text-[12px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

function hourlyRowDone(row: HourlyInspectionRow, isPipe: boolean): boolean {
  if (isPipe) {
    return !!(row.od?.trim() || row.weight?.trim() || row.colour?.trim() || row.okNotOk?.trim() || row.inspectionBy?.trim());
  }
  const th = (row.thickness ?? []).some((x) => x.trim() !== '');
  return !!(
    row.topDim?.trim() || row.bottomDim?.trim() || row.finish?.trim()
    || row.perMeter?.trim() || row.colour?.trim() || row.tearing?.trim()
    || row.inspectionBy?.trim() || th
  );
}

function traceRowDone(row: TraceabilityRow): boolean {
  return row.lotNumber.trim() !== '';
}

function SubBlock({
  title,
  summary,
  open,
  onToggle,
  onLog,
  locked,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  onLog?: () => void;
  locked?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/40 overflow-hidden">
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-h-11 flex-1 items-center gap-2 px-3 py-2.5 text-left"
          aria-expanded={open}
        >
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-slate-900 truncate">{title}</p>
            <p className="text-[12px] text-slate-500 truncate">{summary}</p>
          </div>
        </button>
        {onLog && !locked && (
          <button
            type="button"
            onClick={onLog}
            className="m-1.5 inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#1E40AF] px-3 text-[12px] font-medium text-white hover:bg-[#1E3A8A]"
          >
            <ClipboardPenLine className="h-3.5 w-3.5" />
            Log entry
          </button>
        )}
      </div>
      {open && children != null && (
        <div className="space-y-2 border-t border-slate-100 bg-white px-3 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

function RowSummary({
  title,
  done,
  detail,
  onLog,
  locked,
}: {
  title: string;
  done: boolean;
  detail?: string;
  onLog: () => void;
  locked?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[14px] font-semibold text-slate-900">{title}</p>
          <StatusBadge tone={done ? 'success' : 'neutral'}>{done ? 'Entered' : 'Empty'}</StatusBadge>
        </div>
        {detail ? <p className="mt-0.5 truncate text-[12px] text-slate-500">{detail}</p> : null}
      </div>
      {!locked && (
        <button
          type="button"
          onClick={onLog}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#1E40AF] px-3 text-[12px] font-medium text-white hover:bg-[#1E3A8A]"
        >
          <ClipboardPenLine className="h-3.5 w-3.5" />
          Log entry
        </button>
      )}
    </div>
  );
}

function MobileRollRegister({
  rolls, locked, onAdd, onRemove, employeeOptions,
}: {
  rolls: RollRecord[];
  locked: boolean;
  onAdd: (r: RollRecord) => void;
  onRemove: (i: number) => void;
  employeeOptions: readonly string[];
}) {
  const [num, setNum] = useState('');
  const [wt, setWt] = useState('');
  const [len, setLen] = useState('');
  const [winder, setWinder] = useState('');
  const [packed, setPacked] = useState('');
  const [status, setStatus] = useState<RollRecord['status']>('passed');
  const nextNum = `R-2026-${String(rolls.length + 1).padStart(3, '0')}`;
  const add = () => {
    onAdd({
      rollNumber: num.trim() || nextNum,
      weight: Number.parseFloat(wt) || 0,
      length: Number.parseFloat(len) || 0,
      winderBy: winder,
      packedBy: packed,
      status,
    });
    setNum(''); setWt(''); setLen(''); setWinder(''); setPacked(''); setStatus('passed');
  };
  const chipTone = (s: RollRecord['status']): 'success' | 'error' | 'warn' =>
    s === 'passed' ? 'success' : s === 'failed' ? 'error' : 'warn';

  return (
    <div className="space-y-3">
      {rolls.length > 0 && (
        <ul className="space-y-2">
          {rolls.map((r, i) => (
            <li key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[15px] font-bold text-slate-800">{r.rollNumber}</div>
                <div className="text-[13px] text-slate-500">{r.weight} kg · {r.length} m</div>
              </div>
              <StatusBadge tone={chipTone(r.status)} className="uppercase">{r.status}</StatusBadge>
              {!locked && (
                <button type="button" onClick={() => onRemove(i)} className="shrink-0 rounded-lg p-2.5 min-h-11 min-w-11 inline-flex items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove roll">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!locked && (
        <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 col-span-2 sm:col-span-1">
              <span className="text-[13px] font-semibold text-slate-700">Roll number</span>
              <input value={num} onChange={(e) => setNum(e.target.value)} placeholder={nextNum} className={fieldCls} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-slate-700">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as RollRecord['status'])} className={fieldCls}>
                <option value="passed">Passed</option>
                <option value="pending">Pending QA</option>
                <option value="failed">Rejected</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-slate-700">Weight (kg)</span>
              <input value={wt} onChange={(e) => setWt(sanitizeDecimal(e.target.value))} inputMode="decimal" className={fieldCls} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-slate-700">Length (m)</span>
              <input value={len} onChange={(e) => setLen(sanitizeDecimal(e.target.value))} inputMode="decimal" className={fieldCls} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-slate-700">Winder</span>
              <select value={winder} onChange={(e) => setWinder(e.target.value)} className={fieldCls}>
                <option value="">—</option>
                {employeeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-slate-700">Packed by</span>
              <select value={packed} onChange={(e) => setPacked(e.target.value)} className={fieldCls}>
                <option value="">—</option>
                {employeeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          </div>
          <button type="button" onClick={add} className="inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl bg-[#1E40AF] text-[15px] font-semibold text-white hover:bg-[#1E3A8A]">
            <Plus className="h-4 w-4" /> Register roll
          </button>
        </div>
      )}
    </div>
  );
}

export interface MobileLogEntryProps {
  logbook: MachineLogbook;
  template: LogbookTemplate;
  on: LogbookHandlers;
  locked: boolean;
  headerLocked: boolean;
  formulaOptions: readonly string[];
  employeeOptions: readonly string[];
  addRoll: (r: RollRecord) => void;
  removeRoll: (i: number) => void;
  setScrap: (v: string) => void;
  activeField?: string | null;
  onSelectField?: (f: string) => void;
  focusField?: string | null;
  /** pager = section tabs; accordion = collapsible sections (default). */
  layout?: 'pager' | 'accordion';
}

export default function MobileLogEntry({
  logbook,
  template: t,
  on,
  locked,
  headerLocked,
  formulaOptions,
  employeeOptions,
  addRoll,
  removeRoll,
  setScrap,
  onSelectField,
  focusField,
  layout = 'accordion',
}: MobileLogEntryProps) {
  const [section, setSection] = useState<MobileSectionId>('header');
  const [openSections, setOpenSections] = useState<Set<MobileSectionId>>(() => new Set(['header']));
  const [openSubs, setOpenSubs] = useState<Set<string>>(() => new Set());
  const [sheet, setSheet] = useState<SheetTarget | null>(null);

  const isPipe = (t.layout ?? 'coil') === 'pipe';
  const filledCoils = logbook.coilWeights.filter((c) => c.trim() !== '').length;
  const filledTrace = logbook.traceabilityRows.filter((r) => r.lotNumber.trim() !== '').length;
  const filledHourly = logbook.hourlyInspections.filter((r) => hourlyRowDone(r, isPipe)).length;
  const zoneCount = t.dieZones.length + t.barrelZones.length;
  const filledZones = [
    ...t.dieZones.map((z) => logbook.dieZoneTemps[z] ?? ''),
    ...t.barrelZones.map((z) => logbook.barrelZoneTemps[z] ?? ''),
  ].filter((v) => v.trim() !== '').length;
  const passedKg = logbook.rolls.filter((r) => r.status === 'passed').reduce((s, r) => s + (r.weight || 0), 0);
  const failedKg = logbook.rolls.filter((r) => r.status === 'failed').reduce((s, r) => s + (r.weight || 0), 0);
  const isAccordion = layout === 'accordion';

  useEffect(() => {
    if (!focusField) return;
    const id = mobileSectionForField(focusField);
    setSection(id);
    if (isAccordion) setOpenSections((prev) => new Set(prev).add(id));
  }, [focusField, isAccordion]);

  const sectionIndex = useMemo(() => SECTIONS.findIndex((s) => s.id === section), [section]);
  const go = (dir: -1 | 1) => {
    const next = SECTIONS[sectionIndex + dir];
    if (next) setSection(next.id);
  };

  const focus = (f: string) => onSelectField?.(f);
  const planHint = 'Set at planning — not editable here.';
  const hl = (key: string) => headerLocked && HEADER_KEYS.has(key);

  const toggleSection = (id: MobileSectionId) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSection(id);
  };

  const toggleSub = (key: string) => {
    setOpenSubs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const sheetTitle = useMemo(() => {
    if (!sheet) return '';
    switch (sheet.kind) {
      case 'header': return 'Shift header';
      case 'zones': return 'Zone temperatures';
      case 'settings': return 'Machine settings';
      case 'coils': return 'Coil weights';
      case 'hourly': return `Hourly · ${logbook.hourlyInspections[sheet.index]?.timeSlot ?? `Slot ${sheet.index + 1}`}`;
      case 'trace': return `Traceability · Row ${sheet.index + 1}`;
      case 'rolls': return 'Finished rolls';
      case 'report': return 'Production report';
      case 'signoff': return 'Sign-off';
      default: return 'Log entry';
    }
  }, [sheet, logbook.hourlyInspections]);

  const moveHourly = (dir: -1 | 1) => {
    if (!sheet || sheet.kind !== 'hourly') return;
    const next = sheet.index + dir;
    if (next < 0 || next >= logbook.hourlyInspections.length) return;
    setSheet({ kind: 'hourly', index: next });
  };

  const moveTrace = (dir: -1 | 1) => {
    if (!sheet || sheet.kind !== 'trace') return;
    const next = sheet.index + dir;
    if (next < 0 || next >= logbook.traceabilityRows.length) return;
    setSheet({ kind: 'trace', index: next });
  };

  const renderHourlyFields = (i: number) => {
    const row = logbook.hourlyInspections[i];
    if (!row) return null;
    return (
      <div className="space-y-3">
        {isPipe ? (
          <>
            <MText numeric label="OD" field={`hourly:${i}:od`} value={row.od ?? ''} onChange={(v) => on.hourly(i, 'od', v)} lo={t.pipeSpecs?.od?.lo} hi={t.pipeSpecs?.od?.hi} locked={locked} onFocusField={focus} />
            <MText numeric label="Weight" field={`hourly:${i}:weight`} value={row.weight ?? ''} onChange={(v) => on.hourly(i, 'weight', v)} lo={t.pipeSpecs?.weight?.lo} hi={t.pipeSpecs?.weight?.hi} locked={locked} onFocusField={focus} />
            <MText label="Colour" field={`hourly:${i}:colour`} value={row.colour} onChange={(v) => on.hourly(i, 'colour', v)} locked={locked} onFocusField={focus} />
            <MSelect label="Ok / Not ok" field={`hourly:${i}:okNotOk`} value={row.okNotOk ?? ''} onChange={(v) => on.hourly(i, 'okNotOk', v)} options={['Ok', 'Not ok']} locked={locked} onFocusField={focus} />
            <MSelect label="Inspection By" field={`hourly:${i}:inspectionBy`} value={row.inspectionBy} onChange={(v) => on.hourly(i, 'inspectionBy', v)} options={employeeOptions} locked={locked} onFocusField={focus} />
          </>
        ) : (
          <>
            <MText numeric label={t.dimensionSpecs.top.label} field={`hourly:${i}:topDim`} value={row.topDim ?? ''} onChange={(v) => on.hourly(i, 'topDim', v)} lo={t.dimensionSpecs.top.lo} hi={t.dimensionSpecs.top.hi} locked={locked} onFocusField={focus} />
            <MText numeric label={t.dimensionSpecs.bottom.label} field={`hourly:${i}:bottomDim`} value={row.bottomDim ?? ''} onChange={(v) => on.hourly(i, 'bottomDim', v)} lo={t.dimensionSpecs.bottom.lo} hi={t.dimensionSpecs.bottom.hi} locked={locked} onFocusField={focus} />
            {(row.thickness ?? []).map((th, j) => (
              <MText key={j} numeric label={`Thickness ${j + 1}`} field={`hourly:${i}:thickness:${j}`} value={th} onChange={(v) => on.hourlyThickness(i, j, v)} lo={t.dimensionSpecs.thickness.lo} hi={t.dimensionSpecs.thickness.hi} locked={locked} onFocusField={focus} />
            ))}
            <MText label="Finish" field={`hourly:${i}:finish`} value={row.finish ?? ''} onChange={(v) => on.hourly(i, 'finish', v)} locked={locked} onFocusField={focus} />
            <MText numeric label="Per meter" field={`hourly:${i}:perMeter`} value={row.perMeter ?? ''} onChange={(v) => on.hourly(i, 'perMeter', v)} locked={locked} onFocusField={focus} />
            <MText label="Colour" field={`hourly:${i}:colour`} value={row.colour} onChange={(v) => on.hourly(i, 'colour', v)} locked={locked} onFocusField={focus} />
            <MText label="Tearing" field={`hourly:${i}:tearing`} value={row.tearing ?? ''} onChange={(v) => on.hourly(i, 'tearing', v)} locked={locked} onFocusField={focus} />
            <MSelect label="Inspection By" field={`hourly:${i}:inspectionBy`} value={row.inspectionBy} onChange={(v) => on.hourly(i, 'inspectionBy', v)} options={employeeOptions} locked={locked} onFocusField={focus} />
          </>
        )}
      </div>
    );
  };

  const renderTraceFields = (i: number) => {
    const row = logbook.traceabilityRows[i];
    if (!row) return null;
    return (
      <div className="space-y-3">
        <MText label="Lot Number" field={`trace:${i}:lotNumber`} value={row.lotNumber} onChange={(v) => on.trace(i, 'lotNumber', v)} locked={locked} onFocusField={focus} />
        <div className="grid grid-cols-2 gap-3">
          <MText label="Colour" field={`trace:${i}:colour`} value={row.colour} onChange={(v) => on.trace(i, 'colour', v)} locked={locked} onFocusField={focus} />
          <MText label="Code" field={`trace:${i}:code`} value={row.code} onChange={(v) => on.trace(i, 'code', v)} locked={locked} onFocusField={focus} />
        </div>
        <MSelect label="Winder / Packed by" field={`trace:${i}:winderPackedBy`} value={row.winderPackedBy} onChange={(v) => on.trace(i, 'winderPackedBy', v)} options={employeeOptions} locked={locked} onFocusField={focus} />
      </div>
    );
  };

  const wrap = (id: MobileSectionId, label: string, body: React.ReactNode) => {
    if (!isAccordion) {
      return section === id ? <React.Fragment key={id}>{body}</React.Fragment> : null;
    }
    const open = openSections.has(id);
    return (
      <div key={id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection(id)}
          className="flex w-full min-h-11 items-center justify-between gap-3 px-4 py-3 text-left"
          aria-expanded={open}
        >
          <span className="text-[15px] font-bold text-slate-900">
            <span className="mr-2 text-slate-400 font-medium">{SECTIONS.find((s) => s.id === id)?.short}.</span>
            {label}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && <div className="space-y-2.5 border-t border-slate-100 px-3 pb-3 pt-2.5">{body}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-3" data-testid="mobile-log-entry" data-layout={layout}>
      {!isAccordion && (
        <div className="sticky top-0 z-10 -mx-1 bg-slate-50/95 px-1 py-2 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[12px] font-medium text-slate-500">
              Section {sectionIndex + 1} of {SECTIONS.length}
            </p>
            <div className="flex gap-1">
              <button type="button" onClick={() => go(-1)} disabled={sectionIndex <= 0} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-30" aria-label="Previous section">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => go(1)} disabled={sectionIndex >= SECTIONS.length - 1} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-30" aria-label="Next section">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-0.5 px-0.5 scrollbar-none" role="tablist" aria-label="Logbook sections">
            {SECTIONS.map((s) => {
              const active = s.id === section;
              return (
                <button key={s.id} type="button" role="tab" aria-selected={active} onClick={() => setSection(s.id)} className={`shrink-0 min-h-9 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${active ? 'bg-[#1E40AF] text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>
                  <span className="mr-1.5 opacity-70">{s.short}</span>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {wrap('header', 'Header', (
        <SubBlock
          title="Shift header"
          summary="Identity fields from the production plan"
          open={openSubs.has('header')}
          onToggle={() => toggleSub('header')}
          onLog={() => setSheet({ kind: 'header' })}
          locked={locked}
        />
      ))}

      {wrap('process', 'Process', (
        <>
          <SubBlock
            title="Zone temperatures"
            summary={`${filledZones}/${zoneCount} zones filled · °C`}
            open={openSubs.has('zones')}
            onToggle={() => toggleSub('zones')}
            onLog={() => setSheet({ kind: 'zones' })}
            locked={locked}
          />
          <SubBlock
            title="Machine settings"
            summary="Motor, ampere, vacuum, shore, timing"
            open={openSubs.has('settings')}
            onToggle={() => toggleSub('settings')}
            onLog={() => setSheet({ kind: 'settings' })}
            locked={locked}
          />
        </>
      ))}

      {wrap('inspection', 'Inspection', (
        <>
          {!isPipe && (
            <SubBlock
              title="Coil weights"
              summary={`${filledCoils}/${t.coil.count} filled · ${t.coil.rangeLo}–${t.coil.rangeHi} kg`}
              open={openSubs.has('coils')}
              onToggle={() => toggleSub('coils')}
              onLog={() => setSheet({ kind: 'coils' })}
              locked={locked}
            />
          )}
          <div className="rounded-xl border border-slate-200 bg-slate-50/40 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSub('hourly')}
              className="flex w-full min-h-11 items-center gap-2 px-3 py-2.5 text-left"
              aria-expanded={openSubs.has('hourly')}
            >
              <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${openSubs.has('hourly') ? 'rotate-180' : ''}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-slate-900">Hourly inspection</p>
                <p className="text-[12px] text-slate-500">{filledHourly}/{logbook.hourlyInspections.length} slots entered</p>
              </div>
            </button>
            {openSubs.has('hourly') && (
              <div className="space-y-2 border-t border-slate-100 bg-white px-3 py-3">
                {logbook.hourlyInspections.map((row, i) => (
                  <RowSummary
                    key={i}
                    title={row.timeSlot || `Slot ${i + 1}`}
                    done={hourlyRowDone(row, isPipe)}
                    detail={row.inspectionBy ? `By ${row.inspectionBy}` : undefined}
                    onLog={() => setSheet({ kind: 'hourly', index: i })}
                    locked={locked}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ))}

      {wrap('trace', 'Traceability', (
        <div className="rounded-xl border border-slate-200 bg-slate-50/40 overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSub('trace')}
            className="flex w-full min-h-11 items-center gap-2 px-3 py-2.5 text-left"
            aria-expanded={openSubs.has('trace')}
          >
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${openSubs.has('trace') ? 'rotate-180' : ''}`} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-slate-900">Lot / colour / code</p>
              <p className="text-[12px] text-slate-500">{filledTrace}/{logbook.traceabilityRows.length} rows with a lot number</p>
            </div>
          </button>
          {openSubs.has('trace') && (
            <div className="space-y-2 border-t border-slate-100 bg-white px-3 py-3">
              {logbook.traceabilityRows.map((row, i) => (
                <RowSummary
                  key={i}
                  title={`Row ${i + 1}`}
                  done={traceRowDone(row)}
                  detail={row.lotNumber ? `Lot ${row.lotNumber}` : 'No lot yet'}
                  onLog={() => setSheet({ kind: 'trace', index: i })}
                  locked={locked}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      {wrap('rolls', 'Rolls', (
        <SubBlock
          title="Finished rolls"
          summary={`${logbook.rolls.length} registered · good ${passedKg.toFixed(1)} kg`}
          open={openSubs.has('rolls')}
          onToggle={() => toggleSub('rolls')}
          onLog={() => setSheet({ kind: 'rolls' })}
          locked={locked}
        />
      ))}

      {wrap('report', 'Sign-off', (
        <>
          <SubBlock
            title="Production report"
            summary="Totals, waste, meter check"
            open={openSubs.has('report')}
            onToggle={() => toggleSub('report')}
            onLog={() => setSheet({ kind: 'report' })}
            locked={locked}
          />
          <SubBlock
            title="Signatures"
            summary="Operator & supervisor sign-off"
            open={openSubs.has('signoff')}
            onToggle={() => toggleSub('signoff')}
            onLog={() => setSheet({ kind: 'signoff' })}
            locked={locked}
          />
        </>
      ))}

      {!isAccordion && (
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => go(-1)} disabled={sectionIndex <= 0} className="inline-flex flex-1 min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white text-[14px] font-semibold text-slate-700 disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <button type="button" onClick={() => go(1)} disabled={sectionIndex >= SECTIONS.length - 1} className="inline-flex flex-1 min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-900 text-[14px] font-semibold text-white disabled:opacity-30">
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <BottomSheet
        open={sheet != null}
        onClose={() => setSheet(null)}
        title={sheetTitle}
        wide
        className="max-h-[88vh]"
      >
        {sheet?.kind === 'header' && (
          <div className="grid grid-cols-1 gap-4 pb-4">
            <MText label="Machine No" field="machineId" value={logbook.machineId} onChange={(v) => on.scalar('machineId', v)} readOnly={hl('machineId')} locked={locked} onFocusField={focus} hint={hl('machineId') ? planHint : undefined} />
            <MText kind="date" label="Date" field="date" value={logbook.date} onChange={(v) => on.scalar('date', v)} readOnly={hl('date')} locked={locked} onFocusField={focus} hint={hl('date') ? planHint : undefined} />
            <MSelect label="Shift" field="shift" value={logbook.shift} onChange={(v) => on.scalar('shift', v)} options={t.shifts} readOnly={hl('shift')} locked={locked} onFocusField={focus} hint={hl('shift') ? planHint : undefined} />
            <MSelect label="Shift Supervisor" field="supervisor" value={logbook.supervisor} onChange={(v) => on.scalar('supervisor', v)} options={employeeOptions} readOnly={hl('supervisor')} locked={locked} onFocusField={focus} hint={hl('supervisor') ? planHint : undefined} />
            <MText label="Drawing No" field="drawingNo" value={logbook.drawingNo} onChange={(v) => on.scalar('drawingNo', v)} readOnly={hl('drawingNo')} locked={locked} onFocusField={focus} hint={hl('drawingNo') ? planHint : undefined} />
            <MText label="Tag" field="tag" value={logbook.tag} onChange={(v) => on.scalar('tag', v)} locked={locked} onFocusField={focus} />
            <MSelect label="Formula No" field="formulaNo" value={logbook.formulaNo} onChange={(v) => on.scalar('formulaNo', v)} options={formulaOptions} readOnly={hl('formulaNo')} locked={locked} onFocusField={focus} hint={hl('formulaNo') ? planHint : undefined} />
            <MText label="Mold No" field="moldNo" value={logbook.moldNo} onChange={(v) => on.scalar('moldNo', v)} readOnly={hl('moldNo')} locked={locked} onFocusField={focus} hint={hl('moldNo') ? planHint : undefined} />
            <MText label="Product Name" field="productName" value={logbook.productName} onChange={(v) => on.scalar('productName', v)} readOnly={hl('productName')} locked={locked} onFocusField={focus} hint={hl('productName') ? planHint : undefined} />
          </div>
        )}

        {sheet?.kind === 'zones' && (
          <div className="grid grid-cols-2 gap-3 pb-4">
            {t.dieZones.map((z) => (
              <MText key={z} numeric label={z} field={`die:${z}`} value={logbook.dieZoneTemps[z] ?? ''} onChange={(v) => on.dieZone(z, v)} lo={t.zoneSpecs?.[z]?.min} hi={t.zoneSpecs?.[z]?.max} locked={locked} onFocusField={focus} />
            ))}
            {t.barrelZones.map((z) => (
              <MText key={z} numeric label={z} field={`barrel:${z}`} value={logbook.barrelZoneTemps[z] ?? ''} onChange={(v) => on.barrelZone(z, v)} lo={t.zoneSpecs?.[z]?.min} hi={t.zoneSpecs?.[z]?.max} locked={locked} onFocusField={focus} />
            ))}
          </div>
        )}

        {sheet?.kind === 'settings' && (
          <div className="grid grid-cols-1 gap-4 pb-4">
            <MText numeric label="Main Motor Speed" field="motorSpeed" value={logbook.motorSpeed} onChange={(v) => on.scalar('motorSpeed', v)} locked={locked} onFocusField={focus} />
            <MText numeric label="Ampere" field="ampere" value={logbook.ampere} onChange={(v) => on.scalar('ampere', v)} locked={locked} onFocusField={focus} />
            <MText numeric label="Takeup Speed" field="takeupSpeed" value={logbook.takeupSpeed} onChange={(v) => on.scalar('takeupSpeed', v)} locked={locked} onFocusField={focus} />
            <MText numeric label="Vacuum" field="vacuum" value={logbook.vacuum} onChange={(v) => on.scalar('vacuum', v)} locked={locked} onFocusField={focus} />
            <MText kind="time" label="Extruder start time" field="extruderStartTime" value={logbook.extruderStartTime} onChange={(v) => on.scalar('extruderStartTime', v)} locked={locked} onFocusField={focus} />
            <MText kind="time" label="Product / Item set time" field="productSetTime" value={logbook.productSetTime} onChange={(v) => on.scalar('productSetTime', v)} locked={locked} onFocusField={focus} />
            <MText numeric label={`Shore ${t.hardnessType ?? 'A'} Hardness`} field="shoreHardness" value={logbook.shoreHardness} onChange={(v) => on.scalar('shoreHardness', v)} locked={locked} onFocusField={focus} />
            <MText numeric label="Production Per Hour (kg)" field="productionPerHour" value={logbook.productionPerHour} onChange={(v) => on.scalar('productionPerHour', v)} locked={locked} onFocusField={focus} />
          </div>
        )}

        {sheet?.kind === 'coils' && (
          <div className="grid grid-cols-2 gap-3 pb-4">
            {logbook.coilWeights.map((c, i) => {
              const badType = isInvalidNumber(c);
              const oor = !badType && isOutOfRange(c, t.coil.rangeLo, t.coil.rangeHi);
              const fld = `coil:${i}`;
              return (
                <label key={i} className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-semibold text-slate-700">Coil {i + 1}</span>
                  <input className={`${fieldCls} text-center${oor || badType ? fieldWarn : ''}${locked ? fieldLocked : ''}`} inputMode="decimal" value={c} readOnly={locked} onFocus={() => focus(fld)} onChange={(e) => on.coil(i, sanitizeDecimal(e.target.value))} />
                </label>
              );
            })}
          </div>
        )}

        {sheet?.kind === 'hourly' && (
          <div className="pb-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] text-slate-500">
                Slot {sheet.index + 1} of {logbook.hourlyInspections.length}
              </p>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => moveHourly(-1)} disabled={sheet.index <= 0} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-[13px] font-medium text-slate-700 disabled:opacity-30">
                  <ChevronLeft className="h-4 w-4" /> Prev
                </button>
                <button type="button" onClick={() => moveHourly(1)} disabled={sheet.index >= logbook.hourlyInspections.length - 1} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-[13px] font-medium text-slate-700 disabled:opacity-30">
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            {renderHourlyFields(sheet.index)}
            <button type="button" onClick={() => setSheet(null)} className="inline-flex w-full min-h-11 items-center justify-center rounded-xl bg-[#1E40AF] text-[15px] font-semibold text-white hover:bg-[#1E3A8A]">
              Done
            </button>
          </div>
        )}

        {sheet?.kind === 'trace' && (
          <div className="pb-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] text-slate-500">
                Row {sheet.index + 1} of {logbook.traceabilityRows.length}
              </p>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => moveTrace(-1)} disabled={sheet.index <= 0} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-[13px] font-medium text-slate-700 disabled:opacity-30">
                  <ChevronLeft className="h-4 w-4" /> Prev
                </button>
                <button type="button" onClick={() => moveTrace(1)} disabled={sheet.index >= logbook.traceabilityRows.length - 1} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-[13px] font-medium text-slate-700 disabled:opacity-30">
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            {renderTraceFields(sheet.index)}
            <button type="button" onClick={() => setSheet(null)} className="inline-flex w-full min-h-11 items-center justify-center rounded-xl bg-[#1E40AF] text-[15px] font-semibold text-white hover:bg-[#1E3A8A]">
              Done
            </button>
          </div>
        )}

        {sheet?.kind === 'rolls' && (
          <div className="pb-4 space-y-3">
            <MobileRollRegister rolls={logbook.rolls} locked={locked} onAdd={addRoll} onRemove={removeRoll} employeeOptions={employeeOptions} />
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 py-3 text-center">
                <div className="text-[10px] font-bold uppercase text-emerald-600">Good</div>
                <div className="text-[15px] font-extrabold text-emerald-700">{passedKg.toFixed(1)} kg</div>
              </div>
              <div className="rounded-xl bg-rose-50 border border-rose-100 py-3 text-center">
                <div className="text-[10px] font-bold uppercase text-rose-600">Rejected</div>
                <div className="text-[15px] font-extrabold text-rose-700">{failedKg.toFixed(1)} kg</div>
              </div>
              <label className="rounded-xl bg-slate-50 border border-slate-200 py-2 px-2 flex flex-col items-center">
                <span className="text-[10px] font-bold uppercase text-slate-500">Scrap kg</span>
                <input value={logbook.scrapKg} onChange={(e) => setScrap(sanitizeDecimal(e.target.value))} readOnly={locked} inputMode="decimal" onFocus={() => focus('scrapKg')} className="w-full min-h-9 text-center text-[15px] font-bold bg-transparent focus:outline-none" placeholder="0" />
              </label>
            </div>
          </div>
        )}

        {sheet?.kind === 'report' && (
          <div className="space-y-4 pb-4">
            <div className="grid grid-cols-1 gap-4">
              <MText numeric label="Total Roll Produced" field="totalRollsProduced" value={logbook.totalRollsProduced} onChange={(v) => on.scalar('totalRollsProduced', v)} locked={locked} onFocusField={focus} />
              <MText numeric label="Total Roll Kgs" field="totalRollKgs" value={logbook.totalRollKgs} onChange={(v) => on.scalar('totalRollKgs', v)} locked={locked} onFocusField={focus} />
              <MText numeric label="Process waste (kgs)" field="processWasteKg" value={logbook.processWasteKg} onChange={(v) => on.scalar('processWasteKg', v)} locked={locked} onFocusField={focus} />
              <MText numeric label="Lumps waste (kgs)" field="lumpsWasteKg" value={logbook.lumpsWasteKg} onChange={(v) => on.scalar('lumpsWasteKg', v)} locked={locked} onFocusField={focus} />
              <MText numeric label="Rejections (kgs)" field="rejectionKg" value={logbook.rejectionKg} onChange={(v) => on.scalar('rejectionKg', v)} locked={locked} onFocusField={focus} />
              <MText numeric label="Total material consumed" field="totalConsumedKg" value={logbook.totalConsumedKg} onChange={(v) => on.scalar('totalConsumedKg', v)} locked={locked} onFocusField={focus} />
            </div>
            {t.rejectionReasons.length > 0 && (
              <div className="space-y-3">
                <p className="text-[13px] font-semibold text-slate-700">Reason for rejections</p>
                <div className="grid grid-cols-1 gap-3">
                  {t.rejectionReasons.map((r) => (
                    <MText key={r} numeric label={r} field={`rej:${r}`} value={logbook.rejectionCounts[r] ?? ''} onChange={(v) => on.rejection(r, v)} locked={locked} onFocusField={focus} />
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4">
              <MSelect label="Meter checked by" field="meterCheckedBy" value={logbook.meterCheckedBy} onChange={(v) => on.scalar('meterCheckedBy', v)} options={employeeOptions} locked={locked} onFocusField={focus} />
              <MText kind="time" label="Meter check time" field="meterCheckTime" value={logbook.meterCheckTime} onChange={(v) => on.scalar('meterCheckTime', v)} locked={locked} onFocusField={focus} />
              <MText kind="meter" label="Meter" field="meter" value={logbook.meter} onChange={(v) => on.scalar('meter', v)} locked={locked} onFocusField={focus} />
              <MText numeric label="Meter Count Set" field="meterCountSet" value={logbook.meterCountSet} onChange={(v) => on.scalar('meterCountSet', v)} locked={locked} onFocusField={focus} />
            </div>
          </div>
        )}

        {sheet?.kind === 'signoff' && (
          <div className="grid grid-cols-1 gap-4 pb-4">
            <MSelect label="Operator (signature)" field="operatorSignature" value={logbook.operatorSignature} onChange={(v) => on.scalar('operatorSignature', v)} options={employeeOptions} locked={locked} onFocusField={focus} />
            <MSelect label="Shift supervisor (signature)" field="supervisorSignature" value={logbook.supervisorSignature} onChange={(v) => on.scalar('supervisorSignature', v)} options={employeeOptions} locked={locked} onFocusField={focus} />
          </div>
        )}

        {sheet && sheet.kind !== 'hourly' && sheet.kind !== 'trace' && (
          <button type="button" onClick={() => setSheet(null)} className="sticky bottom-0 inline-flex w-full min-h-11 items-center justify-center rounded-xl bg-[#1E40AF] text-[15px] font-semibold text-white hover:bg-[#1E3A8A]">
            Done
          </button>
        )}
      </BottomSheet>
    </div>
  );
}
