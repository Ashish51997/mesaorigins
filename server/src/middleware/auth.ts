import type { Request, Response, RequestHandler } from 'express';
import { basePrisma } from '../db';
import { ROLE_DEFAULT_SCREENS, ADMIN_ROLES } from '../lib/permissions';
import { authSecretConfigured, sessionCookieName } from '../auth/config';

/**
 * Identity middleware — tenant-aware.
 *
 * - Auth.js database session cookie → resolve User + Membership.
 * - Else if DEV_AUTH ≠ 0 → Phase-1 stub via `x-dev-user` / Administrator fallback.
 * - Else → 401.
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

const isDevAuth = (): boolean => process.env.DEV_AUTH !== '0';

type MembershipRow = NonNullable<Awaited<ReturnType<typeof loadMembershipById>>>;

async function loadMembershipById(id: string) {
  return basePrisma.membership.findUnique({
    where: { id },
    include: { user: true, organization: true },
  });
}

async function resolveScreens(membership: MembershipRow): Promise<{ isAdmin: boolean; screens: string[] }> {
  let isAdmin = ADMIN_ROLES.has(membership.role);
  let screens: string[] = ROLE_DEFAULT_SCREENS[membership.role] ?? [];
  try {
    const perms = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${membership.organizationId}, true)`;
      const role = membership.roleId
        ? await tx.role.findUnique({ where: { id: membership.roleId } })
        : await tx.role.findFirst({ where: { name: membership.role } });
      const grants = await tx.employeeGrant.findMany({ where: { membershipId: membership.id } });
      return { role, grants };
    });
    if (perms.role) {
      isAdmin = perms.role.isAdmin;
      screens = Array.isArray(perms.role.screens) ? (perms.role.screens as string[]) : [];
    }
    const set = new Set(screens);
    for (const g of perms.grants) { if (g.state === 'on') set.add(g.screen); else set.delete(g.screen); }
    screens = [...set];
  } catch { /* hardcoded fallback */ }
  return { isAdmin, screens };
}

function attachUser(req: Request, membership: MembershipRow, access: { isAdmin: boolean; screens: string[] }): void {
  req.user = {
    userId: membership.userId,
    email: membership.user.email,
    name: membership.user.name,
    membershipId: membership.id,
    employeeCode: membership.employeeCode,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    role: membership.role,
    isAdmin: access.isAdmin,
    screens: access.screens,
  };
}

function orgFilterFromHeader(req: Request) {
  const orgHint = (req.header('x-dev-org') || req.header('x-org') || '').trim();
  return orgHint ? { organization: { OR: [{ id: orgHint }, { slug: orgHint }] } } : {};
}

function readCookie(header: string, name: string): string {
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=') || '');
  }
  return '';
}

function hasSessionCookie(req: Request): boolean {
  return Boolean(readCookie(req.headers.cookie || '', sessionCookieName()));
}

async function authenticateSession(req: Request, res: Response): Promise<boolean> {
  if (!authSecretConfigured()) return false;

  const sessionToken = readCookie(req.headers.cookie || '', sessionCookieName());
  if (!sessionToken) return false;

  const dbSession = await basePrisma.session.findUnique({
    where: { sessionToken },
    include: { user: true },
  });

  if (!dbSession || dbSession.expires < new Date()) {
    if (dbSession) {
      await basePrisma.session.delete({ where: { sessionToken } }).catch(() => undefined);
    }
    res.status(401).json({ error: { code: 'invalid_token', message: 'Session is invalid or expired.' } });
    return false;
  }

  const user = dbSession.user;
  const orgFilter = orgFilterFromHeader(req);
  const membership = await basePrisma.membership.findFirst({
    where: {
      AND: [
        { userId: user.id },
        { status: { not: 'inactive' } },
        orgFilter,
      ],
    },
    include: { user: true, organization: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership) {
    res.status(403).json({
      error: {
        code: 'no_membership',
        message: 'No active organization membership for this account.',
      },
    });
    return false;
  }

  const access = await resolveScreens(membership);
  attachUser(req, membership, access);
  return true;
}

async function authenticateDev(req: Request, res: Response): Promise<boolean> {
  const hint = (req.header('x-dev-user') || '').trim();
  const orgFilter = orgFilterFromHeader(req);

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
    return false;
  }

  if (membership.status === 'inactive') {
    res.status(403).json({ error: { code: 'inactive', message: 'This employee is deactivated.' } });
    return false;
  }

  const access = await resolveScreens(membership);
  attachUser(req, membership, access);
  return true;
}

export const authenticate: RequestHandler = async (req, res, next) => {
  try {
    if (hasSessionCookie(req) && authSecretConfigured()) {
      const ok = await authenticateSession(req, res);
      if (ok) {
        next();
        return;
      }
      if (res.headersSent) return;
    }

    if (isDevAuth()) {
      const ok = await authenticateDev(req, res);
      if (ok) next();
      return;
    }

    res.status(401).json({
      error: {
        code: 'unauthenticated',
        message: authSecretConfigured()
          ? 'Sign-in required. Use Google or email/password, then retry with session cookie.'
          : 'Auth is required (DEV_AUTH=0) but AUTH_SECRET is missing.',
      },
    });
  } catch (err) {
    next(err);
  }
};

/** True when the API accepts the Phase-1 x-dev-user stub. */
export const isDevAuthEnabled = (): boolean => isDevAuth();

/** Auth mode advertised on /api/health for the login UI. */
export const authMode = (): 'authjs' | 'dev' => {
  if (authSecretConfigured()) return 'authjs';
  if (isDevAuth()) return 'dev';
  return 'authjs';
};

export const googleSignInAvailable = (): boolean =>
  Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
