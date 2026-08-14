import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { canonicalHash as hashCanonical } from '../../lib/canonical';
import { signMesaErpToOpsHandoff } from '../../middleware/internalServiceAuth';
import { withTenant } from '../../db';

// Integration tests against a live Postgres (seeded demo tenant). No auth header
// → demo Administrator (can do everything).
const app = buildApp();
process.env.MESADESK_ERP_OPS_HANDOFF_HMAC_KEY = Buffer.alloc(32, 7).toString('base64');
const idem = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const HEADER = {
  supervisor: 'Nandlal',
  drawingNo: 'DRW-TEST',
  formulaNo: 'RF03 · Rev 2',
  moldNo: 'MLD-1',
  productName: 'Test Product',
};

async function pendingOrders() {
  return (await request(app).get('/api/planning/orders')).body as Array<{
    id: string; status: string; soNumber: string; quantity: string; rowVersion: number;
    plannedQuantity: string; remainingQuantity: string; sourceLinkState: string;
  }>;
}

describe('planning slice', () => {
  it('lists only MesaOps operational demand awaiting planning', async () => {
    const r = await request(app).get('/api/planning/orders');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect((r.body as Array<{ status: string }>).every((o) => ['ready_to_plan', 'partially_planned'].includes(o.status))).toBe(true);
    expect((r.body as Array<{ remainingQuantity: string }>).every((o) => typeof o.remainingQuantity === 'string')).toBe(true);
  });

  it('schedules with shift header, seeds a draft logbook, prevents double-booking, and releases', async () => {
    const machines = (await request(app).get('/api/machines')).body as Array<{ id: string; code: string }>;
    const machine = machines.find((m) => m.code === 'M07') ?? machines[0];
    const before = await pendingOrders();
    expect(before.length).toBeGreaterThan(0);
    const order = before[0];
    const day = '2027-03-20';

    const planKey = idem('plan');
    const planBody = {
      operationalOrderId: order.id, plannedQuantity: order.remainingQuantity,
      expectedOrderVersion: order.rowVersion,
      machineId: machine.id, shift: 'D', operatorName: 'Nandlal',
      scheduledStartDate: `${day}T08:00:00`, scheduledEndDate: `${day}T16:00:00`,
      ...HEADER, productName: order.soNumber,
    };
    const plan = await request(app).post('/api/plans').set('Idempotency-Key', planKey).send(planBody);
    expect(plan.status).toBe(201);
    expect(plan.body.machine.code).toBe(machine.code);
    expect(plan.body.status).toBe('scheduled');
    expect(plan.body.supervisor).toBe('Nandlal');
    expect(plan.body.drawingNo).toBe('DRW-TEST');
    expect(plan.body.logbook?.status).toBe('draft');
    const replayedPlan = await request(app).post('/api/plans').set('Idempotency-Key', planKey).send(planBody);
    expect(replayedPlan.status).toBe(201);
    expect(replayedPlan.body.id).toBe(plan.body.id);

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
      const clash = await request(app).post('/api/plans').set('Idempotency-Key', idem('clash')).send({
        operationalOrderId: rest[0].id, plannedQuantity: rest[0].remainingQuantity,
        expectedOrderVersion: rest[0].rowVersion,
        machineId: machine.id, shift: 'D', scheduledStartDate: `${day}T09:00:00`, ...HEADER,
      });
      expect(clash.status).toBe(409);
    }

    // PATCH before start is allowed.
    const patched = await request(app).patch(`/api/plans/${plan.body.id}`).set('Idempotency-Key', idem('patch')).send({ expectedVersion: plan.body.version, moldNo: 'MLD-99', drawingNo: 'DRW-99' });
    expect(patched.status).toBe(200);
    expect(patched.body.moldNo).toBe('MLD-99');
    const stalePatch = await request(app).patch(`/api/plans/${plan.body.id}`).set('Idempotency-Key', idem('stale-patch')).send({ expectedVersion: plan.body.version, moldNo: 'STALE' });
    expect(stalePatch.status).toBe(409);
    expect(stalePatch.body.error.code).toBe('version_conflict');
    const lb2 = await request(app).get(`/api/logbooks/plan/${plan.body.id}`);
    expect(lb2.body.moldNo).toBe('MLD-99');
    expect(lb2.body.drawingNo).toBe('DRW-99');

    const releaseKey = idem('release');
    const rel = await request(app).post(`/api/plans/${plan.body.id}/release`).set('Idempotency-Key', releaseKey).send({ expectedVersion: patched.body.version });
    expect(rel.status).toBe(200);
    const releaseReplay = await request(app).post(`/api/plans/${plan.body.id}/release`).set('Idempotency-Key', releaseKey).send({ expectedVersion: patched.body.version });
    expect(releaseReplay.status).toBe(200);
    expect(releaseReplay.body.releasedPlanId).toBe(plan.body.id);
    expect((await pendingOrders()).find((o) => o.id === order.id)).toBeDefined();
    expect((await request(app).get(`/api/logbooks/plan/${plan.body.id}`)).body).toBeNull();
  });

  it('rejects PATCH after the schedule start time', async () => {
    const machines = (await request(app).get('/api/machines')).body as Array<{ id: string; code: string }>;
    const machine = machines.find((m) => m.code === 'M08') ?? machines[0];
    const orders = await pendingOrders();
    if (orders.length === 0) return;
    const past = '2020-01-01T08:00:00';
    const plan = await request(app).post('/api/plans').set('Idempotency-Key', idem('past-plan')).send({
      operationalOrderId: orders[0].id, plannedQuantity: orders[0].remainingQuantity,
      expectedOrderVersion: orders[0].rowVersion,
      machineId: machine.id, shift: 'N',
      scheduledStartDate: past, scheduledEndDate: '2020-01-01T16:00:00', ...HEADER,
    });
    expect(plan.status).toBe(201);
    const r = await request(app).patch(`/api/plans/${plan.body.id}`).set('Idempotency-Key', idem('past-patch')).send({ expectedVersion: plan.body.version, moldNo: 'X' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('already_started');
    await request(app).post(`/api/plans/${plan.body.id}/release`).set('Idempotency-Key', idem('past-release')).send({ expectedVersion: plan.body.version });
  });

  it('requires shift header fields on create (422)', async () => {
    const orders = await pendingOrders();
    if (orders.length === 0) return;
    const machines = (await request(app).get('/api/machines')).body as Array<{ id: string }>;
    const r = await request(app).post('/api/plans').set('Idempotency-Key', idem('invalid-plan')).send({
      operationalOrderId: orders[0].id, plannedQuantity: orders[0].remainingQuantity,
      expectedOrderVersion: orders[0].rowVersion,
      machineId: machines[0].id, shift: 'D', scheduledStartDate: '2027-09-02T08:00:00',
    });
    expect(r.status).toBe(422);
  });

  it('rejects an unknown machine (422)', async () => {
    const orders = await pendingOrders();
    if (orders.length === 0) return;
    const r = await request(app).post('/api/plans').set('Idempotency-Key', idem('bad-machine')).send({
      operationalOrderId: orders[0].id, plannedQuantity: orders[0].remainingQuantity,
      expectedOrderVersion: orders[0].rowVersion,
      machineId: 'does-not-exist', shift: 'D', scheduledStartDate: '2027-09-02T08:00:00', ...HEADER,
    });
    expect(r.status).toBe(422);
  });

  it('denies an Operator from scheduling (403)', async () => {
    const r = await request(app).post('/api/plans').set('x-dev-user', 'EMP-007')
      .send({ operationalOrderId: 'x', plannedQuantity: '1', machineId: 'y', scheduledStartDate: '2027-09-01', ...HEADER });
    expect(r.status).toBe(403);
  });

  it('keeps split-machine quantity and source state in the operational queue', async () => {
    const suffix = Date.now().toString(36);
    const created = await request(app).post('/api/operational-orders')
      .set('Idempotency-Key', `split-order-${suffix}`)
      .send({
        orderNumber: `OP-SPLIT-${suffix}`, sourceType: 'forecast', productName: 'Split planning test',
        quantity: '100.5', uom: 'kg', dueDate: '2027-06-01', priority: 'medium',
      });
    expect(created.status).toBe(201);
    const machines = (await request(app).get('/api/machines')).body as Array<{ id: string; code: string; plantCode: string }>;
    const machine = machines.find((candidate) => candidate.plantCode === created.body.plantCode);
    expect(machine).toBeTruthy();
    const plan = await request(app).post('/api/plans').set('Idempotency-Key', idem('split-plan')).send({
      operationalOrderId: created.body.id, plannedQuantity: '40.25', machineId: machine!.id,
      expectedOrderVersion: created.body.rowVersion,
      shift: 'D', operatorName: 'Nandlal', scheduledStartDate: '2027-05-20T08:00:00',
      scheduledEndDate: '2027-05-20T20:00:00', ...HEADER,
    });
    expect(plan.status).toBe(201);
    expect(plan.body.plannedQuantity).toBe('40.25');

    const queued = (await pendingOrders()).find((order) => order.id === created.body.id);
    expect(queued).toMatchObject({
      status: 'partially_planned', plannedQuantity: '40.25', remainingQuantity: '60.25', sourceLinkState: 'independent',
    });

    const released = await request(app).post(`/api/plans/${plan.body.id}/release`).set('Idempotency-Key', idem('split-release')).send({ expectedVersion: plan.body.version });
    expect(released.status).toBe(200);
  });

  it('accepts an immutable MesaERP snapshot once and marks later source changes stale', async () => {
    const suffix = Date.now().toString(36);
    const snapshot = {
      orderNumber: `ERP-SO-${suffix}`, customerName: 'Snapshot customer', productCode: 'FG-SNAP',
      productName: 'Snapshot product', quantity: '75.5', uom: 'kg', dueDate: '2027-07-01',
      priority: 'high' as const, requirements: { grade: 'A' }, plantCode: 'PRIMARY',
    };
    const body = {
      eventId: `erp-event-${suffix}-1`, correlationId: `erp-correlation-${suffix}`,
      sourceId: `erp-sales-order-${suffix}`, sourceSnapshotHash: hashCanonical(snapshot), snapshot,
    };
    const accepted = await request(app).post('/api/operational-orders/handoffs/mesaerp').set(signMesaErpToOpsHandoff('org-demo', body)).send(body);
    expect(accepted.status).toBe(201);
    expect(accepted.body.status).toBe('accepted');
    expect(accepted.body.operationalOrder).toMatchObject({ sourceType: 'mesaerp', sourceLinkState: 'linked' });

    const replay = await request(app).post('/api/operational-orders/handoffs/mesaerp').set(signMesaErpToOpsHandoff('org-demo', body)).send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe('replayed');
    expect(replay.body.operationalOrder.id).toBe(accepted.body.operationalOrder.id);

    const changedSnapshot = { ...snapshot, quantity: '80' };
    const changedBody = {
      ...body, eventId: `erp-event-${suffix}-2`, sourceSnapshotHash: hashCanonical(changedSnapshot), snapshot: changedSnapshot,
    };
    const changed = await request(app).post('/api/operational-orders/handoffs/mesaerp').set(signMesaErpToOpsHandoff('org-demo', changedBody)).send(changedBody);
    expect(changed.status).toBe(409);
    expect(changed.body).toMatchObject({ status: 'conflict', reason: 'source_snapshot_changed' });

    const queued = (await pendingOrders()).find((order) => order.id === accepted.body.operationalOrder.id);
    expect(queued?.sourceLinkState).toBe('stale');
  });

  it('rejects a normal user attempting to forge a MesaERP source assertion', async () => {
    const body = {
      eventId: `erp-event-unsigned-${Date.now()}`,
      correlationId: `erp-correlation-unsigned-${Date.now()}`,
      sourceId: 'erp-sales-order-unsigned',
      sourceSnapshotHash: hashCanonical({ orderNumber: 'X', productName: 'X', quantity: '1', uom: 'kg', priority: 'medium', requirements: {} }),
      snapshot: { orderNumber: 'X', productName: 'X', quantity: '1', uom: 'kg', priority: 'medium', requirements: {} },
    };
    const response = await request(app).post('/api/operational-orders/handoffs/mesaerp').send(body);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('invalid_handoff_signature');
  });

  it('lets a planner accept only the immutable MesaERP event stored in the outbox', async () => {
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const snapshot = {
      orderNumber: `ERP-PD-${suffix}`, customerName: 'Durable outbox customer', productCode: 'FG-OUTBOX',
      productName: 'Durable outbox product', quantity: '22.75', uom: 'kg', dueDate: '2027-08-01',
      priority: 'medium' as const, requirements: { demandType: 'replenishment' }, plantCode: 'PRIMARY',
    };
    const body = {
      eventId: `erp-outbox-event-${suffix}`,
      correlationId: `erp-outbox-correlation-${suffix}`,
      sourceId: `erp-production-demand-${suffix}`,
      sourceSnapshotHash: hashCanonical(snapshot),
      snapshot,
    };
    await withTenant('org-demo', (tx) => tx.integrationOutboxEvent.create({
      data: {
        id: body.eventId,
        organizationId: 'org-demo',
        serviceId: 'mesaerp',
        aggregateType: 'ErpProductionDemand',
        aggregateId: body.sourceId,
        eventType: 'mesaerp.production-demand.released.v1',
        correlationId: body.correlationId,
        payload: body,
        payloadHash: hashCanonical(body),
      },
    }));

    const inbox = await request(app).get('/api/operational-orders/handoffs/mesaerp');
    expect(inbox.status).toBe(200);
    expect(inbox.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: body.eventId, sourceSnapshotHash: body.sourceSnapshotHash, state: 'unlinked' }),
    ]));

    const accepted = await request(app)
      .post(`/api/operational-orders/handoffs/mesaerp/${body.eventId}/accept`)
      .set('Idempotency-Key', `accept-outbox-${suffix}`)
      .send({ expectedSourceSnapshotHash: body.sourceSnapshotHash });
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({
      status: 'accepted',
      operationalOrder: { orderNumber: snapshot.orderNumber, sourceType: 'mesaerp', sourceLinkState: 'linked' },
    });

    const stale = await request(app)
      .post(`/api/operational-orders/handoffs/mesaerp/${body.eventId}/accept`)
      .set('Idempotency-Key', `accept-outbox-stale-${suffix}`)
      .send({ expectedSourceSnapshotHash: '0'.repeat(64) });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('handoff_source_changed');

    const replay = await request(app)
      .post(`/api/operational-orders/handoffs/mesaerp/${body.eventId}/accept`)
      .set('Idempotency-Key', `accept-outbox-replay-${suffix}`)
      .send({ expectedSourceSnapshotHash: body.sourceSnapshotHash });
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe('replayed');
  });

  it('filters machine and planning access once an explicit MesaOps plant assignment exists', async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const plantCode = `PLANT-A-${suffix}`;
    const hiddenPlantCode = `PLANT-B-${suffix}`;
    const hiddenLot = `LOT-B-${suffix}`;
    const hiddenInspectedLot = `LOT-B-I-${suffix}`;
    const hiddenMaterial = `Hidden resin ${suffix}`;
    const fixture = await withTenant('org-demo', async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { organizationId: 'org-demo', name: 'Administrator' } });
      const user = await tx.user.create({
        data: { email: `plant-scope-${suffix.toLowerCase()}@fixture.invalid`, name: 'Plant Scope Fixture' },
      });
      const membership = await tx.membership.create({
        data: {
          organizationId: 'org-demo', userId: user.id, employeeCode: `SCOPE-${suffix}`,
          department: 'Administration', role: role.name, roleId: role.id, status: 'active',
        },
      });
      const assignment = await tx.roleAssignment.create({
        data: { organizationId: 'org-demo', membershipId: membership.id, roleId: role.id, serviceId: 'mesaops', plantCode },
      });
      const template = await tx.logbookTemplate.findFirstOrThrow();
      const customer = await tx.customer.findFirstOrThrow();
      const machine = await tx.machine.create({
        data: { organizationId: 'org-demo', plantCode: hiddenPlantCode, code: `B${suffix}`.slice(0, 16), line: 'Hidden plant B line', family: 'PVC' },
      });
      const order = await tx.operationalOrder.create({
        data: {
          organizationId: 'org-demo', plantCode: hiddenPlantCode, orderNumber: `OP-B-${suffix}`,
          sourceType: 'local_customer', customerId: customer.id, customerName: customer.name,
          productName: 'Hidden plant B product', quantity: '10', uom: 'kg', status: 'planned',
        },
      });
      const plan = await tx.productionPlan.create({
        data: {
          organizationId: 'org-demo', operationalOrderId: order.id, machineId: machine.id,
          plannedQuantity: '10', shift: 'D', scheduledStartDate: '2099-11-20T08:00:00',
          status: 'running', supervisor: 'Plant B', drawingNo: 'B', formulaNo: 'B', moldNo: 'B', productName: order.productName,
        },
      });
      const logbook = await tx.machineLogbook.create({
        data: {
          organizationId: 'org-demo', productionPlanId: plan.id, templateId: template.id,
          status: 'submitted', machineId: machine.code, date: '2099-11-20', shift: 'D', productName: order.productName,
          coilWeights: [], totalRollsProduced: '1', totalRollKgs: '10',
          traceabilityRows: [{ lotNumber: hiddenLot, colour: 'Black', code: 'B', winderPackedBy: 'Plant B' }],
        },
      });
      const inspection = await tx.qualityInspection.create({
        data: { organizationId: 'org-demo', plantCode: hiddenPlantCode, rollNumber: hiddenInspectedLot, lotNumber: hiddenInspectedLot, decision: 'hold', remarks: 'Hidden Plant B hold', weight: 10 },
      });
      const inventory = await tx.inventoryTransaction.create({
        data: {
          organizationId: 'org-demo', plantCode: hiddenPlantCode, type: 'raw_material', direction: 'in',
          itemCode: `RM-B-${suffix}`, itemName: hiddenMaterial, quantity: 100, unit: 'kg', date: '2099-11-20', handler: 'Plant B',
        },
      });
      const maintenance = await tx.maintenanceTask.create({
        data: { organizationId: 'org-demo', machineId: machine.id, taskName: `Hidden maintenance ${suffix}`, type: 'Preventive', dueDate: '2099-11-21' },
      });
      const dispatch = await tx.dispatchRecord.create({
        data: {
          organizationId: 'org-demo', operationalOrderId: order.id, invoiceNumber: `NON-TAX-B-${suffix}`,
          gatePassNumber: `GP-B-${suffix}`, quantity: '1', uom: 'kg', dispatchDate: '2099-11-20',
          evidenceSnapshot: { policy: 'test-plant-isolation', dispatchQuantity: '1' }, evidenceHash: hashCanonical({ policy: 'test-plant-isolation', dispatchQuantity: '1' }),
        },
      });
      const complaint = await tx.complaint.create({
        data: {
          organizationId: 'org-demo', customerId: customer.id, complaintNumber: `C-B-${suffix}`,
          batchNumber: dispatch.invoiceNumber, product: order.productName, description: 'Hidden Plant B complaint', status: 'investigating',
        },
      });
      const capa = await tx.cAPARecord.create({
        data: { organizationId: 'org-demo', complaintId: complaint.id, rootCause: '', correctiveAction: '', preventiveAction: '', status: 'open' },
      });
      await tx.complaint.update({ where: { id: complaint.id }, data: { capaId: capa.id } });
      return { machine, order, plan, logbook, inspection, inventory, maintenance, dispatch, complaint, capa, assignment, membership, user };
    });
    const scoped = request.agent(app).set('x-dev-user', fixture.membership.employeeCode);
    let machineId = '';
    try {
      const hidden = await scoped.get('/api/machines');
      expect(hidden.status).toBe(200);
      expect(hidden.body).toHaveLength(0);
      const created = await scoped.post('/api/machines').send({ code: `S${Date.now().toString(36)}`.slice(0, 16), plantCode, line: 'Scoped line', family: 'PVC' });
      expect(created.status).toBe(201);
      machineId = created.body.id;
      const visible = await scoped.get('/api/machines');
      expect(visible.body).toHaveLength(1);
      expect(visible.body[0].plantCode).toBe(plantCode);

      const plans = await scoped.get('/api/plans');
      expect(plans.body.some((plan: { id: string }) => plan.id === fixture.plan.id)).toBe(false);
      const tasks = await scoped.get('/api/logbook/tasks');
      expect(tasks.body.some((group: { machine: string }) => group.machine === fixture.machine.code)).toBe(false);
      expect((await scoped.get('/api/logbook/machine-hub').query({ machine: fixture.machine.code })).status).toBe(404);
      expect((await scoped.get('/api/logbook/resolve').query({ machine: fixture.machine.code })).status).toBe(404);
      expect((await scoped.get(`/api/logbooks/plan/${fixture.plan.id}`)).body).toBeNull();
      expect((await scoped.patch(`/api/logbooks/${fixture.logbook.id}`).send({ operatorSignature: 'forged' })).status).toBe(404);
      expect((await scoped.post(`/api/logbooks/${fixture.logbook.id}/submit`)).status).toBe(404);
      expect((await scoped.patch(`/api/plans/${fixture.plan.id}`)
        .set('Idempotency-Key', `hidden-plan-patch-${suffix}`)
        .send({ expectedVersion: fixture.plan.version, moldNo: 'forged' })).status).toBe(404);
      expect((await scoped.post(`/api/plans/${fixture.plan.id}/release`)
        .set('Idempotency-Key', `hidden-plan-release-${suffix}`)
        .send({ expectedVersion: fixture.plan.version })).status).toBe(404);

      const queue = await scoped.get('/api/quality/queue');
      expect(queue.body.some((row: { lotNumber: string }) => row.lotNumber === hiddenLot)).toBe(false);
      const inspections = await scoped.get('/api/quality/inspections');
      expect(inspections.body.some((row: { id: string }) => row.id === fixture.inspection.id)).toBe(false);
      expect((await scoped.post('/api/quality/inspections').send({ lotNumber: hiddenLot, decision: 'pass', weight: 10 })).status).toBe(422);

      const transactions = await scoped.get('/api/inventory/transactions');
      expect(transactions.body.some((row: { id: string }) => row.id === fixture.inventory.id)).toBe(false);
      const stock = await scoped.get('/api/inventory/stock');
      expect(stock.body.rawMaterials.some((row: { itemName: string }) => row.itemName === hiddenMaterial)).toBe(false);
      expect((await scoped.post('/api/inventory/issue').send({ itemName: hiddenMaterial, quantity: 1, unit: 'kg', machineId: fixture.machine.id })).status).toBe(422);

      const maintenance = await scoped.get('/api/maintenance');
      expect(maintenance.body.some((row: { id: string }) => row.id === fixture.maintenance.id)).toBe(false);
      expect((await scoped.post(`/api/maintenance/${fixture.maintenance.id}/complete`)).status).toBe(404);

      expect((await scoped.get('/api/complaints/batches')).body.some((row: { id: string }) => row.id === fixture.dispatch.id)).toBe(false);
      expect((await scoped.get('/api/complaints')).body.some((row: { id: string }) => row.id === fixture.complaint.id)).toBe(false);
      expect((await scoped.get('/api/capas')).body.some((row: { id: string }) => row.id === fixture.capa.id)).toBe(false);
      expect((await scoped.post('/api/complaints').send({ salesOrderId: fixture.order.id, severity: 'low', description: 'forged' })).status).toBe(422);
      expect((await scoped.patch(`/api/capas/${fixture.capa.id}`).send({ rootCause: 'forged' })).status).toBe(404);
      expect((await scoped.post(`/api/capas/${fixture.capa.id}/close`)).status).toBe(404);
      expect((await scoped.post(`/api/complaints/${fixture.complaint.id}/resolve`)).status).toBe(404);
      const overview = await scoped.get('/api/management/overview');
      expect(overview.status).toBe(200);
      expect(JSON.stringify(overview.body)).not.toContain('Hidden Plant B');
    } finally {
      // Remove the explicit scope first so an immutable-evidence cleanup failure
      // cannot leak plant-restricted access into later integration tests.
      await withTenant('org-demo', async (tx) => {
        await tx.roleAssignment.delete({ where: { id: fixture.assignment.id } });
      });

      await withTenant('org-demo', async (tx) => {
        if (machineId) await tx.machine.delete({ where: { id: machineId } });
        await tx.cAPARecord.delete({ where: { id: fixture.capa.id } });
        await tx.complaint.delete({ where: { id: fixture.complaint.id } });
        await tx.dispatchRecord.delete({ where: { id: fixture.dispatch.id } });
        // QualityInspection is append-only evidence; the disposable test
        // database is dropped after the suite instead of deleting this row.
        await tx.inventoryTransaction.delete({ where: { id: fixture.inventory.id } });
        await tx.maintenanceTask.delete({ where: { id: fixture.maintenance.id } });
        await tx.machineLogbook.delete({ where: { id: fixture.logbook.id } });
        await tx.productionPlan.delete({ where: { id: fixture.plan.id } });
        await tx.operationalOrder.delete({ where: { id: fixture.order.id } });
        await tx.machine.delete({ where: { id: fixture.machine.id } });
        await tx.membership.delete({ where: { id: fixture.membership.id } });
        await tx.user.delete({ where: { id: fixture.user.id } });
      });
    }
  });
});
