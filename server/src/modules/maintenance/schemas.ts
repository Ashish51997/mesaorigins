import { z } from 'zod';

export const maintenanceCreateSchema = z.object({
  machineId: z.string().min(1, 'Machine is required'),
  taskName: z.string().trim().min(1, 'Task name is required'),
  type: z.enum(['Preventive', 'Calibration', 'Overhaul', 'Breakdown']).default('Preventive'),
  frequency: z.enum(['Weekly', 'Monthly', 'Quarterly', 'Semiannually', 'Once (Breakdown)']).default('Monthly'),
  dueDate: z.string().trim().min(1, 'Due date is required'),
  cost: z.coerce.number().min(0).default(0),
});
export type MaintenanceCreate = z.infer<typeof maintenanceCreateSchema>;
