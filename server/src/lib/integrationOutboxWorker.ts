import { Prisma, type IntegrationOutboxEvent, type PrismaClient } from '@prisma/client';
import { basePrisma } from '../db';
import { canonicalHash } from './canonical';
import { setIntegrationOutboxDrainHandler } from './integrationOutboxNotify';
import { mesaErpOperationalOrderHandoffSchema } from '../mesaops/planning/schemas';

const ERP_TO_OPS_EVENT = 'mesaerp.production-demand.released.v1';
const OPS_TO_ERP_EVENTS = [
  'mesaops.production-actuals.submitted.v1',
  'mesaops.qa-disposition.recorded.v1',
  'mesaops.physical-dispatch.completed.v1',
] as const;
const SUPPORTED_EVENT_TYPES = [ERP_TO_OPS_EVENT, ...OPS_TO_ERP_EVENTS] as const;
const WORKER_ACTOR = 'system:integration-outbox';

type SupportedEventType = typeof SUPPORTED_EVENT_TYPES[number];
type Tx = Prisma.TransactionClient;

interface JsonRecord {
  [key: string]: unknown;
}

interface MesaOpsEnvelope {
  eventId: string;
  eventType: typeof OPS_TO_ERP_EVENTS[number];
  schemaVersion: 1;
  organizationId: string;
  legalEntityId: string | null;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  occurredAt: string;
  sourceSnapshotHash: string;
  snapshot: JsonRecord;
}

interface DestinationEvidence {
  consumer: string;
  legalEntityId: string | null;
  acceptedPayloadHashes: string[];
  requireErpInbox: boolean;
}

class DeliveryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DeliveryError';
  }
}

export interface IntegrationOutboxWorkerOptions {
  batchSize?: number;
  pollIntervalMs?: number;
  /** When true, keep a poll timer. Production defaults to false (on-demand drain). */
  continuousPolling?: boolean;
  retryBaseMs?: number;
  retryMaxMs?: number;
  transactionTimeoutMs?: number;
  organizationIds?: readonly string[];
  now?: () => Date;
}

export interface IntegrationOutboxPollResult {
  organizationsVisited: number;
  organizationsLockSkipped: number;
  eventsClaimed: number;
  eventsPublished: number;
  eventsRetried: number;
  companyRouteRequired: number;
}

export interface IntegrationOutboxWorkerHealth {
  running: boolean;
  continuousPolling: boolean;
  inFlight: boolean;
  healthy: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  lastPollStartedAt: string | null;
  lastPollCompletedAt: string | null;
  lastSuccessfulPollAt: string | null;
  consecutivePollFailures: number;
  lastPollError: string;
  totalPublished: number;
  totalRetried: number;
  lastPoll: IntegrationOutboxPollResult | null;
}

interface MutableHealth {
  running: boolean;
  inFlight: boolean;
  startedAt: Date | null;
  stoppedAt: Date | null;
  lastPollStartedAt: Date | null;
  lastPollCompletedAt: Date | null;
  lastSuccessfulPollAt: Date | null;
  consecutivePollFailures: number;
  lastPollError: string;
  totalPublished: number;
  totalRetried: number;
  lastPoll: IntegrationOutboxPollResult | null;
}

const emptyPollResult = (): IntegrationOutboxPollResult => ({
  organizationsVisited: 0,
  organizationsLockSkipped: 0,
  eventsClaimed: 0,
  eventsPublished: 0,
  eventsRetried: 0,
  companyRouteRequired: 0,
});

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function normalizedError(error: unknown): string {
  if (error instanceof DeliveryError) return error.code;
  const databaseCode = (error as { code?: unknown } | null)?.code;
  if (typeof databaseCode === 'string' && /^[A-Z0-9]{4,10}$/.test(databaseCode)) {
    return `database_delivery_error:${databaseCode}`;
  }
  return 'unexpected_delivery_error';
}

function assertPayloadHash(event: IntegrationOutboxEvent): void {
  if (canonicalHash(event.payload) !== event.payloadHash) throw new DeliveryError('payload_hash_mismatch');
}

function assertErpReleaseEnvelope(event: IntegrationOutboxEvent) {
  assertPayloadHash(event);
  if (event.schemaVersion !== 1) throw new DeliveryError('unsupported_schema_version');
  const parsed = mesaErpOperationalOrderHandoffSchema.safeParse(event.payload);
  if (!parsed.success) throw new DeliveryError('handoff_payload_invalid');
  const envelope = parsed.data;
  if (
    envelope.eventId !== event.id
    || envelope.correlationId !== event.correlationId
    || envelope.sourceId !== event.aggregateId
    || canonicalHash(envelope.snapshot) !== envelope.sourceSnapshotHash
    || !event.legalEntityId
    || (envelope.snapshot.legalEntityId && envelope.snapshot.legalEntityId !== event.legalEntityId)
  ) throw new DeliveryError('handoff_event_identity_mismatch');
  return envelope;
}

function parseMesaOpsEnvelope(event: IntegrationOutboxEvent, targetLegalEntityId: string, explicitlyRouted: boolean): MesaOpsEnvelope {
  assertPayloadHash(event);
  const wrapper = record(event.payload);
  const snapshot = record(wrapper.snapshot);
  const eventType = String(wrapper.eventType ?? '') as MesaOpsEnvelope['eventType'];
  if (
    typeof wrapper.eventId !== 'string'
    || !OPS_TO_ERP_EVENTS.includes(eventType)
    || wrapper.schemaVersion !== 1
    || typeof wrapper.organizationId !== 'string'
    || (wrapper.legalEntityId !== null && typeof wrapper.legalEntityId !== 'string')
    || typeof wrapper.aggregateType !== 'string'
    || typeof wrapper.aggregateId !== 'string'
    || typeof wrapper.correlationId !== 'string'
    || typeof wrapper.occurredAt !== 'string'
    || typeof wrapper.sourceSnapshotHash !== 'string'
    || Object.keys(snapshot).length === 0
  ) throw new DeliveryError('handoff_payload_invalid');
  const envelope: MesaOpsEnvelope = {
    eventId: wrapper.eventId,
    eventType,
    schemaVersion: 1,
    organizationId: wrapper.organizationId,
    legalEntityId: wrapper.legalEntityId as string | null,
    aggregateType: wrapper.aggregateType,
    aggregateId: wrapper.aggregateId,
    correlationId: wrapper.correlationId,
    occurredAt: wrapper.occurredAt,
    sourceSnapshotHash: wrapper.sourceSnapshotHash,
    snapshot,
  };
  if (
    envelope.eventId !== event.id
    || envelope.organizationId !== event.organizationId
    || envelope.legalEntityId !== event.legalEntityId
    || (event.legalEntityId !== targetLegalEntityId && !(explicitlyRouted && event.legalEntityId === null))
    || envelope.aggregateType !== event.aggregateType
    || envelope.aggregateId !== event.aggregateId
    || envelope.eventType !== event.eventType
    || envelope.schemaVersion !== event.schemaVersion
    || envelope.correlationId !== event.correlationId
    || envelope.occurredAt !== event.occurredAt.toISOString()
    || canonicalHash(envelope.snapshot) !== envelope.sourceSnapshotHash
  ) throw new DeliveryError('handoff_event_identity_mismatch');
  return envelope;
}

async function ensureDestinationService(tx: Tx, organizationId: string, serviceId: 'mesaerp' | 'mesaops'): Promise<void> {
  const assignment = await tx.organizationService.findFirst({
    where: { organizationId, serviceId, status: 'active', service: { status: 'active' } },
    select: { serviceId: true },
  });
  if (!assignment) throw new DeliveryError(`destination_service_unavailable:${serviceId}`);
}

async function ensureActiveLegalEntity(tx: Tx, organizationId: string, legalEntityId: string): Promise<void> {
  const entity = await tx.legalEntity.findFirst({
    where: { id: legalEntityId, organizationId, status: 'active' },
    select: { id: true },
  });
  if (!entity) throw new DeliveryError('destination_company_unavailable');
}

async function ensureReceipt(
  tx: Tx,
  event: IntegrationOutboxEvent,
  input: {
    consumer: string;
    legalEntityId: string | null;
    status: 'received' | 'conflict';
    lastError: string;
    acceptedPayloadHashes?: string[];
  },
) {
  const existing = await tx.integrationInboxReceipt.findUnique({
    where: {
      organizationId_consumer_eventId: {
        organizationId: event.organizationId,
        consumer: input.consumer,
        eventId: event.id,
      },
    },
  });
  const acceptedPayloadHashes = input.acceptedPayloadHashes ?? [event.payloadHash];
  if (existing) {
    if (
      existing.eventType !== event.eventType
      || existing.legalEntityId !== input.legalEntityId
      || !acceptedPayloadHashes.includes(existing.payloadHash)
    ) throw new DeliveryError('destination_receipt_conflict');
    return existing;
  }
  return tx.integrationInboxReceipt.create({
    data: {
      organizationId: event.organizationId,
      legalEntityId: input.legalEntityId,
      consumer: input.consumer,
      eventId: event.id,
      eventType: event.eventType,
      payloadHash: event.payloadHash,
      status: input.status,
      attemptCount: 1,
      lastError: input.lastError,
    },
  });
}

async function deliverErpProductionDemand(tx: Tx, event: IntegrationOutboxEvent): Promise<DestinationEvidence> {
  await ensureDestinationService(tx, event.organizationId, 'mesaops');
  const envelope = assertErpReleaseEnvelope(event);
  await ensureActiveLegalEntity(tx, event.organizationId, event.legalEntityId!);
  const receipt = await ensureReceipt(tx, event, {
    consumer: 'mesaops',
    legalEntityId: event.legalEntityId,
    status: 'received',
    lastError: '',
    // Receipts created before the publisher existed retained only the immutable
    // source-snapshot hash. They remain valid after the destination link exists.
    acceptedPayloadHashes: [event.payloadHash, envelope.sourceSnapshotHash],
  });
  if (receipt.payloadHash === envelope.sourceSnapshotHash) {
    const legacyLink = await tx.sourceLink.findFirst({
      where: {
        organizationId: event.organizationId,
        sourceService: 'mesaerp',
        sourceType: { in: ['ProductionDemand', 'SalesOrder'] },
        sourceId: envelope.sourceId,
        destinationService: 'mesaops',
        destinationType: 'OperationalOrder',
        sourceSnapshotHash: envelope.sourceSnapshotHash,
        destinationId: { not: null },
      },
      select: { destinationId: true },
    });
    const destinationExists = legacyLink?.destinationId
      ? await tx.operationalOrder.findFirst({ where: { id: legacyLink.destinationId }, select: { id: true } })
      : null;
    if (receipt.status !== 'processed' || !destinationExists) {
      throw new DeliveryError('legacy_destination_receipt_incomplete');
    }
  }
  return {
    consumer: 'mesaops',
    legalEntityId: event.legalEntityId,
    acceptedPayloadHashes: [event.payloadHash, envelope.sourceSnapshotHash],
    requireErpInbox: false,
  };
}

async function resolveMesaErpTarget(tx: Tx, event: IntegrationOutboxEvent): Promise<{ legalEntityId: string; explicitlyRouted: boolean }> {
  if (event.legalEntityId) return { legalEntityId: event.legalEntityId, explicitlyRouted: false };
  const route = await tx.erpHandoffEventRoute.findFirst({
    where: {
      organizationId: event.organizationId,
      sourceEventId: event.id,
      sourcePayloadHash: event.payloadHash,
      status: 'approved',
    },
    select: { legalEntityId: true },
  });
  if (!route) throw new DeliveryError('company_route_required');
  return { legalEntityId: route.legalEntityId, explicitlyRouted: true };
}

async function deliverMesaOpsEvent(tx: Tx, event: IntegrationOutboxEvent): Promise<DestinationEvidence> {
  const target = await resolveMesaErpTarget(tx, event);
  await ensureDestinationService(tx, event.organizationId, 'mesaerp');
  await ensureActiveLegalEntity(tx, event.organizationId, target.legalEntityId);
  const envelope = parseMesaOpsEnvelope(event, target.legalEntityId, target.explicitlyRouted);
  const existing = await tx.erpHandoffInboxEvent.findFirst({
    where: { legalEntityId: target.legalEntityId, sourceEventId: event.id },
  });
  if (existing) {
    if (
      existing.organizationId !== event.organizationId
      || existing.eventType !== event.eventType
      || existing.schemaVersion !== event.schemaVersion
      || existing.aggregateType !== event.aggregateType
      || existing.aggregateId !== event.aggregateId
      || existing.correlationId !== event.correlationId
      || existing.payloadHash !== event.payloadHash
      || existing.sourceSnapshotHash !== envelope.sourceSnapshotHash
      || canonicalHash(existing.payload) !== event.payloadHash
    ) throw new DeliveryError('destination_erp_inbox_conflict');
  } else {
    const aggregateConflict = await tx.erpHandoffInboxEvent.findFirst({
      where: {
        legalEntityId: target.legalEntityId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        sourceEventId: { not: event.id },
      },
      select: { id: true },
    });
    await tx.erpHandoffInboxEvent.create({
      data: {
        organizationId: event.organizationId,
        legalEntityId: target.legalEntityId,
        sourceEventId: event.id,
        sourceService: 'mesaops',
        eventType: event.eventType,
        schemaVersion: event.schemaVersion,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        correlationId: event.correlationId,
        occurredAt: event.occurredAt,
        sourceSnapshotHash: envelope.sourceSnapshotHash,
        payloadHash: event.payloadHash,
        payload: json(event.payload),
        state: aggregateConflict ? 'conflict' : 'received',
        exceptionCode: aggregateConflict ? 'aggregate_event_conflict' : '',
        exceptionDetails: aggregateConflict ? { conflictingInboxId: aggregateConflict.id } : {},
        attemptCount: 0,
        receivedBy: WORKER_ACTOR,
      },
    });
  }
  const inbox = await tx.erpHandoffInboxEvent.findFirstOrThrow({
    where: { legalEntityId: target.legalEntityId, sourceEventId: event.id },
    select: { id: true, state: true, exceptionCode: true },
  });
  await ensureReceipt(tx, event, {
    consumer: `mesaerp:${target.legalEntityId}`,
    legalEntityId: target.legalEntityId,
    status: inbox.state === 'conflict' ? 'conflict' : 'received',
    lastError: inbox.exceptionCode,
  });
  return {
    consumer: `mesaerp:${target.legalEntityId}`,
    legalEntityId: target.legalEntityId,
    acceptedPayloadHashes: [event.payloadHash],
    requireErpInbox: true,
  };
}

async function assertDestinationEvidence(tx: Tx, event: IntegrationOutboxEvent, evidence: DestinationEvidence): Promise<void> {
  const receipt = await tx.integrationInboxReceipt.findUnique({
    where: {
      organizationId_consumer_eventId: {
        organizationId: event.organizationId,
        consumer: evidence.consumer,
        eventId: event.id,
      },
    },
  });
  if (
    !receipt
    || receipt.legalEntityId !== evidence.legalEntityId
    || receipt.eventType !== event.eventType
    || !evidence.acceptedPayloadHashes.includes(receipt.payloadHash)
  ) throw new DeliveryError('destination_receipt_missing');
  if (evidence.requireErpInbox) {
    const inbox = await tx.erpHandoffInboxEvent.findFirst({
      where: { legalEntityId: evidence.legalEntityId!, sourceEventId: event.id, payloadHash: event.payloadHash },
      select: { id: true },
    });
    if (!inbox) throw new DeliveryError('destination_erp_inbox_missing');
  }
}

async function deliverEvent(tx: Tx, event: IntegrationOutboxEvent): Promise<DestinationEvidence> {
  if (event.serviceId === 'mesaerp' && event.eventType === ERP_TO_OPS_EVENT) {
    return deliverErpProductionDemand(tx, event);
  }
  if (event.serviceId === 'mesaops' && OPS_TO_ERP_EVENTS.includes(event.eventType as typeof OPS_TO_ERP_EVENTS[number])) {
    return deliverMesaOpsEvent(tx, event);
  }
  throw new DeliveryError('unsupported_event_contract');
}

export class IntegrationOutboxWorker {
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly continuousPolling: boolean;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly transactionTimeoutMs: number;
  private readonly organizationIds?: readonly string[];
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private activePoll: Promise<IntegrationOutboxPollResult> | null = null;
  private organizationOffset = 0;
  private health: MutableHealth = {
    running: false,
    inFlight: false,
    startedAt: null,
    stoppedAt: null,
    lastPollStartedAt: null,
    lastPollCompletedAt: null,
    lastSuccessfulPollAt: null,
    consecutivePollFailures: 0,
    lastPollError: '',
    totalPublished: 0,
    totalRetried: 0,
    lastPoll: null,
  };

  constructor(
    private readonly db: PrismaClient = basePrisma,
    options: IntegrationOutboxWorkerOptions = {},
  ) {
    this.batchSize = Math.min(Math.max(options.batchSize ?? 25, 1), 250);
    this.pollIntervalMs = Math.max(options.pollIntervalMs ?? 2_000, 100);
    this.continuousPolling = options.continuousPolling
      ?? (process.env.INTEGRATION_OUTBOX_CONTINUOUS_POLLING === '1'
        || (process.env.INTEGRATION_OUTBOX_CONTINUOUS_POLLING !== '0'
          && process.env.NODE_ENV !== 'production'));
    this.retryBaseMs = Math.max(options.retryBaseMs ?? 5_000, 100);
    this.retryMaxMs = Math.max(options.retryMaxMs ?? 15 * 60_000, this.retryBaseMs);
    this.transactionTimeoutMs = Math.max(options.transactionTimeoutMs ?? 7_000, 1_000);
    this.organizationIds = options.organizationIds?.length ? [...new Set(options.organizationIds)] : undefined;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.health.running) return;
    this.health.running = true;
    this.health.startedAt = this.now();
    this.health.stoppedAt = null;
    if (this.continuousPolling) {
      this.schedule(0);
      return;
    }
    // Production / on-demand: one drain at boot; further drains are scheduled
    // after IntegrationOutboxEvent inserts so Neon can scale to zero when idle.
    void this.pollOnce().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.health.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.activePoll?.catch(() => undefined);
    this.health.stoppedAt = this.now();
  }

  healthSnapshot(): IntegrationOutboxWorkerHealth {
    return {
      running: this.health.running,
      continuousPolling: this.continuousPolling,
      inFlight: this.health.inFlight,
      healthy: this.health.running && this.health.consecutivePollFailures === 0,
      startedAt: iso(this.health.startedAt),
      stoppedAt: iso(this.health.stoppedAt),
      lastPollStartedAt: iso(this.health.lastPollStartedAt),
      lastPollCompletedAt: iso(this.health.lastPollCompletedAt),
      lastSuccessfulPollAt: iso(this.health.lastSuccessfulPollAt),
      consecutivePollFailures: this.health.consecutivePollFailures,
      lastPollError: this.health.lastPollError,
      totalPublished: this.health.totalPublished,
      totalRetried: this.health.totalRetried,
      lastPoll: this.health.lastPoll ? { ...this.health.lastPoll } : null,
    };
  }

  pollOnce(): Promise<IntegrationOutboxPollResult> {
    if (this.activePoll) return this.activePoll;
    this.health.inFlight = true;
    this.health.lastPollStartedAt = this.now();
    this.activePoll = this.runPoll().then((result) => {
      this.health.lastPoll = { ...result };
      this.health.lastSuccessfulPollAt = this.now();
      this.health.consecutivePollFailures = 0;
      this.health.lastPollError = '';
      this.health.totalPublished += result.eventsPublished;
      this.health.totalRetried += result.eventsRetried;
      return result;
    }).catch((error: unknown) => {
      this.health.consecutivePollFailures += 1;
      this.health.lastPollError = normalizedError(error);
      throw error;
    }).finally(() => {
      this.health.inFlight = false;
      this.health.lastPollCompletedAt = this.now();
      this.activePoll = null;
    });
    return this.activePoll;
  }

  private schedule(delay: number): void {
    if (!this.health.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pollOnce().catch(() => undefined).finally(() => this.schedule(this.pollIntervalMs));
    }, delay);
    this.timer.unref?.();
  }

  private async runPoll(): Promise<IntegrationOutboxPollResult> {
    const result = emptyPollResult();
    let remaining = this.batchSize;
    const organizations = await this.db.organization.findMany({
      where: {
        status: { not: 'suspended' },
        ...(this.organizationIds ? { id: { in: [...this.organizationIds] } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const start = organizations.length ? this.organizationOffset % organizations.length : 0;
    const ordered = [...organizations.slice(start), ...organizations.slice(0, start)];
    for (const organization of ordered) {
      if (remaining <= 0) break;
      result.organizationsVisited += 1;
      // One noisy tenant cannot consume the entire poll forever. The rotating
      // start position gives every tenant bounded progress without weakening
      // the tenant-specific lock or transaction boundary.
      const organizationResult = await this.processOrganization(organization.id, Math.min(remaining, 10));
      if (organizationResult.lockSkipped) {
        result.organizationsLockSkipped += 1;
        continue;
      }
      result.eventsClaimed += organizationResult.claimed;
      result.eventsPublished += organizationResult.published;
      result.eventsRetried += organizationResult.retried;
      result.companyRouteRequired += organizationResult.companyRouteRequired;
      remaining -= organizationResult.claimed;
    }
    if (organizations.length) {
      this.organizationOffset = (start + Math.max(result.organizationsVisited, 1)) % organizations.length;
    }
    return result;
  }

  private async processOrganization(organizationId: string, limit: number) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      const lock = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`mesaorigins:integration-outbox:${organizationId}`}, 0)) AS locked
      `);
      if (!lock[0]?.locked) return { lockSkipped: true, claimed: 0, published: 0, retried: 0, companyRouteRequired: 0 };
      const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "IntegrationOutboxEvent"
        WHERE "organizationId" = ${organizationId}
          AND "publishedAt" IS NULL
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${this.now()})
          AND (
            ("serviceId" = 'mesaerp' AND "eventType" = ${ERP_TO_OPS_EVENT})
            OR ("serviceId" = 'mesaops' AND "eventType" IN (${Prisma.join([...OPS_TO_ERP_EVENTS])}))
          )
        ORDER BY "occurredAt" ASC, "createdAt" ASC, "id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);
      if (!candidates.length) return { lockSkipped: false, claimed: 0, published: 0, retried: 0, companyRouteRequired: 0 };
      const rows = await tx.integrationOutboxEvent.findMany({ where: { id: { in: candidates.map((row) => row.id) } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      let published = 0;
      let retried = 0;
      let companyRouteRequired = 0;
      for (const candidate of candidates) {
        const event = byId.get(candidate.id);
        if (!event) continue;
        await tx.$executeRawUnsafe('SAVEPOINT integration_outbox_delivery');
        try {
          const evidence = await deliverEvent(tx, event);
          await assertDestinationEvidence(tx, event, evidence);
          await tx.integrationOutboxEvent.update({
            where: { id: event.id },
            data: {
              attempts: { increment: 1 },
              publishedAt: this.now(),
              nextAttemptAt: null,
              lastError: '',
            },
          });
          await tx.auditEvent.create({
            data: {
              organizationId,
              actorEmail: WORKER_ACTOR,
              actorRole: 'system',
              action: 'integration.outbox.deliver',
              entity: 'IntegrationOutboxEvent',
              entityId: event.id,
              after: json({ consumer: evidence.consumer, legalEntityId: evidence.legalEntityId, eventType: event.eventType }),
            },
          });
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT integration_outbox_delivery');
          published += 1;
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT integration_outbox_delivery');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT integration_outbox_delivery');
          const code = normalizedError(error);
          const delay = Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** Math.min(event.attempts, 20)));
          await tx.integrationOutboxEvent.update({
            where: { id: event.id },
            data: {
              attempts: { increment: 1 },
              nextAttemptAt: new Date(this.now().getTime() + delay),
              lastError: code,
            },
          });
          retried += 1;
          if (code === 'company_route_required') companyRouteRequired += 1;
        }
      }
      return { lockSkipped: false, claimed: candidates.length, published, retried, companyRouteRequired };
    }, { timeout: this.transactionTimeoutMs });
  }
}

export const integrationOutboxWorker = new IntegrationOutboxWorker();

setIntegrationOutboxDrainHandler(() => {
  void integrationOutboxWorker.pollOnce().catch(() => undefined);
});

export function startIntegrationOutboxWorker(): void {
  integrationOutboxWorker.start();
}

export function stopIntegrationOutboxWorker(): Promise<void> {
  return integrationOutboxWorker.stop();
}

export function integrationOutboxWorkerHealth(): IntegrationOutboxWorkerHealth {
  return integrationOutboxWorker.healthSnapshot();
}

export const integrationOutboxSupportedEventTypes: readonly SupportedEventType[] = SUPPORTED_EVENT_TYPES;
