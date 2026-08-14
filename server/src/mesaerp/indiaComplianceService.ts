import { randomUUID } from 'node:crypto';
import { Prisma, type ErpComplianceRuleProfile, type ErpTaxDocument } from '@prisma/client';
import { basePrisma, tenantTx } from '../db';
import { audit } from '../lib/audit';
import { tenantContext, type TenantCtx } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import { hasMesaErpPermission } from './access';
import { hashCanonical } from './repository';
import {
  indiaIsoTimestampSchema,
  irnSchema,
  outboundEInvoiceProviderAckSchema,
  type ComplianceArtifactKind,
  type ComplianceRuleProfileCreate,
  type ComplianceRules,
  type EWayBillCreate,
  type EWayExtend,
  type EWayVehicleUpdate,
  type ExternalEWayBillCreate,
  type Gstr2bEntry,
  type Gstr2bUpload,
  type InboundEInvoiceCreate,
  type InboundGstr2bReconcile,
  type InboundItcDecision,
  type IndiaRowVersion,
  type OutboundEInvoiceCreate,
  type OutboundEInvoiceManualAck,
  type StatutoryCancel,
} from './indiaComplianceSchemas';
import {
  externalEvidencePayload,
  verifyExternalEvidence,
  verifyStoredExternalEvidence,
  type ExternalEvidenceEnvelope,
} from './indiaComplianceEvidence';
import {
  createIndiaComplianceProviderFromEnv,
  type EInvoiceProviderAcknowledgement,
  type EWayBillProviderAcknowledgement,
  type IndiaComplianceProvider,
  type ProviderCancellation,
  type ProviderValidityExtension,
  type ProviderVehicleUpdate,
} from './indiaComplianceProvider';

type Db = typeof basePrisma;

export interface IndiaCompliancePermissionCheck {
  organizationId: string;
  membershipId: string;
  legalEntityId: string;
  permission: string;
}

export interface ComplianceRuleProfileDto {
  id: string;
  organizationId: string;
  legalEntityId: string;
  jurisdiction: string;
  artifactKind: ComplianceArtifactKind;
  version: string;
  effectiveFrom: string;
  effectiveTo?: string;
  status: 'draft' | 'approved' | 'retired';
  rules: unknown;
  sourceReference: string;
  sourceEvidence: unknown;
  sourceChecksum: string;
  rowVersion: number;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaxDocumentDto {
  id: string;
  organizationId: string;
  legalEntityId: string;
  financialYearId: string;
  sourceDocumentId?: string;
  documentKind: 'outbound_e_invoice' | 'inbound_e_invoice' | 'e_way_bill' | 'gstr2b';
  provider: string;
  providerReference: string;
  status: string;
  supplierGstin: string;
  recipientGstin: string;
  documentType: string;
  documentNumber: string;
  documentDate?: string;
  irn: string;
  acknowledgementNumber: string;
  acknowledgementAt?: string;
  signedPayload: unknown;
  submittedPayload: unknown;
  qrData: string;
  transporter: unknown;
  vehicle: unknown;
  validUntil?: string;
  cancellation: unknown;
  reconciliation: unknown;
  itcStatus: 'pending' | 'eligible' | 'blocked' | 'mismatched' | 'reversed' | 'claimed';
  ruleProfileVersion: string;
  evidenceHash: string;
  rowVersion: number;
  makerMembershipId: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicabilityDecision {
  applicable: boolean;
  profileId: string;
  profileVersion: string;
  reasons: string[];
}

export interface MesaErpIndiaComplianceService {
  hasPermission(input: IndiaCompliancePermissionCheck): Promise<boolean>;
  listRuleProfiles(legalEntityId: string): Promise<ComplianceRuleProfileDto[]>;
  getRuleProfile(legalEntityId: string, profileId: string): Promise<ComplianceRuleProfileDto>;
  createRuleProfile(legalEntityId: string, input: ComplianceRuleProfileCreate, idempotencyKey: string): Promise<ComplianceRuleProfileDto>;
  approveRuleProfile(legalEntityId: string, profileId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<ComplianceRuleProfileDto>;
  listTaxDocuments(legalEntityId: string, kind: TaxDocumentDto['documentKind']): Promise<TaxDocumentDto[]>;
  getTaxDocument(legalEntityId: string, kind: TaxDocumentDto['documentKind'], documentId: string): Promise<TaxDocumentDto>;
  createOutboundEInvoice(legalEntityId: string, input: OutboundEInvoiceCreate, idempotencyKey: string): Promise<TaxDocumentDto>;
  approveOutboundEInvoice(legalEntityId: string, documentId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<TaxDocumentDto>;
  submitOutboundEInvoice(legalEntityId: string, documentId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<TaxDocumentDto>;
  importOutboundEInvoiceAcknowledgement(legalEntityId: string, documentId: string, input: OutboundEInvoiceManualAck, idempotencyKey: string): Promise<TaxDocumentDto>;
  cancelOutboundEInvoice(legalEntityId: string, documentId: string, input: StatutoryCancel, idempotencyKey: string): Promise<TaxDocumentDto>;
  createEWayBill(legalEntityId: string, input: EWayBillCreate, idempotencyKey: string): Promise<TaxDocumentDto>;
  approveEWayBill(legalEntityId: string, documentId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<TaxDocumentDto>;
  generateEWayBill(legalEntityId: string, documentId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<TaxDocumentDto>;
  createExternalEWayBill(legalEntityId: string, input: ExternalEWayBillCreate, idempotencyKey: string): Promise<TaxDocumentDto>;
  verifyExternalEWayBill(legalEntityId: string, documentId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<TaxDocumentDto>;
  updateEWayBillVehicle(legalEntityId: string, documentId: string, input: EWayVehicleUpdate, idempotencyKey: string): Promise<TaxDocumentDto>;
  extendEWayBill(legalEntityId: string, documentId: string, input: EWayExtend, idempotencyKey: string): Promise<TaxDocumentDto>;
  cancelEWayBill(legalEntityId: string, documentId: string, input: StatutoryCancel, idempotencyKey: string): Promise<TaxDocumentDto>;
  createInboundEInvoice(legalEntityId: string, input: InboundEInvoiceCreate, idempotencyKey: string): Promise<TaxDocumentDto>;
  uploadGstr2b(legalEntityId: string, input: Gstr2bUpload, idempotencyKey: string): Promise<TaxDocumentDto>;
  reconcileInboundEInvoice(legalEntityId: string, documentId: string, input: InboundGstr2bReconcile, idempotencyKey: string): Promise<TaxDocumentDto>;
  decideInboundItc(legalEntityId: string, documentId: string, input: InboundItcDecision, idempotencyKey: string): Promise<TaxDocumentDto>;
}

function actor(): TenantCtx {
  const context = tenantContext.getStore();
  if (!context) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return context;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) as Record<string, unknown> : {};
}

function control(value: unknown): Record<string, unknown> {
  return record(record(value).mesaerpControl);
}

function withControl(value: unknown, patch: Record<string, unknown>): Prisma.InputJsonValue {
  const existing = record(value);
  return json({ ...existing, mesaerpControl: { ...control(existing), ...patch } });
}

function appendHistory(value: unknown, kind: string, evidence: unknown): Prisma.InputJsonValue {
  const existing = record(value);
  const history = Array.isArray(existing.history) ? structuredClone(existing.history) : [];
  history.push({ kind, at: new Date().toISOString(), evidence });
  return json({ ...existing, history });
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function ruleProfileDto(row: ErpComplianceRuleProfile): ComplianceRuleProfileDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    legalEntityId: row.legalEntityId,
    jurisdiction: row.jurisdiction,
    artifactKind: row.artifactKind as ComplianceArtifactKind,
    version: row.version,
    effectiveFrom: day(row.effectiveFrom),
    ...(row.effectiveTo ? { effectiveTo: day(row.effectiveTo) } : {}),
    status: row.status as ComplianceRuleProfileDto['status'],
    rules: structuredClone(row.rules),
    sourceReference: row.sourceReference,
    sourceEvidence: structuredClone(row.sourceEvidence),
    sourceChecksum: row.sourceChecksum,
    rowVersion: row.rowVersion,
    createdBy: row.createdBy,
    ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function taxDocumentDto(row: ErpTaxDocument): TaxDocumentDto {
  const evidence = control(row.reconciliation);
  return {
    id: row.id,
    organizationId: row.organizationId,
    legalEntityId: row.legalEntityId,
    financialYearId: row.financialYearId,
    ...(row.sourceDocumentId ? { sourceDocumentId: row.sourceDocumentId } : {}),
    documentKind: row.documentKind as TaxDocumentDto['documentKind'],
    provider: row.provider,
    providerReference: row.providerReference,
    status: row.status,
    supplierGstin: row.supplierGstin,
    recipientGstin: row.recipientGstin,
    documentType: row.documentType,
    documentNumber: row.documentNumber,
    ...(row.documentDate ? { documentDate: day(row.documentDate) } : {}),
    irn: row.irn,
    acknowledgementNumber: row.acknowledgementNumber,
    ...(row.acknowledgementAt ? { acknowledgementAt: row.acknowledgementAt.toISOString() } : {}),
    signedPayload: structuredClone(row.signedPayload),
    submittedPayload: structuredClone(row.submittedPayload),
    qrData: row.qrData,
    transporter: structuredClone(row.transporter),
    vehicle: structuredClone(row.vehicle),
    ...(row.validUntil ? { validUntil: row.validUntil.toISOString() } : {}),
    cancellation: structuredClone(row.cancellation),
    reconciliation: structuredClone(row.reconciliation),
    itcStatus: row.itcStatus as TaxDocumentDto['itcStatus'],
    ruleProfileVersion: row.ruleProfileVersion,
    evidenceHash: row.evidenceHash,
    rowVersion: row.rowVersion,
    makerMembershipId: typeof evidence.makerMembershipId === 'string' ? evidence.makerMembershipId : '',
    ...(typeof evidence.approvedBy === 'string' ? { approvedBy: evidence.approvedBy } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireLegalEntity(db: Db, context: TenantCtx, legalEntityId: string) {
  const entity = await db.legalEntity.findFirst({ where: { id: legalEntityId, organizationId: context.organizationId, status: 'active' } });
  if (!entity) throw new ApiError(404, 'legal_entity_not_found', 'Legal entity not found.');
  if (entity.countryCode !== 'IN') throw new ApiError(409, 'india_compliance_not_applicable', 'India compliance documents require an India legal entity.');
  return entity;
}

async function financialYearFor(db: Db, legalEntityId: string, businessDate: Date) {
  const year = await db.financialYear.findFirst({ where: { legalEntityId, startsOn: { lte: businessDate }, endsOn: { gte: businessDate } } });
  if (!year) throw new ApiError(409, 'financial_year_missing', 'No financial year covers this document date.');
  if (year.status === 'locked') throw new ApiError(409, 'financial_year_locked', 'The covering financial year is locked.');
  return year;
}

function registeredGstins(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === 'string') return [entry.toUpperCase()];
    const candidate = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>).gstin : undefined;
    return typeof candidate === 'string' ? [candidate.toUpperCase()] : [];
  });
}

function requireRegisteredGstin(entity: { gstRegistrations: Prisma.JsonValue }, gstin: string) {
  if (!registeredGstins(entity.gstRegistrations).includes(gstin)) {
    throw new ApiError(409, 'legal_entity_gstin_not_registered', 'Supplier GSTIN is not configured on this legal entity.');
  }
}

async function resolveProfile(db: Db, legalEntityId: string, artifactKind: ComplianceArtifactKind, businessDate: Date) {
  const profile = await db.erpComplianceRuleProfile.findFirst({
    where: {
      legalEntityId,
      artifactKind,
      status: 'approved',
      effectiveFrom: { lte: businessDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: businessDate } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!profile) throw new ApiError(409, 'compliance_rule_profile_missing', `No approved ${artifactKind} rule profile covers this business date.`);
  return profile;
}

export function evaluateApplicability(input: {
  profile: { id: string; version: string; rules: unknown };
  documentType: string;
  supplyType: string;
  documentValue: string;
  distanceKm?: number;
  documentDate: string;
  evaluatedAt?: string;
}): ApplicabilityDecision {
  const rules = input.profile.rules as ComplianceRules;
  const reasons: string[] = [];
  if (!rules.enabled) reasons.push('profile_disabled');
  if (rules.documentTypes.length && !rules.documentTypes.includes(input.documentType)) reasons.push('document_type_excluded');
  if (rules.supplyTypes.length && !rules.supplyTypes.includes(input.supplyType)) reasons.push('supply_type_excluded');
  if (rules.exemptSupplyTypes.includes(input.supplyType)) reasons.push('supply_type_exempt');
  if (new Prisma.Decimal(input.documentValue).lessThan(rules.minimumDocumentValue)) reasons.push('below_profile_value');
  if ((input.distanceKm ?? 0) < rules.minimumDistanceKm) reasons.push('below_profile_distance');
  if (rules.maximumDocumentAgeDays !== undefined) {
    const evaluatedAt = dateOnly((input.evaluatedAt ?? new Date().toISOString()).slice(0, 10));
    const ageDays = Math.floor((evaluatedAt.getTime() - dateOnly(input.documentDate).getTime()) / 86_400_000);
    if (ageDays > rules.maximumDocumentAgeDays) reasons.push('document_too_old');
  }
  return { applicable: reasons.length === 0, profileId: input.profile.id, profileVersion: input.profile.version, reasons };
}

async function replay<T>(db: Db, organizationId: string, scope: string, key: string, requestHash: string): Promise<T | null> {
  const existing = await db.erpIdempotencyRecord.findUnique({ where: { organizationId_scope_key: { organizationId, scope, key } } });
  if (!existing) return null;
  if (existing.requestHash !== requestHash) throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was already used with a different request.');
  return structuredClone(existing.response) as T;
}

async function remember(db: Db, context: TenantCtx, legalEntityId: string, scope: string, key: string, requestHash: string, response: unknown) {
  await db.erpIdempotencyRecord.create({ data: { organizationId: context.organizationId, legalEntityId, scope, key, requestHash, response: json(response) } });
}

async function runIdempotent<T>(input: {
  legalEntityId: string;
  scope: string;
  key: string;
  payload: unknown;
  execute: (db: Db, context: TenantCtx) => Promise<T>;
}): Promise<T> {
  const context = actor();
  const requestHash = hashCanonical({ legalEntityId: input.legalEntityId, payload: input.payload });
  const once = () => tenantTx(async (db) => {
    const existing = await replay<T>(db, context.organizationId, input.scope, input.key, requestHash);
    if (existing) return existing;
    await requireLegalEntity(db, context, input.legalEntityId);
    const response = await input.execute(db, context);
    await remember(db, context, input.legalEntityId, input.scope, input.key, requestHash, response);
    return response;
  });
  try {
    return await once();
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    return tenantTx(async (db) => {
      const existing = await replay<T>(db, context.organizationId, input.scope, input.key, requestHash);
      if (existing) return existing;
      throw error;
    });
  }
}

async function runProviderWrite<TPrepared, TResult>(input: {
  legalEntityId: string;
  scope: string;
  key: string;
  payload: unknown;
  prepare: (db: Db, context: TenantCtx) => Promise<TPrepared>;
  invoke: (prepared: TPrepared) => Promise<TResult>;
  commit: (db: Db, context: TenantCtx, prepared: TPrepared, result: TResult) => Promise<TaxDocumentDto>;
}): Promise<TaxDocumentDto> {
  const context = actor();
  const requestHash = hashCanonical({ legalEntityId: input.legalEntityId, payload: input.payload });
  const prepared = await tenantTx(async (db) => {
    const existing = await replay<TaxDocumentDto>(db, context.organizationId, input.scope, input.key, requestHash);
    if (existing) return { replayed: existing } as const;
    await requireLegalEntity(db, context, input.legalEntityId);
    return { value: await input.prepare(db, context) } as const;
  });
  if ('replayed' in prepared && prepared.replayed) return prepared.replayed;
  const providerResult = await input.invoke(prepared.value);
  try {
    return await tenantTx(async (db) => {
      const existing = await replay<TaxDocumentDto>(db, context.organizationId, input.scope, input.key, requestHash);
      if (existing) return existing;
      const response = await input.commit(db, context, prepared.value, providerResult);
      await remember(db, context, input.legalEntityId, input.scope, input.key, requestHash, response);
      return response;
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'P2002' && code !== 'version_conflict') throw error;
    return tenantTx(async (db) => {
      const existing = await replay<TaxDocumentDto>(db, context.organizationId, input.scope, input.key, requestHash);
      if (existing) return existing;
      throw error;
    });
  }
}

async function appendOutbox(db: Db, context: TenantCtx, legalEntityId: string, aggregateId: string, eventType: string, payload: unknown) {
  await db.integrationOutboxEvent.create({
    data: {
      organizationId: context.organizationId,
      legalEntityId,
      serviceId: 'mesaerp',
      aggregateType: 'ErpTaxDocument',
      aggregateId,
      eventType,
      correlationId: randomUUID(),
      payload: json(payload),
      payloadHash: hashCanonical(payload),
    },
  });
}

function assertMakerChecker(evidenceValue: unknown, checker: string, subject: string) {
  const maker = control(evidenceValue).makerMembershipId;
  if (typeof maker !== 'string' || !maker || maker === checker) {
    throw new ApiError(409, 'maker_checker_required', `${subject} maker cannot approve or verify the same record.`);
  }
}

function assertVersionAndStatus(row: ErpTaxDocument, expectedVersion: number, statuses: string[]) {
  if (row.rowVersion !== expectedVersion) throw new ApiError(409, 'version_conflict', 'Compliance document changed since it was loaded.');
  if (!statuses.includes(row.status)) throw new ApiError(409, 'compliance_document_not_transitionable', `Compliance document is ${row.status}.`);
}

function signedPayloadHashMatches(payload: unknown, checksum: string) {
  if (hashCanonical(payload) !== checksum) throw new ApiError(422, 'signed_payload_hash_mismatch', 'Signed evidence does not match its declared SHA-256 checksum.');
}

function validateProviderEInvoice(result: EInvoiceProviderAcknowledgement) {
  return outboundEInvoiceProviderAckSchema.parse({
    provider: result.provider,
    providerReference: result.providerReference,
    irn: result.irn,
    acknowledgementNumber: result.acknowledgementNumber,
    acknowledgementAt: result.acknowledgementAt,
    signedPayload: result.signedPayload,
    signedPayloadHash: hashCanonical(result.signedPayload),
    qrData: result.qrData,
  });
}

type EvidenceSource = { sourceRecordType: string; sourceRecordId: string };

function externalEWayBillSource(input: Pick<ExternalEWayBillCreate, 'sourceDocumentId' | 'documentType' | 'documentNumber' | 'eWayBillNumber'>): EvidenceSource {
  return input.sourceDocumentId
    ? { sourceRecordType: 'ErpDocument', sourceRecordId: input.sourceDocumentId }
    : { sourceRecordType: 'ExternalMovementDocument', sourceRecordId: `${input.documentType}:${input.documentNumber}:${input.eWayBillNumber}` };
}

function inboundEInvoiceSource(input: Pick<InboundEInvoiceCreate, 'sourceDocumentId' | 'supplierGstin' | 'documentType' | 'documentNumber' | 'documentDate'>): EvidenceSource {
  return input.sourceDocumentId
    ? { sourceRecordType: 'ErpDocument', sourceRecordId: input.sourceDocumentId }
    : { sourceRecordType: 'InboundInvoiceIdentity', sourceRecordId: `${input.supplierGstin}:${input.documentType}:${input.documentNumber}:${input.documentDate}` };
}

function gstr2bSource(input: Pick<Gstr2bUpload, 'recipientGstin' | 'returnPeriod'>): EvidenceSource {
  return { sourceRecordType: 'Gstr2bPeriod', sourceRecordId: `${input.recipientGstin}:${input.returnPeriod}` };
}

function externalVerification(value: unknown): unknown {
  return record(value).externalVerification;
}

function latestGstr2bDocumentId(value: unknown): string {
  const history = record(value).history;
  if (!Array.isArray(history)) return '';
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = record(history[index]);
    if (entry.kind !== 'gstr2b_reconciliation') continue;
    const id = record(entry.evidence).gstr2bDocumentId;
    if (typeof id === 'string') return id;
  }
  return '';
}

function assertStoredEvidence(input: {
  row: ErpTaxDocument;
  evidenceKind: 'external_e_way_bill' | 'inbound_e_invoice' | 'gstr2b_upload';
  source: EvidenceSource;
}): ExternalEvidenceEnvelope {
  return verifyStoredExternalEvidence({
    organizationId: input.row.organizationId,
    legalEntityId: input.row.legalEntityId,
    evidenceKind: input.evidenceKind,
    ...input.source,
    evidence: input.row.submittedPayload,
  }, externalVerification(input.row.reconciliation));
}

function validateTimestamp(value: string, subject: string): Date {
  const parsed = indiaIsoTimestampSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(502, 'provider_response_invalid', `${subject} returned an invalid timestamp.`);
  return new Date(parsed.data);
}

function requireProviderEvidence(provider: string, providerReference: string, evidence: unknown, subject: string) {
  if (!provider.trim() || !providerReference.trim() || Object.keys(record(evidence)).length === 0) {
    throw new ApiError(502, 'provider_response_invalid', `${subject} returned incomplete provider or evidence details.`);
  }
}

export class PrismaMesaErpIndiaComplianceService implements MesaErpIndiaComplianceService {
  constructor(private readonly provider: IndiaComplianceProvider = createIndiaComplianceProviderFromEnv()) {}

  hasPermission(input: IndiaCompliancePermissionCheck): Promise<boolean> {
    return hasMesaErpPermission(input);
  }

  async listRuleProfiles(legalEntityId: string): Promise<ComplianceRuleProfileDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context, legalEntityId);
      const rows = await db.erpComplianceRuleProfile.findMany({ where: { legalEntityId }, orderBy: [{ artifactKind: 'asc' }, { effectiveFrom: 'desc' }], take: 250 });
      return rows.map(ruleProfileDto);
    });
  }

  async getRuleProfile(legalEntityId: string, profileId: string): Promise<ComplianceRuleProfileDto> {
    const context = actor();
    return tenantTx(async (db) => {
      const row = await db.erpComplianceRuleProfile.findFirst({ where: { id: profileId, organizationId: context.organizationId, legalEntityId } });
      if (!row) throw new ApiError(404, 'compliance_rule_profile_not_found', 'Compliance rule profile not found in this company.');
      return ruleProfileDto(row);
    });
  }

  createRuleProfile(legalEntityId: string, input: ComplianceRuleProfileCreate, idempotencyKey: string): Promise<ComplianceRuleProfileDto> {
    return runIdempotent({
      legalEntityId, scope: `india-compliance:rule-profile:create:${legalEntityId}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        if (hashCanonical(input.sourceEvidence) !== input.sourceChecksum) throw new ApiError(422, 'source_checksum_mismatch', 'Rule source evidence does not match sourceChecksum.');
        const duplicate = await db.erpComplianceRuleProfile.findFirst({ where: { legalEntityId, artifactKind: input.artifactKind, version: input.version }, select: { id: true } });
        if (duplicate) throw new ApiError(409, 'rule_profile_version_exists', 'This artifact rule version already exists in the company.');
        const row = await db.erpComplianceRuleProfile.create({
          data: {
            organizationId: context.organizationId, legalEntityId, jurisdiction: 'IN', artifactKind: input.artifactKind,
            version: input.version, effectiveFrom: dateOnly(input.effectiveFrom), effectiveTo: input.effectiveTo ? dateOnly(input.effectiveTo) : null,
            rules: json(input.rules), sourceReference: input.sourceReference, sourceEvidence: json(input.sourceEvidence), sourceChecksum: input.sourceChecksum,
            createIdempotencyKey: `rule-profile:${idempotencyKey}`, requestHash: hashCanonical(input), createdBy: context.membershipId,
          },
        });
        const response = ruleProfileDto(row);
        await audit(db, { action: 'mesaerp.india_compliance.rule_profile.create', entity: 'ErpComplianceRuleProfile', entityId: row.id, after: response });
        return response;
      },
    });
  }

  approveRuleProfile(legalEntityId: string, profileId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<ComplianceRuleProfileDto> {
    return runIdempotent({
      legalEntityId, scope: `india-compliance:rule-profile:${profileId}:approve`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        const existing = await db.erpComplianceRuleProfile.findFirst({ where: { id: profileId, legalEntityId } });
        if (!existing) throw new ApiError(404, 'compliance_rule_profile_not_found', 'Compliance rule profile not found in this company.');
        if (existing.rowVersion !== input.expectedRowVersion) throw new ApiError(409, 'version_conflict', 'Rule profile changed since it was loaded.');
        if (existing.status !== 'draft') throw new ApiError(409, 'rule_profile_not_approvable', `Rule profile is ${existing.status}.`);
        if (existing.createdBy === context.membershipId) throw new ApiError(409, 'maker_checker_required', 'Rule profile maker cannot approve the same profile.');
        const overlap = await db.erpComplianceRuleProfile.findFirst({
          where: {
            legalEntityId, artifactKind: existing.artifactKind, status: 'approved', id: { not: existing.id },
            effectiveFrom: { lte: existing.effectiveTo ?? new Date('9999-12-31T00:00:00.000Z') },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: existing.effectiveFrom } }],
          }, select: { id: true },
        });
        if (overlap) throw new ApiError(409, 'rule_profile_effective_dates_overlap', 'An approved profile already covers part of this effective range.');
        const now = new Date();
        const changed = await db.erpComplianceRuleProfile.updateMany({
          where: { id: profileId, legalEntityId, status: 'draft', rowVersion: input.expectedRowVersion },
          data: { status: 'approved', approvedBy: context.membershipId, approvedAt: now, rowVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Rule profile changed while approval was saved.');
        const row = await db.erpComplianceRuleProfile.findUniqueOrThrow({ where: { id: profileId } });
        const response = ruleProfileDto(row);
        await audit(db, { action: 'mesaerp.india_compliance.rule_profile.approve', entity: 'ErpComplianceRuleProfile', entityId: row.id, before: ruleProfileDto(existing), after: response });
        return response;
      },
    });
  }

  async listTaxDocuments(legalEntityId: string, kind: TaxDocumentDto['documentKind']): Promise<TaxDocumentDto[]> {
    const context = actor();
    return tenantTx(async (db) => {
      await requireLegalEntity(db, context, legalEntityId);
      const rows = await db.erpTaxDocument.findMany({ where: { legalEntityId, documentKind: kind }, orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }], take: 250 });
      return rows.map(taxDocumentDto);
    });
  }

  async getTaxDocument(legalEntityId: string, kind: TaxDocumentDto['documentKind'], documentId: string): Promise<TaxDocumentDto> {
    const context = actor();
    return tenantTx(async (db) => {
      const row = await db.erpTaxDocument.findFirst({ where: { id: documentId, organizationId: context.organizationId, legalEntityId, documentKind: kind } });
      if (!row) throw new ApiError(404, 'tax_document_not_found', 'Compliance document not found in this company.');
      return taxDocumentDto(row);
    });
  }

  createOutboundEInvoice(legalEntityId: string, input: OutboundEInvoiceCreate, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runIdempotent({
      legalEntityId, scope: `india-compliance:outbound-e-invoice:create:${legalEntityId}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        const entity = await requireLegalEntity(db, context, legalEntityId);
        requireRegisteredGstin(entity, input.supplierGstin);
        const invoice = await db.erpDocument.findFirst({ where: { id: input.sourceDocumentId, legalEntityId, documentType: 'sales_invoice' }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
        if (!invoice) throw new ApiError(404, 'sales_invoice_not_found', 'Approved sales invoice not found in this company.');
        if (invoice.status !== 'approved') throw new ApiError(409, 'sales_invoice_not_approved', 'Outbound e-invoice requires an approved sales invoice.');
        const party = record(invoice.partySnapshot);
        const snapshotRecipient = typeof party.gstin === 'string' && party.gstin ? party.gstin.toUpperCase() : 'URP';
        if (snapshotRecipient !== input.recipientGstin) throw new ApiError(422, 'recipient_gstin_mismatch', 'Recipient GSTIN differs from the approved customer snapshot.');
        if (invoice.lines.some((line) => !line.itemId || !line.hsnSacCode.trim())) {
          throw new ApiError(409, 'e_invoice_item_tax_code_missing', 'Every outbound e-invoice line requires a mapped item and HSN/SAC code.');
        }
        const profile = await resolveProfile(db, legalEntityId, 'outbound_e_invoice', invoice.documentDate);
        const decision = evaluateApplicability({ profile, documentType: input.documentType, supplyType: input.supplyType, documentValue: invoice.grandTotal.toString(), documentDate: day(invoice.documentDate) });
        if (!decision.applicable) throw new ApiError(409, 'artifact_not_applicable', `Outbound e-invoice is not applicable under profile ${profile.version}: ${decision.reasons.join(', ')}.`);
        const year = await financialYearFor(db, legalEntityId, invoice.documentDate);
        const duplicate = await db.erpTaxDocument.findFirst({
          where: { legalEntityId, financialYearId: year.id, documentKind: 'outbound_e_invoice', supplierGstin: input.supplierGstin, documentType: input.documentType, documentNumber: invoice.documentNumber }, select: { id: true },
        });
        if (duplicate) throw new ApiError(409, 'outbound_e_invoice_identity_exists', 'This supplier GSTIN and document identity is already registered for e-invoicing.');
        const payload = {
          schema: 'mesaerp.india.e-invoice.v1', supplierGstin: input.supplierGstin, recipientGstin: input.recipientGstin,
          documentType: input.documentType, documentNumber: invoice.documentNumber, documentDate: day(invoice.documentDate),
          supplyType: input.supplyType, placeOfSupply: input.placeOfSupply, reverseCharge: input.reverseCharge,
          currency: invoice.currency, exchangeRate: invoice.exchangeRate.toString(), subtotal: invoice.subtotal.toString(),
          discountTotal: invoice.discountTotal.toString(), taxTotal: invoice.taxTotal.toString(), grandTotal: invoice.grandTotal.toString(),
          dispatchDetails: input.dispatchDetails, shipTo: input.shipTo,
          lines: invoice.lines.map((line) => ({
            lineNumber: line.lineNumber, itemId: line.itemId, description: line.description, hsnSacCode: line.hsnSacCode,
            quantity: line.quantity.toString(), uom: line.uom, unitPrice: line.unitPrice.toString(), discountAmount: line.discountAmount.toString(),
            taxableAmount: line.taxableAmount.toString(), taxRate: line.taxRate.toString(), taxAmount: line.taxAmount.toString(), lineTotal: line.lineTotal.toString(),
          })),
          applicability: decision,
        };
        const row = await db.erpTaxDocument.create({
          data: {
            organizationId: context.organizationId, legalEntityId, financialYearId: year.id, sourceDocumentId: invoice.id,
            documentKind: 'outbound_e_invoice', status: 'draft', supplierGstin: input.supplierGstin, recipientGstin: input.recipientGstin,
            documentType: input.documentType, documentNumber: invoice.documentNumber, documentDate: invoice.documentDate,
            submittedPayload: json(payload), reconciliation: withControl({ applicability: decision }, { makerMembershipId: context.membershipId }),
            ruleProfileVersion: profile.version, evidenceHash: hashCanonical(payload), createIdempotencyKey: `outbound-e-invoice:${idempotencyKey}`,
          },
        });
        const response = taxDocumentDto(row);
        await audit(db, { action: 'mesaerp.india_compliance.outbound_e_invoice.create', entity: 'ErpTaxDocument', entityId: row.id, after: response });
        await appendOutbox(db, context, legalEntityId, row.id, 'mesaerp.outbound-e-invoice.created.v1', response);
        return response;
      },
    });
  }

  approveOutboundEInvoice(legalEntityId: string, documentId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<TaxDocumentDto> {
    return this.approveTaxDraft(legalEntityId, 'outbound_e_invoice', documentId, input, idempotencyKey);
  }

  private approveTaxDraft(legalEntityId: string, kind: 'outbound_e_invoice' | 'e_way_bill', documentId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runIdempotent({
      legalEntityId, scope: `india-compliance:${kind}:${documentId}:approve`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        const existing = await db.erpTaxDocument.findFirst({ where: { id: documentId, legalEntityId, documentKind: kind } });
        if (!existing) throw new ApiError(404, 'tax_document_not_found', 'Compliance document not found in this company.');
        assertVersionAndStatus(existing, input.expectedRowVersion, ['draft']);
        assertMakerChecker(existing.reconciliation, context.membershipId, 'Compliance document');
        const now = new Date();
        const reconciliation = withControl(existing.reconciliation, { approvedBy: context.membershipId, approvedAt: now.toISOString() });
        const changed = await db.erpTaxDocument.updateMany({ where: { id: existing.id, status: 'draft', rowVersion: input.expectedRowVersion }, data: { status: 'approved', reconciliation, rowVersion: { increment: 1 } } });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Compliance document changed while approval was saved.');
        const row = await db.erpTaxDocument.findUniqueOrThrow({ where: { id: existing.id } });
        const response = taxDocumentDto(row);
        await audit(db, { action: `mesaerp.india_compliance.${kind}.approve`, entity: 'ErpTaxDocument', entityId: row.id, before: taxDocumentDto(existing), after: response });
        await appendOutbox(db, context, legalEntityId, row.id, `mesaerp.${kind.replaceAll('_', '-')}.approved.v1`, response);
        return response;
      },
    });
  }

  submitOutboundEInvoice(legalEntityId: string, documentId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runProviderWrite({
      legalEntityId, scope: `india-compliance:outbound-e-invoice:${documentId}:submit`, key: idempotencyKey, payload: input,
      prepare: async (db) => {
        const row = await db.erpTaxDocument.findFirst({ where: { id: documentId, legalEntityId, documentKind: 'outbound_e_invoice' } });
        if (!row) throw new ApiError(404, 'tax_document_not_found', 'Outbound e-invoice not found.');
        assertVersionAndStatus(row, input.expectedRowVersion, ['approved']);
        return { documentId: row.id, expectedRowVersion: row.rowVersion, payload: record(row.submittedPayload) };
      },
      invoke: (prepared) => this.provider.submitEInvoice(prepared.payload, idempotencyKey),
      commit: async (db, context, prepared, result) => {
        const validated = validateProviderEInvoice(result);
        const existing = await db.erpTaxDocument.findFirstOrThrow({ where: { id: prepared.documentId, legalEntityId, documentKind: 'outbound_e_invoice' } });
        assertVersionAndStatus(existing, prepared.expectedRowVersion, ['approved']);
        const duplicateIrn = await db.erpTaxDocument.findFirst({ where: { legalEntityId, irn: validated.irn, id: { not: existing.id } }, select: { id: true } });
        if (duplicateIrn) throw new ApiError(409, 'irn_exists', 'IRN is already recorded in this company.');
        const acknowledgementAt = new Date(validated.acknowledgementAt);
        const evidence = { submittedPayloadHash: hashCanonical(existing.submittedPayload), acknowledgement: validated, verification: 'provider_adapter' };
        const changed = await db.erpTaxDocument.updateMany({
          where: { id: existing.id, status: 'approved', rowVersion: prepared.expectedRowVersion },
          data: {
            status: 'acknowledged', provider: validated.provider, providerReference: validated.providerReference,
            irn: validated.irn, acknowledgementNumber: validated.acknowledgementNumber, acknowledgementAt,
            signedPayload: json(validated.signedPayload), qrData: validated.qrData, evidenceHash: hashCanonical(evidence), rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Outbound e-invoice changed before provider acknowledgement was committed.');
        const row = await db.erpTaxDocument.findUniqueOrThrow({ where: { id: existing.id } });
        const response = taxDocumentDto(row);
        await audit(db, { action: 'mesaerp.india_compliance.outbound_e_invoice.acknowledge_provider', entity: 'ErpTaxDocument', entityId: row.id, before: taxDocumentDto(existing), after: response });
        await appendOutbox(db, context, legalEntityId, row.id, 'mesaerp.outbound-e-invoice.acknowledged.v1', response);
        return response;
      },
    });
  }

  importOutboundEInvoiceAcknowledgement(legalEntityId: string, documentId: string, input: OutboundEInvoiceManualAck, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runIdempotent({
      legalEntityId, scope: `india-compliance:outbound-e-invoice:${documentId}:manual-ack`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        signedPayloadHashMatches(input.signedPayload, input.signedPayloadHash);
        const existing = await db.erpTaxDocument.findFirst({ where: { id: documentId, legalEntityId, documentKind: 'outbound_e_invoice' } });
        if (!existing) throw new ApiError(404, 'tax_document_not_found', 'Outbound e-invoice not found.');
        assertVersionAndStatus(existing, input.expectedRowVersion, ['approved']);
        const retainedEvidence = externalEvidencePayload(input);
        const verification = verifyExternalEvidence({
          organizationId: context.organizationId,
          legalEntityId,
          evidenceKind: 'outbound_e_invoice_manual_ack',
          sourceRecordType: 'ErpTaxDocument',
          sourceRecordId: existing.id,
          evidence: retainedEvidence,
        }, input.externalVerification);
        const duplicateIrn = await db.erpTaxDocument.findFirst({ where: { legalEntityId, irn: input.irn, id: { not: existing.id } }, select: { id: true } });
        if (duplicateIrn) throw new ApiError(409, 'irn_exists', 'IRN is already recorded in this company.');
        const evidence = { submittedPayloadHash: hashCanonical(existing.submittedPayload), acknowledgement: retainedEvidence, externalVerification: verification };
        const changed = await db.erpTaxDocument.updateMany({
          where: { id: existing.id, status: 'approved', rowVersion: input.expectedRowVersion },
          data: {
            status: 'acknowledged', provider: input.provider, providerReference: input.providerReference, irn: input.irn,
            acknowledgementNumber: input.acknowledgementNumber, acknowledgementAt: new Date(input.acknowledgementAt),
            signedPayload: json(input.signedPayload), qrData: input.qrData,
            reconciliation: appendHistory(existing.reconciliation, 'externally_verified_acknowledgement', { retainedEvidence, externalVerification: verification }),
            evidenceHash: hashCanonical(evidence), rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Outbound e-invoice changed while acknowledgement was imported.');
        const row = await db.erpTaxDocument.findUniqueOrThrow({ where: { id: existing.id } });
        const response = taxDocumentDto(row);
        await audit(db, { action: 'mesaerp.india_compliance.outbound_e_invoice.acknowledge_manual', entity: 'ErpTaxDocument', entityId: row.id, before: taxDocumentDto(existing), after: response });
        await appendOutbox(db, context, legalEntityId, row.id, 'mesaerp.outbound-e-invoice.acknowledged.v1', response);
        return response;
      },
    });
  }

  cancelOutboundEInvoice(legalEntityId: string, documentId: string, input: StatutoryCancel, idempotencyKey: string): Promise<TaxDocumentDto> {
    return this.cancelThroughProvider(legalEntityId, 'outbound_e_invoice', documentId, input, idempotencyKey);
  }

  createEWayBill(legalEntityId: string, input: EWayBillCreate, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runIdempotent({
      legalEntityId, scope: `india-compliance:e-way-bill:create:${legalEntityId}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        const entity = await requireLegalEntity(db, context, legalEntityId);
        requireRegisteredGstin(entity, input.supplierGstin);
        const source = await db.erpDocument.findFirst({ where: { id: input.sourceDocumentId, legalEntityId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
        if (!source || !['sales_invoice', 'delivery_challan'].includes(source.documentType)) throw new ApiError(404, 'movement_document_not_found', 'Approved invoice or delivery challan not found.');
        if (source.status !== 'approved') throw new ApiError(409, 'movement_document_not_approved', 'E-way bill requires an approved movement document.');
        const party = record(source.partySnapshot);
        if (typeof party.gstin === 'string' && party.gstin && party.gstin.toUpperCase() !== input.recipientGstin) throw new ApiError(422, 'recipient_gstin_mismatch', 'Recipient GSTIN differs from the movement document snapshot.');
        const profile = await resolveProfile(db, legalEntityId, 'e_way_bill', source.documentDate);
        const decision = evaluateApplicability({ profile, documentType: input.documentType, supplyType: input.supplyType, documentValue: source.grandTotal.toString(), distanceKm: input.distanceKm, documentDate: day(source.documentDate) });
        if (!decision.applicable) throw new ApiError(409, 'artifact_not_applicable', `E-way bill is not applicable under profile ${profile.version}: ${decision.reasons.join(', ')}.`);
        const year = await financialYearFor(db, legalEntityId, source.documentDate);
        const duplicate = await db.erpTaxDocument.findFirst({ where: { legalEntityId, sourceDocumentId: source.id, documentKind: 'e_way_bill', status: { not: 'cancelled' } }, select: { id: true } });
        if (duplicate) throw new ApiError(409, 'e_way_bill_source_exists', 'An active or pending e-way bill already exists for this source document.');
        const payload = {
          schema: 'mesaerp.india.e-way-bill.v1', supplierGstin: input.supplierGstin, recipientGstin: input.recipientGstin,
          documentType: input.documentType, documentNumber: source.documentNumber, documentDate: day(source.documentDate),
          supplyType: input.supplyType, subSupplyType: input.subSupplyType, transactionType: input.transactionType,
          distanceKm: input.distanceKm, documentValue: source.grandTotal.toString(), transporter: input.transporter, vehicle: input.vehicle,
          lines: source.lines.map((line) => ({ description: line.description, hsnSacCode: line.hsnSacCode, quantity: line.quantity.toString(), uom: line.uom, taxableAmount: line.taxableAmount.toString(), taxAmount: line.taxAmount.toString(), lineTotal: line.lineTotal.toString() })),
          applicability: decision,
        };
        const row = await db.erpTaxDocument.create({
          data: {
            organizationId: context.organizationId, legalEntityId, financialYearId: year.id, sourceDocumentId: source.id,
            documentKind: 'e_way_bill', status: 'draft', supplierGstin: input.supplierGstin, recipientGstin: input.recipientGstin,
            documentType: input.documentType, documentNumber: source.documentNumber, documentDate: source.documentDate,
            submittedPayload: json(payload), transporter: json(input.transporter), vehicle: json(input.vehicle),
            reconciliation: withControl({ applicability: decision }, { makerMembershipId: context.membershipId }),
            ruleProfileVersion: profile.version, evidenceHash: hashCanonical(payload), createIdempotencyKey: `e-way-bill:${idempotencyKey}`,
          },
        });
        const response = taxDocumentDto(row);
        await audit(db, { action: 'mesaerp.india_compliance.e_way_bill.create', entity: 'ErpTaxDocument', entityId: row.id, after: response });
        await appendOutbox(db, context, legalEntityId, row.id, 'mesaerp.e-way-bill.created.v1', response);
        return response;
      },
    });
  }

  approveEWayBill(legalEntityId: string, documentId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<TaxDocumentDto> {
    return this.approveTaxDraft(legalEntityId, 'e_way_bill', documentId, input, idempotencyKey);
  }

  generateEWayBill(legalEntityId: string, documentId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runProviderWrite({
      legalEntityId, scope: `india-compliance:e-way-bill:${documentId}:generate`, key: idempotencyKey, payload: input,
      prepare: async (db) => {
        const row = await db.erpTaxDocument.findFirst({ where: { id: documentId, legalEntityId, documentKind: 'e_way_bill' } });
        if (!row) throw new ApiError(404, 'tax_document_not_found', 'E-way bill not found.');
        assertVersionAndStatus(row, input.expectedRowVersion, ['approved']);
        return { documentId: row.id, expectedRowVersion: row.rowVersion, payload: record(row.submittedPayload) };
      },
      invoke: (prepared) => this.provider.generateEWayBill(prepared.payload, idempotencyKey),
      commit: (db, context, prepared, result) => this.commitGeneratedEWayBill(db, context, legalEntityId, prepared.documentId, prepared.expectedRowVersion, result),
    });
  }

  private async commitGeneratedEWayBill(db: Db, context: TenantCtx, legalEntityId: string, documentId: string, expectedVersion: number, result: EWayBillProviderAcknowledgement) {
    requireProviderEvidence(result.provider, result.providerReference, result.signedPayload, 'E-way-bill provider');
    if (!/^[0-9]{12}$/.test(result.eWayBillNumber)) throw new ApiError(502, 'provider_response_invalid', 'Provider returned an invalid e-way-bill number.');
    const issuedAt = validateTimestamp(result.issuedAt, 'E-way-bill provider');
    const validUntil = validateTimestamp(result.validUntil, 'E-way-bill provider');
    if (validUntil <= issuedAt) throw new ApiError(502, 'provider_response_invalid', 'Provider returned invalid e-way-bill validity.');
    const existing = await db.erpTaxDocument.findFirstOrThrow({ where: { id: documentId, legalEntityId, documentKind: 'e_way_bill' } });
    assertVersionAndStatus(existing, expectedVersion, ['approved']);
    const duplicate = await db.erpTaxDocument.findFirst({ where: { legalEntityId, documentKind: 'e_way_bill', acknowledgementNumber: result.eWayBillNumber, id: { not: existing.id } }, select: { id: true } });
    if (duplicate) throw new ApiError(409, 'e_way_bill_number_exists', 'E-way-bill number is already recorded in this company.');
    const evidence = { providerReference: result.providerReference, eWayBillNumber: result.eWayBillNumber, issuedAt: result.issuedAt, validUntil: result.validUntil, signedPayloadHash: hashCanonical(result.signedPayload) };
    const changed = await db.erpTaxDocument.updateMany({
      where: { id: existing.id, status: 'approved', rowVersion: expectedVersion },
      data: {
        status: 'active', provider: result.provider, providerReference: result.providerReference, acknowledgementNumber: result.eWayBillNumber,
        acknowledgementAt: issuedAt, validUntil, signedPayload: json(result.signedPayload), evidenceHash: hashCanonical(evidence), rowVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'E-way bill changed before provider acknowledgement was committed.');
    const row = await db.erpTaxDocument.findUniqueOrThrow({ where: { id: existing.id } });
    const response = taxDocumentDto(row);
    await audit(db, { action: 'mesaerp.india_compliance.e_way_bill.generate', entity: 'ErpTaxDocument', entityId: row.id, before: taxDocumentDto(existing), after: response });
    await appendOutbox(db, context, legalEntityId, row.id, 'mesaerp.e-way-bill.active.v1', response);
    return response;
  }

  createExternalEWayBill(legalEntityId: string, input: ExternalEWayBillCreate, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runIdempotent({
      legalEntityId, scope: `india-compliance:e-way-bill:external:${legalEntityId}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        signedPayloadHashMatches(input.evidence, input.evidenceHash);
        const entity = await requireLegalEntity(db, context, legalEntityId);
        requireRegisteredGstin(entity, input.supplierGstin);
        const businessDate = dateOnly(input.businessDate);
        const year = await financialYearFor(db, legalEntityId, businessDate);
        let sourceDocumentId: string | null = null;
        if (input.sourceDocumentId) {
          const source = await db.erpDocument.findFirst({ where: { id: input.sourceDocumentId, legalEntityId } });
          if (!source) throw new ApiError(404, 'movement_document_not_found', 'Movement source document not found in this company.');
          if (source.documentNumber !== input.documentNumber) throw new ApiError(422, 'movement_document_identity_mismatch', 'External evidence document number differs from the source document.');
          sourceDocumentId = source.id;
        }
        const retainedEvidence = externalEvidencePayload(input);
        const verification = verifyExternalEvidence({
          organizationId: context.organizationId,
          legalEntityId,
          evidenceKind: 'external_e_way_bill',
          ...externalEWayBillSource(input),
          evidence: retainedEvidence,
        }, input.externalVerification);
        const duplicate = await db.erpTaxDocument.findFirst({ where: { legalEntityId, documentKind: 'e_way_bill', acknowledgementNumber: input.eWayBillNumber }, select: { id: true } });
        if (duplicate) throw new ApiError(409, 'e_way_bill_number_exists', 'E-way-bill number is already recorded in this company.');
        const row = await db.erpTaxDocument.create({
          data: {
            organizationId: context.organizationId, legalEntityId, financialYearId: year.id, sourceDocumentId,
            documentKind: 'e_way_bill', provider: 'external_verifier', providerReference: input.externalVerification.verifierReference, status: 'external_pending',
            supplierGstin: input.supplierGstin, recipientGstin: input.recipientGstin, documentType: input.documentType,
            documentNumber: input.documentNumber, documentDate: businessDate, acknowledgementNumber: input.eWayBillNumber,
            acknowledgementAt: new Date(input.issuedAt), signedPayload: json(input.evidence), submittedPayload: json(retainedEvidence), transporter: json(input.transporter), vehicle: json(input.vehicle),
            validUntil: new Date(input.validUntil), reconciliation: withControl({ externalVerification: verification }, { makerMembershipId: context.membershipId }),
            evidenceHash: verification.evidenceHash, createIdempotencyKey: `external-e-way-bill:${idempotencyKey}`,
          },
        });
        const response = taxDocumentDto(row);
        await audit(db, { action: 'mesaerp.india_compliance.e_way_bill.external_evidence_create', entity: 'ErpTaxDocument', entityId: row.id, after: response });
        return response;
      },
    });
  }

  verifyExternalEWayBill(legalEntityId: string, documentId: string, input: IndiaRowVersion, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runIdempotent({
      legalEntityId, scope: `india-compliance:e-way-bill:${documentId}:verify-external`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        const existing = await db.erpTaxDocument.findFirst({ where: { id: documentId, legalEntityId, documentKind: 'e_way_bill' } });
        if (!existing) throw new ApiError(404, 'tax_document_not_found', 'External e-way bill not found.');
        assertVersionAndStatus(existing, input.expectedRowVersion, ['external_pending']);
        assertMakerChecker(existing.reconciliation, context.membershipId, 'External e-way-bill evidence');
        if (!existing.validUntil || existing.validUntil <= new Date()) throw new ApiError(409, 'external_e_way_bill_expired', 'External e-way-bill evidence is already expired.');
        assertStoredEvidence({
          row: existing,
          evidenceKind: 'external_e_way_bill',
          source: externalEWayBillSource({
            sourceDocumentId: existing.sourceDocumentId ?? undefined,
            documentType: existing.documentType as ExternalEWayBillCreate['documentType'],
            documentNumber: existing.documentNumber,
            eWayBillNumber: existing.acknowledgementNumber,
          }),
        });
        const reconciliation = withControl(existing.reconciliation, { approvedBy: context.membershipId, approvedAt: new Date().toISOString(), verificationMethod: 'externally_verified_hmac' });
        const changed = await db.erpTaxDocument.updateMany({ where: { id: existing.id, status: 'external_pending', rowVersion: input.expectedRowVersion }, data: { status: 'active', reconciliation, rowVersion: { increment: 1 } } });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'External e-way-bill evidence changed during verification.');
        const row = await db.erpTaxDocument.findUniqueOrThrow({ where: { id: existing.id } });
        const response = taxDocumentDto(row);
        await audit(db, { action: 'mesaerp.india_compliance.e_way_bill.external_evidence_verify', entity: 'ErpTaxDocument', entityId: row.id, before: taxDocumentDto(existing), after: response });
        await appendOutbox(db, context, legalEntityId, row.id, 'mesaerp.e-way-bill.external-verified.v1', response);
        return response;
      },
    });
  }

  updateEWayBillVehicle(legalEntityId: string, documentId: string, input: EWayVehicleUpdate, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runProviderWrite({
      legalEntityId, scope: `india-compliance:e-way-bill:${documentId}:vehicle`, key: idempotencyKey, payload: input,
      prepare: (db) => this.prepareActiveEWayBill(db, legalEntityId, documentId, input.expectedRowVersion, { vehicle: input.vehicle, reasonCode: input.reasonCode, reason: input.reason }),
      invoke: (prepared) => this.provider.updateEWayBillVehicle(prepared.request, idempotencyKey),
      commit: (db, context, prepared, result) => this.commitVehicleUpdate(db, context, legalEntityId, prepared.documentId, prepared.expectedRowVersion, input, result),
    });
  }

  extendEWayBill(legalEntityId: string, documentId: string, input: EWayExtend, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runProviderWrite({
      legalEntityId, scope: `india-compliance:e-way-bill:${documentId}:extend`, key: idempotencyKey, payload: input,
      prepare: (db) => this.prepareActiveEWayBill(db, legalEntityId, documentId, input.expectedRowVersion, input, true),
      invoke: (prepared) => this.provider.extendEWayBill(prepared.request, idempotencyKey),
      commit: (db, context, prepared, result) => this.commitExtension(db, context, legalEntityId, prepared.documentId, prepared.expectedRowVersion, input, result),
    });
  }

  private async prepareActiveEWayBill(db: Db, legalEntityId: string, documentId: string, expectedRowVersion: number, action: unknown, allowExpired = false) {
    const row = await db.erpTaxDocument.findFirst({ where: { id: documentId, legalEntityId, documentKind: 'e_way_bill' } });
    if (!row) throw new ApiError(404, 'tax_document_not_found', 'E-way bill not found.');
    assertVersionAndStatus(row, expectedRowVersion, ['active']);
    if (!row.validUntil) throw new ApiError(409, 'e_way_bill_validity_missing', 'E-way bill has no recorded validity window.');
    if (!allowExpired && row.validUntil <= new Date()) throw new ApiError(409, 'e_way_bill_expired', 'E-way bill is expired. Use the provider-supported extension rules where legally available.');
    return { documentId: row.id, expectedRowVersion: row.rowVersion, request: { eWayBillNumber: row.acknowledgementNumber, supplierGstin: row.supplierGstin, action } };
  }

  private async commitVehicleUpdate(db: Db, context: TenantCtx, legalEntityId: string, documentId: string, expectedVersion: number, input: EWayVehicleUpdate, result: ProviderVehicleUpdate) {
    requireProviderEvidence('configured_adapter', result.providerReference, result.evidence, 'Vehicle-update provider');
    validateTimestamp(result.updatedAt, 'Vehicle-update provider');
    const existing = await db.erpTaxDocument.findFirstOrThrow({ where: { id: documentId, legalEntityId, documentKind: 'e_way_bill' } });
    assertVersionAndStatus(existing, expectedVersion, ['active']);
    const reconciliation = appendHistory(existing.reconciliation, 'vehicle_update', { request: input, provider: result });
    const evidenceHash = hashCanonical({ previous: existing.evidenceHash, vehicle: input.vehicle, provider: result });
    const changed = await db.erpTaxDocument.updateMany({ where: { id: existing.id, status: 'active', rowVersion: expectedVersion }, data: { vehicle: json(input.vehicle), reconciliation, evidenceHash, rowVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'E-way bill changed before vehicle update was committed.');
    const row = await db.erpTaxDocument.findUniqueOrThrow({ where: { id: existing.id } });
    const response = taxDocumentDto(row);
    await audit(db, { action: 'mesaerp.india_compliance.e_way_bill.vehicle_update', entity: 'ErpTaxDocument', entityId: row.id, before: taxDocumentDto(existing), after: response });
    await appendOutbox(db, context, legalEntityId, row.id, 'mesaerp.e-way-bill.vehicle-updated.v1', response);
    return response;
  }

  private async commitExtension(db: Db, context: TenantCtx, legalEntityId: string, documentId: string, expectedVersion: number, input: EWayExtend, result: ProviderValidityExtension) {
    requireProviderEvidence('configured_adapter', result.providerReference, result.evidence, 'Validity-extension provider');
    validateTimestamp(result.extendedAt, 'Validity-extension provider');
    const validUntil = validateTimestamp(result.validUntil, 'Validity-extension provider');
    const existing = await db.erpTaxDocument.findFirstOrThrow({ where: { id: documentId, legalEntityId, documentKind: 'e_way_bill' } });
    assertVersionAndStatus(existing, expectedVersion, ['active']);
    if (existing.validUntil && validUntil <= existing.validUntil) throw new ApiError(502, 'provider_response_invalid', 'Provider did not extend e-way-bill validity.');
    const reconciliation = appendHistory(existing.reconciliation, 'validity_extension', { request: input, provider: result });
    const evidenceHash = hashCanonical({ previous: existing.evidenceHash, validUntil: result.validUntil, provider: result });
    const changed = await db.erpTaxDocument.updateMany({ where: { id: existing.id, status: 'active', rowVersion: expectedVersion }, data: { validUntil, vehicle: json(input.vehicle), reconciliation, evidenceHash, rowVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'E-way bill changed before validity extension was committed.');
    const row = await db.erpTaxDocument.findUniqueOrThrow({ where: { id: existing.id } });
    const response = taxDocumentDto(row);
    await audit(db, { action: 'mesaerp.india_compliance.e_way_bill.extend', entity: 'ErpTaxDocument', entityId: row.id, before: taxDocumentDto(existing), after: response });
    await appendOutbox(db, context, legalEntityId, row.id, 'mesaerp.e-way-bill.extended.v1', response);
    return response;
  }

  cancelEWayBill(legalEntityId: string, documentId: string, input: StatutoryCancel, idempotencyKey: string): Promise<TaxDocumentDto> {
    return this.cancelThroughProvider(legalEntityId, 'e_way_bill', documentId, input, idempotencyKey);
  }

  private cancelThroughProvider(legalEntityId: string, kind: 'outbound_e_invoice' | 'e_way_bill', documentId: string, input: StatutoryCancel, idempotencyKey: string): Promise<TaxDocumentDto> {
    const activeStatus = kind === 'outbound_e_invoice' ? 'acknowledged' : 'active';
    return runProviderWrite({
      legalEntityId, scope: `india-compliance:${kind}:${documentId}:cancel`, key: idempotencyKey, payload: input,
      prepare: async (db, context) => {
        const row = await db.erpTaxDocument.findFirst({ where: { id: documentId, legalEntityId, documentKind: kind } });
        if (!row) throw new ApiError(404, 'tax_document_not_found', 'Compliance document not found.');
        assertVersionAndStatus(row, input.expectedRowVersion, [activeStatus]);
        assertMakerChecker(row.reconciliation, context.membershipId, 'Statutory cancellation');
        return { documentId: row.id, expectedRowVersion: row.rowVersion, request: { irn: row.irn, eWayBillNumber: row.acknowledgementNumber, supplierGstin: row.supplierGstin, reasonCode: input.reasonCode, reason: input.reason } };
      },
      invoke: (prepared) => kind === 'outbound_e_invoice'
        ? this.provider.cancelEInvoice(prepared.request, idempotencyKey)
        : this.provider.cancelEWayBill(prepared.request, idempotencyKey),
      commit: (db, context, prepared, result) => this.commitCancellation(db, context, legalEntityId, kind, activeStatus, prepared.documentId, prepared.expectedRowVersion, input, result),
    });
  }

  private async commitCancellation(db: Db, context: TenantCtx, legalEntityId: string, kind: 'outbound_e_invoice' | 'e_way_bill', activeStatus: string, documentId: string, expectedVersion: number, input: StatutoryCancel, result: ProviderCancellation) {
    requireProviderEvidence('configured_adapter', result.providerReference, result.evidence, 'Cancellation provider');
    validateTimestamp(result.cancelledAt, 'Cancellation provider');
    const existing = await db.erpTaxDocument.findFirstOrThrow({ where: { id: documentId, legalEntityId, documentKind: kind } });
    assertVersionAndStatus(existing, expectedVersion, [activeStatus]);
    const cancellation = { reasonCode: input.reasonCode, reason: input.reason, providerReference: result.providerReference, cancelledAt: result.cancelledAt, evidence: result.evidence };
    const evidenceHash = hashCanonical({ previous: existing.evidenceHash, cancellation });
    const changed = await db.erpTaxDocument.updateMany({ where: { id: existing.id, status: activeStatus, rowVersion: expectedVersion }, data: { status: 'cancelled', cancellation: json(cancellation), evidenceHash, rowVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Compliance document changed before cancellation was committed.');
    const row = await db.erpTaxDocument.findUniqueOrThrow({ where: { id: existing.id } });
    const response = taxDocumentDto(row);
    await audit(db, { action: `mesaerp.india_compliance.${kind}.cancel`, entity: 'ErpTaxDocument', entityId: row.id, before: taxDocumentDto(existing), after: response });
    await appendOutbox(db, context, legalEntityId, row.id, `mesaerp.${kind.replaceAll('_', '-')}.cancelled.v1`, response);
    return response;
  }

  createInboundEInvoice(legalEntityId: string, input: InboundEInvoiceCreate, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runIdempotent({
      legalEntityId, scope: `india-compliance:inbound-e-invoice:create:${legalEntityId}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        signedPayloadHashMatches(input.signedPayload, input.signedPayloadHash);
        const entity = await requireLegalEntity(db, context, legalEntityId);
        requireRegisteredGstin(entity, input.recipientGstin);
        const documentDate = dateOnly(input.documentDate);
        const year = await financialYearFor(db, legalEntityId, documentDate);
        const duplicateIrn = await db.erpTaxDocument.findFirst({ where: { legalEntityId, irn: input.irn }, select: { id: true } });
        if (duplicateIrn) throw new ApiError(409, 'irn_exists', 'IRN is already recorded in this company.');
        const duplicateIdentity = await db.erpTaxDocument.findFirst({ where: { legalEntityId, documentKind: 'inbound_e_invoice', supplierGstin: input.supplierGstin, documentType: input.documentType, documentNumber: input.documentNumber, financialYearId: year.id }, select: { id: true } });
        if (duplicateIdentity) throw new ApiError(409, 'supplier_invoice_identity_exists', 'Supplier GSTIN and invoice identity is already recorded in this financial year.');
        let sourceDocumentId: string | null = null;
        if (input.sourceDocumentId) {
          const supplierInvoice = await db.erpDocument.findFirst({ where: { id: input.sourceDocumentId, legalEntityId, documentType: 'supplier_invoice' } });
          if (!supplierInvoice) throw new ApiError(404, 'supplier_invoice_not_found', 'Supplier invoice not found in this company.');
          if (!['submitted', 'approved'].includes(supplierInvoice.status)) throw new ApiError(409, 'supplier_invoice_not_ready', 'Supplier invoice must be submitted or approved.');
          const party = record(supplierInvoice.partySnapshot);
          if (typeof party.gstin === 'string' && party.gstin && party.gstin.toUpperCase() !== input.supplierGstin) throw new ApiError(422, 'supplier_gstin_mismatch', 'Inbound GSTIN differs from supplier invoice snapshot.');
          if (!supplierInvoice.grandTotal.equals(input.totalAmount)) throw new ApiError(422, 'supplier_invoice_total_mismatch', 'Inbound e-invoice total differs from the supplier invoice.');
          sourceDocumentId = supplierInvoice.id;
        }
        const payload = externalEvidencePayload(input);
        const verification = verifyExternalEvidence({
          organizationId: context.organizationId,
          legalEntityId,
          evidenceKind: 'inbound_e_invoice',
          ...inboundEInvoiceSource(input),
          evidence: payload,
        }, input.externalVerification);
        const row = await db.erpTaxDocument.create({
          data: {
            organizationId: context.organizationId, legalEntityId, financialYearId: year.id, sourceDocumentId,
            documentKind: 'inbound_e_invoice', provider: input.provider, providerReference: input.providerReference, status: 'received',
            supplierGstin: input.supplierGstin, recipientGstin: input.recipientGstin, documentType: input.documentType,
            documentNumber: input.documentNumber, documentDate, irn: input.irn, acknowledgementNumber: input.acknowledgementNumber,
            acknowledgementAt: new Date(input.acknowledgementAt), signedPayload: json(input.signedPayload), submittedPayload: json(payload),
            reconciliation: withControl({ origin: input.origin, externalVerification: verification }, { makerMembershipId: context.membershipId }),
            itcStatus: 'pending', evidenceHash: verification.evidenceHash, createIdempotencyKey: `inbound-e-invoice:${idempotencyKey}`,
          },
        });
        const response = taxDocumentDto(row);
        await audit(db, { action: 'mesaerp.india_compliance.inbound_e_invoice.receive', entity: 'ErpTaxDocument', entityId: row.id, after: response });
        await appendOutbox(db, context, legalEntityId, row.id, 'mesaerp.inbound-e-invoice.received.v1', response);
        return response;
      },
    });
  }

  uploadGstr2b(legalEntityId: string, input: Gstr2bUpload, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runIdempotent({
      legalEntityId, scope: `india-compliance:gstr2b:upload:${legalEntityId}`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        signedPayloadHashMatches(input.sourcePayload, input.sourcePayloadHash);
        const entity = await requireLegalEntity(db, context, legalEntityId);
        requireRegisteredGstin(entity, input.recipientGstin);
        const generatedAt = new Date(input.generatedAt);
        const year = await financialYearFor(db, legalEntityId, generatedAt);
        const duplicate = await db.erpTaxDocument.findFirst({ where: { legalEntityId, documentKind: 'gstr2b', recipientGstin: input.recipientGstin, documentNumber: input.returnPeriod }, select: { id: true } });
        if (duplicate) throw new ApiError(409, 'gstr2b_period_exists', 'A GSTR-2B upload already exists for this recipient GSTIN and return period.');
        const submitted = externalEvidencePayload(input);
        const verification = verifyExternalEvidence({
          organizationId: context.organizationId,
          legalEntityId,
          evidenceKind: 'gstr2b_upload',
          ...gstr2bSource(input),
          evidence: submitted,
        }, input.externalVerification);
        const row = await db.erpTaxDocument.create({
          data: {
            organizationId: context.organizationId, legalEntityId, financialYearId: year.id, documentKind: 'gstr2b',
            provider: 'external_verifier', providerReference: input.externalVerification.verifierReference, status: 'imported', recipientGstin: input.recipientGstin,
            documentType: 'GSTR2B', documentNumber: input.returnPeriod, documentDate: generatedAt, signedPayload: json(input.sourcePayload),
            submittedPayload: json(submitted), reconciliation: withControl({ externalVerification: verification }, { makerMembershipId: context.membershipId }),
            evidenceHash: verification.evidenceHash, createIdempotencyKey: `gstr2b:${idempotencyKey}`,
          },
        });
        const response = taxDocumentDto(row);
        await audit(db, { action: 'mesaerp.india_compliance.gstr2b.upload', entity: 'ErpTaxDocument', entityId: row.id, after: response });
        await appendOutbox(db, context, legalEntityId, row.id, 'mesaerp.gstr2b.imported.v1', response);
        return response;
      },
    });
  }

  reconcileInboundEInvoice(legalEntityId: string, documentId: string, input: InboundGstr2bReconcile, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runIdempotent({
      legalEntityId, scope: `india-compliance:inbound-e-invoice:${documentId}:reconcile`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        const inbound = await db.erpTaxDocument.findFirst({ where: { id: documentId, legalEntityId, documentKind: 'inbound_e_invoice' } });
        if (!inbound) throw new ApiError(404, 'tax_document_not_found', 'Inbound e-invoice not found.');
        assertVersionAndStatus(inbound, input.expectedRowVersion, ['received', 'reconciled']);
        const gstr2b = await db.erpTaxDocument.findFirst({ where: { id: input.gstr2bDocumentId, legalEntityId, documentKind: 'gstr2b', status: 'imported' } });
        if (!gstr2b) throw new ApiError(404, 'gstr2b_not_found', 'GSTR-2B evidence not found in this company.');
        if (gstr2b.recipientGstin !== inbound.recipientGstin) throw new ApiError(422, 'gstr2b_recipient_mismatch', 'GSTR-2B recipient GSTIN differs from the inbound invoice.');
        if (!inbound.documentDate) throw new ApiError(409, 'external_evidence_envelope_mismatch', 'Inbound evidence is missing its signed source date.');
        assertStoredEvidence({
          row: inbound,
          evidenceKind: 'inbound_e_invoice',
          source: inboundEInvoiceSource({
            sourceDocumentId: inbound.sourceDocumentId ?? undefined,
            supplierGstin: inbound.supplierGstin,
            documentType: inbound.documentType as InboundEInvoiceCreate['documentType'],
            documentNumber: inbound.documentNumber,
            documentDate: day(inbound.documentDate),
          }),
        });
        assertStoredEvidence({
          row: gstr2b,
          evidenceKind: 'gstr2b_upload',
          source: gstr2bSource({ recipientGstin: gstr2b.recipientGstin, returnPeriod: gstr2b.documentNumber }),
        });
        const entries = record(gstr2b.submittedPayload).entries;
        const candidate = Array.isArray(entries) ? entries.find((entry) => {
          const row = record(entry);
          return row.supplierGstin === inbound.supplierGstin && row.documentType === inbound.documentType && row.documentNumber === inbound.documentNumber;
        }) as Gstr2bEntry | undefined : undefined;
        const inboundPayload = record(inbound.submittedPayload);
        let itcStatus: TaxDocumentDto['itcStatus'] = 'pending';
        let result = 'not_found';
        const differences: string[] = [];
        if (candidate) {
          if (candidate.irn && candidate.irn !== inbound.irn) differences.push('irn');
          for (const field of ['taxableValue', 'taxAmount', 'totalAmount'] as const) {
            if (!new Prisma.Decimal(candidate[field]).equals(String(inboundPayload[field] ?? '0'))) differences.push(field);
          }
          if (candidate.portalItcAvailability === 'not_available') {
            itcStatus = 'blocked'; result = 'portal_not_available';
          } else if (candidate.portalItcAvailability === 'reversal') {
            itcStatus = 'reversed'; result = 'portal_reversal';
          } else if (differences.length) {
            itcStatus = 'mismatched'; result = 'amount_or_irn_mismatch';
          } else {
            itcStatus = 'eligible'; result = 'matched';
          }
        }
        const reconciliationEvidence = {
          gstr2bDocumentId: gstr2b.id, returnPeriod: gstr2b.documentNumber, result, differences,
          matchedEntry: candidate ?? null, reconciledAt: new Date().toISOString(), reconciledBy: context.membershipId,
        };
        const reconciliation = appendHistory(inbound.reconciliation, 'gstr2b_reconciliation', reconciliationEvidence);
        const evidenceHash = hashCanonical({ previous: inbound.evidenceHash, reconciliationEvidence, itcStatus });
        const changed = await db.erpTaxDocument.updateMany({ where: { id: inbound.id, rowVersion: input.expectedRowVersion }, data: { status: 'reconciled', reconciliation, itcStatus, evidenceHash, rowVersion: { increment: 1 } } });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Inbound e-invoice changed while reconciliation was saved.');
        const row = await db.erpTaxDocument.findUniqueOrThrow({ where: { id: inbound.id } });
        const response = taxDocumentDto(row);
        await audit(db, { action: 'mesaerp.india_compliance.inbound_e_invoice.reconcile_gstr2b', entity: 'ErpTaxDocument', entityId: row.id, before: taxDocumentDto(inbound), after: response });
        await appendOutbox(db, context, legalEntityId, row.id, 'mesaerp.inbound-e-invoice.reconciled.v1', response);
        return response;
      },
    });
  }

  decideInboundItc(legalEntityId: string, documentId: string, input: InboundItcDecision, idempotencyKey: string): Promise<TaxDocumentDto> {
    return runIdempotent({
      legalEntityId, scope: `india-compliance:inbound-e-invoice:${documentId}:itc`, key: idempotencyKey, payload: input,
      execute: async (db, context) => {
        const inbound = await db.erpTaxDocument.findFirst({ where: { id: documentId, legalEntityId, documentKind: 'inbound_e_invoice' } });
        if (!inbound) throw new ApiError(404, 'tax_document_not_found', 'Inbound e-invoice not found.');
        assertVersionAndStatus(inbound, input.expectedRowVersion, ['received', 'reconciled']);
        assertMakerChecker(inbound.reconciliation, context.membershipId, 'ITC decision');
        if (input.status === 'claimed' && inbound.itcStatus !== 'eligible') throw new ApiError(409, 'itc_not_claimable', 'Only reconciled eligible ITC may be marked claimed.');
        if (input.status === 'reversed' && !['eligible', 'claimed'].includes(inbound.itcStatus)) throw new ApiError(409, 'itc_not_reversible', 'Only eligible or claimed ITC may be reversed.');
        if (input.status === 'claimed') {
          if (!inbound.documentDate) throw new ApiError(409, 'external_evidence_envelope_mismatch', 'Inbound evidence is missing its signed source date.');
          assertStoredEvidence({
            row: inbound,
            evidenceKind: 'inbound_e_invoice',
            source: inboundEInvoiceSource({
              sourceDocumentId: inbound.sourceDocumentId ?? undefined,
              supplierGstin: inbound.supplierGstin,
              documentType: inbound.documentType as InboundEInvoiceCreate['documentType'],
              documentNumber: inbound.documentNumber,
              documentDate: day(inbound.documentDate),
            }),
          });
          const gstr2bDocumentId = latestGstr2bDocumentId(inbound.reconciliation);
          const gstr2b = gstr2bDocumentId
            ? await db.erpTaxDocument.findFirst({ where: { id: gstr2bDocumentId, legalEntityId, documentKind: 'gstr2b', status: 'imported' } })
            : null;
          if (!gstr2b) throw new ApiError(409, 'externally_verified_gstr2b_required', 'Claiming ITC requires the externally verified GSTR-2B evidence used for reconciliation.');
          assertStoredEvidence({
            row: gstr2b,
            evidenceKind: 'gstr2b_upload',
            source: gstr2bSource({ recipientGstin: gstr2b.recipientGstin, returnPeriod: gstr2b.documentNumber }),
          });
        }
        const decision = { status: input.status, reason: input.reason, decidedAt: new Date().toISOString(), decidedBy: context.membershipId, previousStatus: inbound.itcStatus };
        const reconciliation = appendHistory(inbound.reconciliation, 'itc_decision', decision);
        const evidenceHash = hashCanonical({ previous: inbound.evidenceHash, decision });
        const changed = await db.erpTaxDocument.updateMany({ where: { id: inbound.id, rowVersion: input.expectedRowVersion }, data: { reconciliation, itcStatus: input.status, evidenceHash, rowVersion: { increment: 1 } } });
        if (changed.count !== 1) throw new ApiError(409, 'version_conflict', 'Inbound e-invoice changed while ITC decision was saved.');
        const row = await db.erpTaxDocument.findUniqueOrThrow({ where: { id: inbound.id } });
        const response = taxDocumentDto(row);
        await audit(db, { action: `mesaerp.india_compliance.itc.${input.status}`, entity: 'ErpTaxDocument', entityId: row.id, before: taxDocumentDto(inbound), after: response });
        await appendOutbox(db, context, legalEntityId, row.id, `mesaerp.inbound-e-invoice.itc-${input.status}.v1`, response);
        return response;
      },
    });
  }
}
