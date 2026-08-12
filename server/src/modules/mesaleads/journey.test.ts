import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { buildApp } from '../../app';
import { basePrisma, withTenant } from '../../db';
import { customerDecisionsConfigured } from './service';

const app = buildApp();
const run = Math.random().toString(36).slice(2, 9);
const org = { id: `mlj-org-${run}`, slug: `mlj-${run}`, email: `owner-${run}@example.com` };
const auth = { 'x-dev-user': org.email };
const key = (prefix: string) => `${prefix}_${run}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
const originalDecisionSecret = process.env.MESALEADS_DECISION_CODE_SECRET;
const originalDecisionTestCode = process.env.MESALEADS_DECISION_TEST_CODE;
const originalWebhook = process.env.MESALEADS_DECISION_WEBHOOK_URL;
let originalMesaLeadsStatus: string | null = null;
let portalToken = '';
let leadId = '';
let quoteId = '';

beforeAll(async () => {
  originalMesaLeadsStatus = (await basePrisma.service.findUnique({ where: { id: 'mesaleads' }, select: { status: true } }))?.status ?? null;
  await basePrisma.service.upsert({
    where: { id: 'mesaleads' }, update: { status: 'active' },
    create: { id: 'mesaleads', name: 'MesaLeads', description: 'Lead management.', status: 'active', sortOrder: 20 },
  });
  await basePrisma.organization.create({
    data: {
      id: org.id, name: 'Journey Test Machinery', slug: org.slug,
      settings: {
        mesaLeadsProfile: {
          legalName: 'Journey Test Machinery Private Limited', brandName: 'Journey Test',
          summary: 'Customer-safe profile.', website: '', emails: ['sales@example.com'], phones: ['+91-9000000000'],
          contact: { name: 'Sales Director', title: 'Director' },
          address: { line1: 'Industrial Estate', line2: '', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001', country: 'India' },
          capabilities: ['Injection moulding'], branding: { logoUrl: '', primaryColor: '#12385B' },
          internalOnly: 'must never be public',
        },
      },
    },
  });
  const user = await basePrisma.user.create({ data: { email: org.email, name: 'Journey Owner' } });
  await basePrisma.membership.create({ data: { organizationId: org.id, userId: user.id, employeeCode: `MLJ-${run}`, role: 'Owner', department: 'Sales' } });
  await basePrisma.organizationService.create({ data: { organizationId: org.id, serviceId: 'mesaleads' } });
});

afterAll(async () => {
  if (originalDecisionSecret === undefined) delete process.env.MESALEADS_DECISION_CODE_SECRET;
  else process.env.MESALEADS_DECISION_CODE_SECRET = originalDecisionSecret;
  if (originalDecisionTestCode === undefined) delete process.env.MESALEADS_DECISION_TEST_CODE;
  else process.env.MESALEADS_DECISION_TEST_CODE = originalDecisionTestCode;
  if (originalWebhook === undefined) delete process.env.MESALEADS_DECISION_WEBHOOK_URL;
  else process.env.MESALEADS_DECISION_WEBHOOK_URL = originalWebhook;
  const directUrl = process.env.DIRECT_DATABASE_URL;
  if (!directUrl) throw new Error('DIRECT_DATABASE_URL is required to purge commercial test evidence.');
  const cleanupPrisma = new PrismaClient({ datasources: { db: { url: directUrl } } });
  try {
    await cleanupPrisma.organization.deleteMany({ where: { id: org.id } });
  } finally {
    await cleanupPrisma.$disconnect();
  }
  await basePrisma.user.deleteMany({ where: { email: org.email } });
  if (originalMesaLeadsStatus === null) await basePrisma.service.deleteMany({ where: { id: 'mesaleads' } });
  else await basePrisma.service.update({ where: { id: 'mesaleads' }, data: { status: originalMesaLeadsStatus } });
});

async function createJourney() {
  const form = await request(app).post('/api/mesaleads/forms').set(auth).send({
    name: 'Customer requirement', privacyNotice: 'We use this enquiry to prepare a quotation.',
    questions: [
      { key: 'customer_name', type: 'short_text', label: 'Customer name', required: true },
      { key: 'email', type: 'email', label: 'Email', required: true },
      { key: 'product', type: 'short_text', label: 'Product', required: true },
    ],
  });
  expect(form.status).toBe(201);
  const published = await request(app).post(`/api/mesaleads/forms/${form.body.id}/publish`).set(auth);
  expect(published.status).toBe(200);
  const submitted = await request(app).post(`/api/public/mesaleads/forms/${published.body.link.token}`).send({
    submissionKey: key('submission'), respondent: { name: 'Customer Signer', email: 'customer@example.com' },
    answers: { customer_name: 'Customer Signer', email: 'customer@example.com', product: 'Crate plant' }, consent: true,
  });
  expect(submitted.status).toBe(201);
  expect(submitted.body.portalToken).toEqual(expect.any(String));
  return { token: submitted.body.portalToken as string, leadId: submitted.body.leadId as string };
}

const quoteBody = (idempotencyKey: string, send = true) => ({
  idempotencyKey, title: 'Techno-commercial offer', currency: 'INR', validUntil: '2099-12-31',
  summary: 'Servo injection moulding machine and crate mould.', organizationRemarks: 'GST is extra.',
  terms: [{ label: 'Payment', value: '50% with PO; 50% before dispatch.' }], send,
  lineItems: [
    { description: '500T servo IMM', specification: 'Recommended for heavy-duty crates', hsnSacCode: '8477', quantity: '1', unit: 'nos', unitPrice: '5550000', discountAmount: '50000', taxRate: '18' },
  ],
});

describe('MesaLeads customer quote and fulfillment journey', () => {
  it('never allows the development test code to bypass production delivery', () => {
    const nodeEnv = process.env.NODE_ENV;
    const devAuth = process.env.DEV_AUTH;
    const secret = process.env.MESALEADS_DECISION_CODE_SECRET;
    const testCode = process.env.MESALEADS_DECISION_TEST_CODE;
    const webhook = process.env.MESALEADS_DECISION_WEBHOOK_URL;
    try {
      process.env.NODE_ENV = 'production';
      process.env.DEV_AUTH = '1';
      process.env.MESALEADS_DECISION_CODE_SECRET = 'journey-test-secret-that-is-at-least-32-characters';
      process.env.MESALEADS_DECISION_TEST_CODE = '314159';
      delete process.env.MESALEADS_DECISION_WEBHOOK_URL;
      expect(customerDecisionsConfigured()).toBe(false);
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
      if (devAuth === undefined) delete process.env.DEV_AUTH; else process.env.DEV_AUTH = devAuth;
      if (secret === undefined) delete process.env.MESALEADS_DECISION_CODE_SECRET; else process.env.MESALEADS_DECISION_CODE_SECRET = secret;
      if (testCode === undefined) delete process.env.MESALEADS_DECISION_TEST_CODE; else process.env.MESALEADS_DECISION_TEST_CODE = testCode;
      if (webhook === undefined) delete process.env.MESALEADS_DECISION_WEBHOOK_URL; else process.env.MESALEADS_DECISION_WEBHOOK_URL = webhook;
    }
  });

  it('creates a generic per-lead portal and sends a server-calculated immutable quote', async () => {
    const journey = await createJourney();
    portalToken = journey.token;
    leadId = journey.leadId;
    const createKey = key('quote-create');
    const created = await request(app).post(`/api/mesaleads/leads/${leadId}/quotes`).set(auth).send(quoteBody(createKey));
    expect(created.status).toBe(201);
    quoteId = created.body.id;
    expect(created.body).toMatchObject({ versionNumber: 1, status: 'sent', subtotal: '5550000', discountTotal: '50000', taxTotal: '990000', grandTotal: '6490000' });

    const replay = await request(app).post(`/api/mesaleads/leads/${leadId}/quotes`).set(auth).send(quoteBody(createKey));
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(quoteId);
    const conflictingReplay = await request(app).post(`/api/mesaleads/leads/${leadId}/quotes`).set(auth).send({ ...quoteBody(createKey), title: 'Different payload' });
    expect(conflictingReplay.status).toBe(409);
    expect(conflictingReplay.body.error.code).toBe('idempotency_conflict');

    const immutable = await request(app).patch(`/api/mesaleads/leads/${leadId}/quotes/${quoteId}`).set(auth).send({ rowVersion: created.body.rowVersion, title: 'Mutated issued quote' });
    expect(immutable.status).toBe(409);
    expect(immutable.body.error.code).toBe('quote_immutable');

    await expect(withTenant(org.id, async (tx) => {
      // The former runtime GUC must no longer permit deletion. Only the table
      // owner reached through DIRECT_DATABASE_URL may perform a legal purge.
      await tx.$executeRaw`SELECT set_config('app.allow_commercial_purge', 'true', true)`;
      await tx.leadQuote.delete({ where: { id: quoteId } });
    })).rejects.toThrow();
  });

  it('returns only explicit customer-safe fields and fails closed without decision delivery', async () => {
    process.env.MESALEADS_DECISION_CODE_SECRET = 'journey-test-secret-that-is-at-least-32-characters';
    delete process.env.MESALEADS_DECISION_TEST_CODE;
    delete process.env.MESALEADS_DECISION_WEBHOOK_URL;
    const portal = await request(app).get(`/api/public/mesaleads/portal/${portalToken}`);
    expect(portal.status).toBe(200);
    expect(portal.body.mode).toBe('portal');
    expect(portal.body.portal.organization).toEqual(expect.objectContaining({ name: 'Journey Test Machinery' }));
    expect(portal.body.portal.organization).not.toHaveProperty('id');
    expect(portal.body.portal.organization).not.toHaveProperty('slug');
    expect(portal.body.portal.organization.profile).not.toHaveProperty('internalOnly');
    expect(portal.body.portal.decision).toMatchObject({ decisionAllowed: false, verificationRequired: true });
    expect(portal.body.portal.quotes[0]).toEqual(expect.objectContaining({ quoteActionId: quoteId, customerMessage: 'GST is extra.', quoteRowVersion: expect.any(Number) }));
    for (const field of ['id', 'leadId', 'organizationId', 'organizationRemarks', 'createIdempotencyKey', 'acceptedByEmail', 'acceptanceText']) {
      expect(portal.body.portal.quotes[0]).not.toHaveProperty(field);
    }
    expect(portal.body.portal.timeline[0]).not.toHaveProperty('id');
    const unavailable = await request(app).post(`/api/public/mesaleads/portal/${portalToken}/decision-challenges`).send({ email: 'customer@example.com' });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe('decision_verification_unavailable');

    const concurrent = await Promise.all([
      request(app).get(`/api/public/mesaleads/portal/${portalToken}`),
      request(app).get(`/api/public/mesaleads/portal/${portalToken}`),
    ]);
    expect(concurrent.map((response) => response.status)).toEqual([200, 200]);
  });

  it('rechecks entitlement and portal revocation under transaction locks', async () => {
    let releaseEntitlement!: () => void;
    let entitlementLocked!: () => void;
    const entitlementGate = new Promise<void>((resolve) => { releaseEntitlement = resolve; });
    const entitlementReady = new Promise<void>((resolve) => { entitlementLocked = resolve; });
    const stop = basePrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "OrganizationService" WHERE "organizationId" = ${org.id} AND "serviceId" = 'mesaleads' FOR UPDATE`;
      entitlementLocked();
      await entitlementGate;
      await tx.organizationService.update({
        where: { organizationId_serviceId: { organizationId: org.id, serviceId: 'mesaleads' } },
        data: { status: 'suspended' },
      });
    });
    await entitlementReady;
    const stoppedRead = request(app).get(`/api/public/mesaleads/portal/${portalToken}`).then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseEntitlement();
    await stop;
    const stoppedResponse = await stoppedRead;
    await basePrisma.organizationService.update({
      where: { organizationId_serviceId: { organizationId: org.id, serviceId: 'mesaleads' } },
      data: { status: 'active' },
    });
    expect(stoppedResponse.status).toBe(403);

    const portal = await basePrisma.leadPortalLink.findUniqueOrThrow({
      where: { tokenHash: createHash('sha256').update(portalToken).digest('hex') },
    });
    let releasePortal!: () => void;
    let portalLocked!: () => void;
    const portalGate = new Promise<void>((resolve) => { releasePortal = resolve; });
    const portalReady = new Promise<void>((resolve) => { portalLocked = resolve; });
    const revoke = basePrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "LeadPortalLink" WHERE "id" = ${portal.id} FOR UPDATE`;
      portalLocked();
      await portalGate;
      await tx.leadPortalLink.update({ where: { id: portal.id }, data: { status: 'revoked' } });
    });
    await portalReady;
    const revokedRead = request(app).get(`/api/public/mesaleads/portal/${portalToken}`).then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    releasePortal();
    await revoke;
    const revokedResponse = await revokedRead;
    await basePrisma.leadPortalLink.update({ where: { id: portal.id }, data: { status: 'active' } });
    expect(revokedResponse.status).toBe(410);
  });

  it('keeps webhook delivery failure indistinguishable and leaves no usable challenge', async () => {
    const webhook = createServer((_req, res) => { res.statusCode = 500; res.end('failed'); });
    await new Promise<void>((resolve) => webhook.listen(0, '127.0.0.1', resolve));
    const address = webhook.address();
    if (!address || typeof address === 'string') throw new Error('Test webhook did not bind.');
    const nodeEnv = process.env.NODE_ENV;
    const testCode = process.env.MESALEADS_DECISION_TEST_CODE;
    try {
      process.env.NODE_ENV = 'production';
      process.env.MESALEADS_DECISION_CODE_SECRET = 'journey-test-secret-that-is-at-least-32-characters';
      process.env.MESALEADS_DECISION_WEBHOOK_URL = `http://127.0.0.1:${address.port}/verify`;
      delete process.env.MESALEADS_DECISION_TEST_CODE;
      const failedDelivery = await request(app).post(`/api/public/mesaleads/portal/${portalToken}/decision-challenges`).send({ email: 'customer@example.com' });
      const mismatch = await request(app).post(`/api/public/mesaleads/portal/${portalToken}/decision-challenges`).send({ email: 'wrong@example.com' });
      expect(failedDelivery.status).toBe(202);
      expect(mismatch.status).toBe(202);
      expect(Object.keys(failedDelivery.body).sort()).toEqual(Object.keys(mismatch.body).sort());
      expect(failedDelivery.body).not.toHaveProperty('devVerificationCode');
      const stored = await withTenant(org.id, (tx) => tx.leadDecisionChallenge.findUnique({ where: { id: failedDelivery.body.challengeId } }));
      expect(stored).toBeNull();
    } finally {
      await new Promise<void>((resolve) => webhook.close(() => resolve()));
      if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
      if (testCode === undefined) delete process.env.MESALEADS_DECISION_TEST_CODE; else process.env.MESALEADS_DECISION_TEST_CODE = testCode;
      delete process.env.MESALEADS_DECISION_WEBHOOK_URL;
    }
  });

  it('uses indistinguishable challenges, persists attempt limits and approves atomically', async () => {
    process.env.MESALEADS_DECISION_CODE_SECRET = 'journey-test-secret-that-is-at-least-32-characters';
    process.env.MESALEADS_DECISION_TEST_CODE = '314159';
    const mismatch = await request(app).post(`/api/public/mesaleads/portal/${portalToken}/decision-challenges`).send({ email: 'wrong@example.com' });
    const challenge = await request(app).post(`/api/public/mesaleads/portal/${portalToken}/decision-challenges`).send({ email: 'customer@example.com' });
    expect(mismatch.status).toBe(202);
    expect(challenge.status).toBe(202);
    expect(Object.keys(mismatch.body).sort()).toEqual(Object.keys(challenge.body).sort());
    expect(challenge.body.devVerificationCode).toBe('314159');

    const quote = await request(app).get(`/api/public/mesaleads/portal/${portalToken}`);
    const quoteRowVersion = quote.body.portal.quotes[0].quoteRowVersion;
    const decisionKey = key('approve');
    const decision = {
      decision: 'approve', remark: 'Approved as offered.', idempotencyKey: decisionKey, quoteRowVersion,
      acceptanceConfirmed: true, signerName: 'Customer Signer', signerEmail: 'customer@example.com',
      challengeId: challenge.body.challengeId, verificationCode: '000000',
    };
    const wrongCode = await request(app).post(`/api/public/mesaleads/portal/${portalToken}/quotes/${quoteId}/decision`).send(decision);
    expect(wrongCode.status).toBe(422);
    expect(wrongCode.body.error.code).toBe('verification_invalid');
    const attempts = await withTenant(org.id, (tx) => tx.leadDecisionChallenge.findUnique({ where: { id: challenge.body.challengeId }, select: { attempts: true } }));
    expect(attempts?.attempts).toBe(1);

    const approved = await request(app).post(`/api/public/mesaleads/portal/${portalToken}/quotes/${quoteId}/decision`).send({ ...decision, verificationCode: '314159' });
    expect(approved.status).toBe(200);
    expect(approved.body.portal.review.status).toBe('approved');
    expect(approved.body.portal.quotes[0].status).toBe('approved');
    expect(approved.body.portal.fulfillment.status).toBe('not_started');
    expect(approved.body.portal.fulfillment.milestones.map((item: { name: string }) => item.name)).toEqual([
      'Order confirmed', 'Advance payment', 'Technical confirmation', 'Machine/mould production',
      'Factory acceptance/trial', 'Ready for dispatch', 'Dispatch', 'Installation & commissioning', 'Training/handover',
    ]);

    const replay = await request(app).post(`/api/public/mesaleads/portal/${portalToken}/quotes/${quoteId}/decision`).send({ ...decision, verificationCode: '314159' });
    expect(replay.status).toBe(200);
    const conflictingReplay = await request(app).post(`/api/public/mesaleads/portal/${portalToken}/quotes/${quoteId}/decision`).send({ ...decision, verificationCode: '314159', signerName: 'Different signer' });
    expect(conflictingReplay.status).toBe(409);
    expect(conflictingReplay.body.error.code).toBe('idempotency_conflict');
  });

  it('updates only customer-safe fulfillment progress with optimistic concurrency', async () => {
    const detail = await request(app).get(`/api/mesaleads/leads/${leadId}`).set(auth);
    const fulfillment = detail.body.fulfillment;
    const update = await request(app).patch(`/api/mesaleads/leads/${leadId}/fulfillment`).set(auth).send({
      rowVersion: fulfillment.rowVersion, status: 'in_progress', customerSummary: 'Technical confirmation is underway.', estimatedCompletionDate: '2099-11-30',
    });
    expect(update.status).toBe(200);
    const milestone = update.body.milestones[0];
    const milestoneUpdate = await request(app).patch(`/api/mesaleads/leads/${leadId}/fulfillment/milestones/${milestone.id}`).set(auth).send({
      rowVersion: milestone.rowVersion, status: 'completed', customerNote: 'Order acknowledgement shared.',
    });
    expect(milestoneUpdate.status).toBe(200);
    const stale = await request(app).patch(`/api/mesaleads/leads/${leadId}/fulfillment/milestones/${milestone.id}`).set(auth).send({ rowVersion: milestone.rowVersion, status: 'blocked' });
    expect(stale.status).toBe(409);
    const portal = await request(app).get(`/api/public/mesaleads/portal/${portalToken}`);
    expect(portal.body.portal.fulfillment).toMatchObject({ status: 'in_progress', customerSummary: 'Technical confirmation is underway.' });
    expect(portal.body.portal.fulfillment.milestones[0]).toMatchObject({ status: 'completed', customerNote: 'Order acknowledgement shared.' });
    expect(portal.body.portal.fulfillment.milestones[0]).not.toHaveProperty('organizationId');
    expect(portal.body.portal.fulfillment.milestones[0]).not.toHaveProperty('rowVersion');
  });

  it('records a customer revision request and sends the next monotonic version', async () => {
    const journey = await createJourney();
    const first = await request(app).post(`/api/mesaleads/leads/${journey.leadId}/quotes`).set(auth).send(quoteBody(key('revision-quote')));
    expect(first.status).toBe(201);
    const challenge = await request(app).post(`/api/public/mesaleads/portal/${journey.token}/decision-challenges`).send({ email: 'customer@example.com' });
    expect(challenge.status).toBe(202);
    const requested = await request(app).post(`/api/public/mesaleads/portal/${journey.token}/quotes/${first.body.id}/decision`).send({
      decision: 'request_revision', remark: 'Please include installation in the scope.', idempotencyKey: key('revision-request'),
      quoteRowVersion: first.body.rowVersion, acceptanceConfirmed: false, signerName: '', signerEmail: 'customer@example.com',
      challengeId: challenge.body.challengeId, verificationCode: '314159',
    });
    expect(requested.status).toBe(200);
    expect(requested.body.portal.review.status).toBe('revision_requested');

    const detail = await request(app).get(`/api/mesaleads/leads/${journey.leadId}`).set(auth);
    const source = detail.body.quotes.find((quote: { id: string }) => quote.id === first.body.id);
    const revision = await request(app).post(`/api/mesaleads/leads/${journey.leadId}/quotes/${first.body.id}/revise`).set(auth).send({
      rowVersion: source.rowVersion, idempotencyKey: key('revise'),
    });
    expect(revision.status).toBe(201);
    expect(revision.body).toMatchObject({ versionNumber: 2, status: 'draft' });
    const updated = await request(app).patch(`/api/mesaleads/leads/${journey.leadId}/quotes/${revision.body.id}`).set(auth).send({
      rowVersion: revision.body.rowVersion, organizationRemarks: 'GST extra. Installation supervision included.',
    });
    expect(updated.status).toBe(200);
    const sent = await request(app).post(`/api/mesaleads/leads/${journey.leadId}/quotes/${revision.body.id}/send`).set(auth).send({
      rowVersion: updated.body.rowVersion, idempotencyKey: key('send-revision'),
    });
    expect(sent.status).toBe(200);
    const portal = await request(app).get(`/api/public/mesaleads/portal/${journey.token}`);
    expect(portal.body.portal.quotes.map((quote: { versionNumber: number; status: string }) => [quote.versionNumber, quote.status])).toEqual([
      [2, 'sent'], [1, 'superseded'],
    ]);
    expect(portal.body.portal.quotes[0].customerMessage).toContain('Installation supervision included');
  });
});
