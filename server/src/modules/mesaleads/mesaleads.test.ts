import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { basePrisma, withTenant } from '../../db';

const app = buildApp();
const run = Math.random().toString(36).slice(2, 9);
const orgA = { id: `ml-org-a-${run}`, slug: `ml-a-${run}`, email: `ml-a-${run}@example.com` };
const orgB = { id: `ml-org-b-${run}`, slug: `ml-b-${run}`, email: `ml-b-${run}@example.com` };
const blockedEmail = `ml-blocked-${run}@example.com`;
let attachmentId = '';
let originalMesaLeadsStatus: string | null = null;
const nextSubmissionKey = () => `submission_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

const auth = (email: string) => ({ 'x-dev-user': email });

beforeAll(async () => {
  originalMesaLeadsStatus = (
    await basePrisma.service.findUnique({ where: { id: 'mesaleads' }, select: { status: true } })
  )?.status ?? null;
  await basePrisma.service.upsert({
    where: { id: 'mesaleads' },
    update: { status: 'active' },
    create: { id: 'mesaleads', name: 'MesaLeads', description: 'Lead management.', status: 'active', sortOrder: 20 },
  });
  for (const [index, item] of [orgA, orgB].entries()) {
    await basePrisma.organization.create({ data: { id: item.id, name: `MesaLeads Test ${index + 1}`, slug: item.slug } });
    const user = await basePrisma.user.create({ data: { email: item.email, name: `MesaLeads Owner ${index + 1}` } });
    await basePrisma.membership.create({
      data: {
        id: `ml-mem-${index}-${run}`,
        organizationId: item.id,
        userId: user.id,
        employeeCode: `ML-${index}-${run}`,
        department: 'Sales',
        role: 'Owner',
      },
    });
  }
  const blocked = await basePrisma.user.create({ data: { email: blockedEmail, name: 'MesaLeads Blocked Member' } });
  await basePrisma.membership.create({
    data: {
      id: `ml-blocked-${run}`, organizationId: orgA.id, userId: blocked.id,
      employeeCode: `ML-BLOCK-${run}`, department: 'Production', role: 'Operator',
    },
  });
  await basePrisma.organizationService.create({ data: { organizationId: orgA.id, serviceId: 'mesaleads', status: 'active' } });
});

afterAll(async () => {
  await basePrisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await basePrisma.user.deleteMany({ where: { email: { in: [orgA.email, orgB.email, blockedEmail] } } });
  if (originalMesaLeadsStatus === null) {
    await basePrisma.service.deleteMany({ where: { id: 'mesaleads' } });
  } else {
    await basePrisma.service.update({ where: { id: 'mesaleads' }, data: { status: originalMesaLeadsStatus } });
  }
});

const formBody = {
  name: 'IMM qualification',
  description: 'Customer requirement form',
  privacyNotice: 'We use this information only to prepare and follow up your quotation.',
  questions: [
    { key: 'customer_name', type: 'short_text', label: 'Customer name', required: true },
    { key: 'requirement_scope', type: 'single_select', label: 'Scope', required: true, options: ['machine_only', 'machine_mold', 'mold_only'] },
    {
      key: 'mold_details', type: 'long_text', label: 'Mold details', required: true,
      visibilityRule: { questionKey: 'requirement_scope', operator: 'not_equals', value: 'machine_only' },
    },
    { key: 'sample', type: 'file', label: 'Product sample' },
  ],
};

async function createPublishedForm(email = orgA.email) {
  const created = await request(app).post('/api/mesaleads/forms').set(auth(email)).send(formBody);
  expect(created.status).toBe(201);
  const published = await request(app).post(`/api/mesaleads/forms/${created.body.id}/publish`).set(auth(email));
  expect(published.status).toBe(200);
  return published.body as { form: { id: string }; link: { id: string; token: string } };
}

describe('MesaLeads service entitlement and public forms', () => {
  it('denies a protected route when MesaLeads is not active', async () => {
    const result = await request(app).get('/api/mesaleads/summary').set(auth(orgB.email));
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe('service_not_enabled');
  });

  it('denies lead PII to an entitled organization member without a sales permission', async () => {
    const result = await request(app).get('/api/mesaleads/leads').set(auth(blockedEmail));
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe('forbidden');
  });

  it('validates answers, replays retries idempotently and lets a generic link create distinct leads', async () => {
    const published = await createPublishedForm();
    const opened = await request(app).get(`/api/public/mesaleads/forms/${published.link.token}`);
    expect(opened.status).toBe(200);
    expect(opened.headers['cache-control']).toBe('no-store');
    expect(opened.headers['referrer-policy']).toBe('no-referrer');
    expect(opened.body.form.questions.map((question: { key: string }) => question.key)).toEqual([
      'customer_name', 'requirement_scope', 'mold_details', 'sample',
    ]);
    expect(opened.body.form.questions[0]).not.toHaveProperty('id');
    expect(opened.body.form.questions[0]).not.toHaveProperty('organizationId');
    expect(opened.body.form.questions[0]).not.toHaveProperty('formId');

    const missing = await request(app)
      .post(`/api/public/mesaleads/forms/${published.link.token}`)
      .send({ submissionKey: nextSubmissionKey(), answers: { requirement_scope: 'machine_mold' }, consent: true });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('invalid_answers');
    expect(missing.body.error.details.fieldErrors).toMatchObject({ customer_name: expect.any(String), mold_details: expect.any(String) });

    const withoutConsent = await request(app)
      .post(`/api/public/mesaleads/forms/${published.link.token}`)
      .send({ submissionKey: nextSubmissionKey(), answers: { customer_name: 'Asha', requirement_scope: 'machine_only' } });
    expect(withoutConsent.status).toBe(422);

    const disguisedUpload = await request(app)
      .post(`/api/public/mesaleads/forms/${published.link.token}`)
      .send({
        submissionKey: nextSubmissionKey(),
        answers: { customer_name: 'Asha', requirement_scope: 'machine_only' },
        attachments: [{
          questionKey: 'sample', fileName: 'sample.png', mimeType: 'image/png',
          dataBase64: Buffer.from('not a png').toString('base64'),
        }],
        consent: true,
      });
    expect(disguisedUpload.status).toBe(422);
    expect(disguisedUpload.body.error.code).toBe('invalid_upload');

    const submit = (submissionKey = nextSubmissionKey()) => request(app)
      .post(`/api/public/mesaleads/forms/${published.link.token}`)
      .send({
        submissionKey,
        respondent: { name: 'Asha', email: 'asha@example.com', phone: '9000000000' },
        answers: { customer_name: 'Asha', requirement_scope: 'machine_only' },
        consent: true,
      });
    const retryKey = nextSubmissionKey();
    const first = await submit(retryKey);
    const replay = await submit(retryKey);
    const second = await submit();
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(second.status).toBe(201);
    expect(second.body.leadId).not.toBe(first.body.leadId);

    const revoked = await request(app)
      .post(`/api/mesaleads/form-links/${published.link.id}/revoke`)
      .set(auth(orgA.email));
    expect(revoked.status).toBe(200);
    const afterRevoke = await request(app).get(`/api/public/mesaleads/forms/${published.link.token}`);
    expect(afterRevoke.status).toBe(410);
    expect(afterRevoke.body.error.code).toBe('link_revoked');
  });

  it('atomically creates a lead with its selected template and keeps the same URL for the durable customer journey', async () => {
    const published = await createPublishedForm();
    const internalFollowUp = new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000).toISOString();
    const created = await request(app).post('/api/mesaleads/leads').set(auth(orgA.email)).send({
      formId: published.form.id, source: 'indiamart', contactName: 'Invited Customer', product: 'Moulded cap',
      scope: 'machine_mold', followUpNote: 'Private sales note', nextFollowUpAt: internalFollowUp,
    });
    expect(created.status).toBe(201);
    expect(created.body.lead).toMatchObject({ stage: 'questionnaire_sent', formId: published.form.id });
    expect(created.body.lead.form).toMatchObject({ id: published.form.id, revision: 1, status: 'published' });
    expect(created.body.link).toMatchObject({ kind: 'invitation', status: 'active', leadId: created.body.lead.id });
    expect(created.body.link.token).toMatch(/^[A-Za-z0-9_-]{40,100}$/);
    expect(created.body.link).not.toHaveProperty('tokenHash');
    const token = created.body.link.token as string;

    const opened = await request(app).get(`/api/public/mesaleads/forms/${token}`);
    expect(opened.status).toBe(200);
    expect(opened.body.mode).toBe('form');
    expect(opened.body.prefill).toEqual({
      customer_name: 'Invited Customer',
      requirement_scope: 'machine_mold',
    });
    expect(opened.body.lead).toBeUndefined();

    const submission = {
      submissionKey: nextSubmissionKey(),
      answers: { customer_name: 'Invited Customer', requirement_scope: 'machine_mold', mold_details: '2 cavity mould' },
      consent: true,
    };
    const attempts = await Promise.all([
      request(app).post(`/api/public/mesaleads/forms/${token}`).send(submission),
      request(app).post(`/api/public/mesaleads/forms/${token}`).send(submission),
    ]);
    expect(attempts.map((attempt) => attempt.status)).toEqual([201, 201]);
    expect(attempts[0].body).toEqual(attempts[1].body);
    expect(attempts[0].body.leadId).toBe(created.body.lead.id);
    expect(attempts[0].body.journeyPath).toBe(created.body.link.publicPath);

    const sequentialReplay = await request(app)
      .post(`/api/public/mesaleads/forms/${token}`)
      .send(submission);
    expect(sequentialReplay.status).toBe(201);
    expect(sequentialReplay.body).toEqual(attempts[0].body);

    const journeyLink = await basePrisma.leadFormLink.findUniqueOrThrow({ where: { id: created.body.link.id } });
    expect(journeyLink.status).toBe('submitted');
    expect(journeyLink.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 364 * 24 * 60 * 60 * 1_000);

    const portal = await request(app).get(`/api/public/mesaleads/forms/${token}`);
    expect(portal.status).toBe(200);
    expect(portal.body.mode).toBe('portal');

    const nextUpdateAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1_000).toISOString();
    const internal = await request(app).post(`/api/mesaleads/leads/${created.body.lead.id}/activities`).set(auth(orgA.email)).send({
      type: 'note', title: 'Private review', note: 'Never show this note to the customer.',
    });
    expect(internal.status).toBe(201);
    const customerUpdate = await request(app).post(`/api/mesaleads/leads/${created.body.lead.id}/activities`).set(auth(orgA.email)).send({
      type: 'customer_update', title: 'Technical review scheduled', note: 'Our engineer will review your specifications.', nextUpdateAt,
    });
    expect(customerUpdate.status).toBe(201);
    expect(customerUpdate.body.metadata).toEqual({ nextUpdateAt });
    const updatedPortal = await request(app).get(`/api/public/mesaleads/forms/${token}`);
    expect(updatedPortal.body.portal.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'customer_update', title: 'Technical review scheduled', nextUpdateAt }),
    ]));
    expect(JSON.stringify(updatedPortal.body.portal)).not.toContain('Never show this note');
    expect(JSON.stringify(updatedPortal.body.portal)).not.toContain('Private sales note');
    const detail = await request(app).get(`/api/mesaleads/leads/${created.body.lead.id}`).set(auth(orgA.email));
    expect(new Date(detail.body.nextFollowUpAt).toISOString()).toBe(internalFollowUp);
    const replacement = await request(app)
      .post(`/api/mesaleads/forms/${published.form.id}/links`)
      .set(auth(orgA.email))
      .send({ kind: 'invitation', leadId: created.body.lead.id });
    expect(replacement.status).toBe(409);
    expect(replacement.body.error.code).toBe('journey_link_exists');

    const closed = await request(app).put(`/api/mesaleads/leads/${created.body.lead.id}`).set(auth(orgA.email)).send({
      version: detail.body.version, stage: 'lost', lostReason: 'Private qualification reason',
    });
    expect(closed.status).toBe(200);
    const closedPortal = await request(app).get(`/api/public/mesaleads/forms/${token}`);
    expect(closedPortal.body.portal.review).toMatchObject({ status: 'closed' });
    expect(JSON.stringify(closedPortal.body.portal)).not.toContain('Private qualification reason');

    const distinctRetry = await request(app)
      .post(`/api/public/mesaleads/forms/${token}`)
      .send({ ...submission, submissionKey: nextSubmissionKey() });
    expect(distinctRetry.status).toBe(410);
    expect(distinctRetry.body.error.code).toBe('link_submitted');

    const revoked = await request(app)
      .post(`/api/mesaleads/form-links/${created.body.link.id}/revoke`)
      .set(auth(orgA.email));
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe('revoked');
    const afterRevocation = await request(app).get(`/api/public/mesaleads/forms/${token}`);
    expect(afterRevocation.status).toBe(410);
    expect(afterRevocation.body.error.code).toBe('link_revoked');
  });

  it('keeps a published form immutable and clones it into the next draft revision', async () => {
    const published = await createPublishedForm();
    const edited = await request(app)
      .put(`/api/mesaleads/forms/${published.form.id}`)
      .set(auth(orgA.email))
      .send({ name: 'Mutated published form' });
    expect(edited.status).toBe(409);
    expect(edited.body.error.code).toBe('form_immutable');

    const cloned = await request(app)
      .post(`/api/mesaleads/forms/${published.form.id}/clone`)
      .set(auth(orgA.email));
    expect(cloned.status).toBe(201);
    expect(cloned.body.status).toBe('draft');
    expect(cloned.body.revision).toBe(2);
    expect(cloned.body.questions.map((question: { key: string }) => question.key)).toEqual([
      'customer_name', 'requirement_scope', 'mold_details', 'sample',
    ]);
  });

  it('rejects unavailable or foreign templates without leaving an orphan lead', async () => {
    const before = await withTenant(orgA.id, (tx) => tx.mesaLead.count({ where: { organizationId: orgA.id } }));
    const draft = await request(app).post('/api/mesaleads/forms').set(auth(orgA.email)).send(formBody);
    expect(draft.status).toBe(201);
    const foreign = await withTenant(orgB.id, (tx) => tx.leadForm.create({
      data: { organizationId: orgB.id, name: 'Foreign published template', status: 'published', publishedAt: new Date() },
    }));

    const missing = await request(app).post('/api/mesaleads/leads').set(auth(orgA.email)).send({
      formId: `missing-${run}`, contactName: 'Must roll back',
    });
    const unpublished = await request(app).post('/api/mesaleads/leads').set(auth(orgA.email)).send({
      formId: draft.body.id, contactName: 'Must roll back',
    });
    const crossTenant = await request(app).post('/api/mesaleads/leads').set(auth(orgA.email)).send({
      formId: foreign.id, contactName: 'Must roll back',
    });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('invalid_form');
    expect(unpublished.status).toBe(409);
    expect(unpublished.body.error.code).toBe('form_not_published');
    expect(crossTenant.status).toBe(422);
    expect(crossTenant.body.error.code).toBe('invalid_form');
    expect(await withTenant(orgA.id, (tx) => tx.mesaLead.count({ where: { organizationId: orgA.id } }))).toBe(before);
  });

  it('serializes competing invitation creation and keeps one journey per lead', async () => {
    const published = await createPublishedForm();
    const target = await withTenant(orgA.id, (tx) => tx.mesaLead.create({
      data: { organizationId: orgA.id, reference: `ML-CONCURRENT-${run}`, contactName: 'Concurrent link customer' },
    }));
    const attempts = await Promise.all([
      request(app).post(`/api/mesaleads/forms/${published.form.id}/links`).set(auth(orgA.email)).send({ kind: 'invitation', leadId: target.id }),
      request(app).post(`/api/mesaleads/forms/${published.form.id}/links`).set(auth(orgA.email)).send({ kind: 'invitation', leadId: target.id }),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 409]);
    expect(attempts.find((attempt) => attempt.status === 409)?.body.error.code).toBe('journey_link_exists');
    expect(await basePrisma.leadFormLink.count({
      where: { leadId: target.id, kind: 'invitation', status: { in: ['active', 'submitted'] } },
    })).toBe(1);
  });

  it('rejects a concurrent lead write that carries a stale version', async () => {
    const published = await createPublishedForm();
    const created = await request(app)
      .post('/api/mesaleads/leads')
      .set(auth(orgA.email))
      .send({ formId: published.form.id, contactName: 'Versioned Lead' });
    expect(created.status).toBe(201);
    const attempts = await Promise.all([
      request(app).put(`/api/mesaleads/leads/${created.body.lead.id}`).set(auth(orgA.email)).send({ version: created.body.lead.version, contactName: 'Writer A' }),
      request(app).put(`/api/mesaleads/leads/${created.body.lead.id}`).set(auth(orgA.email)).send({ version: created.body.lead.version, contactName: 'Writer B' }),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([200, 409]);
    expect(attempts.find((attempt) => attempt.status === 409)?.body.error.code).toBe('version_conflict');
  });

  it('stops protected and public access when an organization or global service is disabled', async () => {
    const published = await createPublishedForm();
    await basePrisma.organizationService.update({
      where: { organizationId_serviceId: { organizationId: orgA.id, serviceId: 'mesaleads' } },
      data: { status: 'suspended' },
    });
    try {
      const opened = await request(app).get(`/api/public/mesaleads/forms/${published.link.token}`);
      expect(opened.status).toBe(403);
      expect(opened.body.error.code).toBe('service_not_enabled');
    } finally {
      await basePrisma.organizationService.update({
        where: { organizationId_serviceId: { organizationId: orgA.id, serviceId: 'mesaleads' } },
        data: { status: 'active' },
      });
    }

    await basePrisma.service.update({ where: { id: 'mesaleads' }, data: { status: 'stopped' } });
    try {
      const protectedRoute = await request(app).get('/api/mesaleads/summary').set(auth(orgA.email));
      expect(protectedRoute.status).toBe(403);
      expect(protectedRoute.body.error.code).toBe('service_not_enabled');

      const globallyStopped = await request(app).get(`/api/public/mesaleads/forms/${published.link.token}`);
      expect(globallyStopped.status).toBe(403);
      expect(globallyStopped.body.error.code).toBe('service_not_enabled');
    } finally {
      await basePrisma.service.update({ where: { id: 'mesaleads' }, data: { status: 'active' } });
    }
  });

  it('archives a form and invalidates all of its active links', async () => {
    const published = await createPublishedForm();
    const archived = await request(app)
      .post(`/api/mesaleads/forms/${published.form.id}/archive`)
      .set(auth(orgA.email));
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe('archived');
    const opened = await request(app).get(`/api/public/mesaleads/forms/${published.link.token}`);
    expect(opened.status).toBe(410);
    expect(opened.body.error.code).toBe('link_revoked');
  });

  it('serves verified uploads only through the protected tenant download route', async () => {
    const published = await createPublishedForm();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const submitted = await request(app)
      .post(`/api/public/mesaleads/forms/${published.link.token}`)
      .send({
        submissionKey: nextSubmissionKey(),
        answers: { customer_name: 'Upload Customer', requirement_scope: 'machine_only' },
        attachments: [{ questionKey: 'sample', fileName: '../../payload.exe', mimeType: 'image/png', dataBase64: png.toString('base64') }],
        consent: true,
      });
    expect(submitted.status).toBe(201);

    const detail = await request(app).get(`/api/mesaleads/leads/${submitted.body.leadId}`).set(auth(orgA.email));
    attachmentId = detail.body.submissions[0].attachments[0].id;
    const download = await request(app).get(`/api/mesaleads/attachments/${attachmentId}`).set(auth(orgA.email));
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('image/png');
    expect(download.headers['content-disposition']).toContain('attachment;');
    expect(download.headers['content-disposition']).toContain('payload.png');
    expect(download.headers['content-disposition']).not.toContain('.exe');
    expect(download.headers['content-disposition']).not.toContain('../');
    expect(download.headers['x-content-type-options']).toBe('nosniff');

    const publicAttempt = await request(app).get(`/api/public/mesaleads/attachments/${attachmentId}`);
    expect(publicAttempt.status).toBe(404);
  });

  it('keeps lead reads isolated between entitled tenants', async () => {
    const publishedA = await createPublishedForm();
    await basePrisma.organizationService.create({ data: { organizationId: orgB.id, serviceId: 'mesaleads', status: 'active' } });
    const publishedB = await createPublishedForm(orgB.email);
    const leadA = await request(app).post('/api/mesaleads/leads').set(auth(orgA.email)).send({ formId: publishedA.form.id, contactName: 'Tenant A' });
    const leadB = await request(app).post('/api/mesaleads/leads').set(auth(orgB.email)).send({ formId: publishedB.form.id, contactName: 'Tenant B' });
    expect(leadA.status).toBe(201);
    expect(leadB.status).toBe(201);

    const crossA = await request(app).get(`/api/mesaleads/leads/${leadB.body.lead.id}`).set(auth(orgA.email));
    const crossB = await request(app).get(`/api/mesaleads/leads/${leadA.body.lead.id}`).set(auth(orgB.email));
    expect(crossA.status).toBe(404);
    expect(crossB.status).toBe(404);

    const crossAttachment = await request(app).get(`/api/mesaleads/attachments/${attachmentId}`).set(auth(orgB.email));
    expect(crossAttachment.status).toBe(404);

    const crossForm = await request(app).get(`/api/mesaleads/forms/${publishedA.form.id}`).set(auth(orgB.email));
    expect(crossForm.status).toBe(404);
    const crossFormUpdate = await request(app)
      .put(`/api/mesaleads/forms/${publishedA.form.id}`)
      .set(auth(orgB.email))
      .send({ name: 'Cross-tenant mutation' });
    expect(crossFormUpdate.status).toBe(404);
    const crossRevoke = await request(app)
      .post(`/api/mesaleads/form-links/${publishedA.link.id}/revoke`)
      .set(auth(orgB.email));
    expect(crossRevoke.status).toBe(404);
  });
});
