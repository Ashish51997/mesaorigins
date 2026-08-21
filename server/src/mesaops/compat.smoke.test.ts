import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';

/**
 * While MESAOPS_API_COMPAT is on (default outside production), legacy flat
 * paths must still resolve. Canonical coverage lives in domain *.test.ts files.
 * No x-dev-user → demo Administrator (same as other mesaops slice tests).
 */
describe('MesaOps API compat shim', () => {
  const app = buildApp();

  it('serves /api/customers on the legacy flat path', async () => {
    const legacy = await request(app).get('/api/customers');
    const canonical = await request(app).get('/api/mesaops/v1/customers');
    expect(legacy.status).toBe(200);
    expect(canonical.status).toBe(200);
    expect(legacy.body).toEqual(canonical.body);
  });
});
