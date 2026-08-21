import { z } from 'zod';

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  gstNumber: z.string().trim().default(''),
  contactPerson: z.string().trim().default(''),
  phone: z.string().trim().default(''),
  email: z.string().trim().email('Invalid email').or(z.literal('')).default(''),
  billingAddress: z.string().trim().default(''),
  deliveryAddress: z.string().trim().default(''),
  paymentTerms: z.string().trim().default(''),
  status: z.enum(['active', 'inactive']).default('active'),
});
export type CustomerCreate = z.infer<typeof customerCreateSchema>;

export const inquiryCreateSchema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  product: z.string().trim().min(1, 'Product is required'),
  quantity: z.coerce.number().int().positive('Quantity must be greater than zero'),
  expectedDeliveryDate: z.string().trim().min(1, 'Expected delivery date is required'),
  drawingRef: z.string().trim().default(''),
  remarks: z.string().trim().default(''),
  attachment: z.string().trim().optional(),
});
export type InquiryCreate = z.infer<typeof inquiryCreateSchema>;

export const quoteSchema = z.object({
  quotationPrice: z.coerce.number().positive('Rate must be greater than zero'),
  negotiationNote: z.string().trim().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
});
export type Quote = z.infer<typeof quoteSchema>;

export const orderConfirmSchema = z.object({
  inquiryId: z.string().min(1, 'Inquiry is required'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  specialInstructions: z.string().trim().default(''),
  deliveryDate: z.string().trim().optional(),
});
export type OrderConfirm = z.infer<typeof orderConfirmSchema>;
