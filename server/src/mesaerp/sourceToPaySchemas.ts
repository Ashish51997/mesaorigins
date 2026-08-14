import { z } from 'zod';

export const sourceToPayDocumentTypeSchema = z.enum([
  'purchase_requisition',
  'purchase_order',
  'goods_receipt',
  'supplier_invoice',
]);
export type SourceToPayDocumentType = z.infer<typeof sourceToPayDocumentTypeSchema>;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO date (YYYY-MM-DD).')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Use a valid calendar date.');

const quantityDecimalSchema = z.string().max(19).regex(
  /^\d{1,12}(?:\.\d{1,6})?$/,
  'Use a non-negative decimal string with at most 12 whole and 6 fractional digits.',
);
const positiveQuantityDecimalSchema = quantityDecimalSchema.refine(
  (value) => /[1-9]/.test(value),
  'Quantity must be greater than zero.',
);
const moneyDecimalSchema = z.string().max(19).regex(
  /^\d{1,16}(?:\.\d{1,2})?$/,
  'Use a non-negative money string with at most 16 whole and 2 fractional digits.',
);
const exchangeRateSchema = z.string().max(19).regex(
  /^\d{1,10}(?:\.\d{1,8})?$/,
  'Use an exchange-rate string with at most 10 whole and 8 fractional digits.',
).refine((value) => /[1-9]/.test(value), 'Exchange rate must be greater than zero.');
const taxRateSchema = z.string().max(8).regex(
  /^(?:100(?:\.0{1,4})?|\d{1,2}(?:\.\d{1,4})?)$/,
  'Tax rate must be between 0 and 100 with at most 4 fractional digits.',
);
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const sourceToPayLineSchema = z.object({
  itemId: z.string().trim().min(1).max(128).optional(),
  description: z.string().trim().min(1).max(500),
  hsnSacCode: z.string().trim().max(30).default(''),
  quantity: positiveQuantityDecimalSchema,
  uom: z.string().trim().min(1).max(30),
  unitPrice: quantityDecimalSchema.default('0'),
  discountAmount: moneyDecimalSchema.default('0'),
  taxRate: taxRateSchema.default('0'),
  taxAmount: moneyDecimalSchema.optional(),
  warehouseCode: z.string().trim().max(80).default(''),
  batchNumber: z.string().trim().max(120).default(''),
  promisedOn: isoDateSchema.optional(),
  sourceLineId: z.string().trim().min(1).max(128).optional(),
  dimensions: jsonObjectSchema.default({}),
}).strict();
export type SourceToPayLineInput = z.infer<typeof sourceToPayLineSchema>;

export const sourceToPayDocumentCreateSchema = z.object({
  documentNumber: z.string().trim().min(1).max(100).optional(),
  documentDate: isoDateSchema,
  dueDate: isoDateSchema.optional(),
  vendorId: z.string().trim().min(1).max(128).optional(),
  sourceDocumentId: z.string().trim().min(1).max(128).optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default('INR'),
  exchangeRate: exchangeRateSchema.default('1'),
  terms: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  shipping: jsonObjectSchema.default({}),
  originType: z.enum(['manual', 'import', 'api', 'handoff']).default('manual'),
  originMetadata: jsonObjectSchema.default({}),
  lines: z.array(sourceToPayLineSchema).min(1).max(500),
}).strict().superRefine((value, ctx) => {
  if (value.dueDate && value.dueDate < value.documentDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'Due date cannot be earlier than the document date.' });
  }
});
export type SourceToPayDocumentCreate = z.infer<typeof sourceToPayDocumentCreateSchema>;

export const sourceToPayTransitionSchema = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
}).strict();
export type SourceToPayTransition = z.infer<typeof sourceToPayTransitionSchema>;

export const purchaseMatchCreateSchema = z.object({
  purchaseOrderId: z.string().trim().min(1).max(128),
  goodsReceiptId: z.string().trim().min(1).max(128),
  supplierInvoiceId: z.string().trim().min(1).max(128),
}).strict();
export type PurchaseMatchCreate = z.infer<typeof purchaseMatchCreateSchema>;

export const purchaseMatchApproveSchema = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(5).max(1000),
}).strict();
export type PurchaseMatchApprove = z.infer<typeof purchaseMatchApproveSchema>;
