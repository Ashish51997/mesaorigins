import express, { type Express, type RequestHandler, type Router } from 'express';
import { ExpressAuth } from '@auth/express';
import { requestLog } from './middleware/log';
import { authenticate, authMode, googleSignInAvailable } from './middleware/auth';
import { resolveTenant } from './middleware/tenant';
import { requireService } from './middleware/serviceEntitlement';
import { notFound, errorHandler } from './middleware/error';
import { authRouter } from './modules/auth/router';
import { onboardingRouter } from './modules/onboarding/router';
import { salesRouter } from './modules/sales/router';
import { maintenanceRouter } from './modules/maintenance/router';
import { planningRouter } from './modules/planning/router';
import { logbookRouter } from './modules/logbook/router';
import { qualityRouter } from './modules/quality/router';
import { dispatchRouter } from './modules/dispatch/router';
import { inventoryRouter } from './modules/inventory/router';
import { capaRouter } from './modules/capa/router';
import { formulationRouter } from './modules/formulation/router';
import { dashboardRouter } from './modules/dashboard/router';
import { adminRouter } from './modules/admin/router';
import { mesaLeadsRouter, publicMesaLeadsRouter } from './modules/mesaleads/router';
import { mesaErpRouter, mesaErpVendorAccessRouter, supplierManagementRouter, supplierPortalRouter } from './mesaerp';
import { mesaErpSourceToPayRouter } from './mesaerp/sourceToPayRouter';
import { mesaErpCommercialManufacturingRouter } from './mesaerp/commercialManufacturingRouter';
import { mesaErpIndiaComplianceRouter } from './mesaerp/indiaComplianceRouter';
import { mesaErpValuedInventoryRouter } from './mesaerp/valuedInventoryRouter';
import { mesaErpFinanceControlRouter } from './mesaerp/financeControlRouter';
import { mesaErpPlanningRouter } from './mesaerp/planningRouter';
import { mesaErpHandoffTdsRouter } from './mesaerp/handoffTdsRouter';
import { createDocsRouter } from './openapi/router';
import { collectRoutes, type DiscoveredRoute } from './openapi/routes';
import { authConfig, authSecretConfigured } from './auth/config';
import { publicMesaLeadsPreBodyRateLimit, readinessHandler, securityHeaders } from './runtime';

/**
 * Builds the `/api` router. Exported on its own so the OpenAPI generator can
 * walk the very same route stack the server serves, rather than a description
 * of it that could drift.
 */
export function buildApiRouter(): Router {
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
  api.use('/mesaerp/v1', requireService('mesaerp'), mesaErpRouter);
  api.use('/mesaerp/v1', requireService('mesaerp'), mesaErpVendorAccessRouter);
  api.use('/mesaerp/v1', requireService('mesaerp'), mesaErpSourceToPayRouter);
  api.use('/mesaerp/v1', requireService('mesaerp'), mesaErpCommercialManufacturingRouter);
  api.use('/mesaerp/v1', requireService('mesaerp'), mesaErpIndiaComplianceRouter);
  api.use('/mesaerp/v1', requireService('mesaerp'), supplierManagementRouter);
  api.use('/mesaerp/v1', requireService('mesaerp'), mesaErpValuedInventoryRouter);
  api.use('/mesaerp/v1', requireService('mesaerp'), mesaErpFinanceControlRouter);
  api.use('/mesaerp/v1', requireService('mesaerp'), mesaErpPlanningRouter);
  api.use('/mesaerp/v1', requireService('mesaerp'), mesaErpHandoffTdsRouter);

  // Every router below belongs to MesaOps. A global stop, suspended
  // organization, or inactive assignment fails closed before domain handlers.
  api.use(requireService('mesaops'));

  // Vertical slice: customers → inquiry → quotation → order + directory.
  api.use(salesRouter);
  // Maintenance: machine registry + machine-linked maintenance tasks.
  api.use(maintenanceRouter);
  // Planning: orders-to-plan queue + machine/shift production plans.
  api.use(planningRouter);
  // Manufacturing: shift logbooks gated on a scheduled plan.
  api.use(logbookRouter);
  // Quality: roll inspection queue from submitted logbooks; a pass books FG stock.
  api.use(qualityRouter);
  // Dispatch: produced orders → packing/statutory evidence → physical dispatch.
  api.use(dispatchRouter);
  // Inventory: ledger-derived stock board + RM receive/issue.
  api.use(inventoryRouter);
  // CAPA: complaints on dispatched batches → closed-loop CAPA.
  api.use(capaRouter);
  // Formulations (BOM): coded RM-component recipes with revisions.
  api.use(formulationRouter);
  // Dashboard: real KPI aggregates for the per-role home screens.
  api.use(dashboardRouter);
  // Admin: employees, custom roles, per-employee access + the caller's permissions.
  api.use(adminRouter);

  return api;
}

/**
 * Every route this server serves, read back off the mounted stacks. The OpenAPI
 * document is built from exactly this, so it cannot describe a route that does
 * not exist — or miss one that does.
 */
export function discoverRoutes(): DiscoveredRoute[] {
  return collectRoutes(buildApiRouter(), '/api');
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
