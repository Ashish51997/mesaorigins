import { PrismaClient } from '@prisma/client';
import { tenantContext } from './lib/tenantContext';

// Global models are part of the identity/tenancy plane — they are queried before
// a tenant is known (during auth), so they are NOT tenant-scoped and have no RLS.
const GLOBAL_MODELS = new Set([
  'Organization', 'OrganizationService', 'Service', 'LeadFormLink', 'LeadPortalLink',
  'User', 'Membership', 'Account', 'Session', 'VerificationToken',
]);

function delegateKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

const globalForPrisma = globalThis as unknown as { basePrisma?: PrismaClient };

// Raw client — used for global/platform work (orgs, users, memberships, auth
// lookups, seeding) where tenant scoping must not apply.
export const basePrisma =
  globalForPrisma.basePrisma ??
  new PrismaClient({ log: process.env.PRISMA_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.basePrisma = basePrisma;

/**
 * Tenant-guarded client. For every tenant-owned model it:
 *   1. injects `organizationId` from the request's tenant context into writes
 *      (so a caller can never target another tenant, and RLS WITH CHECK passes);
 *   2. runs the operation inside a transaction that sets `app.current_tenant`,
 *      so Postgres Row-Level Security scopes reads/updates/deletes to this org.
 * Global models pass straight through. A tenant-model op with no tenant context
 * fails closed. Use `basePrisma` for deliberate cross-tenant/platform work.
 */
export const prisma = basePrisma.$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      if (!model || GLOBAL_MODELS.has(model)) return query(args);

      const store = tenantContext.getStore();
      if (!store) {
        throw new Error(`Tenant context required to ${operation} ${model}: no organization in scope.`);
      }
      const orgId = store.organizationId;

      const a = args as Record<string, unknown>;
      if (operation === 'create' && a.data) {
        a.data = { ...(a.data as object), organizationId: orgId };
      } else if (operation === 'createMany' && a.data) {
        const rows = Array.isArray(a.data) ? a.data : [a.data];
        a.data = rows.map((d) => ({ ...(d as object), organizationId: orgId }));
      } else if (operation === 'upsert' && a.create) {
        a.create = { ...(a.create as object), organizationId: orgId };
      }

      return basePrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
        const delegate = (tx as unknown as Record<string, Record<string, (x: unknown) => unknown>>)[delegateKey(model)];
        return delegate[operation](a);
      });
    },
  },
});

/**
 * Run a function with the tenant GUC set, for code that needs raw SQL or an
 * explicit transaction under RLS (reporting, the trace projection, etc.).
 */
export async function withTenant<T>(organizationId: string, fn: (tx: typeof basePrisma) => Promise<T>): Promise<T> {
  return basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
    return fn(tx as typeof basePrisma);
  });
}

/**
 * Atomic, RLS-scoped transaction for the current request's tenant. Use for
 * multi-step lifecycle writes (e.g. create order + update inquiry + audit) so
 * they commit together. Creates must set `organizationId` explicitly (tx is the
 * raw client). Reads/single writes can use the guarded `prisma` instead.
 */
export async function tenantTx<T>(fn: (tx: typeof basePrisma) => Promise<T>): Promise<T> {
  const ctx = tenantContext.getStore();
  if (!ctx) throw new Error('tenantTx requires a tenant context.');
  return withTenant(ctx.organizationId, fn);
}
