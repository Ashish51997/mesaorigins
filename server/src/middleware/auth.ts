import type { Request, Response, RequestHandler } from 'express';
import { basePrisma } from '../db';
import { ROLE_DEFAULT_SCREENS, ADMIN_ROLES } from '../lib/permissions';
import { verifyIdToken, firebaseAdminReady } from '../lib/firebaseAdmin';
import { isSessionToken, passwordAuthEnabled, verifySession } from '../lib/sessionToken';

/**
 * Identity middleware — tenant-aware.
 *
 * - Bearer `mdp1.*` → HMAC session from email/password login (LOGIN_PASSWORD).
 * - Bearer other → verify Firebase ID token, resolve User + Membership.
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

async function authenticateSession(req: Request, res: Response, token: string): Promise<boolean> {
  const claims = verifySession(token);
  if (!claims) {
    res.status(401).json({ error: { code: 'invalid_token', message: 'Session token is invalid or expired.' } });
    return false;
  }

  const membership = await basePrisma.membership.findFirst({
    where: {
      id: claims.mid,
      userId: claims.sub,
      status: { not: 'inactive' },
    },
    include: { user: true, organization: true },
  });

  if (!membership) {
    res.status(403).json({
      error: { code: 'no_membership', message: 'Session membership is no longer valid.' },
    });
    return false;
  }

  const access = await resolveScreens(membership);
  attachUser(req, membership, access);
  return true;
}

async function authenticateFirebase(req: Request, res: Response, token: string): Promise<boolean> {
  let decoded;
  try {
    decoded = await verifyIdToken(token);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth_not_configured') {
      res.status(503).json({
        error: {
          code: 'auth_not_configured',
          message: 'Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT (JSON or file path) and DEV_AUTH=0.',
        },
      });
      return false;
    }
    res.status(401).json({ error: { code: 'invalid_token', message: 'Firebase ID token is invalid or expired.' } });
    return false;
  }

  const email = (decoded.email || '').toLowerCase();
  let user = await basePrisma.user.findFirst({
    where: {
      OR: [
        { firebaseUid: decoded.uid },
        ...(email ? [{ email }] : []),
      ],
    },
  });

  if (!user) {
    res.status(403).json({
      error: {
        code: 'no_membership',
        message: 'This Google account is not on the People directory. Ask an administrator to add your email.',
      },
    });
    return false;
  }

  // Link Firebase UID on first successful sign-in by email.
  if (!user.firebaseUid) {
    user = await basePrisma.user.update({
      where: { id: user.id },
      data: { firebaseUid: decoded.uid, name: decoded.name || user.name },
    });
  } else if (user.firebaseUid !== decoded.uid) {
    res.status(403).json({ error: { code: 'uid_mismatch', message: 'This email is linked to a different Firebase account.' } });
    return false;
  }

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
    const authHeader = (req.header('authorization') || '').trim();
    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';

    if (bearer) {
      const ok = isSessionToken(bearer)
        ? await authenticateSession(req, res, bearer)
        : await authenticateFirebase(req, res, bearer);
      if (ok) next();
      return;
    }

    if (isDevAuth()) {
      const ok = await authenticateDev(req, res);
      if (ok) next();
      return;
    }

    res.status(401).json({
      error: {
        code: 'unauthenticated',
        message: passwordAuthEnabled()
          ? 'Sign-in required. POST /api/auth/login then send Authorization: Bearer <session token>.'
          : firebaseAdminReady()
            ? 'Sign-in required. Send Authorization: Bearer <Firebase ID token>.'
            : 'Auth is required (DEV_AUTH=0) but credentials are missing.',
      },
    });
  } catch (err) {
    next(err);
  }
};

/** True when the API accepts the Phase-1 x-dev-user stub. */
export const isDevAuthEnabled = (): boolean => isDevAuth();

/** Auth mode advertised on /api/health for the login UI. */
export const authMode = (): 'password' | 'dev' | 'firebase' => {
  if (passwordAuthEnabled()) return 'password';
  if (isDevAuth()) return 'dev';
  return 'firebase';
};
