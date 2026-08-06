import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app';
import { basePrisma } from '../db';
import { hashPassword, newSessionToken } from '../lib/password';
import { SESSION_MAX_AGE_SEC, sessionCookieName } from '../auth/config';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-auth-secret-min-32-characters!!';

const app = buildApp();

function cookieHeaderFromSetCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) return '';
  return raw.split(';')[0]; // name=value only
}

describe('auth middleware (Auth.js sessions)', () => {
  const prev = process.env.DEV_AUTH;

  afterEach(() => {
    process.env.DEV_AUTH = prev;
  });

  it('still accepts x-dev-user when DEV_AUTH is on and no session cookie', async () => {
    process.env.DEV_AUTH = '1';
    const r = await request(app).get('/api/me').set('x-dev-user', 'EMP-002');
    expect(r.status).toBe(200);
    expect(r.body.user.employeeCode).toBe('EMP-002');
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
    await basePrisma.user.update({
      where: { email },
      data: { passwordHash: await hashPassword(password) },
    });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe(email);
    const cookie = cookieHeaderFromSetCookie(login.headers['set-cookie']);
    expect(cookie).toContain(sessionCookieName());

    const me = await request(app)
      .get('/api/me')
      .set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('reports auth mode on /api/health', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(['dev', 'authjs']).toContain(r.body.auth);
  });
});
