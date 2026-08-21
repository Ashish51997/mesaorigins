/**
 * Schedules a single outbox drain without importing the worker module into
 * hot Prisma paths (avoids circular deps with db.ts).
 *
 * Production must not run a forever poll timer: open Prisma connections would
 * keep Neon awake and cancel scale-to-zero. Callers notify after inserting an
 * IntegrationOutboxEvent; the worker also drains once on process start.
 */

type DrainHandler = () => void;

let drainHandler: DrainHandler | null = null;
let drainScheduled = false;

export function setIntegrationOutboxDrainHandler(handler: DrainHandler | null): void {
  drainHandler = handler;
}

export function scheduleIntegrationOutboxDrain(): void {
  if (!drainHandler || drainScheduled) return;
  drainScheduled = true;
  queueMicrotask(() => {
    drainScheduled = false;
    try {
      drainHandler?.();
    } catch {
      // Drain failures are retried on the next emit or process start.
    }
  });
}
