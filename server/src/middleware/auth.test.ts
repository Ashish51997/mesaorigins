import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app';
import { basePrisma } from '../db';
import { hashPassword, newSessionToken } from '../lib/password';
import { SESSION_MAX_AGE_SEC, sessionCookieName } from '../auth/config';
import { allowedPlatformAdminEmails } from '../lib/platformAdmin';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-auth-secret-min-32-characters!!';

const app = buildApp();

function cookieHeaderFromSetCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) return '';
  return raw.split(';')[0]; // name=value only
}

describe('auth middleware (Auth.js sessions)', () => {
  const prev = process.env.DEV_AUTH;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAllowedEmails = process.env.ONBOARDING_ALLOWED_EMAILS;

  afterEach(() => {
    if (prev === undefined) delete process.env.DEV_AUTH;
    else process.env.DEV_AUTH = prev;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevAllowedEmails === undefined) delete process.env.ONBOARDING_ALLOWED_EMAILS;
    else process.env.ONBOARDING_ALLOWED_EMAILS = prevAllowedEmails;
  });

  it('still accepts x-dev-user when DEV_AUTH is on and no session cookie', async () => {
    process.env.DEV_AUTH = '1';
    const r = await request(app).get('/api/me').set('x-dev-user', 'EMP-002');
    expect(r.status).toBe(200);
    expect(r.body.user.employeeCode).toBe('EMP-002');
  });

  it('does not expose the DEV_AUTH fallback through the cookie-only session context', async () => {
    process.env.DEV_AUTH = '1';

    const r = await request(app)
      .get('/api/auth/session-context')
      .set('x-dev-user', 'EMP-002');

    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers.vary).toContain('Cookie');
    expect(r.body).toEqual({ user: null });
  });

  it('rejects x-dev-user and the administrator fallback when DEV_AUTH is omitted', async () => {
    delete process.env.DEV_AUTH;

    const impersonated = await request(app).get('/api/me').set('x-dev-user', 'EMP-002');
    expect(impersonated.status).toBe(401);
    expect(impersonated.body.error.code).toBe('unauthenticated');

    const fallback = await request(app).get('/api/me');
    expect(fallback.status).toBe(401);
    expect(fallback.body.error.code).toBe('unauthenticated');
  });

  it('accepts a database session cookie over the stub', async () => {
    process.env.DEV_AUTH = '1';
    const user = await basePrisma.user.findUnique({ where: { email: 'deepak.bansal@masspolymer.in' } });
    expect(user).toBeTruthy();
    const sessionToken = newSessionToken();
    const expires = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000);
    await basePrisma.session.create({ data: { sessionToken, userId: user!.id, expires } });

    const r = await request(app)
      .get('/api/me')
      .set('Cookie', `${sessionCookieName()}=${sessionToken}`);
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe('deepak.bansal@masspolymer.in');

    await basePrisma.session.deleteMany({ where: { sessionToken } });
  });

  it('restores a real database session through the cookie-only session context', async () => {
    process.env.DEV_AUTH = '1';
    const user = await basePrisma.user.findUnique({ where: { email: 'deepak.bansal@masspolymer.in' } });
    expect(user).toBeTruthy();
    const sessionToken = newSessionToken();
    const expires = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000);
    await basePrisma.session.create({ data: { sessionToken, userId: user!.id, expires } });

    try {
      const r = await request(app)
        .get('/api/auth/session-context')
        .set('Cookie', `${sessionCookieName()}=${sessionToken}`);

      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body.user).toEqual(expect.objectContaining({
        userId: user!.id,
        email: 'deepak.bansal@masspolymer.in',
        organizations: expect.any(Array),
        services: expect.any(Array),
      }));
    } finally {
      await basePrisma.session.deleteMany({ where: { sessionToken } });
    }
  });

  it('rejects and clears an invalid cookie without falling back to DEV_AUTH', async () => {
    process.env.DEV_AUTH = '1';

    const r = await request(app)
      .get('/api/auth/session-context')
      .set('Cookie', `${sessionCookieName()}=not-a-real-session`)
      .set('x-dev-user', 'EMP-002');

    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('invalid_token');
    const clearedCookie = r.headers['set-cookie'];
    expect(Array.isArray(clearedCookie) ? clearedCookie.join(';') : (clearedCookie ?? ''))
      .toContain(`${sessionCookieName()}=`);
  });

  it('rejects an invalid session cookie when DEV_AUTH is off', async () => {
    process.env.DEV_AUTH = '0';
    const r = await request(app)
      .get('/api/me')
      .set('Cookie', `${sessionCookieName()}=not-a-real-session`);
    expect(r.status).toBe(401);
  });

  it('password login sets a session cookie', async () => {
    process.env.DEV_AUTH = '0';
    const email = 'deepak.bansal@masspolymer.in';
    const password = 'test-login-pass-99';
    const existing = await basePrisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, passwordHash: true } });
    try {
      await basePrisma.user.update({
        where: { email },
        data: { passwordHash: await hashPassword(password) },
      });

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email, password });
      expect(login.status).toBe(200);
      expect(login.body.user.email).toBe(email);
      expect(login.headers['cache-control']).toBe('no-store');
      expect(Array.isArray(login.body.user.services)).toBe(true);
      expect(login.body.user.organizations).toEqual([
        expect.objectContaining({
          organizationId: login.body.user.organizationId,
          membershipId: login.body.user.membershipId,
          services: login.body.user.services,
        }),
      ]);
      const cookie = cookieHeaderFromSetCookie(login.headers['set-cookie']);
      expect(cookie).toContain(sessionCookieName());

      const me = await request(app)
        .get('/api/me')
        .set('Cookie', cookie);
      expect(me.status).toBe(200);
      expect(me.headers['cache-control']).toBe('no-store');
      expect(me.body.user.email).toBe(email);
      expect(me.body.user.services).toEqual(login.body.user.services);
      expect(me.body.user.organizations).toEqual(login.body.user.organizations);
    } finally {
      await basePrisma.session.deleteMany({ where: { userId: existing.id } });
      await basePrisma.user.update({ where: { id: existing.id }, data: { passwordHash: existing.passwordHash } });
    }
  });

  it('admin login creates a session only after platform authorization succeeds', async () => {
    process.env.DEV_AUTH = '0';
    process.env.NODE_ENV = 'test';
    const email = 'deepak.bansal@masspolymer.in';
    const password = 'test-platform-admin-pass-99';
    process.env.ONBOARDING_ALLOWED_EMAILS = email;
    const existing = await basePrisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, passwordHash: true },
    });

    try {
      await basePrisma.user.update({
        where: { id: existing.id },
        data: { passwordHash: await hashPassword(password) },
      });

      const login = await request(app)
        .post('/api/auth/admin-login')
        .set('x-org', 'not-an-owned-organization')
        .send({ email, password });

      expect(login.status).toBe(200);
      expect(login.body.user.email).toBe(email);
      expect(login.body.user.organizations.some((organization: { isAdmin: boolean }) => organization.isAdmin)).toBe(true);
      const cookie = cookieHeaderFromSetCookie(login.headers['set-cookie']);
      expect(cookie).toContain(sessionCookieName());

      const access = await request(app)
        .get('/api/onboarding/access')
        .set('Cookie', cookie);
      expect(access.status).toBe(200);
      expect(access.body.allowed).toBe(true);
    } finally {
      await basePrisma.session.deleteMany({ where: { userId: existing.id } });
      await basePrisma.user.update({ where: { id: existing.id }, data: { passwordHash: existing.passwordHash } });
    }
  });

  it('admin login rejects a valid ordinary account without creating a session', async () => {
    process.env.DEV_AUTH = '0';
    process.env.NODE_ENV = 'test';
    const email = 'nandlal@masspolymer.in';
    const password = 'test-non-platform-pass-99';
    process.env.ONBOARDING_ALLOWED_EMAILS = email;
    const existing = await basePrisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, passwordHash: true },
    });

    try {
      await basePrisma.user.update({
        where: { id: existing.id },
        data: { passwordHash: await hashPassword(password) },
      });
      const sessionsBefore = await basePrisma.session.count({ where: { userId: existing.id } });

      const login = await request(app)
        .post('/api/auth/admin-login')
        .send({ email, password });

      expect(login.status).toBe(403);
      expect(login.body.error.code).toBe('platform_admin_required');
      expect(login.headers['set-cookie']).toBeUndefined();
      expect(await basePrisma.session.count({ where: { userId: existing.id } })).toBe(sessionsBefore);
    } finally {
      await basePrisma.session.deleteMany({ where: { userId: existing.id } });
      await basePrisma.user.update({ where: { id: existing.id }, data: { passwordHash: existing.passwordHash } });
    }
  });

  it('admin login requires the identity allowlist even for an administrator', async () => {
    process.env.DEV_AUTH = '0';
    process.env.NODE_ENV = 'production';
    const email = 'deepak.bansal@masspolymer.in';
    const password = 'test-not-allowlisted-pass-99';
    delete process.env.ONBOARDING_ALLOWED_EMAILS;
    const existing = await basePrisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, passwordHash: true },
    });

    try {
      await basePrisma.user.update({
        where: { id: existing.id },
        data: { passwordHash: await hashPassword(password) },
      });
      const sessionsBefore = await basePrisma.session.count({ where: { userId: existing.id } });

      const login = await request(app)
        .post('/api/auth/admin-login')
        .send({ email, password });

      expect(login.status).toBe(403);
      expect(login.body.error.code).toBe('platform_admin_required');
      expect(login.headers['set-cookie']).toBeUndefined();
      expect(await basePrisma.session.count({ where: { userId: existing.id } })).toBe(sessionsBefore);
    } finally {
      await basePrisma.session.deleteMany({ where: { userId: existing.id } });
      await basePrisma.user.update({ where: { id: existing.id }, data: { passwordHash: existing.passwordHash } });
    }
  });

  it('returns only the organization services that are currently usable', async () => {
    process.env.DEV_AUTH = '0';
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const organizationId = `auth-org-${suffix}`;
    const userId = `auth-user-${suffix}`;
    const email = `auth-services-${suffix}@example.com`;
    const password = 'test-service-login-pass-99';
    const serviceIds = {
      first: `auth-first-${suffix}`,
      second: `auth-second-${suffix}`,
      stopped: `auth-stopped-${suffix}`,
      suspended: `auth-suspended-${suffix}`,
    };

    try {
      await basePrisma.organization.create({
        data: { id: organizationId, name: 'Auth Services Test', slug: organizationId },
      });
      await basePrisma.user.create({
        data: { id: userId, email, name: 'Auth Services User', passwordHash: await hashPassword(password) },
      });
      await basePrisma.membership.create({
        data: {
          organizationId,
          userId,
          employeeCode: `AUTH-${suffix}`,
          department: 'Testing',
          role: 'Administrator',
        },
      });
      await basePrisma.service.createMany({
        data: [
          { id: serviceIds.first, name: 'First active', description: 'First service', status: 'active', sortOrder: 10 },
          { id: serviceIds.second, name: 'Second active', description: 'Second service', status: 'active', sortOrder: 20 },
          { id: serviceIds.stopped, name: 'Globally stopped', description: 'Stopped service', status: 'stopped', sortOrder: 1 },
          { id: serviceIds.suspended, name: 'Assignment suspended', description: 'Suspended assignment', status: 'active', sortOrder: 2 },
        ],
      });
      await basePrisma.organizationService.createMany({
        data: [
          { organizationId, serviceId: serviceIds.first, status: 'active' },
          { organizationId, serviceId: serviceIds.second, status: 'active' },
          { organizationId, serviceId: serviceIds.stopped, status: 'active' },
          { organizationId, serviceId: serviceIds.suspended, status: 'suspended' },
        ],
      });

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email, password });

      expect(login.status).toBe(200);
      expect(login.body.user.services).toEqual([
        { id: serviceIds.first, name: 'First active', description: 'First service', status: 'active', sortOrder: 10 },
        { id: serviceIds.second, name: 'Second active', description: 'Second service', status: 'active', sortOrder: 20 },
      ]);

      await basePrisma.organization.update({ where: { id: organizationId }, data: { status: 'suspended' } });
      const suspendedLogin = await request(app)
        .post('/api/auth/login')
        .send({ email, password });
      expect(suspendedLogin.status).toBe(200);
      expect(suspendedLogin.body.user.services).toEqual([]);
    } finally {
      await basePrisma.user.deleteMany({ where: { id: userId } });
      await basePrisma.organization.deleteMany({ where: { id: organizationId } });
      await basePrisma.service.deleteMany({ where: { id: { in: Object.values(serviceIds) } } });
    }
  });

  it('exposes all memberships and safely binds x-org to one owned organization', async () => {
    process.env.DEV_AUTH = '0';
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userId = `multi-user-${suffix}`;
    const email = `multi-org-${suffix}@example.com`;
    const password = 'multi-organization-pass-99';
    const ids = {
      firstOrg: `multi-first-org-${suffix}`,
      secondOrg: `multi-second-org-${suffix}`,
      inactiveOrg: `multi-inactive-org-${suffix}`,
      foreignOrg: `multi-foreign-org-${suffix}`,
      firstService: `multi-first-service-${suffix}`,
      secondService: `multi-second-service-${suffix}`,
    };

    try {
      await basePrisma.organization.createMany({
        data: [
          { id: ids.firstOrg, name: 'First Organization', slug: `${ids.firstOrg}-slug`, status: 'suspended' },
          { id: ids.secondOrg, name: 'Second Organization', slug: `${ids.secondOrg}-slug` },
          { id: ids.inactiveOrg, name: 'Inactive Membership Organization', slug: `${ids.inactiveOrg}-slug` },
          { id: ids.foreignOrg, name: 'Foreign Organization', slug: `${ids.foreignOrg}-slug` },
        ],
      });
      await basePrisma.service.createMany({
        data: [
          { id: ids.firstService, name: 'First Service', description: 'Unavailable while the organization is suspended', status: 'active', sortOrder: 10 },
          { id: ids.secondService, name: 'Second Service', description: 'Usable service', status: 'active', sortOrder: 20 },
        ],
      });
      await basePrisma.user.create({
        data: { id: userId, email, name: 'Multi Organization User', passwordHash: await hashPassword(password) },
      });
      await basePrisma.membership.createMany({
        data: [
          {
            id: `multi-first-membership-${suffix}`,
            organizationId: ids.firstOrg,
            userId,
            employeeCode: `MULTI-FIRST-${suffix}`,
            department: 'Sales',
            role: 'Administrator',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          },
          {
            id: `multi-second-membership-${suffix}`,
            organizationId: ids.secondOrg,
            userId,
            employeeCode: `MULTI-SECOND-${suffix}`,
            department: 'Sales',
            role: 'Sales Executive',
            createdAt: new Date('2024-02-01T00:00:00.000Z'),
          },
          {
            id: `multi-inactive-membership-${suffix}`,
            organizationId: ids.inactiveOrg,
            userId,
            employeeCode: `MULTI-INACTIVE-${suffix}`,
            department: 'Sales',
            role: 'Administrator',
            status: 'inactive',
            createdAt: new Date('2024-03-01T00:00:00.000Z'),
          },
        ],
      });
      await basePrisma.organizationService.createMany({
        data: [
          { organizationId: ids.firstOrg, serviceId: ids.firstService, status: 'active' },
          { organizationId: ids.secondOrg, serviceId: ids.secondService, status: 'active' },
        ],
      });

      const login = await request(app).post('/api/auth/login').send({ email, password });
      expect(login.status).toBe(200);
      // The oldest membership is suspended, so bootstrap selects the first
      // membership that can actually enter a service.
      expect(login.body.user.organizationId).toBe(ids.secondOrg);
      expect(login.body.user.services.map((service: { id: string }) => service.id)).toEqual([ids.secondService]);
      expect(login.body.user.organizations).toEqual([
        expect.objectContaining({
          organizationId: ids.firstOrg,
          organizationName: 'First Organization',
          organizationSlug: `${ids.firstOrg}-slug`,
          role: 'Administrator',
          services: [],
        }),
        expect.objectContaining({
          organizationId: ids.secondOrg,
          organizationName: 'Second Organization',
          organizationSlug: `${ids.secondOrg}-slug`,
          role: 'Sales Executive',
          services: [expect.objectContaining({ id: ids.secondService })],
        }),
      ]);

      const cookie = cookieHeaderFromSetCookie(login.headers['set-cookie']);
      const selectedFirst = await request(app)
        .get('/api/me')
        .set('Cookie', cookie)
        .set('x-org', `${ids.firstOrg}-slug`);
      expect(selectedFirst.status).toBe(200);
      expect(selectedFirst.body.user.organizationId).toBe(ids.firstOrg);
      expect(selectedFirst.body.user.services).toEqual([]);
      expect(selectedFirst.body.user.organizations).toHaveLength(2);

      const selectedSecond = await request(app)
        .get('/api/me')
        .set('Cookie', cookie)
        .set('x-org', ids.secondOrg);
      expect(selectedSecond.status).toBe(200);
      expect(selectedSecond.body.user.organizationId).toBe(ids.secondOrg);
      expect(selectedSecond.body.user.role).toBe('Sales Executive');

      for (const unavailableOrganization of [ids.inactiveOrg, ids.foreignOrg]) {
        const rejected = await request(app)
          .get('/api/me')
          .set('Cookie', cookie)
          .set('x-org', unavailableOrganization);
        expect(rejected.status).toBe(403);
        expect(rejected.body.error.code).toBe('organization_not_available');
      }
    } finally {
      await basePrisma.user.deleteMany({ where: { id: userId } });
      await basePrisma.organization.deleteMany({ where: { id: { in: [ids.firstOrg, ids.secondOrg, ids.inactiveOrg, ids.foreignOrg] } } });
      await basePrisma.service.deleteMany({ where: { id: { in: [ids.firstService, ids.secondService] } } });
    }
  });

  it('bounds credential fields before database or password work', async () => {
    process.env.DEV_AUTH = '0';

    const oversizedEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: `${'a'.repeat(250)}@example.com`, password: 'valid-length' });
    expect(oversizedEmail.status).toBe(400);
    expect(oversizedEmail.body.error.code).toBe('invalid_body');

    const oversizedPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bounded-credentials@example.com', password: 'x'.repeat(129) });
    expect(oversizedPassword.status).toBe(400);
    expect(oversizedPassword.body.error.code).toBe('invalid_body');
  });

  it('rate limits repeated sign-in attempts by IP and account', async () => {
    process.env.DEV_AUTH = '0';
    const email = `rate-limit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const rejected = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
      expect(rejected.status).toBe(401);
    }

    const limited = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('reports auth mode on /api/health', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(['dev', 'authjs']).toContain(r.body.auth);
  });

  it('reports dev mode when the local stub is accepted even with AUTH_SECRET configured', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_AUTH = '1';

    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.auth).toBe('dev');
  });

  it('uses the seeded platform-admin fallback only with explicit local DEV_AUTH', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ONBOARDING_ALLOWED_EMAILS;
    process.env.DEV_AUTH = '0';
    expect(allowedPlatformAdminEmails()).toEqual([]);

    process.env.DEV_AUTH = '1';
    expect(allowedPlatformAdminEmails()).toEqual(['aroul303@gmail.com']);
  });

  it('fails closed when a production deployment accidentally sets DEV_AUTH=1', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_AUTH = '1';

    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.auth).toBe('authjs');

    const impersonated = await request(app).get('/api/me').set('x-dev-user', 'EMP-002');
    expect(impersonated.status).toBe(401);
    expect(impersonated.body.error.code).toBe('unauthenticated');
  });
});
