import express, { type Express, type RequestHandler, type Router } from 'express';
import { ExpressAuth } from '@auth/express';
import { requestLog } from './middleware/log';
import { authenticate, authMode, googleSignInAvailable } from './middleware/auth';
import { resolveTenant } from './middleware/tenant';
import { notFound, errorHandler } from './middleware/error';
import { authRouter, onboardingRouter } from './platform';
import { mountMesaOpsRouters } from './mesaops';
import { mesaLeadsRouter, publicMesaLeadsRouter } from './mesaleads';
import { mountMesaErpRouters, supplierPortalRouter } from './mesaerp';
import { createDocsRouter } from './openapi/router';
import { collectRoutes, type DiscoveredRoute } from './openapi/routes';
import { authConfig, authSecretConfigured } from './auth/config';
import { publicMesaLeadsPreBodyRateLimit, readinessHandler, securityHeaders } from './runtime';

export type BuildApiRouterOptions = {
  /** Include legacy flat MesaOps paths. OpenAPI discovery always leaves this off. */
  mesaOpsCompat?: boolean;
};

/**
 * Builds the `/api` router. Exported on its own so the OpenAPI generator can
 * walk the very same route stack the server serves, rather than a description
 * of it that could drift.
 */
export function buildApiRouter(opts: BuildApiRouterOptions = {}): Router {
  const api = express.Router();

  // Public: liveness + which auth mode the API is in.
  api.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      auth: authMode(),
      google: googleSignInAvailable(),
    });
  });

  // Public: password auth.
  api.use(authRouter);

  // Public MesaLeads questionnaires resolve an opaque token to a tenant and
  // then open their own explicitly RLS-scoped transaction.
  api.use(publicMesaLeadsRouter);

  // Supplier identities are deliberately separate from employee sessions.
  // An opaque supplier cookie resolves only its vendor/company scope before
  // any tenant-owned row is read; these routes never enter employee APIs.
  api.use(supplierPortalRouter);

  // Everything below requires an identity and a resolved tenant.
  api.use(authenticate);
  api.use(resolveTenant);
  api.get('/me', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ user: req.user });
  });

  // Protected onboarding for the internal team only.
  api.use(onboardingRouter);

  // MesaLeads has its own independent organization entitlement.
  api.use(mesaLeadsRouter);

  // MesaERP is independently entitled and mounted before the MesaOps gate.
  // A finance-only organization must never need MesaOps to use its own books.
  mountMesaErpRouters(api);

  // MesaOps under /mesaops/v1 (+ optional legacy flat-path compat).
  mountMesaOpsRouters(api, { compat: opts.mesaOpsCompat });

  return api;
}

/**
 * Every route this server serves, read back off the mounted stacks. The OpenAPI
 * document is built from exactly this, so it cannot describe a route that does
 * not exist — or miss one that does. Compat flat paths are excluded so the
 * contract stays on canonical `/api/mesaops/v1/*` only.
 */
export function discoverRoutes(): DiscoveredRoute[] {
  return collectRoutes(buildApiRouter({ mesaOpsCompat: false }), '/api');
}

/**
 * Mounts the API onto an Express app. Everything under the authenticated router
 * runs with a resolved tenant, so the guarded Prisma client scopes all data.
 */
/** Express 4 mount shim so @auth/express getBasePath sees a splat param. */
const expressAuthHandler: RequestHandler = (req, res, next) => {
  (req.params as Record<string | number, string>)[0] = req.path.replace(/^\//, '') || '';
  return ExpressAuth(authConfig)(req, res, next);
};

export function mountApi(app: Express): void {
  app.disable('x-powered-by');
  // Trust only the explicitly configured number of reverse-proxy hops. Blanket
  // `true` lets a direct client forge X-Forwarded-For and bypass IP controls.
  const configuredProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '0', 10);
  app.set('trust proxy', Number.isSafeInteger(configuredProxyHops) && configuredProxyHops > 0 ? configuredProxyHops : false);
  app.use(securityHeaders);

  // Parse narrow routes before the default API parser. Public questionnaires
  // may contain binary attachments encoded as base64, with a 16 MiB transport
  // ceiling above the stricter aggregate business-schema limit; supplier
  // evidence and ERP imports receive smaller dedicated ceilings.
  // All ordinary/authenticated API requests are capped at 512 KiB before any
  // authentication or tenant database work is attempted.
  app.use('/api/public/mesaleads', publicMesaLeadsPreBodyRateLimit, express.json({ limit: '16mb' }));
  app.use('/api/supplier-portal/v1', express.json({ limit: '2mb' }));
  app.use('/api/mesaerp/v1', express.json({ limit: '2mb' }));
  app.use('/api/mesaops/v1', express.json({ limit: '512kb' }));
  app.use('/api', express.json({ limit: '512kb' }));

  // Auth.js OAuth routes (Google callback, CSRF, sign-out). Requires AUTH_SECRET.
  if (authSecretConfigured()) {
    app.use('/auth', expressAuthHandler);
  }

  app.use('/api', requestLog);
  app.get('/api/ready', readinessHandler);

  // Spec + reference UI. Unauthenticated so integrators can read the contract
  // before they hold a credential.
  app.use('/api', createDocsRouter(discoverRoutes));

  // Runtime mounts include MesaOps compat when enabled (default outside production).
  app.use('/api', buildApiRouter());
  app.use('/api', notFound); // unknown /api/* → JSON 404, never the SPA shell
}

/**
 * Build a bare API app (no SPA serving) — used by integration tests via
 * supertest. The full server (index.ts) adds Vite/static SPA serving.
 */
export function buildApp(): Express {
  const app = express();
  mountApi(app);
  app.use(errorHandler);
  return app;
}
