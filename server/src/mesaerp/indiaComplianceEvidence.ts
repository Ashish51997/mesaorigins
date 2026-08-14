import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalHash } from '../lib/canonical';
import { ApiError } from '../middleware/error';

export const EXTERNAL_EVIDENCE_HMAC_ENV = 'MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY';

export type ExternalEvidenceKind =
  | 'outbound_e_invoice_manual_ack'
  | 'external_e_way_bill'
  | 'inbound_e_invoice'
  | 'gstr2b_upload';

export interface ExternalEvidenceVerificationInput {
  verifierReference: string;
  verifiedAt: string;
  signature: string;
}

export interface ExternalEvidenceEnvelope {
  version: 1;
  organizationId: string;
  legalEntityId: string;
  evidenceKind: ExternalEvidenceKind;
  sourceRecordType: string;
  sourceRecordId: string;
  evidenceHash: string;
  verifierReference: string;
  verifiedAt: string;
  signature: string;
}

interface ExternalEvidenceContext {
  organizationId: string;
  legalEntityId: string;
  evidenceKind: ExternalEvidenceKind;
  sourceRecordType: string;
  sourceRecordId: string;
  evidence: unknown;
  verifierReference: string;
  verifiedAt: string;
}

function configuredKey(): Buffer | null {
  const encoded = (process.env[EXTERNAL_EVIDENCE_HMAC_ENV] || '').trim();
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length < 32 || decoded.toString('base64') !== encoded) return null;
  return decoded;
}

function unsignedEnvelope(input: ExternalEvidenceContext): Omit<ExternalEvidenceEnvelope, 'signature'> {
  return {
    version: 1,
    organizationId: input.organizationId,
    legalEntityId: input.legalEntityId,
    evidenceKind: input.evidenceKind,
    sourceRecordType: input.sourceRecordType,
    sourceRecordId: input.sourceRecordId,
    evidenceHash: canonicalHash(input.evidence),
    verifierReference: input.verifierReference,
    verifiedAt: input.verifiedAt,
  };
}

function message(envelope: Omit<ExternalEvidenceEnvelope, 'signature'>): string {
  return `mesaerp:external-compliance-evidence:v1\n${canonicalHash(envelope)}`;
}

function signingKey(): Buffer {
  const key = configuredKey();
  if (!key) {
    throw new Error(`${EXTERNAL_EVIDENCE_HMAC_ENV} must be canonical base64 that decodes to at least 32 bytes.`);
  }
  return key;
}

/**
 * Used by an approved external verifier or test fixture. This helper never
 * represents a government/provider signature; it attests the exact retained
 * evidence snapshot under the deployment-owned verifier key.
 */
export function signExternalEvidence(input: ExternalEvidenceContext): string {
  return createHmac('sha256', signingKey()).update(message(unsignedEnvelope(input))).digest('hex');
}

function requireVerifierKey(): Buffer {
  const key = configuredKey();
  if (!key) {
    throw new ApiError(
      503,
      'external_evidence_verifier_unavailable',
      'Externally verified compliance evidence cannot be accepted because its verification key is not configured.',
    );
  }
  return key;
}

export function verifyExternalEvidence(
  input: Omit<ExternalEvidenceContext, 'verifierReference' | 'verifiedAt'>,
  verification: ExternalEvidenceVerificationInput,
): ExternalEvidenceEnvelope {
  const unsigned = unsignedEnvelope({ ...input, verifierReference: verification.verifierReference, verifiedAt: verification.verifiedAt });
  const expected = createHmac('sha256', requireVerifierKey()).update(message(unsigned)).digest();
  const supplied = /^[a-f0-9]{64}$/.test(verification.signature)
    ? Buffer.from(verification.signature, 'hex')
    : Buffer.alloc(0);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new ApiError(422, 'external_evidence_signature_invalid', 'Externally verified compliance evidence failed its tenant, company, source-record or payload signature check.');
  }
  return { ...unsigned, signature: verification.signature };
}

export function verifyStoredExternalEvidence(
  input: Omit<ExternalEvidenceContext, 'verifierReference' | 'verifiedAt'>,
  value: unknown,
): ExternalEvidenceEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(409, 'external_evidence_verification_missing', 'Externally verified compliance evidence is missing its signed envelope.');
  }
  const envelope = value as Partial<ExternalEvidenceEnvelope>;
  if (envelope.version !== 1
    || envelope.organizationId !== input.organizationId
    || envelope.legalEntityId !== input.legalEntityId
    || envelope.evidenceKind !== input.evidenceKind
    || envelope.sourceRecordType !== input.sourceRecordType
    || envelope.sourceRecordId !== input.sourceRecordId
    || envelope.evidenceHash !== canonicalHash(input.evidence)
    || typeof envelope.verifierReference !== 'string'
    || typeof envelope.verifiedAt !== 'string'
    || typeof envelope.signature !== 'string') {
    throw new ApiError(409, 'external_evidence_envelope_mismatch', 'Stored external verification no longer matches its tenant, company, source record or retained evidence.');
  }
  return verifyExternalEvidence(input, {
    verifierReference: envelope.verifierReference,
    verifiedAt: envelope.verifiedAt,
    signature: envelope.signature,
  });
}

export function externalEvidencePayload<T extends { externalVerification: unknown }>(input: T): Omit<T, 'externalVerification'> {
  const { externalVerification: _verification, ...payload } = input;
  return payload;
}
