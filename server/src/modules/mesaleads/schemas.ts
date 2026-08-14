import { z } from 'zod';

export const leadStages = [
  'new',
  'discovery',
  'questionnaire_sent',
  'requirements_received',
  'technical_review',
  'mold_sourcing',
  'quotation',
  'follow_up',
  'won',
  'lost',
] as const;

export const leadStageSchema = z.enum(leadStages);
export const leadScopeSchema = z.enum(['machine_only', 'machine_mold', 'mold_only']);

export const questionTypes = [
  'section',
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'date',
  'single_select',
  'multi_select',
  'yes_no',
  'file',
] as const;

export const questionTypeSchema = z.enum(questionTypes);

const visibilityValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.array(z.union([z.string().max(500), z.number().finite(), z.boolean()])).max(100),
]);

const visibilityRuleSchema = z.object({
  questionKey: z.string().trim().min(1),
  operator: z.enum(['equals', 'not_equals', 'contains']),
  value: visibilityValueSchema,
});

const questionValidationSchema = z.object({
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().max(10_000).optional(),
}).strict();

export const formQuestionSchema = z.object({
  key: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, 'Use lower-case letters, numbers and underscores.').optional(),
  type: questionTypeSchema,
  label: z.string().trim().min(1).max(240),
  helpText: z.string().trim().max(1_000).default(''),
  placeholder: z.string().trim().max(240).default(''),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  validation: questionValidationSchema.default({}),
  visibilityRule: visibilityRuleSchema.nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
}).superRefine((question, ctx) => {
  if (question.type === 'section' && question.required) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['required'], message: 'A section cannot be required.' });
  }
  if (['single_select', 'multi_select'].includes(question.type) && question.options.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Choice questions need at least one option.' });
  }
});

const formFields = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).default(''),
  privacyNotice: z.string().trim().min(1).max(2_000).default('Your information will be used by this organization to review and respond to your enquiry.'),
  questions: z.array(formQuestionSchema).min(1).max(200),
};

export const formCreateSchema = z.object(formFields);
export type FormCreateInput = z.infer<typeof formCreateSchema>;

export const formUpdateSchema = z.object({
  name: formFields.name.optional(),
  description: z.string().trim().max(2_000).optional(),
  privacyNotice: z.string().trim().min(1).max(2_000).optional(),
  questions: formFields.questions.optional(),
}).refine((input) => Object.keys(input).length > 0, 'At least one field is required.');
export type FormUpdateInput = z.infer<typeof formUpdateSchema>;

const optionalText = (max = 2_000) => z.string().trim().max(max).optional();
const nullableMoney = z.number().finite().nonnegative().nullable().optional();

const leadFields = {
  source: z.string().trim().min(1).max(80).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  stage: leadStageSchema.optional(),
  contactName: optionalText(160),
  phone: optionalText(40),
  email: z.string().trim().email().or(z.literal('')).optional(),
  companyName: optionalText(200),
  companyAddress: optionalText(2_000),
  gstNumber: optionalText(32),
  product: optionalText(300),
  requirement: optionalText(5_000),
  scope: leadScopeSchema.optional(),
  ownerMembershipId: z.string().trim().min(1).nullable().optional(),
  machineRecommendation: optionalText(1_000),
  clampTonnage: z.number().finite().positive().nullable().optional(),
  shotCapacity: z.number().finite().positive().nullable().optional(),
  moldStatus: optionalText(80),
  moldSupplier: optionalText(200),
  moldQuoteAmount: nullableMoney,
  quotationAmount: nullableMoney,
  quotationStatus: optionalText(80),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
  followUpNote: optionalText(2_000),
  lostReason: optionalText(1_000),
  orderReference: optionalText(160),
};

export const leadCreateSchema = z.object(leadFields).extend({
  formId: z.string().trim().min(1),
  linkExpiresAt: z.string().datetime({ offset: true }).optional(),
  source: z.string().trim().min(1).max(80).default('direct'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  stage: leadStageSchema.default('new'),
  scope: leadScopeSchema.default('machine_only'),
});
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

export const leadUpdateSchema = z.object({
  ...leadFields,
  version: z.number().int().nonnegative(),
}).refine((input) => Object.keys(input).some((key) => key !== 'version'), 'At least one field besides version is required.');
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;

export const activityCreateSchema = z.object({
  type: z.enum(['call', 'email', 'whatsapp', 'meeting', 'note', 'stage_change', 'questionnaire_sent', 'quotation', 'customer_update']),
  title: z.string().trim().min(1).max(240),
  note: z.string().trim().max(5_000).default(''),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
  nextUpdateAt: z.string().datetime({ offset: true }).nullable().optional(),
}).superRefine((input, ctx) => {
  if (input.type === 'customer_update' && input.nextFollowUpAt !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nextFollowUpAt'], message: 'Use nextUpdateAt for a customer-visible update.' });
  }
  if (input.type !== 'customer_update' && input.nextUpdateAt !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nextUpdateAt'], message: 'nextUpdateAt is only available for customer-visible updates.' });
  }
});
export type ActivityCreateInput = z.infer<typeof activityCreateSchema>;

export const formLinkCreateSchema = z.object({
  kind: z.enum(['generic', 'invitation']).default('generic'),
  leadId: z.string().trim().min(1).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
}).superRefine((input, ctx) => {
  if (input.kind === 'invitation' && !input.leadId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['leadId'], message: 'An invitation link requires a lead.' });
  }
  if (input.kind === 'generic' && input.leadId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['leadId'], message: 'A generic link cannot target one lead.' });
  }
});
export type FormLinkCreateInput = z.infer<typeof formLinkCreateSchema>;

const uploadSchema = z.object({
  questionKey: z.string().trim().min(1).max(64),
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  dataBase64: z.string().min(1).max(7_100_000),
});

// JSON/base64 uploads are intentionally bounded as one request, not only per
// file. Ten MiB of binary data expands to just under fourteen million base64
// characters; keeping the aggregate below that ceiling prevents five valid
// files from multiplying the public parser's memory footprint.
const MAX_PUBLIC_UPLOAD_BASE64_CHARS = 14_000_000;

const publicAnswerValueSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(500)).max(100),
]);

export const publicSubmissionSchema = z.object({
  submissionKey: z.string().trim().min(16).max(128)
    .regex(/^[A-Za-z0-9_-]+$/, 'Submission key contains invalid characters.'),
  respondent: z.object({
    name: z.string().trim().max(160).default(''),
    email: z.string().trim().email().or(z.literal('')).default(''),
    phone: z.string().trim().max(40).default(''),
  }).default({ name: '', email: '', phone: '' }),
  answers: z.record(publicAnswerValueSchema)
    .refine((answers) => Object.keys(answers).length <= 250, 'Too many answers.')
    .refine((answers) => Object.keys(answers).every((key) => /^[a-z][a-z0-9_]{0,63}$/.test(key)), 'Answer keys are invalid.')
    .default({}),
  attachments: z.array(uploadSchema).max(5).default([]),
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required before submission.' }) }),
}).superRefine((input, ctx) => {
  const encodedCharacters = input.attachments.reduce((total, attachment) => total + attachment.dataBase64.length, 0);
  if (encodedCharacters > MAX_PUBLIC_UPLOAD_BASE64_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['attachments'],
      message: 'Attachments must be 10 MB or smaller in total.',
    });
  }
});
export type PublicSubmissionInput = z.infer<typeof publicSubmissionSchema>;

const idempotencyKeySchema = z.string().trim().min(16).max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Idempotency key contains invalid characters.');
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const decimalInputSchema = z.union([
  z.string().trim().regex(/^\d{1,15}(?:\.\d{1,4})?$/, 'Use a non-negative decimal amount.'),
  z.number().finite().nonnegative(),
]);

const quoteTermSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(2_000),
}).strict();

const quoteLineItemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  specification: z.string().trim().max(5_000).default(''),
  hsnSacCode: z.string().trim().max(32).default(''),
  quantity: decimalInputSchema,
  unit: z.string().trim().min(1).max(32).default('nos'),
  unitPrice: decimalInputSchema,
  discountAmount: decimalInputSchema.default('0'),
  taxRate: decimalInputSchema.default('0'),
}).strict();

const quoteEditableFields = {
  title: z.string().trim().min(1).max(240),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('INR'),
  validUntil: dateOnlySchema.nullable().optional(),
  summary: z.string().trim().max(5_000).default(''),
  organizationRemarks: z.string().trim().max(5_000).default(''),
  terms: z.array(quoteTermSchema).max(50).default([]),
  lineItems: z.array(quoteLineItemSchema).min(1).max(200),
};

export const quoteCreateSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  ...quoteEditableFields,
  send: z.boolean().default(false),
}).strict();
export type QuoteCreateInput = z.infer<typeof quoteCreateSchema>;

export const quoteUpdateSchema = z.object({
  rowVersion: z.number().int().nonnegative(),
  title: quoteEditableFields.title.optional(),
  currency: quoteEditableFields.currency.optional(),
  validUntil: quoteEditableFields.validUntil,
  summary: z.string().trim().max(5_000).optional(),
  organizationRemarks: z.string().trim().max(5_000).optional(),
  terms: quoteEditableFields.terms.optional(),
  lineItems: quoteEditableFields.lineItems.optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), 'At least one editable field is required.');
export type QuoteUpdateInput = z.infer<typeof quoteUpdateSchema>;

export const quoteTransitionSchema = z.object({
  rowVersion: z.number().int().nonnegative(),
  idempotencyKey: idempotencyKeySchema,
}).strict();
export type QuoteTransitionInput = z.infer<typeof quoteTransitionSchema>;

export const customerQuoteDecisionSchema = z.object({
  decision: z.enum(['approve', 'request_revision']),
  remark: z.string().trim().max(5_000).default(''),
  idempotencyKey: idempotencyKeySchema,
  quoteRowVersion: z.number().int().nonnegative(),
  acceptanceConfirmed: z.boolean().default(false),
  signerName: z.string().trim().max(160).default(''),
  signerEmail: z.string().trim().email().or(z.literal('')).default(''),
  challengeId: z.string().trim().min(20).max(128),
  verificationCode: z.string().trim().regex(/^\d{6}$/, 'Enter the six-digit verification code.'),
}).strict().superRefine((input, ctx) => {
  if (input.decision === 'request_revision' && !input.remark) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['remark'], message: 'Explain the requested revision.' });
  }
  if (input.decision === 'approve') {
    if (!input.acceptanceConfirmed) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['acceptanceConfirmed'], message: 'Explicit acceptance is required.' });
    if (!input.signerName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['signerName'], message: 'Signer name is required.' });
    if (!input.signerEmail) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['signerEmail'], message: 'Signer email is required.' });
  }
});
export type CustomerQuoteDecisionInput = z.infer<typeof customerQuoteDecisionSchema>;

export const customerDecisionChallengeSchema = z.object({
  email: z.string().trim().email(),
}).strict();
export type CustomerDecisionChallengeInput = z.infer<typeof customerDecisionChallengeSchema>;

export const fulfillmentCreateSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  status: z.enum(['not_started', 'in_progress', 'on_hold', 'completed', 'cancelled']).default('not_started'),
  customerSummary: z.string().trim().max(5_000).default(''),
  estimatedCompletionDate: dateOnlySchema.nullable().optional(),
}).strict();
export type FulfillmentCreateInput = z.infer<typeof fulfillmentCreateSchema>;

export const fulfillmentUpdateSchema = z.object({
  rowVersion: z.number().int().nonnegative(),
  status: z.enum(['not_started', 'in_progress', 'on_hold', 'completed', 'cancelled']).optional(),
  customerSummary: z.string().trim().max(5_000).optional(),
  estimatedCompletionDate: dateOnlySchema.nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), 'At least one editable field is required.');
export type FulfillmentUpdateInput = z.infer<typeof fulfillmentUpdateSchema>;

export const milestoneCreateSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  name: z.string().trim().min(1).max(240),
  sortOrder: z.number().int().nonnegative().optional(),
  targetDate: dateOnlySchema.nullable().optional(),
  customerNote: z.string().trim().max(5_000).default(''),
}).strict();
export type MilestoneCreateInput = z.infer<typeof milestoneCreateSchema>;

export const milestoneUpdateSchema = z.object({
  rowVersion: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(240).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  status: z.enum(['pending', 'in_progress', 'blocked', 'completed', 'cancelled']).optional(),
  targetDate: dateOnlySchema.nullable().optional(),
  customerNote: z.string().trim().max(5_000).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), 'At least one editable field is required.');
export type MilestoneUpdateInput = z.infer<typeof milestoneUpdateSchema>;
