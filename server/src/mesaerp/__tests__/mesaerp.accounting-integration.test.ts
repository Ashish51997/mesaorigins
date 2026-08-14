import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { basePrisma, withTenant } from '../../db';

const app = buildApp();
const OWNER = 'vikram.malhotra@masspolymer.in';
const CHECKER = 'deepak.bansal@masspolymer.in';
const ORGANIZATION_ID = 'org-demo';
const uniqueKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
let entitlementBefore: { status: string } | null = null;

beforeAll(async () => {
  entitlementBefore = await basePrisma.organizationService.findUnique({
    where: { organizationId_serviceId: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp' } },
    select: { status: true },
  });
  await basePrisma.organizationService.upsert({
    where: { organizationId_serviceId: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp' } },
    create: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp', status: 'active' },
    update: { status: 'active' },
  });
});

afterAll(async () => {
  if (entitlementBefore) {
    await basePrisma.organizationService.update({
      where: { organizationId_serviceId: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp' } },
      data: { status: entitlementBefore.status },
    });
  } else {
    await basePrisma.organizationService.delete({
      where: { organizationId_serviceId: { organizationId: ORGANIZATION_ID, serviceId: 'mesaerp' } },
    });
  }
});

describe('MesaERP Prisma accounting lifecycle', () => {
  it('posts an audited voucher and corrects it through a separately approved reversal', async () => {
    const suffix = uniqueKey('accounting');
    const entities = await request(app).get('/api/mesaerp/v1/entities').set('x-dev-user', OWNER);
    expect(entities.status).toBe(200);
    const entity = (entities.body as Array<{ id: string }>).find((candidate) => candidate.id === 'entity-demo');
    expect(entity).toBeTruthy();
    const entityId = entity!.id;
    const accounts = await request(app).get(`/api/mesaerp/v1/entities/${entityId}/accounts`).set('x-dev-user', OWNER);
    expect(accounts.status).toBe(200);
    const overheadAccountId = accounts.body.find((account: { code: string }) => account.code === '5300')?.id as string;
    const payableAccountId = accounts.body.find((account: { code: string }) => account.code === '2000')?.id as string;
    expect(overheadAccountId).toBeTruthy();
    expect(payableAccountId).toBeTruthy();
    const draft = await request(app)
      .post(`/api/mesaerp/v1/entities/${entityId}/vouchers`)
      .set('x-dev-user', OWNER)
      .set('Idempotency-Key', `${suffix}-create`)
      .send({
        voucherType: 'journal',
        voucherDate: '2026-08-14',
        currencyCode: 'INR',
        reference: suffix,
        narration: 'Manufacturing overhead accrual integration evidence',
        lines: [
          { ledgerAccountId: overheadAccountId, debit: '725.50', credit: '0', narration: '', dimensions: {} },
          { ledgerAccountId: payableAccountId, debit: '0', credit: '725.50', narration: '', dimensions: {} },
        ],
      });
    expect(draft.status).toBe(201);

    const submitted = await request(app)
      .post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${draft.body.id}/submit`)
      .set('x-dev-user', OWNER)
      .set('Idempotency-Key', `${suffix}-submit`)
      .send({ expectedVersion: 0 });
    expect(submitted.body.status).toBe('submitted');

    const approved = await request(app)
      .post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${draft.body.id}/approve`)
      .set('x-dev-user', CHECKER)
      .set('Idempotency-Key', `${suffix}-approve`)
      .send({ expectedVersion: 1 });
    expect(approved.body.status).toBe('approved');

    const posted = await request(app)
      .post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${draft.body.id}/post`)
      .set('x-dev-user', CHECKER)
      .set('Idempotency-Key', `${suffix}-post`)
      .send({ expectedVersion: 2 });
    expect(posted.status).toBe(200);
    expect(posted.body.voucher.status).toBe('posted');
    expect(posted.body.voucher.snapshotHash).toMatch(/^[a-f0-9]{64}$/);

    const reversal = await request(app)
      .post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${draft.body.id}/reversals`)
      .set('x-dev-user', OWNER)
      .set('Idempotency-Key', `${suffix}-reverse`)
      .send({ expectedVersion: 3, voucherDate: '2026-08-14', reason: 'Reverse the accrual through controlled correction' });
    expect(reversal.status).toBe(201);
    expect(reversal.body).toMatchObject({ status: 'draft', reversalOfId: draft.body.id });
    expect(reversal.body.lines[0]).toMatchObject({ debit: '0', credit: '725.5' });

    const reversalSubmitted = await request(app)
      .post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${reversal.body.id}/submit`)
      .set('x-dev-user', OWNER)
      .set('Idempotency-Key', `${suffix}-reverse-submit`)
      .send({ expectedVersion: 0 });
    expect(reversalSubmitted.body.status).toBe('submitted');
    const reversalApproved = await request(app)
      .post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${reversal.body.id}/approve`)
      .set('x-dev-user', CHECKER)
      .set('Idempotency-Key', `${suffix}-reverse-approve`)
      .send({ expectedVersion: 1 });
    expect(reversalApproved.body.status).toBe('approved');
    const reversalPosted = await request(app)
      .post(`/api/mesaerp/v1/entities/${entityId}/vouchers/${reversal.body.id}/post`)
      .set('x-dev-user', CHECKER)
      .set('Idempotency-Key', `${suffix}-reverse-post`)
      .send({ expectedVersion: 2 });
    expect(reversalPosted.body.voucher.status).toBe('posted');

    const original = await request(app)
      .get(`/api/mesaerp/v1/entities/${entityId}/vouchers/${draft.body.id}`)
      .set('x-dev-user', OWNER);
    expect(original.body.status).toBe('reversed');
    expect(original.body.reversedAt).toBeTruthy();

    const evidence = await withTenant(ORGANIZATION_ID, (tx) => tx.auditEvent.findMany({
      where: { entityId: { in: [draft.body.id, reversal.body.id] } },
      select: { action: true },
    }));
    expect(evidence.map((event) => event.action)).toEqual(expect.arrayContaining([
      'mesaerp.voucher.create',
      'mesaerp.voucher.submit',
      'mesaerp.voucher.approve',
      'mesaerp.voucher.post',
      'mesaerp.voucher.reversal.create',
      'mesaerp.voucher.reverse',
    ]));
  });
});
