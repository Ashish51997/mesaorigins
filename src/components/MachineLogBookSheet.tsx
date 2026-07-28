/**
 * MachineLogBookSheet.tsx — controlled digital replica of the paper
 * MACHINE LOG BOOK (QR/MFG/013, Rev 02).
 *
 * Renders from a LogbookTemplate (printed constants / per-product specs) and a
 * MachineLogbook (operator entries). Every cell is controlled and edits flow up
 * through the `on` handlers, so this sheet and the right-side fill panel stay in
 * sync (single source of truth in LogbookModule).
 *
 * Selection: each cell reports a stable `field` key on focus via FieldCtx, so
 * the module can highlight the matching panel input and scroll it into view.
 * The active cell is highlighted here too. Coil-weight cells and inspection
 * dimensions flag amber when outside the template's permissible range (soft
 * guard — the value still saves). See SPEC_LOGBOOK.md.
 *
 * NOTE: the reference's `.grid` table class is renamed `.lbgrid` here so it does
 * not collide with Tailwind's `.grid` (display:grid) utility used app-wide.
 */

import { useState, useContext, createContext, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { LogbookTemplate, MachineLogbook, HourlyInspectionRow, TraceabilityRow } from '../types';
import { isInvalidNumber, isOutOfRange, sanitizeDecimal, sanitizeMeter, normalizeDate, normalizeTime, isInvalidDate, isInvalidTime, isInvalidMeter } from '../lib/logbookValidation';

/* ---------------------------------------------------------------- handlers */

export interface LogbookHandlers {
  scalar: (key: keyof MachineLogbook, v: string) => void;
  dieZone: (zone: string, v: string) => void;
  barrelZone: (zone: string, v: string) => void;
  coil: (i: number, v: string) => void;
  hourly: (i: number, field: keyof HourlyInspectionRow, v: string) => void;
  hourlyThickness: (i: number, j: number, v: string) => void;
  trace: (i: number, field: keyof TraceabilityRow, v: string) => void;
  rejection: (reason: string, v: string) => void;
}

interface MachineLogBookSheetProps {
  logbook: MachineLogbook;
  template: LogbookTemplate;
  on: LogbookHandlers;
  readOnly?: boolean;
  activeSection?: number;
  onSelectSection?: (section: number) => void;
  activeField?: string | null;
  onSelectField?: (field: string) => void;
  formulaOptions?: readonly string[];
}

/* Selection context so cells can report focus / show the active highlight
 * without threading props through every call site. */
interface FieldCtxValue { active?: string | null; select?: (f: string) => void; setActiveEl?: (el: HTMLElement | null) => void; }
const FieldCtx = createContext<FieldCtxValue>({});

/* ---------------------------------------------------------------- cells */

interface CellProps {
  w?: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  field?: string;
  /** When true, letters/symbols are stripped — digits and one decimal only. */
  numeric?: boolean;
  /** Native picker / format for date & time cells. */
  kind?: 'text' | 'number' | 'date' | 'time' | 'meter';
}

/* Plain fillable cell (controlled). */
function Cell({ w, value, onChange, readOnly, field, numeric, kind = 'text' }: CellProps) {
  const { active, select, setActiveEl } = useContext(FieldCtx);
  const isActive = field != null && field === active;
  const mode = kind === 'number' || numeric ? 'number' : kind;
  const display =
    mode === 'date' ? normalizeDate(value)
      : mode === 'time' ? normalizeTime(value)
        : (value ?? '');
  const bad =
    (mode === 'number' && isInvalidNumber(value))
    || (mode === 'date' && isInvalidDate(value))
    || (mode === 'time' && isInvalidTime(value))
    || (mode === 'meter' && isInvalidMeter(value));
  const inputType = mode === 'date' ? 'date' : mode === 'time' ? 'time' : 'text';
  return (
    <input
      ref={isActive && setActiveEl ? setActiveEl : undefined}
      type={inputType}
      className={`${isActive ? 'cin active' : 'cin'}${bad ? ' oor' : ''}${mode === 'date' || mode === 'time' ? ' cin-pick' : ''}`}
      style={w !== undefined ? { width: w } : undefined}
      value={display}
      readOnly={readOnly}
      inputMode={mode === 'number' ? 'decimal' : undefined}
      placeholder={mode === 'meter' ? 'e.g. 154/M' : undefined}
      onFocus={() => { if (field) select?.(field); }}
      onChange={(e) => {
        const raw = e.target.value;
        if (mode === 'number') onChange?.(sanitizeDecimal(raw));
        else if (mode === 'date') onChange?.(normalizeDate(raw));
        else if (mode === 'time') onChange?.(normalizeTime(raw));
        else if (mode === 'meter') onChange?.(sanitizeMeter(raw));
        else onChange?.(raw);
      }}
    />
  );
}

interface RangeCellProps extends CellProps {
  lo: number;
  hi: number;
}

/* Controlled cell that turns amber when the typed number is outside [lo, hi],
 * and shows its permissible value as a hint while focused. Letters are blocked. */
function RangeCell({ lo, hi, value, onChange, w, readOnly, field }: RangeCellProps) {
  const { active, select, setActiveEl } = useContext(FieldCtx);
  const isActive = field != null && field === active;
  const [focused, setFocused] = useState<boolean>(false);
  const v = value ?? '';
  const badType = isInvalidNumber(v);
  const oor = !badType && isOutOfRange(v, lo, hi);
  const cls = `${(oor || badType) ? 'cin oor' : 'cin'}${isActive ? ' active' : ''}`;
  return (
    <span className="rc">
      <input
        ref={isActive && setActiveEl ? setActiveEl : undefined}
        className={cls}
        style={w !== undefined ? { width: w } : undefined}
        inputMode="decimal"
        value={v}
        readOnly={readOnly}
        onChange={(e) => onChange?.(sanitizeDecimal(e.target.value))}
        onFocus={() => { setFocused(true); if (field) select?.(field); }}
        onBlur={() => setFocused(false)}
      />
      {focused && <span className="hint">{badType ? 'Enter a number' : `Permissible: ${lo} – ${hi}`}</span>}
    </span>
  );
}

interface DropCellProps {
  options: readonly string[];
  value: string;
  onChange?: (v: string) => void;
  w?: string;
  placeholder?: string;
  readOnly?: boolean;
  field?: string;
}

/* Click-to-open dropdown for controlled vocabularies (shift, staff names). */
function DropCell({ options, value, onChange, w, placeholder, readOnly, field }: DropCellProps) {
  const { active, select, setActiveEl } = useContext(FieldCtx);
  const isActive = field != null && field === active;
  const [open, setOpen] = useState<boolean>(false);
  const v = value ?? '';
  return (
    <span className="drop" style={w !== undefined ? { width: w } : undefined}>
      <button
        ref={isActive && setActiveEl ? setActiveEl : undefined}
        type="button"
        className={isActive ? 'drop-btn active' : 'drop-btn'}
        disabled={readOnly}
        onClick={() => { if (field) select?.(field); setOpen((o) => !o); }}
      >
        <span className={v !== '' ? 'drop-val' : 'drop-ph'}>{v !== '' ? v : (placeholder ?? 'Select')}</span>
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && !readOnly && (
        <>
          <div className="drop-back" onClick={() => setOpen(false)} />
          <ul className="drop-menu">
            {options.map((o) => (
              <li key={o}>
                <button
                  type="button"
                  className={o === v ? 'on' : ''}
                  onClick={() => { onChange?.(o); setOpen(false); }}
                >
                  {o}{o === v && <Check size={13} aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </span>
  );
}

const range = (a: number, b: number): number[] => {
  const out: number[] = [];
  for (let i = a; i <= b; i += 1) out.push(i);
  return out;
};

const EMPTY_HOURLY: HourlyInspectionRow = {
  timeSlot: '', topDim: '', bottomDim: '', thickness: [], finish: '', perMeter: '', colour: '', tearing: '', inspectionBy: ''
};
const EMPTY_TRACE: TraceabilityRow = { lotNumber: '', colour: '', code: '', winderPackedBy: '' };

/* ---------------------------------------------------------------- component */

export default function MachineLogBookSheet({
  logbook,
  template,
  on,
  readOnly = false,
  activeSection,
  onSelectSection,
  activeField,
  onSelectField,
  formulaOptions = []
}: MachineLogBookSheetProps) {
  const t = template;
  const l = logbook;
  const isPipe = (t.layout ?? 'coil') === 'pipe';
  const pod = t.pipeSpecs?.od;
  const pw = t.pipeSpecs?.weight;
  const thickTol = ((t.dimensionSpecs.thickness.hi - t.dimensionSpecs.thickness.lo) / 2).toFixed(1);
  const bandCls = (n: number) => `band${activeSection === n ? ' active' : ''}`;

  // Scroll the active cell into view within the sheet's own scroll box (scroll sync).
  const activeCellRef = useRef<HTMLElement | null>(null);
  const setActiveCellEl = useCallback((el: HTMLElement | null) => { if (el) activeCellRef.current = el; }, []);
  useEffect(() => {
    if (activeField) activeCellRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, [activeField]);

  return (
    <div className="sheet-wrap">
      <style>{CSS}</style>

      <FieldCtx.Provider value={{ active: activeField, select: onSelectField, setActiveEl: setActiveCellEl }}>
      <div className="sheet">
        {/* ===================== TOP HEADER ===================== */}
        <div className="top">
          <div className="brand">
            <div className="logo" dangerouslySetInnerHTML={{ __html: t.brandName.replace(/\s+/, '<br />') }} />
            <div className="loc">{t.location}</div>
          </div>
          <div className="title">{t.title}</div>
          <table className="docbox">
            <tbody>
              <tr><td>1) Process Parameters</td><td>2) Inspection Report</td><td className="dc">Doc no: {t.docNo}</td></tr>
              <tr><td>3) Traceability</td><td>4) Production Report</td><td className="dc">Rev no: {t.revNo}</td></tr>
              <tr><td colSpan={2} /><td className="dc">Rev date: {t.revDate}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="idrow">
          <span>Machine No: <Cell w="60px" field="machineId" value={l.machineId} onChange={(v) => on.scalar('machineId', v)} readOnly /></span>
          <span>Date: <Cell kind="date" w="130px" field="date" value={l.date} onChange={(v) => on.scalar('date', v)} readOnly={readOnly} /></span>
          <span>Shift: <DropCell w="72px" field="shift" options={t.shifts} value={l.shift} onChange={(v) => on.scalar('shift', v)} readOnly={readOnly} /></span>
          <span>Shift Supervisor: <DropCell w="150px" field="supervisor" options={t.supervisors} value={l.supervisor} onChange={(v) => on.scalar('supervisor', v)} readOnly={readOnly} /></span>
        </div>

        {/* ===================== 1) PROCESS PARAMETERS ===================== */}
        <div className="lb-sec">
          <div className={bandCls(1)} onClick={() => onSelectSection?.(1)}>
            <span className="bnum">1)</span> Process Parameters
            <span className="bsub">Zone Wise Temperature</span>
            <span className="bright">Lot number: {t.lotNumberNote}</span>
          </div>

          <table className="lbgrid">
            <thead>
              <tr>
                <th rowSpan={2}>Drawing No</th>
                <th rowSpan={2}>Tag</th>
                <th rowSpan={2}>Formula No</th>
                <th colSpan={t.dieZones.length}>Die Zone Temp</th>
                <th colSpan={t.barrelZones.length}>Barrel Zone Temp</th>
                <th rowSpan={2}>Main Motor Speed</th>
                <th rowSpan={2}>Ampere</th>
                <th rowSpan={2}>Takeup Speed</th>
                <th rowSpan={2}>Vacuum</th>
              </tr>
              <tr>
                {t.dieZones.map((z) => <th key={z}>{z}</th>)}
                {t.barrelZones.map((z) => <th key={z}>{z}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><Cell field="drawingNo" value={l.drawingNo} onChange={(v) => on.scalar('drawingNo', v)} readOnly={readOnly} /></td>
                <td><Cell field="tag" value={l.tag} onChange={(v) => on.scalar('tag', v)} readOnly={readOnly} /></td>
                <td><DropCell field="formulaNo" options={formulaOptions} value={l.formulaNo} onChange={(v) => on.scalar('formulaNo', v)} placeholder="Formula" readOnly={readOnly} /></td>
                {t.dieZones.map((z) => {
                  const zs = t.zoneSpecs?.[z];
                  const ranged = zs && zs.max > zs.min;
                  return (
                    <td key={z}>{ranged
                      ? <RangeCell lo={zs!.min} hi={zs!.max} field={`die:${z}`} value={l.dieZoneTemps[z] ?? ''} onChange={(v) => on.dieZone(z, v)} readOnly={readOnly} />
                      : <Cell numeric field={`die:${z}`} value={l.dieZoneTemps[z] ?? ''} onChange={(v) => on.dieZone(z, v)} readOnly={readOnly} />}</td>
                  );
                })}
                {t.barrelZones.map((z) => {
                  const zs = t.zoneSpecs?.[z];
                  const ranged = zs && zs.max > zs.min;
                  return (
                    <td key={z}>{ranged
                      ? <RangeCell lo={zs!.min} hi={zs!.max} field={`barrel:${z}`} value={l.barrelZoneTemps[z] ?? ''} onChange={(v) => on.barrelZone(z, v)} readOnly={readOnly} />
                      : <Cell numeric field={`barrel:${z}`} value={l.barrelZoneTemps[z] ?? ''} onChange={(v) => on.barrelZone(z, v)} readOnly={readOnly} />}</td>
                  );
                })}
                <td><Cell numeric field="motorSpeed" value={l.motorSpeed} onChange={(v) => on.scalar('motorSpeed', v)} readOnly={readOnly} /></td>
                <td><Cell numeric field="ampere" value={l.ampere} onChange={(v) => on.scalar('ampere', v)} readOnly={readOnly} /></td>
                <td><Cell numeric field="takeupSpeed" value={l.takeupSpeed} onChange={(v) => on.scalar('takeupSpeed', v)} readOnly={readOnly} /></td>
                <td><Cell numeric field="vacuum" value={l.vacuum} onChange={(v) => on.scalar('vacuum', v)} readOnly={readOnly} /></td>
              </tr>
            </tbody>
          </table>

          <table className="lbgrid tight">
            <tbody>
              <tr>
                <td className="lbl">Extruder start time</td><td><Cell kind="time" field="extruderStartTime" value={l.extruderStartTime} onChange={(v) => on.scalar('extruderStartTime', v)} readOnly={readOnly} /></td>
                <td className="lbl">Product / Item set time</td><td><Cell kind="time" field="productSetTime" value={l.productSetTime} onChange={(v) => on.scalar('productSetTime', v)} readOnly={readOnly} /></td>
                <td className="lbl">Shore {t.hardnessType ?? 'A'} Hardness</td><td><Cell numeric field="shoreHardness" value={l.shoreHardness} onChange={(v) => on.scalar('shoreHardness', v)} readOnly={readOnly} /></td>
                <td className="lbl">Production Per Hour</td><td><Cell numeric field="productionPerHour" value={l.productionPerHour} onChange={(v) => on.scalar('productionPerHour', v)} readOnly={readOnly} /></td>
              </tr>
              <tr>
                <td className="lbl">Mold No</td><td><Cell field="moldNo" value={l.moldNo} onChange={(v) => on.scalar('moldNo', v)} readOnly={readOnly} /></td>
                <td className="lbl">Product Name</td>
                <td colSpan={5}><Cell w="100%" field="productName" value={l.productName} onChange={(v) => on.scalar('productName', v)} readOnly={readOnly} /></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ===================== 2) INSPECTION REPORT ===================== */}
        <div className="lb-sec">
          <div className={bandCls(2)} onClick={() => onSelectSection?.(2)}><span className="bnum">2)</span> Inspection Report</div>

          {isPipe ? (
            <table className="lbgrid insp-grid">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>OD<br /><span className="sp">{pod?.nominal ?? ''} mm ±{pod?.tol ?? ''}</span></th>
                  <th>Weight<br /><span className="sp">{pw?.lo ?? ''}–{pw?.hi ?? ''} gms</span></th>
                  <th>Colour</th>
                  <th>Ok / Not ok</th>
                  <th>Inspection By</th>
                </tr>
              </thead>
              <tbody>
                {t.inspectionTimeSlots.map((slot, i) => {
                  const insp = l.hourlyInspections[i] ?? EMPTY_HOURLY;
                  return (
                    <tr key={slot}>
                      <td className="tcell">{slot}</td>
                      <td>{pod && pod.hi > pod.lo
                        ? <RangeCell lo={pod.lo} hi={pod.hi} field={`hourly:${i}:od`} value={insp.od ?? ''} onChange={(v) => on.hourly(i, 'od', v)} readOnly={readOnly} />
                        : <Cell numeric field={`hourly:${i}:od`} value={insp.od ?? ''} onChange={(v) => on.hourly(i, 'od', v)} readOnly={readOnly} />}</td>
                      <td>{pw && pw.hi > pw.lo
                        ? <RangeCell lo={pw.lo} hi={pw.hi} field={`hourly:${i}:weight`} value={insp.weight ?? ''} onChange={(v) => on.hourly(i, 'weight', v)} readOnly={readOnly} />
                        : <Cell numeric field={`hourly:${i}:weight`} value={insp.weight ?? ''} onChange={(v) => on.hourly(i, 'weight', v)} readOnly={readOnly} />}</td>
                      <td><Cell field={`hourly:${i}:colour`} value={insp.colour ?? ''} onChange={(v) => on.hourly(i, 'colour', v)} readOnly={readOnly} /></td>
                      <td><DropCell w="100px" field={`hourly:${i}:okNotOk`} options={['Ok', 'Not ok']} value={insp.okNotOk ?? ''} onChange={(v) => on.hourly(i, 'okNotOk', v)} placeholder="—" readOnly={readOnly} /></td>
                      <td><DropCell w="120px" field={`hourly:${i}:inspectionBy`} options={t.supervisors} value={insp.inspectionBy} onChange={(v) => on.hourly(i, 'inspectionBy', v)} placeholder="—" readOnly={readOnly} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
          <div className="insp">
            {/* left: dimension sketch + coil weight list */}
            <div className="insp-left">
              <div className="dimbox">
                <div className="dim-t">Top Dimension</div>
                <svg viewBox="0 0 150 60" className="dimsvg">
                  <path d="M15 40 Q75 12 135 40" fill="none" stroke="#111" strokeWidth="1.5" />
                  <path d="M15 46 Q75 20 135 46" fill="none" stroke="#111" strokeWidth="1.5" />
                  <line x1="140" y1="18" x2="140" y2="46" stroke="#111" strokeWidth="0.7" />
                  <text x="143" y="24" fontSize="7">T1</text>
                  <text x="143" y="34" fontSize="7">T2</text>
                  <text x="143" y="46" fontSize="7">T3</text>
                </svg>
                <div className="dim-b">Bottom Dimension</div>
              </div>

              <div className="coil">
                <div className="coil-hd">
                  {t.coil.perM} / M Coil Weight — {t.coil.targetKg} kg (Added Bobbin {t.coil.bobbinGms} gms)<br />
                  {t.coil.perM} / m Range <b>{t.coil.rangeLo} to {t.coil.rangeHi} kg</b>
                </div>
                <div className="coil-grid">
                  {range(1, t.coil.count).map((n) => (
                    <div className="coil-cell" key={n}>
                      <span className="cn">{n})</span>
                      <RangeCell lo={t.coil.rangeLo} hi={t.coil.rangeHi} w="60px" field={`coil:${n - 1}`} value={l.coilWeights[n - 1] ?? ''} onChange={(v) => on.coil(n - 1, v)} readOnly={readOnly} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* right: hourly inspection grid */}
            <table className="lbgrid insp-grid">
              <thead>
                <tr>
                  <th rowSpan={2}>Time</th>
                  <th rowSpan={2}>{t.dimensionSpecs.top.label}<br /><span className="sp">{t.dimensionSpecs.top.nominal} mm ±{t.dimensionSpecs.top.tol}</span></th>
                  <th rowSpan={2}>{t.dimensionSpecs.bottom.label}<br /><span className="sp">{t.dimensionSpecs.bottom.nominal} mm ±{t.dimensionSpecs.bottom.tol}</span></th>
                  <th colSpan={t.dimensionSpecs.thickness.count}>Thickness (± {thickTol} mm)</th>
                  <th rowSpan={2}>Finish<br /><span className="sp">{t.finishSpec}</span></th>
                  <th rowSpan={2}>Per meter<br /><span className="sp">{t.perMeterSpec}</span></th>
                  <th rowSpan={2}>Colour</th>
                  <th rowSpan={2}>Tearing</th>
                  <th rowSpan={2}>Inspection By</th>
                </tr>
                <tr>{range(1, t.dimensionSpecs.thickness.count).map((k) => <th key={k}>1 mm</th>)}</tr>
              </thead>
              <tbody>
                {t.inspectionTimeSlots.map((slot, i) => {
                  const insp = l.hourlyInspections[i] ?? EMPTY_HOURLY;
                  return (
                    <tr key={slot}>
                      <td className="tcell">{slot}</td>
                      <td><RangeCell lo={t.dimensionSpecs.top.lo} hi={t.dimensionSpecs.top.hi} field={`hourly:${i}:topDim`} value={insp.topDim} onChange={(v) => on.hourly(i, 'topDim', v)} readOnly={readOnly} /></td>
                      <td><RangeCell lo={t.dimensionSpecs.bottom.lo} hi={t.dimensionSpecs.bottom.hi} field={`hourly:${i}:bottomDim`} value={insp.bottomDim} onChange={(v) => on.hourly(i, 'bottomDim', v)} readOnly={readOnly} /></td>
                      {range(0, t.dimensionSpecs.thickness.count - 1).map((j) => (
                        <td key={j}><RangeCell lo={t.dimensionSpecs.thickness.lo} hi={t.dimensionSpecs.thickness.hi} field={`hourly:${i}:thickness:${j}`} value={insp.thickness[j] ?? ''} onChange={(v) => on.hourlyThickness(i, j, v)} readOnly={readOnly} /></td>
                      ))}
                      <td><Cell field={`hourly:${i}:finish`} value={insp.finish} onChange={(v) => on.hourly(i, 'finish', v)} readOnly={readOnly} /></td>
                      <td><Cell numeric field={`hourly:${i}:perMeter`} value={insp.perMeter} onChange={(v) => on.hourly(i, 'perMeter', v)} readOnly={readOnly} /></td>
                      <td><Cell field={`hourly:${i}:colour`} value={insp.colour} onChange={(v) => on.hourly(i, 'colour', v)} readOnly={readOnly} /></td>
                      <td><Cell field={`hourly:${i}:tearing`} value={insp.tearing} onChange={(v) => on.hourly(i, 'tearing', v)} readOnly={readOnly} /></td>
                      <td><DropCell w="120px" field={`hourly:${i}:inspectionBy`} options={t.supervisors} value={insp.inspectionBy} onChange={(v) => on.hourly(i, 'inspectionBy', v)} placeholder="—" readOnly={readOnly} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>

        {/* ===================== 3) TRACEABILITY ===================== */}
        <div className="lb-sec">
          <div className={bandCls(3)} onClick={() => onSelectSection?.(3)}><span className="bnum">3)</span> Traceability <span className="bsub">({t.packingNote || (isPipe ? 'Packing nos' : 'Packing 2 rolls')})</span></div>

          <div className="trace">
            {range(0, t.traceability.tableCount - 1).map((half) => (
              <table className="lbgrid trace-grid" key={half}>
                <thead>
                  {isPipe
                    ? <tr><th>Lot Number</th><th>Colour</th><th>Code</th><th>Pkt in kg</th><th>Packed By</th></tr>
                    : <tr><th>Lot Number</th><th>Colour</th><th>Code</th><th>Winder / Packed By</th></tr>}
                </thead>
                <tbody>
                  {range(1, t.traceability.rowsPerTable).map((n) => {
                    const idx = half * t.traceability.rowsPerTable + (n - 1);
                    const row = l.traceabilityRows[idx] ?? EMPTY_TRACE;
                    return isPipe ? (
                      <tr key={n}>
                        <td><Cell w="150px" field={`trace:${idx}:lotNumber`} value={row.lotNumber} onChange={(v) => on.trace(idx, 'lotNumber', v)} readOnly={readOnly} /></td>
                        <td><Cell w="52px" field={`trace:${idx}:colour`} value={row.colour} onChange={(v) => on.trace(idx, 'colour', v)} readOnly={readOnly} /></td>
                        <td><Cell w="60px" field={`trace:${idx}:code`} value={row.code} onChange={(v) => on.trace(idx, 'code', v)} readOnly={readOnly} /></td>
                        <td><Cell w="60px" numeric field={`trace:${idx}:pktKg`} value={row.pktKg ?? ''} onChange={(v) => on.trace(idx, 'pktKg', v)} readOnly={readOnly} /></td>
                        <td><DropCell w="120px" field={`trace:${idx}:packedBy`} options={t.supervisors} value={row.packedBy ?? ''} onChange={(v) => on.trace(idx, 'packedBy', v)} placeholder="—" readOnly={readOnly} /></td>
                      </tr>
                    ) : (
                      <tr key={n}>
                        <td><Cell w="150px" field={`trace:${idx}:lotNumber`} value={row.lotNumber} onChange={(v) => on.trace(idx, 'lotNumber', v)} readOnly={readOnly} /></td>
                        <td><Cell w="52px" field={`trace:${idx}:colour`} value={row.colour} onChange={(v) => on.trace(idx, 'colour', v)} readOnly={readOnly} /></td>
                        <td><Cell w="60px" field={`trace:${idx}:code`} value={row.code} onChange={(v) => on.trace(idx, 'code', v)} readOnly={readOnly} /></td>
                        <td><DropCell w="120px" field={`trace:${idx}:winderPackedBy`} options={t.supervisors} value={row.winderPackedBy ?? ''} onChange={(v) => on.trace(idx, 'winderPackedBy', v)} placeholder="—" readOnly={readOnly} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ))}
          </div>
        </div>

        {/* ===================== 4) PRODUCTION REPORT ===================== */}
        <div className="lb-sec">
          <div className={bandCls(4)} onClick={() => onSelectSection?.(4)}><span className="bnum">4)</span> Production Report</div>

          <table className="lbgrid">
            <thead>
              <tr>
                <th colSpan={2}>{isPipe ? 'Total Nos Produced' : 'Total Roll Produced'}</th>
                <th>Inevitable process waste</th>
                <th>Inevitable process Lumps waste</th>
                <th>Rejections</th>
                <th>Total material consumed (In kgs)</th>
              </tr>
              <tr>
                <th>{isPipe ? 'Nos' : 'Roll'}</th><th>Kgs</th><th>kgs</th><th>kgs</th><th>kgs</th><th />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><Cell numeric field="totalRollsProduced" value={l.totalRollsProduced} onChange={(v) => on.scalar('totalRollsProduced', v)} readOnly={readOnly} /></td>
                <td><Cell numeric field="totalRollKgs" value={l.totalRollKgs} onChange={(v) => on.scalar('totalRollKgs', v)} readOnly={readOnly} /></td>
                <td><Cell numeric field="processWasteKg" value={l.processWasteKg} onChange={(v) => on.scalar('processWasteKg', v)} readOnly={readOnly} /></td>
                <td><Cell numeric field="lumpsWasteKg" value={l.lumpsWasteKg} onChange={(v) => on.scalar('lumpsWasteKg', v)} readOnly={readOnly} /></td>
                <td><Cell numeric field="rejectionKg" value={l.rejectionKg} onChange={(v) => on.scalar('rejectionKg', v)} readOnly={readOnly} /></td>
                <td><Cell numeric field="totalConsumedKg" value={l.totalConsumedKg} onChange={(v) => on.scalar('totalConsumedKg', v)} readOnly={readOnly} /></td>
              </tr>
            </tbody>
          </table>

          <div className="rej">
            <span className="rej-hd">Reason for rejections:</span>
            {t.rejectionReasons.map((r, i) => (
              <span className="rej-item" key={r}>{i + 1}) {r} <Cell numeric w="42px" field={`rej:${r}`} value={l.rejectionCounts[r] ?? ''} onChange={(v) => on.rejection(r, v)} readOnly={readOnly} /></span>
            ))}
          </div>

          <table className="lbgrid tight">
            <tbody>
              <tr>
                <td className="lbl">Meter Checked manually by</td><td><DropCell w="140px" field="meterCheckedBy" options={t.supervisors} value={l.meterCheckedBy} onChange={(v) => on.scalar('meterCheckedBy', v)} readOnly={readOnly} /></td>
                <td className="lbl">Meter check time</td><td><Cell kind="time" field="meterCheckTime" value={l.meterCheckTime} onChange={(v) => on.scalar('meterCheckTime', v)} readOnly={readOnly} /></td>
                <td className="lbl">Meter</td><td><Cell kind="meter" field="meter" value={l.meter} onChange={(v) => on.scalar('meter', v)} readOnly={readOnly} /></td>
                <td className="lbl">Meter Count Set</td><td><Cell numeric field="meterCountSet" value={l.meterCountSet} onChange={(v) => on.scalar('meterCountSet', v)} readOnly={readOnly} /></td>
              </tr>
            </tbody>
          </table>

          <div className="notes">
            {t.notes.map((n, i) => (
              <div key={i}><b>NOTE {i + 1}:-</b> {n}</div>
            ))}
          </div>

          <div className="sign">
            <div>
              <div className="sign-lbl">Inspector signature</div>
              <Cell field="operatorSignature" value={l.operatorSignature} onChange={(v) => on.scalar('operatorSignature', v)} readOnly={readOnly} />
            </div>
            <div>
              <div className="sign-lbl">Shift incharge signature</div>
              <Cell field="supervisorSignature" value={l.supervisorSignature} onChange={(v) => on.scalar('supervisorSignature', v)} readOnly={readOnly} />
            </div>
          </div>
        </div>
      </div>
      </FieldCtx.Provider>
    </div>
  );
}

/* ---------------------------------------------------------------- styles */

const CSS = `
.sheet-wrap{background:#e9e7e0;padding:16px;font-family:Arial,Helvetica,sans-serif;color:#111}
.toolbar{max-width:920px;margin:0 auto 10px;display:flex;justify-content:flex-end}
.print-btn{border:1px solid #0f4c81;background:#0f4c81;color:#fff;border-radius:6px;padding:8px 16px;font-size:14px;font-weight:700;cursor:pointer}
.sheet{max-width:920px;margin:0 auto;background:#fff;border:2px solid #111;padding:10px 12px 14px;font-size:13px}
.sheet *{box-sizing:border-box}

.cin{border:0;background:transparent;font-family:inherit;font-size:14px;width:100%;min-height:28px;padding:4px 6px;outline:none;color:#0a2a6b}
.cin:focus{background:#eef4fb}
.cin.oor{background:#fbeedb;color:#a9660a;font-weight:700}
.cin.active{background:#dbe9fb;box-shadow:0 0 0 2px #0f4c81 inset;border-radius:3px}
.cin[readonly]{cursor:default}
.cin-pick{min-width:8.5rem;font-size:13px;min-height:30px}
.sign-lbl{font-size:10px;font-weight:700;color:#444;margin-bottom:2px}
.sign .cin{border-bottom:1px solid #999;min-height:28px}

/* permissible-value hint on measurement cells */
.rc{position:relative;display:block}
.hint{position:absolute;z-index:30;top:100%;left:0;margin-top:2px;background:#0f4c81;color:#fff;font-size:10px;font-weight:700;padding:3px 7px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.25)}
.hint::before{content:"";position:absolute;top:-4px;left:8px;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:4px solid #0f4c81}

/* click-to-open dropdown */
.drop{position:relative;display:inline-block}
.drop-btn{display:inline-flex;align-items:center;justify-content:space-between;gap:4px;width:100%;min-height:28px;border:0;background:transparent;font-family:inherit;font-size:14px;cursor:pointer;padding:4px 6px;color:#0a2a6b;border-radius:3px}
.drop-btn:hover{background:#eef4fb}
.drop-btn.active{background:#dbe9fb;box-shadow:0 0 0 2px #0f4c81 inset}
.drop-btn:disabled{cursor:default}
.drop-val{font-weight:600}
.drop-ph{color:#9a988f}
.drop-btn svg{flex:0 0 auto;color:#5f5e5a}
.drop-back{position:fixed;inset:0;z-index:40}
.drop-menu{position:absolute;z-index:41;top:100%;left:0;margin:2px 0 0;padding:4px;list-style:none;min-width:130px;background:#fff;border:1px solid #0f4c81;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.22)}
.drop-menu li{margin:0}
.drop-menu li button{display:flex;align-items:center;justify-content:space-between;width:100%;text-align:left;border:0;background:transparent;font-family:inherit;font-size:13px;padding:8px 10px;border-radius:6px;cursor:pointer;color:#111;min-height:40px}
.drop-menu li button:hover{background:#eef4fb}
.drop-menu li button.on{background:#0f4c81;color:#fff;font-weight:600}

.top{display:flex;align-items:stretch;border:1px solid #111;border-bottom:0}
.brand{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 10px;border-right:1px solid #111;min-width:110px}
.logo{font-weight:800;font-size:13px;line-height:1;text-align:center}
.loc{font-size:8px;letter-spacing:1px;margin-top:2px}
.title{flex:1;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;letter-spacing:1px;border-right:1px solid #111}
.docbox{border-collapse:collapse;font-size:11px}
.docbox td{border:1px solid #111;padding:2px 6px;white-space:nowrap}
.docbox .dc{font-weight:700}

.idrow{display:flex;flex-wrap:wrap;gap:0;border:1px solid #111;align-items:center;margin-bottom:14px}
.idrow>span{display:flex;align-items:center;gap:4px;padding:4px 8px;border-right:1px solid #111;font-weight:600}
.idrow>span:last-child{border-right:0;flex:1}

/* each numbered section is a separated block */
.lb-sec{margin-bottom:14px}
.lb-sec:last-child{margin-bottom:0}

.band{background:#dfe7f1;border:1px solid #111;padding:3px 8px;font-weight:800;font-size:13px;cursor:pointer}
.band.active{background:#c5d6ec;box-shadow:inset 3px 0 0 #0f4c81}
.band .bnum{margin-right:2px}
.band .bsub{font-weight:600;font-size:11px;margin-left:12px}
.band .bright{float:right;font-weight:600;font-size:11px}

.lbgrid{width:100%;border-collapse:collapse;border:1px solid #111;border-top:0}
.lbgrid th,.lbgrid td{border:1px solid #111;padding:3px 4px;text-align:center;vertical-align:middle}
.lbgrid th{background:#f3f1ea;font-size:10px;font-weight:700;line-height:1.1}
.lbgrid th .sp{font-weight:400;font-size:9px}
.lbgrid td{height:30px}
.lbgrid .lbl{background:#f7f6f1;font-weight:600;text-align:left;white-space:nowrap;font-size:11px}
.lbgrid.tight td{height:28px}
.lbgrid .tcell{font-weight:700;background:#f7f6f1;white-space:nowrap}

/* section 2 layout */
.insp{display:flex;align-items:flex-start;border:1px solid #111;border-top:0}
.insp-left{width:300px;flex:0 0 300px;border-right:1px solid #111}
.dimbox{border-bottom:1px solid #111;padding:4px 6px;text-align:center}
.dim-t,.dim-b{font-size:10px;font-weight:600}
.dimsvg{width:150px;height:56px}
.coil-hd{padding:4px 6px;font-size:10px;border-bottom:1px solid #111;line-height:1.3}
.coil-grid{display:grid;grid-template-columns:1fr 1fr}
.coil-cell{display:flex;align-items:center;border-bottom:1px solid #ddd;border-right:1px solid #ddd;padding:0 2px}
.coil-cell .cn{font-size:10px;font-weight:700;width:24px;flex:0 0 24px}
.insp-grid{border:0;flex:1}
.insp-grid td{height:32px}

/* section 3 */
.trace{display:flex;gap:0;border:1px solid #111;border-top:0}
.trace-grid{border:0;border-right:1px solid #111}
.trace-grid:last-child{border-right:0}
.trace-grid td{height:28px;text-align:left}

/* section 4 */
.rej{border:1px solid #111;border-top:0;padding:5px 8px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 16px}
.rej-hd{font-weight:800}
.rej-item{display:flex;align-items:center;gap:4px;font-size:11px;border-bottom:1px solid #111}
.notes{border:1px solid #111;border-top:0;padding:5px 8px;font-size:10px;line-height:1.5}
.sign{display:flex;justify-content:space-between;border:1px solid #111;border-top:0;padding:26px 20px 8px;font-weight:700;font-size:12px}

@media print{
  .sheet-wrap{background:#fff;padding:0}
  .toolbar{display:none}
  .sheet{border:1.5px solid #000;max-width:none}
  .cin:focus{background:transparent}
  .cin.active{background:transparent;box-shadow:none}
  .drop-btn.active{background:transparent;box-shadow:none}
  .drop-btn svg,.hint{display:none}
  .drop-btn:hover{background:transparent}
  .band{cursor:default}
  .lb-sec{margin-bottom:0}
  .idrow{margin-bottom:0}
  @page{size:A4 portrait;margin:8mm}
}
@media(max-width:700px){
  .insp{flex-direction:column}.insp-left{width:100%;flex:1 1 auto;border-right:0;border-bottom:1px solid #111}
  .trace{flex-direction:column}.trace-grid{border-right:0;border-bottom:1px solid #111}
  .title{font-size:16px}
}
`;
