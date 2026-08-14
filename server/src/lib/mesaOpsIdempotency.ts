import type { Prisma } from '@prisma/client';
import { tenantTx } from '../db';
import { canonicalHash } from './canonical';
import { tenantContext } from './tenantContext';
import { ApiError } from '../middleware/error';

type Tx = Prisma.TransactionClient;

function organizationId(): string {
  const current = tenantContext.getStore();
  if (!current) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return current.organizationId;
}

/**
 * Serializes one logical MesaOps write, stores its JSON response, and safely
 * replays the response when a client retries with the same key and payload.
 */
export async function runMesaOpsIdempotent<T>(args: {
  scope: string;
  key: string;
  payload: unknown;
  execute: (tx: Tx) => Promise<T>;
}): Promise<T> {
  const orgId = organizationId();
  const requestHash = canonicalHash(args.payload);
  return tenantTx(async (rawTx) => {
    const tx = rawTx as unknown as Tx;
    const lockKey = `${orgId}:${args.scope}:${args.key}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    const existing = await tx.mesaOpsIdempotencyRecord.findUnique({
      where: { organizationId_scope_key: { organizationId: orgId, scope: args.scope, key: args.key } },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ApiError(409, 'idempotency_conflict', 'This Idempotency-Key was already used with a different request.');
      }
      return existing.response as T;
    }

    const response = await args.execute(tx);
    const stored = JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue;
    await tx.mesaOpsIdempotencyRecord.create({
      data: {
        organizationId: orgId,
        scope: args.scope,
        key: args.key,
        requestHash,
        response: stored,
      },
    });
    return response;
  });
}
