import { z } from 'zod';
import { decimalIsPositive, decimalSum, isDecimalString, scaledToDecimal } from './decimal';

export const decimalStringSchema = z.string()
  .max(25)
  .refine(isDecimalString, 'Use a non-negative decimal string with at most 18 whole and 6 fractional digits.');

export const moneyStringSchema = z.string()
  .max(22)
  .regex(/^\d{1,18}(?:\.\d{1,2})?$/, 'Use a non-negative money string with at most two fractional digits.');

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO date (YYYY-MM-DD).')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Use a valid calendar date.');

export const legalEntityCreateSchema = z.object({
  code: z.string().trim().min(2).max(20).regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use an uppercase company code.'),
  name: z.string().trim().min(2).max(200),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).default('IN'),
  baseCurrency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default('INR'),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(4),
}).strict();
export type LegalEntityCreate = z.infer<typeof legalEntityCreateSchema>;

export const voucherTypeSchema = z.enum([
  'contra',
  'payment',
  'receipt',
  'journal',
  'sales',
  'purchase',
  'credit_note',
  'debit_note',
  'stock_journal',
  'manufacturing_journal',
  'opening',
  'depreciation',
  'fx_adjustment',
  'intercompany',
  'consolidation_elimination',
]);
export type VoucherType = z.infer<typeof voucherTypeSchema>;

const voucherDimensionsSchema = z.object({
  partyId: z.string().trim().min(1).max(128).optional(),
  costCenterId: z.string().trim().min(1).max(128).optional(),
  profitCenterId: z.string().trim().min(1).max(128).optional(),
  plantId: z.string().trim().min(1).max(128).optional(),
  warehouseId: z.string().trim().min(1).max(128).optional(),
  productionOrderId: z.string().trim().min(1).max(128).optional(),
}).strict();

export const voucherLineSchema = z.object({
  ledgerAccountId: z.string().trim().min(1).max(128),
  debit: moneyStringSchema,
  credit: moneyStringSchema,
  narration: z.string().trim().max(500).default(''),
  dimensions: voucherDimensionsSchema.default({}),
}).strict().superRefine((line, ctx) => {
  const hasDebit = decimalIsPositive(line.debit);
  const hasCredit = decimalIsPositive(line.credit);
  if (hasDebit === hasCredit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Each line must contain either a positive debit or a positive credit, never both.',
      path: ['debit'],
    });
  }
});
export type VoucherLineInput = z.infer<typeof voucherLineSchema>;

function requireBalancedLines(lines: VoucherLineInput[], ctx: z.RefinementCtx): void {
  const debit = decimalSum(lines.map((line) => line.debit));
  const credit = decimalSum(lines.map((line) => line.credit));
  if (debit !== credit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Voucher debits (${scaledToDecimal(debit)}) must equal credits (${scaledToDecimal(credit)}).`,
      path: ['lines'],
    });
  }
}

export const voucherCreateSchema = z.object({
  voucherType: voucherTypeSchema,
  voucherDate: isoDateSchema,
  currencyCode: z.string().trim().length(3).transform((value) => value.toUpperCase()).default('INR'),
  reference: z.string().trim().max(100).default(''),
  narration: z.string().trim().max(1000).default(''),
  lines: z.array(voucherLineSchema).min(2).max(500),
}).strict().superRefine((value, ctx) => requireBalancedLines(value.lines, ctx));
export type VoucherCreate = z.infer<typeof voucherCreateSchema>;

export const voucherUpdateSchema = z.object({
  expectedVersion: z.number().int().min(0),
  voucherDate: isoDateSchema.optional(),
  reference: z.string().trim().max(100).optional(),
  narration: z.string().trim().max(1000).optional(),
  lines: z.array(voucherLineSchema).min(2).max(500).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.lines) requireBalancedLines(value.lines, ctx);
});
export type VoucherUpdate = z.infer<typeof voucherUpdateSchema>;

export const voucherPostSchema = z.object({
  expectedVersion: z.number().int().min(0),
}).strict();
export type VoucherPost = z.infer<typeof voucherPostSchema>;

export const voucherTransitionSchema = voucherPostSchema;
export type VoucherTransition = VoucherPost;

export const voucherReversalCreateSchema = z.object({
  expectedVersion: z.number().int().min(0),
  voucherDate: isoDateSchema,
  reason: z.string().trim().min(5).max(1000),
}).strict();
export type VoucherReversalCreate = z.infer<typeof voucherReversalCreateSchema>;

export function assertBalancedVoucherLines(lines: VoucherLineInput[]): void {
  const debit = decimalSum(lines.map((line) => line.debit));
  const credit = decimalSum(lines.map((line) => line.credit));
  if (debit !== credit || debit === 0n) {
    throw new Error('Voucher lines must contain equal, non-zero debit and credit totals.');
  }
}
