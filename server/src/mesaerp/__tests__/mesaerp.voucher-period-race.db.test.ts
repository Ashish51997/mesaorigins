import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { tenantContext } from '../../lib/tenantContext';
import { PrismaMesaErpRepository } from '../prismaRepository';

const enabled = process.env.RUN_MESAERP_DB_INTEGRATION === '1';
const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const unique = () => `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

afterAll(async () => { await direct.$disconnect(); });

describe.skipIf(!enabled)('MesaERP voucher and accounting-period concurrency', () => {
  it('waits for a concurrent period close and rejects posting after rechecking the locked row', async () => {
    const run = unique();
    const organizationId = `period-race-org-${run}`;
    const legalEntityId = `period-race-entity-${run}`;
    const financialYearId = `period-race-fy-${run}`;
    const periodId = `period-race-period-${run}`;
    const voucherId = `period-race-voucher-${run}`;
    const debitAccountId = `period-race-debit-${run}`;
    const creditAccountId = `period-race-credit-${run}`;
    const makerId = `period-race-maker-${run}`;
    const checkerId = `period-race-checker-${run}`;

    await direct.organization.create({ data: { id: organizationId, name: 'Period race fixture', slug: organizationId } });
    await direct.$transaction(async (db) => {
      await db.$executeRaw(Prisma.sql`SELECT set_config('app.current_tenant', ${organizationId}, true)`);
      await db.legalEntity.create({ data: {
        id: legalEntityId, organizationId, code: `PR${Date.now()}`, legalName: 'Period Race Company',
        createIdempotencyKey: `entity-${run}`, requestHash: 'a'.repeat(64),
      } });
      await db.financialYear.create({ data: {
        id: financialYearId, organizationId, legalEntityId, code: '2026-27',
        startsOn: new Date('2026-04-01T00:00:00.000Z'), endsOn: new Date('2027-03-31T00:00:00.000Z'),
      } });
      await db.accountingPeriod.create({ data: {
        id: periodId, organizationId, legalEntityId, financialYearId, periodNumber: 5, name: 'August 2026',
        startsOn: new Date('2026-08-01T00:00:00.000Z'), endsOn: new Date('2026-08-31T00:00:00.000Z'),
      } });
      await db.erpAccount.createMany({ data: [
        { id: debitAccountId, organizationId, legalEntityId, code: '1000', name: 'Debit account', accountType: 'asset' },
        { id: creditAccountId, organizationId, legalEntityId, code: '2000', name: 'Credit account', accountType: 'liability' },
      ] });
      await db.erpVoucher.create({ data: {
        id: voucherId, organizationId, legalEntityId, financialYearId, accountingPeriodId: periodId,
        voucherType: 'journal', voucherNumber: `DRAFT-${run}`, businessDate: new Date('2026-08-14T00:00:00.000Z'),
        transactionDebit: '100', transactionCredit: '100', baseDebit: '100', baseCredit: '100',
        createdBy: makerId,
      } });
      await db.erpVoucherLine.createMany({ data: [
        { organizationId, legalEntityId, voucherId, lineNumber: 1, accountId: debitAccountId, transactionDebit: '100', baseDebit: '100' },
        { organizationId, legalEntityId, voucherId, lineNumber: 2, accountId: creditAccountId, transactionCredit: '100', baseCredit: '100' },
      ] });
      await db.erpVoucher.update({ where: { id: voucherId }, data: { status: 'submitted', submittedAt: new Date(), rowVersion: { increment: 1 } } });
      await db.erpVoucher.update({ where: { id: voucherId }, data: { status: 'approved', approvedAt: new Date(), approvedBy: checkerId, rowVersion: { increment: 1 } } });
    });

    let markLockReady!: () => void;
    let releasePeriodLock!: () => void;
    let closingBackendPid = 0;
    const lockReady = new Promise<void>((resolve) => { markLockReady = resolve; });
    const release = new Promise<void>((resolve) => { releasePeriodLock = resolve; });
    const closer = direct.$transaction(async (db) => {
      await db.$executeRaw(Prisma.sql`SELECT set_config('app.current_tenant', ${organizationId}, true)`);
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "AccountingPeriod" WHERE "id" = ${periodId} FOR UPDATE`);
      const backend = await db.$queryRaw<Array<{ pid: number }>>(Prisma.sql`SELECT pg_backend_pid() AS pid`);
      closingBackendPid = backend[0]?.pid ?? 0;
      markLockReady();
      await release;
      await db.accountingPeriod.update({ where: { id: periodId }, data: { status: 'soft_closed', rowVersion: { increment: 1 } } });
    });
    await lockReady;

    const repository = new PrismaMesaErpRepository();
    let postingState: 'pending' | 'fulfilled' | 'rejected' = 'pending';
    const posting = tenantContext.run({
      organizationId, membershipId: checkerId, userId: `user-${checkerId}`,
      role: 'ERP Poster', email: `${checkerId}@example.test`,
    }, () => repository.postVoucher({
      organizationId, legalEntityId, voucherId, actorMembershipId: checkerId,
      expectedVersion: 2, idempotencyKey: `post-${run}`, requestHash: 'b'.repeat(64),
    }));
    void posting.then(() => { postingState = 'fulfilled'; }, () => { postingState = 'rejected'; });

    let waitingOnPeriodLock = false;
    for (let attempt = 0; attempt < 100 && postingState === 'pending'; attempt += 1) {
      const rows = await direct.$queryRaw<Array<{ waiting: boolean }>>(Prisma.sql`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database()
            AND ${closingBackendPid} = ANY(pg_blocking_pids(pid))
        ) AS waiting
      `);
      waitingOnPeriodLock = rows[0]?.waiting ?? false;
      if (waitingOnPeriodLock) break;
      await wait(20);
    }

    expect(waitingOnPeriodLock).toBe(true);
    expect(postingState).toBe('pending');
    releasePeriodLock();
    await closer;
    await expect(posting).rejects.toMatchObject({ code: 'period_closed' });
    const voucher = await direct.$transaction(async (db) => {
      await db.$executeRaw(Prisma.sql`SELECT set_config('app.current_tenant', ${organizationId}, true)`);
      return db.erpVoucher.findUniqueOrThrow({ where: { id: voucherId } });
    });
    expect(voucher).toMatchObject({ status: 'approved', rowVersion: 2 });
  });
});
