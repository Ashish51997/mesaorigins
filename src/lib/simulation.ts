/**
 * simulation.ts — the in-memory "makes the dummy feel alive" engine.
 *
 * A module-level store of live machine state + an interval ticker that drifts
 * temperatures, completes rolls, and (throttled) fires nudges. The Demo Control
 * Panel drives speed (pause / 1x / 5x), forces specific events for live client
 * demos, and toggles offline. Everything is client-side; the nudge bar and any
 * live widget subscribe via useLiveMachines() / useOnline().
 */

import { useSyncExternalStore } from 'react';
import { initialMachines } from '../mockData';
import { pushNudge, pushToast } from '../components/Notify';
import { seedDemoQueue, flushQueue } from './offline';

export interface LiveMachine {
  id: string;
  status: 'running' | 'attention' | 'stopped';
  zoneTemp: number;      // representative live zone temperature (°C)
  limit: number;         // upper limit for that zone
  reason?: string;       // words for attention/stopped
  rollsDone: number;
  updatedAt: number;
}

let online = true;
let speed = 1; // 0 paused · 1 · 5
let rollSeq = 2200;

let machines: LiveMachine[] = initialMachines.map((m) => ({
  id: m.id,
  status: m.status,
  zoneTemp: m.family === 'PVC' ? 172 : 164,
  limit: m.family === 'PVC' ? 180 : 175,
  reason: m.statusReason,
  rollsDone: 0,
  updatedAt: Date.now()
}));

const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
const subscribe = (cb: () => void): (() => void) => { subs.add(cb); return () => { subs.delete(cb); }; };

const snapMachines = () => machines;
const snapOnline = () => online;
const snapSpeed = () => speed;

export function useLiveMachines(): LiveMachine[] { return useSyncExternalStore(subscribe, snapMachines, snapMachines); }
export function useOnline(): boolean { return useSyncExternalStore(subscribe, snapOnline, snapOnline); }
export function useSimSpeed(): number { return useSyncExternalStore(subscribe, snapSpeed, snapSpeed); }
export const isOnline = () => online;

function patch(id: string, next: Partial<LiveMachine>): void {
  machines = machines.map((m) => (m.id === id ? { ...m, ...next, updatedAt: Date.now() } : m));
}

/* ---------------------------------------------------------------- ticker */

let timer: ReturnType<typeof setInterval> | null = null;
let ticks = 0;
let lastAmbientNudge = 0;

function pick<T>(arr: T[]): T | undefined { return arr[Math.floor(Math.random() * arr.length)]; }

function tick(): void {
  if (speed === 0 || !online) return;
  ticks += 1;

  // Temperature drift on the running machines every tick.
  const running = machines.filter((m) => m.status === 'running');
  const m = pick(running);
  if (m) {
    const drift = (Math.random() * 4 - 2);
    const t = Math.round((m.zoneTemp + drift) * 10) / 10;
    const crossed = t > m.limit;
    patch(m.id, { zoneTemp: t, status: crossed ? 'attention' : 'running', reason: crossed ? `Zone temp ${t} °C — above the ${m.limit} °C limit` : undefined });
    if (crossed && Date.now() - lastAmbientNudge > 9000) {
      lastAmbientNudge = Date.now();
      pushNudge('attention', `Zone 3 on Machine ${m.id.slice(1)} is ${t} °C — near the limit.`);
    }
  }

  // A roll completes now and then (more often at 5x).
  if (ticks % Math.max(2, Math.round(6 / speed)) === 0) {
    const r = pick(machines.filter((x) => x.status !== 'stopped'));
    if (r) {
      patch(r.id, { rollsDone: r.rollsDone + 1 });
      if (Date.now() - lastAmbientNudge > 9000) {
        lastAmbientNudge = Date.now();
        rollSeq += 1;
        pushNudge('good', `Roll ${rollSeq} passed QA — added to finished stock.`);
      }
    }
  }

  emit();
}

export function startSimulation(): void {
  if (timer) return;
  timer = setInterval(tick, 1600);
}
export function stopSimulation(): void { if (timer) { clearInterval(timer); timer = null; } }

/* ---------------------------------------------------------------- controls */

export function setSpeed(s: number): void { speed = s; emit(); }

// Bring a machine back to running (Maintenance Head closing a breakdown).
export function setMachineRunning(id: string): void {
  patch(id, { status: 'running', reason: undefined });
  emit();
}

export function setOnline(v: boolean): void {
  if (online === v) return;
  online = v;
  emit();
  if (v) {
    flushQueue();
  } else {
    seedDemoQueue();
    pushToast('No network — entries are saved on this tablet and will send automatically.');
  }
}

/* Force events — for live client demos (deterministic). */
export function forceTempAlert(): void {
  const m = pick(machines.filter((x) => x.status !== 'stopped')) ?? machines[0];
  if (!m) return;
  const t = m.limit + 4;
  patch(m.id, { status: 'attention', zoneTemp: t, reason: `Zone temp ${t} °C — above the ${m.limit} °C limit` });
  emit();
  pushNudge('attention', `Zone 3 on Machine ${m.id.slice(1)} is ${t} °C — near the limit.`);
}

export function forceFailRoll(): void {
  rollSeq += 1;
  pushNudge('attention', `Roll ${rollSeq} failed on thickness. Sent to the regrind queue.`);
  pushToast(`Roll ${rollSeq} failed on thickness. Sent to regrind queue.`);
}

export function forceTruckArrives(): void {
  pushNudge('good', 'Truck KA-01-AB-4412 has arrived at the gate for loading.');
}

export function forceComplaint(): void {
  pushNudge('attention', 'New complaint C-105 from Apex Plastic — answer within 3 days.');
}

export function forceMachineStop(): void {
  const m = pick(machines.filter((x) => x.status !== 'stopped')) ?? machines[0];
  if (!m) return;
  patch(m.id, { status: 'stopped', reason: 'Power failure — maintenance notified' });
  emit();
  pushNudge('critical', `Machine ${m.id.slice(1)} stopped — power failure. Maintenance notified.`);
}

/* ---------------------------------------------------------------- freshness */

export function formatAgo(updatedAt: number): { label: string; stale: boolean } {
  const secs = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
  if (!online) return { label: 'showing saved data', stale: true };
  if (secs > 300) return { label: 'not updated in a while', stale: true };
  if (secs < 3) return { label: 'updated just now', stale: false };
  if (secs < 60) return { label: `updated ${secs}s ago`, stale: false };
  return { label: `updated ${Math.floor(secs / 60)}m ago`, stale: false };
}
