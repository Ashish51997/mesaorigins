import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalHash } from './canonical';
import { IntegrationOutboxWorker } from './integrationOutboxWorker';
import { tenantContext } from './tenantContext';
import { acceptMesaErpOperationalOrder } from '../modules/planning/service';
import { mesaErpOperationalOrderHandoffSchema } from '../modules/planning/schemas';
import { basePrisma } from '../db';

const enabled = process.env.RUN_MESAERP_DB_INTEGRATION === '1' && Boolean(process.env.DIRECT_DATABASE_URL);
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const run = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const orgA = `outbox-worker-a-${run}`;
const orgB = `outbox-worker-b-${run}`;
const entityA = `outbox-worker-entity-a-${run}`;
const entityB = `outbox-worker-entity-b-${run}`;
const plannerUserId = `outbox-worker-planner-user-${run}`;
const plannerMembershipId = `outbox-worker-planner-${run}`;
const plannerRoleId = `outbox-worker-planner-role-${run}`;
const fixedNow = new Date('2026-08-14T12:00:00.000Z');

async function ensureEventServices() {
  await direct.service.upsert({
    where: { id: 'mesaops' },
    create: { id: 'mesaops', name: 'MesaOps', status: 'active' },
    update: { status: 'active' },
  });
  await direct.service.upsert({
    where: { id: 'mesaerp' },
    create: { id: 'mesaerp', name: 'MesaERP', status: 'active' },
    update: { status: 'active' },
  });
}

async function createErpRelease(organizationId: string, legalEntityId: string, suffix: string) {
  const eventId = randomUUID();
  const correlationId = randomUUID();
  const sourceId = `demand-${suffix}`;
  const snapshot = {
    orderNumber: `PD-${suffix}`,
    plantCode: 'PRIMARY',
    customerName: 'Worker test customer',
    productCode: 'FG-WORKER',
    productName: 'Worker test product',
    quantity: '10',
    uom: 'KG',
    dueDate: '2026-08-20',
    priority: 'medium',
    requirements: { test: true },
    legalEntityId,
  };
  const payload = { eventId, correlationId, sourceId, sourceSnapshotHash: canonicalHash(snapshot), snapshot };
  return direct.integrationOutboxEvent.create({
    data: {
      id: eventId,
      organizationId,
      legalEntityId,
      serviceId: 'mesaerp',
      aggregateType: 'ErpProductionDemand',
      aggregateId: sourceId,
      eventType: 'mesaerp.production-demand.released.v1',
      schemaVersion: 1,
      correlationId,
      payload: payload as Prisma.InputJsonValue,
      payloadHash: canonicalHash(payload),
      occurredAt: fixedNow,
    },
  });
}

async function createMesaOpsEvent(input: {
  organizationId: string;
  legalEntityId: string | null;
  suffix: string;
  eventType?: 'mesaops.production-actuals.submitted.v1' | 'mesaops.qa-disposition.recorded.v1' | 'mesaops.physical-dispatch.completed.v1';
}) {
  const eventId = randomUUID();
  const correlationId = randomUUID();
  const aggregateId = `ops-aggregate-${input.suffix}`;
  const eventType = input.eventType ?? 'mesaops.qa-disposition.recorded.v1';
  const snapshot = {
    businessDate: '2026-08-14',
    inspectionId: `inspection-${input.suffix}`,
    operationalOrderId: `operational-order-${input.suffix}`,
    productCode: 'FG-WORKER',
    lotNumber: `LOT-${input.suffix}`,
    quantity: '10',
    uom: 'KG',
    disposition: 'pass',
  };
  const payload = {
    eventId,
    eventType,
    schemaVersion: 1,
    sourceService: 'mesaops',
    organizationId: input.organizationId,
    legalEntityId: input.legalEntityId,
    aggregateType: 'QualityInspection',
    aggregateId,
    correlationId,
    occurredAt: fixedNow.toISOString(),
    sourceSnapshotHash: canonicalHash(snapshot),
    sourceLink: null,
    snapshot,
  };
  return direct.integrationOutboxEvent.create({
    data: {
      id: eventId,
      organizationId: input.organizationId,
      legalEntityId: input.legalEntityId,
      serviceId: 'mesaops',
      aggregateType: 'QualityInspection',
      aggregateId,
      eventType,
      schemaVersion: 1,
      correlationId,
      payload: payload as Prisma.InputJsonValue,
      payloadHash: canonicalHash(payload),
      occurredAt: fixedNow,
    },
  });
}

describe.skipIf(!enabled)('reliable integration outbox worker', () => {
  beforeAll(async () => {
    await ensureEventServices();
    await direct.organization.createMany({ data: [
      { id: orgA, name: 'Outbox Worker A', slug: orgA },
      { id: orgB, name: 'Outbox Worker B', slug: orgB },
    ] });
    await direct.organizationService.createMany({ data: [
      { organizationId: orgA, serviceId: 'mesaops', status: 'active' },
      { organizationId: orgA, serviceId: 'mesaerp', status: 'active' },
      { organizationId: orgB, serviceId: 'mesaops', status: 'active' },
      { organizationId: orgB, serviceId: 'mesaerp', status: 'active' },
    ] });
    await direct.legalEntity.createMany({ data: [
      { id: entityA, organizationId: orgA, code: `A-${run}`.slice(0, 40), legalName: 'Outbox Worker Company A' },
      { id: entityB, organizationId: orgB, code: `B-${run}`.slice(0, 40), legalName: 'Outbox Worker Company B' },
    ] });
    await direct.user.create({ data: { id: plannerUserId, email: `planner-${run}@example.test`, name: 'Outbox Worker Planner' } });
    await direct.role.create({ data: { id: plannerRoleId, organizationId: orgA, name: `Worker Planner ${run}`, screens: [] } });
    await direct.membership.create({ data: {
      id: plannerMembershipId,
      organizationId: orgA,
      userId: plannerUserId,
      employeeCode: `PLN-${run}`.slice(0, 80),
      department: 'Planning',
      role: 'Planner',
      roleId: plannerRoleId,
    } });
    await direct.roleAssignment.create({ data: {
      organizationId: orgA,
      membershipId: plannerMembershipId,
      roleId: plannerRoleId,
      serviceId: 'mesaops',
    } });
  });

  afterAll(async () => {
    await direct.$disconnect();
  });

  it('publishes an ERP demand once under concurrent workers and leaves human acceptance independent', async () => {
    const eventA = await createErpRelease(orgA, entityA, `a-${run}`);
    const eventB = await createErpRelease(orgB, entityB, `b-${run}`);
    const options = { organizationIds: [orgA], batchSize: 10, now: () => fixedNow };
    const workerA = new IntegrationOutboxWorker(direct, options);
    const workerB = new IntegrationOutboxWorker(direct, options);

    const results = await Promise.all([workerA.pollOnce(), workerB.pollOnce()]);
    expect(results.reduce((sum, result) => sum + result.eventsPublished, 0)).toBe(1);
    expect(await direct.integrationInboxReceipt.count({ where: { organizationId: orgA, consumer: 'mesaops', eventId: eventA.id } })).toBe(1);
    expect(await direct.integrationInboxReceipt.findFirst({ where: { organizationId: orgA, consumer: 'mesaops', eventId: eventA.id } })).toMatchObject({
      legalEntityId: entityA,
      payloadHash: eventA.payloadHash,
      status: 'received',
    });
    expect(await direct.operationalOrder.count({ where: { organizationId: orgA, createIdempotencyKey: eventA.id } })).toBe(0);
    expect(await direct.integrationOutboxEvent.findUnique({ where: { id: eventA.id } })).toMatchObject({ attempts: 1, lastError: '' });
    expect((await direct.integrationOutboxEvent.findUniqueOrThrow({ where: { id: eventA.id } })).publishedAt).not.toBeNull();

    const context = {
      organizationId: orgA,
      membershipId: plannerMembershipId,
      userId: plannerUserId,
      role: 'Planner',
      email: `planner-${run}@example.test`,
    };
    const handoff = mesaErpOperationalOrderHandoffSchema.parse(eventA.payload);
    const accepted = await Promise.all([
      tenantContext.run(context, () => acceptMesaErpOperationalOrder(handoff)),
      tenantContext.run(context, () => acceptMesaErpOperationalOrder(handoff)),
    ]);
    expect(accepted.map((result) => result.status).sort()).toEqual(['accepted', 'replayed']);
    expect(accepted.find((result) => result.operationalOrder)?.operationalOrder).toMatchObject({ sourceType: 'mesaerp', sourceLinkState: 'linked' });
    expect(await direct.integrationInboxReceipt.findFirst({ where: { organizationId: orgA, consumer: 'mesaops', eventId: eventA.id } })).toMatchObject({
      payloadHash: eventA.payloadHash,
      status: 'processed',
    });
    expect(await direct.sourceLink.findFirst({ where: { organizationId: orgA, sourceId: eventA.aggregateId } })).toMatchObject({
      legalEntityId: entityA,
      state: 'linked',
    });

    // A worker explicitly scoped to tenant A cannot claim tenant B's row.
    expect((await direct.integrationOutboxEvent.findUniqueOrThrow({ where: { id: eventB.id } })).publishedAt).toBeNull();
  });

  it('automatically creates durable MesaERP handoff inbox evidence without accepting the business event', async () => {
    const event = await createMesaOpsEvent({ organizationId: orgA, legalEntityId: entityA, suffix: `linked-${run}` });
    // Use the non-owner runtime role here: the worker must set one tenant GUC
    // before its RLS-protected claim, receipt and ERP inbox writes.
    const workerA = new IntegrationOutboxWorker(basePrisma, { organizationIds: [orgA], batchSize: 10, now: () => fixedNow });
    const workerB = new IntegrationOutboxWorker(basePrisma, { organizationIds: [orgA], batchSize: 10, now: () => fixedNow });

    const results = await Promise.all([workerA.pollOnce(), workerB.pollOnce()]);
    expect(results.reduce((sum, result) => sum + result.eventsPublished, 0)).toBeGreaterThanOrEqual(1);
    const inbox = await direct.erpHandoffInboxEvent.findFirstOrThrow({ where: { organizationId: orgA, legalEntityId: entityA, sourceEventId: event.id } });
    expect(inbox).toMatchObject({ state: 'received', payloadHash: event.payloadHash, receivedBy: 'system:integration-outbox' });
    expect(await direct.integrationInboxReceipt.findFirst({ where: { organizationId: orgA, consumer: `mesaerp:${entityA}`, eventId: event.id } })).toMatchObject({
      status: 'received',
      payloadHash: event.payloadHash,
    });
    expect((await direct.integrationOutboxEvent.findUniqueOrThrow({ where: { id: event.id } })).publishedAt).not.toBeNull();
  });

  it('keeps a company-less event pending with exponential retry until an approved route exists', async () => {
    const event = await createMesaOpsEvent({ organizationId: orgA, legalEntityId: null, suffix: `route-${run}` });
    const worker = new IntegrationOutboxWorker(direct, {
      organizationIds: [orgA], batchSize: 10, retryBaseMs: 1_000, retryMaxMs: 10_000, now: () => fixedNow,
    });

    const first = await worker.pollOnce();
    expect(first.companyRouteRequired).toBe(1);
    expect(await direct.integrationOutboxEvent.findUnique({ where: { id: event.id } })).toMatchObject({
      publishedAt: null,
      attempts: 1,
      lastError: 'company_route_required',
      nextAttemptAt: new Date(fixedNow.getTime() + 1_000),
    });
    expect(await direct.integrationInboxReceipt.count({ where: { organizationId: orgA, eventId: event.id } })).toBe(0);

    await direct.integrationOutboxEvent.update({ where: { id: event.id }, data: { nextAttemptAt: null } });
    await worker.pollOnce();
    expect(await direct.integrationOutboxEvent.findUnique({ where: { id: event.id } })).toMatchObject({
      publishedAt: null,
      attempts: 2,
      lastError: 'company_route_required',
      nextAttemptAt: new Date(fixedNow.getTime() + 2_000),
    });

    const routingEvidence = { sourceEventId: event.id, targetLegalEntityId: entityA, reason: 'Approved worker test route' };
    await direct.erpHandoffEventRoute.create({
      data: {
        organizationId: orgA,
        legalEntityId: entityA,
        sourceEventId: event.id,
        sourcePayloadHash: event.payloadHash,
        reason: 'Approved worker test route',
        routingEvidence,
        evidenceHash: canonicalHash(routingEvidence),
        status: 'approved',
        createdBy: 'worker-test-maker',
        approvedBy: 'worker-test-checker',
        approvedAt: fixedNow,
      },
    });
    await direct.integrationOutboxEvent.update({ where: { id: event.id }, data: { nextAttemptAt: null } });
    const routed = await worker.pollOnce();
    expect(routed.eventsPublished).toBe(1);
    expect(await direct.erpHandoffInboxEvent.count({ where: { organizationId: orgA, legalEntityId: entityA, sourceEventId: event.id } })).toBe(1);
    expect((await direct.integrationOutboxEvent.findUniqueOrThrow({ where: { id: event.id } })).publishedAt).not.toBeNull();
  });

  it('exposes explicit start, health and graceful stop state', async () => {
    const worker = new IntegrationOutboxWorker(direct, { organizationIds: [orgA], pollIntervalMs: 60_000, now: () => fixedNow });
    expect(worker.healthSnapshot()).toMatchObject({ running: false, healthy: false, inFlight: false });
    worker.start();
    expect(worker.healthSnapshot()).toMatchObject({ running: true, healthy: true, startedAt: fixedNow.toISOString() });
    await worker.stop();
    expect(worker.healthSnapshot()).toMatchObject({ running: false, healthy: false, stoppedAt: fixedNow.toISOString() });
  });
});
