/**
 * offline.ts — the offline send-queue + practice-mode flag.
 *
 * When the Demo Control Panel goes offline, entry screens keep working; saves
 * land in this visible local queue (header badge "N waiting to send"). On
 * reconnect the queue flushes one-by-one with a green nudge. Practice mode is a
 * separate flag that overlays an amber "nothing is saved" banner everywhere.
 */

import { useSyncExternalStore } from 'react';
import { pushNudge } from '../components/Notify';

export interface QueuedEntry { id: number; label: string; }

let queue: QueuedEntry[] = [];
let qseq = 1;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
const subscribe = (cb: () => void): (() => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
const snap = () => queue;

export function useQueue(): QueuedEntry[] { return useSyncExternalStore(subscribe, snap, snap); }
export function enqueue(label: string): void { queue = [...queue, { id: qseq++, label }]; emit(); }

// Seed a few representative offline saves so the "waiting to send" story is visible.
export function seedDemoQueue(): void {
  if (queue.length > 0) return;
  ['Hourly reading — M08', 'Roll pass — R-2231', 'Coil weights 1–22 — M08'].forEach(enqueue);
}

export function flushQueue(): void {
  if (queue.length === 0) return;
  const count = queue.length;
  const iv = setInterval(() => {
    queue = queue.slice(1);
    emit();
    if (queue.length === 0) {
      clearInterval(iv);
      pushNudge('good', `Back online — ${count} saved ${count === 1 ? 'entry' : 'entries'} sent.`);
    }
  }, 700);
}

/* ---------------------------------------------------------------- practice mode */

let practice = false;
const psubs = new Set<() => void>();
const pemit = () => psubs.forEach((s) => s());
const psub = (cb: () => void): (() => void) => { psubs.add(cb); return () => { psubs.delete(cb); }; };
const psnap = () => practice;

export function usePractice(): boolean { return useSyncExternalStore(psub, psnap, psnap); }
export function setPractice(v: boolean): void { practice = v; pemit(); }
