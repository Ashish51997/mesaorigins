/**
 * model.ts — the shapes a role home is built from.
 *
 * Layer 1 is one template ("Today") filled with different content per role, so
 * the content has to be data, not JSX. Every role builder returns a
 * RoleHomeContent; RoleHome renders it. That is what keeps seven homes from
 * drifting into seven layouts.
 */

import type { LucideIcon } from 'lucide-react';
import type { StatusView, Tone } from './statusLanguage';

/**
 * An alert always reads what happened → where → what to do. The three fields
 * are separate so the template can enforce that order and no caller can write
 * a bare "Temp high" alert.
 */
export interface DashboardAlert {
  id: string;
  /** What happened: "Melt temperature is 248 °C, above the 240 °C limit." */
  what: string;
  /** Where: "Line 2". */
  where: string;
  /** What to do: "Inform the shift supervisor." */
  todo: string;
  tone: Tone;
  /** Critical alerts must be acknowledged; the acknowledgement records name + time. */
  critical: boolean;
  /** Optional deep link to the screen that resolves the alert. */
  onOpen?: () => void;
}

/** An acknowledgement, kept per session so the strip can show who signed it off. */
export interface AlertAck {
  alertId: string;
  by: string;
  at: number;
}

/**
 * A queue item is a verb-phrased sentence one tap from the screen that resolves
 * it. `onOpen` is required — a task nobody can act on is not a task.
 */
export interface DashboardTask {
  id: string;
  /** "3 rolls waiting for QA check" */
  label: string;
  /** Optional count rendered large on the left. */
  count?: number;
  icon: LucideIcon;
  tone: Tone;
  onOpen: () => void;
  /** Shown when the row is not actionable, so the control is never dead. */
  disabledReason?: string;
}

/**
 * A KPI card. `onOpen` is mandatory: every card is a deep link into its module
 * with the matching filter applied. Cards whose target the role cannot open are
 * dropped by the builder before they reach the template.
 */
export interface KpiSpec {
  id: string;
  label: string;
  /** The figure itself — already formatted (no decimals on percentages). */
  value: string;
  /** Small line under the value: "4 of them older than 3 days". */
  sub?: string;
  icon: LucideIcon;
  tone: Tone;
  onOpen: () => void;
  /** Screen this card opens; used to drop cards the role cannot see. */
  target: string;
  disabledReason?: string;
}

/** One "Shift so far" figure — physical quantities only, never an index. */
export interface ShiftFigure {
  label: string;
  value: string;
}

/** The single primary action for the role. ≥56 px tall, verb-labelled. */
export interface PrimaryAction {
  label: string;
  icon: LucideIcon;
  onOpen: () => void;
  disabledReason?: string;
}

/** Everything Layer 1 needs for one role. */
export interface RoleHomeContent {
  /** "Your shift on Machine 8" — names the work, not the module. */
  title: string;
  subtitle: string;
  alerts: DashboardAlert[];
  tasks: DashboardTask[];
  kpis: KpiSpec[];
  primary?: PrimaryAction;
  shiftFigures: ShiftFigure[];
  /** Machines this role is responsible for; empty for office roles. */
  lineIds: string[];
  /** Shown when the role has no work at all — teaches what fills the queue. */
  emptyHint: string;
}

/** A status paired with the reason text a hold or stop must always show. */
export interface StatusWithReason {
  status: StatusView;
  reason?: string;
}
