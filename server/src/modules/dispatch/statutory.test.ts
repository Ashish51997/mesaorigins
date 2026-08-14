import { beforeEach, describe, expect, it } from 'vitest';
import type { MesaOpsStatutoryRuleProfile } from '@prisma/client';
import { canonicalHash } from '../../lib/canonical';
import { mesaOpsStatutoryRuleProfileCreateSchema } from './statutoryProfileSchemas';
import {
  selectStatutoryProfileFromRows,
  signMesaOpsStatutoryEvidence,
  verifyMesaOpsStatutoryEvidence,
  type StatutoryEvidenceCore,
} from './statutory';

describe('MesaOps statutory profile and evidence', () => {
  beforeEach(() => {
    process.env.MESADESK_OPS_STATUTORY_EVIDENCE_HMAC_KEY = Buffer.alloc(32, 11).toString('base64');
  });

  const profileRow = (overrides: Partial<MesaOpsStatutoryRuleProfile>): MesaOpsStatutoryRuleProfile => ({
    id: 'profile-id', organizationId: 'org-demo', version: 'IN-2026.1', countryCode: 'IN', plantCode: '*', movementType: '*',
    effectiveFrom: new Date('2026-04-01T00:00:00.000Z'), effectiveTo: null, status: 'approved',
    requiresInvoice: true, requiresEWayBill: true, reviewedExemptionReason: '', sourceReference: 'review:test',
    sourceEvidence: { reviewed: true }, sourceChecksum: 'a'.repeat(64), createIdempotencyKey: 'profile-create-001',
    requestHash: 'b'.repeat(64), rowVersion: 1, createdBy: 'maker', approvedBy: 'checker',
    approvedAt: new Date('2026-04-01T00:00:00.000Z'), createdAt: new Date('2026-03-01T00:00:00.000Z'), updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    ...overrides,
  });

  it('selects the most-specific approved first-class profile', () => {
    const rows = [
      profileRow({ id: 'wild', version: 'IN-WILD', plantCode: '*', movementType: '*' }),
      profileRow({ id: 'plant', version: 'IN-PLANT', plantCode: 'PRIMARY', movementType: '*' }),
      profileRow({ id: 'exact', version: 'IN-EXACT', plantCode: 'PRIMARY', movementType: 'supply' }),
    ];
    expect(selectStatutoryProfileFromRows(rows, {
      businessDate: '2026-08-14', countryCode: 'IN', plantCode: 'PRIMARY', movementType: 'supply', environment: 'production',
    }).version).toBe('IN-EXACT');
  });

  it('fails closed in production when no approved profile covers dispatch', () => {
    expect(() => selectStatutoryProfileFromRows([], {
      businessDate: '2026-08-14', countryCode: 'IN', plantCode: 'PRIMARY', movementType: 'supply', environment: 'production',
    })).toThrow(/No approved MesaOps statutory profile/i);
  });

  it('permits a reviewed no-artifact exemption only through an approved profile', () => {
    const profile = selectStatutoryProfileFromRows([profileRow({
      version: 'IN-EXEMPT-2026.1', requiresInvoice: false, requiresEWayBill: false,
      reviewedExemptionReason: 'Reviewed non-applicable movement under current policy.',
    })], {
      businessDate: '2026-08-14', countryCode: 'IN', plantCode: 'PRIMARY', movementType: 'return', environment: 'production',
    });
    expect(profile.requiresInvoice || profile.requiresEWayBill).toBe(false);
    expect(verifyMesaOpsStatutoryEvidence('org-demo', 'order-1', profile, undefined)).toBeUndefined();
  });

  it('rejects a no-artifact draft unless the reviewed exemption is explicit and source-hashed', () => {
    const sourceEvidence = { review: 'test statutory review evidence' };
    const base = {
      version: 'IN-EXEMPT-2026.2', countryCode: 'IN', plantCode: 'PRIMARY', movementType: 'other' as const,
      effectiveFrom: '2026-08-14', requiresInvoice: false, requiresEWayBill: false,
      sourceReference: 'review:test', sourceEvidence, sourceChecksum: canonicalHash(sourceEvidence),
    };
    expect(mesaOpsStatutoryRuleProfileCreateSchema.safeParse({ ...base, reviewedExemptionReason: 'short' }).success).toBe(false);
    expect(mesaOpsStatutoryRuleProfileCreateSchema.safeParse({
      ...base,
      reviewedExemptionReason: 'Reviewed exemption under the recorded source evidence.',
    }).success).toBe(true);
  });

  it.each(['external_verified', 'mesaerp_snapshot'] as const)('accepts %s evidence only when its artifact hash and internal signature verify', (source) => {
    const profile = { version: 'IN-2026.1', countryCode: 'IN', movementType: 'supply', effectiveFrom: '2026-04-01', requiresInvoice: true, requiresEWayBill: true };
    const artifact = { irn: 'IRN-TEST', eWayBill: 'EWB-TEST' };
    const core: StatutoryEvidenceCore = {
      source,
      profileVersion: profile.version,
      verificationId: 'verify-12345678',
      verifiedAt: '2026-08-14T10:00:00.000Z',
      invoiceReference: 'INV-1',
      eWayBillReference: 'EWB-1',
      validUntil: '2099-08-14T10:00:00.000Z',
      artifactHash: canonicalHash(artifact),
      artifact,
    };
    const evidence = { ...core, signature: signMesaOpsStatutoryEvidence('org-demo', 'order-1', core) };
    expect(verifyMesaOpsStatutoryEvidence('org-demo', 'order-1', profile, evidence)).toEqual(core);
    expect(() => verifyMesaOpsStatutoryEvidence('org-demo', 'order-1', profile, { ...evidence, signature: '0'.repeat(64) })).toThrow(/approved external verifier/i);
  });

  it('rejects correctly signed e-way-bill evidence after its validity window', () => {
    const profile = { version: 'IN-2026.1', countryCode: 'IN', movementType: 'supply', effectiveFrom: '2026-04-01', requiresInvoice: true, requiresEWayBill: true };
    const artifact = { invoice: 'INV-EXPIRED', eWayBill: 'EWB-EXPIRED' };
    const core: StatutoryEvidenceCore = {
      source: 'external_verified', profileVersion: profile.version, verificationId: 'verify-expired-123',
      verifiedAt: '2020-01-01T00:00:00.000Z', invoiceReference: 'INV-EXPIRED', eWayBillReference: 'EWB-EXPIRED',
      validUntil: '2020-01-02T00:00:00.000Z', artifactHash: canonicalHash(artifact), artifact,
    };
    const evidence = { ...core, signature: signMesaOpsStatutoryEvidence('org-demo', 'order-expired', core) };
    expect(() => verifyMesaOpsStatutoryEvidence('org-demo', 'order-expired', profile, evidence)).toThrow(/no longer valid/i);
  });
});
