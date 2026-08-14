import { z } from 'zod';

const decimalString = z.string().regex(/^\d{1,18}(?:\.\d{1,6})?$/, 'Use a positive decimal string.');

const statutoryEvidenceSchema = z.object({
  source: z.enum(['mesaerp_snapshot', 'external_verified']),
  profileVersion: z.string().trim().min(1).max(100),
  verificationId: z.string().trim().min(8).max(160),
  verifiedAt: z.string().datetime(),
  invoiceReference: z.string().trim().min(1).max(100).optional(),
  eWayBillReference: z.string().trim().min(1).max(100).optional(),
  validUntil: z.string().datetime({ offset: true }).optional(),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  artifact: z.record(z.unknown()),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const dispatchCreateSchema = z.object({
  operationalOrderId: z.string().min(1).optional(),
  salesOrderId: z.string().min(1).optional(),
  quantity: decimalString.refine((value) => Number(value) > 0, 'Dispatch quantity must be greater than zero.'),
  expectedOrderVersion: z.number().int().min(0),
  movementType: z.enum(['supply', 'transfer', 'job_work', 'return', 'other']).default('supply'),
  vehicleNumber: z.string().trim().min(1, 'Vehicle number is required'),
  transporter: z.string().trim().default(''),
  driverName: z.string().trim().default(''),
  etaDate: z.string().trim().default(''),
  statutoryEvidence: statutoryEvidenceSchema.optional(),
}).superRefine((value, ctx) => {
  if (!value.operationalOrderId && !value.salesOrderId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['operationalOrderId'], message: 'Operational order is required' });
  }
});
export type DispatchCreate = z.infer<typeof dispatchCreateSchema>;
