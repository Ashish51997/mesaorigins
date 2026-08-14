import { describe, expect, it } from 'vitest';
import { collectRoutes } from '../../openapi/routes';
import { voucherTypeSchema } from '../schemas';
import { createMesaErpFinanceControlRouter } from '../financeControlRouter';
import {
  assetCreateSchema, bankStatementImportSchema, budgetCreateSchema, consolidationReportSchema,
  financeAccountCreateSchema, intercompanyCreateSchema,
} from '../financeControlSchemas';

describe('MesaERP finance-control contracts', () => {
  it('mounts every write behind an exact finance permission and body schema', () => {
    const routes = collectRoutes(createMesaErpFinanceControlRouter(), '/api/mesaerp/v1');
    expect(routes.length).toBe(40);
    const writes = routes.filter((route) => ['post', 'patch', 'put', 'delete'].includes(route.method));
    expect(writes.length).toBeGreaterThan(15);
    expect(writes.every((route) => route.permission?.startsWith('mesaerp.') && route.bodySchema)).toBe(true);
    expect(routes.find((route) => route.path.endsWith('/accounting-periods/:periodId/reopen'))?.permission).toBe('mesaerp.period.reopen');
    expect(routes.find((route) => route.path.endsWith('/intercompany-pairs') && route.method === 'post')?.permission).toBe('mesaerp.intercompany.manage');
    expect(routes.find((route) => route.path.endsWith('/consolidation/report'))?.permission).toBe('mesaerp.consolidation.manage');
  });

  it('extends the native voucher engine with finance-control voucher families', () => {
    for (const type of ['depreciation', 'fx_adjustment', 'intercompany', 'consolidation_elimination']) {
      expect(voucherTypeSchema.parse(type)).toBe(type);
    }
  });

  it('keeps all monetary and FX inputs as decimal strings', () => {
    expect(() => bankStatementImportSchema.parse({
      bankAccountId: 'bank-1', statementReference: 'S-1', statementFrom: '2026-08-01', statementTo: '2026-08-31',
      openingBalance: 0, closingBalance: '100', sourceHash: 'a'.repeat(64),
      lines: [{ lineId: 'L-1', transactionDate: '2026-08-14', debit: '0', credit: '100' }],
    })).toThrow();
    expect(() => budgetCreateSchema.parse({
      financialYearId: 'fy-1', budgetCode: 'B-1', name: 'Operations budget', dimensionType: 'account', currency: 'INR',
      lines: [{ accountId: 'a-1', periodNumber: 1, amount: 100 }],
    })).toThrow();
    expect(() => consolidationReportSchema.parse({
      reportDate: '2026-08-14', groupCurrency: 'INR', legalEntityIds: ['e-1'],
      rates: [{ legalEntityId: 'e-1', currency: 'INR', rate: 1, effectiveFrom: '2026-04-01', sourceReference: 'RBI fixture' }],
    })).toThrow();
  });

  it('validates account, asset, intercompany and consolidation boundaries', () => {
    expect(() => financeAccountCreateSchema.parse({ code: '100A', name: 'Bank A', accountType: 'asset', classification: 'bank', cashFlowClass: 'cash', currency: 'INR' })).not.toThrow();
    expect(() => assetCreateSchema.parse({
      financialYearId: 'fy-1', assetCode: 'M-1', name: 'Moulding machine', category: 'Plant', acquisitionDate: '2026-08-14',
      acquisitionCost: '1000', residualValue: '2000', depreciationMethod: 'slm', usefulLifeMonths: 12, depreciationRate: '0',
      accountingProfile: Object.fromEntries(['capitalizationClearingAccountId','assetAccountId','accumulatedDepreciationAccountId','depreciationExpenseAccountId','accumulatedImpairmentAccountId','impairmentExpenseAccountId','disposalProceedsAccountId','disposalGainAccountId','disposalLossAccountId'].map((key) => [key, 'a-1'])),
    })).toThrow(/Residual value/);
    expect(() => assetCreateSchema.parse({
      financialYearId: 'fy-1', assetCode: 'M-2', name: 'High-value line', category: 'Plant', acquisitionDate: '2026-08-14',
      acquisitionCost: '9999999999999999.98', residualValue: '9999999999999999.99', depreciationMethod: 'slm', usefulLifeMonths: 12, depreciationRate: '0',
      accountingProfile: Object.fromEntries(['capitalizationClearingAccountId','assetAccountId','accumulatedDepreciationAccountId','depreciationExpenseAccountId','accumulatedImpairmentAccountId','impairmentExpenseAccountId','disposalProceedsAccountId','disposalGainAccountId','disposalLossAccountId'].map((key) => [key, 'a-1'])),
    })).toThrow(/Residual value/);
    const side = { currency: 'INR', lines: [{ ledgerAccountId: 'a-1', debit: '100', credit: '0' }, { ledgerAccountId: 'a-2', debit: '0', credit: '100' }] };
    expect(() => intercompanyCreateSchema.parse({ targetLegalEntityId: 'e-2', reference: 'IC-1', businessDate: '2026-08-14', exchangeRate: '1', rateEffectiveFrom: '2026-09-01', rateSourceReference: 'Approved treasury rate', source: side, target: side })).toThrow(/effective range/);
  });
});
