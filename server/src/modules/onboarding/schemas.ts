import { z } from 'zod';

export const serviceIdsSchema = z.array(z.string().trim().min(1).max(64))
  .min(1, 'Select at least one service')
  .max(20, 'Too many services selected')
  .transform((ids) => [...new Set(ids)]);

export const bootstrapOrgSchema = z.object({
  organizationName: z.string().trim().min(2, 'Organization name is required'),
  organizationSlug: z.string().trim().min(2, 'Organization slug is required')
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens only'),
  adminName: z.string().trim().min(2, 'Admin name is required'),
  adminEmail: z.string().trim().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  serviceIds: serviceIdsSchema.default(['mesaops']),
});

export type BootstrapOrg = z.infer<typeof bootstrapOrgSchema>;

export const organizationServicesSchema = z.object({
  serviceIds: serviceIdsSchema,
});

export type OrganizationServicesInput = z.infer<typeof organizationServicesSchema>;

export const serviceStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'stopped']),
});

export type ServiceStatusInput = z.infer<typeof serviceStatusSchema>;
