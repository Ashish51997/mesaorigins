import { Router } from 'express';
import { z } from 'zod';
import { basePrisma } from '../../db';
import { ROLE_DEFAULT_SCREENS, ADMIN_ROLES } from '../../lib/permissions';
import {
  clearSessionCookie,
  newSessionToken,
  setSessionCookie,
  verifyPassword,
} from '../../lib/password';
import { SESSION_MAX_AGE_SEC, authSecretConfigured, sessionCookieName } from '../../auth/config';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRouter = Router();

async function membershipPayload(membership: {
  id: string;
  userId: string;
  employeeCode: string;
  organizationId: string;
  role: string;
  roleId: string | null;
  user: { email: string; name: string };
  organization: { name: string };
}) {
  let isAdmin = ADMIN_ROLES.has(membership.role);
  let screens: string[] = ROLE_DEFAULT_SCREENS[membership.role] ?? [];
  try {
    const perms = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${membership.organizationId}, true)`;
      const role = membership.roleId
        ? await tx.role.findUnique({ where: { id: membership.roleId } })
        : await tx.role.findFirst({ where: { name: membership.role } });
      return { role };
    });
    if (perms.role) {
      isAdmin = perms.role.isAdmin;
      screens = Array.isArray(perms.role.screens) ? (perms.role.screens as string[]) : [];
    }
  } catch { /* defaults */ }

  return {
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
}

/**
 * Email + per-user password → Auth.js database Session + httpOnly cookie.
 * (Auth.js Credentials provider cannot use database sessions natively.)
 */
authRouter.post('/auth/login', async (req, res, next) => {
  try {
    if (!authSecretConfigured()) {
      res.status(503).json({
        error: {
          code: 'auth_not_configured',
          message: 'AUTH_SECRET is not set (min 32 characters).',
        },
      });
      return;
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'invalid_body', message: 'email and password are required.', details: parsed.error.flatten() },
      });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const user = await basePrisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) {
      res.status(401).json({
        error: { code: 'invalid_credentials', message: 'Invalid email or password.' },
      });
      return;
    }

    const ok = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!ok) {
      res.status(401).json({
        error: { code: 'invalid_credentials', message: 'Invalid email or password.' },
      });
      return;
    }

    const membership = await basePrisma.membership.findFirst({
      where: {
        userId: user.id,
        status: { not: 'inactive' },
      },
      include: { user: true, organization: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) {
      res.status(403).json({
        error: {
          code: 'no_membership',
          message: 'This email is not on the People directory. Ask an administrator to add it.',
        },
      });
      return;
    }

    const sessionToken = newSessionToken();
    const expires = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000);
    await basePrisma.session.create({
      data: { sessionToken, userId: user.id, expires },
    });
    setSessionCookie(res, sessionToken, expires);

    res.json({ user: await membershipPayload(membership) });
  } catch (err) {
    next(err);
  }
});

function readCookie(header: string, name: string): string {
  const parts = header.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=') || '');
  }
  return '';
}

/** Clear Auth.js session cookie and delete the Session row. */
authRouter.post('/auth/logout', async (req, res, next) => {
  try {
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
