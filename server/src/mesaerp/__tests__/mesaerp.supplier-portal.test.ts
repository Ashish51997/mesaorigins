import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, errorHandler } from '../../middleware/error';
import { createSupplierManagementRouter, createSupplierPortalRouter } from '../supplierPortalRouter';
import { clearSupplierCookie, supplierCookie } from '../supplierPortalAuth';
import { assertPaymentCurrency, supplierInvitePath, supplierPortalLifecycleAllowed, supplierTokenHash, type SupplierActor } from '../supplierPortalService';

const actor: SupplierActor = {
  organizationId: 'org-a', legalEntityId: 'entity-a', vendorId: 'vendor-a', portalUserId: 'portal-a',
  email: 'supplier@example.test', name: 'Supplier User', permissions: [],
};

function supplierAuth(permissions: string[]): RequestHandler {
  return (req, _res, next) => {
    req.supplier = { ...actor, permissions };
    req.supplierSessionHash = 'a'.repeat(64);
    next();
  };
}

function appFor(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  app.use(errorHandler);
  return app;
}

describe('supplier portal security boundary', () => {
  it('sets an isolated httpOnly cookie and never returns the raw session token in JSON', async () => {
    const acceptInvite = vi.fn().mockResolvedValue({
      user: { id: 'portal-a', vendorId: 'vendor-a' }, expiresAt: new Date(Date.now() + 60_000).toISOString(), sessionToken: 'raw-session-secret',
    });
    const service = { acceptInvite };
    const response = await request(appFor(createSupplierPortalRouter(service as never, supplierAuth([]))))
      .post('/api/supplier-portal/v1/auth/accept')
      .send({ token: 'x'.repeat(43) });

    expect(response.status).toBe(201);
    expect(response.body.sessionToken).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('raw-session-secret');
    expect(response.headers['set-cookie'][0]).toContain('mesadesk_supplier_session=raw-session-secret');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect(acceptInvite).toHaveBeenCalledWith('x'.repeat(43));
  });

  it('defaults supplier mutations to deny and validates the idempotency contract before service work', async () => {
    const requestChange = vi.fn();
    const denied = await request(appFor(createSupplierPortalRouter({ requestChange } as never, supplierAuth([]))))
      .post('/api/supplier-portal/v1/profile-change-cases')
      .send({ changeType: 'gstin', proposedValues: { gstin: '27ABCDE1234F1Z5' } });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('supplier_forbidden');
    expect(requestChange).not.toHaveBeenCalled();

    const missingKey = await request(appFor(createSupplierPortalRouter({ requestChange } as never, supplierAuth(['supplier.profile.request_change']))))
      .post('/api/supplier-portal/v1/profile-change-cases')
      .send({ changeType: 'gstin', proposedValues: { gstin: '27ABCDE1234F1Z5' } });
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe('idempotency_key_required');
    expect(requestChange).not.toHaveBeenCalled();
  });

  it('passes only the authenticated vendor actor into supplier writes', async () => {
    const requestChange = vi.fn().mockResolvedValue({ id: 'case-1', status: 'pending' });
    const response = await request(appFor(createSupplierPortalRouter({ requestChange } as never, supplierAuth(['supplier.profile.request_change']))))
      .post('/api/supplier-portal/v1/profile-change-cases')
      .set('Idempotency-Key', 'change-intent-1')
      .send({ changeType: 'legal', proposedValues: { legalName: 'Updated Supplier Pvt Ltd' } });
    expect(response.status).toBe(201);
    expect(requestChange).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'vendor-a', legalEntityId: 'entity-a' }), expect.anything(), 'change-intent-1');
  });

  it('uses digest-only token helpers and narrowly scoped supplier cookies', () => {
    const raw = 'one-time-secret-value';
    expect(supplierTokenHash(raw)).toMatch(/^[a-f0-9]{64}$/);
    expect(supplierTokenHash(raw)).not.toContain(raw);
    expect(supplierCookie('session', new Date('2030-01-01T00:00:00.000Z'))).toContain('Path=/api/supplier-portal/v1');
    expect(clearSupplierCookie()).toContain('Max-Age=0');
  });

  it('places the one-time invite in a URL fragment that is never sent to the server', () => {
    const path = supplierInvitePath('secret/value');
    expect(path).toBe('/supplier-portal#invite=secret%2Fvalue');
    expect(path).not.toContain('?invite=');
  });

  it('denies both invitation and active-session actions for suspended or blocked vendor lifecycles', () => {
    expect(supplierPortalLifecycleAllowed('suspended')).toBe(false);
    expect(supplierPortalLifecycleAllowed('blocked')).toBe(false);
    expect(supplierPortalLifecycleAllowed('approved')).toBe(true);
    expect(supplierPortalLifecycleAllowed('conditionally_approved')).toBe(true);
  });

  it('requires payment proposal, invoice and legal-entity currencies to match exactly', () => {
    expect(() => assertPaymentCurrency('INR', 'INR', 'INR')).not.toThrow();
    expect(() => assertPaymentCurrency('USD', 'INR', 'INR')).toThrowError(ApiError);
    expect(() => assertPaymentCurrency('INR', 'INR', 'USD')).toThrowError(ApiError);
  });
});

describe('internal supplier management controls', () => {
  const userMiddleware: RequestHandler = (req, _res, next) => {
    req.user = {
      userId: 'user-a', email: 'buyer@example.test', name: 'Buyer', organizationId: 'org-a', organizationName: 'Org',
      organizationSlug: 'org', membershipId: 'member-a', employeeCode: 'E1', role: 'Buyer', isAdmin: false,
      membershipStatus: 'active',
      screens: [], services: [{ id: 'mesaerp', name: 'MesaERP', description: '', status: 'active', sortOrder: 1 }], organizations: [],
    };
    next();
  };

  function internalApp(service: object) {
    const app = express(); app.use(express.json()); app.use(userMiddleware); app.use('/api/mesaerp/v1', createSupplierManagementRouter(service as never)); app.use(errorHandler); return app;
  }

  it('requires the exact company permission before creating an RFQ', async () => {
    const createRfq = vi.fn();
    const service = { hasPermission: vi.fn().mockResolvedValue(false), createRfq };
    const response = await request(internalApp(service)).post('/api/mesaerp/v1/entities/entity-a/rfqs').set('Idempotency-Key', 'rfq-intent-1').send({});
    expect(response.status).toBe(403);
    expect(response.body.error.message).toContain('mesaerp.sourcing.manage');
    expect(createRfq).not.toHaveBeenCalled();
  });

  it('keeps one-time invite replay secrets out of the public contract', async () => {
    const service = {
      hasPermission: vi.fn().mockResolvedValue(true),
      invitePortalUser: vi.fn().mockResolvedValue({ id: 'invite-a', token: null, invitePath: null, replayed: true }),
    };
    const response = await request(internalApp(service))
      .post('/api/mesaerp/v1/entities/entity-a/vendors/vendor-a/portal-invitations')
      .set('Idempotency-Key', 'portal-invite-1')
      .send({ email: 'supplier@example.test', name: 'Supplier', expiresInHours: 48, permissions: ['supplier.rfq.respond'] });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: 'invite-a', token: null, invitePath: null, replayed: true });
  });
});
