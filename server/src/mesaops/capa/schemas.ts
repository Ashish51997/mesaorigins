import { z } from 'zod';

export const complaintCreateSchema = z.object({
  salesOrderId: z.string().min(1, 'A dispatched order is required'),
  severity: z.enum(['low', 'medium', 'high']),
  description: z.string().trim().default(''),
  photoUrl: z.string().trim().optional(),
});
export type ComplaintCreate = z.infer<typeof complaintCreateSchema>;

export const capaUpdateSchema = z
  .object({
    rootCause: z.string().trim(),
    correctiveAction: z.string().trim(),
    preventiveAction: z.string().trim(),
    responsiblePerson: z.string().trim(),
    dueDate: z.string().trim(),
  })
  .partial();
export type CapaUpdate = z.infer<typeof capaUpdateSchema>;
