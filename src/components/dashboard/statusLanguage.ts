/**
 * statusLanguage.ts — the dashboard's vocabulary.
 *
 * The stored data model still uses terse enums ('draft', 'pending', …) because
 * that is what the API and Prisma schema persist. Nothing on a dashboard may
 * show those words: a status has to be a sentence a supervisor could say aloud
 * in a shift handover. This module is the only place that translation happens,
 * so every screen speaks the same language.
 *
 * Every status carries three things — tone (colour), word (the sentence) and an
 * icon — because colour must never stand alone. Only three tones exist:
 *   green = normal / pass, amber = needs attention / hold, red = stopped / fail / overdue.
 */

import {
  CheckCircle2, AlertTriangle, OctagonX, Clock3, PauseCircle, Truck, Pencil,
  PackageCheck, Factory, Send, ThumbsUp, type LucideIcon,
} from 'lucide-react';
import type {
  Inquiry, SalesOrder, ProductionPlan, MachineLogbook, RollRecord,
  QualityInspection, CustomerComplaint, CAPARecord, MaintenanceTask, DispatchRecord,
} from '../../types';

export type Tone = 'green' | 'amber' | 'red';

/** A status ready to render: colour + word + icon, never one without the others. */
export interface StatusView {
  tone: Tone;
  word: string;
  icon: LucideIcon;
}

/* ------------------------------------------------------------------ *
 * Per-entity vocabularies. Keys are the stored enum values; the values
 * are what a person actually says. Records are keyed by the literal
 * union (not a string index) so lookups stay total under
 * noUncheckedIndexedAccess — no undefined, no fallback branch.
 * ------------------------------------------------------------------ */

export const INQUIRY_STATUS: Record<Inquiry['status'], StatusView> = {
  draft: { tone: 'amber', word: 'Being written', icon: Pencil },
  submitted: { tone: 'green', word: 'Waiting for sales review', icon: Clock3 },
  approved: { tone: 'green', word: 'Approved — ready to quote', icon: ThumbsUp },
  quotation: { tone: 'green', word: 'Quotation sent — waiting for customer', icon: Send },
};

export const ORDER_STATUS: Record<SalesOrder['status'], StatusView> = {
  pending: { tone: 'amber', word: 'Order confirmed — waiting for planning', icon: Clock3 },
  planned: { tone: 'green', word: 'Planned onto a machine', icon: CheckCircle2 },
  in_production: { tone: 'green', word: 'Running on the line', icon: Factory },
  inspected: { tone: 'green', word: 'Passed inspection', icon: CheckCircle2 },
  packed: { tone: 'green', word: 'Packed — ready to dispatch', icon: PackageCheck },
  dispatched: { tone: 'green', word: 'Dispatched to customer', icon: Truck },
};

export const PLAN_STATUS: Record<ProductionPlan['status'], StatusView> = {
  scheduled: { tone: 'green', word: 'Scheduled', icon: Clock3 },
  running: { tone: 'green', word: 'Running now', icon: Factory },
  completed: { tone: 'green', word: 'Finished', icon: CheckCircle2 },
};

export const LOGBOOK_STATUS: Record<MachineLogbook['status'], StatusView> = {
  draft: { tone: 'amber', word: 'Being filled in', icon: Pencil },
  submitted: { tone: 'green', word: 'Submitted for the shift', icon: CheckCircle2 },
};

export const ROLL_STATUS: Record<RollRecord['status'], StatusView> = {
  pending: { tone: 'amber', word: 'Waiting for QA check', icon: Clock3 },
  passed: { tone: 'green', word: 'Passed QA', icon: CheckCircle2 },
  failed: { tone: 'red', word: 'Failed QA', icon: OctagonX },
};

export const INSPECTION_DECISION: Record<QualityInspection['decision'], StatusView> = {
  pass: { tone: 'green', word: 'Passed', icon: CheckCircle2 },
  fail: { tone: 'red', word: 'Failed', icon: OctagonX },
  hold: { tone: 'red', word: 'On hold', icon: PauseCircle },
};

export const COMPLAINT_STATUS: Record<CustomerComplaint['status'], StatusView> = {
  open: { tone: 'amber', word: 'Open — needs first response', icon: AlertTriangle },
  investigating: { tone: 'amber', word: 'Under investigation', icon: Clock3 },
  resolved: { tone: 'green', word: 'Resolved', icon: CheckCircle2 },
};

export const CAPA_STATUS: Record<CAPARecord['status'], StatusView> = {
  open: { tone: 'amber', word: 'Open — not started', icon: AlertTriangle },
  in_progress: { tone: 'amber', word: 'Work in progress', icon: Clock3 },
  closed: { tone: 'green', word: 'Closed', icon: CheckCircle2 },
};

export const MAINTENANCE_STATUS: Record<MaintenanceTask['status'], StatusView> = {
  scheduled: { tone: 'green', word: 'Scheduled', icon: Clock3 },
  completed: { tone: 'green', word: 'Done', icon: CheckCircle2 },
  overdue: { tone: 'red', word: 'Overdue', icon: OctagonX },
};

export const DISPATCH_STATUS: Record<DispatchRecord['status'], StatusView> = {
  shipped: { tone: 'green', word: 'On the way', icon: Truck },
  delivered: { tone: 'green', word: 'Delivered', icon: CheckCircle2 },
};

/** Line/machine state — the three words the shop floor already uses. */
export type LineState = 'running' | 'attention' | 'stopped';

export const LINE_STATUS: Record<LineState, StatusView> = {
  running: { tone: 'green', word: 'Running', icon: CheckCircle2 },
  attention: { tone: 'amber', word: 'Needs attention', icon: AlertTriangle },
  stopped: { tone: 'red', word: 'Stopped', icon: OctagonX },
};

/* ------------------------------------------------------------------ *
 * String-safe lookups.
 *
 * The API types status as a plain `string` (the server carries extra states
 * such as 'ordered' that the client union never listed). Rather than cast at
 * every call site, these resolve a loose string and fall back to a readable
 * sentence — an unknown status shows as itself, never as a blank chip.
 * ------------------------------------------------------------------ */

function lookup(map: Record<string, StatusView | undefined>, key: string): StatusView {
  return map[key] ?? {
    tone: 'amber',
    // 'in_production' → 'In production': still a sentence, never a raw enum.
    word: key ? `${key.charAt(0).toUpperCase()}${key.slice(1)}`.replace(/_/g, ' ') : 'Not recorded',
    icon: Clock3,
  };
}

export const inquiryStatus = (s: string): StatusView => lookup(INQUIRY_STATUS, s);
export const orderStatus = (s: string): StatusView => lookup(ORDER_STATUS, s);
export const planStatus = (s: string): StatusView => lookup(PLAN_STATUS, s);
export const logbookStatus = (s: string): StatusView => lookup(LOGBOOK_STATUS, s);
export const rollStatus = (s: string): StatusView => lookup(ROLL_STATUS, s);
export const inspectionDecision = (s: string): StatusView => lookup(INSPECTION_DECISION, s);
export const complaintStatus = (s: string): StatusView => lookup(COMPLAINT_STATUS, s);
export const capaStatus = (s: string): StatusView => lookup(CAPA_STATUS, s);
export const maintenanceStatus = (s: string): StatusView => lookup(MAINTENANCE_STATUS, s);
export const dispatchStatus = (s: string): StatusView => lookup(DISPATCH_STATUS, s);

/** Narrow a loose machine status to the three line states. */
export function toLineState(s: string): LineState {
  return s === 'stopped' || s === 'attention' || s === 'running' ? s : 'running';
}

/* ------------------------------------------------------------------ *
 * Plain-language clocks. "Respond within 3 days — 2 days left", never
 * "SLA: HIGH". Overdue is the only red.
 * ------------------------------------------------------------------ */

/** Whole days from `from` until `iso`; negative once the date has passed. */
export function daysUntil(iso: string, from: Date = new Date()): number {
  const target = new Date(`${iso}T00:00:00`).getTime();
  if (Number.isNaN(target)) return 0;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  return Math.round((target - start) / 86_400_000);
}

/** Whole days elapsed since `iso`; 0 for today or an unparseable date. */
export function daysSince(iso: string, from: Date = new Date()): number {
  return Math.max(0, -daysUntil(iso, from));
}

/** "2 days left" / "Due today" / "3 days overdue" — with the tone that matches. */
export function countdown(dueDateIso: string, from: Date = new Date()): StatusView {
  const left = daysUntil(dueDateIso, from);
  if (left < 0) {
    const over = -left;
    return { tone: 'red', word: `${over} ${over === 1 ? 'day' : 'days'} overdue`, icon: OctagonX };
  }
  if (left === 0) return { tone: 'amber', word: 'Due today', icon: AlertTriangle };
  if (left <= 2) return { tone: 'amber', word: `${left} ${left === 1 ? 'day' : 'days'} left`, icon: Clock3 };
  return { tone: 'green', word: `${left} days left`, icon: Clock3 };
}

/** The complaint response clock, spelled out: "Respond within 7 days — 2 days left". */
export function responseClock(raisedIso: string, windowDays = 7, from: Date = new Date()): StatusView {
  const used = daysSince(raisedIso, from);
  const left = windowDays - used;
  if (left < 0) return { tone: 'red', word: `Respond within ${windowDays} days — ${-left} ${-left === 1 ? 'day' : 'days'} overdue`, icon: OctagonX };
  if (left === 0) return { tone: 'amber', word: `Respond within ${windowDays} days — due today`, icon: AlertTriangle };
  return {
    tone: left <= 2 ? 'amber' : 'green',
    word: `Respond within ${windowDays} days — ${left} ${left === 1 ? 'day' : 'days'} left`,
    icon: Clock3,
  };
}

/* ------------------------------------------------------------------ *
 * Number formatting. Percentages never carry decimals; quantities are
 * grouped so 1240 reads as 1,240 at arm's length.
 * ------------------------------------------------------------------ */

export const pct = (n: number): string => `${Math.round(n)}%`;
export const qty = (n: number): string => Math.round(n).toLocaleString('en-IN');
export const kg = (n: number): string => `${qty(n)} kg`;
/** Tonnes carry one decimal — a plant talks in "12.4 t", not "12 t". */
export const tonnes = (kgValue: number): string => `${(kgValue / 1000).toFixed(1)} t`;
