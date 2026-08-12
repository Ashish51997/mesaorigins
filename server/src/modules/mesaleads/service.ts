import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Prisma, type LeadFormQuestion } from '@prisma/client';
import { basePrisma, prisma, tenantTx, withTenant } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { ApiError } from '../../middleware/error';
import { leadStages } from './schemas';
import type {
  ActivityCreateInput,
  FormCreateInput,
  FormLinkCreateInput,
  FormUpdateInput,
  LeadCreateInput,
  LeadUpdateInput,
  PublicSubmissionInput,
  CustomerQuoteDecisionInput,
  CustomerDecisionChallengeInput,
  FulfillmentCreateInput,
  FulfillmentUpdateInput,
  MilestoneCreateInput,
  MilestoneUpdateInput,
  QuoteCreateInput,
  QuoteTransitionInput,
  QuoteUpdateInput,
} from './schemas';

const SERVICE_ID = 'mesaleads';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PUBLIC_PATH = '/mesaleads/q/';
const CLOSED_STAGES = new Set(['won', 'lost']);
const DEFAULT_MILESTONES = [
  'Order confirmed',
  'Advance payment',
  'Technical confirmation',
  'Machine/mould production',
  'Factory acceptance/trial',
  'Ready for dispatch',
  'Dispatch',
  'Installation & commissioning',
  'Training/handover',
] as const;
const ACCEPTANCE_TEXT = 'I confirm that I am authorized to accept this quotation and its commercial terms on behalf of the customer.';

function context() {
  const ctx = tenantContext.getStore();
  if (!ctx) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return ctx;
}

export async function organizationHasMesaLeads(organizationId: string): Promise<boolean> {
  const assignment = await basePrisma.organizationService.findUnique({
    where: { organizationId_serviceId: { organizationId, serviceId: SERVICE_ID } },
    select: {
      status: true,
      organization: { select: { status: true } },
      service: { select: { status: true } },
    },
  });
  return assignment?.status === 'active'
    && assignment.organization.status !== 'suspended'
    && assignment.service.status === 'active';
}

export async function assertMesaLeadsEntitlement(organizationId: string): Promise<void> {
  if (!(await organizationHasMesaLeads(organizationId))) {
    throw new ApiError(403, 'service_not_enabled', 'MesaLeads is not active for this organization.');
  }
}

function slugKey(label: string, index: number): string {
  const key = label.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 54);
  return /^[a-z]/.test(key) ? key : `question_${index + 1}`;
}

type NormalizedQuestion = FormCreateInput['questions'][number] & { key: string; sortOrder: number };

function normalizeQuestions(questions: FormCreateInput['questions']): NormalizedQuestion[] {
  const used = new Set<string>();
  const normalized = questions.map((question, index) => {
    let key = question.key || slugKey(question.label, index);
    const base = key;
    let suffix = 2;
    if (question.key && used.has(key)) {
      throw new ApiError(422, 'duplicate_question_key', `Question key "${key}" is used more than once.`);
    }
    while (used.has(key)) key = `${base.slice(0, 58)}_${suffix++}`;
    used.add(key);
    return { ...question, key, sortOrder: index };
  });

  normalized.forEach((question, index) => {
    const rule = question.visibilityRule;
    if (rule) {
      const sourceIndex = normalized.findIndex((candidate) => candidate.key === rule.questionKey);
      if (sourceIndex < 0) {
        throw new ApiError(422, 'invalid_visibility_rule', `Question "${question.label}" references an unknown question key.`);
      }
      if (sourceIndex >= index) {
        throw new ApiError(422, 'invalid_visibility_rule', `Question "${question.label}" can only depend on an earlier question.`);
      }
      if (normalized[sourceIndex].type === 'section' || normalized[sourceIndex].type === 'file') {
        throw new ApiError(422, 'invalid_visibility_rule', 'Visibility rules must depend on an answerable non-file question.');
      }
    }
    const validation = question.validation;
    if (validation.min !== undefined && validation.max !== undefined && validation.min > validation.max) {
      throw new ApiError(422, 'invalid_question_validation', `Question "${question.label}" has min greater than max.`);
    }
    if (validation.minLength !== undefined && validation.maxLength !== undefined && validation.minLength > validation.maxLength) {
      throw new ApiError(422, 'invalid_question_validation', `Question "${question.label}" has minLength greater than maxLength.`);
    }
  });
  return normalized;
}

function questionData(organizationId: string, formId: string, questions: NormalizedQuestion[]) {
  return questions.map((question) => ({
    organizationId,
    formId,
    key: question.key,
    type: question.type,
    label: question.label,
    helpText: question.helpText,
    placeholder: question.placeholder,
    required: question.required,
    options: question.options,
    validation: question.validation,
    ...(question.visibilityRule ? { visibilityRule: question.visibilityRule as Prisma.InputJsonValue } : {}),
    sortOrder: question.sortOrder,
  }));
}

const formInclude = {
  questions: { orderBy: { sortOrder: 'asc' as const } },
  _count: { select: { submissions: true } },
  links: {
    select: { id: true, kind: true, status: true, leadId: true, expiresAt: true, openedAt: true, usedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' as const },
  },
};

export function listForms() {
  return prisma.leadForm.findMany({ include: formInclude, orderBy: { updatedAt: 'desc' } });
}

export async function getForm(id: string) {
  const form = await prisma.leadForm.findUnique({ where: { id }, include: formInclude });
  if (!form) throw new ApiError(404, 'not_found', 'MesaLeads form not found.');
  return form;
}

export async function createForm(input: FormCreateInput) {
  const ctx = context();
  const questions = normalizeQuestions(input.questions);
  return tenantTx(async (tx) => {
    const form = await tx.leadForm.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name,
        description: input.description,
        privacyNotice: input.privacyNotice,
      },
    });
    await tx.leadFormQuestion.createMany({ data: questionData(ctx.organizationId, form.id, questions) });
    return tx.leadForm.findUniqueOrThrow({ where: { id: form.id }, include: formInclude });
  });
}

export async function updateForm(id: string, input: FormUpdateInput) {
  const existing = await prisma.leadForm.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new ApiError(404, 'not_found', 'MesaLeads form not found.');
  const ctx = context();
  const questions = input.questions ? normalizeQuestions(input.questions) : null;
  return tenantTx(async (tx) => {
    const claimed = await tx.leadForm.updateMany({
      where: { id, status: 'draft' },
      data: {
        updatedAt: new Date(),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.privacyNotice !== undefined ? { privacyNotice: input.privacyNotice } : {}),
      },
    });
    if (claimed.count !== 1) {
      throw new ApiError(409, 'form_immutable', 'Published or archived forms are immutable. Clone a new revision to make changes.');
    }
    if (questions) {
      await tx.leadFormQuestion.deleteMany({ where: { formId: id } });
      await tx.leadFormQuestion.createMany({ data: questionData(ctx.organizationId, id, questions) });
    }
    return tx.leadForm.findUniqueOrThrow({ where: { id }, include: formInclude });
  });
}

export async function cloneFormRevision(id: string) {
  const existing = await prisma.leadForm.findUnique({
    where: { id },
    include: { questions: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!existing) throw new ApiError(404, 'not_found', 'MesaLeads form not found.');
  const ctx = context();
  return tenantTx(async (tx) => {
    const latest = await tx.leadForm.aggregate({
      where: { familyKey: existing.familyKey },
      _max: { revision: true },
    });
    const draft = await tx.leadForm.create({
      data: {
        organizationId: ctx.organizationId,
        familyKey: existing.familyKey,
        name: existing.name,
        description: existing.description,
        privacyNotice: existing.privacyNotice,
        status: 'draft',
        revision: (latest._max.revision ?? existing.revision) + 1,
      },
    });
    await tx.leadFormQuestion.createMany({
      data: existing.questions.map((question) => ({
        organizationId: ctx.organizationId,
        formId: draft.id,
        key: question.key,
        type: question.type,
        label: question.label,
        helpText: question.helpText,
        placeholder: question.placeholder,
        required: question.required,
        options: question.options as Prisma.InputJsonValue,
        validation: question.validation as Prisma.InputJsonValue,
        ...(question.visibilityRule ? { visibilityRule: question.visibilityRule as Prisma.InputJsonValue } : {}),
        sortOrder: question.sortOrder,
      })),
    });
    return tx.leadForm.findUniqueOrThrow({ where: { id: draft.id }, include: formInclude });
  });
}

function rawToken(): string {
  return randomBytes(32).toString('base64url');
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function submissionPortalToken(linkId: string, submissionKey: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new ApiError(503, 'auth_not_configured', 'Customer portal signing is not configured.');
  return createHmac('sha256', secret).update(`mesaleads-portal:${linkId}:${submissionKey}`).digest('base64url');
}

async function createLinkRecord(
  tx: typeof basePrisma,
  organizationId: string,
  formId: string,
  input: FormLinkCreateInput,
) {
  const token = rawToken();
  const defaultExpiryDays = input.kind === 'invitation' ? 14 : 30;
  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt)
    : new Date(Date.now() + defaultExpiryDays * 24 * 60 * 60 * 1_000);
  const link = await tx.leadFormLink.create({
    data: {
      tokenHash: tokenHash(token),
      organizationId,
      formId,
      leadId: input.leadId,
      kind: input.kind,
      expiresAt,
    },
    select: { id: true, kind: true, status: true, leadId: true, expiresAt: true, createdAt: true },
  });
  return { ...link, token, publicPath: `${PUBLIC_PATH}${token}` };
}

export async function publishForm(id: string) {
  const exists = await prisma.leadForm.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new ApiError(404, 'not_found', 'MesaLeads form not found.');
  const ctx = context();
  return tenantTx(async (tx) => {
    const claimed = await tx.leadForm.updateMany({
      where: { id, status: 'draft' },
      data: { status: 'published', publishedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ApiError(409, 'already_published', 'Only a draft form can be published.');
    // Claiming the draft row first serializes publish against question
    // replacement. An empty-form failure rolls this status change back.
    const answerable = await tx.leadFormQuestion.count({ where: { formId: id, type: { not: 'section' } } });
    if (!answerable) throw new ApiError(422, 'empty_form', 'Add at least one answerable question before publishing.');
    const updated = await tx.leadForm.findUniqueOrThrow({
      where: { id },
      include: { questions: { orderBy: { sortOrder: 'asc' } }, _count: { select: { submissions: true } } },
    });
    const link = await createLinkRecord(tx as typeof basePrisma, ctx.organizationId, id, { kind: 'generic' });
    return { form: updated, link };
  });
}

export async function createFormLink(formId: string, input: FormLinkCreateInput) {
  const form = await prisma.leadForm.findUnique({ where: { id: formId }, select: { id: true, status: true } });
  if (!form) throw new ApiError(404, 'not_found', 'MesaLeads form not found.');
  if (form.status !== 'published') throw new ApiError(409, 'form_not_published', 'Publish the form before creating a customer link.');
  if (input.expiresAt && new Date(input.expiresAt) <= new Date()) {
    throw new ApiError(422, 'invalid_expiry', 'Link expiry must be in the future.');
  }
  let targetLead: { id: string } | null = null;
  if (input.leadId) {
    const lead = await prisma.mesaLead.findUnique({ where: { id: input.leadId }, select: { id: true } });
    if (!lead) throw new ApiError(422, 'invalid_lead', 'That lead does not exist in this organization.');
    targetLead = lead;
  }
  const ctx = context();
  return tenantTx(async (tx) => {
    const lockedForm = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT "status" FROM "LeadForm" WHERE "id" = ${formId} FOR UPDATE
    `;
    if (!lockedForm[0]) throw new ApiError(404, 'not_found', 'MesaLeads form not found.');
    if (lockedForm[0].status !== 'published') {
      throw new ApiError(409, 'form_not_published', 'Publish the form before creating a customer link.');
    }
    if (targetLead) {
      const lockedLead = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "MesaLead"
        WHERE "id" = ${targetLead.id} AND "organizationId" = ${ctx.organizationId}
        FOR UPDATE
      `;
      if (!lockedLead[0]) throw new ApiError(422, 'invalid_lead', 'That lead does not exist in this organization.');
      const existingJourney = await tx.leadFormLink.findFirst({
        where: { organizationId: ctx.organizationId, leadId: targetLead.id, kind: 'invitation', status: { in: ['active', 'submitted'] } },
        select: { id: true },
      });
      if (existingJourney) {
        throw new ApiError(409, 'journey_link_exists', 'This lead already has a customer journey link. Revoke it explicitly before creating a replacement.');
      }
    }
    let link;
    try {
      link = await createLinkRecord(tx as typeof basePrisma, ctx.organizationId, formId, input);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ApiError(409, 'journey_link_exists', 'This lead already has a customer journey link.');
      }
      throw error;
    }
    if (targetLead) {
      await tx.leadActivity.create({
        data: {
          organizationId: ctx.organizationId,
          leadId: targetLead.id,
          type: 'questionnaire_sent',
          title: 'Customer questionnaire link created',
          metadata: { formId, linkId: link.id },
          actorUserId: ctx.userId,
          actorEmail: ctx.email,
        },
      });
      await tx.mesaLead.updateMany({
          where: { id: targetLead.id, stage: { in: ['new', 'discovery'] } },
          data: { stage: 'questionnaire_sent', version: { increment: 1 } },
        });
    }
    return link;
  });
}

export async function revokeFormLink(id: string) {
  const ctx = context();
  return tenantTx(async (tx) => {
    const revoked = await tx.leadFormLink.updateMany({
      where: { id, organizationId: ctx.organizationId, status: { in: ['active', 'submitted'] } },
      data: { status: 'revoked' },
    });
    const link = await tx.leadFormLink.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, kind: true, status: true, leadId: true, expiresAt: true, openedAt: true, usedAt: true, createdAt: true },
    });
    if (!link) throw new ApiError(404, 'not_found', 'Questionnaire link not found.');
    if (revoked.count !== 1 && link.status !== 'revoked') {
      throw new ApiError(409, 'link_not_revocable', 'This questionnaire link cannot be revoked.');
    }
    return link;
  });
}

export async function archiveForm(id: string) {
  const ctx = context();
  return tenantTx(async (tx) => {
    const archived = await tx.leadForm.updateMany({
      where: { id, status: { not: 'archived' } },
      data: { status: 'archived' },
    });
    if (archived.count !== 1) {
      const exists = await tx.leadForm.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new ApiError(404, 'not_found', 'MesaLeads form not found.');
      throw new ApiError(409, 'already_archived', 'This questionnaire form is already archived.');
    }
    await tx.leadFormLink.updateMany({
      where: { organizationId: ctx.organizationId, formId: id, status: 'active' },
      data: { status: 'revoked' },
    });
    return tx.leadForm.findUniqueOrThrow({ where: { id }, include: formInclude });
  });
}

function leadWriteData(input: LeadCreateInput | LeadUpdateInput) {
  const {
    version: _version,
    formId: _formId,
    linkExpiresAt: _linkExpiresAt,
    ...withoutVersion
  } = input as LeadCreateInput & { version?: number };
  return {
    ...withoutVersion,
    ...(input.nextFollowUpAt !== undefined
      ? { nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null }
      : {}),
  };
}

function nextReference(): string {
  const stamp = new Date().toISOString().slice(0, 7).replace('-', '');
  return `ML-${stamp}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

async function validateOwner(organizationId: string, ownerMembershipId: string | null | undefined): Promise<void> {
  if (!ownerMembershipId) return;
  const owner = await basePrisma.membership.findFirst({
    where: { id: ownerMembershipId, organizationId, status: { not: 'inactive' } },
    select: { id: true },
  });
  if (!owner) throw new ApiError(422, 'invalid_owner', 'The selected owner is not an active member of this organization.');
}

const quoteInclude = {
  lineItems: { orderBy: { sortOrder: 'asc' as const } },
};

const fulfillmentInclude = {
  milestones: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
};

const leadInclude = {
  submissions: {
    select: {
      id: true,
      formId: true,
      formRevision: true,
      status: true,
      submittedAt: true,
      respondentName: true,
      respondentEmail: true,
      respondentPhone: true,
      answers: true,
      questionSnapshot: true,
      consentTextSnapshot: true,
      consentedAt: true,
      attachments: {
        select: { id: true, questionKey: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
        orderBy: { createdAt: 'asc' as const },
      },
    },
    orderBy: { submittedAt: 'desc' as const },
  },
  activities: { orderBy: { occurredAt: 'desc' as const }, take: 100 },
  attachments: {
    select: { id: true, submissionId: true, questionKey: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
    orderBy: { createdAt: 'desc' as const },
  },
  quotes: { include: quoteInclude, orderBy: { versionNumber: 'desc' as const } },
  fulfillment: { include: fulfillmentInclude },
};

const assignedFormInclude = {
  formLinks: {
    where: { kind: 'invitation' },
    select: {
      formId: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      form: { select: { id: true, name: true, revision: true, status: true } },
    },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
};

function assignedForm<T extends { formLinks?: Array<{ formId: string; form: unknown }> }>(lead: T) {
  const [assignment] = lead.formLinks ?? [];
  const { formLinks: _formLinks, ...rest } = lead;
  return { ...rest, formId: assignment?.formId ?? null, form: assignment?.form ?? null };
}

export function listLeads() {
  return prisma.mesaLead.findMany({
    include: {
      ...assignedFormInclude,
      submissions: { select: { id: true, formId: true, status: true, submittedAt: true }, orderBy: { submittedAt: 'desc' } },
      activities: { select: { id: true, type: true, title: true, occurredAt: true }, orderBy: { occurredAt: 'desc' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
  }).then((leads) => leads.map(assignedForm));
}

export async function getLead(id: string) {
  const lead = await prisma.mesaLead.findUnique({ where: { id }, include: { ...leadInclude, ...assignedFormInclude } });
  if (!lead) throw new ApiError(404, 'not_found', 'MesaLead not found.');
  return assignedForm({ ...lead, quotes: lead.quotes.map(serializeQuote), fulfillment: serializeFulfillment(lead.fulfillment) });
}

export async function getAttachmentDownload(id: string) {
  const attachment = await prisma.leadAttachment.findUnique({
    where: { id },
    select: { bytes: true, mimeType: true, originalName: true, sizeBytes: true },
  });
  if (!attachment) throw new ApiError(404, 'not_found', 'Lead attachment not found.');
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(attachment.mimeType)) {
    throw new ApiError(409, 'attachment_unavailable', 'This attachment cannot be downloaded.');
  }
  return { ...attachment, bytes: Buffer.from(attachment.bytes) };
}

export async function createLead(input: LeadCreateInput) {
  const ctx = context();
  if (input.stage === 'lost' && !input.lostReason) {
    throw new ApiError(422, 'lost_reason_required', 'A lost lead requires a reason.');
  }
  if (input.linkExpiresAt && new Date(input.linkExpiresAt) <= new Date()) {
    throw new ApiError(422, 'invalid_expiry', 'Link expiry must be in the future.');
  }
  await validateOwner(ctx.organizationId, input.ownerMembershipId);
  return tenantTx(async (tx) => {
    const forms = await tx.$queryRaw<Array<{ id: string; name: string; revision: number; status: string }>>`
      SELECT "id", "name", "revision", "status"
      FROM "LeadForm"
      WHERE "id" = ${input.formId} AND "organizationId" = ${ctx.organizationId}
      FOR SHARE
    `;
    const form = forms[0];
    if (!form) throw new ApiError(422, 'invalid_form', 'That questionnaire template does not exist in this organization.');
    if (form.status !== 'published') throw new ApiError(409, 'form_not_published', 'Select a published questionnaire template.');
    const lead = await tx.mesaLead.create({
      data: {
        ...leadWriteData(input),
        stage: 'questionnaire_sent',
        organizationId: ctx.organizationId,
        reference: nextReference(),
      },
    });
    const link = await createLinkRecord(tx as typeof basePrisma, ctx.organizationId, input.formId, {
      kind: 'invitation',
      leadId: lead.id,
      ...(input.linkExpiresAt ? { expiresAt: input.linkExpiresAt } : {}),
    });
    await tx.leadActivity.create({
      data: {
        organizationId: ctx.organizationId,
        leadId: lead.id,
        type: 'lead_created',
        title: 'Lead created',
        actorUserId: ctx.userId,
        actorEmail: ctx.email,
      },
    });
    await tx.leadActivity.create({
      data: {
        organizationId: ctx.organizationId,
        leadId: lead.id,
        type: 'questionnaire_sent',
        title: 'Customer questionnaire link created',
        metadata: { formId: input.formId, linkId: link.id },
        actorUserId: ctx.userId,
        actorEmail: ctx.email,
      },
    });
    const created = await tx.mesaLead.findUniqueOrThrow({ where: { id: lead.id }, include: leadInclude });
    return {
      lead: { ...created, formId: form.id, form: { id: form.id, name: form.name, revision: form.revision, status: form.status } },
      link,
    };
  });
}

export async function updateLead(id: string, input: LeadUpdateInput) {
  const existing = await prisma.mesaLead.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, 'not_found', 'MesaLead not found.');
  const ctx = context();
  if (CLOSED_STAGES.has(existing.stage) && input.stage && input.stage !== existing.stage) {
    throw new ApiError(409, 'terminal_stage', 'Won and lost leads cannot be moved back into the open pipeline.');
  }
  if ((input.stage ?? existing.stage) === 'lost' && !(input.lostReason ?? existing.lostReason)) {
    throw new ApiError(422, 'lost_reason_required', 'A lost lead requires a reason.');
  }
  await validateOwner(ctx.organizationId, input.ownerMembershipId);
  return tenantTx(async (tx) => {
    const claimed = await tx.mesaLead.updateMany({
      where: { id, version: input.version },
      data: { ...leadWriteData(input), version: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw new ApiError(409, 'version_conflict', 'This lead changed since you opened it. Refresh and try again.');
    }
    if (input.stage && input.stage !== existing.stage) {
      await tx.leadActivity.create({
        data: {
          organizationId: ctx.organizationId,
          leadId: id,
          type: 'stage_change',
          title: `Stage changed to ${input.stage}`,
          metadata: { from: existing.stage, to: input.stage },
          actorUserId: ctx.userId,
          actorEmail: ctx.email,
        },
      });
    }
    const updated = await tx.mesaLead.findUniqueOrThrow({ where: { id }, include: { ...leadInclude, ...assignedFormInclude } });
    return assignedForm({ ...updated, quotes: updated.quotes.map(serializeQuote), fulfillment: serializeFulfillment(updated.fulfillment) });
  });
}

export async function addActivity(leadId: string, input: ActivityCreateInput) {
  const lead = await prisma.mesaLead.findUnique({ where: { id: leadId } });
  if (!lead) throw new ApiError(404, 'not_found', 'MesaLead not found.');
  const ctx = context();
  return tenantTx(async (tx) => {
    const activity = await tx.leadActivity.create({
      data: {
        organizationId: ctx.organizationId,
        leadId,
        type: input.type,
        title: input.title,
        note: input.note,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        metadata: input.type === 'customer_update' && input.nextUpdateAt
          ? { nextUpdateAt: input.nextUpdateAt }
          : {},
        actorUserId: ctx.userId,
        actorEmail: ctx.email,
      },
    });
    if (input.type !== 'customer_update' && input.nextFollowUpAt !== undefined) {
      await tx.mesaLead.update({
        where: { id: leadId },
        data: {
          ...(input.nextFollowUpAt !== undefined
            ? { nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null }
            : {}),
          version: { increment: 1 },
        },
      });
    }
    return activity;
  });
}

type QuoteLineInput = QuoteCreateInput['lineItems'][number];

function decimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(String(value));
}

function roundedMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function calculateQuote(lineItems: QuoteLineInput[]) {
  let subtotal = new Prisma.Decimal(0);
  let discountTotal = new Prisma.Decimal(0);
  let taxTotal = new Prisma.Decimal(0);
  const items = lineItems.map((item, sortOrder) => {
    const quantity = decimal(item.quantity);
    const unitPrice = decimal(item.unitPrice);
    const discountAmount = decimal(item.discountAmount);
    const taxRate = decimal(item.taxRate);
    if (taxRate.greaterThan(100)) throw new ApiError(422, 'invalid_tax_rate', 'Tax rate cannot exceed 100%.');
    const gross = roundedMoney(quantity.mul(unitPrice));
    if (discountAmount.greaterThan(gross)) {
      throw new ApiError(422, 'invalid_discount', `Discount exceeds the value of line item ${sortOrder + 1}.`);
    }
    const taxableAmount = roundedMoney(gross.minus(discountAmount));
    const taxAmount = roundedMoney(taxableAmount.mul(taxRate).div(100));
    const total = roundedMoney(taxableAmount.add(taxAmount));
    subtotal = subtotal.add(gross);
    discountTotal = discountTotal.add(discountAmount);
    taxTotal = taxTotal.add(taxAmount);
    return {
      sortOrder, description: item.description, specification: item.specification,
      hsnSacCode: item.hsnSacCode, quantity, unit: item.unit, unitPrice,
      discountAmount, taxRate, taxableAmount, taxAmount, total,
    };
  });
  return {
    items,
    subtotal: roundedMoney(subtotal), discountTotal: roundedMoney(discountTotal), taxTotal: roundedMoney(taxTotal),
    grandTotal: roundedMoney(subtotal.minus(discountTotal).add(taxTotal)),
  };
}

function quoteEventKey(action: string, key: string): string {
  return `quote:${action}:${key}`;
}

function requestHash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
    }
    return item;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function eventRequestHash(metadata: Prisma.JsonValue): string {
  const value = plainObject(metadata).requestHash;
  return typeof value === 'string' ? value : '';
}

async function idempotentQuoteEvent(tx: typeof basePrisma, organizationId: string, key: string) {
  return tx.leadQuoteEvent.findUnique({
    where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: key } },
    select: { quoteId: true, type: true, metadata: true },
  });
}

async function fetchQuote(tx: typeof basePrisma, quoteId: string) {
  const quote = await tx.leadQuote.findUnique({ where: { id: quoteId }, include: quoteInclude });
  if (!quote) throw new ApiError(404, 'not_found', 'Quotation not found.');
  return quote;
}

async function lockLead(tx: typeof basePrisma, leadId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; stage: string }>>`
    SELECT "id", "stage" FROM "MesaLead" WHERE "id" = ${leadId} FOR UPDATE
  `;
  if (!rows[0]) throw new ApiError(404, 'not_found', 'MesaLead not found.');
  return rows[0];
}

async function sendDraftQuote(
  tx: typeof basePrisma,
  organizationId: string,
  leadId: string,
  quoteId: string,
  input: QuoteTransitionInput,
) {
  const eventKey = quoteEventKey('send', input.idempotencyKey);
  const inputHash = requestHash({ operation: 'send', leadId, quoteId, input });
  const replay = await idempotentQuoteEvent(tx, organizationId, eventKey);
  if (replay) {
    if (replay.quoteId !== quoteId || replay.type !== 'sent' || eventRequestHash(replay.metadata) !== inputHash) throw new ApiError(409, 'idempotency_conflict', 'That idempotency key was used for another action or request body.');
    return fetchQuote(tx, quoteId);
  }
  await lockLead(tx, leadId);
  const locked = await tx.$queryRaw<Array<{ id: string; status: string; rowVersion: number; validUntil: Date | null; versionNumber: number; grandTotal: Prisma.Decimal }>>`
    SELECT "id", "status", "rowVersion", "validUntil", "versionNumber", "grandTotal"
    FROM "LeadQuote" WHERE "id" = ${quoteId} AND "leadId" = ${leadId} FOR UPDATE
  `;
  const quote = locked[0];
  if (!quote) throw new ApiError(404, 'not_found', 'Quotation not found.');
  if (quote.status !== 'draft') throw new ApiError(409, 'quote_immutable', 'Only a draft quotation can be sent.');
  if (quote.rowVersion !== input.rowVersion) throw new ApiError(409, 'version_conflict', 'This quotation changed. Refresh and try again.');
  if (quote.validUntil && quote.validUntil < new Date()) throw new ApiError(422, 'invalid_validity', 'A quotation cannot be sent after its validity date.');
  const approved = await tx.leadQuote.count({ where: { leadId, status: 'approved' } });
  if (approved) throw new ApiError(409, 'quotation_already_approved', 'This lead already has an approved quotation.');

  const superseded = await tx.leadQuote.findMany({ where: { leadId, status: { in: ['sent', 'revision_requested'] } }, select: { id: true } });
  if (superseded.length) {
    await tx.leadQuote.updateMany({ where: { id: { in: superseded.map((item) => item.id) } }, data: { status: 'superseded', rowVersion: { increment: 1 } } });
    await tx.leadQuoteEvent.createMany({
      data: superseded.map((item) => ({
        organizationId, leadId, quoteId: item.id, type: 'superseded', actorType: 'system',
        metadata: { supersededByQuoteId: quoteId },
      })),
    });
  }
  const now = new Date();
  const claimed = await tx.leadQuote.updateMany({
    where: { id: quoteId, leadId, status: 'draft', rowVersion: input.rowVersion },
    data: { status: 'sent', sentAt: now, rowVersion: { increment: 1 } },
  });
  if (claimed.count !== 1) throw new ApiError(409, 'version_conflict', 'This quotation changed. Refresh and try again.');
  await tx.leadQuoteEvent.create({
    data: { organizationId, leadId, quoteId, type: 'sent', actorType: 'organization', actorUserId: context().userId, actorEmail: context().email, idempotencyKey: eventKey, metadata: { requestHash: inputHash } },
  });
  await tx.leadActivity.create({
    data: { organizationId, leadId, type: 'quote_sent', title: `Quotation version ${quote.versionNumber} sent`, note: 'A quotation is ready for customer review.', metadata: { quoteId, versionNumber: quote.versionNumber }, actorUserId: context().userId, actorEmail: context().email, occurredAt: now },
  });
  await tx.mesaLead.update({
    where: { id: leadId },
    data: { stage: 'quotation', quotationStatus: 'sent', quotationAmount: Number(quote.grandTotal), version: { increment: 1 } },
  });
  return fetchQuote(tx, quoteId);
}

export async function createQuote(leadId: string, input: QuoteCreateInput) {
  const ctx = context();
  const createKey = quoteEventKey('create', input.idempotencyKey);
  const inputHash = requestHash({ operation: 'create', leadId, input });
  return tenantTx(async (tx) => {
    const existing = await tx.leadQuote.findUnique({
      where: { organizationId_createIdempotencyKey: { organizationId: ctx.organizationId, createIdempotencyKey: createKey } },
      include: quoteInclude,
    });
    if (existing) {
      if (existing.leadId !== leadId || existing.requestHash !== inputHash) throw new ApiError(409, 'idempotency_conflict', 'That idempotency key was used for another lead or request body.');
      return serializeQuote(existing);
    }
    await lockLead(tx, leadId);
    const approved = await tx.leadQuote.count({ where: { leadId, status: 'approved' } });
    if (approved) throw new ApiError(409, 'quotation_already_approved', 'This lead already has an approved quotation.');
    const latest = await tx.leadQuote.aggregate({ where: { leadId }, _max: { versionNumber: true } });
    const calculated = calculateQuote(input.lineItems);
    const quote = await tx.leadQuote.create({
      data: {
        organizationId: ctx.organizationId, leadId, versionNumber: (latest._max.versionNumber ?? 0) + 1,
        title: input.title, currency: input.currency, validUntil: dateOnly(input.validUntil), summary: input.summary,
        organizationRemarks: input.organizationRemarks, terms: input.terms as Prisma.InputJsonValue,
        subtotal: calculated.subtotal, discountTotal: calculated.discountTotal, taxTotal: calculated.taxTotal,
        grandTotal: calculated.grandTotal, createIdempotencyKey: createKey, requestHash: inputHash,
      },
    });
    await tx.leadQuoteLineItem.createMany({
      data: calculated.items.map((item) => ({ ...item, organizationId: ctx.organizationId, quoteId: quote.id })),
    });
    await tx.leadQuoteEvent.create({
      data: { organizationId: ctx.organizationId, leadId, quoteId: quote.id, type: 'created', actorType: 'organization', actorUserId: ctx.userId, actorEmail: ctx.email, idempotencyKey: createKey, metadata: { requestHash: inputHash } },
    });
    const result = input.send
      ? await sendDraftQuote(tx, ctx.organizationId, leadId, quote.id, { rowVersion: quote.rowVersion, idempotencyKey: input.idempotencyKey })
      : await fetchQuote(tx, quote.id);
    return serializeQuote(result);
  });
}

export async function updateQuote(leadId: string, quoteId: string, input: QuoteUpdateInput) {
  const ctx = context();
  return tenantTx(async (tx) => {
    await lockLead(tx, leadId);
    const locked = await tx.$queryRaw<Array<{ id: string; status: string; rowVersion: number }>>`
      SELECT "id", "status", "rowVersion" FROM "LeadQuote"
      WHERE "id" = ${quoteId} AND "leadId" = ${leadId} FOR UPDATE
    `;
    if (!locked[0]) throw new ApiError(404, 'not_found', 'Quotation not found.');
    if (locked[0].status !== 'draft') throw new ApiError(409, 'quote_immutable', 'Sent quotation versions are immutable. Create a revision instead.');
    if (locked[0].rowVersion !== input.rowVersion) throw new ApiError(409, 'version_conflict', 'This quotation changed. Refresh and try again.');
    const calculated = input.lineItems ? calculateQuote(input.lineItems) : null;
    if (calculated) {
      await tx.leadQuoteLineItem.deleteMany({ where: { quoteId } });
      await tx.leadQuoteLineItem.createMany({ data: calculated.items.map((item) => ({ ...item, organizationId: ctx.organizationId, quoteId })) });
    }
    const claimed = await tx.leadQuote.updateMany({
      where: { id: quoteId, leadId, status: 'draft', rowVersion: input.rowVersion },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.validUntil !== undefined ? { validUntil: dateOnly(input.validUntil) } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.organizationRemarks !== undefined ? { organizationRemarks: input.organizationRemarks } : {}),
        ...(input.terms !== undefined ? { terms: input.terms as Prisma.InputJsonValue } : {}),
        ...(calculated ? { subtotal: calculated.subtotal, discountTotal: calculated.discountTotal, taxTotal: calculated.taxTotal, grandTotal: calculated.grandTotal } : {}),
        rowVersion: { increment: 1 },
      },
    });
    if (claimed.count !== 1) throw new ApiError(409, 'version_conflict', 'This quotation changed. Refresh and try again.');
    await tx.leadQuoteEvent.create({ data: { organizationId: ctx.organizationId, leadId, quoteId, type: 'updated', actorType: 'organization', actorUserId: ctx.userId, actorEmail: ctx.email } });
    return serializeQuote(await fetchQuote(tx, quoteId));
  });
}

export async function sendQuote(leadId: string, quoteId: string, input: QuoteTransitionInput) {
  const ctx = context();
  return tenantTx(async (tx) => serializeQuote(await sendDraftQuote(tx, ctx.organizationId, leadId, quoteId, input)));
}

export async function reviseQuote(leadId: string, quoteId: string, input: QuoteTransitionInput) {
  const ctx = context();
  const createKey = quoteEventKey('revise', input.idempotencyKey);
  const inputHash = requestHash({ operation: 'revise', leadId, quoteId, input });
  return tenantTx(async (tx) => {
    const replay = await tx.leadQuote.findUnique({
      where: { organizationId_createIdempotencyKey: { organizationId: ctx.organizationId, createIdempotencyKey: createKey } },
      include: quoteInclude,
    });
    if (replay) {
      if (replay.leadId !== leadId || replay.sourceQuoteId !== quoteId || replay.requestHash !== inputHash) throw new ApiError(409, 'idempotency_conflict', 'That idempotency key was used for another action or request body.');
      return serializeQuote(replay);
    }
    await lockLead(tx, leadId);
    const source = await fetchQuote(tx, quoteId);
    if (source.leadId !== leadId) throw new ApiError(404, 'not_found', 'Quotation not found.');
    if (!['sent', 'revision_requested'].includes(source.status)) throw new ApiError(409, 'quote_not_revisable', 'Only a sent or revision-requested quotation can be revised.');
    if (source.rowVersion !== input.rowVersion) throw new ApiError(409, 'version_conflict', 'This quotation changed. Refresh and try again.');
    const latest = await tx.leadQuote.aggregate({ where: { leadId }, _max: { versionNumber: true } });
    const revision = await tx.leadQuote.create({
      data: {
        organizationId: ctx.organizationId, leadId, sourceQuoteId: source.id,
        versionNumber: (latest._max.versionNumber ?? source.versionNumber) + 1,
        title: source.title, currency: source.currency, validUntil: source.validUntil,
        summary: source.summary, organizationRemarks: source.organizationRemarks,
        terms: source.terms as Prisma.InputJsonValue, subtotal: source.subtotal,
        discountTotal: source.discountTotal, taxTotal: source.taxTotal, grandTotal: source.grandTotal,
        createIdempotencyKey: createKey, requestHash: inputHash,
      },
    });
    await tx.leadQuoteLineItem.createMany({
      data: source.lineItems.map((item) => ({
        organizationId: ctx.organizationId, quoteId: revision.id, sortOrder: item.sortOrder,
        description: item.description, specification: item.specification, hsnSacCode: item.hsnSacCode,
        quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice, discountAmount: item.discountAmount,
        taxRate: item.taxRate, taxableAmount: item.taxableAmount, taxAmount: item.taxAmount, total: item.total,
      })),
    });
    await tx.leadQuoteEvent.create({
      data: { organizationId: ctx.organizationId, leadId, quoteId: source.id, type: 'revised', actorType: 'organization', actorUserId: ctx.userId, actorEmail: ctx.email, idempotencyKey: createKey, metadata: { revisionQuoteId: revision.id, requestHash: inputHash } },
    });
    return serializeQuote(await fetchQuote(tx, revision.id));
  });
}

async function createDefaultMilestones(tx: typeof basePrisma, organizationId: string, leadId: string, fulfillmentId: string, keyPrefix: string) {
  const count = await tx.leadMilestone.count({ where: { fulfillmentId } });
  if (count) return;
  await tx.leadMilestone.createMany({
    data: DEFAULT_MILESTONES.map((name, sortOrder) => ({
      organizationId, leadId, fulfillmentId, name, sortOrder,
      createIdempotencyKey: `${keyPrefix}:${sortOrder}`,
    })),
  });
}

async function ensureDefaultFulfillment(tx: typeof basePrisma, organizationId: string, leadId: string, keyPrefix: string) {
  const fulfillment = await tx.leadFulfillment.upsert({
    where: { leadId },
    update: {},
    create: { organizationId, leadId, status: 'not_started', createIdempotencyKey: keyPrefix },
  });
  await createDefaultMilestones(tx, organizationId, leadId, fulfillment.id, keyPrefix);
  return tx.leadFulfillment.findUniqueOrThrow({ where: { id: fulfillment.id }, include: fulfillmentInclude });
}

export async function decidePublicQuote(token: string, quoteId: string, input: CustomerQuoteDecisionInput) {
  const resolved = await resolvePortalToken(token);
  const outcome = await withTenant(resolved.organizationId, async (tx) => {
    const entitlement = await tx.$queryRaw<Array<{ assignmentStatus: string; organizationStatus: string; serviceStatus: string }>>`
      SELECT os."status" AS "assignmentStatus", o."status" AS "organizationStatus", s."status" AS "serviceStatus"
      FROM "OrganizationService" os
      JOIN "Organization" o ON o."id" = os."organizationId"
      JOIN "Service" s ON s."id" = os."serviceId"
      WHERE os."organizationId" = ${resolved.organizationId} AND os."serviceId" = ${SERVICE_ID}
      FOR SHARE OF os, o, s
    `;
    if (entitlement[0]?.assignmentStatus !== 'active' || entitlement[0]?.organizationStatus === 'suspended' || entitlement[0]?.serviceStatus !== 'active') {
      throw new ApiError(403, 'service_not_enabled', 'MesaLeads is not active for this organization.');
    }
    if (resolved.kind === 'portal') {
      const portalRows = await tx.$queryRaw<Array<{ leadId: string; status: string; expiresAt: Date | null }>>`
        SELECT "leadId", "status", "expiresAt" FROM "LeadPortalLink"
        WHERE "id" = ${resolved.id} AND "organizationId" = ${resolved.organizationId} FOR SHARE
      `;
      const portal = portalRows[0];
      if (!portal || portal.leadId !== resolved.leadId || portal.status !== 'active' || (portal.expiresAt && portal.expiresAt <= new Date())) {
        throw new ApiError(410, 'link_unavailable', 'This customer journey link is no longer available.');
      }
    } else {
      const invitationRows = await tx.$queryRaw<Array<{ leadId: string | null; status: string; kind: string; expiresAt: Date | null }>>`
        SELECT "leadId", "status", "kind", "expiresAt" FROM "LeadFormLink"
        WHERE "id" = ${resolved.id} AND "organizationId" = ${resolved.organizationId} FOR SHARE
      `;
      const invitation = invitationRows[0];
      if (!invitation || invitation.kind !== 'invitation' || invitation.status !== 'submitted' || invitation.leadId !== resolved.leadId || (invitation.expiresAt && invitation.expiresAt <= new Date())) {
        throw new ApiError(410, 'link_unavailable', 'This customer journey link is no longer available.');
      }
    }
    await lockLead(tx, resolved.leadId);
    const eventType = input.decision === 'approve' ? 'approved' : 'revision_requested';
    const key = quoteEventKey('customer-decision', input.idempotencyKey);
    const inputHash = requestHash({ operation: 'customer-decision', leadId: resolved.leadId, quoteId, input });
    const replay = await idempotentQuoteEvent(tx, resolved.organizationId, key);
    if (replay) {
      if (replay.quoteId !== quoteId || replay.type !== eventType || eventRequestHash(replay.metadata) !== inputHash) throw new ApiError(409, 'idempotency_conflict', 'That idempotency key was used for another decision or request body.');
      return { mode: 'portal' as const, portal: await portalSnapshot(tx, resolved.organizationId, resolved.leadId) };
    }
    const verification = await consumeDecisionChallenge(tx, resolved.organizationId, resolved.leadId, input);
    if (verification.error) return { decisionError: verification.error } as const;
    const locked = await tx.$queryRaw<Array<{ id: string; leadId: string; status: string; rowVersion: number; validUntil: Date | null; versionNumber: number }>>`
      SELECT "id", "leadId", "status", "rowVersion", "validUntil", "versionNumber"
      FROM "LeadQuote" WHERE "id" = ${quoteId} AND "leadId" = ${resolved.leadId} FOR UPDATE
    `;
    const quote = locked[0];
    if (!quote) throw new ApiError(404, 'not_found', 'Quotation not found.');
    if (quote.status !== 'sent') throw new ApiError(409, 'quote_not_actionable', 'Only the current sent quotation can be decided.');
    if (quote.rowVersion !== input.quoteRowVersion) throw new ApiError(409, 'version_conflict', 'This quotation changed. Refresh and try again.');
    const now = new Date();
    if (input.decision === 'approve' && quote.validUntil && quote.validUntil < now) {
      throw new ApiError(409, 'quote_expired', 'This quotation has expired. Ask the organization for a revised quotation.');
    }
    const customerRemark = input.remark;
    const acceptance = input.decision === 'approve' ? ACCEPTANCE_TEXT : '';
    const claimed = await tx.leadQuote.updateMany({
      where: { id: quoteId, leadId: resolved.leadId, status: 'sent', rowVersion: input.quoteRowVersion },
      data: {
        status: input.decision === 'approve' ? 'approved' : 'revision_requested', customerRemark,
        acceptanceText: acceptance, acceptedByName: input.decision === 'approve' ? input.signerName : '',
        acceptedByEmail: input.decision === 'approve' ? input.signerEmail : '', decidedAt: now,
        rowVersion: { increment: 1 },
      },
    });
    if (claimed.count !== 1) throw new ApiError(409, 'version_conflict', 'This quotation changed. Refresh and try again.');
    await tx.leadQuoteEvent.create({
      data: {
        organizationId: resolved.organizationId, leadId: resolved.leadId, quoteId, type: eventType,
        actorType: 'customer', remark: customerRemark, idempotencyKey: key,
        metadata: input.decision === 'approve'
          ? { requestHash: inputHash, acceptanceConfirmed: true, acceptanceText: ACCEPTANCE_TEXT, signerName: input.signerName, signerEmail: input.signerEmail, verifiedEmailHash: verification.emailHash, verifiedAt: verification.verifiedAt.toISOString(), acceptedAt: now.toISOString() }
          : { requestHash: inputHash, verifiedEmailHash: verification.emailHash, verifiedAt: verification.verifiedAt.toISOString() },
      },
    });
    if (input.decision === 'approve') {
      await tx.mesaLead.update({ where: { id: resolved.leadId }, data: { stage: 'won', quotationStatus: 'approved', version: { increment: 1 } } });
      await ensureDefaultFulfillment(tx, resolved.organizationId, resolved.leadId, `quote-approval:${quoteId}`);
      await tx.leadActivity.create({ data: { organizationId: resolved.organizationId, leadId: resolved.leadId, type: 'quote_approved', title: `Quotation version ${quote.versionNumber} approved`, note: 'The quotation was approved and the order journey has started.', metadata: { quoteId }, occurredAt: now } });
    } else {
      await tx.mesaLead.update({ where: { id: resolved.leadId }, data: { stage: 'quotation', quotationStatus: 'revision_requested', version: { increment: 1 } } });
      await tx.leadActivity.create({ data: { organizationId: resolved.organizationId, leadId: resolved.leadId, type: 'quote_revision_requested', title: `Revision requested for quotation version ${quote.versionNumber}`, note: 'The customer requested a quotation revision.', metadata: { quoteId }, occurredAt: now } });
    }
    return { mode: 'portal' as const, portal: await portalSnapshot(tx, resolved.organizationId, resolved.leadId) };
  });
  if ('decisionError' in outcome) throw outcome.decisionError;
  return outcome;
}

export async function createFulfillment(leadId: string, input: FulfillmentCreateInput) {
  const ctx = context();
  const key = `fulfillment:create:${input.idempotencyKey}`;
  const inputHash = requestHash({ operation: 'fulfillment-create', leadId, input });
  return tenantTx(async (tx) => {
    await lockLead(tx, leadId);
    const replay = await tx.leadFulfillment.findUnique({ where: { organizationId_createIdempotencyKey: { organizationId: ctx.organizationId, createIdempotencyKey: key } }, include: fulfillmentInclude });
    if (replay) {
      if (replay.leadId !== leadId || replay.requestHash !== inputHash) throw new ApiError(409, 'idempotency_conflict', 'That idempotency key was used for another fulfillment or request body.');
      return serializeFulfillment(replay);
    }
    const existing = await tx.leadFulfillment.findUnique({ where: { leadId } });
    if (existing) throw new ApiError(409, 'fulfillment_exists', 'Fulfillment already exists for this lead.');
    const approved = await tx.leadQuote.count({ where: { leadId, status: 'approved' } });
    if (!approved) throw new ApiError(409, 'quotation_not_approved', 'Fulfillment starts only after the customer approves a quotation.');
    const now = new Date();
    const fulfillment = await tx.leadFulfillment.create({ data: {
      organizationId: ctx.organizationId, leadId, status: input.status, customerSummary: input.customerSummary,
      estimatedCompletionDate: dateOnly(input.estimatedCompletionDate), createIdempotencyKey: key, requestHash: inputHash,
      startedAt: input.status === 'in_progress' ? now : null, completedAt: input.status === 'completed' ? now : null,
    } });
    await createDefaultMilestones(tx, ctx.organizationId, leadId, fulfillment.id, key);
    return serializeFulfillment(await tx.leadFulfillment.findUniqueOrThrow({ where: { id: fulfillment.id }, include: fulfillmentInclude }));
  });
}

export async function updateFulfillment(leadId: string, input: FulfillmentUpdateInput) {
  const ctx = context();
  return tenantTx(async (tx) => {
    await lockLead(tx, leadId);
    const current = await tx.leadFulfillment.findUnique({ where: { leadId } });
    if (!current) throw new ApiError(404, 'not_found', 'Fulfillment not found.');
    if (current.rowVersion !== input.rowVersion) throw new ApiError(409, 'version_conflict', 'Fulfillment changed. Refresh and try again.');
    const now = new Date();
    const claimed = await tx.leadFulfillment.updateMany({ where: { id: current.id, rowVersion: input.rowVersion }, data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.customerSummary !== undefined ? { customerSummary: input.customerSummary } : {}),
      ...(input.estimatedCompletionDate !== undefined ? { estimatedCompletionDate: dateOnly(input.estimatedCompletionDate) } : {}),
      ...(input.status === 'in_progress' && !current.startedAt ? { startedAt: now } : {}),
      ...(input.status === 'completed' ? { completedAt: now } : input.status !== undefined ? { completedAt: null } : {}),
      rowVersion: { increment: 1 },
    } });
    if (claimed.count !== 1) throw new ApiError(409, 'version_conflict', 'Fulfillment changed. Refresh and try again.');
    if (input.status && input.status !== current.status) await tx.leadActivity.create({ data: { organizationId: ctx.organizationId, leadId, type: 'fulfillment_status', title: `Order status changed to ${input.status}`, note: input.customerSummary ?? current.customerSummary, metadata: {}, actorUserId: ctx.userId, actorEmail: ctx.email } });
    return serializeFulfillment(await tx.leadFulfillment.findUniqueOrThrow({ where: { id: current.id }, include: fulfillmentInclude }));
  });
}

export async function createMilestone(leadId: string, input: MilestoneCreateInput) {
  const ctx = context();
  const key = `milestone:create:${input.idempotencyKey}`;
  const inputHash = requestHash({ operation: 'milestone-create', leadId, input });
  return tenantTx(async (tx) => {
    await lockLead(tx, leadId);
    const replay = await tx.leadMilestone.findUnique({ where: { organizationId_createIdempotencyKey: { organizationId: ctx.organizationId, createIdempotencyKey: key } } });
    if (replay) {
      if (replay.leadId !== leadId || replay.requestHash !== inputHash) throw new ApiError(409, 'idempotency_conflict', 'That idempotency key was used for another milestone or request body.');
      return replay;
    }
    const fulfillment = await tx.leadFulfillment.findUnique({ where: { leadId } });
    if (!fulfillment) throw new ApiError(404, 'not_found', 'Fulfillment not found.');
    const max = input.sortOrder === undefined ? await tx.leadMilestone.aggregate({ where: { fulfillmentId: fulfillment.id }, _max: { sortOrder: true } }) : null;
    return tx.leadMilestone.create({ data: {
      organizationId: ctx.organizationId, leadId, fulfillmentId: fulfillment.id, name: input.name,
      sortOrder: input.sortOrder ?? ((max?._max.sortOrder ?? -1) + 1), targetDate: dateOnly(input.targetDate),
      customerNote: input.customerNote, createIdempotencyKey: key, requestHash: inputHash,
    } });
  });
}

export async function updateMilestone(leadId: string, milestoneId: string, input: MilestoneUpdateInput) {
  const ctx = context();
  return tenantTx(async (tx) => {
    await lockLead(tx, leadId);
    const current = await tx.leadMilestone.findFirst({ where: { id: milestoneId, leadId } });
    if (!current) throw new ApiError(404, 'not_found', 'Milestone not found.');
    if (current.rowVersion !== input.rowVersion) throw new ApiError(409, 'version_conflict', 'Milestone changed. Refresh and try again.');
    const now = new Date();
    const claimed = await tx.leadMilestone.updateMany({ where: { id: milestoneId, leadId, rowVersion: input.rowVersion }, data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.targetDate !== undefined ? { targetDate: dateOnly(input.targetDate) } : {}),
      ...(input.customerNote !== undefined ? { customerNote: input.customerNote } : {}),
      ...(input.status === 'completed' ? { completedAt: now } : input.status !== undefined ? { completedAt: null } : {}),
      rowVersion: { increment: 1 },
    } });
    if (claimed.count !== 1) throw new ApiError(409, 'version_conflict', 'Milestone changed. Refresh and try again.');
    const updated = await tx.leadMilestone.findUniqueOrThrow({ where: { id: milestoneId } });
    if (input.status && input.status !== current.status) await tx.leadActivity.create({ data: { organizationId: ctx.organizationId, leadId, type: 'milestone_status', title: `${updated.name}: ${input.status}`, note: updated.customerNote, metadata: { milestoneId }, actorUserId: ctx.userId, actorEmail: ctx.email } });
    return updated;
  });
}

export async function getSummary() {
  const [leads, submittedLeads] = await Promise.all([
    prisma.mesaLead.findMany({
      select: {
        id: true, reference: true, contactName: true, companyName: true, product: true,
        stage: true, quotationAmount: true, nextFollowUpAt: true, updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.leadSubmission.findMany({ select: { leadId: true }, distinct: ['leadId'] }),
  ]);
  const now = new Date();
  const stageTotals = leads.reduce<Record<string, { count: number; value: number }>>((out, lead) => {
    const bucket = out[lead.stage] ?? { count: 0, value: 0 };
    bucket.count += 1;
    bucket.value += lead.quotationAmount ?? 0;
    out[lead.stage] = bucket;
    return out;
  }, {});
  const byStage = leadStages.map((stage) => ({ stage, ...(stageTotals[stage] ?? { count: 0, value: 0 }) }));
  const open = leads.filter((lead) => !CLOSED_STAGES.has(lead.stage));
  const attention = open
    .filter((lead) => lead.nextFollowUpAt && lead.nextFollowUpAt < now)
    .map((lead) => ({ ...lead, reason: 'overdue_follow_up' as const }));
  return {
    kpis: {
      totalLeads: leads.length,
      openLeads: open.length,
      openPipelineValue: open.reduce((sum, lead) => sum + (lead.quotationAmount ?? 0), 0),
      wonLeads: leads.filter((lead) => lead.stage === 'won').length,
      lostLeads: leads.filter((lead) => lead.stage === 'lost').length,
      overdueFollowUps: attention.length,
      questionnaireCompletionRate: leads.length ? Math.round((submittedLeads.length / leads.length) * 10_000) / 100 : 0,
    },
    byStage,
    attention,
    recentLeads: leads.slice(0, 10),
  };
}

function equalAnswer(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function isQuestionVisible(question: LeadFormQuestion, answers: Record<string, unknown>): boolean {
  if (!question.visibilityRule || typeof question.visibilityRule !== 'object' || Array.isArray(question.visibilityRule)) return true;
  const rule = question.visibilityRule as { questionKey?: unknown; operator?: unknown; value?: unknown };
  if (typeof rule.questionKey !== 'string' || typeof rule.operator !== 'string') return true;
  const actual = answers[rule.questionKey];
  if (actual === undefined || actual === null || actual === '') return false;
  if (rule.operator === 'equals') return equalAnswer(actual, rule.value);
  if (rule.operator === 'not_equals') return !equalAnswer(actual, rule.value);
  if (rule.operator === 'contains') {
    if (Array.isArray(actual)) return actual.some((item) => equalAnswer(item, rule.value));
    return typeof actual === 'string' && typeof rule.value === 'string' && actual.includes(rule.value);
  }
  return false;
}

function answerMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function validateTypedAnswer(question: LeadFormQuestion, value: unknown): string | null {
  if (answerMissing(value)) return null;
  const options = Array.isArray(question.options) ? question.options.filter((item): item is string => typeof item === 'string') : [];
  const validation = question.validation && typeof question.validation === 'object' && !Array.isArray(question.validation)
    ? question.validation as { min?: number; max?: number; minLength?: number; maxLength?: number }
    : {};
  if (['short_text', 'long_text', 'email', 'phone', 'date'].includes(question.type) && typeof value !== 'string') return 'Must be text.';
  if (typeof value === 'string' && value.length > (question.type === 'long_text' ? 10_000 : 1_000)) return 'The answer is too long.';
  if (Array.isArray(value) && value.length > 100) return 'Too many options were selected.';
  if (question.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value as string)) return 'Enter a valid email address.';
  if (question.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value as string)) return 'Use a valid date in YYYY-MM-DD format.';
  if (question.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return 'Must be a number.';
  if (question.type === 'yes_no' && typeof value !== 'boolean') return 'Must be yes or no.';
  if (question.type === 'single_select' && (typeof value !== 'string' || !options.includes(value))) return 'Choose one of the available options.';
  if (question.type === 'multi_select' && (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !options.includes(item)))) return 'Choose only available options.';
  if (typeof value === 'string') {
    if (validation.minLength !== undefined && value.length < validation.minLength) return `Must be at least ${validation.minLength} characters.`;
    if (validation.maxLength !== undefined && value.length > validation.maxLength) return `Must be at most ${validation.maxLength} characters.`;
  }
  if (typeof value === 'number') {
    if (validation.min !== undefined && value < validation.min) return `Must be at least ${validation.min}.`;
    if (validation.max !== undefined && value > validation.max) return `Must be at most ${validation.max}.`;
  }
  return null;
}

function decodeUpload(upload: PublicSubmissionInput['attachments'][number]) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(upload.dataBase64)) {
    throw new ApiError(422, 'invalid_upload', `${upload.fileName} is not valid base64 data.`);
  }
  const bytes = Buffer.from(upload.dataBase64, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) {
    throw new ApiError(422, 'invalid_upload', `${upload.fileName} must be between 1 byte and 5 MB.`);
  }
  const detected = bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
    ? 'application/pdf'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? 'image/jpeg'
      : bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        ? 'image/png'
        : null;
  if (!detected || detected !== upload.mimeType) {
    throw new ApiError(422, 'invalid_upload', `${upload.fileName} content does not match its declared file type.`);
  }
  const extension = detected === 'application/pdf' ? 'pdf' : detected === 'image/png' ? 'png' : 'jpg';
  const suppliedName = upload.fileName.split(/[/\\]/).pop() || 'upload';
  const stem = suppliedName.replace(/\.[^.]*$/, '').replace(/[\r\n]/g, '_').slice(0, 180) || 'attachment';
  const originalName = `${stem}.${extension}`;
  return { bytes, mimeType: detected, originalName, storageName: `${randomUUID()}.${extension}` };
}

async function resolvePublicLink(token: string, options: { allowSubmittedInvitation?: boolean } = {}) {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new ApiError(404, 'not_found', 'Questionnaire link not found.');
  const link = await basePrisma.leadFormLink.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!link) throw new ApiError(404, 'not_found', 'Questionnaire link not found.');
  await assertMesaLeadsEntitlement(link.organizationId);
  if (link.status === 'revoked') throw new ApiError(410, 'link_revoked', 'This questionnaire link has been revoked.');
  if (link.kind === 'invitation' && link.status === 'submitted' && !options.allowSubmittedInvitation) {
    throw new ApiError(410, 'link_submitted', 'This questionnaire has already been submitted.');
  }
  if (link.expiresAt && link.expiresAt <= new Date()) throw new ApiError(410, 'link_expired', 'This questionnaire link has expired.');
  return link;
}

function dateOnly(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(`${value}T23:59:59.999Z`);
}

type SafeProfile = {
  legalName: string;
  brandName: string;
  summary: string;
  website: string;
  emails: string[];
  phones: string[];
  contact: { name: string; title: string };
  address: { line1: string; line2: string; city: string; state: string; postalCode: string; country: string };
  capabilities: string[];
  branding: { logoUrl: string; primaryColor: string };
};

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeList(value: unknown, maxItems: number, maxLength: number): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').slice(0, maxItems).map((item) => item.trim().slice(0, maxLength)).filter(Boolean)
    : [];
}

function projectProfile(settings: Prisma.JsonValue, fallbackName: string): SafeProfile {
  const profile = plainObject(plainObject(settings).mesaLeadsProfile);
  const contact = plainObject(profile.contact);
  const address = plainObject(profile.address);
  const branding = plainObject(profile.branding);
  const color = safeText(branding.primaryColor, 16);
  return {
    legalName: safeText(profile.legalName, 200) || fallbackName,
    brandName: safeText(profile.brandName, 160) || fallbackName,
    summary: safeText(profile.summary, 2_000),
    website: safeText(profile.website, 500),
    emails: safeList(profile.emails, 10, 254),
    phones: safeList(profile.phones, 10, 40),
    contact: { name: safeText(contact.name, 160), title: safeText(contact.title, 160) },
    address: {
      line1: safeText(address.line1, 300), line2: safeText(address.line2, 300),
      city: safeText(address.city, 120), state: safeText(address.state, 120),
      postalCode: safeText(address.postalCode, 32), country: safeText(address.country, 120),
    },
    capabilities: safeList(profile.capabilities, 50, 300),
    branding: {
      logoUrl: safeText(branding.logoUrl, 1_000),
      primaryColor: /^#[0-9a-f]{6}$/i.test(color) ? color : '#12385B',
    },
  };
}

function serializeDecimal(value: Prisma.Decimal): string {
  return value.toFixed(value.decimalPlaces());
}

function serializeQuote<T extends {
  subtotal: Prisma.Decimal; discountTotal: Prisma.Decimal; taxTotal: Prisma.Decimal; grandTotal: Prisma.Decimal;
  lineItems: Array<{
    quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; discountAmount: Prisma.Decimal; taxRate: Prisma.Decimal;
    taxableAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; total: Prisma.Decimal;
  }>;
}>(quote: T) {
  const record = quote as T & { organizationId?: string; createIdempotencyKey?: string | null; requestHash?: string };
  const { organizationId: _organizationId, createIdempotencyKey: _idempotency, requestHash: _requestHash, ...safeQuote } = record;
  return {
    ...safeQuote,
    subtotal: serializeDecimal(quote.subtotal),
    discountTotal: serializeDecimal(quote.discountTotal),
    taxTotal: serializeDecimal(quote.taxTotal),
    grandTotal: serializeDecimal(quote.grandTotal),
    lineItems: quote.lineItems.map((item) => {
      const recordItem = item as typeof item & { organizationId?: string };
      const { organizationId: _itemOrganizationId, ...safeItem } = recordItem;
      return {
      ...safeItem,
      quantity: serializeDecimal(item.quantity), unitPrice: serializeDecimal(item.unitPrice),
      discountAmount: serializeDecimal(item.discountAmount), taxRate: serializeDecimal(item.taxRate),
      taxableAmount: serializeDecimal(item.taxableAmount), taxAmount: serializeDecimal(item.taxAmount),
      total: serializeDecimal(item.total),
    };
    }),
  };
}

function serializeFulfillment<T extends {
  id: string; leadId: string; status: string; customerSummary: string; estimatedCompletionDate: Date | null;
  startedAt: Date | null; completedAt: Date | null; rowVersion: number; createdAt: Date; updatedAt: Date;
  milestones: Array<{
    id: string; name: string; sortOrder: number; status: string; targetDate: Date | null; completedAt: Date | null;
    customerNote: string; rowVersion: number; createdAt: Date; updatedAt: Date;
  }>;
}>(fulfillment: T | null) {
  if (!fulfillment) return null;
  return {
    id: fulfillment.id, leadId: fulfillment.leadId, status: fulfillment.status,
    customerSummary: fulfillment.customerSummary,
    estimatedCompletionDate: fulfillment.estimatedCompletionDate,
    startedAt: fulfillment.startedAt, completedAt: fulfillment.completedAt,
    rowVersion: fulfillment.rowVersion, createdAt: fulfillment.createdAt, updatedAt: fulfillment.updatedAt,
    milestones: fulfillment.milestones.map((milestone) => ({
      id: milestone.id, name: milestone.name, sortOrder: milestone.sortOrder, status: milestone.status,
      targetDate: milestone.targetDate, completedAt: milestone.completedAt, customerNote: milestone.customerNote,
      rowVersion: milestone.rowVersion, createdAt: milestone.createdAt, updatedAt: milestone.updatedAt,
    })),
  };
}

type PublicQuoteSource = {
  id: string; versionNumber: number; status: string; title: string; currency: string; validUntil: Date | null;
  summary: string; organizationRemarks: string; subtotal: Prisma.Decimal; discountTotal: Prisma.Decimal; taxTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal; rowVersion: number; sentAt: Date | null; decidedAt: Date | null; customerRemark: string;
  terms: Prisma.JsonValue;
  lineItems: Array<{
    description: string; specification: string; hsnSacCode: string; quantity: Prisma.Decimal; unit: string; unitPrice: Prisma.Decimal;
    discountAmount: Prisma.Decimal; taxRate: Prisma.Decimal; taxableAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; total: Prisma.Decimal;
  }>;
};

function publicQuote(quote: PublicQuoteSource) {
  return {
    quoteActionId: quote.id,
    versionNumber: quote.versionNumber,
    status: quote.status,
    title: quote.title,
    currency: quote.currency,
    validUntil: quote.validUntil,
    summary: quote.summary,
    customerMessage: quote.organizationRemarks,
    subtotal: serializeDecimal(quote.subtotal),
    discountTotal: serializeDecimal(quote.discountTotal),
    taxTotal: serializeDecimal(quote.taxTotal),
    grandTotal: serializeDecimal(quote.grandTotal),
    quoteRowVersion: quote.rowVersion,
    sentAt: quote.sentAt,
    decidedAt: quote.decidedAt,
    customerRemark: quote.customerRemark,
    terms: quote.terms,
    lineItems: quote.lineItems.map((item) => ({
      description: item.description, specification: item.specification, hsnSacCode: item.hsnSacCode,
      quantity: serializeDecimal(item.quantity), unit: item.unit, unitPrice: serializeDecimal(item.unitPrice),
      discountAmount: serializeDecimal(item.discountAmount), taxRate: serializeDecimal(item.taxRate),
      taxableAmount: serializeDecimal(item.taxableAmount), taxAmount: serializeDecimal(item.taxAmount), total: serializeDecimal(item.total),
    })),
  };
}

function publicFulfillment<T extends ReturnType<typeof serializeFulfillment>>(fulfillment: T) {
  if (!fulfillment) return null;
  return {
    status: fulfillment.status,
    customerSummary: fulfillment.customerSummary,
    estimatedCompletionDate: fulfillment.estimatedCompletionDate,
    startedAt: fulfillment.startedAt,
    completedAt: fulfillment.completedAt,
    updatedAt: fulfillment.updatedAt,
    milestones: fulfillment.milestones.map((milestone) => ({
      publicId: milestone.id,
      name: milestone.name,
      sortOrder: milestone.sortOrder,
      status: milestone.status,
      targetDate: milestone.targetDate,
      completedAt: milestone.completedAt,
      customerNote: milestone.customerNote,
      updatedAt: milestone.updatedAt,
    })),
  };
}

function reviewStatus(quotes: Array<{ status: string }>, leadStage: string): 'pending' | 'in_review' | 'quoted' | 'revision_requested' | 'approved' | 'closed' {
  if (leadStage === 'lost') return 'closed';
  if (quotes.some((quote) => quote.status === 'approved')) return 'approved';
  if (quotes.some((quote) => quote.status === 'revision_requested')) return 'revision_requested';
  if (quotes.some((quote) => quote.status === 'sent')) return 'quoted';
  if (quotes.some((quote) => quote.status === 'draft')) return 'in_review';
  return ['technical_review', 'mold_sourcing', 'quotation', 'follow_up', 'won'].includes(leadStage) ? 'in_review' : 'pending';
}

async function portalSnapshot(tx: typeof basePrisma, organizationId: string, leadId: string) {
  const [organization, lead, quotes, fulfillment, timeline] = await Promise.all([
    tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, slug: true, settings: true } }),
    tx.mesaLead.findUnique({ where: { id: leadId }, select: { id: true, reference: true, product: true, stage: true, createdAt: true } }),
    tx.leadQuote.findMany({
      where: { leadId, status: { not: 'draft' } },
      include: quoteInclude,
      orderBy: { versionNumber: 'desc' },
    }),
    tx.leadFulfillment.findUnique({ where: { leadId }, include: fulfillmentInclude }),
    tx.leadActivity.findMany({
      where: { leadId, type: { in: ['questionnaire_submitted', 'quote_sent', 'quote_revision_requested', 'quote_approved', 'fulfillment_status', 'milestone_status', 'customer_update'] } },
      select: { id: true, type: true, title: true, note: true, metadata: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' }, take: 100,
    }),
  ]);
  if (!organization || !lead) throw new ApiError(404, 'not_found', 'Customer journey not found.');
  const status = reviewStatus(quotes, lead.stage);
  const messages = {
    pending: 'Your request has been received and is pending organization review.',
    in_review: 'The organization is reviewing your request and preparing its response.',
    quoted: 'A quotation is ready for your review.',
    revision_requested: 'Your requested changes are with the organization for review.',
    approved: 'Your quotation is approved. Track fulfillment progress below.',
    closed: 'This request has been closed. Contact the organization if you need more information.',
  } as const;
  return {
    organization: { name: organization.name, profile: projectProfile(organization.settings, organization.name) },
    lead: { reference: lead.reference, product: lead.product, status: lead.stage },
    review: { status, message: messages[status], updatedAt: timeline[0]?.occurredAt ?? lead.createdAt },
    decision: {
      decisionAllowed: customerDecisionsConfigured(),
      verificationRequired: true,
      challengePath: '/api/public/mesaleads/portal/{token}/decision-challenges',
      unavailableMessage: customerDecisionsConfigured() ? '' : 'Online acceptance is not configured. Please contact the organization.',
    },
    quotes: quotes.map(publicQuote),
    fulfillment: publicFulfillment(serializeFulfillment(fulfillment)),
    timeline: timeline.map((event, index) => {
      const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? event.metadata as Record<string, unknown>
        : {};
      return {
        sequence: index + 1, type: event.type, title: event.title, message: event.note, occurredAt: event.occurredAt,
        ...(event.type === 'customer_update' && typeof metadata.nextUpdateAt === 'string'
          ? { nextUpdateAt: metadata.nextUpdateAt }
          : {}),
      };
    }),
  };
}

async function resolvePortalToken(token: string) {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new ApiError(404, 'not_found', 'Customer journey link not found.');
  const digest = tokenHash(token);
  const portal = await basePrisma.leadPortalLink.findUnique({ where: { tokenHash: digest } });
  if (portal) {
    await assertMesaLeadsEntitlement(portal.organizationId);
    if (portal.status === 'revoked') throw new ApiError(410, 'link_revoked', 'This customer journey link has been revoked.');
    if (portal.expiresAt && portal.expiresAt <= new Date()) throw new ApiError(410, 'link_expired', 'This customer journey link has expired.');
    return { id: portal.id, organizationId: portal.organizationId, leadId: portal.leadId, kind: 'portal' as const };
  }
  const link = await basePrisma.leadFormLink.findUnique({ where: { tokenHash: digest } });
  if (!link || link.kind !== 'invitation' || link.status !== 'submitted' || !link.leadId) throw new ApiError(404, 'not_found', 'Customer journey link not found.');
  await assertMesaLeadsEntitlement(link.organizationId);
  if (link.expiresAt && link.expiresAt <= new Date()) throw new ApiError(410, 'link_expired', 'This customer journey link has expired.');
  return { id: link.id, organizationId: link.organizationId, leadId: link.leadId, kind: 'invitation' as const };
}

export async function getPublicPortal(token: string) {
  const resolved = await resolvePortalToken(token);
  return withTenant(resolved.organizationId, async (tx) => {
    const entitlement = await tx.$queryRaw<Array<{ assignmentStatus: string; organizationStatus: string; serviceStatus: string }>>`
      SELECT os."status" AS "assignmentStatus", o."status" AS "organizationStatus", s."status" AS "serviceStatus"
      FROM "OrganizationService" os
      JOIN "Organization" o ON o."id" = os."organizationId"
      JOIN "Service" s ON s."id" = os."serviceId"
      WHERE os."organizationId" = ${resolved.organizationId} AND os."serviceId" = ${SERVICE_ID}
      FOR SHARE OF os, o, s
    `;
    if (entitlement[0]?.assignmentStatus !== 'active' || entitlement[0]?.organizationStatus === 'suspended' || entitlement[0]?.serviceStatus !== 'active') {
      throw new ApiError(403, 'service_not_enabled', 'MesaLeads is not active for this organization.');
    }
    const checkedAt = new Date();
    if (resolved.kind === 'portal') {
      // The conditional UPDATE is both the access recheck and the row lock. It
      // serializes concurrent opens without a SHARE -> UPDATE lock upgrade and
      // re-evaluates the predicate if a concurrent revocation wins first.
      const portals = await tx.$queryRaw<Array<{ leadId: string }>>`
        UPDATE "LeadPortalLink"
        SET "lastOpenedAt" = ${checkedAt}, "updatedAt" = ${checkedAt}
        WHERE "id" = ${resolved.id}
          AND "organizationId" = ${resolved.organizationId}
          AND "leadId" = ${resolved.leadId}
          AND "status" = 'active'
          AND ("expiresAt" IS NULL OR "expiresAt" > ${checkedAt})
        RETURNING "leadId"
      `;
      if (!portals[0]) throw new ApiError(410, 'link_unavailable', 'This customer journey link is no longer available.');
    } else {
      const invitations = await tx.$queryRaw<Array<{ leadId: string | null; kind: string; status: string; expiresAt: Date | null }>>`
        SELECT "leadId", "kind", "status", "expiresAt"
        FROM "LeadFormLink"
        WHERE "id" = ${resolved.id} AND "organizationId" = ${resolved.organizationId}
        FOR SHARE
      `;
      const invitation = invitations[0];
      if (!invitation || invitation.leadId !== resolved.leadId || invitation.kind !== 'invitation'
        || invitation.status !== 'submitted' || (invitation.expiresAt && invitation.expiresAt <= checkedAt)) {
        throw new ApiError(410, 'link_unavailable', 'This customer journey link is no longer available.');
      }
    }
    return { mode: 'portal' as const, portal: await portalSnapshot(tx, resolved.organizationId, resolved.leadId) };
  });
}

function decisionSecret(): string {
  const secret = process.env.MESALEADS_DECISION_CODE_SECRET;
  if (!secret || secret.length < 32) {
    throw new ApiError(503, 'decision_verification_unavailable', 'Online quotation decisions are not configured. Please contact the organization.');
  }
  return secret;
}

function decisionDeliveryMode(): 'webhook' | 'development' | null {
  const secretReady = Boolean(process.env.MESALEADS_DECISION_CODE_SECRET && process.env.MESALEADS_DECISION_CODE_SECRET!.length >= 32);
  if (!secretReady) return null;
  if (process.env.MESALEADS_DECISION_WEBHOOK_URL) return 'webhook';
  const nonProduction = process.env.NODE_ENV !== 'production';
  if (nonProduction && /^\d{6}$/.test(process.env.MESALEADS_DECISION_TEST_CODE || '')) return 'development';
  return null;
}

export function customerDecisionsConfigured(): boolean {
  return decisionDeliveryMode() !== null;
}

function keyedHash(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export async function createDecisionChallenge(token: string, input: CustomerDecisionChallengeInput) {
  const responseNotBefore = Date.now() + 200;
  const secret = decisionSecret();
  const deliveryMode = decisionDeliveryMode();
  if (!deliveryMode) throw new ApiError(503, 'decision_verification_unavailable', 'Online quotation decisions are not configured. Please contact the organization.');
  const resolved = await resolvePortalToken(token);
  return withTenant(resolved.organizationId, async (tx) => {
    const submission = await tx.leadSubmission.findFirst({
      where: { leadId: resolved.leadId },
      select: { respondentEmail: true, lead: { select: { email: true, reference: true } } },
      orderBy: { submittedAt: 'desc' },
    });
    const expectedEmail = (submission?.respondentEmail || submission?.lead.email || '').trim().toLowerCase();
    const suppliedEmail = input.email.trim().toLowerCase();
    const matches = Boolean(expectedEmail) && keyedHash(secret, expectedEmail) === keyedHash(secret, suppliedEmail);
    const testCode = process.env.MESALEADS_DECISION_TEST_CODE;
    const code = deliveryMode === 'development' ? testCode as string : String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
    if (matches) {
      await tx.leadDecisionChallenge.create({
        data: {
          id, organizationId: resolved.organizationId, leadId: resolved.leadId,
          emailHash: keyedHash(secret, suppliedEmail), codeHash: keyedHash(secret, `${id}:${code}`), expiresAt,
        },
      });
      if (deliveryMode === 'webhook') {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3_000);
        try {
          const response = await fetch(process.env.MESALEADS_DECISION_WEBHOOK_URL!, {
            method: 'POST', signal: controller.signal,
            headers: {
              'content-type': 'application/json',
              ...(process.env.MESALEADS_DECISION_WEBHOOK_BEARER ? { authorization: `Bearer ${process.env.MESALEADS_DECISION_WEBHOOK_BEARER}` } : {}),
            },
            body: JSON.stringify({ recipient: suppliedEmail, template: 'mesaleads_quote_decision_code', code, reference: submission?.lead.reference || '', expiresInMinutes: 10 }),
          });
          if (!response.ok) throw new Error(`verification webhook returned ${response.status}`);
        } catch (error) {
          await tx.leadDecisionChallenge.delete({ where: { id } });
          console.error('[mesaleads] decision challenge delivery failed', error instanceof Error ? error.message : 'unknown error');
        } finally {
          clearTimeout(timeout);
        }
      }
    }
    const remaining = responseNotBefore - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    return {
      accepted: true, challengeId: id, expiresAt,
      ...(deliveryMode === 'development' ? { devVerificationCode: code } : {}),
    };
  });
}

async function consumeDecisionChallenge(
  tx: typeof basePrisma,
  organizationId: string,
  leadId: string,
  input: CustomerQuoteDecisionInput,
) {
  const secret = decisionSecret();
  const rows = await tx.$queryRaw<Array<{ id: string; leadId: string; emailHash: string; codeHash: string; attempts: number; expiresAt: Date; usedAt: Date | null }>>`
    SELECT "id", "leadId", "emailHash", "codeHash", "attempts", "expiresAt", "usedAt"
    FROM "LeadDecisionChallenge"
    WHERE "id" = ${input.challengeId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;
  const challenge = rows[0];
  const now = new Date();
  const suppliedHash = keyedHash(secret, `${input.challengeId}:${input.verificationCode}`);
  if (!challenge || challenge.leadId !== leadId || challenge.usedAt || challenge.expiresAt <= now || challenge.attempts >= 5) {
    throw new ApiError(409, 'verification_invalid', 'The verification challenge is invalid or expired.');
  }
  if (challenge.codeHash !== suppliedHash) {
    await tx.leadDecisionChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    return { error: new ApiError(422, 'verification_invalid', 'The verification code is invalid.') } as const;
  }
  if (input.signerEmail && challenge.emailHash !== keyedHash(secret, input.signerEmail.trim().toLowerCase())) {
    throw new ApiError(422, 'verification_identity_mismatch', 'Signer email must match the verified email address.');
  }
  await tx.leadDecisionChallenge.update({ where: { id: challenge.id }, data: { usedAt: now } });
  return { emailHash: challenge.emailHash, verifiedAt: now, error: null } as const;
}

export async function getPublicForm(token: string) {
  let link;
  try {
    link = await resolvePublicLink(token);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'link_submitted') return getPublicPortal(token);
    throw error;
  }
  const organization = await basePrisma.organization.findUnique({
    where: { id: link.organizationId },
    select: { id: true, name: true, slug: true, status: true },
  });
  if (!organization || organization.status === 'suspended') throw new ApiError(404, 'not_found', 'Questionnaire link not found.');
  return withTenant(link.organizationId, async (tx) => {
    const form = await tx.leadForm.findUnique({
      where: { id: link.formId },
      select: {
        id: true, name: true, description: true, privacyNotice: true, revision: true,
        status: true,
        questions: {
          select: {
            key: true, type: true, label: true, helpText: true, placeholder: true,
            required: true, options: true, validation: true, visibilityRule: true, sortOrder: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!form || form.status !== 'published') throw new ApiError(410, 'form_unavailable', 'This questionnaire is no longer available.');
    const lead = link.leadId
      ? await tx.mesaLead.findUnique({
          where: { id: link.leadId },
          select: { contactName: true, phone: true, email: true, companyName: true, companyAddress: true, gstNumber: true, product: true, requirement: true, scope: true },
        })
      : null;
    const valuesByQuestionKey: Record<string, string | undefined> = lead ? {
      customer_name: lead.contactName,
      contact_name: lead.contactName,
      contact_number: lead.phone,
      phone: lead.phone,
      email: lead.email,
      company_name: lead.companyName,
      company_address: lead.companyAddress,
      factory_location: lead.companyAddress,
      gstin: lead.gstNumber,
      gst_number: lead.gstNumber,
      product: lead.product,
      product_details: lead.product,
      requirement: lead.requirement,
      additional_notes: lead.requirement,
      requirement_scope: lead.scope,
      scope: lead.scope,
    } : {};
    // A bearer invitation must not disclose the whole lead record. Only send
    // values for explicit questions on this published revision.
    const prefill = Object.fromEntries(form.questions.flatMap((question) => {
      if (!['short_text', 'long_text', 'email', 'phone', 'single_select'].includes(question.type)) return [];
      const value = valuesByQuestionKey[question.key];
      if (value === undefined || value === '') return [];
      if (question.type === 'single_select'
        && (!Array.isArray(question.options) || !question.options.includes(value))) return [];
      return [[question.key, value]];
    }));
    await tx.leadFormLink.updateMany({ where: { id: link.id, status: 'active', openedAt: null }, data: { openedAt: new Date() } });
    return {
      mode: 'form' as const,
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
      form: { ...form, status: undefined },
      prefill,
      link: { kind: link.kind, expiresAt: link.expiresAt },
    };
  });
}

function textAnswer(answers: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) if (typeof answers[key] === 'string') return (answers[key] as string).trim();
  return '';
}

export async function submitPublicForm(token: string, input: PublicSubmissionInput) {
  const resolved = await resolvePublicLink(token, { allowSubmittedInvitation: true });
  const submittedAt = new Date();
  return withTenant(resolved.organizationId, async (tx) => {
    // Lock the entitlement rows so Stop/unassign/suspend waits for any accepted
    // submission to finish. Once a control action returns, no older submission
    // can commit behind it.
    const entitlements = await tx.$queryRaw<Array<{
      assignmentStatus: string;
      organizationStatus: string;
      serviceStatus: string;
    }>>`
      SELECT os."status" AS "assignmentStatus",
             o."status" AS "organizationStatus",
             s."status" AS "serviceStatus"
      FROM "OrganizationService" os
      JOIN "Organization" o ON o."id" = os."organizationId"
      JOIN "Service" s ON s."id" = os."serviceId"
      WHERE os."organizationId" = ${resolved.organizationId}
        AND os."serviceId" = ${SERVICE_ID}
      FOR SHARE OF os, o, s
    `;
    const entitlement = entitlements[0];
    if (entitlement?.assignmentStatus !== 'active' || entitlement.organizationStatus === 'suspended' || entitlement.serviceStatus !== 'active') {
      throw new ApiError(403, 'service_not_enabled', 'MesaLeads is not active for this organization.');
    }
    // Generic submissions share the row lock, so customers can submit in
    // parallel while revoke/archive still waits. Invitations use an exclusive
    // lock because they are one-use.
    type LockedLink = {
      id: string;
      organizationId: string;
      formId: string;
      leadId: string | null;
      kind: string;
      status: string;
      expiresAt: Date | null;
    };
    const links = resolved.kind === 'invitation'
      ? await tx.$queryRaw<LockedLink[]>`
          SELECT "id", "organizationId", "formId", "leadId", "kind", "status", "expiresAt"
          FROM "LeadFormLink"
          WHERE "id" = ${resolved.id}
            AND "organizationId" = ${resolved.organizationId}
          FOR UPDATE
        `
      : await tx.$queryRaw<LockedLink[]>`
          SELECT "id", "organizationId", "formId", "leadId", "kind", "status", "expiresAt"
          FROM "LeadFormLink"
          WHERE "id" = ${resolved.id}
            AND "organizationId" = ${resolved.organizationId}
          FOR SHARE
        `;
    const link = links[0];
    if (!link || link.status === 'revoked') throw new ApiError(410, 'link_revoked', 'This questionnaire link has been revoked.');
    // Serialize only matching retry keys. Different customers (and different
    // generic links) continue concurrently.
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS "locked"
      FROM pg_advisory_xact_lock(hashtext(${link.id}), hashtext(${input.submissionKey}))
    `;
    const existingSubmission = await tx.leadSubmission.findFirst({
      where: { linkId: link.id, clientSubmissionId: input.submissionKey },
      select: { id: true, leadId: true, lead: { select: { reference: true } } },
    });
    if (existingSubmission) {
      const replayToken = resolved.kind === 'generic' ? submissionPortalToken(resolved.id, input.submissionKey) : token;
      const journeyPath = `/mesaleads/q/${replayToken}`;
      return {
        reference: existingSubmission.lead.reference,
        leadId: existingSubmission.leadId,
        submissionId: existingSubmission.id,
        status: 'submitted' as const,
        ...(resolved.kind === 'generic' ? { portalToken: replayToken } : {}),
        portalPath: journeyPath,
        journeyPath,
        portal: await portalSnapshot(tx, resolved.organizationId, existingSubmission.leadId),
      };
    }
    if (link.expiresAt && link.expiresAt <= submittedAt) throw new ApiError(410, 'link_expired', 'This questionnaire link has expired.');
    if (link.kind === 'invitation' && link.status !== 'active') throw new ApiError(410, 'link_submitted', 'This questionnaire has already been submitted.');

    const form = await tx.leadForm.findUnique({
      where: { id: link.formId },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!form || form.status !== 'published') throw new ApiError(410, 'form_unavailable', 'This questionnaire is no longer available.');

    const questionByKey = new Map(form.questions.map((question) => [question.key, question]));
    const errors: Record<string, string> = {};
    const sanitizedAnswers: Record<string, unknown> = {};
    for (const key of Object.keys(input.answers)) {
      if (!questionByKey.has(key)) errors[key] = 'This question does not belong to the published form.';
    }
    for (const question of form.questions) {
      if (question.type === 'section' || question.type === 'file') continue;
      // Questions are ordered and may depend only on an earlier key. Evaluate
      // against accepted visible answers so hidden-parent values cannot unlock
      // or persist a grandchild branch.
      const visible = isQuestionVisible(question, sanitizedAnswers);
      const value = input.answers[question.key];
      if (!visible) continue;
      if (question.required && answerMissing(value)) errors[question.key] = 'This question is required.';
      const typeError = validateTypedAnswer(question, value);
      if (typeError) errors[question.key] = typeError;
      if (!answerMissing(value)) sanitizedAnswers[question.key] = value;
    }

    const preparedUploads = input.attachments.map((upload) => {
      const question = questionByKey.get(upload.questionKey);
      if (!question || question.type !== 'file') {
        errors[upload.questionKey] = 'This file does not belong to an upload question.';
        return null;
      }
      if (!isQuestionVisible(question, sanitizedAnswers)) {
        errors[upload.questionKey] = 'Files cannot be submitted for a hidden question.';
        return null;
      }
      return { upload, decoded: decodeUpload(upload) };
    });
    for (const question of form.questions) {
      if (question.type === 'file' && question.required && isQuestionVisible(question, sanitizedAnswers)
        && !input.attachments.some((file) => file.questionKey === question.key)) {
        errors[question.key] = 'A file is required.';
      }
    }
    if (Object.keys(errors).length) throw new ApiError(422, 'invalid_answers', 'Please correct the questionnaire answers.', { fieldErrors: errors });

    // This conditional update is the one-time invitation lock. Concurrent
    // submissions serialize on the link row; exactly one can claim it.
    if (link.kind === 'invitation') {
      const durableJourneyExpiry = new Date(submittedAt.getTime() + 365 * 24 * 60 * 60 * 1_000);
      const claimed = await tx.leadFormLink.updateMany({
        where: { id: link.id, status: 'active' },
        data: {
          status: 'submitted',
          usedAt: submittedAt,
          expiresAt: link.expiresAt && link.expiresAt > durableJourneyExpiry ? link.expiresAt : durableJourneyExpiry,
        },
      });
      if (claimed.count !== 1) throw new ApiError(410, 'link_submitted', 'This questionnaire has already been submitted.');
    }

    const respondent = input.respondent;
    const contactName = respondent.name || textAnswer(sanitizedAnswers, 'customer_name', 'contact_name');
    const phone = respondent.phone || textAnswer(sanitizedAnswers, 'contact_number', 'phone');
    const email = respondent.email || textAnswer(sanitizedAnswers, 'email');
    const scopeAnswer = textAnswer(sanitizedAnswers, 'requirement_scope', 'scope');
    const scope = ['machine_only', 'machine_mold', 'mold_only'].includes(scopeAnswer) ? scopeAnswer : undefined;
    const captured = {
      contactName, phone, email,
      companyName: textAnswer(sanitizedAnswers, 'company_name'),
      companyAddress: textAnswer(sanitizedAnswers, 'company_address', 'factory_location'),
      gstNumber: textAnswer(sanitizedAnswers, 'gstin', 'gst_number'),
      product: textAnswer(sanitizedAnswers, 'product', 'product_details'),
      requirement: textAnswer(sanitizedAnswers, 'additional_notes', 'requirement'),
    };
    const nonEmptyCaptured = Object.fromEntries(Object.entries(captured).filter(([, value]) => value !== '')) as Partial<typeof captured>;
    const leadData = {
      ...nonEmptyCaptured,
      ...(scope ? { scope } : {}),
      consentedAt: submittedAt,
    };
    let lead;
    if (link.leadId) {
      await tx.mesaLead.update({
        where: { id: link.leadId },
        data: { ...leadData, version: { increment: 1 } },
      });
      await tx.mesaLead.updateMany({
        where: { id: link.leadId, stage: { in: ['new', 'discovery', 'questionnaire_sent'] } },
        data: { stage: 'requirements_received', version: { increment: 1 } },
      });
      lead = await tx.mesaLead.findUniqueOrThrow({ where: { id: link.leadId } });
    } else {
      lead = await tx.mesaLead.create({
          data: {
            ...leadData,
            ...captured,
            stage: 'requirements_received',
            version: 0,
            organizationId: link.organizationId,
            reference: nextReference(),
            source: 'public_form',
            scope: scope ?? 'machine_only',
          },
        });
    }

    const snapshot = form.questions.map((question) => ({
      key: question.key,
      type: question.type,
      label: question.label,
      helpText: question.helpText,
      required: question.required,
      options: question.options,
      validation: question.validation,
      visibilityRule: question.visibilityRule,
      sortOrder: question.sortOrder,
    }));
    const submission = await tx.leadSubmission.create({
      data: {
        organizationId: link.organizationId,
        formId: form.id,
        leadId: lead.id,
        linkId: link.id,
        clientSubmissionId: input.submissionKey,
        formRevision: form.revision,
        respondentName: respondent.name,
        respondentEmail: respondent.email,
        respondentPhone: respondent.phone,
        answers: sanitizedAnswers as Prisma.InputJsonValue,
        questionSnapshot: snapshot as Prisma.InputJsonValue,
        consentTextSnapshot: form.privacyNotice,
        consentedAt: submittedAt,
        submittedAt,
      },
    });
    const uploads = preparedUploads.filter((item): item is NonNullable<typeof item> => item !== null);
    if (uploads.length) {
      await tx.leadAttachment.createMany({
        data: uploads.map(({ upload, decoded }) => ({
          organizationId: link.organizationId,
          leadId: lead.id,
          submissionId: submission.id,
          questionKey: upload.questionKey,
          originalName: decoded.originalName,
          storageName: decoded.storageName,
          mimeType: decoded.mimeType,
          sizeBytes: decoded.bytes.length,
          bytes: decoded.bytes,
        })),
      });
    }
    await tx.leadActivity.create({
      data: {
        organizationId: link.organizationId,
        leadId: lead.id,
        type: 'questionnaire_submitted',
        title: 'Customer questionnaire submitted',
        metadata: { formId: form.id, submissionId: submission.id, linkKind: link.kind },
        actorEmail: respondent.email,
        occurredAt: submittedAt,
      },
    });
    let portalToken: string | undefined;
    let journeyToken = token;
    if (link.kind === 'generic') {
      portalToken = submissionPortalToken(link.id, input.submissionKey);
      journeyToken = portalToken;
      await tx.leadPortalLink.create({
        data: {
          tokenHash: tokenHash(portalToken), organizationId: link.organizationId, leadId: lead.id,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000),
        },
      });
    }
    const journeyPath = `/mesaleads/q/${journeyToken}`;
    return {
      reference: lead.reference, leadId: lead.id, submissionId: submission.id, status: 'submitted' as const,
      ...(portalToken ? { portalToken } : {}),
      portalPath: journeyPath,
      journeyPath,
      portal: await portalSnapshot(tx, resolved.organizationId, lead.id),
    };
  });
}
