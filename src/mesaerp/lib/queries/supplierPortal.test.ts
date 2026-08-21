import { afterEach, describe, expect, it, vi } from 'vitest';
import { supplierPortalRequest } from './supplierPortal';

describe('supplier portal transport boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the supplier session and never sends employee development identity headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ status: 'recorded' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await supplierPortalRequest(
      'POST',
      '/profile-change-cases',
      { changeType: 'gstin', proposedValues: { gstin: '29ABCDE1234F1Z5' } },
      'supplier-change-intent-001',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/supplier-portal/v1/profile-change-cases');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'supplier-change-intent-001',
    });
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain('x-dev-user');
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain('x-org-id');
  });

  it('does not add an idempotency header to a read projection', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ vendor: { id: 'vendor-1' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await supplierPortalRequest('GET', '/workspace');

    expect(fetchMock).toHaveBeenCalledWith('/api/supplier-portal/v1/workspace', {
      method: 'GET',
      credentials: 'include',
      headers: {},
      body: undefined,
    });
  });
});
