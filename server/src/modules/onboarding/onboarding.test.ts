import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { basePrisma } from '../../db';

const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 7);
const prevAllowed = process.env.ONBOARDING_ALLOWED_EMAILS;

beforeAll(() => {
  process.env.ONBOARDING_ALLOWED_EMAILS = 'deepak.bansal@masspolymer.in';
});
afterAll(() => {
  process.env.ONBOARDING_ALLOWED_EMAILS = prevAllowed;
});

describe('onboarding bootstrap', () => {
  it('allows the product owner route when the signed-in admin is on the allowlist', async () => {
    const slug = `client-${uniq()}`;
    const email = `owner.${uniq()}@example.com`;

    const access = await request(app).get('/api/onboarding/access').set('x-dev-user', 'deepak.bansal@masspolymer.in');
    expect(access.status).toBe(200);
    expect(access.body.allowed).toBe(true);

    const list = await request(app).get('/api/onboarding/organizations').set('x-dev-user', 'deepak.bansal@masspolymer.in');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.organizations)).toBe(true);

    const r = await request(app)
      .post('/api/onboarding/bootstrap')
      .set('x-dev-user', 'deepak.bansal@masspolymer.in')
      .send({
        organizationName: 'Client Org',
        organizationSlug: slug,
        adminName: 'Client Owner',
        adminEmail: email,
        password: 'client-pass-123',
      });

    expect(r.status).toBe(201);
    expect(r.body.organization.slug).toBe(slug);
    expect(r.body.owner.email).toBe(email);
    expect(r.body.owner.role).toBe('Owner');

    const org = await basePrisma.organization.findUnique({ where: { slug } });
    expect(org?.name).toBe('Client Org');
  });

  it('blocks a non-allowlisted user', async () => {
    const access = await request(app).get('/api/onboarding/access').set('x-dev-user', 'nandlal@masspolymer.in');
    expect(access.status).toBe(403);

    const r = await request(app)
      .post('/api/onboarding/bootstrap')
      .set('x-dev-user', 'nandlal@masspolymer.in')
      .send({
        organizationName: 'Blocked Org',
        organizationSlug: `blocked-${uniq()}`,
        adminName: 'Blocked User',
        adminEmail: `blocked.${uniq()}@example.com`,
        password: 'client-pass-123',
      });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('forbidden');
  });
});
