import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password';
import { ADMIN_ROLES, ROLE_DEFAULT_SCREENS } from '../src/lib/permissions';
import {
  desiredMesaOpsPlantQuestions,
  MESAOPS_PLANT_FORM_FAMILY,
  MESAOPS_PLANT_FORM_META,
} from '../../src/mesaleads/mesaopsPlantForm';

export const MESAWORKS_ORG_SLUG = 'mesaworks';
export const MESAWORKS_OWNER_EMAIL = 'aroul303@gmail.com';
export const MESAWORKS_FORM_FAMILY = MESAOPS_PLANT_FORM_FAMILY;
export const BUILT_IN_ROLES = [...new Set(['Owner', 'Administrator', ...Object.keys(ROLE_DEFAULT_SCREENS)])];

export const MESAWORKS_MESALEADS_PROFILE = {
  legalName: 'MesaWorks',
  brandName: 'MesaOrigins',
  summary:
    'One Platform. Every Operation. MesaOrigins digitises plant discipline — machine logbooks, planning, quality, '
    + 'inventory, dispatch and full lot traceability — for manufacturing teams that already know how to run a shop floor.',
  website: '',
  emails: ['aroul303@gmail.com'],
  phones: [],
  contact: { name: 'MesaWorks', title: 'Platform Owner' },
  address: {
    line1: '', line2: '', city: '', state: '', postalCode: '', country: 'India',
  },
  capabilities: [
    'Plant digitisation',
    'Digital machine logbooks',
    'QR machine login',
    'Production planning',
    'Quality gate',
    'RM / FG inventory',
    'Dispatch and gate pass',
    'Batch passport / traceability',
    'Preventive maintenance',
    'Complaints and CAPA',
    'Role-based dashboards',
  ],
  branding: { logoUrl: '', primaryColor: '#1E40AF' },
} as const;

/** Commercial defaults from MO-QT-2026-MP01 (single plant). */
export const MESAWORKS_QUOTE_DEFAULTS = {
  currency: 'INR',
  validityDays: 30,
  warranty: 'Platform hosting, daily backups, continuous updates and support for the active subscription term.',
  delivery: 'Shop floor live within approximately 3 weeks of kickoff when master data and kickoff decisions are ready.',
  payment:
    'Implementation charges due on completion of 3 weeks of successful implementation. '
    + 'Platform charges (monthly or annual) payable in advance.',
  tax: 'GST extra as applicable.',
  exclusions: ['Additional plants beyond single-site scope', 'Higher user volumes beyond 12 plant users', 'AI chatbot overage above 1,000 queries / month'],
  utilities: [],
  referenceOffers: [
    { item: 'Implementation — platform setup, machine QR generation, user roles and training (one-time)', amount: '29999' },
    { item: 'Platform charges — monthly plan (12 plant users, hosting, backups, updates and support)', amount: '12999' },
    { item: 'Platform charges — annual plan (same coverage as monthly; ~₹26,000 saving vs month-to-month)', amount: '129999' },
  ],
} as const;

export const MESAWORKS_FORM = MESAOPS_PLANT_FORM_META;

export function desiredMesaWorksQuestions() {
  return desiredMesaOpsPlantQuestions();
}

function jsonRecord(value: unknown): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  }
  return value;
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

export function mergeMesaWorksSettings(existing: unknown): Prisma.InputJsonValue {
  return {
    ...jsonRecord(existing),
    mesaLeadsProfile: MESAWORKS_MESALEADS_PROFILE,
    mesaLeadsQuoteDefaults: MESAWORKS_QUOTE_DEFAULTS,
  } as unknown as Prisma.InputJsonValue;
}

export function requireDirectDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const value = (env.DIRECT_DATABASE_URL || '').trim();
  if (!value) throw new Error('DIRECT_DATABASE_URL is required for non-destructive MesaWorks provisioning.');
  return value;
}

type ProvisionOptions = {
  now?: Date;
  ownerPassword?: string;
  passwordHasher?: (plain: string) => Promise<string>;
  tokenFactory?: () => string;
};

export async function provisionMesaWorks(db: PrismaClient, options: ProvisionOptions = {}) {
  const now = options.now ?? new Date();
  const ownerPassword = options.ownerPassword ?? '';
  if (ownerPassword && ownerPassword.length < 10) throw new Error('MESAWORKS_OWNER_PASSWORD must contain at least 10 characters.');
  const passwordHasher = options.passwordHasher ?? hashPassword;
  const tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString('base64url'));

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('mesaorigins-provision'), hashtext(${MESAWORKS_ORG_SLUG}))`;
    const service = await tx.service.findUnique({ where: { id: 'mesaleads' } });
    if (!service) throw new Error('MesaLeads is missing from the global service catalog. Apply migrations/seed the catalog before provisioning.');
    if ('status' in service && service.status !== 'active') throw new Error('Global MesaLeads is not active. Activate it before provisioning MesaWorks.');

    const existingOrganization = await tx.organization.findUnique({ where: { slug: MESAWORKS_ORG_SLUG } });
    const organization = existingOrganization
      ? await tx.organization.update({
          where: { id: existingOrganization.id },
          data: { name: 'MesaWorks', settings: mergeMesaWorksSettings(existingOrganization.settings) },
        })
      : await tx.organization.create({
          data: {
            name: 'MesaWorks', slug: MESAWORKS_ORG_SLUG, status: 'active', plan: 'professional',
            subscriptionStatus: 'active', settings: mergeMesaWorksSettings({}),
          },
        });

    const otherAssignments = await tx.organizationService.findMany({
      where: { organizationId: organization.id, serviceId: { not: 'mesaleads' } },
      select: { serviceId: true },
    });
    if (otherAssignments.length) {
      throw new Error(`MesaWorks has other service assignments (${otherAssignments.map((item) => item.serviceId).join(', ')}). Nothing was removed; resolve them explicitly before rerunning.`);
    }
    await tx.organizationService.upsert({
      where: { organizationId_serviceId: { organizationId: organization.id, serviceId: 'mesaleads' } },
      update: { status: 'active' },
      create: { organizationId: organization.id, serviceId: 'mesaleads', status: 'active' },
    });

    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organization.id}, true)`;
    const roles = await Promise.all(BUILT_IN_ROLES.map((name) => {
      const screens = name === 'Owner' ? [] : (ROLE_DEFAULT_SCREENS[name] ?? []);
      const isAdmin = ADMIN_ROLES.has(name);
      return tx.role.upsert({
        where: { organizationId_name: { organizationId: organization.id, name } },
        update: { screens, isAdmin, isSystem: true },
        create: { organizationId: organization.id, name, screens, isAdmin, isSystem: true },
      });
    }));
    const ownerRole = roles.find((role) => role.name === 'Owner');
    if (!ownerRole) throw new Error('Owner role provisioning failed.');

    let user = await tx.user.findUnique({ where: { email: MESAWORKS_OWNER_EMAIL } });
    const createdOwnerUser = !user;
    if (!user) {
      user = await tx.user.create({
        data: {
          email: MESAWORKS_OWNER_EMAIL, name: 'MesaWorks Owner',
          passwordHash: ownerPassword ? await passwordHasher(ownerPassword) : null,
        },
      });
    }
    const membership = await tx.membership.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      update: { role: 'Owner', roleId: ownerRole.id, department: 'Management', status: 'active' },
      create: {
        organizationId: organization.id, userId: user.id, employeeCode: 'MW-001', department: 'Management',
        role: 'Owner', roleId: ownerRole.id, status: 'active', location: 'Internal',
      },
    });

    const forms = await tx.leadForm.findMany({
      where: { organizationId: organization.id, familyKey: MESAWORKS_FORM_FAMILY },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { revision: 'desc' },
    });
    const desiredQuestions = desiredMesaWorksQuestions();
    const latestForm = forms[0];
    const exactPublished = latestForm?.status === 'published'
      && latestForm.name === MESAWORKS_FORM.name
      && latestForm.description === MESAWORKS_FORM.description
      && latestForm.privacyNotice === MESAWORKS_FORM.privacyNotice
      && canonicalJsonString(latestForm.questions.map(({ key, type, label, helpText, placeholder, required, options, validation, visibilityRule, sortOrder }) => ({ key, type, label, helpText, placeholder, required, options, validation, ...(visibilityRule ? { visibilityRule } : {}), sortOrder }))) === canonicalJsonString(desiredQuestions)
      ? latestForm
      : undefined;
    let form = exactPublished;
    let createdFormRevision = false;
    if (!form) {
      form = await tx.leadForm.create({
        data: {
          organizationId: organization.id, familyKey: MESAWORKS_FORM_FAMILY, ...MESAWORKS_FORM,
          status: 'published', revision: (forms[0]?.revision ?? 0) + 1, publishedAt: now,
          questions: {
            create: desiredQuestions.map((question) => ({
              organizationId: organization.id, key: question.key, type: question.type, label: question.label,
              helpText: question.helpText, placeholder: question.placeholder, required: question.required,
              options: question.options as Prisma.InputJsonValue, validation: question.validation as Prisma.InputJsonValue,
              ...('visibilityRule' in question && question.visibilityRule
                ? { visibilityRule: question.visibilityRule as Prisma.InputJsonValue }
                : {}),
              sortOrder: question.sortOrder,
            })),
          },
        },
        include: { questions: { orderBy: { sortOrder: 'asc' } } },
      });
      createdFormRevision = true;
      const priorFormIds = forms.map((existingForm) => existingForm.id);
      if (priorFormIds.length) {
        await tx.leadFormLink.updateMany({
          where: {
            organizationId: organization.id,
            formId: { in: priorFormIds },
            kind: 'generic',
            status: 'active',
          },
          data: { status: 'revoked' },
        });
      }
    }

    const activeLinks = await tx.leadFormLink.findMany({
      where: {
        organizationId: organization.id, formId: form.id, kind: 'generic', status: 'active',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    let createdPublicPath: string | undefined;
    if (!activeLinks[0]) {
      const token = tokenFactory();
      if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new Error('Token factory returned an invalid MesaLeads bearer token.');
      await tx.leadFormLink.create({
        data: {
          tokenHash: createHash('sha256').update(token).digest('hex'), organizationId: organization.id,
          formId: form.id, kind: 'generic', status: 'active',
          expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
        },
      });
      createdPublicPath = `/mesaleads/q/${token}`;
    }

    return {
      organizationId: organization.id,
      ownerUserId: user.id,
      ownerMembershipId: membership.id,
      formId: form.id,
      createdOrganization: !existingOrganization,
      createdOwnerUser,
      createdFormRevision,
      createdPublicPath,
      ownerPasswordApplied: createdOwnerUser && Boolean(ownerPassword),
    };
  });
}

async function main() {
  const directUrl = requireDirectDatabaseUrl(process.env);
  const db = new PrismaClient({ datasources: { db: { url: directUrl } } });
  try {
    const result = await provisionMesaWorks(db, { ownerPassword: process.env.MESAWORKS_OWNER_PASSWORD || '' });
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    console.log(JSON.stringify({
      ...result,
      ownerEmail: MESAWORKS_OWNER_EMAIL,
      ownerNote: result.createdOwnerUser
        ? (result.ownerPasswordApplied ? 'New owner created with MESAWORKS_OWNER_PASSWORD.' : 'New passwordless owner created; use verified Google sign-in or an approved recovery/invitation flow.')
        : 'Existing global identity preserved; name and password were not overwritten.',
      publicFormUrl: result.createdPublicPath ? `${appUrl || '<APP_URL>'}${result.createdPublicPath}` : null,
      publicFormUrlNote: result.createdPublicPath
        ? 'Raw bearer URL is shown once. Store it securely.'
        : 'A valid generic link already exists. Its raw token cannot be recovered; revoke it deliberately before creating a replacement.',
    }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
