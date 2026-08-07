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

describe('management overview', () => {
  it('returns the MD overview shape for Managing Director', async () => {
    const r = await request(app).get('/api/management/overview').set('x-dev-user', 'EMP-001');
    expect(r.status).toBe(200);
    expect(r.body.context).toMatchObject({ shift: expect.stringMatching(/^[DN]$/), asOf: expect.any(String) });
    expect(r.body.kpis).toHaveProperty('productionKg');
    expect(r.body.kpis).toHaveProperty('scrapRatePct');
    expect(r.body.kpis).toHaveProperty('onTimeDeliveryPct');
    expect(r.body.kpis).toHaveProperty('complaints');
    expect(Array.isArray(r.body.productionSeries)).toBe(true);
    expect(r.body.productionSeries).toHaveLength(7);
    expect(r.body.queues).toHaveProperty('qa');
    expect(r.body.queues).toHaveProperty('dispatch');
    expect(Array.isArray(r.body.alerts)).toBe(true);
    expect(Array.isArray(r.body.feedbackOpen)).toBe(true);
  });

  it('forbids operators without management_dashboard', async () => {
    const r = await request(app).get('/api/management/overview').set('x-dev-user', 'EMP-007');
    expect(r.status).toBe(403);
  });
});
