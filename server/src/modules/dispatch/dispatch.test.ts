import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { withTenant } from '../../db';

// Integration tests against a live Postgres (seeded demo tenant). No auth header
// → demo Administrator. Self-contained: drives an order through the whole chain.
const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 7);

async function order(): Promise<string> {
  const c = await request(app).post('/api/customers').send({ name: `D ${uniq()}`, deliveryAddress: 'Plot 4, Peenya' });
  const inq = await request(app).post('/api/inquiries').send({ customerId: c.body.id, product: 'RPVC roll', quantity: 500, expectedDeliveryDate: '2026-10-01' });
  await request(app).post(`/api/inquiries/${inq.body.id}/quote`).send({ quotationPrice: 40 });
  return (await request(app).post('/api/orders').send({ inquiryId: inq.body.id })).body.id;
}

async function produce(orderId: string, machineCode: string, day: string): Promise<void> {
  const machines = (await request(app).get('/api/machines')).body as Array<{ id: string; code: string }>;
  const machineId = machines.find((m) => m.code === machineCode)!.id;
  const plan = await request(app).post('/api/plans').send({ salesOrderId: orderId, machineId, shift: 'D', scheduledStartDate: `${day}T08:00:00` });
  const lb = await request(app).post('/api/logbooks').send({ productionPlanId: plan.body.id });
  await request(app).patch(`/api/logbooks/${lb.body.id}`).send({ operatorSignature: 'Nandlal' });
  await request(app).post(`/api/logbooks/${lb.body.id}/submit`);
}

describe('dispatch slice', () => {
  it('a produced order is ready, dispatches (order → dispatched, invoice, FG out)', async () => {
    const orderId = await order();
    await produce(orderId, 'M05', '2026-10-10');

    const ready = (await request(app).get('/api/dispatch/ready')).body as Array<{ id: string }>;
    expect(ready.some((o) => o.id === orderId)).toBe(true);

    const disp = await request(app).post('/api/dispatches').send({ salesOrderId: orderId, vehicleNumber: 'KA-01-AB-1234', transporter: 'Blue Dart', driverName: 'Ravi' });
    expect(disp.status).toBe(201);
    expect(disp.body.invoiceNumber).toMatch(/^INV-\d{4}-\d+$/);

    // It left the ready list…
    const ready2 = (await request(app).get('/api/dispatch/ready')).body as Array<{ id: string }>;
    expect(ready2.some((o) => o.id === orderId)).toBe(false);

    // …a finished-goods OUT movement was booked…
    const out = await withTenant('org-demo', (tx) => tx.inventoryTransaction.findMany({ where: { reference: `Dispatch ${disp.body.invoiceNumber}` } }));
    expect(out).toHaveLength(1);
    expect(out[0].direction).toBe('out');

    // …and re-dispatching is refused.
    const dupe = await request(app).post('/api/dispatches').send({ salesOrderId: orderId, vehicleNumber: 'X' });
    expect(dupe.status).toBe(409);
  });

  it('refuses to dispatch an order that is not produced yet (409)', async () => {
    const orderId = await order(); // no plan/logbook
    const r = await request(app).post('/api/dispatches').send({ salesOrderId: orderId, vehicleNumber: 'X' });
    expect(r.status).toBe(409);
  });

  it('denies a Sales Exec from the dispatch board (403)', async () => {
    const r = await request(app).get('/api/dispatch/ready').set('x-dev-user', 'EMP-003');
    expect(r.status).toBe(403);
  });
});
