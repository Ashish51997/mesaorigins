import type { RequestHandler } from 'express';
import { basePrisma, withTenant } from '../db';
import { ApiError } from '../middleware/error';
import { REQUIRED_PERMISSION } from '../middleware/authz';
import { supplierPortalLifecycleAllowed, type SupplierActor, supplierTokenHash } from './supplierPortalService';

export const SUPPLIER_SESSION_COOKIE = 'mesaorigins_supplier_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      supplier?: SupplierActor;
      supplierSessionHash?: string;
    }
  }
}

export function cookieValue(header: string, name: string): string {
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('=') || '');
  }
  return '';
}

export const authenticateSupplier: RequestHandler = async (req, res, next) => {
  try {
    const raw = cookieValue(req.headers.cookie || '', SUPPLIER_SESSION_COOKIE);
    if (!raw) throw new ApiError(401, 'supplier_unauthenticated', 'Supplier portal sign-in is required.');
    const digest = supplierTokenHash(raw);
    const session = await basePrisma.supplierPortalSession.findUnique({ where: { tokenHash: digest } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new ApiError(401, 'supplier_session_invalid', 'Supplier session is invalid or expired.');
    }
    const entitlement = await basePrisma.organizationService.findFirst({
      where: {
        organizationId: session.organizationId,
        serviceId: 'mesaerp',
        status: 'active',
        service: { status: 'active' },
        organization: { status: { not: 'suspended' } },
      },
    });
    if (!entitlement) throw new ApiError(403, 'service_not_entitled', 'Supplier portal is unavailable for this organization.');
    const actor = await withTenant(session.organizationId, async (db) => {
      const [entity, user, vendor] = await Promise.all([
        db.legalEntity.findFirst({ where: { id: session.legalEntityId, organizationId: session.organizationId, status: 'active' } }),
        db.supplierPortalUser.findFirst({ where: { id: session.portalUserId, organizationId: session.organizationId, legalEntityId: session.legalEntityId, vendorId: session.vendorId } }),
        db.erpVendor.findFirst({ where: { id: session.vendorId, organizationId: session.organizationId, legalEntityId: session.legalEntityId } }),
      ]);
      if (!entity || !user || user.status !== 'active' || !vendor || !supplierPortalLifecycleAllowed(vendor.lifecycleStatus)) {
        throw new ApiError(403, 'supplier_access_denied', 'Supplier portal access is unavailable.');
      }
      const permissions = Array.isArray(user.permissions) ? user.permissions.filter((value): value is string => typeof value === 'string') : [];
      if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
        await db.supplierPortalSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
        await db.supplierPortalUser.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
      }
      return { organizationId: session.organizationId, legalEntityId: session.legalEntityId, vendorId: session.vendorId, portalUserId: user.id, email: user.email, name: user.name, permissions };
    });
    req.supplier = actor;
    req.supplierSessionHash = digest;
    next();
  } catch (error) {
    next(error);
  }
};

export function requireSupplierPermission(permission: string): RequestHandler {
  const handler: RequestHandler = (req, res, next) => {
    if (!req.supplier) {
      res.status(401).json({ error: { code: 'supplier_unauthenticated', message: 'Supplier portal sign-in is required.' } });
      return;
    }
    if (!req.supplier.permissions.includes(permission)) {
      res.status(403).json({ error: { code: 'supplier_forbidden', message: `Missing supplier portal permission: ${permission}.` } });
      return;
    }
    next();
  };
  return Object.assign(handler, { [REQUIRED_PERMISSION]: permission });
}

export function supplierCookie(token: string, expiresAt: Date): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SUPPLIER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api/supplier-portal/v1; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearSupplierCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SUPPLIER_SESSION_COOKIE}=; Path=/api/supplier-portal/v1; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}
