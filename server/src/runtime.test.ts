import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import {
  hasCompleteForcedRowLevelSecurity,
  hasCompleteRuntimeRowLevelSecurity,
  isLeastPrivilegeRuntimeRole,
  productionConfigErrors,
  securityHeaders,
  type RuntimeDatabaseRole,
  type RuntimeRowLevelSecurityState,
} from './runtime';

const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

describe('production runtime controls', () => {
  const leastPrivilegeRole: RuntimeDatabaseRole = {
    roleName: 'app_user',
    canLogin: true,
    isSuperuser: false,
    canCreateDatabase: false,
    canCreateRole: false,
    canReplicate: false,
    bypassesRls: false,
    hasCloudSqlSuperuser: false,
  };

  it('accepts a login-only runtime database role', () => {
    expect(isLeastPrivilegeRuntimeRole(leastPrivilegeRole)).toBe(true);
  });

  it.each([
    ['cannot login', { canLogin: false }],
    ['is a superuser', { isSuperuser: true }],
    ['can create databases', { canCreateDatabase: true }],
    ['can create roles', { canCreateRole: true }],
    ['can replicate', { canReplicate: true }],
    ['can bypass row-level security', { bypassesRls: true }],
    ['inherits cloudsqlsuperuser', { hasCloudSqlSuperuser: true }],
  ] satisfies Array<[string, Partial<RuntimeDatabaseRole>]>)('rejects a runtime role that %s', (_label, unsafeAttributes) => {
    expect(isLeastPrivilegeRuntimeRole({ ...leastPrivilegeRole, ...unsafeAttributes })).toBe(false);
  });

  it('requires every RLS-enabled public table to force row-level security', () => {
    expect(hasCompleteForcedRowLevelSecurity(0)).toBe(true);
    expect(hasCompleteForcedRowLevelSecurity(1)).toBe(false);
    expect(hasCompleteForcedRowLevelSecurity(12)).toBe(false);
  });

  it('accepts only complete RLS policy coverage with no runtime migration bypass', () => {
    const completeState: RuntimeRowLevelSecurityState = {
      unforcedRlsTables: 0,
      forcedRlsTablesMissingTenantIsolationPolicies: 0,
      forcedRlsTablesMissingMigrationOwnerPolicies: 0,
      runtimeApplicableMigrationOwnerPolicies: 0,
    };
    expect(hasCompleteRuntimeRowLevelSecurity(completeState)).toBe(true);

    for (const unsafeCount of Object.keys(completeState) as Array<keyof RuntimeRowLevelSecurityState>) {
      expect(hasCompleteRuntimeRowLevelSecurity({ ...completeState, [unsafeCount]: 1 })).toBe(false);
    }
  });

  it('accepts the complete fail-closed production configuration', () => {
    expect(productionConfigErrors({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://app_user:redacted@localhost/mesaorigins',
      AUTH_SECRET: 'a'.repeat(32),
      DEV_AUTH: '0',
      APP_URL: 'https://erp.example.test',
      AUTH_URL: 'https://erp.example.test',
      TRUST_PROXY_HOPS: '1',
      MESAORIGINS_VENDOR_BANK_ENCRYPTION_KEY: KEY,
      MESAORIGINS_ERP_OPS_HANDOFF_HMAC_KEY: KEY,
      MESAORIGINS_OPS_STATUTORY_EVIDENCE_HMAC_KEY: KEY,
      MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY: KEY,
    })).toEqual([]);
  });

  it('rejects unsafe origins, development auth and malformed trust keys', () => {
    const errors = productionConfigErrors({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://app_user:redacted@localhost/mesaorigins',
      AUTH_SECRET: 'short',
      DEV_AUTH: '1',
      APP_URL: 'http://localhost:3000',
      TRUST_PROXY_HOPS: '0',
      MESAORIGINS_VENDOR_BANK_ENCRYPTION_KEY: 'not-base64',
    });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('AUTH_SECRET'),
      expect.stringContaining('DEV_AUTH'),
      expect.stringContaining('APP_URL'),
      expect.stringContaining('TRUST_PROXY_HOPS'),
      expect.stringContaining('MESAORIGINS_VENDOR_BANK_ENCRYPTION_KEY'),
    ]));
  });

  it('sets browser security headers', async () => {
    const app = express();
    app.use(securityHeaders);
    app.get('/screen', (_req, res) => res.send('ok'));
    const response = await request(app).get('/screen');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('rejects an oversized ordinary API body before authentication', async () => {
    const response = await request(buildApp())
      .post('/api/unknown')
      .set('Content-Type', 'application/json')
      .send({ payload: 'x'.repeat(600 * 1024) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('payload_too_large');
  });
});
