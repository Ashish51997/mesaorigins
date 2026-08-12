import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  AONE_FORM,
  AONE_FORM_FAMILY,
  AONE_MESALEADS_PROFILE,
  AONE_ORG_SLUG,
  AONE_OWNER_EMAIL,
  AONE_QUOTE_DEFAULTS,
  BUILT_IN_ROLES,
  desiredAoneQuestions,
  mergeAoneSettings,
  provisionAone,
  requireDirectDatabaseUrl,
} from './provisionAone';

function databaseWithTransaction(tx: unknown): PrismaClient {
  return {
    $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;
}

function roleUpsertResult(args: { where: { organizationId_name: { name: string } } }) {
  return { id: `role-${args.where.organizationId_name.name}`, name: args.where.organizationId_name.name };
}

describe('AONE provisioner', () => {
  it('requires the privileged direct database URL without falling back', () => {
    expect(() => requireDirectDatabaseUrl({})).toThrow('DIRECT_DATABASE_URL is required');
    expect(requireDirectDatabaseUrl({ DIRECT_DATABASE_URL: ' postgresql://owner/db ' })).toBe('postgresql://owner/db');
  });

  it('preserves unrelated organization settings while replacing the managed profile and quote defaults', () => {
    const settings = mergeAoneSettings({ untouched: { enabled: true }, mesaLeadsProfile: { stale: true } });
    expect(settings).toMatchObject({
      untouched: { enabled: true },
      mesaLeadsProfile: AONE_MESALEADS_PROFILE,
      mesaLeadsQuoteDefaults: AONE_QUOTE_DEFAULTS,
    });
  });

  it('creates the first tenant resources and returns the raw path only for the newly created link', async () => {
    const now = new Date('2026-08-12T08:00:00.000Z');
    const token = 'a'.repeat(43);
    const passwordHasher = vi.fn(async () => 'hashed-owner-password');
    const organizationCreate = vi.fn(async () => ({ id: 'org-aone', slug: AONE_ORG_SLUG, settings: {} }));
    const formCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'form-aone-v1',
      ...AONE_FORM,
      status: 'published',
      revision: 1,
      questions: (args.data.questions as { create: unknown[] }).create,
    }));
    const linkCreate = vi.fn(async () => ({ id: 'link-aone' }));
    const userCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'user-aone', ...args.data }));
    const organizationServiceUpsert = vi.fn(async () => ({}));

    const tx = {
      $executeRaw: vi.fn(async () => 0),
      organization: {
        findUnique: vi.fn(async () => null),
        create: organizationCreate,
        update: vi.fn(),
      },
      service: { findUnique: vi.fn(async () => ({ id: 'mesaleads' })) },
      organizationService: { findMany: vi.fn(async () => []), upsert: organizationServiceUpsert },
      role: { upsert: vi.fn(async (args) => roleUpsertResult(args)) },
      user: { findUnique: vi.fn(async () => null), create: userCreate, update: vi.fn() },
      membership: { upsert: vi.fn(async () => ({})) },
      leadForm: {
        findMany: vi.fn(async () => []),
        create: formCreate,
        update: vi.fn(),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      leadFormLink: {
        findMany: vi.fn(async () => []),
        create: linkCreate,
        update: vi.fn(),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };

    const result = await provisionAone(databaseWithTransaction(tx), {
      now,
      tokenFactory: () => token,
      ownerPassword: 'temporary-owner-password',
      passwordHasher,
    });

    expect(passwordHasher).toHaveBeenCalledOnce();
    expect(userCreate).toHaveBeenCalledWith({
      data: { email: AONE_OWNER_EMAIL, name: 'S N Bhatt', passwordHash: 'hashed-owner-password' },
    });
    expect(organizationServiceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { organizationId: 'org-aone', serviceId: 'mesaleads', status: 'active' },
    }));
    expect(tx.role.upsert).toHaveBeenCalledTimes(BUILT_IN_ROLES.length);
    expect(tx.role.upsert).toHaveBeenCalledWith({
      where: { organizationId_name: { organizationId: 'org-aone', name: 'Owner' } },
      update: { screens: [], isAdmin: true, isSystem: true },
      create: { organizationId: 'org-aone', name: 'Owner', screens: [], isAdmin: true, isSystem: true },
    });
    expect(tx.role.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_name: { organizationId: 'org-aone', name: 'Administrator' } },
      update: expect.objectContaining({ isAdmin: true, isSystem: true }),
    }));
    expect(formCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        familyKey: AONE_FORM_FAMILY,
        status: 'published',
        revision: 1,
      }),
    }));
    expect(linkCreate).toHaveBeenCalledWith({
      data: {
        tokenHash: createHash('sha256').update(token).digest('hex'),
        organizationId: 'org-aone',
        formId: 'form-aone-v1',
        kind: 'generic',
        status: 'active',
        expiresAt: new Date('2026-09-11T08:00:00.000Z'),
      },
    });
    expect(result).toMatchObject({
      createdOrganization: true,
      createdOwnerUser: true,
      createdFormRevision: true,
      createdPublicPath: `/mesaleads/q/${token}`,
    });
  });

  it('reruns without replacing a global identity, duplicating the form, or revealing an existing link', async () => {
    const now = new Date('2026-08-12T08:00:00.000Z');
    const passwordHasher = vi.fn(async () => 'must-not-be-created');
    const existingForm = {
      id: 'form-aone-v3',
      organizationId: 'org-aone',
      familyKey: AONE_FORM_FAMILY,
      ...AONE_FORM,
      status: 'published',
      revision: 3,
      // PostgreSQL JSONB does not preserve object key order. Equivalent stored
      // rules must not cause a new published revision or rotate the bearer URL.
      questions: desiredAoneQuestions().map((question) => {
        if (question.key === 'product_weight') return { ...question, validation: { max: 1000, min: 0.01 } };
        if (question.key === 'mold_details') {
          return { ...question, visibilityRule: { value: 'machine_only', operator: 'not_equals', questionKey: 'requirement_scope' } };
        }
        return question;
      }),
    };
    const organizationUpdate = vi.fn(async (args: { data: { settings: unknown } }) => ({
      id: 'org-aone',
      slug: AONE_ORG_SLUG,
      settings: args.data.settings,
    }));
    const userCreate = vi.fn();
    const userUpdate = vi.fn();
    const formCreate = vi.fn();
    const linkCreate = vi.fn();
    const linkUpdate = vi.fn();

    const tx = {
      $executeRaw: vi.fn(async () => 0),
      organization: {
        findUnique: vi.fn(async () => ({ id: 'org-aone', slug: AONE_ORG_SLUG, name: 'Existing name', settings: { untouched: 'keep' } })),
        create: vi.fn(),
        update: organizationUpdate,
      },
      service: { findUnique: vi.fn(async () => ({ id: 'mesaleads' })) },
      organizationService: {
        findMany: vi.fn(async () => []),
        upsert: vi.fn(async () => ({})),
      },
      role: { upsert: vi.fn(async (args) => roleUpsertResult(args)) },
      user: {
        findUnique: vi.fn(async () => ({ id: 'shared-user', email: AONE_OWNER_EMAIL, name: 'Existing Global Name', passwordHash: 'existing-hash' })),
        create: userCreate,
        update: userUpdate,
      },
      membership: { upsert: vi.fn(async () => ({})) },
      leadForm: {
        findMany: vi.fn(async () => [existingForm]),
        create: formCreate,
        update: vi.fn(),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      leadFormLink: {
        findMany: vi.fn(async () => [{
          id: 'existing-link',
          formId: existingForm.id,
          status: 'active',
          kind: 'generic',
          expiresAt: new Date('2026-09-01T00:00:00.000Z'),
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        }]),
        create: linkCreate,
        update: linkUpdate,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };

    const result = await provisionAone(databaseWithTransaction(tx), {
      now,
      ownerPassword: 'must-not-replace-existing-password',
      passwordHasher,
      tokenFactory: () => 'b'.repeat(43),
    });

    expect(passwordHasher).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(formCreate).not.toHaveBeenCalled();
    expect(linkCreate).not.toHaveBeenCalled();
    expect(linkUpdate).not.toHaveBeenCalled();
    expect(tx.leadFormLink.updateMany).not.toHaveBeenCalled();
    expect(result.createdPublicPath).toBeUndefined();
    expect(result).toMatchObject({
      organizationId: 'org-aone',
      ownerUserId: 'shared-user',
      formId: existingForm.id,
      createdOrganization: false,
      createdOwnerUser: false,
      createdFormRevision: false,
    });
    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: 'org-aone' },
      data: {
        name: 'A ONE PLASTIC MACHINERY',
        settings: expect.objectContaining({ untouched: 'keep' }),
      },
    });
  });

  it('does not reuse an older exact revision when the newest differs, and revokes old links before replacement', async () => {
    const now = new Date('2026-08-12T08:00:00.000Z');
    const token = 'r'.repeat(43);
    const olderExactForm = {
      id: 'form-aone-v1', organizationId: 'org-aone', familyKey: AONE_FORM_FAMILY,
      ...AONE_FORM, status: 'published', revision: 1,
      questions: desiredAoneQuestions(),
    };
    const newestDifferentForm = {
      ...olderExactForm,
      id: 'form-aone-v2',
      description: 'A newer, different questionnaire.',
      revision: 2,
    };
    const revokeLinks = vi.fn(async () => ({ count: 1 }));
    const formCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'form-aone-v3', ...AONE_FORM, status: 'published', revision: 3,
      questions: (args.data.questions as { create: unknown[] }).create,
    }));
    const linkCreate = vi.fn(async () => ({ id: 'replacement-link' }));
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      service: { findUnique: vi.fn(async () => ({ id: 'mesaleads', status: 'active' })) },
      organization: {
        findUnique: vi.fn(async () => ({ id: 'org-aone', slug: AONE_ORG_SLUG, name: 'AONE', settings: {} })),
        update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'org-aone', slug: AONE_ORG_SLUG, settings: args.data.settings })),
      },
      organizationService: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
      role: { upsert: vi.fn(async (args) => roleUpsertResult(args)) },
      user: { findUnique: vi.fn(async () => ({ id: 'owner-user', email: AONE_OWNER_EMAIL })), create: vi.fn() },
      membership: { upsert: vi.fn(async () => ({ id: 'owner-membership' })) },
      leadForm: { findMany: vi.fn(async () => [newestDifferentForm, olderExactForm]), create: formCreate },
      leadFormLink: { findMany: vi.fn(async () => []), create: linkCreate, updateMany: revokeLinks },
    };

    const result = await provisionAone(databaseWithTransaction(tx), { now, tokenFactory: () => token });

    expect(revokeLinks).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-aone', formId: { in: ['form-aone-v2', 'form-aone-v1'] }, kind: 'generic', status: 'active',
      },
      data: { status: 'revoked' },
    });
    expect(linkCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ formId: 'form-aone-v3', status: 'active' }),
    }));
    expect(result).toMatchObject({ createdFormRevision: true, createdPublicPath: `/mesaleads/q/${token}` });
  });

  it('never removes pre-existing non-MesaLeads service assignments', async () => {
    const organizationServiceUpsert = vi.fn();
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      service: { findUnique: vi.fn(async () => ({ id: 'mesaleads', status: 'active' })) },
      organization: {
        findUnique: vi.fn(async () => ({ id: 'org-aone', slug: AONE_ORG_SLUG, name: 'AONE', settings: {} })),
        update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'org-aone', slug: AONE_ORG_SLUG, settings: args.data.settings })),
      },
      organizationService: {
        findMany: vi.fn(async () => [{ serviceId: 'mesaops' }]),
        upsert: organizationServiceUpsert,
      },
    };
    await expect(provisionAone(databaseWithTransaction(tx), { tokenFactory: () => 'c'.repeat(43) }))
      .rejects.toThrow('Nothing was removed');
    expect(organizationServiceUpsert).not.toHaveBeenCalled();
    expect(tx.organization).not.toHaveProperty('delete');
  });
});
