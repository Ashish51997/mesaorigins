import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';

const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 7);
const idem = () => `inventory-plan-${Date.now()}-${uniq()}`;

async function stock() {
  return (await request(app).get('/api/inventory/stock')).body as { rawMaterials: Array<{ itemName: string; onHand: number }>; finishedGoods: Array<{ itemName: string; onHand: number }> };
}

async function primaryPlantMachine() {
  const machines = (await request(app).get('/api/machines')).body as Array<{ id: string; plantCode: string }>;
  const machine = machines.find((candidate) => candidate.plantCode === 'PRIMARY');
  expect(machine).toBeTruthy();
  return machine!;
}

describe('inventory slice', () => {
  it('receiving RM increases stock; issuing to a machine decreases it', async () => {
    const material = `Resin-${uniq()}`;
    await request(app).post('/api/inventory/receive').send({ itemName: material, quantity: 1000, unit: 'kg', reference: 'PO-1' });
    expect((await stock()).rawMaterials.find((r) => r.itemName === material)?.onHand).toBe(1000);

    const machine = await primaryPlantMachine();
    const iss = await request(app).post('/api/inventory/issue').send({ itemName: material, quantity: 300, unit: 'kg', machineId: machine.id });
    expect(iss.status).toBe(201);
    expect((await stock()).rawMaterials.find((r) => r.itemName === material)?.onHand).toBe(700);
  });

  it('refuses to over-issue (409) or issue to an unknown machine (422)', async () => {
    const material = `Filler-${uniq()}`;
    await request(app).post('/api/inventory/receive').send({ itemName: material, quantity: 50, unit: 'kg' });
    const machine = await primaryPlantMachine();
    const over = await request(app).post('/api/inventory/issue').send({ itemName: material, quantity: 500, unit: 'kg', machineId: machine.id });
    expect(over.status).toBe(409);
    const bad = await request(app).post('/api/inventory/issue').send({ itemName: material, quantity: 10, unit: 'kg', machineId: 'nope' });
    expect(bad.status).toBe(422);
  });

  it('reflects a QA pass as finished-goods stock', async () => {
    const product = `FG-${uniq()}`;
    const lot = `LOT-INV-${uniq()}`;
    const c = await request(app).post('/api/customers').send({ name: `INV ${uniq()}` });
    const inq = await request(app).post('/api/inquiries').send({ customerId: c.body.id, product, quantity: 100, expectedDeliveryDate: '2026-10-01' });
    await request(app).post(`/api/inquiries/${inq.body.id}/quote`).send({ quotationPrice: 40 });
    const ord = await request(app).post('/api/orders').send({ inquiryId: inq.body.id });
    const machine = await request(app).post('/api/machines').send({ code: `I${uniq()}`, line: 'Inventory QA test', family: 'PVC' });
    const machineId = machine.body.id as string;
    const plan = await request(app).post('/api/plans').set('Idempotency-Key', idem()).send({ salesOrderId: ord.body.id, expectedOrderVersion: 0, machineId, shift: 'D', scheduledStartDate: '2026-10-11T08:00:00', supervisor: 'Nandlal', drawingNo: 'DRW-1', formulaNo: 'RF03 · Rev 2', moldNo: 'MLD-1', productName: product });
    const lb = await request(app).post('/api/logbooks').send({ productionPlanId: plan.body.id });
    await request(app).patch(`/api/logbooks/${lb.body.id}`).send({ operatorSignature: 'N', supervisorSignature: 'Nandlal', traceabilityRows: [{ lotNumber: lot, colour: 'B', code: 'C', winderPackedBy: 'x' }] });
    await request(app).post(`/api/logbooks/${lb.body.id}/submit`);
    await request(app).post('/api/quality/inspections').send({ lotNumber: lot, decision: 'pass', weight: 22 });

    expect((await stock()).finishedGoods.find((r) => r.itemName === product)?.onHand).toBe(22);
  });

  it('denies a Sales Exec from the stock board (403)', async () => {
    const r = await request(app).get('/api/inventory/stock').set('x-dev-user', 'EMP-003');
    expect(r.status).toBe(403);
  });
});
