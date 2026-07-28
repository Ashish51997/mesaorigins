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
 * An alert still reads what happened → where → what to do, but the three parts
 * are carried in shapes a compact row can lay out:
 *
 *   headline — the single most important fact, bold, one line
 *   chips    — the secondary facts (customer, machine, deadline, product code)
 *   todo     — the recommended action, one grey line
 *
 * Splitting them this way is what stops a caller writing the run-on sentence
 * that combined all three facts into an unreadable headline.
 */
export interface DashboardAlert {
  id: string;
  /** One short fact: "Complaint C-104 is 5 days overdue". No trailing clause. */
  headline: string;
  /** Secondary facts, rendered as small chips after the headline. */
  chips: string[];
  /** What to do: "Ask sales for the reply that went to the customer." */
  todo: string;
  tone: Tone;
  /**
   * Critical alerts want an acknowledgement, but it is offered only after the
   * alert has been opened — acknowledging something you have not read is a
   * habit the old full-width bar actively taught.
   */
  critical: boolean;
  /** Deep link to the screen that resolves the alert. */
  onOpen?: () => void;
}

/** An acknowledgement, kept per session so the row can show who signed it off. */
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
  /**
   * The sentence WITHOUT its count — "rolls waiting for QA check", not
   * "3 rolls waiting for QA check". The numeral is rendered once, large, on the
   * left; repeating it in the sentence made every row read twice.
   */
  label: string;
  /** The figure itself. Rendered large and alone. */
  count?: number;
  /**
   * A few of the actual items behind the count, shown inline on the right so
   * the row earns its width: order numbers with customers, complaint ids with
   * days remaining. Two or three is enough to make the count concrete.
   */
  preview?: string[];
  icon: LucideIcon;
  tone: Tone;
  onOpen: () => void;
  /** Shown when the row is not actionable, so the control is never dead. */
  disabledReason?: string;
  /**
   * What to say when the count is zero — "No open CAPAs". A settled queue is
   * good news and gets one quiet green line, not a full-height row competing
   * with the work that still needs doing.
   */
  zeroLabel?: string;
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
