import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// Mock Firebase Admin before the app imports the auth middleware.
vi.mock('../lib/firebaseAdmin', () => ({
  firebaseAdminReady: vi.fn(() => true),
  initFirebaseAdmin: vi.fn(() => true),
  verifyIdToken: vi.fn(async (token: string) => {
    if (token === 'bad') throw Object.assign(new Error('invalid'), { code: 'auth/argument-error' });
    if (token === 'unknown') return { uid: 'fb-unknown', email: 'nobody@example.com', name: 'Nobody' };
    if (token === 'admin') return { uid: 'fb-admin', email: 'deepak.bansal@masspolymer.in', name: 'Deepak Bansal' };
    throw Object.assign(new Error('invalid'), { code: 'auth/argument-error' });
  }),
}));

import { buildApp } from '../app';
import { verifyIdToken } from '../lib/firebaseAdmin';

const app = buildApp();

describe('auth middleware (Phase B)', () => {
  const prev = process.env.DEV_AUTH;

  afterEach(() => {
    process.env.DEV_AUTH = prev;
    vi.clearAllMocks();
  });

  it('still accepts x-dev-user when DEV_AUTH is on and no Bearer is sent', async () => {
    process.env.DEV_AUTH = '1';
    const r = await request(app).get('/api/me').set('x-dev-user', 'EMP-002');
    expect(r.status).toBe(200);
    expect(r.body.user.employeeCode).toBe('EMP-002');
  });

  it('prefers a valid Bearer token over the stub', async () => {
    process.env.DEV_AUTH = '1';
    const r = await request(app).get('/api/me').set('Authorization', 'Bearer admin');
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe('deepak.bansal@masspolymer.in');
    expect(verifyIdToken).toHaveBeenCalledWith('admin');
  });

  it('rejects an invalid Bearer token', async () => {
    const r = await request(app).get('/api/me').set('Authorization', 'Bearer bad');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('invalid_token');
  });

  it('rejects a Firebase account with no directory membership', async () => {
    const r = await request(app).get('/api/me').set('Authorization', 'Bearer unknown');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('no_membership');
  });

  it('reports auth mode on /api/health', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(['dev', 'firebase', 'password']).toContain(r.body.auth);
  });
});
