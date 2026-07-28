/**
 * LineStatusCard.tsx — what a line is doing right now, readable from a metre away.
 *
 * Three states only (running / needs attention / stopped), each as colour + word
 * + icon. Everything else on the card is a physical quantity an operator would
 * recognise from the paper register: the order on the machine, who is running
 * it, kg wound against the target, the latest melt temperature against its
 * range, and when the reading last refreshed.
 */

import type { ReactElement } from 'react';
import { Gauge, User2, ClipboardList, Thermometer } from 'lucide-react';
import { LINE_STATUS, type LineState } from './statusLanguage';
import { StatusChip, FreshnessBadge, toneSolid, toneInk } from './primitives';
import { qty } from './statusLanguage';

export interface LineStatusView {
  machineId: string;
  /** "LDPE / co-extrusion coil" */
  line: string;
  state: LineState;
  /** Why it needs attention or stopped — always shown when present. */
  reason?: string | undefined;
  operator: string;
  /** "SO-1042 · LD coil 40µ clear", or a sentence when nothing is loaded. */
  orderLabel: string;
  producedKg: number;
  targetKg: number;
  meltTemp: number;
  meltMin: number;
  meltMax: number;
  updatedAt: number;
  onOpen: () => void;
}

export function LineStatusCard({ view }: { view: LineStatusView }): ReactElement {
  const status = LINE_STATUS[view.state];
  const pctDone = view.targetKg > 0
    ? Math.min(100, Math.round((view.producedKg / view.targetKg) * 100))
    : 0;

  // The temperature reads against its own range, so "out of range" is visible
  // without knowing the setpoint by heart.
  const tempOut = view.meltTemp > view.meltMax || view.meltTemp < view.meltMin;
  const tempTone = tempOut ? (view.state === 'stopped' ? 'red' : 'amber') : 'green';

  return (
    <button
      type="button"
      onClick={view.onOpen}
      className="w-full text-left bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-blue-500 hover:shadow-[var(--shadow-custom)] focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition"
    >
      {/* Status band — the base tone as a fill, with the word on it in plant ink.
          Never white: white is 2.17–3.90:1 on these mid-weight tones. */}
      <div className={`flex items-center justify-between gap-3 px-4 py-2.5 ${toneSolid(status.tone)}`}>
        <span className="inline-flex items-center gap-2 font-display text-[18px] font-bold">
          <status.icon className="w-5 h-5 shrink-0" aria-hidden="true" />
          Machine {view.machineId.replace(/^M/, '')} — {status.word}
        </span>
        <span className="font-mono text-[14px] font-semibold opacity-95">{view.machineId}</span>
      </div>

      <div className="p-4 space-y-3">
        {/* A stoppage or an attention state must say why, in words. */}
        {view.reason && (
          <p className={`text-[15px] font-semibold ${toneInk(status.tone)}`}>{view.reason}</p>
        )}

        <p className="text-[13px] font-medium text-slate-600">{view.line}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <span className="flex items-start gap-2 text-[15px] text-slate-900">
            <ClipboardList className="w-4 h-4 mt-0.5 shrink-0 text-slate-600" aria-hidden="true" />
            <span className="font-mono">{view.orderLabel}</span>
          </span>
          <span className="flex items-start gap-2 text-[15px] text-slate-900">
            <User2 className="w-4 h-4 mt-0.5 shrink-0 text-slate-600" aria-hidden="true" />
            {view.operator}
          </span>
        </div>

        {/* Progress in real numbers — never a bare percentage. */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-slate-600">
              <Gauge className="w-3.5 h-3.5" aria-hidden="true" /> Wound this shift
            </span>
            <span className="font-display text-[24px] leading-none font-bold data-value tabular-nums">
              {qty(view.producedKg)} / {qty(view.targetKg)} kg
            </span>
          </div>
          <div className="mt-2 h-4 w-full rounded-full bg-slate-100 overflow-hidden border border-slate-200">
            <div
              className={`h-full ${toneSolid(status.tone)} transition-[width] duration-500`}
              style={{ width: `${pctDone}%` }}
              role="progressbar"
              aria-valuenow={pctDone}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${qty(view.producedKg)} of ${qty(view.targetKg)} kilograms wound`}
            />
          </div>
        </div>

        {/* Melt temperature against its range. */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-slate-600">
            <Thermometer className="w-3.5 h-3.5" aria-hidden="true" /> Melt temperature
          </span>
          <span className="flex items-baseline gap-2">
            <span className={`font-display text-[24px] leading-none font-bold tabular-nums ${toneInk(tempTone)}`}>
              {Math.round(view.meltTemp)} °C
            </span>
            <span className="font-mono text-[13px] text-slate-600">
              limit {view.meltMin}–{view.meltMax} °C
            </span>
          </span>
        </div>

        {tempOut && (
          <StatusChip
            status={LINE_STATUS.attention}
            reason={`${Math.round(view.meltTemp)} °C is outside the ${view.meltMin}–${view.meltMax} °C range`}
            size="sm"
          />
        )}

        <div className="pt-1">
          <FreshnessBadge updatedAt={view.updatedAt} />
        </div>
      </div>
    </button>
  );
}
