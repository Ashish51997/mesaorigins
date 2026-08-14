import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app';
import { basePrisma } from '../db';

const app = buildApp();
const ADMIN_EMAIL = 'deepak.bansal@masspolymer.in';

type Snapshot = {
  organizationId: string;
  organizationStatus: string;
  mesaOpsStatus: string;
  mesaLeadsStatus: string;
  mesaErpStatus: string;
  mesaOpsAssignmentStatus: string;
  mesaLeadsAssignmentStatus: string;
  mesaErpAssignmentStatus: string;
  mesaErpAssignmentExisted: boolean;
};

let snapshot: Snapshot;
let previousAllowedEmails: string | undefined;

async function setEntitlementsActive(): Promise<void> {
  await basePrisma.$transaction([
    basePrisma.organization.update({ where: { id: snapshot.organizationId }, data: { status: 'active' } }),
    basePrisma.service.update({ where: { id: 'mesaops' }, data: { status: 'active' } }),
    basePrisma.service.update({ where: { id: 'mesaleads' }, data: { status: 'active' } }),
    basePrisma.service.update({ where: { id: 'mesaerp' }, data: { status: 'active' } }),
    basePrisma.organizationService.update({
      where: { organizationId_serviceId: { organizationId: snapshot.organizationId, serviceId: 'mesaops' } },
      data: { status: 'active' },
    }),
    basePrisma.organizationService.upsert({
      where: { organizationId_serviceId: { organizationId: snapshot.organizationId, serviceId: 'mesaerp' } },
      create: { organizationId: snapshot.organizationId, serviceId: 'mesaerp', status: 'active' },
      update: { status: 'active' },
    }),
    basePrisma.organizationService.update({
      where: { organizationId_serviceId: { organizationId: snapshot.organizationId, serviceId: 'mesaleads' } },
      data: { status: 'active' },
    }),
  ]);
}

beforeAll(async () => {
  previousAllowedEmails = process.env.ONBOARDING_ALLOWED_EMAILS;
  process.env.ONBOARDING_ALLOWED_EMAILS = ADMIN_EMAIL;

  const membership = await basePrisma.membership.findFirst({
    where: { user: { email: ADMIN_EMAIL } },
    include: { organization: true },
  });
  if (!membership) throw new Error(`Seed membership for ${ADMIN_EMAIL} is required.`);

  const [mesaOps, mesaLeads, mesaErp, mesaOpsAssignment, mesaLeadsAssignment, mesaErpAssignment] = await Promise.all([
    basePrisma.service.findUnique({ where: { id: 'mesaops' } }),
    basePrisma.service.findUnique({ where: { id: 'mesaleads' } }),
    basePrisma.service.findUnique({ where: { id: 'mesaerp' } }),
    basePrisma.organizationService.findUnique({
      where: { organizationId_serviceId: { organizationId: membership.organizationId, serviceId: 'mesaops' } },
    }),
    basePrisma.organizationService.findUnique({
      where: { organizationId_serviceId: { organizationId: membership.organizationId, serviceId: 'mesaleads' } },
    }),
    basePrisma.organizationService.findUnique({
      where: { organizationId_serviceId: { organizationId: membership.organizationId, serviceId: 'mesaerp' } },
    }),
  ]);
  if (!mesaOps || !mesaLeads || !mesaErp || !mesaOpsAssignment || !mesaLeadsAssignment) {
    throw new Error('The seeded organization must be assigned both MesaOps and MesaLeads, and the MesaERP catalogue must exist.');
  }

  snapshot = {
    organizationId: membership.organizationId,
    organizationStatus: membership.organization.status,
    mesaOpsStatus: mesaOps.status,
    mesaLeadsStatus: mesaLeads.status,
    mesaErpStatus: mesaErp.status,
    mesaOpsAssignmentStatus: mesaOpsAssignment.status,
    mesaLeadsAssignmentStatus: mesaLeadsAssignment.status,
    mesaErpAssignmentStatus: mesaErpAssignment?.status ?? 'active',
    mesaErpAssignmentExisted: Boolean(mesaErpAssignment),
  };
  await setEntitlementsActive();
});

afterEach(async () => {
  await setEntitlementsActive();
});

afterAll(async () => {
  if (snapshot) {
    await basePrisma.$transaction([
      basePrisma.organization.update({
        where: { id: snapshot.organizationId },
        data: { status: snapshot.organizationStatus },
      }),
      basePrisma.service.update({ where: { id: 'mesaops' }, data: { status: snapshot.mesaOpsStatus } }),
      basePrisma.service.update({ where: { id: 'mesaleads' }, data: { status: snapshot.mesaLeadsStatus } }),
      basePrisma.service.update({ where: { id: 'mesaerp' }, data: { status: snapshot.mesaErpStatus } }),
      basePrisma.organizationService.update({
        where: { organizationId_serviceId: { organizationId: snapshot.organizationId, serviceId: 'mesaops' } },
        data: { status: snapshot.mesaOpsAssignmentStatus },
      }),
      basePrisma.organizationService.update({
        where: { organizationId_serviceId: { organizationId: snapshot.organizationId, serviceId: 'mesaleads' } },
        data: { status: snapshot.mesaLeadsAssignmentStatus },
      }),
      ...(snapshot.mesaErpAssignmentExisted ? [basePrisma.organizationService.update({
        where: { organizationId_serviceId: { organizationId: snapshot.organizationId, serviceId: 'mesaerp' } },
        data: { status: snapshot.mesaErpAssignmentStatus },
      })] : []),
    ]);
    if (!snapshot.mesaErpAssignmentExisted) {
      await basePrisma.organizationService.delete({
        where: { organizationId_serviceId: { organizationId: snapshot.organizationId, serviceId: 'mesaerp' } },
      });
    }
  }
  if (previousAllowedEmails === undefined) delete process.env.ONBOARDING_ALLOWED_EMAILS;
  else process.env.ONBOARDING_ALLOWED_EMAILS = previousAllowedEmails;
});

describe('MesaOps service entitlement gate', () => {
  it('makes the global MesaOps stop immediate without disabling onboarding or MesaLeads', async () => {
    const activeSummary = await request(app).get('/api/summary').set('x-dev-user', ADMIN_EMAIL);
    expect(activeSummary.status).toBe(200);

    // The shared filesystem bridge is permanently retired. Both methods must
    // remain unavailable even while MesaOps itself is active.
    const [retiredRead, retiredWrite] = await Promise.all([
      request(app).get('/api/data').set('x-dev-user', ADMIN_EMAIL),
      request(app).post('/api/data').set('x-dev-user', ADMIN_EMAIL).send({ customers: [] }),
    ]);
    for (const retired of [retiredRead, retiredWrite]) {
      expect(retired.status).toBe(404);
      expect(retired.body.error.code).toBe('not_found');
    }

    const stop = await request(app)
      .put('/api/onboarding/services/mesaops/status')
      .set('x-dev-user', ADMIN_EMAIL)
      .send({ status: 'stopped' });
    expect(stop.status).toBe(200);
    expect(stop.body).toMatchObject({ id: 'mesaops', status: 'stopped' });

    const [summary, health, publicQuestionnaire, me, onboarding, mesaLeads, mesaErp] = await Promise.all([
      request(app).get('/api/summary').set('x-dev-user', ADMIN_EMAIL),
      request(app).get('/api/health'),
      request(app).get('/api/public/mesaleads/forms/not-a-real-token'),
      request(app).get('/api/me').set('x-dev-user', ADMIN_EMAIL),
      request(app).get('/api/onboarding/services').set('x-dev-user', ADMIN_EMAIL),
      request(app).get('/api/mesaleads/summary').set('x-dev-user', ADMIN_EMAIL),
      request(app).get('/api/mesaerp/v1/entities').set('x-dev-user', ADMIN_EMAIL),
    ]);

    expect(summary.status).toBe(403);
    expect(summary.body.error.code).toBe('service_not_enabled');
    expect(health.status).toBe(200);
    expect(publicQuestionnaire.status).toBe(404);
    expect(publicQuestionnaire.body.error.code).toBe('not_found');
    expect(me.status).toBe(200);
    expect(onboarding.status).toBe(200);
    expect(mesaLeads.status).toBe(200);
    expect(mesaErp.status).toBe(200);
  });

  it('stops MesaERP without blocking MesaOps or MesaLeads', async () => {
    const stop = await request(app)
      .put('/api/onboarding/services/mesaerp/status')
      .set('x-dev-user', ADMIN_EMAIL)
      .send({ status: 'stopped' });
    expect(stop.status).toBe(200);

    const [erp, ops, leads] = await Promise.all([
      request(app).get('/api/mesaerp/v1/entities').set('x-dev-user', ADMIN_EMAIL),
      request(app).get('/api/summary').set('x-dev-user', ADMIN_EMAIL),
      request(app).get('/api/mesaleads/summary').set('x-dev-user', ADMIN_EMAIL),
    ]);
    expect(erp.status).toBe(403);
    expect(erp.body.error.code).toBe('service_not_enabled');
    expect(ops.status).toBe(200);
    expect(leads.status).toBe(200);
  });

  it('also fails closed for an inactive assignment or suspended organization', async () => {
    await basePrisma.organizationService.update({
      where: { organizationId_serviceId: { organizationId: snapshot.organizationId, serviceId: 'mesaops' } },
      data: { status: 'suspended' },
    });
    const assignmentBlocked = await request(app).get('/api/summary').set('x-dev-user', ADMIN_EMAIL);
    expect(assignmentBlocked.status).toBe(403);
    expect(assignmentBlocked.body.error.code).toBe('service_not_enabled');

    await basePrisma.organizationService.update({
      where: { organizationId_serviceId: { organizationId: snapshot.organizationId, serviceId: 'mesaops' } },
      data: { status: 'active' },
    });
    await basePrisma.organization.update({
      where: { id: snapshot.organizationId },
      data: { status: 'suspended' },
    });
    const organizationBlocked = await request(app).get('/api/summary').set('x-dev-user', ADMIN_EMAIL);
    expect(organizationBlocked.status).toBe(403);
    expect(organizationBlocked.body.error.code).toBe('service_not_enabled');
  });
});
