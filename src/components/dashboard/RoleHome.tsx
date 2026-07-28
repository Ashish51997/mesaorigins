/**
 * RoleHome.tsx — Layer 1, "Today". The one template every role lands on.
 *
 * All seven role homes render through this component; only the content differs.
 * That is deliberate: an operator who is promoted to shift supervisor should
 * not have to learn a new screen, and a manager walking the floor should be
 * able to read an operator's tablet without translation.
 *
 * Band order is fixed and leads with work, not metrics:
 *   alerts (max 3) → task queue → primary action → shift so far → my lines → figures
 */

import type { ReactElement } from 'react';
import { useState } from 'react';
import { AlertTriangle, ListChecks, Activity, BarChart3, CheckCircle2, ChevronDown } from 'lucide-react';
import type { RoleHomeContent } from './model';
import type { LineStatusView } from './LineStatusCard';
import { LineStatusCard } from './LineStatusCard';
import {
  AlertCard, TaskQueueItem, KpiCard, SectionHeading, DashboardEmptyState, SkeletonHome,
} from './primitives';
import { useAcks, acknowledgeAlert } from './ackStore';

/** Only three alerts are ever visible; the rest sit behind "more". */
const VISIBLE_ALERTS = 3;

export function RoleHome({ content, lines, currentUser, loading = false }: {
  content: RoleHomeContent;
  lines: LineStatusView[];
  /** Name recorded against a critical-alert acknowledgement. */
  currentUser: string;
  loading?: boolean | undefined;
}): ReactElement {
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const acks = useAcks();

  if (loading) return <SkeletonHome />;

  const visibleAlerts = showAllAlerts ? content.alerts : content.alerts.slice(0, VISIBLE_ALERTS);
  const hiddenCount = Math.max(0, content.alerts.length - VISIBLE_ALERTS);

  const nothingToDo =
    content.alerts.length === 0 && content.tasks.length === 0 && lines.length === 0;

  const Primary = content.primary;

  return (
    <div className="space-y-6 pb-24 lg:pb-6">
      {/* ---------------------------------------------------------- title */}
      <div>
        <h2 className="font-display text-[24px] leading-tight font-bold text-slate-900">{content.title}</h2>
        <p className="text-[15px] text-slate-600 mt-0.5">{content.subtitle}</p>
      </div>

      {/* ---------------------------------------------------- alert band */}
      {content.alerts.length > 0 && (
        <section aria-label="Alerts">
          <SectionHeading icon={AlertTriangle}>
            Needs your attention
          </SectionHeading>
          <div className="space-y-2.5">
            {visibleAlerts.map((a) => {
              const ack = acks[a.id];
              return (
                <AlertCard
                  key={a.id}
                  alert={a}
                  acknowledgedBy={ack?.by}
                  acknowledgedAt={ack?.at}
                  onAcknowledge={(id) => acknowledgeAlert(id, currentUser)}
                />
              );
            })}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllAlerts((v) => !v)}
              className="mt-2.5 w-full min-h-[48px] rounded-xl border border-slate-200 bg-white text-[15px] font-semibold text-slate-900 hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {showAllAlerts
                ? 'Show fewer alerts'
                : `${hiddenCount} more ${hiddenCount === 1 ? 'alert' : 'alerts'}`}
              <ChevronDown className={`inline-block w-4 h-4 ml-1.5 transition-transform ${showAllAlerts ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          )}
        </section>
      )}

      {/* ---------------------------------------------------- task queue */}
      {content.tasks.length > 0 && (
        <section aria-label="Your work">
          <SectionHeading icon={ListChecks}>Your work now</SectionHeading>
          <div className="space-y-2">
            {content.tasks.map((t) => <TaskQueueItem key={t.id} task={t} />)}
          </div>
        </section>
      )}

      {/* ------------------------------------------------ primary action */}
      {Primary && (
        <button
          type="button"
          onClick={Primary.onOpen}
          disabled={Boolean(Primary.disabledReason)}
          title={Primary.disabledReason ?? Primary.label}
          className={`w-full min-h-[56px] rounded-xl font-display text-[19px] font-bold flex items-center justify-center gap-2.5 transition
            ${Primary.disabledReason
              ? 'bg-slate-100 text-slate-600 border border-slate-200 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 shadow-[var(--shadow-custom)]'}`}
        >
          <Primary.icon className="w-5 h-5 shrink-0" aria-hidden="true" />
          {Primary.label}
        </button>
      )}
      {Primary?.disabledReason && (
        <p className="-mt-4 text-[14px] text-slate-600 text-center">{Primary.disabledReason}</p>
      )}

      {/* --------------------------------------------------- shift so far */}
      {content.shiftFigures.length > 0 && (
        <section aria-label="Shift so far" className="rounded-xl border border-slate-200 bg-white p-4">
          <SectionHeading icon={Activity}>Shift so far</SectionHeading>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {content.shiftFigures.map((f) => (
              <div key={f.label}>
                <dt className="text-[13px] font-bold uppercase tracking-wide text-slate-600">{f.label}</dt>
                <dd className="font-display text-[26px] leading-none font-bold data-value tabular-nums mt-1">{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* ------------------------------------------------------- my lines */}
      {lines.length > 0 && (
        <section aria-label="Lines">
          <SectionHeading icon={Activity}>
            {lines.length === 1 ? 'Your machine' : 'Your machines'}
          </SectionHeading>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {lines.map((l) => <LineStatusCard key={l.machineId} view={l} />)}
          </div>
        </section>
      )}

      {/* ----------------------------------------------------------- KPIs */}
      {content.kpis.length > 0 && (
        <section aria-label="Figures">
          <SectionHeading icon={BarChart3}>The numbers behind it</SectionHeading>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
            {content.kpis.map((k) => <KpiCard key={k.id} spec={k} />)}
          </div>
        </section>
      )}

      {/* --------------------------------------------------- nothing to do */}
      {nothingToDo && (
        <DashboardEmptyState
          icon={<CheckCircle2 className="w-8 h-8" aria-hidden="true" />}
          title="Nothing waiting for you right now"
          whatFillsThis={content.emptyHint}
        />
      )}
    </div>
  );
}
