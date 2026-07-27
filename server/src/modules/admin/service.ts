import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { ApiError } from '../../middleware/error';
import type { EmployeeCreate, EmployeeUpdate, RoleCreate, RoleUpdate, GrantsSet } from './schemas';

function ctx() {
  const c = tenantContext.getStore();
  if (!c) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return c;
}

/* ---------------------------------------------------------------- employees */

// Membership is a GLOBAL model (not RLS-scoped), so always filter by org.
export async function listEmployees() {
  const c = ctx();
  return prisma.membership.findMany({
    where: { organizationId: c.organizationId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { employeeCode: 'asc' },
  });
}

/** Minimal roster for the login picker / role switcher (any authed member). */
export async function listDirectory() {
  const c = ctx();
  const rows = await prisma.membership.findMany({
    where: { organizationId: c.organizationId, status: { not: 'inactive' } },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { role: 'asc' },
  });
  return rows.map((m) => ({ id: m.id, name: m.user.name, email: m.user.email, role: m.role, employeeCode: m.employeeCode, department: m.department }));
}

export async function createEmployee(input: EmployeeCreate) {
  const c = ctx();
  return tenantTx(async (tx) => {
    const role = await tx.role.findUnique({ where: { id: input.roleId } });
    if (!role || role.organizationId !== c.organizationId) throw new ApiError(422, 'bad_role', 'Unknown role.');

    const email = input.email.trim().toLowerCase();
    // A person (global User) may belong to several orgs; reuse by email.
    const user = await tx.user.upsert({ where: { email }, update: { name: input.name.trim() }, create: { email, name: input.name.trim() } });

    const dupe = await tx.membership.findFirst({ where: { organizationId: c.organizationId, userId: user.id } });
    if (dupe) throw new ApiError(409, 'already_member', 'That person is already an employee of this organization.');

    const existing = await tx.membership.findMany({ where: { organizationId: c.organizationId }, select: { employeeCode: true } });
    const max = existing.reduce((mx, m) => { const n = Number.parseInt((m.employeeCode || '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? Math.max(mx, n) : mx; }, 0);
    const employeeCode = input.employeeCode?.trim() || `EMP-${String(max + 1).padStart(3, '0')}`;

    const membership = await tx.membership.create({
      data: {
        organizationId: c.organizationId, userId: user.id, employeeCode, role: role.name, roleId: role.id,
        department: input.department?.trim() || role.name, shift: input.shift?.trim() || 'D', status: input.status ?? 'active',
      },
    });
    await audit(tx, { action: 'employee.create', entity: 'Membership', entityId: membership.id, after: { employeeCode, role: role.name } });
    return { ...membership, user: { name: user.name, email: user.email } };
  });
}

export async function updateEmployee(id: string, patch: EmployeeUpdate) {
  const c = ctx();
  const current = await prisma.membership.findFirst({ where: { id, organizationId: c.organizationId } });
  if (!current) throw new ApiError(404, 'not_found', 'Employee not found.');
  return tenantTx(async (tx) => {
    const data: Record<string, unknown> = { version: { increment: 1 } };
    if (patch.department !== undefined) data.department = patch.department;
    if (patch.shift !== undefined) data.shift = patch.shift;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.roleId !== undefined) {
      const role = await tx.role.findUnique({ where: { id: patch.roleId } });
      if (!role || role.organizationId !== c.organizationId) throw new ApiError(422, 'bad_role', 'Unknown role.');
      data.roleId = role.id; data.role = role.name;
    }
    const updated = await tx.membership.update({ where: { id }, data, include: { user: { select: { name: true, email: true } } } });
    await audit(tx, { action: 'employee.update', entity: 'Membership', entityId: id, after: patch });
    return updated;
  });
}

/* ---------------------------------------------------------------- roles */

export function listRoles() {
  return prisma.role.findMany({
    include: { _count: { select: { memberships: true } } },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });
}

export async function createRole(input: RoleCreate) {
  const c = ctx();
  const clash = await prisma.role.findFirst({ where: { name: input.name } });
  if (clash) throw new ApiError(409, 'name_taken', `A role named "${input.name}" already exists.`);
  return tenantTx(async (tx) => {
    const role = await tx.role.create({
      data: { organizationId: c.organizationId, name: input.name, screens: input.screens, isAdmin: false, isSystem: false },
    });
    await audit(tx, { action: 'role.create', entity: 'Role', entityId: role.id, after: role });
    return role;
  });
}

export async function updateRole(id: string, patch: RoleUpdate) {
  const c = ctx();
  const role = await prisma.role.findFirst({ where: { id, organizationId: c.organizationId } });
  if (!role) throw new ApiError(404, 'not_found', 'Role not found.');
  return tenantTx(async (tx) => {
    const data: Record<string, unknown> = { version: { increment: 1 } };
    if (patch.screens !== undefined) data.screens = patch.screens;
    if (patch.name !== undefined && patch.name !== role.name) {
      if (role.isSystem) throw new ApiError(409, 'system_role', 'Built-in roles cannot be renamed.');
      const clash = await tx.role.findFirst({ where: { name: patch.name } });
      if (clash) throw new ApiError(409, 'name_taken', `A role named "${patch.name}" already exists.`);
      data.name = patch.name;
      // keep the denormalized role name on memberships in sync
      await tx.membership.updateMany({ where: { organizationId: c.organizationId, roleId: id }, data: { role: patch.name } });
    }
    const updated = await tx.role.update({ where: { id }, data });
    await audit(tx, { action: 'role.update', entity: 'Role', entityId: id, after: patch });
    return updated;
  });
}

export async function deleteRole(id: string) {
  const c = ctx();
  const role = await prisma.role.findFirst({ where: { id, organizationId: c.organizationId }, include: { _count: { select: { memberships: true } } } });
  if (!role) throw new ApiError(404, 'not_found', 'Role not found.');
  if (role.isSystem) throw new ApiError(409, 'system_role', 'Built-in roles cannot be deleted.');
  if (role._count.memberships > 0) throw new ApiError(409, 'role_in_use', `Reassign the ${role._count.memberships} employee(s) on this role first.`);
  return tenantTx(async (tx) => {
    await tx.role.delete({ where: { id } });
    await audit(tx, { action: 'role.delete', entity: 'Role', entityId: id, before: role });
    return { ok: true };
  });
}

/* ---------------------------------------------------------------- per-employee grants */

export async function listGrants(membershipId: string) {
  const c = ctx();
  const m = await prisma.membership.findFirst({ where: { id: membershipId, organizationId: c.organizationId } });
  if (!m) throw new ApiError(404, 'not_found', 'Employee not found.');
  return prisma.employeeGrant.findMany({ where: { membershipId } });
}

/** Replace the employee's per-screen overrides with the given set. */
export async function setGrants(membershipId: string, input: GrantsSet) {
  const c = ctx();
  const m = await prisma.membership.findFirst({ where: { id: membershipId, organizationId: c.organizationId } });
  if (!m) throw new ApiError(404, 'not_found', 'Employee not found.');
  return tenantTx(async (tx) => {
    await tx.employeeGrant.deleteMany({ where: { membershipId } });
    if (input.grants.length) {
      await tx.employeeGrant.createMany({
        data: input.grants.map((g) => ({ organizationId: c.organizationId, membershipId, screen: g.screen, state: g.state })),
      });
    }
    await audit(tx, { action: 'employee.grants', entity: 'Membership', entityId: membershipId, after: { grants: input.grants.length } });
    return tx.employeeGrant.findMany({ where: { membershipId } });
  });
}
