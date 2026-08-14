import { z } from 'zod';
import {
  isoBusinessDateSchema,
  moneyDecimalSchema,
  positiveQuantityDecimalSchema,
  quantityDecimalSchema,
  rateDecimalSchema,
} from './commercialManufacturingSchemas';

const jsonObject = z.record(z.string(), z.unknown());
const expectedRowVersion = z.number().int().nonnegative();
const id = z.string().trim().min(1).max(160);
const ratePercent = z.string().max(8).regex(
  /^(?:100(?:\.0{1,4})?|\d{1,2}(?:\.\d{1,4})?)$/,
  'Use a percentage between 0 and 100 with at most four decimal places.',
);

export const handoffEventTypeSchema = z.enum([
  'mesaops.production-actuals.submitted.v1',
  'mesaops.qa-disposition.recorded.v1',
  'mesaops.physical-dispatch.completed.v1',
]);
export type HandoffEventType = z.infer<typeof handoffEventTypeSchema>;

export const handoffMappingCreateSchema = z.object({
  mappingType: z.enum(['item', 'uom', 'warehouse', 'customer']),
  sourceKey: z.string().trim().min(1).max(200),
  targetId: z.string().trim().max(160).default(''),
  targetValue: z.string().trim().max(200).default(''),
  sourceEvidence: jsonObject.default({}),
}).strict().superRefine((value, ctx) => {
  if (value.mappingType === 'uom' && !value.targetValue) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetValue'], message: 'UOM mappings require a target UOM.' });
  }
  if (value.mappingType !== 'uom' && !value.targetId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetId'], message: `${value.mappingType} mappings require a company master target id.` });
  }
});
export type HandoffMappingCreate = z.infer<typeof handoffMappingCreateSchema>;

export const handoffMappingUpdateSchema = z.object({
  expectedRowVersion,
  targetId: z.string().trim().max(160).optional(),
  targetValue: z.string().trim().max(200).optional(),
  active: z.boolean().optional(),
  sourceEvidence: jsonObject.optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedRowVersion'), {
  message: 'Provide at least one mapping field to change.',
});
export type HandoffMappingUpdate = z.infer<typeof handoffMappingUpdateSchema>;

export const handoffMappingApproveSchema = z.object({
  expectedRowVersion,
  reason: z.string().trim().min(3).max(1000),
}).strict();
export type HandoffMappingApprove = z.infer<typeof handoffMappingApproveSchema>;

export const handoffEventRouteCreateSchema = z.object({
  sourceEventId: id,
  expectedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(8).max(1000),
  routingEvidence: jsonObject,
}).strict();
export type HandoffEventRouteCreate = z.infer<typeof handoffEventRouteCreateSchema>;

export const handoffEventRouteApproveSchema = z.object({ expectedRowVersion }).strict();
export type HandoffEventRouteApprove = z.infer<typeof handoffEventRouteApproveSchema>;

export const handoffReceiveSchema = z.object({
  expectedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedEventType: handoffEventTypeSchema,
  expectedSchemaVersion: z.literal(1),
}).strict();
export type HandoffReceive = z.infer<typeof handoffReceiveSchema>;

export const handoffCostRateSchema = z.object({
  kind: z.enum(['material_return', 'labor', 'machine', 'overhead', 'subcontract', 'recovery']),
  reference: z.string().trim().min(1).max(200),
  rate: rateDecimalSchema,
}).strict();

export const handoffAcceptSchema = z.object({
  expectedRowVersion,
  productionDemandId: id.optional(),
  costRates: z.array(handoffCostRateSchema).max(1000).default([]),
  notes: z.string().trim().max(2000).default(''),
}).strict();
export type HandoffAccept = z.infer<typeof handoffAcceptSchema>;

export const handoffRejectSchema = z.object({
  expectedRowVersion,
  reason: z.string().trim().min(3).max(1000),
}).strict();
export type HandoffReject = z.infer<typeof handoffRejectSchema>;

export const handoffRetrySchema = z.object({
  expectedRowVersion,
  reason: z.string().trim().min(3).max(1000),
}).strict();
export type HandoffRetry = z.infer<typeof handoffRetrySchema>;

export const tdsSectionCreateSchema = z.object({
  code: z.string().trim().min(1).max(40).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(200),
  natureOfPayment: z.string().trim().min(2).max(300),
  sourceReference: z.string().trim().min(1).max(500),
  sourceEvidence: jsonObject.default({}),
}).strict();
export type TdsSectionCreate = z.infer<typeof tdsSectionCreateSchema>;

export const tdsTransitionSchema = z.object({ expectedRowVersion }).strict();
export type TdsTransition = z.infer<typeof tdsTransitionSchema>;

export const tdsRateCreateSchema = z.object({
  effectiveFrom: isoBusinessDateSchema,
  effectiveTo: isoBusinessDateSchema.optional(),
  standardRate: ratePercent,
  noPanRate: ratePercent,
  singlePaymentThreshold: moneyDecimalSchema.default('0'),
  aggregateThreshold: moneyDecimalSchema.default('0'),
  thresholdApplication: z.enum(['full_current', 'excess_only']).default('full_current'),
  sourceReference: z.string().trim().min(1).max(500),
  sourceEvidence: jsonObject.default({}),
}).strict().superRefine((value, ctx) => {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveTo'], message: 'effectiveTo cannot precede effectiveFrom.' });
  }
});
export type TdsRateCreate = z.infer<typeof tdsRateCreateSchema>;

export const vendorTdsClassificationCreateSchema = z.object({
  sectionId: id,
  effectiveFrom: isoBusinessDateSchema,
  effectiveTo: isoBusinessDateSchema.optional(),
  panStatus: z.enum(['valid', 'missing', 'invalid']).default('valid'),
  overrideRate: ratePercent.optional(),
  certificateReference: z.string().trim().max(200).default(''),
  evidence: jsonObject.default({}),
}).strict().superRefine((value, ctx) => {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveTo'], message: 'effectiveTo cannot precede effectiveFrom.' });
  }
});
export type VendorTdsClassificationCreate = z.infer<typeof vendorTdsClassificationCreateSchema>;

export const tdsDeductionCreateSchema = z.object({
  vendorId: id,
  payableVoucherId: id,
  paymentVoucherId: id.optional(),
  businessDate: isoBusinessDateSchema,
  grossAmount: moneyDecimalSchema.refine((value) => /[1-9]/.test(value), 'Gross amount must be greater than zero.'),
  notes: z.string().trim().max(2000).default(''),
}).strict();
export type TdsDeductionCreate = z.infer<typeof tdsDeductionCreateSchema>;

export const tdsReportQuerySchema = z.object({
  from: isoBusinessDateSchema.optional(),
  to: isoBusinessDateSchema.optional(),
  vendorId: id.optional(),
  sectionCode: z.string().trim().max(40).optional(),
  status: z.enum(['draft', 'submitted', 'approved']).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.from && value.to && value.to < value.from) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'to cannot precede from.' });
  }
});
export type TdsReportQuery = z.infer<typeof tdsReportQuerySchema>;

// Re-exported to keep event parsers and tests on one Decimal-string contract.
export const handoffQuantitySchema = positiveQuantityDecimalSchema;
export const optionalHandoffQuantitySchema = quantityDecimalSchema;
