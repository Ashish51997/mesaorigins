import { describe, expect, it } from 'vitest';
import { safeRequestTarget } from './log';

describe('request log redaction', () => {
  it('removes public questionnaire bearer tokens and every query string', () => {
    const token = 'secret-questionnaire-token-that-must-never-be-logged';
    const target = safeRequestTarget(`/api/public/mesaleads/forms/${token}?utm_source=private`);
    expect(target).toBe('/api/public/mesaleads/forms/[redacted]');
    expect(target).not.toContain(token);
    expect(target).not.toContain('utm_source');
  });

  it('removes customer portal bearer tokens', () => {
    const token = 'secret-customer-portal-token-that-must-never-be-logged';
    const target = safeRequestTarget(`/api/public/mesaleads/portal/${token}?source=email`);
    expect(target).toBe('/api/public/mesaleads/portal/[redacted]');
    expect(target).not.toContain(token);
    expect(target).not.toContain('source');
  });

  it('removes portal tokens while retaining non-secret decision route context', () => {
    const token = 'secret-customer-portal-token-that-must-never-be-logged';
    const target = safeRequestTarget(
      `/api/public/mesaleads/portal/${token}/quotes/quote-123/decision?attempt=private`,
    );
    expect(target).toBe('/api/public/mesaleads/portal/[redacted]/quotes/quote-123/decision');
    expect(target).not.toContain(token);
    expect(target).not.toContain('attempt');
  });

  it('removes query strings from ordinary API log targets', () => {
    expect(safeRequestTarget('/api/mesaleads/leads?search=private')).toBe('/api/mesaleads/leads');
  });
});
