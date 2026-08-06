import { basePrisma } from '../../db';
import { ApiError } from '../../middleware/error';
import { ADMIN_ROLES, ROLE_DEFAULT_SCREENS } from '../../lib/permissions';
import { hashPassword } from '../../lib/password';
import type { BootstrapOrg } from './schemas';

const DEFAULT_ONBOARDING_OWNER = 'aroul303@gmail.com';
const BUILT_IN_ROLES = [...new Set(['Owner', 'Administrator', ...Object.keys(ROLE_DEFAULT_SCREENS)])];

function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

export function suggestedSlug(name: string): string {
  return normalizeSlug(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function allowedOnboardingEmails(): string[] {
  const configured = (process.env.ONBOARDING_ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : [DEFAULT_ONBOARDING_OWNER];
}

export function canAccessOnboarding(email: string | undefined, isAdmin: boolean): boolean {
  if (!email || !isAdmin) return false;
  const allowed = allowedOnboardingEmails();
  return allowed.includes(email.trim().toLowerCase());
}

async function createBuiltInRoles(tx: Parameters<Parameters<typeof basePrisma.$transaction>[0]>[0], organizationId: string) {
  await tx.role.createMany({
    data: BUILT_IN_ROLES.map((name) => ({
      organizationId,
      name,
      screens: name === 'Owner' ? [] : (ROLE_DEFAULT_SCREENS[name] ?? []),
      isAdmin: ADMIN_ROLES.has(name),
      isSystem: true,
    })),
  });

  const roles = await tx.role.findMany({ where: { organizationId }, select: { id: true, name: true } });
  return new Map(roles.map((r) => [r.name, r.id]));
}

export async function listOrganizations() {
  const organizations = await basePrisma.organization.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      memberships: {
        where: { status: { not: 'inactive' }, role: { in: ['Owner', 'Administrator'] } },
        include: { user: true },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });

  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    plan: organization.plan,
    subscriptionStatus: organization.subscriptionStatus,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
    contacts: organization.memberships.map((membership) => ({
      membershipId: membership.id,
      userId: membership.userId,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.role,
      employeeCode: membership.employeeCode,
      status: membership.status,
    })),
  }));
}

export async function bootstrapOrganization(input: BootstrapOrg) {
  const orgName = input.organizationName.trim();
  const orgSlug = normalizeSlug(input.organizationSlug);
  const adminName = input.adminName.trim();
  const adminEmail = input.adminEmail.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  return basePrisma.$transaction(async (tx) => {
    const existingOrg = await tx.organization.findUnique({ where: { slug: orgSlug } });
    if (existingOrg) throw new ApiError(409, 'org_taken', 'That organization slug is already in use.');

    const organization = await tx.organization.create({
      data: {
        name: orgName,
        slug: orgSlug,
        status: 'active',
        plan: 'starter',
        subscriptionStatus: 'trialing',
      },
    });

    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organization.id}, true)`;
    const roleIdByName = await createBuiltInRoles(tx, organization.id);

    const user = await tx.user.upsert({
      where: { email: adminEmail },
      update: { name: adminName, passwordHash },
      create: { email: adminEmail, name: adminName, passwordHash },
    });

    const dupe = await tx.membership.findFirst({ where: { organizationId: organization.id, userId: user.id } });
    if (dupe) throw new ApiError(409, 'already_member', 'That email already belongs to this organization.');

    const membership = await tx.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        employeeCode: 'EMP-001',
        department: 'Management',
        role: 'Owner',
        roleId: roleIdByName.get('Owner') ?? null,
        shift: 'D',
        status: 'active',
      },
      include: { user: true, organization: true },
    });

    return {
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
      owner: {
        userId: membership.userId,
        email: membership.user.email,
        name: membership.user.name,
        membershipId: membership.id,
        employeeCode: membership.employeeCode,
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        role: membership.role,
      },
    };
  });
}
