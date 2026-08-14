import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { canonicalHash } from './canonical';
import { tenantContext } from './tenantContext';
import { ApiError } from '../middleware/error';

type Tx = Prisma.TransactionClient;

export interface MesaOpsSourceLinkEvidence {
  sourceLinkId: string;
  sourceService: string;
  sourceType: string;
  sourceId: string;
  sourceSnapshotHash: string;
  correlationId: string;
}

export interface MesaOpsOutboxInput {
  legalEntityId?: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType:
    | 'mesaops.production-actuals.submitted.v1'
    | 'mesaops.qa-disposition.recorded.v1'
    | 'mesaops.physical-dispatch.completed.v1';
  sourceLink?: MesaOpsSourceLinkEvidence | null;
  snapshot: Record<string, unknown>;
  causationId?: string;
}

/**
 * Writes the integration proposal into the same transaction as the
 * authoritative MesaOps transition. Delivery is deliberately asynchronous:
 * no MesaERP service or endpoint is called from this helper.
 */
export async function appendMesaOpsOutboxEvent(tx: Tx, input: MesaOpsOutboxInput) {
  const current = tenantContext.getStore();
  if (!current) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  const eventId = randomUUID();
  const occurredAt = new Date();
  const correlationId = input.sourceLink?.correlationId || randomUUID();
  const sourceSnapshotHash = canonicalHash(input.snapshot);
  const payload = {
    eventId,
    eventType: input.eventType,
    schemaVersion: 1,
    sourceService: 'mesaops',
    organizationId: current.organizationId,
    legalEntityId: input.legalEntityId ?? null,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    correlationId,
    occurredAt: occurredAt.toISOString(),
    sourceSnapshotHash,
    sourceLink: input.sourceLink ?? null,
    snapshot: input.snapshot,
  };
  return tx.integrationOutboxEvent.create({
    data: {
      id: eventId,
      organizationId: current.organizationId,
      legalEntityId: input.legalEntityId ?? null,
      serviceId: 'mesaops',
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      schemaVersion: 1,
      correlationId,
      causationId: input.causationId ?? '',
      payload: payload as Prisma.InputJsonValue,
      payloadHash: canonicalHash(payload),
      occurredAt,
    },
  });
}
