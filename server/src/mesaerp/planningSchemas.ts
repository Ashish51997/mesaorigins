import { z } from 'zod';
import { isoBusinessDateSchema, positiveQuantityDecimalSchema, quantityDecimalSchema } from './commercialManufacturingSchemas';
import { decimalToScaled } from './decimal';

const codeSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._/-]+$/);
const idSchema = z.string().trim().min(1).max(128);
const uomSchema = z.string().trim().min(1).max(30);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const percentSchema = z.string().max(8).regex(
  /^(?:100(?:\.0{1,4})?|\d{1,2}(?:\.\d{1,4})?)$/,
  'Percentage must be between 0 and 100 with at most 4 fractional digits.',
);

export const planningPolicyUpdateSchema = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  leadTimeDays: z.number().int().min(0).max(3650),
  safetyStock: quantityDecimalSchema.default('0'),
  minimumStock: quantityDecimalSchema.default('0'),
  maximumStock: quantityDecimalSchema.optional(),
  lotSizing: z.enum(['lot_for_lot', 'fixed', 'min_max']).default('lot_for_lot'),
  fixedLotSize: quantityDecimalSchema.default('0'),
  minimumOrderQuantity: quantityDecimalSchema.default('0'),
  orderMultiple: quantityDecimalSchema.default('0'),
  supplyPolicy: z.enum(['make', 'buy', 'transfer']),
  planningWarehouseId: idSchema,
  transferSourceWarehouseId: idSchema.optional(),
  preferredVendorId: idSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.maximumStock !== undefined && decimalToScaled(value.maximumStock) < decimalToScaled(value.minimumStock)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maximumStock'], message: 'Maximum stock cannot be below minimum stock.' });
  }
  if (value.lotSizing === 'fixed' && decimalToScaled(value.fixedLotSize) <= 0n) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fixedLotSize'], message: 'Fixed lot sizing requires a positive fixed lot size.' });
  }
  if (value.lotSizing === 'min_max' && value.maximumStock === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maximumStock'], message: 'Min-max sizing requires a maximum stock quantity.' });
  }
  if (value.supplyPolicy === 'transfer' && !value.transferSourceWarehouseId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transferSourceWarehouseId'], message: 'Transfer policy requires a source warehouse.' });
  }
  if (value.transferSourceWarehouseId === value.planningWarehouseId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transferSourceWarehouseId'], message: 'Transfer source and planning warehouse must differ.' });
  }
});
export type PlanningPolicyUpdate = z.infer<typeof planningPolicyUpdateSchema>;

export const planningBomComponentSchema = z.object({
  componentItemId: idSchema,
  issueWarehouseId: idSchema.optional(),
  quantity: positiveQuantityDecimalSchema,
  uom: uomSchema,
  scrapPercentage: percentSchema.default('0'),
  componentType: z.enum(['material', 'packaging']).default('material'),
  phase: z.string().trim().max(100).default(''),
  dimensions: jsonObjectSchema.default({}),
}).strict();
export type PlanningBomComponentInput = z.infer<typeof planningBomComponentSchema>;

const planningBomRevisionBaseSchema = z.object({
  revisionCode: codeSchema,
  effectiveFrom: isoBusinessDateSchema,
  effectiveTo: isoBusinessDateSchema.optional(),
  outputQuantity: positiveQuantityDecimalSchema,
  outputUom: uomSchema,
  yieldPercentage: percentSchema.refine((value) => decimalToScaled(value) > 0n, 'Yield percentage must be greater than zero.').default('100'),
  notes: z.string().trim().max(2000).default(''),
  formulaParameters: jsonObjectSchema.default({}),
  components: z.array(planningBomComponentSchema).min(1).max(1000),
}).strict();

export const planningBomRevisionInputSchema = planningBomRevisionBaseSchema.superRefine((value, ctx) => {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveTo'], message: 'Effective-to date cannot precede effective-from date.' });
  }
  const duplicates = value.components.map((line) => line.componentItemId).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicates.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['components'], message: 'A component item may appear only once in a revision.' });
});
export type PlanningBomRevisionInput = z.infer<typeof planningBomRevisionInputSchema>;

export const planningBomCreateSchema = z.object({
  bomCode: codeSchema,
  parentItemId: idSchema,
  bomType: z.enum(['discrete', 'formula']),
  description: z.string().trim().max(500).default(''),
  revision: planningBomRevisionInputSchema,
}).strict();
export type PlanningBomCreate = z.infer<typeof planningBomCreateSchema>;

export const planningBomRevisionCreateSchema = planningBomRevisionInputSchema;
export type PlanningBomRevisionCreate = z.infer<typeof planningBomRevisionCreateSchema>;

export const planningBomRevisionUpdateSchema = planningBomRevisionBaseSchema.partial().extend({
  expectedRowVersion: z.number().int().nonnegative(),
  revisionCode: z.never().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedRowVersion'), {
  message: 'Provide at least one revision field to change.',
});
export type PlanningBomRevisionUpdate = z.infer<typeof planningBomRevisionUpdateSchema>;

export const rowVersionSchema = z.object({ expectedRowVersion: z.number().int().nonnegative() }).strict();
export type PlanningRowVersion = z.infer<typeof rowVersionSchema>;

export const demandForecastCreateSchema = z.object({
  forecastNumber: codeSchema.optional(),
  itemId: idSchema,
  warehouseId: idSchema,
  forecastDate: isoBusinessDateSchema,
  quantity: positiveQuantityDecimalSchema,
  uom: uomSchema,
  notes: z.string().trim().max(2000).default(''),
}).strict();
export type DemandForecastCreate = z.infer<typeof demandForecastCreateSchema>;

export const stockReservationCreateSchema = z.object({
  reservationNumber: codeSchema.optional(),
  itemId: idSchema,
  warehouseId: idSchema,
  quantity: positiveQuantityDecimalSchema,
  uom: uomSchema,
  batchNumber: z.string().trim().max(120).default(''),
  serialNumber: z.string().trim().max(120).default(''),
  sourceType: z.enum(['sales_order', 'production_demand', 'manual']).default('manual'),
  sourceId: idSchema.optional(),
  sourceLineId: idSchema.optional(),
  requiredOn: isoBusinessDateSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.sourceType !== 'manual' && !value.sourceId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceId'], message: 'Document-backed reservations require a source ID.' });
  }
  if (value.sourceType === 'sales_order' && !value.sourceLineId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceLineId'], message: 'Sales-order reservations require a source line ID.' });
  }
  if (value.sourceType === 'manual' && (value.sourceId || value.sourceLineId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceType'], message: 'Manual reservations cannot assert a document source.' });
  }
});
export type StockReservationCreate = z.infer<typeof stockReservationCreateSchema>;

export const mrpRunCreateSchema = z.object({
  runNumber: codeSchema.optional(),
  asOfDate: isoBusinessDateSchema,
  horizonEnd: isoBusinessDateSchema,
  warehouseIds: z.array(idSchema).min(1).max(100).optional(),
  includeSalesOrders: z.boolean().default(true),
  includeForecasts: z.boolean().default(true),
  includeProductionDemands: z.boolean().default(true),
  forecastTreatment: z.enum(['additive']).default('additive'),
}).strict().refine((value) => value.horizonEnd >= value.asOfDate, {
  path: ['horizonEnd'], message: 'MRP horizon end cannot precede the as-of date.',
});
export type MrpRunCreate = z.infer<typeof mrpRunCreateSchema>;

export const atpQuerySchema = z.object({
  itemId: idSchema,
  warehouseId: idSchema,
  asOfDate: isoBusinessDateSchema.optional(),
  requiredOn: isoBusinessDateSchema.optional(),
}).strict();
export type AtpQuery = z.infer<typeof atpQuerySchema>;
