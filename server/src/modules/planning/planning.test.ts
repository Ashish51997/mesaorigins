import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';

// Integration tests against a live Postgres (seeded demo tenant). No auth header
// → demo Administrator (can do everything).
const app = buildApp();

const HEADER = {
  supervisor: 'Nandlal',
  drawingNo: 'DRW-TEST',
  formulaNo: 'RF03 · Rev 2',
  moldNo: 'MLD-1',
  productName: 'Test Product',
};

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

  it('schedules with shift header, seeds a draft logbook, prevents double-booking, and releases', async () => {
    const machines = (await request(app).get('/api/machines')).body as Array<{ id: string; code: string }>;
    const machine = machines.find((m) => m.code === 'M07') ?? machines[0];
    const before = await pendingOrders();
    expect(before.length).toBeGreaterThan(0);
    const order = before[0];
    const day = '2027-03-20';

    const plan = await request(app).post('/api/plans').send({
      salesOrderId: order.id, machineId: machine.id, shift: 'D', operatorName: 'Nandlal',
      scheduledStartDate: `${day}T08:00:00`, scheduledEndDate: `${day}T16:00:00`,
      ...HEADER, productName: order.soNumber,
    });
    expect(plan.status).toBe(201);
    expect(plan.body.machine.code).toBe(machine.code);
    expect(plan.body.status).toBe('scheduled');
    expect(plan.body.supervisor).toBe('Nandlal');
    expect(plan.body.drawingNo).toBe('DRW-TEST');
    expect(plan.body.logbook?.status).toBe('draft');

    // Draft logbook carries the shift header.
    const lb = await request(app).get(`/api/logbooks/plan/${plan.body.id}`);
    expect(lb.status).toBe(200);
    expect(lb.body.status).toBe('draft');
    expect(lb.body.supervisor).toBe('Nandlal');
    expect(lb.body.shift).toBe('D');
    expect(lb.body.date).toBe(day);
    expect(lb.body.formulaNo).toBe('RF03 · Rev 2');

    expect((await pendingOrders()).find((o) => o.id === order.id)).toBeUndefined();

    const rest = await pendingOrders();
    if (rest.length > 0) {
      const clash = await request(app).post('/api/plans').send({
        salesOrderId: rest[0].id, machineId: machine.id, shift: 'D', scheduledStartDate: `${day}T09:00:00`, ...HEADER,
      });
      expect(clash.status).toBe(409);
    }

    // PATCH before start is allowed.
    const patched = await request(app).patch(`/api/plans/${plan.body.id}`).send({ moldNo: 'MLD-99', drawingNo: 'DRW-99' });
    expect(patched.status).toBe(200);
    expect(patched.body.moldNo).toBe('MLD-99');
    const lb2 = await request(app).get(`/api/logbooks/plan/${plan.body.id}`);
    expect(lb2.body.moldNo).toBe('MLD-99');
    expect(lb2.body.drawingNo).toBe('DRW-99');

    const rel = await request(app).post(`/api/plans/${plan.body.id}/release`);
    expect(rel.status).toBe(200);
    expect((await pendingOrders()).find((o) => o.id === order.id)).toBeDefined();
    expect((await request(app).get(`/api/logbooks/plan/${plan.body.id}`)).body).toBeNull();
  });

  it('rejects PATCH after the schedule start time', async () => {
    const machines = (await request(app).get('/api/machines')).body as Array<{ id: string; code: string }>;
    const machine = machines.find((m) => m.code === 'M08') ?? machines[0];
    const orders = await pendingOrders();
    if (orders.length === 0) return;
    const past = '2020-01-01T08:00:00';
    const plan = await request(app).post('/api/plans').send({
      salesOrderId: orders[0].id, machineId: machine.id, shift: 'N',
      scheduledStartDate: past, scheduledEndDate: '2020-01-01T16:00:00', ...HEADER,
    });
    expect(plan.status).toBe(201);
    const r = await request(app).patch(`/api/plans/${plan.body.id}`).send({ moldNo: 'X' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('already_started');
    await request(app).post(`/api/plans/${plan.body.id}/release`);
  });

  it('requires shift header fields on create (422)', async () => {
    const orders = await pendingOrders();
    if (orders.length === 0) return;
    const machines = (await request(app).get('/api/machines')).body as Array<{ id: string }>;
    const r = await request(app).post('/api/plans').send({
      salesOrderId: orders[0].id, machineId: machines[0].id, shift: 'D', scheduledStartDate: '2027-09-02T08:00:00',
    });
    expect(r.status).toBe(422);
  });

  it('rejects an unknown machine (422)', async () => {
    const orders = await pendingOrders();
    if (orders.length === 0) return;
    const r = await request(app).post('/api/plans').send({
      salesOrderId: orders[0].id, machineId: 'does-not-exist', shift: 'D', scheduledStartDate: '2027-09-02T08:00:00', ...HEADER,
    });
    expect(r.status).toBe(422);
  });

  it('denies an Operator from scheduling (403)', async () => {
    const r = await request(app).post('/api/plans').set('x-dev-user', 'EMP-007')
      .send({ salesOrderId: 'x', machineId: 'y', scheduledStartDate: '2027-09-01', ...HEADER });
    expect(r.status).toBe(403);
  });
});
