import { z } from 'zod';

export const planCreateSchema = z.object({
  salesOrderId: z.string().min(1, 'Order is required'),
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
});
export type PlanCreate = z.infer<typeof planCreateSchema>;

export const planUpdateSchema = z.object({
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
});
export type PlanUpdate = z.infer<typeof planUpdateSchema>;
