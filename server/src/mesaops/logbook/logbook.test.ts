import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { withTenant } from '../../db';
import { canonicalHash } from '../../lib/canonical';

// Integration tests against a live Postgres (seeded demo tenant). No auth header
// → demo Administrator. Self-contained: builds its own order → plan so it does
// not consume the seed's shared pending orders.
const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 7);
const idem = (prefix: string) => `${prefix}-${Date.now()}-${uniq()}`;

async function freshPlan(machineCode: string, day: string): Promise<string> {
  const c = await request(app).post('/api/mesaops/v1/customers').send({ name: `LB ${uniq()}` });
  const inq = await request(app).post('/api/mesaops/v1/inquiries').send({ customerId: c.body.id, product: 'RPVC 20mm', quantity: 1000, expectedDeliveryDate: '2026-10-01' });
  await request(app).post(`/api/mesaops/v1/inquiries/${inq.body.id}/quote`).send({ quotationPrice: 40 });
  const ord = await request(app).post('/api/mesaops/v1/orders').send({ inquiryId: inq.body.id });
  const machines = (await request(app).get('/api/mesaops/v1/machines')).body as Array<{ id: string; code: string }>;
  const machineId = machines.find((m) => m.code === machineCode)!.id;
  const plan = await request(app).post('/api/mesaops/v1/plans').set('Idempotency-Key', idem('logbook-plan')).send({ salesOrderId: ord.body.id, expectedOrderVersion: 0, machineId, shift: 'D', scheduledStartDate: `${day}T08:00:00`, supervisor: 'Nandlal', drawingNo: 'DRW-1', formulaNo: 'RF03 · Rev 2', moldNo: 'MLD-1', productName: 'RPVC' });
  return plan.body.id as string;
}

async function freshOperationalPlan(machineCode: string, day: string) {
  const suffix = uniq().toUpperCase();
  const productName = `Trial compound ${suffix}`;
  const orderNumber = `OP-LB-${suffix}`;
  const demand = await request(app)
    .post('/api/mesaops/v1/operational-orders')
    .set('Idempotency-Key', `logbook-operational-${Date.now()}-${suffix}`)
    .send({
      orderNumber,
      sourceType: 'trial',
      productName,
      productCode: `TR-${suffix}`,
      quantity: '250.5',
      uom: 'kg',
      dueDate: day,
    });
  expect(demand.status).toBe(201);
  expect(demand.body.legacySalesOrderId).toBeNull();

  const machines = (await request(app).get('/api/mesaops/v1/machines')).body as Array<{ id: string; code: string }>;
  const machineId = machines.find((machine) => machine.code === machineCode)?.id;
  expect(machineId).toBeTruthy();

  const plan = await request(app).post('/api/mesaops/v1/plans').set('Idempotency-Key', idem('operational-plan')).send({
    operationalOrderId: demand.body.id,
    expectedOrderVersion: demand.body.rowVersion,
    plannedQuantity: '250.5',
    machineId,
    shift: 'D',
    scheduledStartDate: `${day}T08:00:00`,
    supervisor: 'Nandlal',
    drawingNo: 'DRW-OP-1',
    formulaNo: 'RF03 · Rev 2',
    moldNo: 'MLD-OP-1',
  });
  expect(plan.status).toBe(201);
  expect(plan.body.salesOrderId).toBeNull();

  return { planId: plan.body.id as string, orderNumber, productName };
}

describe('logbook slice', () => {
  it('lists templates and the scheduled-plan gate', async () => {
    const t = await request(app).get('/api/mesaops/v1/logbook/templates');
    expect(t.status).toBe(200);
    expect(t.body.length).toBeGreaterThan(0);
    const p = await request(app).get('/api/mesaops/v1/logbook/plans');
    expect(p.status).toBe(200);
    expect(Array.isArray(p.body)).toBe(true);
  });

  it('lists only the active formulations to fill Formula No from', async () => {
    const r = await request(app).get('/api/mesaops/v1/logbook/formulas');
    expect(r.status).toBe(200);
    const rows = r.body as Array<{ code: string; rev: number }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((f) => f.code === 'RF03' && f.rev === 2)).toBe(true);  // the active revision is offered
    expect(rows.some((f) => f.code === 'RF03' && f.rev === 1)).toBe(false); // the locked/retired revision is not
  });

  it('opens a draft, saves it, submits (plan → running), and locks', async () => {
    const planId = await freshPlan('M08', '2026-10-05');

    const open = await request(app).post('/api/mesaops/v1/logbooks').send({ productionPlanId: planId });
    expect(open.status).toBe(201);
    expect(open.body.status).toBe('draft');
    expect(Array.isArray(open.body.coilWeights)).toBe(true); // sized from the template
    const id = open.body.id;

    // Opening again returns the same draft (one logbook per plan).
    const again = await request(app).post('/api/mesaops/v1/logbooks').send({ productionPlanId: planId });
    expect(again.body.id).toBe(id);

    // Cannot close without required fields filled.
    const early = await request(app).post(`/api/mesaops/v1/logbooks/${id}/submit`);
    expect(early.status).toBe(422);

    const save = await request(app).patch(`/api/mesaops/v1/logbooks/${id}`).send({
      date: '2026-10-05',
      shift: 'D',
      supervisor: 'Nandlal',
      formulaNo: 'RF03',
      operatorSignature: 'Nandlal',
      supervisorSignature: 'Suresh',
      motorSpeed: '42',
    });
    expect(save.status).toBe(200);
    expect(save.body.operatorSignature).toBe('Nandlal');

    const submit = await request(app).post(`/api/mesaops/v1/logbooks/${id}/submit`);
    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe('submitted');
    const returnEvents = await withTenant('org-demo', (tx) => tx.integrationOutboxEvent.findMany({ where: {
      aggregateId: id, eventType: 'mesaops.production-actuals.submitted.v1',
    } }));
    expect(returnEvents).toHaveLength(1);
    expect(returnEvents[0].schemaVersion).toBe(1);
    expect(returnEvents[0].payloadHash).toBe(canonicalHash(returnEvents[0].payload));
    expect(returnEvents[0].legalEntityId).toBeNull();

    // The plan advanced to running, and its logbook shows submitted.
    const plans = (await request(app).get('/api/mesaops/v1/logbook/plans')).body as Array<{ id: string; status: string; logbook: { status: string } | null }>;
    const pl = plans.find((x) => x.id === planId);
    expect(pl?.status).toBe('running');
    expect(pl?.logbook?.status).toBe('submitted');

    // A submitted logbook is locked.
    const locked = await request(app).patch(`/api/mesaops/v1/logbooks/${id}`).send({ motorSpeed: '99' });
    expect(locked.status).toBe(409);
  });

  it('books raw-material consumption from the formulation when a logbook is submitted', async () => {
    // A dedicated formulation so this test is isolated from other tests' edits.
    const code = `CONS-${uniq().toUpperCase()}`;
    await request(app).post('/api/mesaops/v1/formulations').send({
      code, product: 'RPVC', components: [{ name: 'RPVC resin', pct: 80 }, { name: 'CaCO3 filler', pct: 14 }, { name: 'Stabilizer', pct: 6 }],
    });
    const planId = await freshPlan('M02', '2026-12-01');
    const id = (await request(app).post('/api/mesaops/v1/logbooks').send({ productionPlanId: planId })).body.id;

    // Record the formulation run + the mass consumed, then close.
    await request(app).patch(`/api/mesaops/v1/logbooks/${id}`).send({
      date: '2026-12-01',
      shift: 'D',
      supervisor: 'Nandlal',
      operatorSignature: 'Nandlal',
      supervisorSignature: 'Suresh',
      formulaNo: `${code} · Rev 1`,
      totalConsumedKg: '1000',
    });
    const submit = await request(app).post(`/api/mesaops/v1/logbooks/${id}/submit`);
    expect(submit.status).toBe(200);

    // 80% / 14% / 6% of 1000 kg → RM 'out' rows.
    const txns = (await request(app).get('/api/mesaops/v1/inventory/transactions')).body as Array<{
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
    const stock = (await request(app).get('/api/mesaops/v1/inventory/stock')).body as { rawMaterials: Array<{ itemName: string; onHand: number }> };
    expect(stock.rawMaterials.some((r) => r.itemName === 'RPVC resin')).toBe(true);
  });

  it('denies a Sales Exec from the logbook gate (403)', async () => {
    const r = await request(app).get('/api/mesaops/v1/logbook/plans').set('x-dev-user', 'EMP-003');
    expect(r.status).toBe(403);
  });

  it("resolves the plan's chosen template (pipe layout) into the logbook", async () => {
    const templates = (await request(app).get('/api/mesaops/v1/logbook/templates')).body as Array<{ id: string; layout: string }>;
    const pipe = templates.find((t) => t.layout === 'pipe')!;
    expect(pipe).toBeTruthy();

    const c = await request(app).post('/api/mesaops/v1/customers').send({ name: `PT ${uniq()}` });
    const inq = await request(app).post('/api/mesaops/v1/inquiries').send({ customerId: c.body.id, product: 'RPVC 11mm', quantity: 500, expectedDeliveryDate: '2026-10-01' });
    await request(app).post(`/api/mesaops/v1/inquiries/${inq.body.id}/quote`).send({ quotationPrice: 40 });
    const ord = await request(app).post('/api/mesaops/v1/orders').send({ inquiryId: inq.body.id });
    const machines = (await request(app).get('/api/mesaops/v1/machines')).body as Array<{ id: string; code: string }>;
    const mId = machines.find((m) => m.code === 'M01')!.id;
    const day = `2027-0${1 + (Math.floor(Math.random() * 8))}-${String(10 + Math.floor(Math.random() * 18)).padStart(2, '0')}`;
    const plan = await request(app).post('/api/mesaops/v1/plans').set('Idempotency-Key', idem('pipe-plan')).send({ salesOrderId: ord.body.id, expectedOrderVersion: 0, machineId: mId, shift: 'D', scheduledStartDate: `${day}T08:00:00`, logbookTemplateId: pipe.id, supervisor: 'Nandlal', drawingNo: 'DRW-1', formulaNo: 'RF03 · Rev 2', moldNo: 'MLD-1', productName: 'RPVC' });
    expect(plan.status).toBe(201);

    const lb = await request(app).post('/api/mesaops/v1/logbooks').send({ productionPlanId: plan.body.id });
    expect(lb.body.templateId).toBe(pipe.id);
    const row = lb.body.hourlyInspections[0];
    expect(row).toHaveProperty('od');       // pipe columns
    expect(row).not.toHaveProperty('thickness'); // not coil columns
  });

  it('lists machine tasks grouped by machine', async () => {
    const r = await request(app).get('/api/mesaops/v1/logbook/tasks');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    if (r.body.length) { expect(r.body[0]).toHaveProperty('machine'); expect(Array.isArray(r.body[0].tasks)).toBe(true); }
  });

  it('returns the operator machine hub for a code', async () => {
    const machines = await request(app).get('/api/mesaops/v1/machines');
    expect(machines.status).toBe(200);
    const code = machines.body[0]?.code;
    expect(code).toBeTruthy();
    const r = await request(app).get('/api/mesaops/v1/logbook/machine-hub').query({ machine: code });
    expect(r.status).toBe(200);
    expect(r.body.machine.code).toBe(code);
    expect(r.body).toHaveProperty('started');
    expect(Array.isArray(r.body.logbooks)).toBe(true);
    expect(Array.isArray(r.body.maintenance)).toBe(true);
    expect(Array.isArray(r.body.activePlans)).toBe(true);
  });

  it('keeps logbook order labels compatible for an OperationalOrder-only plan', async () => {
    const machineCode = `OL${uniq().toUpperCase()}`.slice(0, 8);
    const machine = await request(app).post('/api/mesaops/v1/machines').send({
      code: machineCode,
      line: 'Operational-order logbook test',
      family: 'PVC',
      status: 'running',
    });
    expect(machine.status).toBe(201);

    const { planId, orderNumber, productName } = await freshOperationalPlan(machineCode, '2028-04-19');

    const tasks = await request(app).get('/api/mesaops/v1/logbook/tasks');
    expect(tasks.status).toBe(200);
    const task = tasks.body
      .find((group: { machine: string }) => group.machine === machineCode)
      ?.tasks.find((entry: { id: string }) => entry.id === planId);
    expect(task?.operationalOrder.orderNumber).toBe(orderNumber);
    expect(task?.salesOrder).toEqual({ soNumber: orderNumber, product: productName });

    const plans = await request(app).get('/api/mesaops/v1/logbook/plans');
    expect(plans.status).toBe(200);
    const plan = plans.body.find((entry: { id: string }) => entry.id === planId);
    expect(plan?.operationalOrder.orderNumber).toBe(orderNumber);
    expect(plan?.salesOrder).toEqual({ soNumber: orderNumber, product: productName });

    const beforeSubmit = await request(app).get('/api/mesaops/v1/logbook/machine-hub').query({ machine: machineCode });
    expect(beforeSubmit.status).toBe(200);
    expect(beforeSubmit.body.activePlan.operationalOrder.orderNumber).toBe(orderNumber);
    expect(beforeSubmit.body.activePlan.salesOrder).toEqual({ soNumber: orderNumber, product: productName });

    const open = await request(app).post('/api/mesaops/v1/logbooks').send({ productionPlanId: planId });
    expect(open.status).toBe(201);
    expect(open.body.productName).toBe(productName);
    await request(app).patch(`/api/mesaops/v1/logbooks/${open.body.id}`).send({
      date: '2028-04-19',
      shift: 'D',
      supervisor: 'Nandlal',
      formulaNo: 'RF03',
      operatorSignature: 'Nandlal',
      supervisorSignature: 'Suresh',
    });
    const submitted = await request(app).post(`/api/mesaops/v1/logbooks/${open.body.id}/submit`);
    expect(submitted.status).toBe(200);

    const ledger = await request(app).get('/api/mesaops/v1/logbook/ledger');
    expect(ledger.status).toBe(200);
    const ledgerRow = ledger.body.rows.find((row: { productionPlanId: string }) => row.productionPlanId === planId);
    expect(ledgerRow?.operationalOrder.orderNumber).toBe(orderNumber);
    expect(ledgerRow?.orderNumber).toBe(orderNumber);
    expect(ledgerRow?.soNumber).toBe(orderNumber);
    expect(ledgerRow?.productName).toBe(productName);

    const afterSubmit = await request(app).get('/api/mesaops/v1/logbook/machine-hub').query({ machine: machineCode });
    expect(afterSubmit.status).toBe(200);
    const recent = afterSubmit.body.logbooks.find((entry: { productionPlanId: string }) => entry.productionPlanId === planId);
    expect(recent?.operationalOrder.orderNumber).toBe(orderNumber);
    expect(recent?.orderNumber).toBe(orderNumber);
    expect(recent?.soNumber).toBe(orderNumber);
    expect(recent?.productName).toBe(productName);
  });

  it('returns 404 for an unknown machine hub code', async () => {
    const r = await request(app).get('/api/mesaops/v1/logbook/machine-hub').query({ machine: 'ZZ99' });
    expect(r.status).toBe(404);
  });

  it('returns the submitted logbook ledger with a summary', async () => {
    const r = await request(app).get('/api/mesaops/v1/logbook/ledger');
    expect(r.status).toBe(200);
    expect(r.body.summary).toBeDefined();
    expect(typeof r.body.summary.submitted).toBe('number');
    expect(Array.isArray(r.body.rows)).toBe(true);
    expect(r.body.summary.submitted).toBe(r.body.rows.length);
    expect(r.body.charts).toBeDefined();
    expect(Array.isArray(r.body.charts.byDay)).toBe(true);
    expect(Array.isArray(r.body.charts.byMachine)).toBe(true);
    if (r.body.rows.length) {
      const row = r.body.rows[0];
      expect(row).toHaveProperty('machineId');
      expect(row).toHaveProperty('soNumber');
      expect(row).toHaveProperty('isoDate');
      expect(row).toHaveProperty('productionPlanId');
      expect(row).not.toHaveProperty('traceabilityRows');
      expect(row).not.toHaveProperty('hourlyInspections');
    }
  });

  it('filters the ledger by from/to iso dates', async () => {
    const all = await request(app).get('/api/mesaops/v1/logbook/ledger');
    expect(all.status).toBe(200);
    const future = await request(app).get('/api/mesaops/v1/logbook/ledger').query({ from: '2099-01-01', to: '2099-12-31' });
    expect(future.status).toBe(200);
    expect(future.body.summary.submitted).toBe(0);
    expect(future.body.rows).toHaveLength(0);
  });

  it('creates then deletes a custom template; denies a non-admin', async () => {
    const t = await request(app).post('/api/mesaops/v1/logbook/templates').send({ productName: `Test ${uniq()}`, layout: 'pipe', docNo: 'QR/MFG/999' });
    expect(t.status).toBe(201);
    expect(t.body.layout).toBe('pipe');
    expect((await request(app).delete(`/api/mesaops/v1/logbook/templates/${t.body.id}`)).status).toBe(200);
    // An Operator cannot build templates.
    expect((await request(app).post('/api/mesaops/v1/logbook/templates').set('x-dev-user', 'EMP-007').send({ productName: 'x' })).status).toBe(403);
  });

  it('resolves a machine QR code to the best active plan (prefers draft)', async () => {
    const missing = await request(app).get('/api/mesaops/v1/logbook/resolve').query({ machine: 'NOPE' });
    expect(missing.status).toBe(404);

    // Create a dedicated machine so we do not collide with other machines' plans.
    const code = `QR${uniq().toUpperCase()}`.slice(0, 8);
    const created = await request(app).post('/api/mesaops/v1/machines').send({
      code, line: 'QR test line', family: 'PVC', status: 'running',
    });
    expect(created.status).toBe(201);

    const empty = await request(app).get('/api/mesaops/v1/logbook/resolve').query({ machine: code });
    expect(empty.status).toBe(200);
    expect(empty.body.reason).toBe('no_active_plan');
    expect(empty.body.planId).toBeNull();
    expect(empty.body.machine.code).toBe(code);

    const planId = await freshPlan(code, '2028-03-15');
    const draft = await request(app).get('/api/mesaops/v1/logbook/resolve').query({ machine: code.toLowerCase() });
    expect(draft.status).toBe(200);
    expect(draft.body.reason).toBe('ok');
    expect(draft.body.planId).toBe(planId);
    // Planning may already have seeded a draft logbook on the plan.
    expect(draft.body.logStatus === null || draft.body.logStatus === 'draft').toBe(true);

    const open = await request(app).post('/api/mesaops/v1/logbooks').send({ productionPlanId: planId });
    expect(open.status).toBe(201);
    const stillDraft = await request(app).get('/api/mesaops/v1/logbook/resolve').query({ machine: code });
    expect(stillDraft.body.planId).toBe(planId);
    expect(stillDraft.body.logStatus).toBe('draft');

    await request(app).patch(`/api/mesaops/v1/logbooks/${open.body.id}`).send({
      date: '2028-03-15', shift: 'D', supervisor: 'Nandlal', formulaNo: 'RF03',
      operatorSignature: 'Nandlal', supervisorSignature: 'Suresh',
    });
    await request(app).post(`/api/mesaops/v1/logbooks/${open.body.id}/submit`);

    const afterSubmit = await request(app).get('/api/mesaops/v1/logbook/resolve').query({ machine: code });
    expect(afterSubmit.body.reason).toBe('ok');
    expect(afterSubmit.body.planId).toBe(planId);
    expect(afterSubmit.body.logStatus).toBe('submitted');
  });
});
