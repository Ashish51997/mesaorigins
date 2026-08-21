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
  password: z.string().min(12, 'Password must be at least 12 characters').max(128),
});
export type PasswordSet = z.infer<typeof passwordSetSchema>;

const plantCode = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/);
const isoDateTime = z.string().datetime({ offset: true });

/**
 * MesaOps assignments are deliberately narrower than MesaERP assignments:
 * they can only carry an optional plant scope. Company and warehouse scopes
 * belong to MesaERP's independently authorized access desk.
 */
export const mesaOpsRoleAssignmentCreateSchema = z.object({
  membershipId: z.string().trim().min(1),
  roleId: z.string().trim().min(1),
  plantCode: plantCode.nullable().optional(),
  validFrom: isoDateTime.nullable().optional(),
  validTo: isoDateTime.nullable().optional(),
}).strict();
export type MesaOpsRoleAssignmentCreate = z.infer<typeof mesaOpsRoleAssignmentCreateSchema>;

export const mesaOpsRoleAssignmentRevokeSchema = z.object({
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(3).max(500),
}).strict();
export type MesaOpsRoleAssignmentRevoke = z.infer<typeof mesaOpsRoleAssignmentRevokeSchema>;
