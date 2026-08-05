import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';

const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 7);

async function dispatchedOrder(machineCode: string, day: string): Promise<string> {
  const c = await request(app).post('/api/customers').send({ name: `CAPA ${uniq()}`, deliveryAddress: 'X' });
  const inq = await request(app).post('/api/inquiries').send({ customerId: c.body.id, product: 'RPVC roll', quantity: 500, expectedDeliveryDate: '2026-10-01' });
  await request(app).post(`/api/inquiries/${inq.body.id}/quote`).send({ quotationPrice: 40 });
  const ord = await request(app).post('/api/orders').send({ inquiryId: inq.body.id });
  const machines = (await request(app).get('/api/machines')).body as Array<{ id: string; code: string }>;
  const machineId = machines.find((m) => m.code === machineCode)!.id;
  const plan = await request(app).post('/api/plans').send({ salesOrderId: ord.body.id, machineId, shift: 'D', scheduledStartDate: `${day}T08:00:00`, supervisor: 'Nandlal', drawingNo: 'DRW-1', formulaNo: 'RF03 · Rev 2', moldNo: 'MLD-1', productName: 'RPVC' });
  const lb = await request(app).post('/api/logbooks').send({ productionPlanId: plan.body.id });
  await request(app).patch(`/api/logbooks/${lb.body.id}`).send({ operatorSignature: 'N' });
  await request(app).post(`/api/logbooks/${lb.body.id}/submit`);
  await request(app).post('/api/dispatches').send({ salesOrderId: ord.body.id, vehicleNumber: 'KA-1' });
  return ord.body.id as string;
}

describe('capa slice', () => {
  it('logs a complaint on a dispatched batch, works the CAPA, and closes the loop', async () => {
    const orderId = await dispatchedOrder('M03', '2026-10-12');

    const comp = await request(app).post('/api/complaints').send({ salesOrderId: orderId, severity: 'high', description: 'Surface tearing on the roll.' });
    expect(comp.status).toBe(201);
    expect(comp.body.complaintNumber).toMatch(/^C-\d{4}-\d+$/);
    expect(comp.body.batchNumber).toMatch(/^INV-/); // linked to the real dispatched invoice
    const capaId = comp.body.capa.id;
    const complaintId = comp.body.id;

    // A CAPA cannot be closed without the mandatory fields.
    const early = await request(app).post(`/api/capas/${capaId}/close`);
    expect(early.status).toBe(422);

    // A complaint cannot resolve while its CAPA is open.
    const tooSoon = await request(app).post(`/api/complaints/${complaintId}/resolve`);
    expect(tooSoon.status).toBe(409);

    await request(app).patch(`/api/capas/${capaId}`).send({ rootCause: 'Die lip nick', correctiveAction: 'Polished die', preventiveAction: 'Add die inspection to PM', responsiblePerson: 'Suresh' });
    const closed = await request(app).post(`/api/capas/${capaId}/close`);
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('closed');

    // Now the complaint can be resolved.
    const resolved = await request(app).post(`/api/complaints/${complaintId}/resolve`);
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('resolved');
  });

  it('refuses a complaint on an order that was never dispatched (422)', async () => {
    const c = await request(app).post('/api/customers').send({ name: `ND ${uniq()}` });
    const inq = await request(app).post('/api/inquiries').send({ customerId: c.body.id, product: 'X', quantity: 100, expectedDeliveryDate: '2026-10-01' });
    await request(app).post(`/api/inquiries/${inq.body.id}/quote`).send({ quotationPrice: 10 });
    const ord = await request(app).post('/api/orders').send({ inquiryId: inq.body.id });
    const r = await request(app).post('/api/complaints').send({ salesOrderId: ord.body.id, severity: 'low', description: 'x' });
    expect(r.status).toBe(422);
  });

  it('denies an Operator from the complaints board (403)', async () => {
    const r = await request(app).get('/api/complaints').set('x-dev-user', 'EMP-007');
    expect(r.status).toBe(403);
  });
});
