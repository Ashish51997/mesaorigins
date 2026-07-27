import { Router } from 'express';
import { z } from 'zod';
import { basePrisma } from '../../db';
import {
  passwordAuthEnabled,
  passwordsMatch,
  signSession,
} from '../../lib/sessionToken';
import { ROLE_DEFAULT_SCREENS, ADMIN_ROLES } from '../../lib/permissions';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRouter = Router();

/**
 * Temporary email + shared-password login (LOGIN_PASSWORD).
 * Issues an HMAC session token accepted by the auth middleware.
 */
authRouter.post('/auth/login', async (req, res, next) => {
  try {
    if (!passwordAuthEnabled()) {
      res.status(503).json({
        error: {
          code: 'password_auth_disabled',
          message: 'Password login is not enabled. Set LOGIN_PASSWORD on the server.',
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
    const expected = process.env.LOGIN_PASSWORD || '';
    if (!passwordsMatch(parsed.data.password, expected)) {
      res.status(401).json({
        error: { code: 'invalid_credentials', message: 'Invalid email or password.' },
      });
      return;
    }

    const membership = await basePrisma.membership.findFirst({
      where: {
        user: { email },
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

    const token = signSession({
      sub: membership.userId,
      email: membership.user.email,
      mid: membership.id,
    });

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

    res.json({
      token,
      user: {
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
      },
    });
  } catch (err) {
    next(err);
  }
});
