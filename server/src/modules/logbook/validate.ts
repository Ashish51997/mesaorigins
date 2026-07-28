/**
 * Server-side mirror of client logbook field validation (submit gate).
 */

export type FieldKind = 'text' | 'number' | 'date' | 'time';

/** Digits, one decimal point, optional leading minus — strip letters/symbols. */
export function sanitizeDecimal(raw: string): string {
  let s = raw.replace(/[^\d.\-]/g, '');
  if (s.includes('-')) s = (s.startsWith('-') ? '-' : '') + s.replace(/-/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) {
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  }
  return s;
}

/** Strip to digits + one colon while typing a clock time (before native picker). */
export function sanitizeTimeTyping(raw: string): string {
  let s = raw.replace(/[^\d:]/g, '');
  const parts = s.split(':');
  if (parts.length === 1) return parts[0].slice(0, 4);
  return `${parts[0].slice(0, 2)}:${parts.slice(1).join('').slice(0, 2)}`;
}

/** Empty is allowed. Non-empty must parse as a finite number. */
export function isInvalidNumber(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (v === '') return false;
  return !Number.isFinite(Number(v));
}

/** True when a parseable number sits outside [lo, hi]. */
export function isOutOfRange(value: string | null | undefined, lo?: number | null, hi?: number | null): boolean {
  if (lo == null || hi == null || !(hi > lo)) return false;
  const v = (value ?? '').trim();
  if (v === '') return false;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return false;
  return n < lo || n > hi;
}

/** Canonical store format for date inputs: YYYY-MM-DD. */
export function normalizeDate(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

  // DD/MM/YYYY or DD/MM/YY or DD-MM-YYYY
  const m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return v;
    return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const t = Date.parse(v);
  if (!Number.isNaN(t)) {
    const dt = new Date(t);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  return v;
}

/** Canonical store format for time inputs: HH:mm (24h). */
export function normalizeTime(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  const ampm = v.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = Number(ampm[2]);
    const ap = ampm[3].toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return v;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  const m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return v;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return v;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function isInvalidDate(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (v === '') return false;
  const n = normalizeDate(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n)) return true;
  const [y, mo, d] = n.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d;
}

export function isInvalidTime(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (v === '') return false;
  const n = normalizeTime(v);
  if (!/^\d{2}:\d{2}$/.test(n)) return true;
  const [h, m] = n.split(':').map(Number);
  return h > 23 || m > 59;
}

/** Meter reading style used on paper sheets, e.g. 154/M or 154. */
export function isInvalidMeter(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (v === '') return false;
  return !/^\d+(\.\d+)?(\/[A-Za-z0-9]+)?$/.test(v);
}

export function sanitizeMeter(raw: string): string {
  // Allow digits, one dot, and one slash + alphanumerics after (e.g. 154/M).
  let s = raw.replace(/[^\d./A-Za-z]/g, '');
  const slash = s.indexOf('/');
  if (slash === -1) {
    return sanitizeDecimal(s);
  }
  const left = sanitizeDecimal(s.slice(0, slash));
  const right = s.slice(slash + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
  return right ? `${left}/${right}` : `${left}/`;
}

export interface LogbookFieldIssue {
  field: string;
  label: string;
  kind: 'type' | 'range' | 'required' | 'format';
  message: string;
}

type ZoneSpec = { min: number; max: number };
type DimRange = { lo: number; hi: number; label?: string };
type TemplateLike = {
  layout?: string;
  dieZones?: string[];
  barrelZones?: string[];
  zoneSpecs?: Record<string, ZoneSpec>;
  coil?: { count: number; rangeLo: number; rangeHi: number };
  dimensionSpecs?: {
    top: DimRange;
    bottom: DimRange;
    thickness: DimRange & { count?: number };
  };
  pipeSpecs?: {
    od?: DimRange;
    weight?: DimRange;
  };
  rejectionReasons?: string[];
};

type HourlyLike = {
  timeSlot?: string;
  topDim?: string;
  bottomDim?: string;
  thickness?: string[];
  perMeter?: string;
  od?: string;
  weight?: string;
  okNotOk?: string;
};

type LogbookLike = {
  operatorSignature?: string;
  date?: string;
  extruderStartTime?: string;
  productSetTime?: string;
  meterCheckTime?: string;
  motorSpeed?: string;
  ampere?: string;
  takeupSpeed?: string;
  vacuum?: string;
  shoreHardness?: string;
  productionPerHour?: string;
  totalRollsProduced?: string;
  totalRollKgs?: string;
  processWasteKg?: string;
  lumpsWasteKg?: string;
  rejectionKg?: string;
  totalConsumedKg?: string;
  meter?: string;
  meterCountSet?: string;
  scrapKg?: string;
  dieZoneTemps?: Record<string, string>;
  barrelZoneTemps?: Record<string, string>;
  coilWeights?: string[];
  hourlyInspections?: HourlyLike[];
  rejectionCounts?: Record<string, string>;
  traceabilityRows?: Array<{ pktKg?: string }>;
};

function pushType(issues: LogbookFieldIssue[], field: string, label: string, value: string | undefined) {
  if (isInvalidNumber(value)) {
    issues.push({ field, label, kind: 'type', message: `${label} must be a number.` });
  }
}

function pushRange(
  issues: LogbookFieldIssue[],
  field: string,
  label: string,
  value: string | undefined,
  lo?: number | null,
  hi?: number | null,
) {
  if (isInvalidNumber(value)) {
    pushType(issues, field, label, value);
    return;
  }
  if (isOutOfRange(value, lo, hi)) {
    issues.push({
      field,
      label,
      kind: 'range',
      message: `${label} must be between ${lo} and ${hi}.`,
    });
  }
}

function pushFormat(
  issues: LogbookFieldIssue[],
  field: string,
  label: string,
  bad: boolean,
  message: string,
) {
  if (bad) issues.push({ field, label, kind: 'format', message });
}

/** Collect issues that should block Submit & lock. */
export function validateLogbookForSubmit(lb: LogbookLike, template: TemplateLike): LogbookFieldIssue[] {
  const issues: LogbookFieldIssue[] = [];
  const isPipe = (template.layout ?? 'coil') === 'pipe';

  if (!(lb.operatorSignature ?? '').trim()) {
    issues.push({
      field: 'operatorSignature',
      label: 'Operator signature',
      kind: 'required',
      message: 'The operator must sign the sheet before submitting.',
    });
  }

  pushFormat(issues, 'date', 'Date', isInvalidDate(lb.date), 'Date must be a valid calendar date.');
  pushFormat(issues, 'extruderStartTime', 'Extruder start time', isInvalidTime(lb.extruderStartTime), 'Extruder start time must be HH:MM.');
  pushFormat(issues, 'productSetTime', 'Product set time', isInvalidTime(lb.productSetTime), 'Product set time must be HH:MM.');
  pushFormat(issues, 'meterCheckTime', 'Meter check time', isInvalidTime(lb.meterCheckTime), 'Meter check time must be HH:MM.');
  pushFormat(issues, 'meter', 'Meter', isInvalidMeter(lb.meter), 'Meter must look like 154 or 154/M.');

  const scalars: Array<[keyof LogbookLike & string, string]> = [
    ['motorSpeed', 'Main Motor Speed'],
    ['ampere', 'Ampere'],
    ['takeupSpeed', 'Takeup Speed'],
    ['vacuum', 'Vacuum'],
    ['shoreHardness', 'Shore Hardness'],
    ['productionPerHour', 'Production Per Hour'],
    ['totalRollsProduced', 'Total rolls produced'],
    ['totalRollKgs', 'Total roll kgs'],
    ['processWasteKg', 'Process waste (kg)'],
    ['lumpsWasteKg', 'Lumps waste (kg)'],
    ['rejectionKg', 'Rejection (kg)'],
    ['totalConsumedKg', 'Total material consumed'],
    ['meterCountSet', 'Meter Count Set'],
    ['scrapKg', 'Scrap (kg)'],
  ];
  for (const [key, label] of scalars) {
    pushType(issues, key, label, lb[key] as string | undefined);
  }

  for (const z of template.dieZones ?? []) {
    const zs = template.zoneSpecs?.[z];
    pushRange(issues, `die:${z}`, `${z} (°C)`, lb.dieZoneTemps?.[z], zs?.min, zs?.max);
  }
  for (const z of template.barrelZones ?? []) {
    const zs = template.zoneSpecs?.[z];
    pushRange(issues, `barrel:${z}`, `${z} (°C)`, lb.barrelZoneTemps?.[z], zs?.min, zs?.max);
  }

  if (!isPipe) {
    const coil = template.coil;
    (lb.coilWeights ?? []).forEach((w, i) => {
      pushRange(issues, `coil:${i}`, `Coil ${i + 1} weight`, w, coil?.rangeLo, coil?.rangeHi);
    });
  }

  const dims = template.dimensionSpecs;
  (lb.hourlyInspections ?? []).forEach((row, i) => {
    const slot = row.timeSlot || `Slot ${i + 1}`;
    if (isPipe) {
      pushRange(issues, `hourly:${i}:od`, `${slot} · OD`, row.od, template.pipeSpecs?.od?.lo, template.pipeSpecs?.od?.hi);
      pushRange(issues, `hourly:${i}:weight`, `${slot} · Weight`, row.weight, template.pipeSpecs?.weight?.lo, template.pipeSpecs?.weight?.hi);
      if (row.okNotOk && !['ok', 'not ok', 'OK', 'Not ok', 'NOT OK'].includes(row.okNotOk) && !/^(ok|not\s*ok)$/i.test(row.okNotOk)) {
        // allow free legacy values but prefer Ok / Not ok — no hard fail for other text
      }
    } else if (dims) {
      pushRange(issues, `hourly:${i}:topDim`, `${slot} · ${dims.top.label ?? 'Top'}`, row.topDim, dims.top.lo, dims.top.hi);
      pushRange(issues, `hourly:${i}:bottomDim`, `${slot} · ${dims.bottom.label ?? 'Bottom'}`, row.bottomDim, dims.bottom.lo, dims.bottom.hi);
      (row.thickness ?? []).forEach((th, j) => {
        pushRange(issues, `hourly:${i}:thickness:${j}`, `${slot} · Thickness ${j + 1}`, th, dims.thickness.lo, dims.thickness.hi);
      });
      pushType(issues, `hourly:${i}:perMeter`, `${slot} · Per meter`, row.perMeter);
    }
  });

  for (const r of template.rejectionReasons ?? []) {
    pushType(issues, `rej:${r}`, r, lb.rejectionCounts?.[r]);
  }

  (lb.traceabilityRows ?? []).forEach((row, i) => {
    if (row.pktKg != null) pushType(issues, `trace:${i}:pktKg`, `Pkt kg (row ${i + 1})`, row.pktKg);
  });

  return issues;
}

export function summarizeLogbookIssues(issues: LogbookFieldIssue[]): string {
  if (issues.length === 0) return '';
  if (issues.length === 1) return issues[0].message;
  return `${issues[0].message} (+${issues.length - 1} more)`;
}

/** Normalize date/time fields after load so native pickers can display them. */
export function normalizeLogbookFormats<T extends LogbookLike>(lb: T): T {
  return {
    ...lb,
    date: normalizeDate(lb.date),
    extruderStartTime: normalizeTime(lb.extruderStartTime),
    productSetTime: normalizeTime(lb.productSetTime),
    meterCheckTime: normalizeTime(lb.meterCheckTime),
  };
}
