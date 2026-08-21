import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { sessionCookieName } from '../../auth/config';
import { basePrisma, withTenant } from '../../db';
import { canonicalHash } from '../../lib/canonical';
import { signMesaOpsStatutoryEvidence, type StatutoryEvidenceCore } from './statutory';

// Integration tests against a live Postgres (seeded demo tenant). Local flows
// use the development Administrator; production-only assertions use a real
// short-lived database session. Self-contained: drives an order end to end.
const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 7);
const idem = (prefix: string) => `${prefix}-${Date.now()}-${uniq()}`;

async function order(): Promise<string> {
  const c = await request(app).post('/api/mesaops/v1/customers').send({ name: `D ${uniq()}`, deliveryAddress: 'Plot 4, Peenya' });
  const inq = await request(app).post('/api/mesaops/v1/inquiries').send({ customerId: c.body.id, product: 'RPVC roll', quantity: 500, expectedDeliveryDate: '2026-10-01' });
  await request(app).post(`/api/mesaops/v1/inquiries/${inq.body.id}/quote`).send({ quotationPrice: 40 });
  return (await request(app).post('/api/mesaops/v1/orders').send({ inquiryId: inq.body.id })).body.id;
}

async function produce(orderId: string, machineCode: string, day: string, plantCode = 'PRIMARY'): Promise<void> {
  const createdMachine = await request(app).post('/api/mesaops/v1/machines').send({
    plantCode, code: `${machineCode}${uniq()}`.slice(0, 16), line: 'Dispatch evidence test', family: 'PVC', status: 'running',
  });
  const machineId = createdMachine.body.id as string;
  const plan = await request(app).post('/api/mesaops/v1/plans').set('Idempotency-Key', idem('dispatch-plan')).send({ operationalOrderId: orderId, expectedOrderVersion: 0, machineId, shift: 'D', scheduledStartDate: `${day}T08:00:00`, supervisor: 'Nandlal', drawingNo: 'DRW-1', formulaNo: 'RF03 · Rev 2', moldNo: 'MLD-1', productName: 'RPVC' });
  const lb = await request(app).post('/api/mesaops/v1/logbooks').send({ productionPlanId: plan.body.id });
  const lot = `LOT-DSP-${uniq()}`;
  await request(app).patch(`/api/mesaops/v1/logbooks/${lb.body.id}`).send({ operatorSignature: 'Nandlal', supervisorSignature: 'Nandlal', totalRollsProduced: '500', traceabilityRows: [{ lotNumber: lot, quantity: '500', winderPackedBy: 'x' }] });
  await request(app).post(`/api/mesaops/v1/logbooks/${lb.body.id}/submit`);
  const inspection = await request(app).post('/api/mesaops/v1/quality/inspections').send({ lotNumber: lot, decision: 'pass', weight: 500 });
  expect(inspection.status).toBe(201);
}

async function independentOrder(plantCode: string): Promise<string> {
  const suffix = uniq();
  const created = await request(app).post('/api/mesaops/v1/operational-orders')
    .set('Idempotency-Key', idem('dispatch-independent-order'))
    .send({
      orderNumber: `DSP-${Date.now()}-${suffix}`,
      plantCode,
      sourceType: 'local_customer',
      customerName: 'Dispatch evidence fixture',
      productCode: 'RPVC-TEST',
      productName: 'RPVC roll',
      quantity: '500',
      uom: 'units',
      dueDate: '2026-12-20',
    });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function approveStatutoryProfile(plantCode: string): Promise<string> {
  const suffix = `${Date.now()}-${uniq()}`;
  const sourceEvidence = { reviewedBy: 'statutory-test-checker', scope: { countryCode: 'IN', plantCode, movementType: 'supply' } };
  const created = await request(app).post('/api/mesaops/v1/admin/statutory-rule-profiles')
    .set('x-dev-user', 'EMP-002')
    .set('Idempotency-Key', `dispatch-profile-${suffix}`)
    .send({
      version: `DSP-${suffix}`,
      countryCode: 'IN',
      plantCode,
      movementType: 'supply',
      effectiveFrom: '2026-01-01',
      requiresInvoice: true,
      requiresEWayBill: true,
      reviewedExemptionReason: '',
      sourceReference: `test-review:${suffix}`,
      sourceEvidence,
      sourceChecksum: canonicalHash(sourceEvidence),
    });
  expect(created.status).toBe(201);
  const approved = await request(app).post(`/api/mesaops/v1/admin/statutory-rule-profiles/${created.body.id}/approve`)
    .set('x-dev-user', 'EMP-020')
    .set('Idempotency-Key', `dispatch-profile-approve-${suffix}`)
    .send({ expectedRowVersion: 0, approvalNote: 'Independent dispatch test review' });
  expect(approved.status).toBe(200);
  return approved.body.version as string;
}

function restoreEnvironment(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

async function inProduction<T>(work: (cookie: string) => Promise<T>): Promise<T> {
  const membership = await basePrisma.membership.findFirst({
    where: { organizationId: 'org-demo', employeeCode: 'EMP-002', status: 'active' },
    select: { userId: true },
  });
  expect(membership).toBeTruthy();

  const sessionToken = idem('dispatch-production-session');
  await basePrisma.session.create({
    data: { sessionToken, userId: membership!.userId, expires: new Date(Date.now() + 5 * 60_000) },
  });

  const previousNodeEnv = process.env.NODE_ENV;
  const previousDevAuth = process.env.DEV_AUTH;
  const previousAuthSecret = process.env.AUTH_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.DEV_AUTH = '0';
  process.env.AUTH_SECRET = 'dispatch-production-test-auth-secret-32-bytes';
  try {
    return await work(`${sessionCookieName()}=${sessionToken}`);
  } finally {
    restoreEnvironment('NODE_ENV', previousNodeEnv);
    restoreEnvironment('DEV_AUTH', previousDevAuth);
    restoreEnvironment('AUTH_SECRET', previousAuthSecret);
    await basePrisma.session.deleteMany({ where: { sessionToken } });
  }
}

describe('dispatch slice', () => {
  it('a produced order is ready, dispatches (order → dispatched, dispatch evidence, FG out)', async () => {
    const orderId = await order();
    await produce(orderId, 'M05', '2026-10-10');

    const ready = (await request(app).get('/api/mesaops/v1/dispatch/ready')).body as Array<{ id: string }>;
    expect(ready.some((o) => o.id === orderId)).toBe(true);

    const key = idem('dispatch');
    const body = { salesOrderId: orderId, quantity: '500', expectedOrderVersion: 1, vehicleNumber: 'KA-01-AB-1234', transporter: 'Blue Dart', driverName: 'Ravi' };
    const disp = await request(app).post('/api/mesaops/v1/dispatches').set('Idempotency-Key', key).send(body);
    expect(disp.status).toBe(201);
    expect(disp.body.invoiceNumber).toMatch(/^NON-TAX-DSP-\d{4}-\d+$/);
    expect(disp.body.quantity).toBe('500');

    const replay = await request(app).post('/api/mesaops/v1/dispatches').set('Idempotency-Key', key).send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(disp.body.id);
    const returnEvents = await withTenant('org-demo', (tx) => tx.integrationOutboxEvent.findMany({ where: {
      aggregateId: disp.body.id, eventType: 'mesaops.physical-dispatch.completed.v1',
    } }));
    expect(returnEvents).toHaveLength(1);
    expect(returnEvents[0].payloadHash).toBe(canonicalHash(returnEvents[0].payload));

    // It left the ready list…
    const ready2 = (await request(app).get('/api/mesaops/v1/dispatch/ready')).body as Array<{ id: string }>;
    expect(ready2.some((o) => o.id === orderId)).toBe(false);

    // …a finished-goods OUT movement was booked…
    const out = await withTenant('org-demo', (tx) => tx.inventoryTransaction.findMany({ where: { reference: `Dispatch ${disp.body.invoiceNumber}` } }));
    expect(out).toHaveLength(1);
    expect(out[0].direction).toBe('out');

    // …and re-dispatching is refused.
    const dupe = await request(app).post('/api/mesaops/v1/dispatches').set('Idempotency-Key', idem('dispatch-dupe')).send({ salesOrderId: orderId, quantity: '1', expectedOrderVersion: 2, vehicleNumber: 'X' });
    expect(dupe.status).toBe(409);
  });

  it('refuses to dispatch an order that is not produced yet (409)', async () => {
    const orderId = await order(); // no plan/logbook
    const r = await request(app).post('/api/mesaops/v1/dispatches').set('Idempotency-Key', idem('dispatch-not-ready')).send({ salesOrderId: orderId, quantity: '1', expectedOrderVersion: 0, vehicleNumber: 'X' });
    expect(r.status).toBe(409);
  });

  it('rejects quantity above the submitted, packed and QA-released evidence', async () => {
    const orderId = await order();
    await produce(orderId, 'M04', '2026-11-10');
    const response = await request(app).post('/api/mesaops/v1/dispatches')
      .set('Idempotency-Key', idem('dispatch-over-evidence'))
      .send({ salesOrderId: orderId, quantity: '500.000001', expectedOrderVersion: 1, vehicleNumber: 'KA-02-TEST' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('quantity_not_released');
  });

  it('denies a Sales Exec from the dispatch board (403)', async () => {
    const r = await request(app).get('/api/mesaops/v1/dispatch/ready').set('x-dev-user', 'EMP-003');
    expect(r.status).toBe(403);
  });

  it('fails closed in production when no approved statutory profile covers the plant movement', async () => {
    const plantCode = `MISS-${uniq()}`.toUpperCase();
    const orderId = await independentOrder(plantCode);
    await produce(orderId, 'MS', '2026-12-01', plantCode);
    const response = await inProduction((cookie) => request(app).post('/api/mesaops/v1/dispatches')
      .set('Cookie', cookie)
      .set('Idempotency-Key', idem('dispatch-profile-missing'))
      .send({ operationalOrderId: orderId, quantity: '500', expectedOrderVersion: 1, movementType: 'supply', vehicleNumber: 'KA01AB1234' }));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('statutory_rule_profile_missing');
  });

  it.each(['external_verified', 'mesaerp_snapshot'] as const)('dispatches independently with valid %s statutory evidence', async (source) => {
    const previousEvidenceKey = process.env.MESAORIGINS_OPS_STATUTORY_EVIDENCE_HMAC_KEY;
    process.env.MESAORIGINS_OPS_STATUTORY_EVIDENCE_HMAC_KEY = Buffer.alloc(32, 37).toString('base64');
    try {
      const plantCode = `${source === 'external_verified' ? 'EXT' : 'ERP'}-${uniq()}`.toUpperCase();
      const orderId = await independentOrder(plantCode);
      await produce(orderId, source === 'external_verified' ? 'EX' : 'ER', '2026-12-02', plantCode);
      const profileVersion = await approveStatutoryProfile(plantCode);
      const artifact = { invoice: `INV-${uniq()}`, eWayBill: '123456789012', verifiedSource: source };
      const core: StatutoryEvidenceCore = {
        source,
        profileVersion,
        verificationId: `verification-${Date.now()}-${uniq()}`,
        verifiedAt: '2026-08-14T10:00:00.000Z',
        invoiceReference: String(artifact.invoice),
        eWayBillReference: String(artifact.eWayBill),
        validUntil: '2099-08-14T10:00:00.000Z',
        artifactHash: canonicalHash(artifact),
        artifact,
      };
      const statutoryEvidence = {
        ...core,
        signature: signMesaOpsStatutoryEvidence('org-demo', orderId, core),
      };
      const response = await inProduction((cookie) => request(app).post('/api/mesaops/v1/dispatches')
        .set('Cookie', cookie)
        .set('Idempotency-Key', idem(`dispatch-${source}`))
        .send({
          operationalOrderId: orderId,
          quantity: '500',
          expectedOrderVersion: 1,
          movementType: 'supply',
          vehicleNumber: 'KA01AB1234',
          statutoryEvidence,
        }));
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        invoiceNumber: artifact.invoice,
        eWayBillNumber: artifact.eWayBill,
        statutoryRequired: true,
        statutoryProfileVersion: profileVersion,
      });
      expect(response.body.statutoryArtifact.source).toBe(source);
    } finally {
      restoreEnvironment('MESAORIGINS_OPS_STATUTORY_EVIDENCE_HMAC_KEY', previousEvidenceKey);
    }
  });
});
