import { createHash } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { basePrisma } from '../../db';
import { buildAuthenticatedUserContext } from '../../lib/authContext';
import {
  clearSessionCookie,
  newSessionToken,
  setSessionCookie,
  verifyPassword,
} from '../../lib/password';
import { SESSION_MAX_AGE_SEC, authSecretConfigured, sessionCookieName } from '../../auth/config';
import { canAccessPlatformAdmin } from '../../lib/platformAdmin';

const bodySchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict();

export const authRouter = Router();

const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_BUCKET_LIMIT = 10_000;
const LOGIN_IP_LIMIT = 100;
const LOGIN_ACCOUNT_LIMIT = 20;
const LOGIN_IP_ACCOUNT_LIMIT = 8;
// Cost-12 sentinel keeps unknown-account and wrong-password responses on the
// same bcrypt path, reducing account-enumeration timing differences.
const DUMMY_PASSWORD_HASH = '$2b$12$2njTds5JAzc3ojuQbCicreug0JV/V8/a.vHVjS8QqfVD9.wHXDhHe';
type LoginBucket = { count: number; resetAt: number };
const loginAttempts = new Map<string, LoginBucket>();

function accountKey(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

function consumeLoginBucket(key: string, limit: number, now: number): number | null {
  let bucket = loginAttempts.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (!bucket && loginAttempts.size >= LOGIN_BUCKET_LIMIT) {
      const oldest = loginAttempts.keys().next().value as string | undefined;
      if (oldest) loginAttempts.delete(oldest);
    }
    bucket = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  }

  if (bucket.count >= limit) {
    loginAttempts.set(key, bucket);
    return bucket.resetAt;
  }
  bucket.count += 1;
  loginAttempts.set(key, bucket);
  return null;
}

function rejectRateLimited(res: Response, resetAt: number): void {
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1_000))));
  res.status(429).json({
    error: {
      code: 'rate_limited',
      message: 'Too many sign-in attempts. Please wait and try again.',
    },
  });
}

/**
 * Email + per-user password → Auth.js database Session + httpOnly cookie.
 * (Auth.js Credentials provider cannot use database sessions natively.)
 */
async function passwordLogin(
  req: import('express').Request,
  res: Response,
  next: import('express').NextFunction,
  platformAdminOnly: boolean,
): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (!authSecretConfigured()) {
      res.status(503).json({
        error: {
          code: 'auth_not_configured',
          message: 'AUTH_SECRET is not set (min 32 characters).',
        },
      });
      return;
    }

    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const ipResetAt = consumeLoginBucket(`ip:${ip}`, LOGIN_IP_LIMIT, now);
    if (ipResetAt) {
      rejectRateLimited(res, ipResetAt);
      return;
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'invalid_body', message: 'email and password are required.', details: parsed.error.flatten() },
      });
      return;
    }

    const email = parsed.data.email.toLowerCase();
    const hashedAccount = accountKey(email);
    const accountResetAt = consumeLoginBucket(`account:${hashedAccount}`, LOGIN_ACCOUNT_LIMIT, now);
    const pairResetAt = consumeLoginBucket(`pair:${ip}:${hashedAccount}`, LOGIN_IP_ACCOUNT_LIMIT, now);
    const resetAt = accountResetAt ?? pairResetAt;
    if (resetAt) {
      rejectRateLimited(res, resetAt);
      return;
    }

    const user = await basePrisma.user.findUnique({ where: { email } });
    const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user?.passwordHash || !ok) {
      res.status(401).json({
        error: { code: 'invalid_credentials', message: 'Invalid email or password.' },
      });
      return;
    }

    // The platform console is cross-tenant. Do not let a stale organization
    // selector prevent an otherwise valid platform administrator from signing
    // in; its authorization below considers every active membership.
    const selectedOrganization = platformAdminOnly ? '' : (req.header('x-org') || '').trim();
    const context = await buildAuthenticatedUserContext(user.id, selectedOrganization);
    if (!context) {
      res.status(403).json({
        error: platformAdminOnly
          ? {
              code: 'platform_admin_required',
              message: 'This account cannot access MesaDesk administration.',
            }
          : selectedOrganization
          ? {
              code: 'organization_not_available',
              message: 'The selected organization is not available for this account.',
            }
          : {
              code: 'no_membership',
              message: 'This email is not on the People directory. Ask an administrator to add it.',
            },
      });
      return;
    }

    if (platformAdminOnly) {
      const hasAdminMembership = context.organizations.some((organization) => (
        organization.membershipStatus === 'active' && organization.isAdmin
      ));
      if (!canAccessPlatformAdmin(context.email, hasAdminMembership)) {
        res.status(403).json({
          error: {
            code: 'platform_admin_required',
            message: 'This account cannot access MesaDesk administration.',
          },
        });
        return;
      }
    }

    const sessionToken = newSessionToken();
    const expires = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000);
    await basePrisma.session.create({
      data: { sessionToken, userId: user.id, expires },
    });
    setSessionCookie(res, sessionToken, expires);
    loginAttempts.delete(`account:${hashedAccount}`);
    loginAttempts.delete(`pair:${ip}:${hashedAccount}`);

    res.json({ user: context });
  } catch (err) {
    next(err);
  }
}

authRouter.post('/auth/login', (req, res, next) => {
  void passwordLogin(req, res, next, false);
});

/**
 * Production admin sign-in. Valid credentials alone are insufficient: the
 * identity must also be explicitly allowlisted and hold an active admin role.
 * No session row or cookie is created until both checks pass.
 */
authRouter.post('/auth/admin-login', (req, res, next) => {
  void passwordLogin(req, res, next, true);
});

function readCookie(header: string, name: string): string {
  const parts = header.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=') || '');
  }
  return '';
}

/**
 * Restore only a real Auth.js database session.
 *
 * This intentionally lives on the public auth router instead of using the
 * general `authenticate` middleware: that middleware may resolve DEV_AUTH's
 * local fallback identity when no cookie exists, which must never turn a fresh
 * landing-page visit into an authenticated organization session.
 */
authRouter.get('/auth/session-context', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie, x-org');

    const sessionToken = authSecretConfigured()
      ? readCookie(req.headers.cookie || '', sessionCookieName())
      : '';
    if (!sessionToken) {
      res.json({ user: null });
      return;
    }

    const session = await basePrisma.session.findUnique({
      where: { sessionToken },
      select: { userId: true, expires: true },
    });
    if (!session || session.expires < new Date()) {
      if (session) {
        await basePrisma.session.deleteMany({ where: { sessionToken } });
      }
      clearSessionCookie(res);
      res.status(401).json({
        error: { code: 'invalid_token', message: 'Session is invalid or expired.' },
      });
      return;
    }

    const selectedOrganization = (req.header('x-org') || '').trim();
    const context = await buildAuthenticatedUserContext(session.userId, selectedOrganization);
    if (!context) {
      res.status(403).json({
        error: selectedOrganization
          ? {
              code: 'organization_not_available',
              message: 'The selected organization is not available for this account.',
            }
          : {
              code: 'no_membership',
              message: 'No active organization membership for this account.',
            },
      });
      return;
    }

    res.json({ user: context });
  } catch (err) {
    next(err);
  }
});

/** Clear Auth.js session cookie and delete the Session row. */
authRouter.post('/auth/logout', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const token = readCookie(req.headers.cookie || '', sessionCookieName());
    if (token) {
      await basePrisma.session.deleteMany({ where: { sessionToken: token } });
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
