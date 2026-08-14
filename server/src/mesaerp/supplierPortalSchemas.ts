import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO date (YYYY-MM-DD).')
  .refine((value) => new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, 'Use a valid calendar date.');
const isoDateTime = z.string().datetime({ offset: true });
const id = z.string().trim().min(1).max(128);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default('');
const jsonObject = z.record(z.string(), z.unknown());
const quantity = z.string().max(19).regex(/^\d{1,12}(?:\.\d{1,6})?$/)
  .refine((value) => /[1-9]/.test(value), 'Quantity must be greater than zero.');
const money = z.string().max(19).regex(/^\d{1,16}(?:\.\d{1,2})?$/);
const positiveMoney = money.refine((value) => /[1-9]/.test(value), 'Amount must be greater than zero.');
const rate = z.string().max(20).regex(/^\d{1,12}(?:\.\d{1,6})?$/);
const taxRate = z.string().max(8).regex(/^(?:100(?:\.0{1,4})?|\d{1,2}(?:\.\d{1,4})?)$/);
const checksum = z.string().regex(/^[a-f0-9]{64}$/, 'Use a lowercase SHA-256 checksum.');

export const rowVersionSchema = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
}).strict();

export const rfqCreateSchema = z.object({
  rfqNumber: text(100),
  title: text(200),
  description: optionalText(3000),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default('INR'),
  responseDueAt: isoDateTime,
  commercialTerms: jsonObject.default({}),
  technicalTerms: jsonObject.default({}),
  invitedVendorIds: z.array(id).min(1).max(100),
  lines: z.array(z.object({
    itemId: id.optional(),
    description: text(500),
    quantity,
    uom: text(30),
    requiredOn: isoDate.optional(),
    technicalSpecification: jsonObject.default({}),
  }).strict()).min(1).max(250),
}).strict();
export type RfqCreate = z.infer<typeof rfqCreateSchema>;

export const rfqIssueSchema = rowVersionSchema.extend({ note: optionalText(1000) }).strict();
export type RfqIssue = z.infer<typeof rfqIssueSchema>;

export const rfqSelectSchema = rowVersionSchema.extend({
  quotationId: id,
  selectionReason: text(2000),
  agreement: z.object({
    agreementNumber: text(100),
    validFrom: isoDate,
    validUntil: isoDate,
    terms: jsonObject.default({}),
  }).strict().optional(),
}).strict();
export type RfqSelect = z.infer<typeof rfqSelectSchema>;

export const agreementActivateSchema = rowVersionSchema.extend({ reason: text(1000) }).strict();
export type AgreementActivate = z.infer<typeof agreementActivateSchema>;

export const portalInviteCreateSchema = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  name: text(160),
  expiresInHours: z.number().int().min(1).max(168).default(48),
  permissions: z.array(z.enum([
    'supplier.profile.request_change', 'supplier.documents.write', 'supplier.rfq.respond',
    'supplier.po.respond', 'supplier.asn.write', 'supplier.invoice.evidence.write',
    'supplier.dispute.respond', 'supplier.payment.read',
  ])).min(1).max(8),
}).strict();
export type PortalInviteCreate = z.infer<typeof portalInviteCreateSchema>;

export const vendorDocumentCreateSchema = z.object({
  documentType: text(80), documentNumber: optionalText(120),
  issuedOn: isoDate.optional(), expiresOn: isoDate.optional(),
  storageRef: text(1000), checksum, metadata: jsonObject.default({}),
}).strict();
export type VendorDocumentCreate = z.infer<typeof vendorDocumentCreateSchema>;

export const vendorDocumentReviewSchema = rowVersionSchema.extend({
  decision: z.enum(['verified', 'rejected']), reason: text(1000),
}).strict();
export type VendorDocumentReview = z.infer<typeof vendorDocumentReviewSchema>;

export const vendorChangeDecisionSchema = rowVersionSchema.extend({
  decision: z.enum(['approved', 'rejected']), reason: text(2000),
}).strict();
export type VendorChangeDecision = z.infer<typeof vendorChangeDecisionSchema>;

export const disputeCreateSchema = z.object({
  vendorId: id, supplierInvoiceId: id.optional(), matchCaseId: id.optional(),
  subject: text(200), description: text(4000), requestedDebitAmount: money.default('0'),
}).strict();
export type DisputeCreate = z.infer<typeof disputeCreateSchema>;

export const disputeResolveSchema = rowVersionSchema.extend({
  decision: z.enum(['resolved', 'rejected']), resolution: text(4000),
}).strict();
export type DisputeResolve = z.infer<typeof disputeResolveSchema>;

export const paymentProposalCreateSchema = z.object({
  vendorId: id, supplierInvoiceId: id, proposalNumber: text(100), amount: positiveMoney,
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default('INR'),
  proposedPaymentOn: isoDate, payableAccountId: id, settlementAccountId: id,
  narration: optionalText(2000),
}).strict();
export type PaymentProposalCreate = z.infer<typeof paymentProposalCreateSchema>;

export const paymentProposalApproveSchema = rowVersionSchema.extend({
  voucherDate: isoDate, reason: text(1000),
}).strict();
export type PaymentProposalApprove = z.infer<typeof paymentProposalApproveSchema>;

export const portalInviteAcceptSchema = z.object({ token: z.string().trim().min(32).max(256) }).strict();
export type PortalInviteAccept = z.infer<typeof portalInviteAcceptSchema>;

export const portalChangeCreateSchema = z.object({
  changeType: z.enum(['profile', 'legal', 'gstin', 'bank']),
  proposedValues: jsonObject.refine((value) => Object.keys(value).length > 0, 'At least one proposed value is required.'),
}).strict();
export type PortalChangeCreate = z.infer<typeof portalChangeCreateSchema>;

export const supplierQuotationCreateSchema = z.object({
  quotationNumber: text(100),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default('INR'),
  validUntil: isoDate, promisedOn: isoDate.optional(),
  commercialResponse: jsonObject.default({}), technicalResponse: jsonObject.default({}),
  lines: z.array(z.object({
    rfqLineId: id, quantity, unitRate: rate, taxRate: taxRate.default('0'),
    taxAmount: money.optional(), promisedOn: isoDate.optional(), technicalResponse: jsonObject.default({}),
  }).strict()).min(1).max(250),
}).strict();
export type SupplierQuotationCreate = z.infer<typeof supplierQuotationCreateSchema>;

export const poAcknowledgementCreateSchema = z.object({
  status: z.enum(['accepted', 'change_requested']), responseNote: optionalText(2000),
  proposedChanges: jsonObject.default({}),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'change_requested' && !value.responseNote) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['responseNote'], message: 'Explain the requested PO change.' });
  }
});
export type PoAcknowledgementCreate = z.infer<typeof poAcknowledgementCreateSchema>;

export const asnCreateSchema = z.object({
  purchaseOrderId: id, asnNumber: text(100), dispatchedOn: isoDate, expectedArrivalOn: isoDate,
  expectedPurchaseOrderRowVersion: z.number().int().nonnegative().optional(),
  carrier: optionalText(160), vehicleNumber: optionalText(80), trackingReference: optionalText(160),
  lines: z.array(z.object({ sourceLineId: id, quantity }).strict()).min(1).max(250),
}).strict().superRefine((value, ctx) => {
  if (value.expectedArrivalOn < value.dispatchedOn) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedArrivalOn'], message: 'Arrival cannot precede dispatch.' });
  }
});
export type AsnCreate = z.infer<typeof asnCreateSchema>;

export const supplierInvoiceEvidenceCreateSchema = z.object({
  evidenceType: z.enum(['invoice', 'e_invoice', 'supporting']), storageRef: text(1000), checksum,
  externalReference: optionalText(160), metadata: jsonObject.default({}),
}).strict();
export type SupplierInvoiceEvidenceCreate = z.infer<typeof supplierInvoiceEvidenceCreateSchema>;

export const supplierDisputeResponseSchema = rowVersionSchema.extend({ response: text(4000) }).strict();
export type SupplierDisputeResponse = z.infer<typeof supplierDisputeResponseSchema>;
