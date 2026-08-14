import { describe, expect, it } from 'vitest';
import { calculateTdsThresholdBasis } from '../tdsService';

describe('MesaERP TDS threshold basis', () => {
  it('taxes only the part of the current basis that first crosses an excess-only aggregate threshold', () => {
    const result = calculateTdsThresholdBasis({
      grossAmount: '400', priorAggregateBase: '600',
      singlePaymentThreshold: '0', aggregateThreshold: '750', thresholdApplication: 'excess_only',
    });

    expect(result).toMatchObject({ aggregateHit: true, singleHit: false });
    expect(result.priorAggregateExcess.toString()).toBe('0');
    expect(result.aggregateExcess.toString()).toBe('250');
    expect(result.taxableBase.toString()).toBe('250');
  });

  it('does not re-tax prior excess on later deductions', () => {
    const result = calculateTdsThresholdBasis({
      grossAmount: '100', priorAggregateBase: '1000',
      singlePaymentThreshold: '0', aggregateThreshold: '750', thresholdApplication: 'excess_only',
    });

    expect(result.priorAggregateExcess.toString()).toBe('250');
    expect(result.aggregateExcess.toString()).toBe('350');
    expect(result.taxableBase.toString()).toBe('100');
  });

  it('preserves full-current and single-payment threshold behavior', () => {
    const aggregate = calculateTdsThresholdBasis({
      grossAmount: '400', priorAggregateBase: '600',
      singlePaymentThreshold: '0', aggregateThreshold: '750', thresholdApplication: 'full_current',
    });
    const single = calculateTdsThresholdBasis({
      grossAmount: '800', priorAggregateBase: '0',
      singlePaymentThreshold: '500', aggregateThreshold: '750', thresholdApplication: 'excess_only',
    });

    expect(aggregate.taxableBase.toString()).toBe('400');
    expect(single).toMatchObject({ singleHit: true, aggregateHit: true });
    expect(single.taxableBase.toString()).toBe('800');
  });
});
