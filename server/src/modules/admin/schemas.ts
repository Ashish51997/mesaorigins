import { z } from 'zod';

export const employeeCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().email('A valid email is required'),
  roleId: z.string().min(1, 'A role is required'),
  department: z.string().trim().optional(),
  shift: z.string().trim().optional(),
  employeeCode: z.string().trim().optional(),
  status: z.enum(['active', 'on_leave', 'inactive']).optional(),
});
export type EmployeeCreate = z.infer<typeof employeeCreateSchema>;

export const employeeUpdateSchema = z
  .object({
    roleId: z.string().min(1),
    department: z.string().trim(),
    shift: z.string().trim(),
    status: z.enum(['active', 'on_leave', 'inactive']),
  })
  .partial();
export type EmployeeUpdate = z.infer<typeof employeeUpdateSchema>;

export const roleCreateSchema = z.object({
  name: z.string().trim().min(1, 'A role name is required'),
  screens: z.array(z.string()).default([]),
});
export type RoleCreate = z.infer<typeof roleCreateSchema>;

export const roleUpdateSchema = z
  .object({ name: z.string().trim().min(1), screens: z.array(z.string()) })
  .partial();
export type RoleUpdate = z.infer<typeof roleUpdateSchema>;

export const grantsSetSchema = z.object({
  grants: z.array(z.object({ screen: z.string().min(1), state: z.enum(['on', 'off']) })).default([]),
});
export type GrantsSet = z.infer<typeof grantsSetSchema>;

export const passwordSetSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type PasswordSet = z.infer<typeof passwordSetSchema>;
