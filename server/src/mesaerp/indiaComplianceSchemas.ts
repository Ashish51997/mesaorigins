import { z } from 'zod';

export const indiaIsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO business date (YYYY-MM-DD).')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Use a valid calendar date.');
export const indiaIsoTimestampSchema = z.string().datetime({ offset: true });
export const indiaMoneySchema = z.string().max(19).regex(/^\d{1,16}(?:\.\d{1,2})?$/, 'Use a non-negative Decimal money string with at most two fractional digits.');
export const gstinSchema = z.string().trim().toUpperCase().regex(
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  'Use a valid 15-character GSTIN format.',
);
export const gstinOrUrpSchema = z.union([gstinSchema, z.literal('URP')]);
export const irnSchema = z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/, 'IRN must be a 64-character hexadecimal value.');
export const sha256Schema = z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/, 'Use a lowercase SHA-256 checksum.');
const jsonObjectSchema = z.record(z.string(), z.unknown());
const evidenceObjectSchema = jsonObjectSchema.refine((value) => Object.keys(value).length > 0, 'Evidence object cannot be empty.');
const rowVersionSchema = z.object({ expectedRowVersion: z.number().int().nonnegative() }).strict();
export type IndiaRowVersion = z.infer<typeof rowVersionSchema>;

export const externalEvidenceVerificationSchema = z.object({
  verifierReference: z.string().trim().min(3).max(500),
  verifiedAt: indiaIsoTimestampSchema,
  signature: sha256Schema,
}).strict();
export type ExternalEvidenceVerification = z.infer<typeof externalEvidenceVerificationSchema>;

export const complianceArtifactKindSchema = z.enum(['outbound_e_invoice', 'e_way_bill', 'inbound_e_invoice']);
export type ComplianceArtifactKind = z.infer<typeof complianceArtifactKindSchema>;

export const complianceRulesSchema = z.object({
  enabled: z.boolean(),
  documentTypes: z.array(z.string().trim().min(1).max(30)).max(50).default([]),
  supplyTypes: z.array(z.string().trim().min(1).max(50)).max(50).default([]),
  exemptSupplyTypes: z.array(z.string().trim().min(1).max(50)).max(50).default([]),
  minimumDocumentValue: indiaMoneySchema.default('0'),
  minimumDistanceKm: z.number().int().min(0).max(100000).default(0),
  maximumDocumentAgeDays: z.number().int().min(0).max(3650).optional(),
  notes: z.string().trim().max(2000).default(''),
}).strict();
export type ComplianceRules = z.infer<typeof complianceRulesSchema>;

export const complianceRuleProfileCreateSchema = z.object({
  artifactKind: complianceArtifactKindSchema,
  version: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/),
  effectiveFrom: indiaIsoDateSchema,
  effectiveTo: indiaIsoDateSchema.optional(),
  rules: complianceRulesSchema,
  sourceReference: z.string().trim().min(3).max(1000),
  sourceEvidence: evidenceObjectSchema,
  sourceChecksum: sha256Schema,
}).strict().refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
  message: 'effectiveTo cannot be earlier than effectiveFrom.',
  path: ['effectiveTo'],
});
export type ComplianceRuleProfileCreate = z.infer<typeof complianceRuleProfileCreateSchema>;
export const complianceRuleProfileApproveSchema = rowVersionSchema;

export const outboundEInvoiceCreateSchema = z.object({
  sourceDocumentId: z.string().trim().min(1).max(128),
  supplierGstin: gstinSchema,
  recipientGstin: gstinOrUrpSchema,
  documentType: z.enum(['INV', 'CRN', 'DBN']).default('INV'),
  supplyType: z.enum(['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP']).default('B2B'),
  placeOfSupply: z.string().regex(/^[0-9]{2}$/),
  reverseCharge: z.boolean().default(false),
  dispatchDetails: jsonObjectSchema.default({}),
  shipTo: jsonObjectSchema.default({}),
}).strict().superRefine((value, ctx) => {
  const isExport = value.supplyType === 'EXPWP' || value.supplyType === 'EXPWOP';
  if (isExport && value.recipientGstin !== 'URP') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recipientGstin'], message: 'Export e-invoices must use recipient identity URP.' });
  }
  if (!isExport && value.recipientGstin === 'URP') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recipientGstin'], message: 'B2B, SEZ and deemed-export e-invoices require the recipient GSTIN.' });
  }
});
export type OutboundEInvoiceCreate = z.infer<typeof outboundEInvoiceCreateSchema>;

export const outboundEInvoiceProviderAckSchema = z.object({
  provider: z.string().trim().min(2).max(100),
  providerReference: z.string().trim().min(1).max(200),
  irn: irnSchema,
  acknowledgementNumber: z.string().trim().min(1).max(30).regex(/^[0-9A-Za-z-]+$/),
  acknowledgementAt: indiaIsoTimestampSchema,
  signedPayload: evidenceObjectSchema,
  signedPayloadHash: sha256Schema,
  qrData: z.string().trim().min(1).max(10000),
}).strict();

export const outboundEInvoiceManualAckSchema = outboundEInvoiceProviderAckSchema.extend({
  expectedRowVersion: z.number().int().nonnegative(),
  externalVerification: externalEvidenceVerificationSchema,
}).strict();
export type OutboundEInvoiceManualAck = z.infer<typeof outboundEInvoiceManualAckSchema>;

export const statutoryCancelSchema = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  reasonCode: z.enum(['1', '2', '3', '4']),
  reason: z.string().trim().min(5).max(500),
}).strict();
export type StatutoryCancel = z.infer<typeof statutoryCancelSchema>;

export const eWayVehicleSchema = z.object({
  mode: z.enum(['road', 'rail', 'air', 'ship', 'in_transit']),
  vehicleNumber: z.string().trim().toUpperCase().max(20).regex(/^[A-Z0-9-]*$/).default(''),
  transporterDocumentNumber: z.string().trim().max(50).default(''),
  transporterDocumentDate: indiaIsoDateSchema.optional(),
  vehicleType: z.enum(['regular', 'odc']).default('regular'),
}).strict().superRefine((value, ctx) => {
  if (value.mode === 'road' && !value.vehicleNumber) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vehicleNumber'], message: 'Road movement requires a vehicle number.' });
  }
  if (['rail', 'air', 'ship'].includes(value.mode) && !value.transporterDocumentNumber) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transporterDocumentNumber'], message: 'Rail, air and ship movement require a transporter document number.' });
  }
});
export type EWayVehicle = z.infer<typeof eWayVehicleSchema>;

export const eWayTransporterSchema = z.object({
  transporterId: z.string().trim().max(30).default(''),
  transporterName: z.string().trim().max(200).default(''),
  fromPlace: z.string().trim().min(1).max(100),
  fromStateCode: z.string().regex(/^[0-9]{2}$/),
  fromPincode: z.string().regex(/^[0-9]{6}$/),
  toPlace: z.string().trim().min(1).max(100),
  toStateCode: z.string().regex(/^[0-9]{2}$/),
  toPincode: z.string().regex(/^[0-9]{6}$/),
}).strict();
export type EWayTransporter = z.infer<typeof eWayTransporterSchema>;

export const eWayBillCreateSchema = z.object({
  sourceDocumentId: z.string().trim().min(1).max(128),
  supplierGstin: gstinSchema,
  recipientGstin: gstinOrUrpSchema,
  documentType: z.enum(['INV', 'CHL', 'BIL', 'BOE', 'OTH']).default('INV'),
  supplyType: z.enum(['supply', 'job_work', 'transfer', 'return', 'other']),
  subSupplyType: z.string().trim().min(1).max(100),
  transactionType: z.enum(['regular', 'bill_to_ship_to', 'bill_from_dispatch_from', 'combination']).default('regular'),
  distanceKm: z.number().int().min(0).max(100000),
  transporter: eWayTransporterSchema,
  vehicle: eWayVehicleSchema,
}).strict();
export type EWayBillCreate = z.infer<typeof eWayBillCreateSchema>;

export const externalEWayBillCreateSchema = z.object({
  sourceDocumentId: z.string().trim().min(1).max(128).optional(),
  businessDate: indiaIsoDateSchema,
  supplierGstin: gstinSchema,
  recipientGstin: gstinOrUrpSchema,
  documentType: z.enum(['INV', 'CHL', 'BIL', 'BOE', 'OTH']),
  documentNumber: z.string().trim().min(1).max(100),
  eWayBillNumber: z.string().regex(/^[0-9]{12}$/),
  issuedAt: indiaIsoTimestampSchema,
  validUntil: indiaIsoTimestampSchema,
  transporter: eWayTransporterSchema,
  vehicle: eWayVehicleSchema,
  evidence: evidenceObjectSchema,
  evidenceHash: sha256Schema,
  externalVerification: externalEvidenceVerificationSchema,
}).strict().refine((value) => value.validUntil > value.issuedAt, {
  message: 'External e-way-bill validity must end after issuance.', path: ['validUntil'],
});
export type ExternalEWayBillCreate = z.infer<typeof externalEWayBillCreateSchema>;

export const eWayVehicleUpdateSchema = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  vehicle: eWayVehicleSchema,
  reasonCode: z.enum(['1', '2', '3', '4']),
  reason: z.string().trim().min(3).max(500),
}).strict();
export type EWayVehicleUpdate = z.infer<typeof eWayVehicleUpdateSchema>;

export const eWayExtendSchema = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  remainingDistanceKm: z.number().int().min(1).max(100000),
  reasonCode: z.enum(['1', '2', '4', '5', '99']),
  reason: z.string().trim().min(5).max(500),
  fromPlace: z.string().trim().min(1).max(100),
  fromStateCode: z.string().regex(/^[0-9]{2}$/),
  fromPincode: z.string().regex(/^[0-9]{6}$/),
  transitType: z.enum(['movement', 'road', 'warehouse', 'other']),
  vehicle: eWayVehicleSchema,
}).strict();
export type EWayExtend = z.infer<typeof eWayExtendSchema>;

export const inboundEInvoiceCreateSchema = z.object({
  sourceDocumentId: z.string().trim().min(1).max(128).optional(),
  supplierGstin: gstinSchema,
  recipientGstin: gstinSchema,
  documentType: z.enum(['INV', 'CRN', 'DBN']),
  documentNumber: z.string().trim().min(1).max(100),
  documentDate: indiaIsoDateSchema,
  irn: irnSchema,
  acknowledgementNumber: z.string().trim().min(1).max(30).regex(/^[0-9A-Za-z-]+$/),
  acknowledgementAt: indiaIsoTimestampSchema,
  signedPayload: evidenceObjectSchema,
  signedPayloadHash: sha256Schema,
  taxableValue: indiaMoneySchema,
  taxAmount: indiaMoneySchema,
  totalAmount: indiaMoneySchema,
  provider: z.string().trim().min(2).max(100),
  providerReference: z.string().trim().max(200).default(''),
  origin: z.enum(['provider', 'json_upload', 'supplier_portal']),
  externalVerification: externalEvidenceVerificationSchema,
}).strict();
export type InboundEInvoiceCreate = z.infer<typeof inboundEInvoiceCreateSchema>;

export const gstr2bEntrySchema = z.object({
  supplierGstin: gstinSchema,
  documentType: z.enum(['INV', 'CRN', 'DBN']),
  documentNumber: z.string().trim().min(1).max(100),
  documentDate: indiaIsoDateSchema,
  irn: irnSchema.optional(),
  taxableValue: indiaMoneySchema,
  taxAmount: indiaMoneySchema,
  totalAmount: indiaMoneySchema,
  portalItcAvailability: z.enum(['available', 'not_available', 'reversal']).default('available'),
  reason: z.string().trim().max(500).default(''),
}).strict();
export type Gstr2bEntry = z.infer<typeof gstr2bEntrySchema>;

export const gstr2bUploadSchema = z.object({
  returnPeriod: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
  generatedAt: indiaIsoTimestampSchema,
  recipientGstin: gstinSchema,
  sourceReference: z.string().trim().min(3).max(500),
  sourcePayload: evidenceObjectSchema,
  sourcePayloadHash: sha256Schema,
  entries: z.array(gstr2bEntrySchema).min(1).max(10000),
  externalVerification: externalEvidenceVerificationSchema,
}).strict().superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.entries.forEach((entry, index) => {
    const key = `${entry.supplierGstin}:${entry.documentType}:${entry.documentNumber}`;
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entries', index], message: 'Duplicate document identity within the GSTR-2B upload.' });
    seen.add(key);
  });
});
export type Gstr2bUpload = z.infer<typeof gstr2bUploadSchema>;

export const inboundGstr2bReconcileSchema = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  gstr2bDocumentId: z.string().trim().min(1).max(128),
}).strict();
export type InboundGstr2bReconcile = z.infer<typeof inboundGstr2bReconcileSchema>;

export const inboundItcDecisionSchema = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  status: z.enum(['blocked', 'reversed', 'claimed']),
  reason: z.string().trim().min(5).max(1000),
}).strict();
export type InboundItcDecision = z.infer<typeof inboundItcDecisionSchema>;

export const complianceTransitionSchema = rowVersionSchema;
