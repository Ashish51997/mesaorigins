import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { withTenant } from '../../db';

// Integration tests against a live Postgres (seeded demo tenant). No auth header
// → demo Administrator. Self-contained: produces a submitted logbook carrying a
// packed lot, then inspects it.
const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 7);

async function submitLogbookWithLot(machineCode: string, day: string, lot: string): Promise<void> {
  const c = await request(app).post('/api/customers').send({ name: `Q ${uniq()}` });
  const inq = await request(app).post('/api/inquiries').send({ customerId: c.body.id, product: 'RPVC roll', quantity: 1000, expectedDeliveryDate: '2026-10-01' });
  await request(app).post(`/api/inquiries/${inq.body.id}/quote`).send({ quotationPrice: 40 });
  const ord = await request(app).post('/api/orders').send({ inquiryId: inq.body.id });
  const machines = (await request(app).get('/api/machines')).body as Array<{ id: string; code: string }>;
  const machineId = machines.find((m) => m.code === machineCode)!.id;
  const plan = await request(app).post('/api/plans').send({ salesOrderId: ord.body.id, machineId, shift: 'D', scheduledStartDate: `${day}T08:00:00`, supervisor: 'Nandlal', drawingNo: 'DRW-1', formulaNo: 'RF03 · Rev 2', moldNo: 'MLD-1', productName: 'RPVC' });
  const lb = await request(app).post('/api/logbooks').send({ productionPlanId: plan.body.id });
  await request(app).patch(`/api/logbooks/${lb.body.id}`).send({ operatorSignature: 'Nandlal', traceabilityRows: [{ lotNumber: lot, colour: 'Black', code: 'C1', winderPackedBy: 'x' }] });
  await request(app).post(`/api/logbooks/${lb.body.id}/submit`);
}

describe('quality slice', () => {
  it('queues a packed roll, passes it, and books finished-goods stock', async () => {
    const lot = `LOT-Q-${uniq()}`;
    await submitLogbookWithLot('M09', '2026-10-08', lot);

    const queue = (await request(app).get('/api/quality/queue')).body as Array<{ lotNumber: string }>;
    expect(queue.some((q) => q.lotNumber === lot)).toBe(true);

    const insp = await request(app).post('/api/quality/inspections').send({ lotNumber: lot, decision: 'pass', weight: 24.5 });
    expect(insp.status).toBe(201);
    expect(insp.body.decision).toBe('pass');

    // It left the queue…
    const queue2 = (await request(app).get('/api/quality/queue')).body as Array<{ lotNumber: string }>;
    expect(queue2.some((q) => q.lotNumber === lot)).toBe(false);

    // …and a pass booked dispatchable FG stock.
    const fg = await withTenant('org-demo', (tx) => tx.inventoryTransaction.findMany({ where: { lotNumber: lot } }));
    expect(fg).toHaveLength(1);
    expect(fg[0].type).toBe('finished_goods');
    expect(fg[0].quantity).toBe(24.5);

    // Re-inspecting the same lot is refused.
    const dupe = await request(app).post('/api/quality/inspections').send({ lotNumber: lot, decision: 'pass', weight: 10 });
    expect(dupe.status).toBe(409);
  });

  it('a hold does not book stock', async () => {
    const lot = `LOT-H-${uniq()}`;
    await submitLogbookWithLot('M06', '2026-10-09', lot);
    const held = await request(app).post('/api/quality/inspections').send({ lotNumber: lot, decision: 'hold', weight: 20, remarks: 'dimension drift' });
    expect(held.status).toBe(201);
    const fg = await withTenant('org-demo', (tx) => tx.inventoryTransaction.findMany({ where: { lotNumber: lot } }));
    expect(fg).toHaveLength(0);
  });

  it('rejects an unknown lot (422)', async () => {
    const r = await request(app).post('/api/quality/inspections').send({ lotNumber: 'not-a-real-lot', decision: 'pass', weight: 5 });
    expect(r.status).toBe(422);
  });

  it('denies a Sales Exec from the roll queue (403)', async () => {
    const r = await request(app).get('/api/quality/queue').set('x-dev-user', 'EMP-003');
    expect(r.status).toBe(403);
  });
});
