import type { RequestHandler } from 'express';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { basePrisma } from './db';
import { integrationOutboxWorkerHealth } from './lib/integrationOutboxWorker';

const REQUIRED_BASE64_SECRETS = [
  'MESADESK_VENDOR_BANK_ENCRYPTION_KEY',
  'MESADESK_ERP_OPS_HANDOFF_HMAC_KEY',
  'MESADESK_OPS_STATUTORY_EVIDENCE_HMAC_KEY',
  'MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY',
] as const;

let draining = false;

const PRE_BODY_WINDOW_MS = 15 * 60 * 1_000;
const PRE_BODY_BUCKET_LIMIT = 5_000;
const preBodyBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Reject repeated public upload attempts before express.json allocates their
 * base64 bodies. The token is intentionally excluded from the key so rotating
 * random URLs cannot create unbounded buckets. The downstream domain limiter
 * remains authoritative for valid questionnaire actions.
 */
export const publicMesaLeadsPreBodyRateLimit: RequestHandler = (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) { next(); return; }
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const current = preBodyBuckets.get(key);
  if (!current && preBodyBuckets.size >= PRE_BODY_BUCKET_LIMIT) {
    const oldest = preBodyBuckets.keys().next().value as string | undefined;
    if (oldest) preBodyBuckets.delete(oldest);
  }
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + PRE_BODY_WINDOW_MS }
    : current;
  entry.count += 1;
  preBodyBuckets.set(key, entry);
  if (entry.count > 20) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1_000))));
    res.status(429).json({ error: { code: 'rate_limited', message: 'Too many questionnaire upload attempts.' } });
    return;
  }
  next();
};

function isCanonicalBase64Secret(value: string): boolean {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) return false;
  const decoded = Buffer.from(normalized, 'base64');
  return decoded.length >= 32 && decoded.toString('base64') === normalized;
}

export function productionConfigErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];

  const errors: string[] = [];
  if (!env.DATABASE_URL?.trim()) errors.push('DATABASE_URL is required.');
  if ((env.AUTH_SECRET || '').length < 32) errors.push('AUTH_SECRET must contain at least 32 characters.');
  if (env.DEV_AUTH !== '0') errors.push('DEV_AUTH must be 0.');

  let appUrl: URL | undefined;
  try {
    appUrl = new URL(env.APP_URL || '');
    if (appUrl.protocol !== 'https:' || appUrl.username || appUrl.password || appUrl.search || appUrl.hash) {
      errors.push('APP_URL must be a public HTTPS URL without credentials, query parameters or a fragment.');
    }
  } catch {
    errors.push('APP_URL must be a valid public HTTPS URL.');
  }

  if (env.AUTH_URL) {
    try {
      const authUrl = new URL(env.AUTH_URL);
      if (!appUrl || authUrl.origin !== appUrl.origin) errors.push('AUTH_URL must use the same origin as APP_URL.');
    } catch {
      errors.push('AUTH_URL must be a valid URL when configured.');
    }
  }

  const proxyHops = Number.parseInt(env.TRUST_PROXY_HOPS || '', 10);
  if (!Number.isSafeInteger(proxyHops) || proxyHops < 1 || proxyHops > 5) {
    errors.push('TRUST_PROXY_HOPS must be an integer between 1 and 5 in production.');
  }

  for (const name of REQUIRED_BASE64_SECRETS) {
    if (!isCanonicalBase64Secret(env[name] || '')) errors.push(`${name} must be canonical base64 encoding at least 32 bytes.`);
  }
  return errors;
}

export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const errors = productionConfigErrors(env);
  if (errors.length > 0) throw new Error(`Unsafe production configuration:\n- ${errors.join('\n- ')}`);
}

export function setDraining(value: boolean): void {
  draining = value;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Readiness check timed out.')), timeoutMs);
    timeout.unref();
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error: unknown) => { clearTimeout(timeout); reject(error); },
    );
  });
}

let packagedMigrationNames: Promise<string[]> | undefined;

async function expectedMigrations(): Promise<string[]> {
  packagedMigrationNames ??= (async () => {
    const root = path.resolve(process.cwd(), 'server/prisma/migrations');
    const entries = await readdir(root, { withFileTypes: true });
    const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const deploymentExpected = (process.env.EXPECTED_MIGRATION || '').trim();
    if (deploymentExpected && !names.includes(deploymentExpected)) names.push(deploymentExpected);
    return names.sort();
  })();
  return packagedMigrationNames;
}

type AppliedMigration = {
  migrationName: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
};

type RuntimeDatabaseRole = {
  roleName: string;
  isSuperuser: boolean;
  bypassesRls: boolean;
};

async function databaseState(): Promise<{
  pending: string[];
  unfinished: number;
  expectedLatest: string | null;
  role: RuntimeDatabaseRole;
}> {
  const [expected, applied, roles] = await Promise.all([
    expectedMigrations(),
    basePrisma.$queryRaw<AppliedMigration[]>`
      SELECT
        "migration_name" AS "migrationName",
        "finished_at" AS "finishedAt",
        "rolled_back_at" AS "rolledBackAt"
      FROM "_prisma_migrations"
    `,
    basePrisma.$queryRaw<RuntimeDatabaseRole[]>`
      SELECT
        current_user AS "roleName",
        "rolsuper" AS "isSuperuser",
        "rolbypassrls" AS "bypassesRls"
      FROM "pg_roles"
      WHERE "rolname" = current_user
    `,
  ]);
  const role = roles[0];
  if (!role) throw new Error('The current PostgreSQL role could not be resolved.');
  const completed = new Set(
    applied.filter((row) => row.finishedAt && !row.rolledBackAt).map((row) => row.migrationName),
  );
  return {
    pending: expected.filter((name) => !completed.has(name)),
    unfinished: applied.filter((row) => !row.finishedAt && !row.rolledBackAt).length,
    expectedLatest: expected.at(-1) ?? null,
    role,
  };
}

export const readinessHandler: RequestHandler = async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (draining) {
    res.status(503).json({ status: 'not_ready', checks: { draining: { ok: false } } });
    return;
  }

  const configurationErrors = productionConfigErrors();
  try {
    const database = await withTimeout(databaseState(), 4_000);
    const outboxWorker = integrationOutboxWorkerHealth();
    const unsafeProductionRole = process.env.NODE_ENV === 'production'
      && (database.role.isSuperuser || database.role.bypassesRls);
    const ready = configurationErrors.length === 0
      && !unsafeProductionRole
      && database.pending.length === 0
      && database.unfinished === 0
      && outboxWorker.healthy;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      checks: {
        configuration: { ok: configurationErrors.length === 0, errors: configurationErrors },
        database: {
          ok: !unsafeProductionRole,
          leastPrivilegeRole: !database.role.isSuperuser && !database.role.bypassesRls,
        },
        migrations: {
          ok: database.pending.length === 0 && database.unfinished === 0,
          expectedLatest: database.expectedLatest,
          pending: database.pending.length,
          unfinished: database.unfinished,
        },
        integrationOutbox: {
          ok: outboxWorker.healthy,
          running: outboxWorker.running,
          inFlight: outboxWorker.inFlight,
          consecutivePollFailures: outboxWorker.consecutivePollFailures,
          lastSuccessfulPollAt: outboxWorker.lastSuccessfulPollAt,
          lastPollError: outboxWorker.lastPollError,
        },
      },
    });
  } catch (error) {
    console.error('[readiness] Database or migration check failed:', error);
    res.status(503).json({
      status: 'not_ready',
      checks: {
        configuration: { ok: configurationErrors.length === 0, errors: configurationErrors },
        database: { ok: false },
        migrations: { ok: false },
        integrationOutbox: { ok: integrationOutboxWorkerHealth().healthy },
      },
    });
  }
};

function contentSecurityPolicy(requestPath: string): string {
  if (requestPath.startsWith('/api/docs')) {
    return [
      "default-src 'none'",
      "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'unsafe-inline'",
      "img-src data: blob:",
      "connect-src 'self'",
      "font-src data:",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ');
  }
  if (requestPath.startsWith('/api/')) return "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://images.unsplash.com",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export const securityHeaders: RequestHandler = (req, res, next) => {
  res.setHeader('Content-Security-Policy', contentSecurityPolicy(req.path));
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
};
