import { z } from 'zod';

export const inspectionCreateSchema = z.object({
  lotNumber: z.string().min(1, 'Lot number is required'),
  decision: z.enum(['pass', 'hold', 'fail']),
  weight: z.coerce.number().positive('Inspected quantity must be greater than zero'),
  finish: z.enum(['pass', 'fail']).default('pass'),
  colour: z.enum(['pass', 'fail']).default('pass'),
  tearingTest: z.enum(['pass', 'fail']).default('pass'),
  dimensions: z.record(z.string()).default({}),
  remarks: z.string().trim().default(''),
});
export type InspectionCreate = z.infer<typeof inspectionCreateSchema>;
