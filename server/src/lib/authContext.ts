import type { Prisma } from '@prisma/client';
import { basePrisma } from '../db';
import { ADMIN_ROLES, ROLE_DEFAULT_SCREENS } from './permissions';

export interface ServiceAccessSummary {
  id: string;
  name: string;
  description: string;
  status: string;
  sortOrder: number;
}

export interface OrganizationAccessSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  membershipId: string;
  employeeCode: string;
  role: string;
  isAdmin: boolean;
  screens: string[];
  services: ServiceAccessSummary[];
}

export interface AuthenticatedUserContext extends OrganizationAccessSummary {
  userId: string;
  email: string;
  name: string;
  organizations: OrganizationAccessSummary[];
}

type MembershipWithIdentity = Prisma.MembershipGetPayload<{
  include: { user: true; organization: true };
}>;

async function resolveScreens(membership: MembershipWithIdentity): Promise<{ isAdmin: boolean; screens: string[] }> {
  let isAdmin = ADMIN_ROLES.has(membership.role);
  let screens: string[] = [...(ROLE_DEFAULT_SCREENS[membership.role] ?? [])];

  try {
    const permissions = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${membership.organizationId}, true)`;
      const role = membership.roleId
        ? await tx.role.findFirst({ where: { id: membership.roleId, organizationId: membership.organizationId } })
        : await tx.role.findFirst({ where: { name: membership.role, organizationId: membership.organizationId } });
      const grants = await tx.employeeGrant.findMany({
        where: { membershipId: membership.id, organizationId: membership.organizationId },
      });
      return { role, grants };
    });

    if (permissions.role) {
      isAdmin = permissions.role.isAdmin;
      if (permissions.role.isSystem && ROLE_DEFAULT_SCREENS[permissions.role.name]) {
        screens = [...ROLE_DEFAULT_SCREENS[permissions.role.name]];
      } else {
        screens = Array.isArray(permissions.role.screens) ? (permissions.role.screens as string[]) : [];
      }
    }

    const effective = new Set(screens);
    for (const grant of permissions.grants) {
      if (grant.state === 'on') effective.add(grant.screen);
      else effective.delete(grant.screen);
    }
    screens = [...effective];
  } catch {
    // Keep the conservative built-in role defaults if tenant permission rows
    // are unavailable during bootstrap.
  }

  return { isAdmin, screens };
}

async function activeServicesForOrganization(organizationId: string): Promise<ServiceAccessSummary[]> {
  const assignments = await basePrisma.organizationService.findMany({
    where: {
      organizationId,
      status: 'active',
      organization: { status: { not: 'suspended' } },
      service: { status: 'active' },
    },
    select: {
      service: {
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          sortOrder: true,
        },
      },
    },
    orderBy: [
      { service: { sortOrder: 'asc' } },
      { service: { name: 'asc' } },
    ],
  });

  return assignments.map(({ service }) => service);
}

async function organizationAccess(membership: MembershipWithIdentity): Promise<OrganizationAccessSummary> {
  const [access, services] = await Promise.all([
    resolveScreens(membership),
    activeServicesForOrganization(membership.organizationId),
  ]);

  return {
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    organizationSlug: membership.organization.slug,
    membershipId: membership.id,
    employeeCode: membership.employeeCode,
    role: membership.role,
    isAdmin: access.isAdmin,
    screens: access.screens,
    services,
  };
}

/**
 * Builds the server-authoritative identity/tenant context for an authenticated
 * user. `organizationHint` may only select one of that user's non-inactive
 * memberships; callers never turn the untrusted header directly into a tenant.
 */
export async function buildAuthenticatedUserContext(
  userId: string,
  organizationHint = '',
): Promise<AuthenticatedUserContext | null> {
  const memberships = await basePrisma.membership.findMany({
    where: { userId, status: { not: 'inactive' } },
    include: { user: true, organization: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (memberships.length === 0) return null;

  const organizations = await Promise.all(memberships.map(organizationAccess));
  const normalizedHint = organizationHint.trim();
  const selected = normalizedHint
    ? organizations.find((organization) => (
        organization.organizationId === normalizedHint || organization.organizationSlug === normalizedHint
      ))
    // Prefer a membership that can actually enter a service. If none can, keep
    // the oldest membership so single-organization users get the existing
    // "no services" state rather than an ambiguous authentication failure.
    : organizations.find((organization) => organization.services.length > 0) ?? organizations[0];

  if (!selected) return null;
  const identity = memberships[0].user;
  return {
    userId: identity.id,
    email: identity.email,
    name: identity.name,
    ...selected,
    organizations,
  };
}
