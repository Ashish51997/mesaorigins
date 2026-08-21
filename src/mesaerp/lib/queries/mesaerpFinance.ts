import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/lib/apiClient';

export interface ErpFinanceAccount {
  id: string;
  legalEntityId: string;
  code: string;
  name: string;
  accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  classification: string;
  cashFlowClass: string;
  parentId?: string;
  currency: string;
  allowPosting: boolean;
  reconciliationRequired: boolean;
  active: boolean;
  rowVersion: number;
  children: ErpFinanceAccount[];
}
export interface ErpAccountingPeriod {
  id: string;
  legalEntityId: string;
  financialYearId: string;
  periodNumber: number;
  name: string;
  startsOn: string;
  endsOn: string;
  status: 'open' | 'soft_closed' | 'locked';
  rowVersion: number;
}

export interface ErpBankStatementLine {
  lineId: string;
  transactionDate: string;
  valueDate: string;
  reference: string;
  narration: string;
  debit: string;
  credit: string;
  matchStatus: 'unmatched' | 'matched' | 'ignored';
  matchedVoucherId: string;
  matchedVoucherLineId: string;
  matchEvidence: Record<string, unknown>;
}

export interface ErpBankReconciliation {
  id: string;
  legalEntityId: string;
  bankAccountId: string;
  statementReference: string;
  statementFrom: string;
  statementTo: string;
  openingBalance: string;
  closingBalance: string;
  lines: ErpBankStatementLine[];
  matchedTotal: string;
  unmatchedTotal: string;
  status: 'in_progress' | 'completed';
  sourceHash: string;
  rowVersion: number;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ErpAsset {
  id: string;
  legalEntityId: string;
  financialYearId: string;
  assetCode: string;
  name: string;
  category: string;
  acquisitionDate: string;
  capitalizationDate?: string;
  acquisitionCost: string;
  residualValue: string;
  depreciationMethod: 'slm' | 'wdv';
  usefulLifeMonths: number;
  depreciationRate: string;
  accumulatedDepreciation: string;
  accumulatedImpairment: string;
  netBookValue: string;
  depreciationThrough?: string;
  location: Record<string, unknown>;
  accountingProfile: Record<string, string>;
  status: string;
  rowVersion: number;
}

export interface ErpBudget {
  id: string;
  legalEntityId: string;
  financialYearId: string;
  budgetCode: string;
  name: string;
  dimensionType: 'account' | 'cost_center' | 'plant';
  currency: string;
  lines: Array<{ accountId: string; periodNumber: number; costCenterId?: string; plantId?: string; amount: string }>;
  totalAmount: string;
  status: 'draft' | 'submitted' | 'approved';
  approvalState: string;
  rowVersion: number;
}

export interface ErpIntercompanyPair {
  id: string;
  sourceLegalEntityId: string;
  targetLegalEntityId: string;
  sourceVoucherId: string;
  targetVoucherId: string;
  reference: string;
  businessDate: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
  targetAmount: string;
  exchangeRate: string;
  rateEffectiveFrom: string;
  rateEffectiveTo?: string;
  rateSourceReference: string;
  sourceSnapshotHash: string;
  status: string;
  rowVersion: number;
}

export type ErpFinanceReportKind = 'day-book' | 'general-ledger' | 'trial-balance' | 'profit-and-loss' | 'balance-sheet' | 'cash-bank-book' | 'cash-flow' | 'bill-ageing' | 'dimensions' | 'budget-variance';
export type ErpFinanceReport = Record<string, unknown> & { kind?: string; generatedAt?: string; basis?: string; limitation?: string };

export interface ErpFinanceAccountCreate {
  code: string;
  name: string;
  accountType: ErpFinanceAccount['accountType'];
  classification: string;
  cashFlowClass: string;
  parentId?: string;
  currency: string;
  allowPosting: boolean;
  reconciliationRequired: boolean;
  active: boolean;
}

export interface ErpBankStatementImport {
  bankAccountId: string;
  statementReference: string;
  statementFrom: string;
  statementTo: string;
  openingBalance: string;
  closingBalance: string;
  sourceHash: string;
  lines: Array<{ lineId: string; transactionDate: string; valueDate?: string; reference: string; narration: string; debit: string; credit: string }>;
}

export interface ErpAssetCreate {
  financialYearId: string;
  assetCode: string;
  name: string;
  category: string;
  acquisitionDate: string;
  acquisitionCost: string;
  residualValue: string;
  depreciationMethod: 'slm' | 'wdv';
  usefulLifeMonths: number;
  depreciationRate: string;
  location: Record<string, unknown>;
  accountingProfile: {
    capitalizationClearingAccountId: string;
    assetAccountId: string;
    accumulatedDepreciationAccountId: string;
    depreciationExpenseAccountId: string;
    accumulatedImpairmentAccountId: string;
    impairmentExpenseAccountId: string;
    disposalProceedsAccountId: string;
    disposalGainAccountId: string;
    disposalLossAccountId: string;
  };
  originMetadata: Record<string, unknown>;
}

export interface ErpBudgetCreate {
  financialYearId: string;
  budgetCode: string;
  name: string;
  dimensionType: 'account' | 'cost_center' | 'plant';
  currency: string;
  lines: Array<{ accountId: string; periodNumber: number; costCenterId?: string; plantId?: string; amount: string }>;
}

export interface ErpIntercompanyCreate {
  targetLegalEntityId: string;
  reference: string;
  businessDate: string;
  exchangeRate: string;
  rateEffectiveFrom: string;
  rateEffectiveTo?: string;
  rateSourceReference: string;
  source: { currency: string; lines: Array<{ ledgerAccountId: string; debit: string; credit: string; narration: string; dimensions: Record<string, unknown> }> };
  target: { currency: string; lines: Array<{ ledgerAccountId: string; debit: string; credit: string; narration: string; dimensions: Record<string, unknown> }> };
}

const root = (entityId: string) => `/mesaerp/v1/entities/${entityId}`;
const keys = {
  all: (entityId: string) => ['mesaerp', entityId, 'finance-controls'] as const,
  accounts: (entityId: string) => [...keys.all(entityId), 'accounts'] as const,
  periods: (entityId: string) => [...keys.all(entityId), 'periods'] as const,
  banks: (entityId: string) => [...keys.all(entityId), 'bank-reconciliations'] as const,
  assets: (entityId: string) => [...keys.all(entityId), 'assets'] as const,
  budgets: (entityId: string) => [...keys.all(entityId), 'budgets'] as const,
  intercompany: (entityId: string) => [...keys.all(entityId), 'intercompany'] as const,
  report: (entityId: string, kind: string, query: string) => [...keys.all(entityId), 'report', kind, query] as const,
};

export function flattenFinanceAccounts(accounts: ErpFinanceAccount[]): ErpFinanceAccount[] {
  return accounts.flatMap((account) => [account, ...flattenFinanceAccounts(account.children ?? [])]);
}

export function useErpFinanceAccountTree(entityId: string) {
  return useQuery({ queryKey: keys.accounts(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpFinanceAccount[]>(`${root(entityId)}/accounts/tree`) });
}
export function useErpAccountingPeriods(entityId: string) {
  return useQuery({ queryKey: keys.periods(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpAccountingPeriod[]>(`${root(entityId)}/accounting-periods`) });
}
export function useErpBankReconciliations(entityId: string) {
  return useQuery({ queryKey: keys.banks(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpBankReconciliation[]>(`${root(entityId)}/bank-reconciliations`) });
}
export function useErpAssets(entityId: string) {
  return useQuery({ queryKey: keys.assets(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpAsset[]>(`${root(entityId)}/assets`) });
}
export function useErpBudgets(entityId: string) {
  return useQuery({ queryKey: keys.budgets(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpBudget[]>(`${root(entityId)}/budgets`) });
}
export function useErpIntercompanyPairs(entityId: string) {
  return useQuery({ queryKey: keys.intercompany(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpIntercompanyPair[]>(`${root(entityId)}/intercompany-pairs`) });
}

export function useErpFinanceReport(entityId: string, kind: ErpFinanceReportKind, filters: Record<string, string>, enabled: boolean) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value))).toString();
  return useQuery({
    queryKey: keys.report(entityId, kind, query),
    enabled: Boolean(entityId && enabled),
    queryFn: () => api.get<ErpFinanceReport>(`${root(entityId)}/reports/${kind}${query ? `?${query}` : ''}`),
  });
}

export function useErpFinanceControlActions(entityId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.all(entityId) });
  const post = <T,>(path: string, input: unknown, requestKey: string) => api.postIdempotent<T>(`${root(entityId)}/${path}`, input, requestKey);
  return {
    createAccount: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpFinanceAccountCreate; requestKey: string }) => post<ErpFinanceAccount>('accounts', input, requestKey), onSuccess: refresh }),
    updateAccount: useMutation({ mutationFn: ({ accountId, input, requestKey }: { accountId: string; input: Partial<ErpFinanceAccountCreate> & { expectedRowVersion: number }; requestKey: string }) => api.patchIdempotent<ErpFinanceAccount>(`${root(entityId)}/accounts/${accountId}`, input, requestKey), onSuccess: refresh }),
    transitionPeriod: useMutation({ mutationFn: ({ periodId, action, expectedRowVersion, reason, requestKey }: { periodId: string; action: 'soft-close' | 'lock' | 'reopen'; expectedRowVersion: number; reason: string; requestKey: string }) => post<ErpAccountingPeriod>(`accounting-periods/${periodId}/${action}`, { expectedRowVersion, reason }, requestKey), onSuccess: refresh }),
    importBankStatement: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpBankStatementImport; requestKey: string }) => post<ErpBankReconciliation>('bank-reconciliations', input, requestKey), onSuccess: refresh }),
    actOnBankLine: useMutation({ mutationFn: ({ reconciliationId, lineId, input, requestKey }: { reconciliationId: string; lineId: string; input: { action: 'match'; expectedRowVersion: number; voucherLineId: string } | { action: 'unmatch'; expectedRowVersion: number } | { action: 'ignore'; expectedRowVersion: number; reason: string }; requestKey: string }) => post<ErpBankReconciliation>(`bank-reconciliations/${reconciliationId}/lines/${lineId}/action`, input, requestKey), onSuccess: refresh }),
    completeReconciliation: useMutation({ mutationFn: ({ reconciliationId, expectedRowVersion, requestKey }: { reconciliationId: string; expectedRowVersion: number; requestKey: string }) => post<ErpBankReconciliation>(`bank-reconciliations/${reconciliationId}/complete`, { expectedRowVersion }, requestKey), onSuccess: refresh }),
    createAsset: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpAssetCreate; requestKey: string }) => post<ErpAsset>('assets', input, requestKey), onSuccess: refresh }),
    capitalizeAsset: useMutation({ mutationFn: ({ assetId, expectedRowVersion, businessDate, capitalizationDate, requestKey }: { assetId: string; expectedRowVersion: number; businessDate: string; capitalizationDate: string; requestKey: string }) => post(`assets/${assetId}/capitalize`, { expectedRowVersion, businessDate, capitalizationDate }, requestKey), onSuccess: refresh }),
    transferAsset: useMutation({ mutationFn: ({ assetId, expectedRowVersion, businessDate, toLocation, reason, requestKey }: { assetId: string; expectedRowVersion: number; businessDate: string; toLocation: Record<string, unknown>; reason: string; requestKey: string }) => post(`assets/${assetId}/transfer`, { expectedRowVersion, businessDate, toLocation, reason }, requestKey), onSuccess: refresh }),
    proposeDepreciation: useMutation({ mutationFn: ({ assetId, expectedRowVersion, businessDate, throughDate, months, requestKey }: { assetId: string; expectedRowVersion: number; businessDate: string; throughDate: string; months: number; requestKey: string }) => post(`assets/${assetId}/depreciation-proposals`, { expectedRowVersion, businessDate, throughDate, months }, requestKey), onSuccess: refresh }),
    proposeImpairment: useMutation({ mutationFn: ({ assetId, expectedRowVersion, businessDate, amount, reason, requestKey }: { assetId: string; expectedRowVersion: number; businessDate: string; amount: string; reason: string; requestKey: string }) => post(`assets/${assetId}/impairment-proposals`, { expectedRowVersion, businessDate, amount, reason }, requestKey), onSuccess: refresh }),
    proposeDisposal: useMutation({ mutationFn: ({ assetId, expectedRowVersion, businessDate, proceeds, reason, requestKey }: { assetId: string; expectedRowVersion: number; businessDate: string; proceeds: string; reason: string; requestKey: string }) => post(`assets/${assetId}/disposal-proposals`, { expectedRowVersion, businessDate, proceeds, reason }, requestKey), onSuccess: refresh }),
    createBudget: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpBudgetCreate; requestKey: string }) => post<ErpBudget>('budgets', input, requestKey), onSuccess: refresh }),
    transitionBudget: useMutation({ mutationFn: ({ budgetId, action, expectedRowVersion, requestKey }: { budgetId: string; action: 'submit' | 'approve'; expectedRowVersion: number; requestKey: string }) => post<ErpBudget>(`budgets/${budgetId}/${action}`, { expectedRowVersion }, requestKey), onSuccess: refresh }),
    createIntercompanyPair: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpIntercompanyCreate; requestKey: string }) => post<ErpIntercompanyPair>('intercompany-pairs', input, requestKey), onSuccess: refresh }),
    createEliminationVoucher: useMutation({ mutationFn: ({ input, requestKey }: { input: { businessDate: string; currency: string; reference: string; narration: string; lines: Array<{ ledgerAccountId: string; debit: string; credit: string; narration: string; dimensions: Record<string, unknown> }> }; requestKey: string }) => post('consolidation/elimination-vouchers', input, requestKey), onSuccess: refresh }),
    runConsolidation: useMutation({ mutationFn: (input: { reportDate: string; groupCurrency: string; legalEntityIds: string[]; rates: Array<{ legalEntityId: string; currency: string; rate: string; effectiveFrom: string; effectiveTo?: string; sourceReference: string }>; eliminationVoucherIds: string[] }) => api.post<ErpFinanceReport>(`${root(entityId)}/consolidation/report`, input) }),
  };
}
