import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MesaOpsStatutoryRuleProfile, Prisma } from '@prisma/client';
import { canonicalHash } from '../../lib/canonical';
import { ApiError } from '../../middleware/error';

export interface StatutoryRuleProfile {
  version: string;
  countryCode: string;
  movementType: string;
  effectiveFrom: string;
  effectiveTo?: string;
  requiresInvoice: boolean;
  requiresEWayBill: boolean;
  reviewedExemptionReason?: string;
}

export interface StatutoryEvidenceCore {
  source: 'mesaerp_snapshot' | 'external_verified';
  profileVersion: string;
  verificationId: string;
  verifiedAt: string;
  invoiceReference?: string;
  eWayBillReference?: string;
  validUntil?: string;
  artifactHash: string;
  artifact: Record<string, unknown>;
}

// Developer/test bootstrap only. Production never treats an absent profile as
// an exemption: it fails closed until a separate maker/checker has approved a
// first-class MesaOps rule version.
const BOOTSTRAP_PROFILE: StatutoryRuleProfile = {
  version: 'MESAOPS-NONPRODUCTION-BOOTSTRAP-1',
  countryCode: 'IN',
  movementType: '*',
  effectiveFrom: '1970-01-01',
  requiresInvoice: false,
  requiresEWayBill: false,
  reviewedExemptionReason: 'Non-production compatibility only; never selected in NODE_ENV=production.',
};

function rowProfile(row: MesaOpsStatutoryRuleProfile): StatutoryRuleProfile {
  return {
    version: row.version,
    countryCode: row.countryCode,
    movementType: row.movementType,
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
    ...(row.effectiveTo ? { effectiveTo: row.effectiveTo.toISOString().slice(0, 10) } : {}),
    requiresInvoice: row.requiresInvoice,
    requiresEWayBill: row.requiresEWayBill,
    ...(row.reviewedExemptionReason ? { reviewedExemptionReason: row.reviewedExemptionReason } : {}),
  };
}

export function selectStatutoryProfileFromRows(
  rows: MesaOpsStatutoryRuleProfile[],
  input: { businessDate: string; countryCode: string; plantCode: string; movementType: string; environment?: string },
): StatutoryRuleProfile {
  const eligible = rows.filter((profile) => (
    profile.status === 'approved'
    && profile.countryCode === input.countryCode
    && (profile.plantCode === '*' || profile.plantCode === input.plantCode)
    && (profile.movementType === '*' || profile.movementType === input.movementType)
    && profile.effectiveFrom.toISOString().slice(0, 10) <= input.businessDate
    && (!profile.effectiveTo || profile.effectiveTo.toISOString().slice(0, 10) >= input.businessDate)
  ));
  const selected = eligible.sort((a, b) => {
    const aSpecificity = Number(a.plantCode === input.plantCode) * 2 + Number(a.movementType === input.movementType);
    const bSpecificity = Number(b.plantCode === input.plantCode) * 2 + Number(b.movementType === input.movementType);
    return bSpecificity - aSpecificity
      || b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
      || b.version.localeCompare(a.version);
  })[0];
  if (selected) return rowProfile(selected);
  if ((input.environment ?? process.env.NODE_ENV) === 'production') {
    throw new ApiError(
      409,
      'statutory_rule_profile_missing',
      `No approved MesaOps statutory profile covers ${input.countryCode}/${input.plantCode}/${input.movementType} on ${input.businessDate}.`,
    );
  }
  return BOOTSTRAP_PROFILE;
}

export async function selectStatutoryProfile(
  tx: Prisma.TransactionClient,
  input: { businessDate: string; countryCode: string; plantCode: string; movementType: string; environment?: string },
): Promise<StatutoryRuleProfile> {
  const date = new Date(`${input.businessDate}T00:00:00.000Z`);
  const rows = await tx.mesaOpsStatutoryRuleProfile.findMany({
    where: {
      status: 'approved',
      countryCode: input.countryCode,
      plantCode: { in: ['*', input.plantCode] },
      movementType: { in: ['*', input.movementType] },
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    take: 50,
  });
  return selectStatutoryProfileFromRows(rows, input);
}

function evidenceKey(): Buffer | null {
  const encoded = (process.env.MESAORIGINS_OPS_STATUTORY_EVIDENCE_HMAC_KEY || '').trim();
  if (!encoded) return null;
  const key = Buffer.from(encoded, 'base64');
  return key.length >= 32 ? key : null;
}

function evidenceMessage(organizationId: string, operationalOrderId: string, core: StatutoryEvidenceCore): string {
  return `mesaops:statutory-evidence:v1\n${organizationId}\n${operationalOrderId}\n${canonicalHash(core)}`;
}

export function signMesaOpsStatutoryEvidence(organizationId: string, operationalOrderId: string, core: StatutoryEvidenceCore): string {
  const key = evidenceKey();
  if (!key) throw new Error('MESAORIGINS_OPS_STATUTORY_EVIDENCE_HMAC_KEY must be base64 and decode to at least 32 bytes.');
  return createHmac('sha256', key).update(evidenceMessage(organizationId, operationalOrderId, core)).digest('hex');
}

export function verifyMesaOpsStatutoryEvidence(
  organizationId: string,
  operationalOrderId: string,
  profile: StatutoryRuleProfile,
  evidence: (StatutoryEvidenceCore & { signature: string }) | undefined,
): StatutoryEvidenceCore | undefined {
  if (!evidence) {
    if (profile.requiresInvoice || profile.requiresEWayBill) {
      throw new ApiError(409, 'statutory_artifact_required', `Profile ${profile.version} requires verified statutory evidence before physical dispatch.`);
    }
    return undefined;
  }
  const { signature, ...core } = evidence;
  if (core.profileVersion !== profile.version) {
    throw new ApiError(409, 'statutory_profile_stale', 'The statutory evidence was verified against a different rule profile.');
  }
  if (canonicalHash(core.artifact) !== core.artifactHash) {
    throw new ApiError(422, 'statutory_evidence_hash_mismatch', 'The statutory evidence artifact does not match its declared hash.');
  }
  const key = evidenceKey();
  if (!key) throw new ApiError(503, 'statutory_verifier_unavailable', 'The statutory evidence verification credential is not configured.');
  const expected = createHmac('sha256', key).update(evidenceMessage(organizationId, operationalOrderId, core)).digest();
  const supplied = /^[a-f0-9]{64}$/.test(signature) ? Buffer.from(signature, 'hex') : Buffer.alloc(0);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new ApiError(422, 'unverified_statutory_evidence', 'Only evidence signed by MesaERP or an approved external verifier can be used.');
  }
  if (profile.requiresInvoice && !core.invoiceReference) {
    throw new ApiError(409, 'invoice_reference_required', `Profile ${profile.version} requires a verified invoice reference.`);
  }
  if (profile.requiresEWayBill && !core.eWayBillReference) {
    throw new ApiError(409, 'eway_bill_reference_required', `Profile ${profile.version} requires a verified e-way-bill reference.`);
  }
  if (profile.requiresEWayBill) {
    if (!core.validUntil) {
      throw new ApiError(409, 'eway_bill_validity_required', `Profile ${profile.version} requires a verified e-way-bill validity timestamp.`);
    }
    const validUntil = new Date(core.validUntil);
    if (Number.isNaN(validUntil.getTime()) || validUntil <= new Date()) {
      throw new ApiError(409, 'eway_bill_evidence_expired', 'The verified e-way-bill evidence is no longer valid for physical dispatch.');
    }
  }
  return core;
}
