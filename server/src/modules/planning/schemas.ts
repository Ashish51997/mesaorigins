import { z } from 'zod';

export const planCreateSchema = z.object({
  salesOrderId: z.string().min(1, 'Order is required'),
  machineId: z.string().min(1, 'Machine is required'),
  shift: z.enum(['D', 'N']).default('D'),
  operatorName: z.string().trim().default(''),
  scheduledStartDate: z.string().trim().min(1, 'Start date is required'),
  scheduledEndDate: z.string().trim().default(''),
  logbookTemplateId: z.string().optional(),
});
export type PlanCreate = z.infer<typeof planCreateSchema>;
