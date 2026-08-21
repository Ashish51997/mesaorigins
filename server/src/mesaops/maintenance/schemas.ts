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

export const machineCreateSchema = z.object({
  plantCode: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/).default('PRIMARY'),
  code: z.string().trim().min(1, 'Machine code is required').max(16, 'Code is too long'),
  line: z.string().trim().min(1, 'Line / description is required').max(120),
  family: z.string().trim().min(1, 'Family is required').max(40).default('PVC'),
  logbookFormat: z.string().trim().max(40).optional().default(''),
  status: z.enum(['running', 'attention', 'stopped']).default('running'),
});
export type MachineCreate = z.infer<typeof machineCreateSchema>;
