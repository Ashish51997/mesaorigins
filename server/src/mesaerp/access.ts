import { withTenant } from '../db';

function containsPermission(value: unknown, permission: string): boolean {
  return Array.isArray(value) && value.some((entry) => entry === permission || entry === 'mesaerp.*');
}

function scopedRoleAssignmentWhere(organizationId: string, legalEntityId?: string) {
  return legalEntityId
    ? {
      legalEntityId,
      role: { organizationId, erpLegalEntityId: legalEntityId },
    }
    : {
      legalEntityId: null,
      role: { organizationId, erpLegalEntityId: null },
    };
}

function allowedPermissionKeys(assignments: Array<{
  membershipId: string;
  role: { permissions: Array<{ effect: string; permission: { key: string } }> };
}>): Map<string, Set<string>> {
  const effects = new Map<string, Map<string, Set<string>>>();
  for (const assignment of assignments) {
    const member = effects.get(assignment.membershipId) ?? new Map<string, Set<string>>();
    for (const grant of assignment.role.permissions) {
      const decisions = member.get(grant.permission.key) ?? new Set<string>();
      decisions.add(grant.effect);
      member.set(grant.permission.key, decisions);
    }
    effects.set(assignment.membershipId, member);
  }
  return new Map([...effects].map(([membershipId, permissions]) => [
    membershipId,
    new Set([...permissions]
      .filter(([, decisions]) => decisions.has('allow') && !decisions.has('deny'))
      .map(([permission]) => permission)),
  ]));
}

/**
 * MesaERP authorization is explicit and company scoped. A missing role,
 * assignment, permission row or expired delegation always denies.
 */
export async function hasMesaErpPermission(input: {
  organizationId: string;
  membershipId: string;
  permission: string;
  legalEntityId?: string;
}): Promise<boolean> {
  const now = new Date();
  return withTenant(input.organizationId, async (db) => {
    const assignments = await db.roleAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        membershipId: input.membershipId,
        serviceId: 'mesaerp',
        status: 'active',
        revokedAt: null,
        ...scopedRoleAssignmentWhere(input.organizationId, input.legalEntityId),
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        ],
      },
      include: {
        role: {
          include: {
            permissions: {
              where: { permission: { serviceId: 'mesaerp', key: input.permission } },
              include: { permission: true },
            },
          },
        },
      },
    });

    const decisions = assignments.flatMap((assignment) => assignment.role.permissions.map((entry) => entry.effect));
    if (decisions.includes('deny')) return false;
    if (decisions.includes('allow')) return true;

    const delegations = await db.delegation.findMany({
      where: {
        organizationId: input.organizationId,
        toMembershipId: input.membershipId,
        serviceId: 'mesaerp',
        status: 'active',
        validFrom: { lte: now },
        validTo: { gte: now },
        legalEntityId: input.legalEntityId ?? null,
      },
      select: { fromMembershipId: true, permissions: true },
    });
    const candidates = delegations.filter((delegation) => containsPermission(delegation.permissions, input.permission));
    if (!candidates.length) return false;

    // A delegation cannot manufacture authority: its maker must still hold the
    // delegated permission through a role whose company binding exactly
    // matches both the RoleAssignment and the delegation scope.
    const sourceAssignments = await db.roleAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        membershipId: { in: [...new Set(candidates.map((entry) => entry.fromMembershipId))] },
        serviceId: 'mesaerp',
        status: 'active',
        revokedAt: null,
        ...scopedRoleAssignmentWhere(input.organizationId, input.legalEntityId),
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        ],
      },
      include: {
        role: {
          include: {
            permissions: {
              where: { permission: { serviceId: 'mesaerp', key: input.permission } },
              include: { permission: true },
            },
          },
        },
      },
    });
    const allowed = allowedPermissionKeys(sourceAssignments);
    return candidates.some((delegation) => allowed.get(delegation.fromMembershipId)?.has(input.permission));
  });
}

/**
 * Company discovery is broader than a single module permission. A membership
 * may legitimately be vendor-only, reporting-only, or access-administration
 * only and must still be able to select the company in which that explicit
 * grant applies. Deny still wins for an individual key; an unrelated allowed
 * key is enough to make the company visible.
 */
export async function hasAnyMesaErpCompanyAccess(input: {
  organizationId: string;
  membershipId: string;
  legalEntityId: string;
}): Promise<boolean> {
  const now = new Date();
  return withTenant(input.organizationId, async (db) => {
    const assignments = await db.roleAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        membershipId: input.membershipId,
        serviceId: 'mesaerp',
        status: 'active',
        revokedAt: null,
        ...scopedRoleAssignmentWhere(input.organizationId, input.legalEntityId),
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        ],
      },
      include: {
        role: {
          include: {
            permissions: {
              where: { permission: { serviceId: 'mesaerp' } },
              include: { permission: true },
            },
          },
        },
      },
    });

    const effectsByPermission = new Map<string, Set<string>>();
    for (const assignment of assignments) {
      for (const grant of assignment.role.permissions) {
        const effects = effectsByPermission.get(grant.permission.key) ?? new Set<string>();
        effects.add(grant.effect);
        effectsByPermission.set(grant.permission.key, effects);
      }
    }
    if ([...effectsByPermission.values()].some((effects) => effects.has('allow') && !effects.has('deny'))) {
      return true;
    }

    const delegations = await db.delegation.findMany({
      where: {
        organizationId: input.organizationId,
        toMembershipId: input.membershipId,
        serviceId: 'mesaerp',
        status: 'active',
        validFrom: { lte: now },
        validTo: { gte: now },
        legalEntityId: input.legalEntityId,
      },
      select: { fromMembershipId: true, permissions: true },
    });
    if (!delegations.length) return false;
    const sourceAssignments = await db.roleAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        membershipId: { in: [...new Set(delegations.map((entry) => entry.fromMembershipId))] },
        serviceId: 'mesaerp',
        status: 'active',
        revokedAt: null,
        ...scopedRoleAssignmentWhere(input.organizationId, input.legalEntityId),
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        ],
      },
      include: {
        role: {
          include: {
            permissions: {
              where: { permission: { serviceId: 'mesaerp' } },
              include: { permission: true },
            },
          },
        },
      },
    });
    const allowed = allowedPermissionKeys(sourceAssignments);
    return delegations.some((delegation) => {
      const sourcePermissions = allowed.get(delegation.fromMembershipId) ?? new Set<string>();
      return Array.isArray(delegation.permissions) && delegation.permissions.some((entry) => (
        typeof entry === 'string'
        && (entry === 'mesaerp.*' ? sourcePermissions.size > 0 : sourcePermissions.has(entry))
      ));
    });
  });
}
