import type { Prisma, PrismaClient } from '@prisma/client';
import { tenantContext } from './tenantContext';

type Tx = Pick<PrismaClient, 'auditEvent'>;

/**
 * Append a tenant-scoped audit event. Pass the transaction client so the event
 * commits atomically with the change it records. Actor + org come from the
 * request's tenant context.
 */
export async function audit(
  tx: Tx,
  e: { action: string; entity: string; entityId?: string; before?: unknown; after?: unknown },
): Promise<void> {
  const ctx = tenantContext.getStore();
  await tx.auditEvent.create({
    data: {
      organizationId: ctx?.organizationId ?? '',
      actorEmail: ctx?.email ?? '',
      actorRole: ctx?.role ?? '',
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? '',
      before: e.before === undefined ? undefined : (e.before as Prisma.InputJsonValue),
      after: e.after === undefined ? undefined : (e.after as Prisma.InputJsonValue),
    },
  });
}
