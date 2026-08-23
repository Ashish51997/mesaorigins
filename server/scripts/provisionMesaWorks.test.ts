import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  BUILT_IN_ROLES,
  desiredMesaWorksQuestions,
  mergeMesaWorksSettings,
  MESAWORKS_FORM,
  MESAWORKS_FORM_FAMILY,
  MESAWORKS_MESALEADS_PROFILE,
  MESAWORKS_ORG_SLUG,
  MESAWORKS_OWNER_EMAIL,
  MESAWORKS_QUOTE_DEFAULTS,
  provisionMesaWorks,
  requireDirectDatabaseUrl,
} from './provisionMesaWorks';
import { MESAOPS_PLANT_FORM_QUESTIONS } from '../../src/mesaleads/constants';

function databaseWithTransaction(tx: unknown): PrismaClient {
  return {
    $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;
}

function roleUpsertResult(args: { where: { organizationId_name: { name: string } } }) {
  return { id: `role-${args.where.organizationId_name.name}`, name: args.where.organizationId_name.name };
}

describe('MesaWorks provisioner', () => {
  it('requires the privileged direct database URL without falling back', () => {
    expect(() => requireDirectDatabaseUrl({})).toThrow('DIRECT_DATABASE_URL is required');
    expect(requireDirectDatabaseUrl({ DIRECT_DATABASE_URL: ' postgresql://owner/db ' })).toBe('postgresql://owner/db');
  });

  it('keeps FormBuilder constants in parity with the provisioned question set', () => {
    const provisioned = desiredMesaWorksQuestions().map(({ key, type, label, helpText, placeholder, required, options, validation, visibilityRule, sortOrder }) => ({
      key, type, label, helpText, placeholder, required, options, validation, ...(visibilityRule ? { visibilityRule } : {}), sortOrder,
    }));
    const client = MESAOPS_PLANT_FORM_QUESTIONS.map(({ key, type, label, helpText, placeholder, required, options, validation, visibilityRule, sortOrder }) => ({
      key, type, label, helpText, placeholder, required, options, validation: validation ?? {}, ...(visibilityRule ? { visibilityRule } : {}), sortOrder,
    }));
    expect(client).toEqual(provisioned);
    expect(provisioned.length).toBeGreaterThanOrEqual(45);
  });

  it('preserves unrelated organization settings while replacing the managed profile and quote defaults', () => {
    const settings = mergeMesaWorksSettings({ untouched: { enabled: true }, mesaLeadsProfile: { stale: true } });
    expect(settings).toMatchObject({
      untouched: { enabled: true },
      mesaLeadsProfile: MESAWORKS_MESALEADS_PROFILE,
      mesaLeadsQuoteDefaults: MESAWORKS_QUOTE_DEFAULTS,
    });
  });

  it('creates the first tenant resources and returns the raw path only for the newly created link', async () => {
    const now = new Date('2026-08-12T08:00:00.000Z');
    const token = 'a'.repeat(43);
    const passwordHasher = vi.fn(async () => 'hashed-owner-password');
    const organizationCreate = vi.fn(async () => ({ id: 'org-mw', slug: MESAWORKS_ORG_SLUG, settings: {} }));
    const formCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'form-mw-v1',
      ...MESAWORKS_FORM,
      status: 'published',
      revision: 1,
      questions: (args.data.questions as { create: unknown[] }).create,
    }));
    const linkCreate = vi.fn(async () => ({ id: 'link-mw' }));
    const userCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'user-mw', ...args.data }));
    const organizationServiceUpsert = vi.fn(async () => ({}));

    const tx = {
      $executeRaw: vi.fn(async () => 0),
      organization: {
        findUnique: vi.fn(async () => null),
        create: organizationCreate,
        update: vi.fn(),
      },
      service: { findUnique: vi.fn(async () => ({ id: 'mesaleads', status: 'active' })) },
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

    const result = await provisionMesaWorks(databaseWithTransaction(tx), {
      now,
      tokenFactory: () => token,
      ownerPassword: 'temporary-owner-password',
      passwordHasher,
    });

    expect(passwordHasher).toHaveBeenCalledOnce();
    expect(userCreate).toHaveBeenCalledWith({
      data: { email: MESAWORKS_OWNER_EMAIL, name: 'MesaWorks Owner', passwordHash: 'hashed-owner-password' },
    });
    expect(organizationServiceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { organizationId: 'org-mw', serviceId: 'mesaleads', status: 'active' },
    }));
    expect(tx.role.upsert).toHaveBeenCalledTimes(BUILT_IN_ROLES.length);
    expect(formCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        familyKey: MESAWORKS_FORM_FAMILY,
        status: 'published',
        revision: 1,
      }),
    }));
    expect(linkCreate).toHaveBeenCalledWith({
      data: {
        tokenHash: createHash('sha256').update(token).digest('hex'),
        organizationId: 'org-mw',
        formId: 'form-mw-v1',
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
      id: 'form-mw-v3',
      organizationId: 'org-mw',
      familyKey: MESAWORKS_FORM_FAMILY,
      ...MESAWORKS_FORM,
      status: 'published',
      revision: 3,
      questions: desiredMesaWorksQuestions().map((question) => {
        if (question.key === 'plant_count') return { ...question, validation: { max: 50, min: 1 } };
        if (question.key === 'industry_other') {
          return { ...question, visibilityRule: { value: 'Other', operator: 'contains', questionKey: 'industry_process' } };
        }
        return question;
      }),
    };
    const organizationUpdate = vi.fn(async (args: { data: { settings: unknown } }) => ({
      id: 'org-mw',
      slug: MESAWORKS_ORG_SLUG,
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
        findUnique: vi.fn(async () => ({ id: 'org-mw', slug: MESAWORKS_ORG_SLUG, name: 'Existing name', settings: { untouched: 'keep' } })),
        create: vi.fn(),
        update: organizationUpdate,
      },
      service: { findUnique: vi.fn(async () => ({ id: 'mesaleads', status: 'active' })) },
      organizationService: {
        findMany: vi.fn(async () => []),
        upsert: vi.fn(async () => ({})),
      },
      role: { upsert: vi.fn(async (args) => roleUpsertResult(args)) },
      user: {
        findUnique: vi.fn(async () => ({ id: 'shared-user', email: MESAWORKS_OWNER_EMAIL, name: 'Existing Global Name', passwordHash: 'existing-hash' })),
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

    const result = await provisionMesaWorks(databaseWithTransaction(tx), {
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
      organizationId: 'org-mw',
      ownerUserId: 'shared-user',
      formId: existingForm.id,
      createdOrganization: false,
      createdOwnerUser: false,
      createdFormRevision: false,
    });
    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: 'org-mw' },
      data: {
        name: 'MesaWorks',
        settings: expect.objectContaining({ untouched: 'keep' }),
      },
    });
  });

  it('never removes pre-existing non-MesaLeads service assignments', async () => {
    const organizationServiceUpsert = vi.fn();
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      service: { findUnique: vi.fn(async () => ({ id: 'mesaleads', status: 'active' })) },
      organization: {
        findUnique: vi.fn(async () => ({ id: 'org-mw', slug: MESAWORKS_ORG_SLUG, name: 'MesaWorks', settings: {} })),
        update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'org-mw', slug: MESAWORKS_ORG_SLUG, settings: args.data.settings })),
      },
      organizationService: {
        findMany: vi.fn(async () => [{ serviceId: 'mesaops' }]),
        upsert: organizationServiceUpsert,
      },
    };
    await expect(provisionMesaWorks(databaseWithTransaction(tx), { tokenFactory: () => 'c'.repeat(43) }))
      .rejects.toThrow('Nothing was removed');
    expect(organizationServiceUpsert).not.toHaveBeenCalled();
    expect(tx.organization).not.toHaveProperty('delete');
  });
});
