import { describe, expect, it } from 'vitest';
import {
  isInvalidDate,
  isInvalidMeter,
  isInvalidNumber,
  isInvalidTime,
  isOutOfRange,
  normalizeDate,
  normalizeTime,
  sanitizeDecimal,
  sanitizeMeter,
  validateLogbookForSubmit,
} from '../logbookValidation';

describe('sanitizeDecimal — every numeric parameter', () => {
  it.each([
    ['abc', ''],
    ['12a3', '123'],
    ['1.2.3', '1.23'],
    ['-12.5kg', '-12.5'],
    ['26.20', '26.20'],
  ])('sanitizeDecimal(%j) → %j', (raw, expected) => {
    expect(sanitizeDecimal(raw)).toBe(expected);
  });
});

describe('date formats', () => {
  it('normalizes common plant formats to YYYY-MM-DD', () => {
    expect(normalizeDate('2026-07-01')).toBe('2026-07-01');
    expect(normalizeDate('01/07/26')).toBe('2026-07-01');
    expect(normalizeDate('1/7/2026')).toBe('2026-07-01');
    expect(normalizeDate('01-07-2026')).toBe('2026-07-01');
  });
  it('flags invalid calendar dates', () => {
    expect(isInvalidDate('')).toBe(false);
    expect(isInvalidDate('2026-07-01')).toBe(false);
    expect(isInvalidDate('not-a-date')).toBe(true);
    expect(isInvalidDate('2026-13-40')).toBe(true);
  });
});

describe('time formats', () => {
  it('normalizes to HH:mm', () => {
    expect(normalizeTime('9:00')).toBe('09:00');
    expect(normalizeTime('09:00')).toBe('09:00');
    expect(normalizeTime('3:00 pm')).toBe('15:00');
    expect(normalizeTime('12:00 am')).toBe('00:00');
  });
  it('flags invalid times', () => {
    expect(isInvalidTime('')).toBe(false);
    expect(isInvalidTime('09:00')).toBe(false);
    expect(isInvalidTime('25:99')).toBe(true);
    expect(isInvalidTime('morning')).toBe(true);
  });
});

describe('meter format', () => {
  it('allows 154 and 154/M style readings', () => {
    expect(isInvalidMeter('')).toBe(false);
    expect(isInvalidMeter('154')).toBe(false);
    expect(isInvalidMeter('154/M')).toBe(false);
    expect(isInvalidMeter('bad!!')).toBe(true);
    expect(sanitizeMeter('154/Mxx!')).toBe('154/Mxx');
  });
});

describe('range + type for process parameters', () => {
  const template = {
    layout: 'coil' as const,
    dieZones: ['Die 6'],
    barrelZones: ['Zone 1'],
    zoneSpecs: {
      'Die 6': { min: 130, max: 140, target: 135 },
      'Zone 1': { min: 115, max: 130, target: 122 },
    },
    coil: { count: 2, rangeLo: 7.945, rangeHi: 7.995 },
    dimensionSpecs: {
      top: { lo: 13.2, hi: 13.6, label: 'Top Dim' },
      bottom: { lo: 12.8, hi: 13.2, label: 'Bottom Dim' },
      thickness: { lo: 0.9, hi: 1.1, count: 1 },
    },
    rejectionReasons: ['Bubble Issue'],
  };

  it('validates every numeric / date / time / meter parameter on submit', () => {
    const issues = validateLogbookForSubmit({
      operatorSignature: 'Nandlal',
      date: '01/07/99xx',
      extruderStartTime: 'morning',
      productSetTime: '9:00',
      meterCheckTime: '15:00',
      meter: 'nope',
      motorSpeed: 'fast',
      ampere: '15',
      dieZoneTemps: { 'Die 6': '100' },
      barrelZoneTemps: { 'Zone 1': '120' },
      coilWeights: ['7.97', '8.5'],
      hourlyInspections: [{ timeSlot: '9–10', topDim: '13.4', bottomDim: '13.0', thickness: ['0.95'], perMeter: '52' }],
      rejectionCounts: { 'Bubble Issue': 'x' },
    }, template);

    const fields = issues.map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining([
      'date', 'extruderStartTime', 'meter', 'motorSpeed', 'die:Die 6', 'coil:1', 'rej:Bubble Issue',
    ]));
    expect(fields).not.toContain('ampere');
    expect(fields).not.toContain('productSetTime');
  });

  it('passes a fully valid sheet', () => {
    expect(validateLogbookForSubmit({
      operatorSignature: 'Nandlal',
      supervisorSignature: 'Suresh',
      date: '2026-07-01',
      shift: 'D',
      supervisor: 'Nandlal',
      productName: 'RPVC',
      formulaNo: 'RF03',
      extruderStartTime: '09:00',
      productSetTime: '09:15',
      meterCheckTime: '15:00',
      meter: '154/M',
      motorSpeed: '26.2',
      ampere: '15',
      takeupSpeed: '15.65',
      vacuum: '0.4',
      shoreHardness: '85',
      productionPerHour: '25',
      dieZoneTemps: { 'Die 6': '135' },
      barrelZoneTemps: { 'Zone 1': '122' },
      coilWeights: ['7.97', '7.96'],
      hourlyInspections: [{ timeSlot: '9–10', topDim: '13.4', bottomDim: '13.0', thickness: ['1.0'], perMeter: '52' }],
      rejectionCounts: { 'Bubble Issue': '0' },
      scrapKg: '1.2',
      meterCountSet: '314',
    }, template)).toEqual([]);
  });

  it('flags empty required fields when closing', () => {
    const issues = validateLogbookForSubmit({
      operatorSignature: '',
      supervisorSignature: '',
      date: '',
      shift: '',
      supervisor: '',
      productName: '',
      formulaNo: '',
    }, template);
    const fields = issues.filter((i) => i.kind === 'required').map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining([
      'date', 'shift', 'supervisor', 'productName', 'formulaNo', 'operatorSignature', 'supervisorSignature',
    ]));
    expect(issues.every((i) => i.kind !== 'required' || i.message.endsWith('is empty.'))).toBe(true);
  });

  it('isOutOfRange and isInvalidNumber cover empty vs filled', () => {
    expect(isInvalidNumber('')).toBe(false);
    expect(isInvalidNumber('abc')).toBe(true);
    expect(isOutOfRange('', 1, 2)).toBe(false);
    expect(isOutOfRange('3', 1, 2)).toBe(true);
  });
});
