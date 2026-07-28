/**
 * primitives.tsx — the dashboard's shared vocabulary of controls.
 *
 * Every dashboard screen composes these; no screen re-implements them inline.
 * The rules they enforce so callers cannot break them:
 *   • StatusChip renders colour + word + icon, always all three.
 *   • KpiCard requires onOpen — there is no way to render a dead card.
 *   • Disabled controls state the reason they are disabled.
 *   • Touch targets are >= 48 px; the primary action is >= 56 px.
 *   • Body text is >= 16 px and key figures >= 24 px.
 *
 * Optional props are declared `?: T | undefined` on purpose: under
 * exactOptionalPropertyTypes that lets callers pass a possibly-undefined value
 * without a conditional spread at every call site.
 */

import type { ReactElement, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ChevronRight, Lock, RefreshCw, WifiOff, Inbox, type LucideIcon } from 'lucide-react';
import type { StatusView, Tone } from './statusLanguage';
import type { DashboardAlert, DashboardTask, KpiSpec } from './model';
import { formatAgo } from '../../lib/simulation';

/* ---------------------------------------------------------------- tones */

/**
 * The three roles each tone plays, from the locked palette in index.css.
 * They are not interchangeable — see the contrast table there.
 */

/** Chip / tinted card: soft ground + text token + base outline. */
const TONE_CLASS: Record<Tone, string> = {
  green: 'tone-green',
  amber: 'tone-amber',
  red: 'tone-red',
};

/** Text token only, for a figure sitting on a white card. Never the base. */
const TONE_INK: Record<Tone, string> = {
  green: 'tone-green-ink',
  amber: 'tone-amber-ink',
  red: 'tone-red-ink',
};

/** Base as a fill — bars, dots, swatches, status bands. Text on it is plant ink. */
const TONE_SOLID: Record<Tone, string> = {
  green: 'tone-green-solid',
  amber: 'tone-amber-solid',
  red: 'tone-red-solid',
};

export const toneClass = (t: Tone): string => TONE_CLASS[t];
export const toneInk = (t: Tone): string => TONE_INK[t];
export const toneSolid = (t: Tone): string => TONE_SOLID[t];

/* ------------------------------------------------------------ StatusChip */

/**
 * The only way a status is allowed to appear. Colour never travels alone: the
 * word and the icon come with it, so the chip still reads for a colour-blind
 * operator or on a sun-washed tablet screen.
 *
 * `reason` is shown inline — a hold or a stoppage must say why, never just red.
 */
export function StatusChip({ status, reason, size = 'md' }: {
  status: StatusView;
  reason?: string | undefined;
  size?: 'sm' | 'md' | undefined;
}): ReactElement {
  const Icon = status.icon;
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[13px]' : 'px-3 py-1.5 text-[15px]';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border font-semibold ${pad} ${toneClass(status.tone)}`}>
      <Icon className={size === 'sm' ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'} aria-hidden="true" />
      <span>{status.word}</span>
      {reason && <span className="font-normal opacity-90">— {reason}</span>}
    </span>
  );
}

/* --------------------------------------------------------- FreshnessBadge */

/**
 * "updated 2 min ago", turning amber past five minutes so nobody acts on a
 * stale number believing it is live. Ticks itself once a second.
 */
export function FreshnessBadge({ updatedAt, className = '' }: {
  updatedAt: number;
  className?: string | undefined;
}): ReactElement {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const { label, stale } = formatAgo(updatedAt);
  const Icon = stale ? WifiOff : RefreshCw;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${className} ${stale ? 'tone-amber rounded-lg border px-2 py-1' : 'text-slate-600'}`}
      title={stale ? 'This figure has not refreshed in over five minutes.' : undefined}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      {stale ? `Stale — ${label}` : label}
    </span>
  );
}

/* --------------------------------------------------------------- KpiCard */

/**
 * A figure that is always a door. `spec.onOpen` is mandatory, so a KPI can
 * never be a dead end; the builder drops cards whose target the role cannot
 * open rather than rendering them inert.
 */
export function KpiCard({ spec }: { spec: KpiSpec }): ReactElement {
  const Icon = spec.icon;
  const blocked = Boolean(spec.disabledReason);
  return (
    <button
      type="button"
      onClick={spec.onOpen}
      disabled={blocked}
      title={spec.disabledReason ?? `Open ${spec.label}`}
      className={`group text-left w-full min-h-[96px] bg-white border rounded-xl p-4 transition
        ${blocked
          ? 'border-slate-200 cursor-not-allowed opacity-95'
          : 'border-slate-200 hover:border-blue-500 hover:shadow-[var(--shadow-custom)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2'}`}
    >
      <span className={`inline-flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide ${toneInk(spec.tone)}`}>
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        {spec.label}
      </span>

      {/* Key figure: 30 px, ink on white (~19:1). */}
      <span className="mt-1.5 block font-display text-[30px] leading-none font-bold data-value">
        {spec.value}
      </span>

      {spec.sub && <span className="mt-1.5 block text-[14px] text-slate-600">{spec.sub}</span>}

      {blocked ? (
        <span className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-slate-600">
          <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {spec.disabledReason}
        </span>
      ) : (
        <span className="mt-2 flex items-center gap-1 text-[13px] font-semibold text-blue-700 opacity-0 group-hover:opacity-100 transition-opacity">
          Open <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------- AlertCard */

/**
 * One alert, in the mandated order: what happened → where → what to do.
 * The three parts are separate fields on the model, so this component decides
 * the order and no caller can collapse it into a bare "Temp high".
 *
 * Critical alerts carry a tap-to-acknowledge that records name + time.
 */
export function AlertCard({ alert, acknowledgedBy, acknowledgedAt, onAcknowledge }: {
  alert: DashboardAlert;
  acknowledgedBy?: string | undefined;
  acknowledgedAt?: number | undefined;
  onAcknowledge: (id: string) => void;
}): ReactElement {
  const acked = Boolean(acknowledgedBy);
  const time = acknowledgedAt
    ? new Date(acknowledgedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className={`rounded-xl border p-4 ${toneClass(alert.tone)}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* what happened → where */}
          <p className="text-[16px] font-semibold leading-snug">
            {alert.what} <span className="font-normal">({alert.where})</span>
          </p>
          {/* what to do */}
          <p className="mt-1 text-[15px] leading-snug opacity-95">{alert.todo}</p>

          {acked && (
            <p className="mt-2 text-[13px] font-semibold">
              Acknowledged by {acknowledgedBy} at {time}
            </p>
          )}
        </div>

        {alert.onOpen && (
          <button
            type="button"
            onClick={alert.onOpen}
            className="shrink-0 min-h-[48px] min-w-[48px] px-3 rounded-lg bg-white/70 border border-current/20 text-[14px] font-bold hover:bg-white focus:outline-none focus:ring-2 focus:ring-current"
          >
            Open
          </button>
        )}
      </div>

      {alert.critical && !acked && (
        <button
          type="button"
          onClick={() => onAcknowledge(alert.id)}
          className="mt-3 w-full min-h-[48px] rounded-lg bg-white border-2 border-current text-[15px] font-bold hover:bg-white/80 focus:outline-none focus:ring-2 focus:ring-current"
        >
          Tap to acknowledge
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------- TaskQueueItem */

/**
 * One line of work, verb-phrased, one tap from the screen that resolves it.
 * The whole row is the target and it is >= 56 px tall — this is used with
 * gloved hands on a tablet at arm's length.
 */
export function TaskQueueItem({ task }: { task: DashboardTask }): ReactElement {
  const Icon = task.icon;
  const blocked = Boolean(task.disabledReason);
  return (
    <button
      type="button"
      onClick={task.onOpen}
      disabled={blocked}
      title={task.disabledReason ?? task.label}
      className={`w-full flex items-center gap-3 min-h-[56px] px-3 py-2.5 rounded-xl border bg-white text-left transition
        ${blocked
          ? 'border-slate-200 cursor-not-allowed'
          : 'border-slate-200 hover:border-blue-500 hover:bg-blue-50/40 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-600'}`}
    >
      <span className={`inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-lg border ${toneClass(task.tone)}`}>
        <Icon className="w-5 h-5" aria-hidden="true" />
      </span>

      {typeof task.count === 'number' && (
        <span className="font-display text-[26px] leading-none font-bold data-value tabular-nums w-10 text-right shrink-0">
          {task.count}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium text-slate-900 leading-snug">{task.label}</span>
        {blocked && (
          <span className="mt-0.5 flex items-center gap-1 text-[13px] text-slate-600">
            <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
            {task.disabledReason}
          </span>
        )}
      </span>

      {!blocked && <ChevronRight className="w-5 h-5 shrink-0 text-slate-600" aria-hidden="true" />}
    </button>
  );
}

/* ----------------------------------------------------------- SkeletonCard */

/**
 * Placeholder shaped like the thing it stands in for — never a spinner on a
 * blank page, so the layout does not jump when the data lands.
 */
export function SkeletonCard({ lines = 2, className = '' }: {
  lines?: number | undefined;
  className?: string | undefined;
}): ReactElement {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-4 min-h-[96px] ${className}`} aria-hidden="true">
      <div className="skeleton-block h-3.5 w-24" />
      <div className="skeleton-block h-7 w-20 mt-2.5" />
      {Array.from({ length: Math.max(0, lines - 1) }, (_, i) => (
        <div key={i} className="skeleton-block h-3 w-32 mt-2" />
      ))}
    </div>
  );
}

/** A row-shaped skeleton for queues and tables. */
export function SkeletonRow(): ReactElement {
  return (
    <div className="flex items-center gap-3 min-h-[56px] px-3 rounded-xl border border-slate-200 bg-white" aria-hidden="true">
      <div className="skeleton-block w-10 h-10 shrink-0" />
      <div className="skeleton-block h-4 flex-1" />
    </div>
  );
}

/** The loading form of a whole role home — mirrors RoleHome's real layout. */
export function SkeletonHome(): ReactElement {
  return (
    <div className="space-y-5" role="status" aria-label="Loading your work for this shift">
      <span className="sr-only">Loading your work for this shift…</span>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
      <div className="space-y-2">{[0, 1, 2].map((i) => <SkeletonRow key={i} />)}</div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ EmptyState */

/**
 * An empty list has to teach: what this list is, what makes rows appear here,
 * and — only if the role may create one — the way to make the first.
 */
export function DashboardEmptyState({ icon, title, whatFillsThis, action }: {
  icon?: ReactNode | undefined;
  title: string;
  whatFillsThis: string;
  action?: { label: string; onClick: () => void } | undefined;
}): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 bg-white border border-slate-200 rounded-xl">
      <div className="mb-3 text-slate-600">{icon ?? <Inbox className="w-8 h-8" aria-hidden="true" />}</div>
      <p className="text-[17px] font-semibold text-slate-900">{title}</p>
      <p className="mt-1.5 text-[15px] text-slate-600 max-w-md leading-relaxed">{whatFillsThis}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 px-5 min-h-[48px] rounded-lg bg-blue-600 text-white text-[15px] font-bold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------- SectionHeading */

/** Small caps section label used to separate the bands of a role home. */
export function SectionHeading({ icon, children, right }: {
  icon?: LucideIcon | undefined;
  children: ReactNode;
  right?: ReactNode | undefined;
}): ReactElement {
  const Icon = icon;
  return (
    <div className="flex items-center justify-between gap-3 mb-2">
      <h3 className="flex items-center gap-2 font-display text-[17px] font-bold text-slate-900">
        {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-600" aria-hidden="true" />}
        {children}
      </h3>
      {right}
    </div>
  );
}
