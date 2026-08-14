import express from 'express';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AuthenticatedUserContext } from '../../lib/authContext';
import { resolveTenant } from '../../middleware/tenant';
import { errorHandler } from '../../middleware/error';
import { createMesaErpRouter, MESAERP_PERMISSIONS } from '../router';
import { InMemoryMesaErpRepository } from '../repository';

function buildTestApp(permissionResolver = async (req: express.Request, permission: string) => (
  Boolean(req.user?.isAdmin || req.user?.screens.includes(permission))
)) {
  const app = express();
  const repository = new InMemoryMesaErpRepository();
  app.use(express.json());
  app.use((req, _res, next) => {
    const organizationId = req.header('x-test-org') || 'org-a';
    const screens = (req.header('x-test-screens') || '').split(',').map((value) => value.trim()).filter(Boolean);
    const serviceStatus = req.header('x-test-service') || 'active';
    const isAdmin = req.header('x-test-admin') === '1';
    const membershipId = req.header('x-test-membership') || `membership-${organizationId}`;
    const organization = {
      organizationId,
      organizationName: organizationId,
      organizationSlug: organizationId,
      membershipId,
      employeeCode: `employee-${organizationId}`,
      role: isAdmin ? 'Administrator' : 'Finance User',
      isAdmin,
      screens,
      services: [{ id: 'mesaerp', name: 'MesaERP', description: '', status: serviceStatus, sortOrder: 30 }],
    };
    req.user = {
      userId: `user-${organizationId}`,
      email: `${organizationId}@example.test`,
      name: organizationId,
      ...organization,
      organizations: [organization],
    } satisfies AuthenticatedUserContext;
    next();
  });
  app.use(resolveTenant);
  app.use('/api/mesaerp', createMesaErpRouter(repository, permissionResolver,
    async (req) => Boolean(req.user?.isAdmin || req.user?.screens.some((permission) => permission.startsWith('mesaerp.')))));
  app.use(errorHandler);
  return app;
}

const balancedVoucher = {
  voucherType: 'journal',
  voucherDate: '2026-08-14',
  currencyCode: 'INR',
  narration: 'Accrue factory power cost',
  lines: [
    { ledgerAccountId: 'power-expense', debit: '1250.50', credit: '0' },
    { ledgerAccountId: 'accrued-expense', debit: '0', credit: '1250.50' },
  ],
};

async function createEntity(app: express.Express, organizationId = 'org-a') {
  const result = await request(app).post('/api/mesaerp/entities')
    .set('x-test-org', organizationId)
    .set('x-test-admin', '1')
    .set('Idempotency-Key', `entity-${organizationId}`)
    .send({ code: organizationId === 'org-a' ? 'MFG01' : 'MFG02', name: `${organizationId} Manufacturing` });
  expect(result.status).toBe(201);
  return result.body as { id: string };
}

describe('MesaERP accounting foundation', () => {
  it('does not let a legacy organization administrator bypass an exact finance permission', async () => {
    const app = buildTestApp(async () => false);
    const response = await request(app).get('/api/mesaerp/entities/company-a/accounts')
      .set('x-test-admin', '1');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('forbidden');
  });

  it('is service-entitled and hides companies from actors without an explicit MesaERP grant', async () => {
    const app = buildTestApp();
    const denied = await request(app).get('/api/mesaerp/entities');
    expect(denied.status).toBe(200);
    expect(denied.body).toEqual([]);

    const permitted = await request(app).get('/api/mesaerp/entities')
      .set('x-test-screens', MESAERP_PERMISSIONS.voucherRead);
    expect(permitted.status).toBe(200);

    await createEntity(app);
    const vendorOnly = await request(app).get('/api/mesaerp/entities')
      .set('x-test-screens', 'mesaerp.vendor.read');
    expect(vendorOnly.status).toBe(200);
    expect(vendorOnly.body).toHaveLength(1);

    const noEntitlement = await request(app).get('/api/mesaerp/entities')
      .set('x-test-screens', MESAERP_PERMISSIONS.voucherRead)
      .set('x-test-service', 'suspended');
    expect(noEntitlement.status).toBe(403);
    expect(noEntitlement.body.error.code).toBe('service_not_entitled');
  });

  it('requires decimal strings and balanced debit/credit lines', async () => {
    const app = buildTestApp();
    const entity = await createEntity(app);
    const missingIdempotencyKey = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers`)
      .set('x-test-admin', '1').send(balancedVoucher);
    expect(missingIdempotencyKey.status).toBe(400);
    expect(missingIdempotencyKey.body.error.code).toBe('idempotency_key_required');

    const numericAmount = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers`)
      .set('x-test-admin', '1').set('Idempotency-Key', 'numeric-amount-1')
      .send({ ...balancedVoucher, lines: [{ ledgerAccountId: 'a', debit: 10, credit: '0' }, { ledgerAccountId: 'b', debit: '0', credit: '10' }] });
    expect(numericAmount.status).toBe(422);

    const unbalanced = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers`)
      .set('x-test-admin', '1').set('Idempotency-Key', 'unbalanced-1')
      .send({ ...balancedVoucher, lines: [{ ledgerAccountId: 'a', debit: '10', credit: '0' }, { ledgerAccountId: 'b', debit: '0', credit: '9.99' }] });
    expect(unbalanced.status).toBe(422);
    expect(JSON.stringify(unbalanced.body.error.details)).toContain('debits');

    const foreignCurrency = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers`)
      .set('x-test-admin', '1').set('Idempotency-Key', 'foreign-currency-1')
      .send({ ...balancedVoucher, currencyCode: 'USD' });
    expect(foreignCurrency.status).toBe(422);
    expect(foreignCurrency.body.error.code).toBe('foreign_currency_not_supported');
  });

  it('posts one immutable balanced journal and makes retries idempotent', async () => {
    const app = buildTestApp();
    const entity = await createEntity(app);
    const create = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers`)
      .set('x-test-admin', '1').set('Idempotency-Key', 'voucher-create-1').send(balancedVoucher);
    expect(create.status).toBe(201);

    const replay = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers`)
      .set('x-test-admin', '1').set('Idempotency-Key', 'voucher-create-1').send(balancedVoucher);
    expect(replay.body.id).toBe(create.body.id);

    const conflict = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers`)
      .set('x-test-admin', '1').set('Idempotency-Key', 'voucher-create-1')
      .send({ ...balancedVoucher, narration: 'Different payload' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('idempotency_conflict');

    const draftPost = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers/${create.body.id}/post`)
      .set('x-test-admin', '1').set('Idempotency-Key', 'voucher-post-draft').send({ expectedVersion: 0 });
    expect(draftPost.status).toBe(409);
    expect(draftPost.body.error.code).toBe('voucher_not_postable');

    const submitted = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers/${create.body.id}/submit`)
      .set('x-test-admin', '1').set('Idempotency-Key', 'voucher-submit-1').send({ expectedVersion: 0 });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('submitted');

    const selfApproval = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers/${create.body.id}/approve`)
      .set('x-test-admin', '1').set('Idempotency-Key', 'voucher-approve-self').send({ expectedVersion: 1 });
    expect(selfApproval.status).toBe(409);
    expect(selfApproval.body.error.code).toBe('maker_checker_required');

    const approved = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers/${create.body.id}/approve`)
      .set('x-test-admin', '1').set('x-test-membership', 'membership-checker')
      .set('Idempotency-Key', 'voucher-approve-1').send({ expectedVersion: 1 });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');

    const [firstPost, duplicatePost] = await Promise.all([
      request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers/${create.body.id}/post`)
        .set('x-test-admin', '1').set('x-test-membership', 'membership-checker')
        .set('Idempotency-Key', 'voucher-post-1').send({ expectedVersion: 2 }),
      request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers/${create.body.id}/post`)
        .set('x-test-admin', '1').set('x-test-membership', 'membership-checker')
        .set('Idempotency-Key', 'voucher-post-1').send({ expectedVersion: 2 }),
    ]);
    expect(firstPost.status).toBe(200);
    expect(duplicatePost.status).toBe(200);
    expect(duplicatePost.body.journalEntry.id).toBe(firstPost.body.journalEntry.id);
    expect(firstPost.body.voucher.voucherNumber).toMatch(/^MFG01-JRN-2026-27-000001$/);
    expect(firstPost.body.voucher.snapshotHash).toMatch(/^[a-f0-9]{64}$/);

    const journal = await request(app).get(`/api/mesaerp/entities/${entity.id}/vouchers/${create.body.id}/journal-entry`)
      .set('x-test-admin', '1');
    expect(journal.status).toBe(200);
    expect(journal.body.lines).toEqual(firstPost.body.journalEntry.lines);

    const editPosted = await request(app).patch(`/api/mesaerp/entities/${entity.id}/vouchers/${create.body.id}`)
      .set('x-test-admin', '1').set('Idempotency-Key', 'voucher-edit-after-post')
      .send({ expectedVersion: 3, narration: 'Rewrite history' });
    expect(editPosted.status).toBe(409);
    expect(editPosted.body.error.code).toBe('posted_immutable');

    const reversal = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers/${create.body.id}/reversals`)
      .set('x-test-admin', '1').set('x-test-membership', 'membership-reversal-maker')
      .set('Idempotency-Key', 'voucher-reversal-create-1')
      .send({ expectedVersion: 3, voucherDate: '2026-08-14', reason: 'Correct the approved accrual entry' });
    expect(reversal.status).toBe(201);
    expect(reversal.body).toMatchObject({ status: 'draft', reversalOfId: create.body.id });
    expect(reversal.body.lines).toEqual(firstPost.body.voucher.lines.map((line: { debit: string; credit: string }) => ({
      ...line,
      debit: line.credit,
      credit: line.debit,
    })));

    const submittedReversal = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers/${reversal.body.id}/submit`)
      .set('x-test-admin', '1').set('x-test-membership', 'membership-reversal-maker')
      .set('Idempotency-Key', 'voucher-reversal-submit-1').send({ expectedVersion: 0 });
    expect(submittedReversal.status).toBe(200);
    const approvedReversal = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers/${reversal.body.id}/approve`)
      .set('x-test-admin', '1').set('x-test-membership', 'membership-reversal-checker')
      .set('Idempotency-Key', 'voucher-reversal-approve-1').send({ expectedVersion: 1 });
    expect(approvedReversal.status).toBe(200);
    const postedReversal = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers/${reversal.body.id}/post`)
      .set('x-test-admin', '1').set('x-test-membership', 'membership-reversal-checker')
      .set('Idempotency-Key', 'voucher-reversal-post-1').send({ expectedVersion: 2 });
    expect(postedReversal.status).toBe(200);
    expect(postedReversal.body.voucher.status).toBe('posted');

    const originalAfterReversal = await request(app).get(`/api/mesaerp/entities/${entity.id}/vouchers/${create.body.id}`)
      .set('x-test-admin', '1');
    expect(originalAfterReversal.body.status).toBe('reversed');
    expect(originalAfterReversal.body.reversedAt).toBeTruthy();
  });

  it('does not expose one organization legal entity or voucher to another', async () => {
    const app = buildTestApp();
    const entity = await createEntity(app, 'org-a');
    const create = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers`)
      .set('x-test-org', 'org-a').set('x-test-admin', '1').set('Idempotency-Key', 'voucher-tenant-a').send(balancedVoucher);
    expect(create.status).toBe(201);

    const crossTenantRead = await request(app).get(`/api/mesaerp/entities/${entity.id}/vouchers/${create.body.id}`)
      .set('x-test-org', 'org-b').set('x-test-admin', '1');
    expect(crossTenantRead.status).toBe(404);

    const crossTenantCreate = await request(app).post(`/api/mesaerp/entities/${entity.id}/vouchers`)
      .set('x-test-org', 'org-b').set('x-test-admin', '1').set('Idempotency-Key', 'voucher-tenant-b').send(balancedVoucher);
    expect(crossTenantCreate.status).toBe(404);
    expect(crossTenantCreate.body.error.code).toBe('legal_entity_not_found');
  });
});
