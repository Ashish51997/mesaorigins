/**
 * ackStore.ts — who acknowledged which critical alert, and when.
 *
 * A critical alert is not cleared by being seen; someone has to put their name
 * against it. This keeps that record for the session so switching roles or
 * screens does not quietly wipe an acknowledgement. It follows the same
 * module-store + useSyncExternalStore shape as accessStore/i18n.
 *
 * Session-scoped by design: the click-dummy has no acknowledgement endpoint
 * yet, so nothing is posted to the server.
 */

import { useSyncExternalStore } from 'react';
import type { AlertAck } from './model';

let acks: Record<string, AlertAck> = {};
/**
 * Which alerts have been opened. Acknowledging is only offered once an alert
 * has been read, so "acknowledged" means someone looked — not that a full-width
 * bar happened to be under their thumb.
 */
let opened: Record<string, true> = {};

const subs = new Set<() => void>();
const emit = (): void => { subs.forEach((s) => s()); };
const subscribe = (cb: () => void): (() => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
const snap = (): Record<string, AlertAck> => acks;
const snapOpened = (): Record<string, true> => opened;

export function useAcks(): Record<string, AlertAck> {
  return useSyncExternalStore(subscribe, snap, snap);
}

export function useOpenedAlerts(): Record<string, true> {
  return useSyncExternalStore(subscribe, snapOpened, snapOpened);
}

/** Record that the alert's screen was opened, which unlocks acknowledging it. */
export function markAlertOpened(alertId: string): void {
  if (opened[alertId]) return;
  opened = { ...opened, [alertId]: true };
  emit();
}

/** Record an acknowledgement against the person who tapped it. */
export function acknowledgeAlert(alertId: string, by: string): void {
  if (acks[alertId]) return; // first acknowledgement wins
  acks = { ...acks, [alertId]: { alertId, by, at: Date.now() } };
  emit();
}

/** Test seam — clears the session record. */
export function resetAcks(): void {
  acks = {};
  opened = {};
  emit();
}
