import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EXTERNAL_EVIDENCE_HMAC_ENV,
  signExternalEvidence,
  verifyExternalEvidence,
  verifyStoredExternalEvidence,
} from '../indiaComplianceEvidence';

const key = Buffer.alloc(32, 23).toString('base64');
const evidence = { irn: 'a'.repeat(64), acknowledgementNumber: 'ACK-1', payloadHash: 'b'.repeat(64) };
const context = {
  organizationId: 'org-a',
  legalEntityId: 'entity-a',
  evidenceKind: 'outbound_e_invoice_manual_ack' as const,
  sourceRecordType: 'ErpTaxDocument',
  sourceRecordId: 'tax-document-1',
  evidence,
};
const verificationBasis = { verifierReference: 'approved-external-verifier:test', verifiedAt: '2026-08-14T10:00:00.000Z' };

describe('MesaERP externally verified compliance evidence', () => {
  beforeEach(() => { process.env[EXTERNAL_EVIDENCE_HMAC_ENV] = key; });
  afterEach(() => { delete process.env[EXTERNAL_EVIDENCE_HMAC_ENV]; });

  it('verifies and retains a canonical tenant, company, kind and source-record envelope', () => {
    const signature = signExternalEvidence({ ...context, ...verificationBasis });
    const envelope = verifyExternalEvidence(context, { ...verificationBasis, signature });

    expect(envelope).toMatchObject({
      version: 1,
      organizationId: context.organizationId,
      legalEntityId: context.legalEntityId,
      evidenceKind: context.evidenceKind,
      sourceRecordType: context.sourceRecordType,
      sourceRecordId: context.sourceRecordId,
      evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      ...verificationBasis,
      signature,
    });
    expect(verifyStoredExternalEvidence(context, envelope)).toEqual(envelope);
  });

  it.each([
    ['organizationId', { organizationId: 'org-b' }],
    ['legalEntityId', { legalEntityId: 'entity-b' }],
    ['evidenceKind', { evidenceKind: 'gstr2b_upload' as const }],
    ['sourceRecordId', { sourceRecordId: 'tax-document-2' }],
    ['evidence', { evidence: { ...evidence, acknowledgementNumber: 'ACK-2' } }],
  ])('rejects signature replay when %s changes', (_field, patch) => {
    const signature = signExternalEvidence({ ...context, ...verificationBasis });
    expect(() => verifyExternalEvidence({ ...context, ...patch }, { ...verificationBasis, signature }))
      .toThrowError(expect.objectContaining({ code: 'external_evidence_signature_invalid' }));
  });

  it('fails closed when the dedicated verifier key is absent or malformed', () => {
    const signature = signExternalEvidence({ ...context, ...verificationBasis });
    delete process.env[EXTERNAL_EVIDENCE_HMAC_ENV];
    expect(() => verifyExternalEvidence(context, { ...verificationBasis, signature }))
      .toThrowError(expect.objectContaining({ status: 503, code: 'external_evidence_verifier_unavailable' }));

    process.env[EXTERNAL_EVIDENCE_HMAC_ENV] = Buffer.alloc(16, 1).toString('base64');
    expect(() => verifyExternalEvidence(context, { ...verificationBasis, signature }))
      .toThrowError(expect.objectContaining({ status: 503, code: 'external_evidence_verifier_unavailable' }));
  });
});
