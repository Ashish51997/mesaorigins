import { z } from 'zod';

export const isoBusinessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO date (YYYY-MM-DD).')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Use a valid calendar date.');

export const quantityDecimalSchema = z.string().max(19).regex(
  /^\d{1,12}(?:\.\d{1,6})?$/,
  'Use a non-negative decimal string with at most 12 whole and 6 fractional digits.',
);
export const positiveQuantityDecimalSchema = quantityDecimalSchema.refine(
  (value) => /[1-9]/.test(value),
  'Quantity must be greater than zero.',
);
export const moneyDecimalSchema = z.string().max(19).regex(
  /^\d{1,16}(?:\.\d{1,2})?$/,
  'Use a non-negative money string with at most 16 whole and 2 fractional digits.',
);
export const rateDecimalSchema = z.string().max(19).regex(
  /^\d{1,12}(?:\.\d{1,6})?$/,
  'Use a non-negative rate string with at most 12 whole and 6 fractional digits.',
);
const exchangeRateSchema = z.string().max(19).regex(
  /^\d{1,10}(?:\.\d{1,8})?$/,
  'Use an exchange-rate string with at most 10 whole and 8 fractional digits.',
).refine((value) => /[1-9]/.test(value), 'Exchange rate must be greater than zero.');
const taxRateSchema = z.string().max(8).regex(
  /^(?:100(?:\.0{1,4})?|\d{1,2}(?:\.\d{1,4})?)$/,
  'Tax rate must be between 0 and 100 with at most 4 fractional digits.',
);
const currencySchema = z.string().trim().length(3).transform((value) => value.toUpperCase());
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const customerCreateSchema = z.object({
  customerCode: z.string().trim().min(1).max(50),
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().max(200).default(''),
  pan: z.string().trim().max(20).default(''),
  gstin: z.string().trim().max(30).default(''),
  addresses: z.array(jsonObjectSchema).max(50).default([]),
  contacts: z.array(jsonObjectSchema).max(50).default([]),
  paymentTerms: z.string().trim().max(200).default(''),
  currency: currencySchema.default('INR'),
  creditLimit: moneyDecimalSchema.default('0'),
  creditDays: z.number().int().min(0).max(3650).default(0),
  status: z.enum(['active', 'on_hold', 'blocked']).default('active'),
  originMetadata: jsonObjectSchema.default({}),
}).strict();
export type CustomerCreate = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  legalName: z.string().trim().min(2).max(200).optional(),
  tradeName: z.string().trim().max(200).optional(),
  pan: z.string().trim().max(20).optional(),
  gstin: z.string().trim().max(30).optional(),
  addresses: z.array(jsonObjectSchema).max(50).optional(),
  contacts: z.array(jsonObjectSchema).max(50).optional(),
  paymentTerms: z.string().trim().max(200).optional(),
  currency: currencySchema.optional(),
  creditLimit: moneyDecimalSchema.optional(),
  creditDays: z.number().int().min(0).max(3650).optional(),
  status: z.enum(['active', 'on_hold', 'blocked']).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedRowVersion'), {
  message: 'Provide at least one customer field to change.',
});
export type CustomerUpdate = z.infer<typeof customerUpdateSchema>;

export const salesDocumentTypeSchema = z.enum(['sales_order', 'sales_invoice']);
export type SalesDocumentType = z.infer<typeof salesDocumentTypeSchema>;

export const salesDocumentLineSchema = z.object({
  itemId: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(500),
  hsnSacCode: z.string().trim().max(30).default(''),
  quantity: positiveQuantityDecimalSchema,
  uom: z.string().trim().min(1).max(30),
  unitPrice: rateDecimalSchema,
  discountAmount: moneyDecimalSchema.default('0'),
  taxRate: taxRateSchema.default('0'),
  taxAmount: moneyDecimalSchema.optional(),
  warehouseCode: z.string().trim().max(80).default(''),
  batchNumber: z.string().trim().max(120).default(''),
  promisedOn: isoBusinessDateSchema.optional(),
  sourceLineId: z.string().trim().min(1).max(128).optional(),
  dimensions: jsonObjectSchema.default({}),
}).strict();
export type SalesDocumentLine = z.infer<typeof salesDocumentLineSchema>;

export const salesDocumentCreateSchema = z.object({
  documentNumber: z.string().trim().min(1).max(100).optional(),
  documentDate: isoBusinessDateSchema,
  dueDate: isoBusinessDateSchema.optional(),
  customerId: z.string().trim().min(1).max(128),
  sourceSalesOrderId: z.string().trim().min(1).max(128).optional(),
  currency: currencySchema.default('INR'),
  exchangeRate: exchangeRateSchema.default('1'),
  terms: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  shipping: jsonObjectSchema.default({}),
  originType: z.enum(['manual', 'import', 'api', 'mesaleads_snapshot']).default('manual'),
  originMetadata: jsonObjectSchema.default({}),
  lines: z.array(salesDocumentLineSchema).min(1).max(500),
}).strict().superRefine((value, ctx) => {
  if (value.dueDate && value.dueDate < value.documentDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'Due date cannot be earlier than the document date.' });
  }
});
export type SalesDocumentCreate = z.infer<typeof salesDocumentCreateSchema>;

export const rowVersionTransitionSchema = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
}).strict();
export type RowVersionTransition = z.infer<typeof rowVersionTransitionSchema>;

export const productionDemandCreateSchema = z.object({
  demandNumber: z.string().trim().min(1).max(100).optional(),
  demandDate: isoBusinessDateSchema,
  demandType: z.enum(['sales_order', 'internal', 'forecast', 'replenishment', 'trial', 'rework', 'import']),
  itemId: z.string().trim().min(1).max(128),
  quantity: positiveQuantityDecimalSchema,
  uom: z.string().trim().min(1).max(30),
  requiredOn: isoBusinessDateSchema.optional(),
  plantCode: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/).default('PRIMARY'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  bomSnapshot: jsonObjectSchema.default({}),
  materialRequirements: z.array(jsonObjectSchema).max(1000).default([]),
  suggestions: z.array(jsonObjectSchema).max(1000).default([]),
  sourceSalesOrderId: z.string().trim().min(1).max(128).optional(),
  sourceLineId: z.string().trim().min(1).max(128).optional(),
  originType: z.enum(['manual', 'api', 'import', 'sales_order_snapshot']).default('manual'),
  originMetadata: jsonObjectSchema.default({}),
}).strict().superRefine((value, ctx) => {
  if ((value.sourceSalesOrderId && !value.sourceLineId) || (!value.sourceSalesOrderId && value.sourceLineId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceSalesOrderId'], message: 'sourceSalesOrderId and sourceLineId must be supplied together.' });
  }
  if (value.demandType === 'sales_order' && !value.sourceSalesOrderId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceSalesOrderId'], message: 'Sales-order demand requires an approved sales-order line snapshot.' });
  }
  if (value.sourceSalesOrderId && value.demandType !== 'sales_order') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['demandType'], message: 'A sales-order snapshot must use demandType sales_order.' });
  }
  if (value.requiredOn && value.requiredOn < value.demandDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requiredOn'], message: 'Required date cannot be earlier than demand date.' });
  }
});
export type ProductionDemandCreate = z.infer<typeof productionDemandCreateSchema>;

export const manufacturingValuedLineSchema = z.object({
  itemId: z.string().trim().min(1).max(128).optional(),
  description: z.string().trim().min(1).max(500),
  quantity: positiveQuantityDecimalSchema,
  uom: z.string().trim().min(1).max(30).default('EA'),
  rate: rateDecimalSchema,
  amount: moneyDecimalSchema.optional(),
  warehouseCode: z.string().trim().max(80).default(''),
  batchNumber: z.string().trim().max(120).default(''),
  dimensions: jsonObjectSchema.default({}),
}).strict();
export type ManufacturingValuedLine = z.infer<typeof manufacturingValuedLineSchema>;

export const manufacturingOutputLineSchema = z.object({
  itemId: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(500),
  quantity: positiveQuantityDecimalSchema,
  uom: z.string().trim().min(1).max(30),
  warehouseCode: z.string().trim().max(80).default(''),
  batchNumber: z.string().trim().max(120).default(''),
  outputType: z.enum(['finished_good', 'by_product', 'scrap']).default('finished_good'),
  dimensions: jsonObjectSchema.default({}),
}).strict();
export type ManufacturingOutputLine = z.infer<typeof manufacturingOutputLineSchema>;

export const manufacturingVoucherCreateSchema = z.object({
  voucherNumber: z.string().trim().min(1).max(100).optional(),
  voucherType: z.enum(['issue', 'return', 'manufacturing', 'completion', 'rework']).default('manufacturing'),
  businessDate: isoBusinessDateSchema,
  productionDemandId: z.string().trim().min(1).max(128).optional(),
  batchNumber: z.string().trim().min(1).max(120),
  materialLines: z.array(manufacturingValuedLineSchema).max(1000).default([]),
  outputLines: z.array(manufacturingOutputLineSchema).max(1000).default([]),
  laborLines: z.array(manufacturingValuedLineSchema).max(1000).default([]),
  resourceLines: z.array(manufacturingValuedLineSchema).max(1000).default([]),
  overheadLines: z.array(manufacturingValuedLineSchema).max(1000).default([]),
  subcontractLines: z.array(manufacturingValuedLineSchema).max(1000).default([]),
  recoveryCredits: z.array(manufacturingValuedLineSchema).max(1000).default([]),
  qaDisposition: z.object({
    status: z.enum(['pending', 'accepted', 'hold', 'rejected', 'rework', 'not_applicable']).default('pending'),
    reference: z.string().trim().max(200).default(''),
    notes: z.string().trim().max(2000).default(''),
  }).strict().default({ status: 'pending', reference: '', notes: '' }),
  originType: z.enum(['manual', 'api', 'import', 'mesaops_snapshot']).default('manual'),
  originMetadata: jsonObjectSchema.default({}),
}).strict().superRefine((value, ctx) => {
  if (['manufacturing', 'completion', 'rework'].includes(value.voucherType) && value.outputLines.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['outputLines'], message: 'Completion-style vouchers require at least one output line.' });
  }
  if (['issue', 'return'].includes(value.voucherType) && value.materialLines.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['materialLines'], message: 'Issue and return vouchers require material lines.' });
  }
});
export type ManufacturingVoucherCreate = z.infer<typeof manufacturingVoucherCreateSchema>;
