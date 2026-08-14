import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO business date (YYYY-MM-DD).')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Use a valid calendar date.');
const evidence = z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, 'Source evidence cannot be empty.');

export const mesaOpsStatutoryRuleProfileCreateSchema = z.object({
  version: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default('IN'),
  plantCode: z.string().trim().toUpperCase().regex(/^(?:\*|[A-Z0-9._-]{1,40})$/).default('*'),
  movementType: z.enum(['*', 'supply', 'transfer', 'job_work', 'return', 'other']).default('*'),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.optional(),
  requiresInvoice: z.boolean(),
  requiresEWayBill: z.boolean(),
  reviewedExemptionReason: z.string().trim().max(1000).default(''),
  sourceReference: z.string().trim().min(3).max(1000),
  sourceEvidence: evidence,
  sourceChecksum: z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((value, ctx) => {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveTo'], message: 'effectiveTo cannot be earlier than effectiveFrom.' });
  }
  if (!value.requiresInvoice && !value.requiresEWayBill && value.reviewedExemptionReason.length < 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewedExemptionReason'],
      message: 'A reviewed exemption reason of at least 10 characters is required when no statutory artifact applies.',
    });
  }
});
export type MesaOpsStatutoryRuleProfileCreate = z.infer<typeof mesaOpsStatutoryRuleProfileCreateSchema>;

export const mesaOpsStatutoryRuleProfileApproveSchema = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  approvalNote: z.string().trim().min(3).max(500),
}).strict();
export type MesaOpsStatutoryRuleProfileApprove = z.infer<typeof mesaOpsStatutoryRuleProfileApproveSchema>;
