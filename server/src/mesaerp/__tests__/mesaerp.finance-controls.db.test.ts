import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { withTenant } from '../../db';
import { hashCanonical } from '../repository';

const enabled = process.env.RUN_MESAERP_DB_INTEGRATION === '1';
const app = buildApp();
const OWNER = 'vikram.malhotra@masspolymer.in';
const CHECKER = 'deepak.bansal@masspolymer.in';
const SALES_USER = 'amit.verma@masspolymer.in';
const ORG = 'org-demo';
const ENTITY = 'entity-demo';
const FY = 'fy-demo-2026-27';
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function postVoucher(voucherId: string, key: string) {
  const submitted = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/vouchers/${voucherId}/submit`)
    .set('x-dev-user', OWNER).set('Idempotency-Key', `${key}-submit`).send({ expectedVersion: 0 });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  const approved = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/vouchers/${voucherId}/approve`)
    .set('x-dev-user', CHECKER).set('Idempotency-Key', `${key}-approve`).send({ expectedVersion: 1 });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const posted = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/vouchers/${voucherId}/post`)
    .set('x-dev-user', CHECKER).set('Idempotency-Key', `${key}-post`).send({ expectedVersion: 2 });
  expect(posted.status, JSON.stringify(posted.body)).toBe(200);
  return posted.body;
}

describe.skipIf(!enabled)('MesaERP finance-control database acceptance', () => {
  it('enforces account CAS and period close/lock/reopen lifecycle with exact access', async () => {
    const run = unique();
    const denied = await request(app).get(`/api/mesaerp/v1/entities/${ENTITY}/accounts/tree`).set('x-dev-user', SALES_USER);
    expect(denied.status).toBe(403);
    const created = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/accounts`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `account-${run}`).send({ code: `QA-${run}`, name: 'Finance QA account', accountType: 'expense', classification: 'operating_expense', cashFlowClass: 'operating', currency: 'INR' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const replay = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/accounts`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `account-${run}`).send({ code: `QA-${run}`, name: 'Finance QA account', accountType: 'expense', classification: 'operating_expense', cashFlowClass: 'operating', currency: 'INR' });
    expect(replay.body.id).toBe(created.body.id);
    const update = await request(app).patch(`/api/mesaerp/v1/entities/${ENTITY}/accounts/${created.body.id}`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `account-update-${run}`).send({ expectedRowVersion: 0, name: 'Finance QA account revised' });
    expect(update.body.rowVersion).toBe(1);
    const stale = await request(app).patch(`/api/mesaerp/v1/entities/${ENTITY}/accounts/${created.body.id}`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `account-stale-${run}`).send({ expectedRowVersion: 0, name: 'Stale overwrite' });
    expect(stale.body.error.code).toBe('version_conflict');

    const period = await withTenant(ORG, (db) => db.accountingPeriod.findFirstOrThrow({ where: { legalEntityId: ENTITY, periodNumber: 1 } }));
    const soft = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/accounting-periods/${period.id}/soft-close`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `period-soft-${run}`).send({ expectedRowVersion: period.rowVersion, reason: 'Month end close preparation' });
    expect(soft.body.status).toBe('soft_closed');
    const locked = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/accounting-periods/${period.id}/lock`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `period-lock-${run}`).send({ expectedRowVersion: soft.body.rowVersion, reason: 'Approved month end lock' });
    expect(locked.body.status).toBe('locked');
    const reopened = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/accounting-periods/${period.id}/reopen`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `period-reopen-${run}`).send({ expectedRowVersion: locked.body.rowVersion, reason: 'Approved audit adjustment required' });
    expect(reopened).toMatchObject({ status: 200, body: { status: 'open', reopenedBy: expect.any(String) } });
  });

  it('imports, matches and checker-completes bank evidence without initiating payment', async () => {
    const run = unique();
    const voucher = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/vouchers`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `bank-voucher-${run}`).send({ voucherType: 'receipt', voucherDate: '2026-08-14', currencyCode: 'INR', reference: `BANK-${run}`, lines: [
        { ledgerAccountId: '1010', debit: '100', credit: '0' }, { ledgerAccountId: '1100', debit: '0', credit: '100' },
      ] });
    expect(voucher.status, JSON.stringify(voucher.body)).toBe(201);
    await postVoucher(voucher.body.id, `bank-voucher-${run}`);
    const bankLine = await withTenant(ORG, (db) => db.erpVoucherLine.findFirstOrThrow({ where: { voucherId: voucher.body.id, account: { code: '1010' } } }));
    const statementEvidence = { version: 1, bankAccountId: 'erp-acct-1010', statementReference: `STMT-${run}`, statementFrom: '2026-08-01', statementTo: '2026-08-31', openingBalance: '0', closingBalance: '100', lines: [{ lineId: `L-${run}`, transactionDate: '2026-08-14', reference: `BANK-${run}`, narration: '', debit: '0', credit: '100' }] };
    const imported = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/bank-reconciliations`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `bank-import-${run}`).send({ ...statementEvidence, version: undefined, sourceHash: hashCanonical(statementEvidence) });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    const matched = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/bank-reconciliations/${imported.body.id}/lines/L-${run}/action`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `bank-match-${run}`).send({ action: 'match', expectedRowVersion: 0, voucherLineId: bankLine.id });
    expect(matched.body).toMatchObject({ matchedTotal: '100', unmatchedTotal: '0', rowVersion: 1 });
    const self = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/bank-reconciliations/${imported.body.id}/complete`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `bank-self-${run}`).send({ expectedRowVersion: 1 });
    expect(self.body.error.code).toBe('maker_checker_required');
    const completed = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/bank-reconciliations/${imported.body.id}/complete`).set('x-dev-user', CHECKER)
      .set('Idempotency-Key', `bank-complete-${run}`).send({ expectedRowVersion: 1 });
    expect(completed.body).toMatchObject({ status: 'completed', completedBy: expect.any(String), unmatchedTotal: '0' });
  });

  it('runs budget maker-checker and applies SLM depreciation only when its voucher posts', async () => {
    const run = unique();
    const budget = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/budgets`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `budget-${run}`).send({ financialYearId: FY, budgetCode: `B-${run}`, name: 'Factory overhead budget', dimensionType: 'account', currency: 'INR', lines: [{ accountId: '5300', periodNumber: 5, plantId: 'PLANT-1', amount: '1000' }] });
    expect(budget.status).toBe(201);
    const submitted = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/budgets/${budget.body.id}/submit`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `budget-submit-${run}`).send({ expectedRowVersion: 0 });
    expect(submitted.body.status).toBe('submitted');
    const self = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/budgets/${budget.body.id}/approve`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `budget-self-${run}`).send({ expectedRowVersion: 1 });
    expect(self.body.error.code).toBe('maker_checker_required');
    const approved = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/budgets/${budget.body.id}/approve`).set('x-dev-user', CHECKER)
      .set('Idempotency-Key', `budget-approve-${run}`).send({ expectedRowVersion: 1 });
    expect(approved.body.status).toBe('approved');

    const accountingProfile = { capitalizationClearingAccountId: '5000', assetAccountId: '1200', accumulatedDepreciationAccountId: '2000', depreciationExpenseAccountId: '5300', accumulatedImpairmentAccountId: '2000', impairmentExpenseAccountId: '5300', disposalProceedsAccountId: '1010', disposalGainAccountId: '4000', disposalLossAccountId: '5300' };
    const asset = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/assets`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `asset-${run}`).send({ financialYearId: FY, assetCode: `A-${run}`, name: 'Test machine', category: 'Plant', acquisitionDate: '2026-08-14', acquisitionCost: '1200', residualValue: '0', depreciationMethod: 'slm', usefulLifeMonths: 12, depreciationRate: '0', location: { plantId: 'PLANT-1' }, accountingProfile });
    expect(asset.status, JSON.stringify(asset.body)).toBe(201);
    const cap = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/assets/${asset.body.id}/capitalize`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `asset-cap-${run}`).send({ expectedRowVersion: 0, businessDate: '2026-08-14', capitalizationDate: '2026-08-14' });
    expect(cap.body.voucher.status).toBe('draft');
    const sealedLine = await withTenant(ORG, (db) => db.erpVoucherLine.findFirstOrThrow({ where: { voucherId: cap.body.voucher.id } }));
    await expect(withTenant(ORG, (db) => db.erpVoucherLine.update({ where: { id: sealedLine.id }, data: { narration: 'tamper' } }))).rejects.toThrow(/finance-control voucher lines are immutable/);
    await expect(withTenant(ORG, (db) => db.erpVoucher.update({ where: { id: cap.body.voucher.id }, data: { reference: 'tamper' } }))).rejects.toThrow(/finance-control voucher mapping is immutable/);
    const beforePost = await request(app).get(`/api/mesaerp/v1/entities/${ENTITY}/assets/${asset.body.id}`).set('x-dev-user', OWNER);
    expect(beforePost.body.status).toBe('under_construction');
    await postVoucher(cap.body.voucher.id, `asset-cap-${run}`);
    const active = await request(app).get(`/api/mesaerp/v1/entities/${ENTITY}/assets/${asset.body.id}`).set('x-dev-user', OWNER);
    expect(active.body).toMatchObject({ status: 'active', rowVersion: 1, netBookValue: '1200' });
    const depreciation = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/assets/${asset.body.id}/depreciation-proposals`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `asset-dep-${run}`).send({ expectedRowVersion: 1, businessDate: '2026-08-31', throughDate: '2026-08-31', months: 1 });
    expect(depreciation.body.voucher).toMatchObject({ voucherType: 'depreciation', status: 'draft', baseDebit: '100' });
    await postVoucher(depreciation.body.voucher.id, `asset-dep-${run}`);
    const depreciated = await request(app).get(`/api/mesaerp/v1/entities/${ENTITY}/assets/${asset.body.id}`).set('x-dev-user', OWNER);
    expect(depreciated.body).toMatchObject({ accumulatedDepreciation: '100', netBookValue: '1100', rowVersion: 2 });
    const reversal = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/vouchers/${depreciation.body.voucher.id}/reversals`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `asset-reverse-${run}`).send({ expectedVersion: 3, voucherDate: '2026-08-31', reason: 'Attempt uncontrolled asset correction' });
    expect(reversal.body.error.code).toBe('asset_reversal_requires_adjustment');

    const variance = await request(app).get(`/api/mesaerp/v1/entities/${ENTITY}/budgets/${budget.body.id}/variance`).set('x-dev-user', OWNER);
    expect(variance.status).toBe(200);
    expect(variance.body.basis).toBe('posted_and_reversed_voucher_lines');
    const trial = await request(app).get(`/api/mesaerp/v1/entities/${ENTITY}/reports/trial-balance?asOf=2026-08-31`).set('x-dev-user', OWNER);
    expect(trial.body).toMatchObject({ balanced: true, basis: 'posted_and_reversed_vouchers_in_company_base_currency' });
  });

  it('creates an atomic dual-company draft pair and consolidates only supplied FX and eliminations', async () => {
    const run = unique();
    const code = `IC${Date.now()}`;
    const target = await request(app).post('/api/mesaerp/v1/entities').set('x-dev-user', OWNER)
      .set('Idempotency-Key', `intercompany-entity-${run}`).send({ code, name: `Intercompany QA ${run}`, countryCode: 'IN', baseCurrency: 'INR', fiscalYearStartMonth: 4 });
    expect(target.status, JSON.stringify(target.body)).toBe(201);
    const side = { currency: 'INR', lines: [{ ledgerAccountId: '1100', debit: '250', credit: '0' }, { ledgerAccountId: '2000', debit: '0', credit: '250' }] };
    const targetSide = { currency: 'INR', lines: [{ ledgerAccountId: '2000', debit: '250', credit: '0' }, { ledgerAccountId: '1100', debit: '0', credit: '250' }] };
    const pairBody = { targetLegalEntityId: target.body.id, reference: `IC-${run}`, businessDate: '2026-08-14', exchangeRate: '1', rateEffectiveFrom: '2026-04-01', rateEffectiveTo: '2027-03-31', rateSourceReference: 'Treasury approved same-currency rate', source: side, target: targetSide };
    const pair = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/intercompany-pairs`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `intercompany-pair-${run}`).send(pairBody);
    expect(pair.status, JSON.stringify(pair.body)).toBe(201);
    expect(pair.body).toMatchObject({ sourceLegalEntityId: ENTITY, targetLegalEntityId: target.body.id, sourceAmount: '250', targetAmount: '250', exchangeRate: '1', sourceVoucher: { status: 'draft', voucherType: 'intercompany' }, targetVoucher: { status: 'draft', voucherType: 'intercompany' } });
    const replay = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/intercompany-pairs`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `intercompany-pair-${run}`).send(pairBody);
    expect(replay.body.id).toBe(pair.body.id);
    const persisted = await withTenant(ORG, (db) => db.erpIntercompanyPair.findUniqueOrThrow({ where: { id: pair.body.id } }));
    expect(persisted.sourceSnapshotHash).toMatch(/^[a-f0-9]{64}$/);

    const blockedGeneric = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/vouchers`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `generic-elimination-${run}`).send({ voucherType: 'consolidation_elimination', voucherDate: '2026-08-14', currencyCode: 'INR', reference: `ELM-${run}`, narration: 'Attempt generic elimination', lines: [
        { ledgerAccountId: '1100', debit: '50', credit: '0' }, { ledgerAccountId: '2000', debit: '0', credit: '50' },
      ] });
    expect(blockedGeneric.body.error.code).toBe('controlled_voucher_type');
    const elimination = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/consolidation/elimination-vouchers`).set('x-dev-user', OWNER)
      .set('Idempotency-Key', `elimination-${run}`).send({ businessDate: '2026-08-14', currency: 'INR', reference: `ELM-${run}`, narration: 'Explicit test elimination', lines: [
        { ledgerAccountId: '1100', debit: '50', credit: '0' }, { ledgerAccountId: '2000', debit: '0', credit: '50' },
      ] });
    expect(elimination.status, JSON.stringify(elimination.body)).toBe(201);
    await postVoucher(elimination.body.id, `elimination-${run}`);
    const consolidation = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/consolidation/report`).set('x-dev-user', OWNER).send({
      reportDate: '2026-08-31', groupCurrency: 'INR', legalEntityIds: [ENTITY, target.body.id],
      rates: [
        { legalEntityId: ENTITY, currency: 'INR', rate: '1', effectiveFrom: '2026-04-01', effectiveTo: '2027-03-31', sourceReference: 'Treasury approved source rate' },
        { legalEntityId: target.body.id, currency: 'INR', rate: '1', effectiveFrom: '2026-04-01', effectiveTo: '2027-03-31', sourceReference: 'Treasury approved target rate' },
      ],
      eliminationVoucherIds: [elimination.body.id],
    });
    expect(consolidation.status, JSON.stringify(consolidation.body)).toBe(200);
    expect(consolidation.body).toMatchObject({ groupCurrency: 'INR', silentNettingApplied: false, translationPolicy: expect.stringContaining('caller-supplied') });
    expect(consolidation.body.entityBalances).toHaveLength(2);
    expect(consolidation.body.explicitEliminations).toHaveLength(1);
    const missingElimination = await request(app).post(`/api/mesaerp/v1/entities/${ENTITY}/consolidation/report`).set('x-dev-user', OWNER).send({
      reportDate: '2026-08-31', groupCurrency: 'INR', legalEntityIds: [ENTITY, target.body.id],
      rates: [
        { legalEntityId: ENTITY, currency: 'INR', rate: '1', effectiveFrom: '2026-04-01', sourceReference: 'Approved source rate' },
        { legalEntityId: target.body.id, currency: 'INR', rate: '1', effectiveFrom: '2026-04-01', sourceReference: 'Approved target rate' },
      ], eliminationVoucherIds: ['not-an-elimination'],
    });
    expect(missingElimination.body.error.code).toBe('elimination_voucher_invalid');
  });
});
