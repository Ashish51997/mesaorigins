import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { ApiError } from '../../middleware/error';
import { runMesaOpsIdempotent } from '../../lib/mesaOpsIdempotency';
import type {
  EmployeeCreate,
  EmployeeUpdate,
  RoleCreate,
  RoleUpdate,
  GrantsSet,
  PasswordSet,
  MesaOpsRoleAssignmentCreate,
  MesaOpsRoleAssignmentRevoke,
} from './schemas';
import { hashPassword } from '../../lib/password';

function ctx() {
  const c = tenantContext.getStore();
  if (!c) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return c;
}

const MESAOPS_PLANT_ACCESS_ROLE_NAME = 'MesaOps Plant Access';

const mesaErpRoleEvidence = {
  permissions: {
    where: { permission: { serviceId: 'mesaerp' } },
    select: { id: true },
  },
  assignments: {
    where: { serviceId: 'mesaerp' },
    select: { id: true },
    take: 1,
  },
} as const;

function isMesaErpOwnedRole(role: {
  erpLegalEntityId: string | null;
  permissions: Array<{ id: string }>;
  assignments: Array<{ id: string }>;
}): boolean {
  return role.erpLegalEntityId !== null || role.permissions.length > 0 || role.assignments.length > 0;
}

function assertMesaOpsRole(role: Parameters<typeof isMesaErpOwnedRole>[0]): void {
  if (isMesaErpOwnedRole(role)) {
    throw new ApiError(409, 'mesaerp_role_forbidden', 'MesaERP roles are managed only through the MesaERP access desk.');
  }
}

function assertEmployeeRole(role: Parameters<typeof isMesaErpOwnedRole>[0] & { name: string; isSystem: boolean }): void {
  assertMesaOpsRole(role);
  if (role.isSystem && role.name === MESAOPS_PLANT_ACCESS_ROLE_NAME) {
    throw new ApiError(409, 'plant_scope_role_forbidden', 'The MesaOps Plant Access role is a protected scope anchor and cannot be assigned as an employee role.');
  }
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
    const role = await tx.role.findUnique({ where: { id: input.roleId }, include: mesaErpRoleEvidence });
    if (!role || role.organizationId !== c.organizationId) throw new ApiError(422, 'bad_role', 'Unknown role.');
    assertEmployeeRole(role);

    const email = input.email.trim().toLowerCase();
    // A person (global User) may belong to several organizations. Reuse the
    // identity by email without letting this organization's directory edit
    // overwrite the global name used by their other memberships.
    const user = await tx.user.upsert({
      where: { email },
      update: {},
      create: { email, name: input.name.trim() },
    });

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
      const role = await tx.role.findUnique({ where: { id: patch.roleId }, include: mesaErpRoleEvidence });
      if (!role || role.organizationId !== c.organizationId) throw new ApiError(422, 'bad_role', 'Unknown role.');
      assertEmployeeRole(role);
      data.roleId = role.id; data.role = role.name;
    }
    const updated = await tx.membership.update({ where: { id }, data, include: { user: { select: { name: true, email: true } } } });
    await audit(tx, { action: 'employee.update', entity: 'Membership', entityId: id, after: patch });
    return updated;
  });
}

/** Set or replace the login password for an employee (User.passwordHash). */
export async function setEmployeePassword(membershipId: string, input: PasswordSet) {
  const c = ctx();
  const passwordHash = await hashPassword(input.password);
  return tenantTx(async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, organizationId: c.organizationId },
    });
    if (!membership) throw new ApiError(404, 'not_found', 'Employee not found.');

    // Serialize password changes with any operation that reuses this global
    // identity. The membership is rechecked inside this same transaction, and
    // the parent-row lock prevents a concurrent FK-backed membership insert
    // from slipping between the global membership count and password update.
    const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE "id" = ${membership.userId} FOR UPDATE
    `;
    if (lockedUsers.length !== 1) throw new ApiError(404, 'not_found', 'Employee identity not found.');

    const membershipCount = await tx.membership.count({ where: { userId: membership.userId } });
    if (membershipCount > 1) {
      throw new ApiError(
        409,
        'shared_identity_password',
        'This sign-in identity belongs to multiple organizations. Its password cannot be changed from an organization directory.',
      );
    }

    await tx.user.update({ where: { id: membership.userId }, data: { passwordHash } });
    // A password reset is also a credential-compromise boundary. Revoke every
    // outstanding database session for this identity in the same transaction
    // so old browser cookies cannot survive the change.
    const revokedSessions = await tx.session.deleteMany({ where: { userId: membership.userId } });
    await audit(tx, {
      action: 'employee.password_set',
      entity: 'User',
      entityId: membership.userId,
      after: { set: true, membershipId, revokedSessionCount: revokedSessions.count },
    });
    return { ok: true };
  });
}

/* ---------------------------------------------------------------- roles */

export function listRoles() {
  return prisma.role.findMany({
    where: {
      erpLegalEntityId: null,
      permissions: { none: { permission: { serviceId: 'mesaerp' } } },
      assignments: { none: { serviceId: 'mesaerp' } },
    },
    include: { _count: { select: { memberships: true } } },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });
}

export async function createRole(input: RoleCreate) {
  const c = ctx();
  if (input.name.trim() === MESAOPS_PLANT_ACCESS_ROLE_NAME) {
    throw new ApiError(409, 'reserved_role_name', 'MesaOps Plant Access is reserved for explicit plant-scope evidence.');
  }
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
  const role = await prisma.role.findFirst({
    where: { id, organizationId: c.organizationId },
    include: mesaErpRoleEvidence,
  });
  if (!role) throw new ApiError(404, 'not_found', 'Role not found.');
  assertMesaOpsRole(role);
  if (role.isSystem && role.name === MESAOPS_PLANT_ACCESS_ROLE_NAME) {
    throw new ApiError(409, 'system_role', 'The MesaOps Plant Access scope role cannot be edited.');
  }
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
  return tenantTx(async (tx) => {
    // Lock the parent row so a concurrent scope assignment cannot appear after
    // the usage checks and then be cascade-deleted with the role. Revoked and
    // expired assignments are retained deliberately: deleting their parent
    // role must not erase plant-scope and revocation history.
    await tx.$queryRaw`SELECT "id" FROM "Role" WHERE "id" = ${id} AND "organizationId" = ${c.organizationId} FOR UPDATE`;
    const role = await tx.role.findFirst({
      where: { id, organizationId: c.organizationId },
      include: { _count: { select: { memberships: true, assignments: true } }, ...mesaErpRoleEvidence },
    });
    if (!role) throw new ApiError(404, 'not_found', 'Role not found.');
    assertMesaOpsRole(role);
    if (role.isSystem) throw new ApiError(409, 'system_role', 'Built-in roles cannot be deleted.');
    if (role._count.memberships > 0) throw new ApiError(409, 'role_in_use', `Reassign the ${role._count.memberships} employee(s) on this role first.`);
    if (role._count.assignments > 0) {
      throw new ApiError(409, 'role_scope_history_retained', 'This role has MesaOps scope-assignment history and must be retained for plant-access safety.');
    }
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

/* ------------------------------------------------ MesaOps plant assignments */

export function listMesaOpsRoleAssignments() {
  return prisma.roleAssignment.findMany({
    where: { serviceId: 'mesaops' },
    include: {
      membership: { include: { user: { select: { name: true, email: true } } } },
      role: { select: { id: true, name: true, isSystem: true } },
    },
    orderBy: [{ status: 'asc' }, { plantCode: 'asc' }, { createdAt: 'desc' }],
  });
}

function normalizePlantCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return normalized || null;
}

export async function createMesaOpsRoleAssignment(input: MesaOpsRoleAssignmentCreate, key: string) {
  const c = ctx();
  const plantCode = normalizePlantCode(input.plantCode);
  const validFrom = input.validFrom ? new Date(input.validFrom) : null;
  const validTo = input.validTo ? new Date(input.validTo) : null;
  if (validFrom && validTo && validTo < validFrom) {
    throw new ApiError(422, 'invalid_validity_window', 'validTo must be on or after validFrom.');
  }

  return runMesaOpsIdempotent({
    scope: 'mesaops-role-assignment.create',
    key,
    payload: { ...input, plantCode },
    execute: async (tx) => {
      const [membership, role] = await Promise.all([
        tx.membership.findFirst({
          where: { id: input.membershipId, organizationId: c.organizationId, status: { not: 'inactive' } },
        }),
        tx.role.findFirst({
          where: { id: input.roleId, organizationId: c.organizationId },
          include: {
            permissions: { include: { permission: { select: { serviceId: true } } } },
            assignments: { where: { serviceId: 'mesaerp' }, select: { id: true }, take: 1 },
          },
        }),
      ]);
      if (!membership) throw new ApiError(422, 'bad_membership', 'Unknown or inactive employee for this organization.');
      if (!role) throw new ApiError(422, 'bad_role', 'Unknown role for this organization.');

      const erpOwned = role.erpLegalEntityId !== null
        || role.permissions.some((grant) => grant.permission.serviceId === 'mesaerp')
        || role.assignments.length > 0;
      if (erpOwned) {
        throw new ApiError(409, 'mesaerp_role_forbidden', 'MesaERP roles cannot be assigned or changed through MesaOps administration.');
      }

      const assignmentLock = `${c.organizationId}:mesaops-role-assignment:${membership.id}:${role.id}:${plantCode ?? '*'}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${assignmentLock}, 0))`;
      const existing = await tx.roleAssignment.findFirst({
        where: {
          membershipId: membership.id,
          roleId: role.id,
          serviceId: 'mesaops',
          legalEntityId: null,
          plantCode,
          warehouseId: null,
          status: 'active',
        },
      });
      if (existing) {
        throw new ApiError(409, 'assignment_exists', 'This employee already has the active MesaOps role and plant scope.');
      }

      const assignment = await tx.roleAssignment.create({
        data: {
          organizationId: c.organizationId,
          membershipId: membership.id,
          roleId: role.id,
          serviceId: 'mesaops',
          legalEntityId: null,
          plantCode,
          warehouseId: null,
          validFrom,
          validTo,
          status: 'active',
        },
        include: {
          membership: { include: { user: { select: { name: true, email: true } } } },
          role: { select: { id: true, name: true, isSystem: true } },
        },
      });
      await audit(tx, {
        action: 'mesaops.role_assignment.create',
        entity: 'RoleAssignment',
        entityId: assignment.id,
        after: {
          membershipId: assignment.membershipId,
          roleId: assignment.roleId,
          serviceId: 'mesaops',
          plantCode: assignment.plantCode,
          validFrom: assignment.validFrom,
          validTo: assignment.validTo,
        },
      });
      return assignment;
    },
  });
}

export async function revokeMesaOpsRoleAssignment(id: string, input: MesaOpsRoleAssignmentRevoke, key: string) {
  const c = ctx();
  return runMesaOpsIdempotent({
    scope: `mesaops-role-assignment.revoke:${id}`,
    key,
    payload: input,
    execute: async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "RoleAssignment"
        WHERE "id" = ${id}
          AND "organizationId" = ${c.organizationId}
          AND "serviceId" = 'mesaops'
        FOR UPDATE
      `;
      if (locked.length !== 1) throw new ApiError(404, 'not_found', 'MesaOps role assignment not found.');

      const assignment = await tx.roleAssignment.findFirst({
        where: { id, organizationId: c.organizationId, serviceId: 'mesaops' },
      });
      if (!assignment) throw new ApiError(404, 'not_found', 'MesaOps role assignment not found.');
      if (assignment.status !== 'active' || assignment.revokedAt !== null) {
        throw new ApiError(409, 'already_revoked', 'MesaOps role assignment is already revoked.');
      }
      if (assignment.rowVersion !== input.expectedVersion) {
        throw new ApiError(409, 'version_conflict', 'The MesaOps role assignment changed. Refresh it and try again.');
      }

      const revokedAt = new Date();
      const updated = await tx.roleAssignment.update({
        where: { id, rowVersion: input.expectedVersion },
        data: {
          status: 'revoked',
          revokedAt,
          revokedBy: c.membershipId,
          revocationReason: input.reason,
          rowVersion: { increment: 1 },
        },
        include: {
          membership: { include: { user: { select: { name: true, email: true } } } },
          role: { select: { id: true, name: true, isSystem: true } },
        },
      });
      await audit(tx, {
        action: 'mesaops.role_assignment.revoke',
        entity: 'RoleAssignment',
        entityId: id,
        before: {
          status: assignment.status,
          rowVersion: assignment.rowVersion,
          plantCode: assignment.plantCode,
        },
        after: {
          status: updated.status,
          rowVersion: updated.rowVersion,
          revokedAt: updated.revokedAt,
          revokedBy: updated.revokedBy,
          revocationReason: updated.revocationReason,
        },
      });
      return updated;
    },
  });
}
