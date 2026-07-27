import type { RequestHandler } from 'express';
import { basePrisma } from '../db';
import { ROLE_DEFAULT_SCREENS, ADMIN_ROLES } from '../lib/permissions';

/**
 * Identity middleware — the deferred auth seam, now tenant-aware.
 *
 * Phase 1 (now): with DEV_AUTH on, resolve the current MEMBERSHIP from the
 * `x-dev-user` header (employeeCode or email) and optional `x-dev-org` (org id
 * or slug), falling back to a seeded Administrator. A membership pins both the
 * user's identity and their active organization + role.
 *
 * Phase 2 (later): keep this signature; replace the body with
 *   const decoded = await admin.auth().verifyIdToken(bearer)
 *   const user = await basePrisma.user.findFirst({ where: { firebaseUid: decoded.uid } })
 *   pick the active membership (from a header/claim), 403 if none.
 */

export interface AuthedUser {
  userId: string;
  email: string;
  name: string;
  membershipId: string;
  employeeCode: string;
  organizationId: string;
  organizationName: string;
  role: string;
  isAdmin: boolean;
  screens: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

const DEV_AUTH = process.env.DEV_AUTH !== '0';

export const authenticate: RequestHandler = async (req, res, next) => {
  try {
    if (!DEV_AUTH) {
      res.status(401).json({ error: { code: 'auth_not_configured', message: 'Firebase auth is not wired yet (Phase 2). Set DEV_AUTH=1 to use the dev identity.' } });
      return;
    }

    const hint = (req.header('x-dev-user') || '').trim();
    const orgHint = (req.header('x-dev-org') || '').trim();

    const orgFilter = orgHint ? { organization: { OR: [{ id: orgHint }, { slug: orgHint }] } } : {};

    let membership = hint
      ? await basePrisma.membership.findFirst({
          where: { AND: [{ OR: [{ employeeCode: hint }, { user: { email: hint.toLowerCase() } }] }, orgFilter] },
          include: { user: true, organization: true },
        })
      : null;

    if (!membership) {
      membership = await basePrisma.membership.findFirst({
        where: { AND: [{ role: 'Administrator' }, orgFilter] },
        include: { user: true, organization: true },
      });
    }

    if (!membership) {
      res.status(401).json({ error: { code: 'no_user', message: 'No membership resolved — seed the database first.' } });
      return;
    }

    // Effective access = the membership's Role screens ± per-employee grants.
    // Role/EmployeeGrant are RLS-scoped, so read them under the membership's
    // tenant GUC. Fall back to the hardcoded defaults if a role row is missing.
    let isAdmin = ADMIN_ROLES.has(membership.role);
    let screens: string[] = ROLE_DEFAULT_SCREENS[membership.role] ?? [];
    try {
      const m = membership;
      const perms = await basePrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${m.organizationId}, true)`;
        const role = m.roleId
          ? await tx.role.findUnique({ where: { id: m.roleId } })
          : await tx.role.findFirst({ where: { name: m.role } });
        const grants = await tx.employeeGrant.findMany({ where: { membershipId: m.id } });
        return { role, grants };
      });
      if (perms.role) {
        isAdmin = perms.role.isAdmin;
        screens = Array.isArray(perms.role.screens) ? (perms.role.screens as string[]) : [];
      }
      const set = new Set(screens);
      for (const g of perms.grants) { if (g.state === 'on') set.add(g.screen); else set.delete(g.screen); }
      screens = [...set];
    } catch { /* keep the hardcoded fallback above */ }

    req.user = {
      userId: membership.userId,
      email: membership.user.email,
      name: membership.user.name,
      membershipId: membership.id,
      employeeCode: membership.employeeCode,
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      role: membership.role,
      isAdmin,
      screens,
    };
    next();
  } catch (err) {
    next(err);
  }
};
