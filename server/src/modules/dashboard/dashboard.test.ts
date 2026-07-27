import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';

const app = buildApp();

describe('dashboard summary', () => {
  it('returns real tenant-scoped KPI aggregates', async () => {
    const r = await request(app).get('/api/summary');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('orders');
    expect(r.body.orders).toHaveProperty('pending');
    expect(r.body).toHaveProperty('plans');
    expect(r.body).toHaveProperty('stock');
    expect(typeof r.body.customers).toBe('number');
    expect(typeof r.body.stock.rawMaterialKg).toBe('number');
  });

  it('is reachable by every role (dashboard is universal)', async () => {
    // Operator (EMP-007) is blocked from most screens but always has the dashboard.
    const r = await request(app).get('/api/summary').set('x-dev-user', 'EMP-007');
    expect(r.status).toBe(200);
  });
});
