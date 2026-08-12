import 'dotenv/config';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { Stats } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { PrismaClient as RuntimePrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { ROLE_DEFAULT_SCREENS } from '../src/lib/permissions';

const MIN_PASSWORD_LENGTH = 16;

export type PlatformAdminProvisionInput = {
  email: string;
  password: string;
  organization: string;
  name: string;
  employeeCode: string;
  reuseExisting: boolean;
  rotateExisting: boolean;
};

type SecretFileIo = {
  readFile: (path: string) => Promise<string>;
  stat: (path: string) => Promise<Pick<Stats, 'mode' | 'isFile'>>;
};

const defaultSecretFileIo: SecretFileIo = {
  readFile: (path) => readFile(path, 'utf8'),
  stat,
};

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = (env[key] || '').trim();
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function allowlistedEmails(env: NodeJS.ProcessEnv): string[] {
  return (env.ONBOARDING_ALLOWED_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

async function readPassword(env: NodeJS.ProcessEnv, io: SecretFileIo): Promise<string> {
  const inlinePassword = env.PLATFORM_ADMIN_PASSWORD || '';
  const passwordFile = (env.PLATFORM_ADMIN_PASSWORD_FILE || '').trim();
  if (inlinePassword && passwordFile) {
    throw new Error('Set exactly one of PLATFORM_ADMIN_PASSWORD or PLATFORM_ADMIN_PASSWORD_FILE.');
  }
  if (!inlinePassword && !passwordFile) {
    throw new Error('PLATFORM_ADMIN_PASSWORD_FILE is required (or PLATFORM_ADMIN_PASSWORD for controlled one-time use).');
  }

  let password = inlinePassword;
  if (passwordFile) {
    const file = await io.stat(passwordFile);
    if (!file.isFile()) throw new Error('PLATFORM_ADMIN_PASSWORD_FILE must reference a regular file.');
    if ((file.mode & 0o077) !== 0) {
      throw new Error('PLATFORM_ADMIN_PASSWORD_FILE must not be readable or writable by group/others (use chmod 600).');
    }
    password = (await io.readFile(passwordFile)).replace(/\r?\n$/, '');
  }

  if (password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
    throw new Error(`Platform administrator password must contain ${MIN_PASSWORD_LENGTH} to 128 characters.`);
  }
  if (/[\r\n]/.test(password)) throw new Error('Platform administrator password must be a single line.');
  return password;
}

export async function readPlatformAdminConfig(
  env: NodeJS.ProcessEnv,
  io: SecretFileIo = defaultSecretFileIo,
): Promise<{ directDatabaseUrl: string; input: PlatformAdminProvisionInput }> {
  const directDatabaseUrl = required(env, 'DIRECT_DATABASE_URL');
  const email = required(env, 'PLATFORM_ADMIN_EMAIL').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('PLATFORM_ADMIN_EMAIL must be a valid email address.');
  }
  if (!allowlistedEmails(env).includes(email)) {
    throw new Error('ONBOARDING_ALLOWED_EMAILS must explicitly include PLATFORM_ADMIN_EMAIL.');
  }

  return {
    directDatabaseUrl,
    input: {
      email,
      password: await readPassword(env, io),
      organization: required(env, 'PLATFORM_ADMIN_ORGANIZATION'),
      name: (env.PLATFORM_ADMIN_NAME || '').trim() || 'MesaDesk Platform Administrator',
      employeeCode: (env.PLATFORM_ADMIN_EMPLOYEE_CODE || '').trim() || 'PLATFORM-ADMIN',
      rotateExisting: env.PLATFORM_ADMIN_ROTATE_EXISTING === '1',
      reuseExisting: env.PLATFORM_ADMIN_REUSE_EXISTING === '1' || env.PLATFORM_ADMIN_ROTATE_EXISTING === '1',
    },
  };
}

type ProvisionDependencies = {
  passwordHasher?: (plain: string) => Promise<string>;
  passwordVerifier?: (plain: string, hash: string) => Promise<boolean>;
};

/**
 * Non-destructively provisions one password-backed platform administrator.
 * Existing global identities are never repurposed implicitly. Password changes
 * and the resulting session revocation happen in the same transaction.
 */
export async function provisionPlatformAdmin(
  db: PrismaClient,
  input: PlatformAdminProvisionInput,
  dependencies: ProvisionDependencies = {},
) {
  const passwordHasher = dependencies.passwordHasher ?? hashPassword;
  const passwordVerifier = dependencies.passwordVerifier ?? verifyPassword;

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('mesadesk-platform-admin'), hashtext(${input.email}))`;

    const organization = await tx.organization.findFirst({
      where: { OR: [{ id: input.organization }, { slug: input.organization }] },
      select: { id: true, name: true, slug: true },
    });
    if (!organization) throw new Error('PLATFORM_ADMIN_ORGANIZATION does not identify an existing organization.');

    // Role is tenant-owned and protected by RLS. Keep the platform identity
    // work global, but explicitly scope role reads/writes to the designated org.
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organization.id}, true)`;

    const administratorRole = await tx.role.upsert({
      where: { organizationId_name: { organizationId: organization.id, name: 'Administrator' } },
      update: { screens: ROLE_DEFAULT_SCREENS.Administrator, isAdmin: true, isSystem: true },
      create: {
        organizationId: organization.id,
        name: 'Administrator',
        screens: ROLE_DEFAULT_SCREENS.Administrator,
        isAdmin: true,
        isSystem: true,
      },
    });

    let user = await tx.user.findUnique({ where: { email: input.email } });
    const createdUser = !user;
    let passwordChanged = false;
    let sessionsRevoked = 0;

    if (!user) {
      user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash: await passwordHasher(input.password),
        },
      });
      passwordChanged = true;
    } else {
      if (!input.reuseExisting) {
        throw new Error('PLATFORM_ADMIN_EMAIL already exists. Set PLATFORM_ADMIN_REUSE_EXISTING=1 only after verifying this identity.');
      }
      const passwordMatches = user.passwordHash
        ? await passwordVerifier(input.password, user.passwordHash)
        : false;
      if (!passwordMatches) {
        if (!input.rotateExisting) {
          throw new Error('Existing identity has a different password. Set PLATFORM_ADMIN_ROTATE_EXISTING=1 to rotate it explicitly.');
        }
        user = await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: await passwordHasher(input.password) },
        });
        passwordChanged = true;
        sessionsRevoked = (await tx.session.deleteMany({ where: { userId: user.id } })).count;
      }
    }

    const membership = await tx.membership.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      update: { role: 'Administrator', roleId: administratorRole.id, status: 'active' },
      create: {
        organizationId: organization.id,
        userId: user.id,
        employeeCode: input.employeeCode,
        department: 'Platform Administration',
        role: 'Administrator',
        roleId: administratorRole.id,
        status: 'active',
      },
    });

    const activeAdminMembership = await tx.membership.findFirst({
      where: {
        userId: user.id,
        status: 'active',
        OR: [{ role: { in: ['Owner', 'Administrator', 'Admin', 'Management'] } }, { roleRef: { isAdmin: true } }],
      },
      select: { id: true },
    });
    if (!activeAdminMembership) throw new Error('Platform administrator has no active admin membership after provisioning.');

    return {
      userId: user.id,
      email: user.email,
      membershipId: membership.id,
      organizationId: organization.id,
      organizationName: organization.name,
      createdUser,
      passwordChanged,
      sessionsRevoked,
    };
  });
}

async function main(): Promise<void> {
  const { directDatabaseUrl, input } = await readPlatformAdminConfig(process.env);
  // Reduce accidental exposure through child-process environment inspection
  // after the value has been read. Prefer PLATFORM_ADMIN_PASSWORD_FILE.
  delete process.env.PLATFORM_ADMIN_PASSWORD;

  const db = new RuntimePrismaClient({ datasources: { db: { url: directDatabaseUrl } } });
  try {
    const result = await provisionPlatformAdmin(db, input);
    console.log(JSON.stringify({
      ...result,
      note: 'Password and hash were not printed. Ensure ONBOARDING_ALLOWED_EMAILS remains mounted in the application runtime.',
    }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Platform administrator provisioning failed.');
    process.exitCode = 1;
  });
}
