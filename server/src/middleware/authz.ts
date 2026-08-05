import type { RequestHandler } from 'express';
import { accessAllows } from '../lib/permissions';

// Marker the OpenAPI generator reads off a mounted handler to recover the
// feature key a route is gated on.
export const REQUIRED_PERMISSION = Symbol.for('erp.openapi.permission');

export interface PermissionGuardHandler extends RequestHandler {
  [REQUIRED_PERMISSION]: string;
}

/**
 * Route guard: require the signed-in user's role to hold a feature permission
 * (e.g. 'screen:orders' or 'action:order.approve'). This is where server-side
 * authorization is actually enforced — the client's can() is only cosmetic.
 */
export const requirePermission = (featureKey: string): RequestHandler => {
  const handler: RequestHandler = (req, res, next) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } });
      return;
    }
    if (!accessAllows(user.screens ?? [], user.isAdmin ?? false, featureKey)) {
      res.status(403).json({ error: { code: 'forbidden', message: `Your role (${user.role}) is not permitted to ${featureKey}.` } });
      return;
    }
    next();
  };
  return Object.assign(handler, { [REQUIRED_PERMISSION]: featureKey });
};

/** Allow if the actor holds any one of the listed feature keys. */
export const requireAnyPermission = (...featureKeys: string[]): RequestHandler => {
  const primary = featureKeys[0] ?? 'screen:dashboard';
  const handler: RequestHandler = (req, res, next) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } });
      return;
    }
    const screens = user.screens ?? [];
    const ok = featureKeys.some((k) => accessAllows(screens, user.isAdmin ?? false, k));
    if (!ok) {
      res.status(403).json({ error: { code: 'forbidden', message: `Your role (${user.role}) is not permitted.` } });
      return;
    }
    next();
  };
  return Object.assign(handler, { [REQUIRED_PERMISSION]: primary });
};
