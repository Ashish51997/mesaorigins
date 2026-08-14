import type { Request, Response, RequestHandler } from 'express';
import { basePrisma } from '../db';
import { authSecretConfigured, sessionCookieName } from '../auth/config';
import {
  buildAuthenticatedUserContext,
  type AuthenticatedUserContext,
} from '../lib/authContext';

/**
 * Identity middleware — tenant-aware.
 *
 * - Auth.js database session cookie → resolve User + Membership.
 * - Else if DEV_AUTH = 1 → Phase-1 stub via `x-dev-user` / Administrator fallback.
 * - Else → 401.
 */

export type AuthedUser = AuthenticatedUserContext;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

/**
 * Development impersonation is deliberately impossible in a production
 * process, even if a deployment accidentally sets DEV_AUTH=1. This keeps an
 * environment-variable typo from turning x-dev-user into a public bypass.
 */
const isDevAuth = (): boolean =>
  process.env.DEV_AUTH === '1' && process.env.NODE_ENV !== 'production';

function organizationHint(req: Request): string {
  // x-org is the production organization selector. Keep x-dev-org as a local
  // compatibility alias for the development identity picker.
  return (req.header('x-org') || req.header('x-dev-org') || '').trim();
}

function rejectMissingContext(res: Response, hasOrganizationHint: boolean): void {
  res.status(403).json({
    error: hasOrganizationHint
      ? {
          code: 'organization_not_available',
          message: 'The selected organization is not available for this account.',
        }
      : {
          code: 'no_membership',
          message: 'No active organization membership for this account.',
        },
  });
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

  const selectedOrganization = organizationHint(req);
  const context = await buildAuthenticatedUserContext(dbSession.user.id, selectedOrganization);
  if (!context) {
    rejectMissingContext(res, Boolean(selectedOrganization));
    return false;
  }

  req.user = context;
  return true;
}

async function authenticateDev(req: Request, res: Response): Promise<boolean> {
  const hint = (req.header('x-dev-user') || '').trim();
  const selectedOrganization = organizationHint(req);
  const orgFilter = selectedOrganization
    ? { organization: { OR: [{ id: selectedOrganization }, { slug: selectedOrganization }] } }
    : {};

  let membership = hint
    ? await basePrisma.membership.findFirst({
        where: {
          AND: [
            { OR: [{ employeeCode: hint }, { user: { email: hint.toLowerCase() } }] },
            { status: { not: 'inactive' } },
            orgFilter,
          ],
        },
        include: { user: true, organization: true },
      })
    : null;

  // When the caller supplied an identity, never fall back to an unrelated
  // administrator merely because the requested organization did not match.
  if (!membership && !hint) {
    membership = await basePrisma.membership.findFirst({
      where: { AND: [{ role: 'Administrator' }, { status: { not: 'inactive' } }, orgFilter] },
      include: { user: true, organization: true },
    });
  }

  if (!membership) {
    if (hint && selectedOrganization) {
      rejectMissingContext(res, true);
    } else {
      res.status(401).json({ error: { code: 'no_user', message: 'No membership resolved — seed the database first.' } });
    }
    return false;
  }

  const context = await buildAuthenticatedUserContext(
    membership.userId,
    selectedOrganization || (hint && !hint.includes('@') ? membership.organizationId : ''),
  );
  if (!context) {
    rejectMissingContext(res, Boolean(selectedOrganization));
    return false;
  }

  req.user = context;
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
          : 'Auth is required but AUTH_SECRET is missing. Set DEV_AUTH=1 only for isolated local development.',
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
  if (isDevAuth()) return 'dev';
  return 'authjs';
};

export const googleSignInAvailable = (): boolean =>
  Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
