import { z } from 'zod';
import {
  isoBusinessDateSchema,
  moneyDecimalSchema,
  positiveQuantityDecimalSchema,
  quantityDecimalSchema,
  rateDecimalSchema,
} from './commercialManufacturingSchemas';

const codeSchema = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._/-]+$/);
const accountReferenceSchema = z.string().trim().min(1).max(128);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const signedQuantityDecimalSchema = z.string().max(20).regex(
  /^-?\d{1,12}(?:\.\d{1,6})?$/,
  'Use a signed decimal string with at most 12 whole and 6 fractional digits.',
).refine((value) => !/^\-?0(?:\.0+)?$/.test(value), 'Quantity cannot be zero.');
const gstRateSchema = z.string().max(8).regex(
  /^(?:100(?:\.0{1,4})?|\d{1,2}(?:\.\d{1,4})?)$/,
  'GST rate must be between 0 and 100 with at most 4 fractional digits.',
);

export const uomConversionSchema = z.object({
  uom: z.string().trim().min(1).max(30),
  factorToBase: rateDecimalSchema.refine((value) => /[1-9]/.test(value), 'Conversion factor must be greater than zero.'),
}).strict();

const itemBaseSchema = z.object({
  itemCode: codeSchema,
  name: z.string().trim().min(2).max(200),
  itemType: z.enum(['inventory', 'service', 'asset', 'expense']).default('inventory'),
  category: z.string().trim().max(100).default(''),
  baseUom: z.string().trim().min(1).max(30),
  uomConversions: z.array(uomConversionSchema).max(50).default([]),
  hsnSacCode: z.string().trim().max(30).default(''),
  gstRate: gstRateSchema.default('0'),
  valuationMethod: z.enum(['moving_average', 'fifo']).default('moving_average'),
  batchTracked: z.boolean().default(false),
  serialTracked: z.boolean().default(false),
  expiryTracked: z.boolean().default(false),
  inventoryAccount: accountReferenceSchema.optional(),
  consumptionAccount: accountReferenceSchema.optional(),
  salesAccount: accountReferenceSchema.optional(),
  purchaseAccount: accountReferenceSchema.optional(),
  active: z.boolean().default(true),
  attributes: jsonObjectSchema.default({}),
}).strict();

export const itemCreateSchema = itemBaseSchema.superRefine((value, ctx) => {
  if (value.itemType === 'inventory' && !value.inventoryAccount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['inventoryAccount'], message: 'Inventory items require an inventory posting account.' });
  }
  if (value.expiryTracked && !value.batchTracked) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiryTracked'], message: 'Expiry tracking requires batch tracking.' });
  }
  const seen = new Set<string>();
  for (const conversion of value.uomConversions) {
    const normalized = conversion.uom.toUpperCase();
    if (normalized === value.baseUom.toUpperCase() || seen.has(normalized)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['uomConversions'], message: 'Conversion UOMs must be unique and different from the base UOM.' });
      break;
    }
    seen.add(normalized);
  }
});
export type ItemCreate = z.infer<typeof itemCreateSchema>;

export const itemUpdateSchema = itemBaseSchema.partial().extend({
  expectedRowVersion: z.number().int().nonnegative(),
  itemCode: z.never().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedRowVersion'), {
  message: 'Provide at least one item field to change.',
});
export type ItemUpdate = z.infer<typeof itemUpdateSchema>;

const warehouseBaseSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2).max(200),
  kind: z.enum(['plant', 'warehouse', 'godown', 'subcontractor']).default('warehouse'),
  plantCode: z.string().trim().max(40).default(''),
  branchCode: z.string().trim().max(40).default(''),
  address: jsonObjectSchema.default({}),
  active: z.boolean().default(true),
}).strict();
export const warehouseCreateSchema = warehouseBaseSchema;
export type WarehouseCreate = z.infer<typeof warehouseCreateSchema>;

export const warehouseUpdateSchema = warehouseBaseSchema.partial().extend({
  expectedRowVersion: z.number().int().nonnegative(),
  code: z.never().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedRowVersion'), {
  message: 'Provide at least one warehouse field to change.',
});
export type WarehouseUpdate = z.infer<typeof warehouseUpdateSchema>;

export const stockTraceSchema = z.object({
  batchNumber: z.string().trim().max(120).default(''),
  serialNumber: z.string().trim().max(120).default(''),
  expiryDate: isoBusinessDateSchema.optional(),
}).strict();

export const stockAdjustmentLineSchema = stockTraceSchema.extend({
  itemId: z.string().trim().min(1).max(128),
  warehouseId: z.string().trim().min(1).max(128),
  quantity: signedQuantityDecimalSchema,
  uom: z.string().trim().min(1).max(30),
  unitCost: rateDecimalSchema.optional(),
  adjustmentAccount: accountReferenceSchema.default('5000'),
}).strict().superRefine((value, ctx) => {
  if (!value.quantity.startsWith('-') && value.unitCost === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['unitCost'], message: 'Positive adjustments require an explicit unit cost.' });
  }
});

export const stockAdjustmentCreateSchema = z.object({
  businessDate: isoBusinessDateSchema,
  reference: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(5).max(1000),
  lines: z.array(stockAdjustmentLineSchema).min(1).max(500),
}).strict();
export type StockAdjustmentCreate = z.infer<typeof stockAdjustmentCreateSchema>;

export const stockTransferLineSchema = stockTraceSchema.extend({
  itemId: z.string().trim().min(1).max(128),
  quantity: positiveQuantityDecimalSchema,
  uom: z.string().trim().min(1).max(30),
}).strict();

export const stockTransferCreateSchema = z.object({
  businessDate: isoBusinessDateSchema,
  reference: z.string().trim().min(1).max(200),
  fromWarehouseId: z.string().trim().min(1).max(128),
  toWarehouseId: z.string().trim().min(1).max(128),
  lines: z.array(stockTransferLineSchema).min(1).max(500),
}).strict().refine((value) => value.fromWarehouseId !== value.toWarehouseId, {
  path: ['toWarehouseId'], message: 'Transfer source and destination warehouses must differ.',
});
export type StockTransferCreate = z.infer<typeof stockTransferCreateSchema>;

export const physicalCountLineSchema = stockTraceSchema.extend({
  itemId: z.string().trim().min(1).max(128),
  countedQuantity: quantityDecimalSchema,
  uom: z.string().trim().min(1).max(30),
  receiptUnitCost: rateDecimalSchema.optional(),
  adjustmentAccount: accountReferenceSchema.default('5000'),
}).strict();

export const physicalCountCreateSchema = z.object({
  countNumber: codeSchema.optional(),
  businessDate: isoBusinessDateSchema,
  warehouseId: z.string().trim().min(1).max(128),
  reference: z.string().trim().min(1).max(200),
  lines: z.array(physicalCountLineSchema).min(1).max(1000),
}).strict();
export type PhysicalCountCreate = z.infer<typeof physicalCountCreateSchema>;

// Exported for response contracts and tests that verify all monetary and
// quantity inputs stay string-based at the HTTP boundary.
export const inventoryMoneyDecimalSchema = moneyDecimalSchema;
