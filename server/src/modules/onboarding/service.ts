import { basePrisma } from '../../db';
import { ApiError } from '../../middleware/error';
import { ADMIN_ROLES, ROLE_DEFAULT_SCREENS } from '../../lib/permissions';
import { hashPassword } from '../../lib/password';
import type { BootstrapOrg, OrganizationServicesInput, ServiceStatusInput } from './schemas';

const DEFAULT_ONBOARDING_OWNER = 'aroul303@gmail.com';
const BUILT_IN_ROLES = [...new Set(['Owner', 'Administrator', ...Object.keys(ROLE_DEFAULT_SCREENS)])];

const serviceDto = (service: { id: string; name: string; description: string; status: string; sortOrder: number }) => ({
  id: service.id,
  name: service.name,
  description: service.description,
  status: service.status,
  sortOrder: service.sortOrder,
});

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Admin-safe projection of the customer-facing MesaLeads organization profile.
 * Keeping this allowlisted prevents arbitrary Organization.settings values from
 * leaking through the platform directory.
 */
function mesaLeadsProfile(settings: unknown) {
  const profile = jsonRecord(jsonRecord(settings).mesaLeadsProfile);
  if (Object.keys(profile).length === 0) return null;
  const contact = jsonRecord(profile.contact);
  const address = jsonRecord(profile.address);
  const branding = jsonRecord(profile.branding);
  return {
    legalName: text(profile.legalName),
    brandName: text(profile.brandName),
    summary: text(profile.summary),
    website: text(profile.website),
    emails: textList(profile.emails),
    phones: textList(profile.phones),
    contact: { name: text(contact.name), title: text(contact.title) },
    address: {
      line1: text(address.line1),
      line2: text(address.line2),
      city: text(address.city),
      state: text(address.state),
      postalCode: text(address.postalCode),
      country: text(address.country),
    },
    capabilities: textList(profile.capabilities),
    branding: { logoUrl: text(branding.logoUrl), primaryColor: text(branding.primaryColor) },
  };
}

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

export async function listServiceCatalog() {
  const services = await basePrisma.service.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return services.map(serviceDto);
}

export async function setServiceStatus(serviceId: string, input: ServiceStatusInput) {
  const service = await basePrisma.service.update({
    where: { id: serviceId },
    data: { status: input.status },
  });
  return serviceDto(service);
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
      services: { include: { service: true } },
    },
  });

  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    plan: organization.plan,
    subscriptionStatus: organization.subscriptionStatus,
    mesaLeadsProfile: mesaLeadsProfile(organization.settings),
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
    services: organization.services
      .map((assignment) => ({ ...serviceDto(assignment.service), assignmentStatus: assignment.status }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
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
  const selectedServices = await basePrisma.service.findMany({
    where: { id: { in: input.serviceIds } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  if (selectedServices.length !== input.serviceIds.length) {
    throw new ApiError(422, 'invalid_service', 'One or more selected services do not exist.');
  }
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

    await tx.organizationService.createMany({
      data: input.serviceIds.map((serviceId) => ({ organizationId: organization.id, serviceId })),
    });

    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organization.id}, true)`;
    const roleIdByName = await createBuiltInRoles(tx, organization.id);

    // Never repurpose a global identity during tenant onboarding. Updating an
    // existing row here would reset the name/password used by every other
    // organization membership for that person.
    const user = await tx.user.create({ data: { email: adminEmail, name: adminName, passwordHash } })
      .catch((error: unknown) => {
        if ((error as { code?: string })?.code === 'P2002') {
          throw new ApiError(
            409,
            'owner_email_exists',
            'That email already has an account. Use a different first-owner email; existing-account invitations require a verified invite flow.',
          );
        }
        throw error;
      });

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
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        services: selectedServices.map(serviceDto),
      },
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

export async function setOrganizationServices(organizationId: string, input: OrganizationServicesInput) {
  const [organization, selectedServices] = await Promise.all([
    basePrisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } }),
    basePrisma.service.findMany({
      where: { id: { in: input.serviceIds } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ]);
  if (!organization) throw new ApiError(404, 'not_found', 'Organization not found.');
  if (selectedServices.length !== input.serviceIds.length) {
    throw new ApiError(422, 'invalid_service', 'One or more selected services do not exist.');
  }

  await basePrisma.$transaction(async (tx) => {
    await tx.organizationService.deleteMany({ where: { organizationId } });
    await tx.organizationService.createMany({
      data: input.serviceIds.map((serviceId) => ({ organizationId, serviceId })),
    });
  });

  return {
    organizationId,
    services: selectedServices.map((service) => ({ ...serviceDto(service), assignmentStatus: 'active' })),
  };
}
