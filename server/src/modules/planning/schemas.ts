import { z } from 'zod';

const decimalString = z.string().regex(/^\d{1,18}(?:\.\d{1,6})?$/, 'Use a positive decimal string.');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO business date (YYYY-MM-DD).');
const plantCode = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/).default('PRIMARY');

export const planCreateSchema = z.object({
  operationalOrderId: z.string().min(1).optional(),
  // Compatibility bridge for existing clients. The value resolves to the
  // migrated OperationalOrder with the same stable id.
  salesOrderId: z.string().min(1).optional(),
  expectedOrderVersion: z.number().int().min(0),
  plannedQuantity: decimalString.optional(),
  machineId: z.string().min(1, 'Machine is required'),
  shift: z.enum(['D', 'N']).default('D'),
  operatorName: z.string().trim().default(''),
  scheduledStartDate: z.string().trim().min(1, 'Start date is required'),
  scheduledEndDate: z.string().trim().default(''),
  logbookTemplateId: z.string().optional(),
  supervisor: z.string().trim().min(1, 'Supervisor is required'),
  drawingNo: z.string().trim().min(1, 'Drawing No is required'),
  formulaNo: z.string().trim().min(1, 'Formula No is required'),
  moldNo: z.string().trim().min(1, 'Mold No is required'),
  productName: z.string().trim().default(''),
  taskSequence: z.array(z.object({
    code: z.string().trim().min(1),
    name: z.string().trim().min(1),
    sequence: z.number().int().min(1),
  }).strict()).default([]),
}).superRefine((value, ctx) => {
  if (!value.operationalOrderId && !value.salesOrderId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['operationalOrderId'], message: 'Operational order is required' });
  }
});
export type PlanCreate = z.infer<typeof planCreateSchema>;

export const planUpdateSchema = z.object({
  expectedVersion: z.number().int().min(0),
  machineId: z.string().min(1).optional(),
  shift: z.enum(['D', 'N']).optional(),
  operatorName: z.string().trim().optional(),
  scheduledStartDate: z.string().trim().min(1).optional(),
  scheduledEndDate: z.string().trim().optional(),
  logbookTemplateId: z.string().nullable().optional(),
  supervisor: z.string().trim().min(1).optional(),
  drawingNo: z.string().trim().min(1).optional(),
  formulaNo: z.string().trim().min(1).optional(),
  moldNo: z.string().trim().min(1).optional(),
  productName: z.string().trim().min(1).optional(),
  plannedQuantity: decimalString.optional(),
  taskSequence: z.array(z.object({
    code: z.string().trim().min(1),
    name: z.string().trim().min(1),
    sequence: z.number().int().min(1),
  }).strict()).optional(),
});
export type PlanUpdate = z.infer<typeof planUpdateSchema>;

export const planReleaseSchema = z.object({ expectedVersion: z.number().int().min(0) }).strict();
export type PlanRelease = z.infer<typeof planReleaseSchema>;

export const operationalOrderCreateSchema = z.object({
  orderNumber: z.string().trim().min(1).max(80),
  plantCode,
  sourceType: z.enum(['local_customer', 'internal', 'forecast', 'replenishment', 'trial', 'rework', 'import']).default('local_customer'),
  sourceReference: z.string().trim().max(120).default(''),
  customerId: z.string().trim().min(1).optional(),
  customerName: z.string().trim().max(200).default(''),
  productCode: z.string().trim().max(80).default(''),
  productName: z.string().trim().min(1).max(240),
  quantity: decimalString.refine((value) => Number(value) > 0, 'Quantity must be greater than zero.'),
  uom: z.string().trim().min(1).max(20).default('units'),
  dueDate: isoDate.optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  requirements: z.record(z.unknown()).default({}),
  sourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type OperationalOrderCreate = z.infer<typeof operationalOrderCreateSchema>;

export const mesaErpOperationalOrderHandoffSchema = z.object({
  eventId: z.string().trim().min(8).max(128),
  correlationId: z.string().trim().min(8).max(128),
  sourceId: z.string().trim().min(1).max(128),
  sourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  snapshot: z.object({
    orderNumber: z.string().trim().min(1).max(80),
    plantCode,
    customerName: z.string().trim().max(200).default(''),
    productCode: z.string().trim().max(80).default(''),
    productName: z.string().trim().min(1).max(240),
    quantity: decimalString.refine((value) => Number(value) > 0, 'Quantity must be greater than zero.'),
    uom: z.string().trim().min(1).max(20).default('units'),
    dueDate: isoDate.optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
    requirements: z.record(z.unknown()).default({}),
    legalEntityId: z.string().trim().max(128).optional(),
  }).strict(),
}).strict();
export type MesaErpOperationalOrderHandoff = z.infer<typeof mesaErpOperationalOrderHandoffSchema>;

export const mesaErpOutboxHandoffAcceptSchema = z.object({
  expectedSourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type MesaErpOutboxHandoffAccept = z.infer<typeof mesaErpOutboxHandoffAcceptSchema>;
