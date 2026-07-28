/**
 * navIntent.ts — carries a filter along with a navigation.
 *
 * "Every KPI card is a deep link that opens its module with the matching filter
 * pre-applied": tapping *Open complaints* must land on the complaints list
 * already filtered to open, not on an unfiltered list the user has to narrow
 * again. App.tsx does the actual screen switch; this store carries the filter
 * that should be applied on arrival.
 *
 * The intent is consumed once. A filter seeds the destination's own filter
 * state and is then cleared, so the user stays in control afterwards — going
 * back to the screen later does not silently re-apply an old filter.
 */

import { useEffect, useSyncExternalStore } from 'react';

export interface NavIntent {
  screen: string;
  filter: string;
}

let intent: NavIntent | null = null;

const subs = new Set<() => void>();
const emit = (): void => { subs.forEach((s) => s()); };
const subscribe = (cb: () => void): (() => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
const snap = (): NavIntent | null => intent;

/** Record the filter that the next render of `screen` should apply. */
export function setNavIntent(screen: string, filter: string): void {
  intent = { screen, filter };
  emit();
}

export function clearNavIntent(): void {
  if (intent === null) return;
  intent = null;
  emit();
}

function useIntent(): NavIntent | null {
  return useSyncExternalStore(subscribe, snap, snap);
}

/**
 * The pending filter for this screen, or undefined. Call `clearNavIntent()`
 * from the effect that applies it so it fires exactly once.
 */
export function useNavFilter(screen: string): string | undefined {
  const current = useIntent();
  return current && current.screen === screen ? current.filter : undefined;
}

/**
 * Apply an arriving filter once, then clear it.
 *
 * `apply` receives the raw string and narrows it itself — each screen owns its
 * own filter union, and an unrecognised value is simply ignored rather than
 * forced through a cast.
 *
 *   useApplyNavFilter('inquiries', (f) => { if (f === 'open') setStatusFilter(f); });
 */
export function useApplyNavFilter(screen: string, apply: (filter: string) => void): void {
  const pending = useNavFilter(screen);
  useEffect(() => {
    if (pending === undefined) return;
    apply(pending);
    clearNavIntent();
    // `apply` is re-created every render by callers; the filter value is the
    // real trigger, and clearing it makes this run exactly once per navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
}
