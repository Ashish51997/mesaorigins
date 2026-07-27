import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';

// Integration tests against a live Postgres (seeded demo tenant). No auth header
// → demo Administrator. Self-contained: builds its own order → plan so it does
// not consume the seed's shared pending orders.
const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 7);

async function freshPlan(machineCode: string, day: string): Promise<string> {
  const c = await request(app).post('/api/customers').send({ name: `LB ${uniq()}` });
  const inq = await request(app).post('/api/inquiries').send({ customerId: c.body.id, product: 'RPVC 20mm', quantity: 1000, expectedDeliveryDate: '2026-10-01' });
  await request(app).post(`/api/inquiries/${inq.body.id}/quote`).send({ quotationPrice: 40 });
  const ord = await request(app).post('/api/orders').send({ inquiryId: inq.body.id });
  const machines = (await request(app).get('/api/machines')).body as Array<{ id: string; code: string }>;
  const machineId = machines.find((m) => m.code === machineCode)!.id;
  const plan = await request(app).post('/api/plans').send({ salesOrderId: ord.body.id, machineId, shift: 'D', scheduledStartDate: `${day}T08:00:00` });
  return plan.body.id as string;
}

describe('logbook slice', () => {
  it('lists templates and the scheduled-plan gate', async () => {
    const t = await request(app).get('/api/logbook/templates');
    expect(t.status).toBe(200);
    expect(t.body.length).toBeGreaterThan(0);
    const p = await request(app).get('/api/logbook/plans');
    expect(p.status).toBe(200);
    expect(Array.isArray(p.body)).toBe(true);
  });

  it('lists only the active formulations to fill Formula No from', async () => {
    const r = await request(app).get('/api/logbook/formulas');
    expect(r.status).toBe(200);
    const rows = r.body as Array<{ code: string; rev: number }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((f) => f.code === 'RF03' && f.rev === 2)).toBe(true);  // the active revision is offered
    expect(rows.some((f) => f.code === 'RF03' && f.rev === 1)).toBe(false); // the locked/retired revision is not
  });

  it('opens a draft, saves it, submits (plan → running), and locks', async () => {
    const planId = await freshPlan('M08', '2026-10-05');

    const open = await request(app).post('/api/logbooks').send({ productionPlanId: planId });
    expect(open.status).toBe(201);
    expect(open.body.status).toBe('draft');
    expect(Array.isArray(open.body.coilWeights)).toBe(true); // sized from the template
    const id = open.body.id;

    // Opening again returns the same draft (one logbook per plan).
    const again = await request(app).post('/api/logbooks').send({ productionPlanId: planId });
    expect(again.body.id).toBe(id);

    // Cannot submit without the operator sign-off.
    const early = await request(app).post(`/api/logbooks/${id}/submit`);
    expect(early.status).toBe(422);

    const save = await request(app).patch(`/api/logbooks/${id}`).send({ operatorSignature: 'Nandlal', motorSpeed: '42' });
    expect(save.status).toBe(200);
    expect(save.body.operatorSignature).toBe('Nandlal');

    const submit = await request(app).post(`/api/logbooks/${id}/submit`);
    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe('submitted');

    // The plan advanced to running, and its logbook shows submitted.
    const plans = (await request(app).get('/api/logbook/plans')).body as Array<{ id: string; status: string; logbook: { status: string } | null }>;
    const pl = plans.find((x) => x.id === planId);
    expect(pl?.status).toBe('running');
    expect(pl?.logbook?.status).toBe('submitted');

    // A submitted logbook is locked.
    const locked = await request(app).patch(`/api/logbooks/${id}`).send({ motorSpeed: '99' });
    expect(locked.status).toBe(409);
  });

  it('books raw-material consumption from the formulation when a logbook is submitted', async () => {
    // A dedicated formulation so this test is isolated from other tests' edits.
    const code = `CONS-${uniq().toUpperCase()}`;
    await request(app).post('/api/formulations').send({
      code, product: 'RPVC', components: [{ name: 'RPVC resin', pct: 80 }, { name: 'CaCO3 filler', pct: 14 }, { name: 'Stabilizer', pct: 6 }],
    });
    const planId = await freshPlan('M02', '2026-12-01');
    const id = (await request(app).post('/api/logbooks').send({ productionPlanId: planId })).body.id;

    // Record the formulation run + the mass consumed, then submit.
    await request(app).patch(`/api/logbooks/${id}`).send({
      operatorSignature: 'Nandlal', formulaNo: `${code} · Rev 1`, totalConsumedKg: '1000',
    });
    const submit = await request(app).post(`/api/logbooks/${id}/submit`);
    expect(submit.status).toBe(200);

    // 80% / 14% / 6% of 1000 kg → RM 'out' rows.
    const txns = (await request(app).get('/api/inventory/transactions')).body as Array<{
      type: string; direction: string; itemName: string; quantity: number; unit: string; reference: string;
    }>;
    const consumed = txns.filter((t) => t.type === 'raw_material' && t.direction === 'out' && t.reference.includes(planId));
    const qty = (n: string) => consumed.find((t) => t.itemName === n)?.quantity;
    expect(qty('RPVC resin')).toBe(800);
    expect(qty('CaCO3 filler')).toBe(140);
    expect(qty('Stabilizer')).toBe(60);
    expect(consumed.length).toBe(3);
    expect(consumed.every((t) => t.unit === 'kg')).toBe(true);

    // And that consumption shows up as reduced on-hand on the RM stock board.
    const stock = (await request(app).get('/api/inventory/stock')).body as { rawMaterials: Array<{ itemName: string; onHand: number }> };
    expect(stock.rawMaterials.some((r) => r.itemName === 'RPVC resin')).toBe(true);
  });

  it('denies a Sales Exec from the logbook gate (403)', async () => {
    const r = await request(app).get('/api/logbook/plans').set('x-dev-user', 'EMP-003');
    expect(r.status).toBe(403);
  });

  it("resolves the plan's chosen template (pipe layout) into the logbook", async () => {
    const templates = (await request(app).get('/api/logbook/templates')).body as Array<{ id: string; layout: string }>;
    const pipe = templates.find((t) => t.layout === 'pipe')!;
    expect(pipe).toBeTruthy();

    const c = await request(app).post('/api/customers').send({ name: `PT ${uniq()}` });
    const inq = await request(app).post('/api/inquiries').send({ customerId: c.body.id, product: 'RPVC 11mm', quantity: 500, expectedDeliveryDate: '2026-10-01' });
    await request(app).post(`/api/inquiries/${inq.body.id}/quote`).send({ quotationPrice: 40 });
    const ord = await request(app).post('/api/orders').send({ inquiryId: inq.body.id });
    const machines = (await request(app).get('/api/machines')).body as Array<{ id: string; code: string }>;
    const mId = machines.find((m) => m.code === 'M01')!.id;
    const plan = await request(app).post('/api/plans').send({ salesOrderId: ord.body.id, machineId: mId, shift: 'D', scheduledStartDate: '2026-12-15T08:00:00', logbookTemplateId: pipe.id });
    expect(plan.status).toBe(201);

    const lb = await request(app).post('/api/logbooks').send({ productionPlanId: plan.body.id });
    expect(lb.body.templateId).toBe(pipe.id);
    const row = lb.body.hourlyInspections[0];
    expect(row).toHaveProperty('od');       // pipe columns
    expect(row).not.toHaveProperty('thickness'); // not coil columns
  });

  it('lists machine tasks grouped by machine', async () => {
    const r = await request(app).get('/api/logbook/tasks');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    if (r.body.length) { expect(r.body[0]).toHaveProperty('machine'); expect(Array.isArray(r.body[0].tasks)).toBe(true); }
  });

  it('creates then deletes a custom template; denies a non-admin', async () => {
    const t = await request(app).post('/api/logbook/templates').send({ productName: `Test ${uniq()}`, layout: 'pipe', docNo: 'QR/MFG/999' });
    expect(t.status).toBe(201);
    expect(t.body.layout).toBe('pipe');
    expect((await request(app).delete(`/api/logbook/templates/${t.body.id}`)).status).toBe(200);
    // An Operator cannot build templates.
    expect((await request(app).post('/api/logbook/templates').set('x-dev-user', 'EMP-007').send({ productName: 'x' })).status).toBe(403);
  });
});
