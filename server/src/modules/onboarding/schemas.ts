import { z } from 'zod';

export const bootstrapOrgSchema = z.object({
  organizationName: z.string().trim().min(2, 'Organization name is required'),
  organizationSlug: z.string().trim().min(2, 'Organization slug is required')
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens only'),
  adminName: z.string().trim().min(2, 'Admin name is required'),
  adminEmail: z.string().trim().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type BootstrapOrg = z.infer<typeof bootstrapOrgSchema>;
