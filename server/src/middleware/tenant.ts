import type { RequestHandler } from 'express';
import { tenantContext } from '../lib/tenantContext';

/**
 * Establishes the tenant context for the rest of the request from the
 * authenticated user's active membership (set by `authenticate`). Everything
 * downstream — including the guarded Prisma client — runs scoped to this org.
 * The tenant is derived here from the server-side membership, never trusted
 * from client input.
 */
export const resolveTenant: RequestHandler = (req, res, next) => {
  const u = req.user;
  if (!u) {
    res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } });
    return;
  }
  if (!u.organizationId) {
    res.status(403).json({ error: { code: 'no_tenant', message: 'This account has no active organization.' } });
    return;
  }
  tenantContext.run(
    { organizationId: u.organizationId, userId: u.userId, membershipId: u.membershipId, role: u.role, email: u.email },
    () => next(),
  );
};
