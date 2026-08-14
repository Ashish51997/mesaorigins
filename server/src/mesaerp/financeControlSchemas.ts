import { z } from 'zod';
import { voucherLineSchema } from './schemas';
import { decimalToScaled } from './decimal';
import { isoBusinessDateSchema, moneyDecimalSchema, rateDecimalSchema } from './commercialManufacturingSchemas';

const id = z.string().trim().min(1).max(128);
const code = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._/-]+$/);
const currency = z.string().trim().length(3).transform((value) => value.toUpperCase());
const jsonObject = z.record(z.string(), z.unknown());
const expectedRowVersion = z.number().int().nonnegative();
const isPositiveDecimal = (value: string) => decimalToScaled(value) > 0n;
const positiveMoney = moneyDecimalSchema.refine(isPositiveDecimal, 'Amount must be greater than zero.');

export const accountClassificationSchema = z.enum([
  'cash', 'bank', 'receivable', 'inventory', 'fixed_asset', 'accumulated_depreciation',
  'payable', 'tax', 'equity', 'revenue', 'cogs', 'operating_expense', 'other_income',
  'other_expense', 'intercompany', 'elimination', 'other',
]);
export const cashFlowClassSchema = z.enum(['operating', 'investing', 'financing', 'cash', 'non_cash']);

export const financeAccountCreateSchema = z.object({
  code,
  name: z.string().trim().min(2).max(200),
  accountType: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
  classification: accountClassificationSchema.default('other'),
  cashFlowClass: cashFlowClassSchema.default('operating'),
  parentId: id.optional(),
  currency: currency.default('INR'),
  allowPosting: z.boolean().default(true),
  reconciliationRequired: z.boolean().default(false),
  active: z.boolean().default(true),
}).strict();
export type FinanceAccountCreate = z.infer<typeof financeAccountCreateSchema>;

export const financeAccountUpdateSchema = financeAccountCreateSchema.partial().omit({ code: true }).extend({ expectedRowVersion }).strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'expectedRowVersion'), 'Provide at least one account field to change.');
export type FinanceAccountUpdate = z.infer<typeof financeAccountUpdateSchema>;

export const periodTransitionSchema = z.object({ expectedRowVersion, reason: z.string().trim().min(5).max(1000) }).strict();
export type PeriodTransition = z.infer<typeof periodTransitionSchema>;

export const bankStatementLineSchema = z.object({
  lineId: code,
  transactionDate: isoBusinessDateSchema,
  valueDate: isoBusinessDateSchema.optional(),
  reference: z.string().trim().max(200).default(''),
  narration: z.string().trim().max(1000).default(''),
  debit: moneyDecimalSchema,
  credit: moneyDecimalSchema,
}).strict().superRefine((line, ctx) => {
  const hasDebit = isPositiveDecimal(line.debit);
  const hasCredit = isPositiveDecimal(line.credit);
  if (hasDebit === hasCredit) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['debit'], message: 'Each statement line requires either debit or credit, never both.' });
});

export const bankStatementImportSchema = z.object({
  bankAccountId: id,
  statementReference: z.string().trim().min(1).max(200),
  statementFrom: isoBusinessDateSchema,
  statementTo: isoBusinessDateSchema,
  openingBalance: moneyDecimalSchema,
  closingBalance: moneyDecimalSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  lines: z.array(bankStatementLineSchema).min(1).max(10000),
}).strict().refine((value) => value.statementTo >= value.statementFrom, { path: ['statementTo'], message: 'Statement end must not precede its start.' });
export type BankStatementImport = z.infer<typeof bankStatementImportSchema>;

export const bankLineActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('match'), expectedRowVersion, voucherLineId: id }).strict(),
  z.object({ action: z.literal('unmatch'), expectedRowVersion }).strict(),
  z.object({ action: z.literal('ignore'), expectedRowVersion, reason: z.string().trim().min(5).max(500) }).strict(),
]);
export type BankLineAction = z.infer<typeof bankLineActionSchema>;
export const bankReconciliationCompleteSchema = z.object({ expectedRowVersion }).strict();

export const assetAccountingProfileSchema = z.object({
  capitalizationClearingAccountId: id,
  assetAccountId: id,
  accumulatedDepreciationAccountId: id,
  depreciationExpenseAccountId: id,
  accumulatedImpairmentAccountId: id,
  impairmentExpenseAccountId: id,
  disposalProceedsAccountId: id,
  disposalGainAccountId: id,
  disposalLossAccountId: id,
}).strict();

export const assetCreateSchema = z.object({
  financialYearId: id,
  assetCode: code,
  name: z.string().trim().min(2).max(200),
  category: z.string().trim().min(1).max(100),
  acquisitionDate: isoBusinessDateSchema,
  acquisitionCost: positiveMoney,
  residualValue: moneyDecimalSchema.default('0'),
  depreciationMethod: z.enum(['slm', 'wdv']),
  usefulLifeMonths: z.number().int().positive().max(1200),
  depreciationRate: rateDecimalSchema.default('0'),
  location: jsonObject.default({}),
  accountingProfile: assetAccountingProfileSchema,
  originMetadata: jsonObject.default({}),
}).strict().superRefine((value, ctx) => {
  if (decimalToScaled(value.residualValue) > decimalToScaled(value.acquisitionCost)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['residualValue'], message: 'Residual value cannot exceed acquisition cost.' });
  if (value.depreciationMethod === 'wdv' && !isPositiveDecimal(value.depreciationRate)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['depreciationRate'], message: 'WDV assets require a positive annual depreciation rate.' });
});
export type AssetCreate = z.infer<typeof assetCreateSchema>;

const assetProposalBase = z.object({ expectedRowVersion, businessDate: isoBusinessDateSchema }).strict();
export const assetCapitalizeSchema = assetProposalBase.extend({ capitalizationDate: isoBusinessDateSchema }).strict();
export const assetTransferSchema = assetProposalBase.extend({ toLocation: jsonObject, reason: z.string().trim().min(5).max(1000) }).strict();
export const assetDepreciationSchema = assetProposalBase.extend({ throughDate: isoBusinessDateSchema, months: z.number().int().positive().max(1200) }).strict();
export const assetImpairmentSchema = assetProposalBase.extend({ amount: positiveMoney, reason: z.string().trim().min(5).max(1000) }).strict();
export const assetDisposalSchema = assetProposalBase.extend({ proceeds: moneyDecimalSchema, reason: z.string().trim().min(5).max(1000) }).strict();
export type AssetCapitalize = z.infer<typeof assetCapitalizeSchema>;
export type AssetTransfer = z.infer<typeof assetTransferSchema>;
export type AssetDepreciation = z.infer<typeof assetDepreciationSchema>;
export type AssetImpairment = z.infer<typeof assetImpairmentSchema>;
export type AssetDisposal = z.infer<typeof assetDisposalSchema>;

export const budgetLineSchema = z.object({
  accountId: id,
  periodNumber: z.number().int().min(1).max(24),
  costCenterId: id.optional(),
  plantId: id.optional(),
  amount: moneyDecimalSchema,
}).strict();
export const budgetCreateSchema = z.object({
  financialYearId: id, budgetCode: code, name: z.string().trim().min(2).max(200),
  dimensionType: z.enum(['account', 'cost_center', 'plant']), currency: currency.default('INR'),
  lines: z.array(budgetLineSchema).min(1).max(10000),
}).strict();
export const budgetTransitionSchema = z.object({ expectedRowVersion }).strict();
export type BudgetCreate = z.infer<typeof budgetCreateSchema>;

const intercompanySideSchema = z.object({ currency, lines: z.array(voucherLineSchema).min(2).max(500) }).strict();
export const intercompanyCreateSchema = z.object({
  targetLegalEntityId: id,
  reference: z.string().trim().min(1).max(200),
  businessDate: isoBusinessDateSchema,
  exchangeRate: rateDecimalSchema.refine(isPositiveDecimal, 'Exchange rate must be positive.'),
  rateEffectiveFrom: isoBusinessDateSchema,
  rateEffectiveTo: isoBusinessDateSchema.optional(),
  rateSourceReference: z.string().trim().min(3).max(500),
  source: intercompanySideSchema,
  target: intercompanySideSchema,
}).strict().superRefine((value, ctx) => {
  if (value.rateEffectiveTo && value.rateEffectiveTo < value.rateEffectiveFrom) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rateEffectiveTo'], message: 'Rate end must not precede its start.' });
  if (value.businessDate < value.rateEffectiveFrom || (value.rateEffectiveTo && value.businessDate > value.rateEffectiveTo)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['businessDate'], message: 'Business date must fall inside the supplied FX effective range.' });
});
export type IntercompanyCreate = z.infer<typeof intercompanyCreateSchema>;

export const consolidationReportSchema = z.object({
  reportDate: isoBusinessDateSchema,
  groupCurrency: currency,
  legalEntityIds: z.array(id).min(1).max(50),
  rates: z.array(z.object({
    legalEntityId: id, currency, rate: rateDecimalSchema.refine(isPositiveDecimal),
    effectiveFrom: isoBusinessDateSchema, effectiveTo: isoBusinessDateSchema.optional(), sourceReference: z.string().trim().min(3).max(500),
  }).strict()).min(1).max(50),
  eliminationVoucherIds: z.array(id).max(500).default([]),
}).strict();
export type ConsolidationReport = z.infer<typeof consolidationReportSchema>;

export const consolidationEliminationCreateSchema = z.object({
  businessDate: isoBusinessDateSchema,
  currency: currency,
  reference: z.string().trim().min(1).max(200),
  narration: z.string().trim().min(5).max(1000),
  lines: z.array(voucherLineSchema).min(2).max(500),
}).strict();
export type ConsolidationEliminationCreate = z.infer<typeof consolidationEliminationCreateSchema>;

export const financeReportQuerySchema = z.object({
  from: isoBusinessDateSchema.optional(), to: isoBusinessDateSchema.optional(),
  asOf: isoBusinessDateSchema.optional(), accountId: id.optional(), financialYearId: id.optional(),
  costCenterId: id.optional(), plantId: id.optional(), budgetId: id.optional(),
}).strict();
export type FinanceReportQuery = z.infer<typeof financeReportQuerySchema>;
