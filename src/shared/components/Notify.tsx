/**
 * Notify.tsx — the reusable Nudge Bar + Consequence Toast system.
 *
 * Event-driven (module-level store, no context) so ANY screen — or the M3
 * simulation engine — can fire a nudge/toast by importing pushNudge/pushToast.
 *
 * Nudge bar (below the header): green (good) & amber (attention) auto-dismiss
 * after 6s; red (critical) stays until acknowledged (name + time recorded). Max
 * 2 shown, the rest queue. Every nudge has a one-sentence message and an
 * optional "View" deep-link. The bell shows the acknowledged/seen history.
 */

import { useSyncExternalStore, type ReactNode, type ReactElement } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, X, ArrowRight } from 'lucide-react';

export type NudgeKind = 'good' | 'attention' | 'critical';

export interface Nudge {
  id: number;
  kind: NudgeKind;
  message: string;
  view?: { label: string; onView: () => void };
  at: number;
  acknowledged?: { by: string; at: number };
}

/* ---------------------------------------------------------------- nudge store */

let seq = 1;
let active: Nudge[] = [];
let queue: Nudge[] = [];
let history: Nudge[] = [];
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

function promote(): void {
  while (active.length < 2 && queue.length > 0) {
    const n = queue.shift();
    if (!n) break;
    active = [...active, n];
    if (n.kind !== 'critical') {
      timers.set(n.id, setTimeout(() => dismissNudge(n.id), 6000));
    }
  }
}

// Nudges (the attention bar / bell notifications) were removed by request.
// pushNudge is intentionally a no-op so the many call sites across the stores keep
// compiling but nothing is shown. Consequence toasts (pushToast) are unaffected.
export function pushNudge(_kind: NudgeKind, _message: string, _view?: Nudge['view']): number {
  return -1;
}

export function dismissNudge(id: number): void {
  const t = timers.get(id);
  if (t) { clearTimeout(t); timers.delete(id); }
  active = active.filter((n) => n.id !== id);
  promote();
  emit();
}

export function acknowledgeNudge(id: number, by: string): void {
  const ack = { by, at: Date.now() };
  history = history.map((n) => (n.id === id ? { ...n, acknowledged: ack } : n));
  dismissNudge(id);
}

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

const getActive = () => active;
const getHistory = () => history;

export function useNudges(): Nudge[] {
  return useSyncExternalStore(subscribe, getActive, getActive);
}
export function useNudgeHistory(): Nudge[] {
  return useSyncExternalStore(subscribe, getHistory, getHistory);
}

/* ---------------------------------------------------------------- nudge bar UI */

const KIND_STYLE: Record<NudgeKind, { bar: string; icon: ReactNode; label: string }> = {
  good: { bar: 'bg-emerald-50 border-emerald-300 text-emerald-800', icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />, label: 'Good news' },
  attention: { bar: 'bg-amber-50 border-amber-300 text-amber-800', icon: <AlertTriangle className="w-4 h-4 text-amber-600" />, label: 'Attention' },
  critical: { bar: 'bg-rose-50 border-rose-400 text-rose-800', icon: <XCircle className="w-4 h-4 text-rose-600" />, label: 'Stopped' }
};

export function NudgeBar({ currentUser }: { currentUser: string }): ReactElement | null {
  const nudges = useNudges();
  if (nudges.length === 0) return null;
  return (
    <div className="px-4 pt-2 space-y-2">
      {nudges.map((n) => {
        const s = KIND_STYLE[n.kind];
        return (
          <div key={n.id} className={`flex items-center gap-3 border rounded-lg px-3 py-2 shadow-sm ${s.bar}`}>
            {s.icon}
            <span className="flex-1 text-[13px] font-medium">{n.message}</span>
            {n.view && (
              <button
                onClick={n.view.onView}
                className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded bg-white/70 border border-current/20 hover:bg-white"
              >
                {n.view.label} <ArrowRight className="w-3 h-3" />
              </button>
            )}
            {n.kind === 'critical' ? (
              <button
                onClick={() => acknowledgeNudge(n.id, currentUser)}
                className="text-[11px] font-bold px-2.5 py-1 rounded bg-rose-600 text-white hover:bg-rose-700"
              >
                Acknowledge
              </button>
            ) : (
              <button onClick={() => dismissNudge(n.id)} className="p-1 rounded hover:bg-white/60" aria-label="Dismiss">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- toast store */

export interface Toast { id: number; message: string; }
let tseq = 1;
let toasts: Toast[] = [];
const tsubs = new Set<() => void>();
const temit = () => tsubs.forEach((s) => s());

export function pushToast(message: string): void {
  const t: Toast = { id: tseq++, message };
  toasts = [...toasts, t];
  temit();
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); temit(); }, 4500);
}

function tsub(cb: () => void): () => void { tsubs.add(cb); return () => { tsubs.delete(cb); }; }
const getToasts = () => toasts;
export function useToasts(): Toast[] { return useSyncExternalStore(tsub, getToasts, getToasts); }

export function ToastHost(): ReactElement {
  const ts = useToasts();
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
      {ts.map((t) => (
        <div key={t.id} className="pointer-events-auto max-w-md bg-slate-900 text-white text-[13px] font-medium px-4 py-2.5 rounded-lg border border-slate-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- bell history */

export function BellPanel({ onClose }: { onClose: () => void }) {
  const hist = useNudgeHistory();
  return (
    <>
      <div className="fixed inset-0 z-[65]" onClick={onClose} />
      <div className="absolute right-0 top-11 z-[66] w-80 max-h-96 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl">
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200">Alerts</div>
        {hist.length === 0 ? (
          <div className="p-4 text-xs text-slate-400">No alerts yet. New alerts appear here as things change on the floor.</div>
        ) : (
          hist.map((n) => (
            <div key={n.id} className="px-3 py-2 border-b border-slate-100 dark:border-slate-800/60 text-[12px]">
              <div className="text-slate-700 dark:text-slate-200">{n.message}</div>
              {n.acknowledged && <div className="text-[10px] text-slate-400 mt-0.5">Acknowledged by {n.acknowledged.by}</div>}
            </div>
          ))
        )}
      </div>
    </>
  );
}
