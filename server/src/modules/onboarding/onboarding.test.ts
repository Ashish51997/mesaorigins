import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { basePrisma, withTenant } from '../../db';

const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 7);
let prevAllowed: string | undefined;
const ALLOWED_USER = 'deepak.bansal@masspolymer.in';
const BLOCKED_USER = 'nandlal@masspolymer.in';
const createdOrganizationIds = new Set<string>();
const createdUserEmails = new Set<string>();

function trackCreated(response: { status: number; body: { organization?: { id?: string }; owner?: { email?: string } } }) {
  if (response.status !== 201) return;
  if (response.body.organization?.id) createdOrganizationIds.add(response.body.organization.id);
  if (response.body.owner?.email) createdUserEmails.add(response.body.owner.email);
}

const serviceIdsForOrganization = async (organizationId: string) => (
  await basePrisma.organizationService.findMany({
    where: { organizationId },
    select: { serviceId: true },
    orderBy: { serviceId: 'asc' },
  })
).map(({ serviceId }) => serviceId);

const serviceStatus = async (serviceId: string) => (
  await basePrisma.service.findUnique({ where: { id: serviceId }, select: { status: true } })
)?.status;

beforeAll(() => {
  prevAllowed = process.env.ONBOARDING_ALLOWED_EMAILS;
  process.env.ONBOARDING_ALLOWED_EMAILS = ALLOWED_USER;
});
afterAll(async () => {
  try {
    await basePrisma.organization.deleteMany({ where: { id: { in: [...createdOrganizationIds] } } });
    await basePrisma.user.deleteMany({ where: { email: { in: [...createdUserEmails] } } });
  } finally {
    if (prevAllowed === undefined) delete process.env.ONBOARDING_ALLOWED_EMAILS;
    else process.env.ONBOARDING_ALLOWED_EMAILS = prevAllowed;
  }
});

describe('onboarding bootstrap', () => {
  it('allows the product owner route when the signed-in admin is on the allowlist', async () => {
    const slug = `client-${uniq()}`;
    const email = `owner.${uniq()}@example.com`;

    const access = await request(app).get('/api/onboarding/access').set('x-dev-user', ALLOWED_USER);
    expect(access.status).toBe(200);
    expect(access.body.allowed).toBe(true);

    const catalog = await request(app).get('/api/onboarding/services').set('x-dev-user', ALLOWED_USER);
    expect(catalog.status).toBe(200);
    expect(catalog.body.services.map((service: { id: string }) => service.id)).toEqual(['mesaops', 'mesaleads', 'mesaerp']);

    const list = await request(app).get('/api/onboarding/organizations').set('x-dev-user', ALLOWED_USER);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.organizations)).toBe(true);

    const r = await request(app)
      .post('/api/onboarding/bootstrap')
      .set('x-dev-user', ALLOWED_USER)
      .send({
        organizationName: 'Client Org',
        organizationSlug: slug,
        adminName: 'Client Owner',
        adminEmail: email,
        password: 'client-pass-123',
        serviceIds: ['mesaops', 'mesaleads'],
      });

    trackCreated(r);
    expect(r.status).toBe(201);
    expect(r.body.organization.slug).toBe(slug);
    expect(r.body.owner.email).toBe(email);
    expect(r.body.owner.role).toBe('Owner');
    expect(r.body.organization.services.map((service: { id: string }) => service.id)).toEqual(['mesaops', 'mesaleads']);

    const org = await basePrisma.organization.findUnique({ where: { slug } });
    expect(org?.name).toBe('Client Org');
    expect(await basePrisma.organizationService.count({ where: { organizationId: org?.id } })).toBe(2);

    await basePrisma.organization.update({
      where: { id: org!.id },
      data: {
        settings: {
          mesaLeadsProfile: {
            legalName: 'Client Org Private Limited',
            brandName: 'Client Org',
            summary: 'Customer-facing company summary.',
            website: '',
            emails: ['sales@client.test'],
            phones: ['+91 90000 00000'],
            contact: { name: 'Client Owner', title: 'Technical Director' },
            address: { line1: '1 Industrial Estate', line2: '', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001', country: 'India' },
            capabilities: ['Injection moulding'],
            branding: { logoUrl: '', primaryColor: '#12385B' },
          },
          privateValue: 'must-not-leak',
        },
      },
    });

    const update = await request(app)
      .put(`/api/onboarding/organizations/${org?.id}/services`)
      .set('x-dev-user', ALLOWED_USER)
      .send({ serviceIds: ['mesaops'] });
    expect(update.status).toBe(200);
    expect(update.body.services.map((service: { id: string }) => service.id)).toEqual(['mesaops']);

    const refreshed = await request(app).get('/api/onboarding/organizations').set('x-dev-user', ALLOWED_USER);
    const refreshedOrg = refreshed.body.organizations.find((item: { id: string }) => item.id === org?.id);
    expect(refreshedOrg.services.map((service: { id: string }) => service.id)).toEqual(['mesaops']);
    expect(refreshedOrg.mesaLeadsProfile.brandName).toBe('Client Org');
    expect(refreshedOrg.mesaLeadsProfile.capabilities).toEqual(['Injection moulding']);
    expect(refreshedOrg.privateValue).toBeUndefined();
  });

  it('defaults a newly onboarded organization to MesaOps when services are omitted', async () => {
    const slug = `default-service-${uniq()}`;
    const r = await request(app)
      .post('/api/onboarding/bootstrap')
      .set('x-dev-user', ALLOWED_USER)
      .send({
        organizationName: 'Default Service Org',
        organizationSlug: slug,
        adminName: 'Default Owner',
        adminEmail: `default.${uniq()}@example.com`,
        password: 'client-pass-123',
      });

    trackCreated(r);
    expect(r.status).toBe(201);
    expect(r.body.organization.services.map((service: { id: string }) => service.id)).toEqual(['mesaops']);
    expect(await serviceIdsForOrganization(r.body.organization.id)).toEqual(['mesaops']);
  });

  it('bootstraps only the narrow MesaERP company-creation grant for a new owner', async () => {
    const response = await request(app)
      .post('/api/onboarding/bootstrap')
      .set('x-dev-user', ALLOWED_USER)
      .send({
        organizationName: 'ERP Bootstrap Org',
        organizationSlug: `erp-bootstrap-${uniq()}`,
        adminName: 'ERP Bootstrap Owner',
        adminEmail: `erp.bootstrap.${uniq()}@example.com`,
        password: 'client-pass-123',
        serviceIds: ['mesaerp'],
      });

    trackCreated(response);
    expect(response.status).toBe(201);
    const organizationId = response.body.organization.id as string;
    const membershipId = response.body.owner.membershipId as string;
    const platformRole = await withTenant(organizationId, (tx) => tx.role.findUnique({
      where: { organizationId_name: { organizationId, name: 'MesaERP Platform Administrator' } },
      include: { permissions: { include: { permission: true } } },
    }));
    expect(platformRole).toMatchObject({ isAdmin: false, isSystem: true, erpLegalEntityId: null });
    expect(platformRole?.permissions.map((grant) => grant.permission.key)).toEqual(['mesaerp.legal_entity.manage']);
    expect(await withTenant(organizationId, (tx) => tx.roleAssignment.count({
      where: { organizationId, membershipId, roleId: platformRole?.id, serviceId: 'mesaerp', legalEntityId: null, status: 'active' },
    }))).toBe(1);
  });

  it('adds the same explicit MesaERP bootstrap grant when the service is enabled later', async () => {
    const created = await request(app)
      .post('/api/onboarding/bootstrap')
      .set('x-dev-user', ALLOWED_USER)
      .send({
        organizationName: 'ERP Later Org',
        organizationSlug: `erp-later-${uniq()}`,
        adminName: 'ERP Later Owner',
        adminEmail: `erp.later.${uniq()}@example.com`,
        password: 'client-pass-123',
        serviceIds: ['mesaops'],
      });
    trackCreated(created);
    expect(created.status).toBe(201);

    const organizationId = created.body.organization.id as string;
    const enabled = await request(app)
      .put(`/api/onboarding/organizations/${organizationId}/services`)
      .set('x-dev-user', ALLOWED_USER)
      .send({ serviceIds: ['mesaops', 'mesaerp'] });
    expect(enabled.status).toBe(200);

    const platformRole = await withTenant(organizationId, (tx) => tx.role.findUnique({
      where: { organizationId_name: { organizationId, name: 'MesaERP Platform Administrator' } },
    }));
    expect(platformRole).toMatchObject({ isAdmin: false, isSystem: true, erpLegalEntityId: null });
    expect(await withTenant(organizationId, (tx) => tx.roleAssignment.count({
      where: { organizationId, roleId: platformRole?.id, serviceId: 'mesaerp', legalEntityId: null, status: 'active' },
    }))).toBe(1);
  });

  it('never resets an existing account while onboarding another organization', async () => {
    const email = `shared-owner.${uniq()}@example.com`;
    const firstSlug = `first-owner-${uniq()}`;
    const first = await request(app)
      .post('/api/onboarding/bootstrap')
      .set('x-dev-user', ALLOWED_USER)
      .send({
        organizationName: 'First Owner Org',
        organizationSlug: firstSlug,
        adminName: 'Original Owner',
        adminEmail: email,
        password: 'original-pass-123',
      });
    trackCreated(first);
    expect(first.status).toBe(201);

    const before = await basePrisma.user.findUnique({ where: { email }, select: { name: true, passwordHash: true } });
    const secondSlug = `second-owner-${uniq()}`;
    const second = await request(app)
      .post('/api/onboarding/bootstrap')
      .set('x-dev-user', ALLOWED_USER)
      .send({
        organizationName: 'Second Owner Org',
        organizationSlug: secondSlug,
        adminName: 'Overwritten Owner',
        adminEmail: email,
        password: 'replacement-pass-456',
      });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('owner_email_exists');
    expect(await basePrisma.user.findUnique({ where: { email }, select: { name: true, passwordHash: true } })).toEqual(before);
    expect(await basePrisma.organization.findUnique({ where: { slug: secondSlug } })).toBeNull();
  });

  it('rejects unknown services during onboarding without creating the organization', async () => {
    const slug = `invalid-service-${uniq()}`;
    const r = await request(app)
      .post('/api/onboarding/bootstrap')
      .set('x-dev-user', ALLOWED_USER)
      .send({
        organizationName: 'Invalid Service Org',
        organizationSlug: slug,
        adminName: 'Invalid Service Owner',
        adminEmail: `invalid.${uniq()}@example.com`,
        password: 'client-pass-123',
        serviceIds: ['mesaops', 'service-does-not-exist'],
      });

    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_service');
    expect(await basePrisma.organization.findUnique({ where: { slug } })).toBeNull();
  });

  it('keeps all current assignments when a replacement contains an unknown service', async () => {
    const slug = `atomic-services-${uniq()}`;
    const created = await request(app)
      .post('/api/onboarding/bootstrap')
      .set('x-dev-user', ALLOWED_USER)
      .send({
        organizationName: 'Atomic Services Org',
        organizationSlug: slug,
        adminName: 'Atomic Owner',
        adminEmail: `atomic.${uniq()}@example.com`,
        password: 'client-pass-123',
        serviceIds: ['mesaops', 'mesaleads'],
      });
    trackCreated(created);
    expect(created.status).toBe(201);

    const organizationId = created.body.organization.id as string;
    const update = await request(app)
      .put(`/api/onboarding/organizations/${organizationId}/services`)
      .set('x-dev-user', ALLOWED_USER)
      .send({ serviceIds: ['mesaops', 'service-does-not-exist'] });

    expect(update.status).toBe(422);
    expect(update.body.error.code).toBe('invalid_service');
    expect(await serviceIdsForOrganization(organizationId)).toEqual(['mesaleads', 'mesaops']);
  });

  it('does not let a non-allowlisted user replace organization services', async () => {
    const created = await request(app)
      .post('/api/onboarding/bootstrap')
      .set('x-dev-user', ALLOWED_USER)
      .send({
        organizationName: 'Protected Services Org',
        organizationSlug: `protected-services-${uniq()}`,
        adminName: 'Protected Owner',
        adminEmail: `protected.${uniq()}@example.com`,
        password: 'client-pass-123',
      });
    trackCreated(created);
    expect(created.status).toBe(201);

    const organizationId = created.body.organization.id as string;
    const update = await request(app)
      .put(`/api/onboarding/organizations/${organizationId}/services`)
      .set('x-dev-user', BLOCKED_USER)
      .send({ serviceIds: ['mesaleads'] });

    expect(update.status).toBe(403);
    expect(update.body.error.code).toBe('forbidden');
    expect(await serviceIdsForOrganization(organizationId)).toEqual(['mesaops']);
  });

  it('returns not found when replacing services for an unknown organization', async () => {
    const update = await request(app)
      .put(`/api/onboarding/organizations/missing-${uniq()}/services`)
      .set('x-dev-user', ALLOWED_USER)
      .send({ serviceIds: ['mesaops'] });

    expect(update.status).toBe(404);
    expect(update.body.error.code).toBe('not_found');
  });

  it('blocks a non-allowlisted user', async () => {
    const access = await request(app).get('/api/onboarding/access').set('x-dev-user', BLOCKED_USER);
    expect(access.status).toBe(403);

    const r = await request(app)
      .post('/api/onboarding/bootstrap')
      .set('x-dev-user', BLOCKED_USER)
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

  it('lets the product owner change a global service status', async () => {
    const originalStatus = await serviceStatus('mesaops');
    expect(originalStatus).toBeDefined();

    try {
      for (const nextStatus of ['paused', 'stopped', 'active'] as const) {
        const update = await request(app)
          .put('/api/onboarding/services/mesaops/status')
          .set('x-dev-user', ALLOWED_USER)
          .send({ status: nextStatus });

        expect(update.status).toBe(200);
        expect(update.body).toMatchObject({ id: 'mesaops', status: nextStatus });
        expect(await serviceStatus('mesaops')).toBe(nextStatus);
      }

      const catalog = await request(app).get('/api/onboarding/services').set('x-dev-user', ALLOWED_USER);
      expect(catalog.status).toBe(200);
      expect(catalog.body.services.find((service: { id: string }) => service.id === 'mesaops')?.status).toBe('active');
    } finally {
      if (originalStatus) {
        await basePrisma.service.update({ where: { id: 'mesaops' }, data: { status: originalStatus } });
      }
    }
  });

  it('rejects an invalid global service status without writing it', async () => {
    const originalStatus = await serviceStatus('mesaops');
    const update = await request(app)
      .put('/api/onboarding/services/mesaops/status')
      .set('x-dev-user', ALLOWED_USER)
      .send({ status: 'retired' });

    expect(update.status).toBe(422);
    expect(update.body.error.code).toBe('validation');
    expect(await serviceStatus('mesaops')).toBe(originalStatus);
  });

  it('returns not found when changing the status of an unknown service', async () => {
    const update = await request(app)
      .put(`/api/onboarding/services/missing-${uniq()}/status`)
      .set('x-dev-user', ALLOWED_USER)
      .send({ status: 'stopped' });

    expect(update.status).toBe(404);
    expect(update.body.error.code).toBe('not_found');
  });

  it('does not let a non-allowlisted user change a global service status', async () => {
    const originalStatus = await serviceStatus('mesaops');
    const nextStatus = originalStatus === 'active' ? 'stopped' : 'active';
    const update = await request(app)
      .put('/api/onboarding/services/mesaops/status')
      .set('x-dev-user', BLOCKED_USER)
      .send({ status: nextStatus });

    expect(update.status).toBe(403);
    expect(update.body.error.code).toBe('forbidden');
    expect(await serviceStatus('mesaops')).toBe(originalStatus);
  });
});
