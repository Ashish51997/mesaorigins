import { z } from 'zod';

const optionalPan = z.string().trim().transform((value) => value.toUpperCase())
  .refine((value) => value === '' || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value), 'Use a valid PAN or leave it blank.');
const optionalGstin = z.string().trim().transform((value) => value.toUpperCase())
  .refine((value) => value === '' || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value), 'Use a valid GSTIN or leave it blank.');

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(80).default(''),
  email: z.string().trim().email().max(200).or(z.literal('')).default(''),
  phone: z.string().trim().max(30).default(''),
}).strict();

const addressSchema = z.object({
  kind: z.enum(['registered', 'billing', 'shipping', 'plant', 'other']).default('registered'),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).default(''),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(3).max(12),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).default('IN'),
}).strict();

export const vendorCreateSchema = z.object({
  vendorCode: z.string().trim().min(2).max(30).transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z0-9][A-Z0-9_-]*$/.test(value), 'Use an uppercase alphanumeric vendor code.'),
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().max(200).default(''),
  pan: optionalPan.default(''),
  gstin: optionalGstin.default(''),
  msmeNumber: z.string().trim().max(80).default(''),
  addresses: z.array(addressSchema).max(20).default([]),
  contacts: z.array(contactSchema).max(30).default([]),
  categories: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  plantCoverage: z.array(z.string().trim().min(1).max(128)).max(100).default([]),
  geographyCoverage: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  paymentTerms: z.string().trim().max(120).default(''),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default('INR'),
  creditDays: z.number().int().min(0).max(3650).default(0),
  taxClassification: z.string().trim().max(100).default(''),
  tdsClassification: z.string().trim().max(100).default(''),
}).strict();
export type VendorCreate = z.infer<typeof vendorCreateSchema>;

export const vendorLifecycleStatusSchema = z.enum([
  'invited', 'onboarding', 'under_review', 'approved', 'conditionally_approved', 'suspended', 'blocked',
]);
export type VendorLifecycleStatus = z.infer<typeof vendorLifecycleStatusSchema>;

export const vendorLifecycleTransitionSchema = z.object({
  to: vendorLifecycleStatusSchema,
  reason: z.string().trim().max(1000).default(''),
  expectedRowVersion: z.number().int().min(0),
}).strict().superRefine((value, ctx) => {
  if (['conditionally_approved', 'suspended', 'blocked'].includes(value.to) && value.reason.length < 5) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A meaningful reason is required for this decision.' });
  }
});
export type VendorLifecycleTransition = z.infer<typeof vendorLifecycleTransitionSchema>;

export const vendorBankCreateSchema = z.object({
  accountHolderName: z.string().trim().min(2).max(200),
  bankName: z.string().trim().min(2).max(200),
  accountNumber: z.string().trim().regex(/^\d{6,34}$/, 'Use 6–34 account-number digits.'),
  confirmAccountNumber: z.string().trim().regex(/^\d{6,34}$/),
  ifsc: z.string().trim().transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(value), 'Use a valid IFSC.'),
  branch: z.string().trim().max(160).default(''),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default('INR'),
}).strict().superRefine((value, ctx) => {
  if (value.accountNumber !== value.confirmAccountNumber) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmAccountNumber'], message: 'Account numbers do not match.' });
  }
});
export type VendorBankCreate = z.infer<typeof vendorBankCreateSchema>;

export const vendorBankVerifySchema = z.object({
  decision: z.enum(['verified', 'rejected']),
  verificationReference: z.string().trim().min(3).max(160),
  reason: z.string().trim().max(1000).default(''),
  expectedRowVersion: z.number().int().min(0),
}).strict().superRefine((value, ctx) => {
  if (value.decision === 'rejected' && value.reason.length < 5) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A rejection reason is required.' });
  }
});
export type VendorBankVerify = z.infer<typeof vendorBankVerifySchema>;

const optionalInstant = z.string().datetime({ offset: true }).optional();

export const roleAssignmentCreateSchema = z.object({
  membershipId: z.string().trim().min(1).max(128),
  roleId: z.string().trim().min(1).max(128),
  validFrom: optionalInstant,
  validTo: optionalInstant,
}).strict().superRefine((value, ctx) => {
  if (value.validFrom && value.validTo && new Date(value.validTo) <= new Date(value.validFrom)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['validTo'], message: 'validTo must be later than validFrom.' });
  }
});
export type RoleAssignmentCreate = z.infer<typeof roleAssignmentCreateSchema>;

export const roleAssignmentRevokeSchema = z.object({
  rowVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(5).max(1000),
}).strict();
export type RoleAssignmentRevoke = z.infer<typeof roleAssignmentRevokeSchema>;

export const rolePermissionsReplaceSchema = z.object({
  expectedRoleVersion: z.number().int().nonnegative(),
  grants: z.array(z.string().trim().regex(/^mesaerp\.[a-z0-9_.]+$/)).max(100),
}).strict().transform((value) => ({ ...value, grants: [...new Set(value.grants)].sort() }));
export type RolePermissionsReplace = z.infer<typeof rolePermissionsReplaceSchema>;

export const erpRoleCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  grants: z.array(z.string().trim().regex(/^mesaerp\.[a-z0-9_.]+$/)).max(100).default([]),
}).strict().transform((value) => ({ ...value, grants: [...new Set(value.grants)].sort() }));
export type ErpRoleCreate = z.infer<typeof erpRoleCreateSchema>;
