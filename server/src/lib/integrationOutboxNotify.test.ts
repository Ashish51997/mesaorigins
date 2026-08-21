import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  scheduleIntegrationOutboxDrain,
  setIntegrationOutboxDrainHandler,
} from './integrationOutboxNotify';

describe('integrationOutboxNotify', () => {
  afterEach(() => {
    setIntegrationOutboxDrainHandler(null);
  });

  it('coalesces multiple schedule calls into one drain microtask', async () => {
    const drain = vi.fn();
    setIntegrationOutboxDrainHandler(drain);
    scheduleIntegrationOutboxDrain();
    scheduleIntegrationOutboxDrain();
    scheduleIntegrationOutboxDrain();
    await Promise.resolve();
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no handler is registered', async () => {
    setIntegrationOutboxDrainHandler(null);
    expect(() => scheduleIntegrationOutboxDrain()).not.toThrow();
    await Promise.resolve();
  });
});
