import { z } from 'zod';

export const receiveSchema = z.object({
  plantCode: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/).default('PRIMARY'),
  itemName: z.string().trim().min(1, 'Material is required'),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unit: z.string().trim().default('kg'),
  itemCode: z.string().trim().default(''),
  lotNumber: z.string().trim().optional(),
  reference: z.string().trim().default(''), // supplier / PO
});
export type ReceiveInput = z.infer<typeof receiveSchema>;

export const issueSchema = z.object({
  itemName: z.string().trim().min(1, 'Material is required'),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unit: z.string().trim().default('kg'),
  machineId: z.string().min(1, 'Machine is required'),
});
export type IssueInput = z.infer<typeof issueSchema>;
