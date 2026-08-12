import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password';
import { ADMIN_ROLES, ROLE_DEFAULT_SCREENS } from '../src/lib/permissions';

export const AONE_ORG_SLUG = 'aone-plastic-machinery';
export const AONE_OWNER_EMAIL = 'aoneplasticmachinery@gmail.com';
export const AONE_FORM_FAMILY = 'aone-crate-project-requirements';
export const BUILT_IN_ROLES = [...new Set(['Owner', 'Administrator', ...Object.keys(ROLE_DEFAULT_SCREENS)])];

export const AONE_MESALEADS_PROFILE = {
  legalName: 'A ONE PLASTIC MACHINERY',
  brandName: 'AONE Plastic Machinery',
  summary: 'Turnkey plastic processing machinery and project consultancy, from machine and mould selection through plant setup, commissioning, training and support.',
  website: '',
  emails: ['admin@demandmachineindia.com', 'aoneplasticmachinery@gmail.com'],
  phones: ['+91-7338816217', '+91-9384607312'],
  contact: { name: 'S N Bhatt', title: 'Technical Director' },
  address: {
    line1: 'SF No. 299, Kundrathur Main Road', line2: 'Sikkarayapuram',
    city: 'Chennai', state: 'Tamil Nadu', postalCode: '600069', country: 'India',
  },
  capabilities: [
    'Turnkey plastic processing machinery', 'Injection moulding', 'Extrusion', 'Recycling',
    'Auxiliary equipment', 'Project consultancy', 'Machine selection', 'Mould sourcing',
    'Plant setup', 'Commissioning', 'Training', 'After-sales support',
  ],
  branding: { logoUrl: '', primaryColor: '#12385B' },
} as const;

export const AONE_QUOTE_DEFAULTS = {
  currency: 'INR',
  validityDays: 30,
  warranty: '12 months against manufacturing defects.',
  delivery: '60–90 days after receipt of advance and technical confirmation.',
  payment: '50% with purchase order; 50% before dispatch.',
  tax: 'GST extra as applicable.',
  exclusions: ['Freight', 'Unloading', 'Installation labour', 'Civil work', 'Electrical work'],
  utilities: ['3-phase power', 'Cooling tower', 'Chiller', 'Air compressor', 'Process water', 'EOT crane / forklift', 'Production shed', 'Storage'],
  referenceOffers: [
    { item: '400T servo injection moulding machine', amount: '4950000' },
    { item: '500T servo injection moulding machine (recommended)', amount: '5550000' },
    { item: '390 × 320 × 270 mm crate mould with cutting', amount: '1836000' },
    { item: '390 × 320 × 270 mm crate mould without cutting', amount: '1836000' },
    { item: '390 × 320 × 240 mm crate mould with cutting', amount: '1836000' },
    { item: '510 × 330 × 270 mm heavy-duty crate mould with cutting', amount: '2241000' },
  ],
} as const;

export const AONE_FORM = {
  name: 'Fruit & Vegetable Crate Manufacturing Plant — Project Requirements',
  description: 'Share your HDPE/PP crate product, machine, mould, site and utility requirements for technical review and a formal techno-commercial quotation.',
  privacyNotice: 'AONE Plastic Machinery will use this information to assess your project, prepare a quotation and provide customer journey updates. Do not upload unrelated personal or confidential information.',
} as const;

export function desiredAoneQuestions() {
  return [
    { key: 'customer_details', type: 'section', label: 'Customer & company details', helpText: 'Tell us who we should coordinate with.', placeholder: '', required: false, options: [], validation: {}, sortOrder: 0 },
    { key: 'customer_name', type: 'short_text', label: 'Contact person name', helpText: '', placeholder: 'Full name', required: true, options: [], validation: { maxLength: 160 }, sortOrder: 1 },
    { key: 'email', type: 'email', label: 'Business email', helpText: 'Quotation updates and verification codes will be sent here.', placeholder: 'name@company.com', required: true, options: [], validation: {}, sortOrder: 2 },
    { key: 'phone', type: 'phone', label: 'Contact number', helpText: '', placeholder: '+91 …', required: true, options: [], validation: { maxLength: 40 }, sortOrder: 3 },
    { key: 'company_name', type: 'short_text', label: 'Company name', helpText: '', placeholder: '', required: true, options: [], validation: { maxLength: 200 }, sortOrder: 4 },
    { key: 'company_address', type: 'long_text', label: 'Registered company address', helpText: '', placeholder: '', required: true, options: [], validation: { maxLength: 2000 }, sortOrder: 5 },
    { key: 'gst_number', type: 'short_text', label: 'GSTIN', helpText: 'Optional at enquiry stage.', placeholder: '15-character GSTIN', required: false, options: [], validation: { maxLength: 32 }, sortOrder: 6 },
    { key: 'project_details', type: 'section', label: 'Crate project requirements', helpText: 'These details help us size the machine, mould and utilities.', placeholder: '', required: false, options: [], validation: {}, sortOrder: 7 },
    { key: 'product', type: 'short_text', label: 'Product / crate description', helpText: 'For example, fruit and vegetable crate.', placeholder: '', required: true, options: [], validation: { maxLength: 300 }, sortOrder: 8 },
    { key: 'crate_dimensions', type: 'short_text', label: 'Required crate dimensions (L × W × H)', helpText: 'Enter dimensions in millimetres.', placeholder: 'e.g. 510 × 330 × 270 mm', required: true, options: [], validation: { maxLength: 120 }, sortOrder: 9 },
    { key: 'product_weight', type: 'number', label: 'Target product weight (kg)', helpText: 'Approximate finished crate weight.', placeholder: '', required: true, options: [], validation: { min: 0.01, max: 1000 }, sortOrder: 10 },
    { key: 'polymer_material', type: 'multi_select', label: 'Polymer / material', helpText: 'Select all materials under consideration.', placeholder: '', required: true, options: ['HDPE', 'PP', 'Recycled HDPE', 'Recycled PP', 'Other'], validation: {}, sortOrder: 11 },
    { key: 'sample_photo', type: 'file', label: 'Product drawing, sample photo or reference PDF', helpText: 'JPG, PNG or PDF; maximum 5 MB.', placeholder: '', required: false, options: [], validation: {}, sortOrder: 12 },
    { key: 'requirement_scope', type: 'single_select', label: 'Required project scope', helpText: '', placeholder: '', required: true, options: ['machine_only', 'machine_mold', 'mold_only'], validation: {}, sortOrder: 13 },
    { key: 'mold_details', type: 'long_text', label: 'Mould details / cavity / cutting requirements', helpText: 'Include existing mould dimensions and condition when applicable.', placeholder: '', required: true, options: [], validation: { maxLength: 5000 }, visibilityRule: { questionKey: 'requirement_scope', operator: 'not_equals', value: 'machine_only' }, sortOrder: 14 },
    { key: 'production_target', type: 'number', label: 'Required monthly production volume (pieces)', helpText: '', placeholder: '', required: true, options: [], validation: { min: 1 }, sortOrder: 15 },
    { key: 'machine_preference', type: 'single_select', label: 'Machine tonnage preference', helpText: 'Final selection is subject to technical review.', placeholder: '', required: false, options: ['400T', '500T recommended', 'Need recommendation'], validation: {}, sortOrder: 16 },
    { key: 'site_readiness', type: 'section', label: 'Site readiness & utilities', helpText: 'Used for turnkey planning and commissioning scope.', placeholder: '', required: false, options: [], validation: {}, sortOrder: 17 },
    { key: 'factory_location', type: 'long_text', label: 'Factory location and delivery address', helpText: '', placeholder: '', required: true, options: [], validation: { maxLength: 2000 }, sortOrder: 18 },
    { key: 'floor_area', type: 'number', label: 'Available floor area (sq ft)', helpText: '', placeholder: '', required: false, options: [], validation: { min: 1 }, sortOrder: 19 },
    { key: 'connected_power', type: 'number', label: 'Available connected power (kVA)', helpText: '', placeholder: '', required: false, options: [], validation: { min: 1 }, sortOrder: 20 },
    { key: 'utilities', type: 'multi_select', label: 'Utilities / infrastructure available', helpText: '', placeholder: '', required: false, options: ['3-phase power', 'Cooling tower', 'Chiller', 'Air compressor', 'Process water', 'EOT crane / forklift', 'Production shed', 'Raw material storage'], validation: {}, sortOrder: 21 },
    { key: 'finance_required', type: 'yes_no', label: 'Is project finance assistance required?', helpText: '', placeholder: '', required: false, options: [], validation: {}, sortOrder: 22 },
    { key: 'target_start_date', type: 'date', label: 'Target production start date', helpText: '', placeholder: '', required: false, options: [], validation: {}, sortOrder: 23 },
    { key: 'additional_notes', type: 'long_text', label: 'Additional requirements or remarks', helpText: '', placeholder: '', required: false, options: [], validation: { maxLength: 5000 }, sortOrder: 24 },
  ];
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

export function mergeAoneSettings(existing: unknown): Prisma.InputJsonValue {
  return {
    ...jsonRecord(existing),
    mesaLeadsProfile: AONE_MESALEADS_PROFILE,
    mesaLeadsQuoteDefaults: AONE_QUOTE_DEFAULTS,
  } as unknown as Prisma.InputJsonValue;
}

export function requireDirectDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const value = (env.DIRECT_DATABASE_URL || '').trim();
  if (!value) throw new Error('DIRECT_DATABASE_URL is required for non-destructive AONE provisioning.');
  return value;
}

type ProvisionOptions = {
  now?: Date;
  ownerPassword?: string;
  passwordHasher?: (plain: string) => Promise<string>;
  tokenFactory?: () => string;
};

export async function provisionAone(db: PrismaClient, options: ProvisionOptions = {}) {
  const now = options.now ?? new Date();
  const ownerPassword = options.ownerPassword ?? '';
  if (ownerPassword && ownerPassword.length < 10) throw new Error('AONE_OWNER_PASSWORD must contain at least 10 characters.');
  const passwordHasher = options.passwordHasher ?? hashPassword;
  const tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString('base64url'));

  return db.$transaction(async (tx) => {
    // Serialize independent deploy jobs before any read/create decision. The
    // stable two-key lock does not depend on an organization row existing yet.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('mesadesk-provision'), hashtext(${AONE_ORG_SLUG}))`;
    const service = await tx.service.findUnique({ where: { id: 'mesaleads' } });
    if (!service) throw new Error('MesaLeads is missing from the global service catalog. Apply migrations/seed the catalog before provisioning.');
    if ('status' in service && service.status !== 'active') throw new Error('Global MesaLeads is not active. Activate it before provisioning AONE.');

    const existingOrganization = await tx.organization.findUnique({ where: { slug: AONE_ORG_SLUG } });
    const organization = existingOrganization
      ? await tx.organization.update({
          where: { id: existingOrganization.id },
          data: { name: 'A ONE PLASTIC MACHINERY', settings: mergeAoneSettings(existingOrganization.settings) },
        })
      : await tx.organization.create({
          data: {
            name: 'A ONE PLASTIC MACHINERY', slug: AONE_ORG_SLUG, status: 'active', plan: 'professional',
            subscriptionStatus: 'active', settings: mergeAoneSettings({}),
          },
        });

    const otherAssignments = await tx.organizationService.findMany({
      where: { organizationId: organization.id, serviceId: { not: 'mesaleads' } },
      select: { serviceId: true },
    });
    if (otherAssignments.length) {
      throw new Error(`AONE has other service assignments (${otherAssignments.map((item) => item.serviceId).join(', ')}). Nothing was removed; resolve them explicitly before rerunning.`);
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

    let user = await tx.user.findUnique({ where: { email: AONE_OWNER_EMAIL } });
    const createdOwnerUser = !user;
    if (!user) {
      user = await tx.user.create({
        data: {
          email: AONE_OWNER_EMAIL, name: 'S N Bhatt',
          passwordHash: ownerPassword ? await passwordHasher(ownerPassword) : null,
        },
      });
    }
    const membership = await tx.membership.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      update: { role: 'Owner', roleId: ownerRole.id, department: 'Management', status: 'active' },
      create: {
        organizationId: organization.id, userId: user.id, employeeCode: 'AONE-001', department: 'Management',
        role: 'Owner', roleId: ownerRole.id, status: 'active', location: 'Chennai',
      },
    });

    const forms = await tx.leadForm.findMany({
      where: { organizationId: organization.id, familyKey: AONE_FORM_FAMILY },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { revision: 'desc' },
    });
    const desiredQuestions = desiredAoneQuestions();
    const latestForm = forms[0];
    const exactPublished = latestForm?.status === 'published'
      && latestForm.name === AONE_FORM.name
      && latestForm.description === AONE_FORM.description
      && latestForm.privacyNotice === AONE_FORM.privacyNotice
      && canonicalJsonString(latestForm.questions.map(({ key, type, label, helpText, placeholder, required, options, validation, visibilityRule, sortOrder }) => ({ key, type, label, helpText, placeholder, required, options, validation, ...(visibilityRule ? { visibilityRule } : {}), sortOrder }))) === canonicalJsonString(desiredQuestions)
      ? latestForm
      : undefined;
    let form = exactPublished;
    let createdFormRevision = false;
    if (!form) {
      form = await tx.leadForm.create({
        data: {
          organizationId: organization.id, familyKey: AONE_FORM_FAMILY, ...AONE_FORM,
          status: 'published', revision: (forms[0]?.revision ?? 0) + 1, publishedAt: now,
          questions: {
            create: desiredQuestions.map((question) => ({
              organizationId: organization.id, key: question.key, type: question.type, label: question.label,
              helpText: question.helpText, placeholder: question.placeholder, required: question.required,
              options: question.options as Prisma.InputJsonValue, validation: question.validation as Prisma.InputJsonValue,
              ...('visibilityRule' in question ? { visibilityRule: question.visibilityRule as Prisma.InputJsonValue } : {}),
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
    const result = await provisionAone(db, { ownerPassword: process.env.AONE_OWNER_PASSWORD || '' });
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    console.log(JSON.stringify({
      ...result,
      ownerEmail: AONE_OWNER_EMAIL,
      ownerNote: result.createdOwnerUser
        ? (result.ownerPasswordApplied ? 'New owner created with AONE_OWNER_PASSWORD.' : 'New passwordless owner created; use verified Google sign-in or an approved recovery/invitation flow.')
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
