import { AsyncLocalStorage } from 'node:async_hooks';

// The tenant + actor a request is running as. Set once by the tenant middleware
// after auth resolves the user's active membership, and read by the guarded
// Prisma client so every query is scoped to this organization.
export interface TenantCtx {
  organizationId: string;
  userId: string;
  membershipId: string;
  role: string;
  email: string;
}

export const tenantContext = new AsyncLocalStorage<TenantCtx>();

export function currentTenant(): TenantCtx | undefined {
  return tenantContext.getStore();
}
