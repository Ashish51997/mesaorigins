import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';

// Integration tests against a live Postgres (seeded demo tenant). No auth header
// → demo Administrator (can do everything).
const app = buildApp();

async function pendingOrders() {
  return (await request(app).get('/api/planning/orders')).body as Array<{ id: string; status: string; soNumber: string }>;
}

describe('planning slice', () => {
  it('lists only pending orders in the planning queue', async () => {
    const r = await request(app).get('/api/planning/orders');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect((r.body as Array<{ status: string }>).every((o) => o.status === 'pending')).toBe(true);
  });

  it('schedules an order, prevents double-booking, and releases it back', async () => {
    const machines = (await request(app).get('/api/machines')).body as Array<{ id: string; code: string }>;
    const machine = machines.find((m) => m.code === 'M07') ?? machines[0];
    const before = await pendingOrders();
    expect(before.length).toBeGreaterThan(0);
    const order = before[0];
    const day = '2026-08-20';

    const plan = await request(app).post('/api/plans').send({
      salesOrderId: order.id, machineId: machine.id, shift: 'D', operatorName: 'Nandlal',
      scheduledStartDate: `${day}T08:00:00`, scheduledEndDate: `${day}T16:00:00`,
    });
    expect(plan.status).toBe(201);
    expect(plan.body.machine.code).toBe(machine.code);
    expect(plan.body.status).toBe('scheduled');

    // The order left the queue (now 'planned').
    expect((await pendingOrders()).find((o) => o.id === order.id)).toBeUndefined();

    // Double-booking the same machine + shift + day is refused.
    const rest = await pendingOrders();
    if (rest.length > 0) {
      const clash = await request(app).post('/api/plans').send({
        salesOrderId: rest[0].id, machineId: machine.id, shift: 'D', scheduledStartDate: `${day}T09:00:00`,
      });
      expect(clash.status).toBe(409);
    }

    // Release returns the order to the queue.
    const rel = await request(app).post(`/api/plans/${plan.body.id}/release`);
    expect(rel.status).toBe(200);
    expect((await pendingOrders()).find((o) => o.id === order.id)).toBeDefined();
  });

  it('rejects an unknown machine (422)', async () => {
    const orders = await pendingOrders();
    if (orders.length === 0) return;
    const r = await request(app).post('/api/plans').send({
      salesOrderId: orders[0].id, machineId: 'does-not-exist', shift: 'D', scheduledStartDate: '2026-09-02T08:00:00',
    });
    expect(r.status).toBe(422);
  });

  it('denies an Operator from scheduling (403)', async () => {
    const r = await request(app).post('/api/plans').set('x-dev-user', 'EMP-007')
      .send({ salesOrderId: 'x', machineId: 'y', scheduledStartDate: '2026-09-01' });
    expect(r.status).toBe(403);
  });
});
