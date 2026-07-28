/**
 * BatchPassport.tsx — what the Trace box opens.
 *
 * One identifier, the whole life of the material: supplier lot → incoming
 * inspection → store issue → formulation → production shift → QA → pallet →
 * dispatch, and the complaint if there was one. This is the screen that
 * replaces walking to the records room with a lot number on a slip of paper.
 *
 * Any identifier resolves: a lot number (190726·D·M08·B01), a roll, a pallet,
 * an invoice, a complaint number, an SO or an inquiry. Lineages carry an
 * `aliases` list precisely so a person can search with whatever is in front of
 * them rather than the one canonical id.
 */

import type { ReactElement } from 'react';
import {
  Truck, ClipboardCheck, Boxes, Beaker, Factory, PackageCheck, ShieldAlert,
  ArrowDownToLine, Recycle, Search, type LucideIcon,
} from 'lucide-react';
import ResponsiveOverlay from '../ui/ResponsiveOverlay';
import type { BatchLineage, LineageStage, LineageStep } from '../../types';
import { StatusChip, DashboardEmptyState, toneClass } from './primitives';
import type { Tone } from './statusLanguage';

const STAGE_ICON: Record<LineageStage, LucideIcon> = {
  supplier: Truck,
  incoming: ArrowDownToLine,
  store_issue: Boxes,
  formulation: Beaker,
  production: Factory,
  qa: ClipboardCheck,
  regrind: Recycle,
  pallet: PackageCheck,
  dispatch: Truck,
  complaint: ShieldAlert,
};

/** A lineage step's verdict, in the same three tones as everything else. */
function stepStatus(step: LineageStep): { tone: Tone; word: string } | null {
  switch (step.status) {
    case 'pass': return { tone: 'green', word: 'Passed' };
    case 'fail': return { tone: 'red', word: 'Failed' };
    case 'hold': return { tone: 'red', word: 'On hold' };
    default: return null;
  }
}

/**
 * Find the lineage an identifier belongs to. Matches the canonical lot, any
 * alias, or a sibling lot, case-insensitively.
 */
export function findLineage(lineages: BatchLineage[], query: string): BatchLineage | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return lineages.find((l) =>
    l.lot.toLowerCase() === q
    || l.id.toLowerCase() === q
    || l.aliases.some((a) => a.toLowerCase() === q)
    || l.siblings.some((s) => s.toLowerCase() === q))
    ?? lineages.find((l) =>
      l.lot.toLowerCase().includes(q)
      || l.headline.toLowerCase().includes(q)
      || l.aliases.some((a) => a.toLowerCase().includes(q)));
}

export function BatchPassport({ query, lineages, onClose }: {
  query: string | null;
  lineages: BatchLineage[];
  onClose: () => void;
}): ReactElement {
  const lineage = query ? findLineage(lineages, query) : undefined;

  return (
    <ResponsiveOverlay
      open={query !== null}
      onClose={onClose}
      variant="drawer-right"
      wide
      title={
        <span className="font-display text-[19px] font-bold text-slate-900">
          Batch passport
        </span>
      }
    >
      {!lineage ? (
        <DashboardEmptyState
          icon={<Search className="w-8 h-8" aria-hidden="true" />}
          title={`Nothing found for "${query ?? ''}"`}
          whatFillsThis="Search with a lot number (190726·D·M08·B01), a roll number, a pallet, an invoice, a complaint number, or an order number. Every roll registered against a shift log book becomes traceable here."
        />
      ) : (
        <div className="space-y-4">
          {/* Identity */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="font-mono text-[17px] font-bold text-slate-900 break-all">{lineage.lot}</p>
            <p className="mt-1 text-[15px] text-slate-600">{lineage.headline}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-900">
                Machine {lineage.machineId}
              </span>
              {lineage.outcome === 'complaint' ? (
                <StatusChip status={{ tone: 'red', word: 'Ended in a complaint', icon: ShieldAlert }} size="sm" />
              ) : (
                <StatusChip status={{ tone: 'green', word: 'Clean run', icon: PackageCheck }} size="sm" />
              )}
            </div>

            {lineage.parentLot && (
              <p className="mt-2.5 text-[14px] text-slate-600">
                Regrind of parent lot <span className="font-mono text-slate-900">{lineage.parentLot}</span>
              </p>
            )}

            {lineage.siblings.length > 0 && (
              <p className="mt-1.5 text-[14px] text-slate-600">
                Sibling lots from the same run:{' '}
                <span className="font-mono text-slate-900">{lineage.siblings.join(', ')}</span>
              </p>
            )}
          </div>

          {/* The chain, in order */}
          <ol className="space-y-2.5">
            {lineage.steps.map((step, i) => {
              const Icon = STAGE_ICON[step.stage];
              const verdict = stepStatus(step);
              return (
                <li key={`${step.stage}-${i}`} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <span className={`inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-lg border ${toneClass(verdict?.tone ?? 'green')}`}>
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-semibold text-slate-900 leading-snug">{step.title}</p>
                      <p className="text-[14px] text-slate-600 mt-0.5">
                        {step.when}{step.by ? ` · ${step.by}` : ''}
                        {step.docFormat ? ` · ${step.docFormat}` : ''}
                      </p>

                      {verdict && (
                        <div className="mt-2">
                          <StatusChip status={{ tone: verdict.tone, word: verdict.word, icon: Icon }} size="sm" />
                        </div>
                      )}

                      {/* An amber flag is a warning that must be read, not decoration. */}
                      {step.flag && (
                        <p className={`mt-2 rounded-lg border px-2.5 py-1.5 text-[14px] font-medium ${toneClass('amber')}`}>
                          {step.flag}
                        </p>
                      )}

                      {step.fields.length > 0 && (
                        <dl className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                          {step.fields.map((f) => (
                            <div key={f.label} className="flex items-baseline justify-between gap-2">
                              <dt className="text-[13px] text-slate-600 shrink-0">{f.label}</dt>
                              <dd className={`text-[14px] font-medium text-slate-900 text-right ${f.mono ? 'font-mono' : ''}`}>
                                {f.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </ResponsiveOverlay>
  );
}
