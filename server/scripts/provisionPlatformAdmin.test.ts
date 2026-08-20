import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  provisionPlatformAdmin,
  readPlatformAdminConfig,
  type PlatformAdminProvisionInput,
} from './provisionPlatformAdmin';

function databaseWithTransaction(tx: unknown): PrismaClient {
  return {
    $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;
}

const baseInput: PlatformAdminProvisionInput = {
  email: 'admin@mesaorigins.example',
  password: 'a-strong-admin-password',
  organization: 'demo',
  name: 'MesaOrigins Platform Administrator',
  employeeCode: 'PLATFORM-ADMIN',
  reuseExisting: false,
  rotateExisting: false,
};

function baseTx(overrides: Record<string, unknown> = {}) {
  return {
    $executeRaw: vi.fn(async () => 0),
    organization: {
      findFirst: vi.fn(async () => ({ id: 'org-demo', name: 'MesaOrigins', slug: 'demo' })),
    },
    role: {
      upsert: vi.fn(async () => ({ id: 'role-admin', name: 'Administrator', isAdmin: true })),
    },
    user: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'platform-user', ...args.data })),
      update: vi.fn(),
    },
    session: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    membership: {
      upsert: vi.fn(async () => ({ id: 'platform-membership' })),
      findFirst: vi.fn(async () => ({ id: 'platform-membership' })),
    },
    ...overrides,
  };
}

describe('platform administrator provisioner', () => {
  it('loads a chmod-600 password file and requires the runtime allowlist', async () => {
    const config = await readPlatformAdminConfig({
      DIRECT_DATABASE_URL: ' postgresql://owner/database ',
      PLATFORM_ADMIN_EMAIL: ' Admin@MesaOrigins.Example ',
      PLATFORM_ADMIN_PASSWORD_FILE: '/secure/admin-password',
      PLATFORM_ADMIN_ORGANIZATION: ' demo ',
      ONBOARDING_ALLOWED_EMAILS: 'other@example.com,admin@mesaorigins.example',
    }, {
      stat: vi.fn(async () => ({ mode: 0o100600, isFile: () => true })),
      readFile: vi.fn(async () => 'file-backed-admin-password\n'),
    });

    expect(config.directDatabaseUrl).toBe('postgresql://owner/database');
    expect(config.input).toMatchObject({
      email: 'admin@mesaorigins.example',
      password: 'file-backed-admin-password',
      organization: 'demo',
      reuseExisting: false,
      rotateExisting: false,
    });
  });

  it('rejects permissive secret files and missing allowlist entries', async () => {
    const baseEnv = {
      DIRECT_DATABASE_URL: 'postgresql://owner/database',
      PLATFORM_ADMIN_EMAIL: 'admin@mesaorigins.example',
      PLATFORM_ADMIN_PASSWORD_FILE: '/secure/admin-password',
      PLATFORM_ADMIN_ORGANIZATION: 'demo',
      ONBOARDING_ALLOWED_EMAILS: 'admin@mesaorigins.example',
    };

    await expect(readPlatformAdminConfig(baseEnv, {
      stat: vi.fn(async () => ({ mode: 0o100644, isFile: () => true })),
      readFile: vi.fn(async () => 'never-read-admin-password'),
    })).rejects.toThrow('chmod 600');

    await expect(readPlatformAdminConfig({ ...baseEnv, ONBOARDING_ALLOWED_EMAILS: 'other@example.com' }, {
      stat: vi.fn(async () => ({ mode: 0o100600, isFile: () => true })),
      readFile: vi.fn(async () => 'file-backed-admin-password'),
    })).rejects.toThrow('must explicitly include');
  });

  it('creates a new password-backed administrator without revealing the password in its result', async () => {
    const tx = baseTx();
    const passwordHasher = vi.fn(async () => 'bcrypt-hash');

    const result = await provisionPlatformAdmin(databaseWithTransaction(tx), baseInput, { passwordHasher });

    expect(passwordHasher).toHaveBeenCalledWith(baseInput.password);
    expect(tx.user.create).toHaveBeenCalledWith({
      data: {
        email: baseInput.email,
        name: baseInput.name,
        passwordHash: 'bcrypt-hash',
      },
    });
    expect(tx.membership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ role: 'Administrator', status: 'active' }),
    }));
    expect(tx.session.deleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ createdUser: true, passwordChanged: true, sessionsRevoked: 0 });
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('rotates an existing identity only with explicit reuse and rotation, revoking sessions atomically', async () => {
    const update = vi.fn(async () => ({
      id: 'existing-user', email: baseInput.email, name: 'Existing Name', passwordHash: 'new-hash',
    }));
    const deleteMany = vi.fn(async () => ({ count: 3 }));
    const tx = baseTx({
      user: {
        findUnique: vi.fn(async () => ({
          id: 'existing-user', email: baseInput.email, name: 'Existing Name', passwordHash: 'old-hash',
        })),
        create: vi.fn(),
        update,
      },
      session: { deleteMany },
    });
    const passwordHasher = vi.fn(async () => 'new-hash');
    const passwordVerifier = vi.fn(async () => false);

    await expect(provisionPlatformAdmin(databaseWithTransaction(tx), baseInput, {
      passwordHasher,
      passwordVerifier,
    })).rejects.toThrow('PLATFORM_ADMIN_REUSE_EXISTING=1');
    expect(update).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();

    const result = await provisionPlatformAdmin(databaseWithTransaction(tx), {
      ...baseInput,
      reuseExisting: true,
      rotateExisting: true,
    }, { passwordHasher, passwordVerifier });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'existing-user' },
      data: { passwordHash: 'new-hash' },
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'existing-user' } });
    expect(result).toMatchObject({ createdUser: false, passwordChanged: true, sessionsRevoked: 3 });
  });
});
