import { z } from 'zod';

export const dispatchCreateSchema = z.object({
  salesOrderId: z.string().min(1, 'Order is required'),
  vehicleNumber: z.string().trim().min(1, 'Vehicle number is required'),
  transporter: z.string().trim().default(''),
  driverName: z.string().trim().default(''),
  etaDate: z.string().trim().default(''),
});
export type DispatchCreate = z.infer<typeof dispatchCreateSchema>;
