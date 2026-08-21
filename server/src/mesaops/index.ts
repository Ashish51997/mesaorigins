import express, { type Router } from 'express';
import { requireService } from '../middleware/serviceEntitlement';
import { salesRouter } from './sales/router';
import { maintenanceRouter } from './maintenance/router';
import { planningRouter } from './planning/router';
import { logbookRouter } from './logbook/router';
import { qualityRouter } from './quality/router';
import { dispatchRouter } from './dispatch/router';
import { inventoryRouter } from './inventory/router';
import { capaRouter } from './capa/router';
import { formulationRouter } from './formulation/router';
import { dashboardRouter } from './dashboard/router';
import { adminRouter } from './admin/router';

export const MESAOPS_API_PREFIX = '/mesaops/v1';

let compatDeprecationLogged = false;

/** Whether to also expose legacy flat MesaOps paths (`/api/customers`, …). */
export function isMesaOpsApiCompatEnabled(): boolean {
  const raw = (process.env.MESAOPS_API_COMPAT || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  if (raw === '1' || raw === 'true' || raw === 'on') return true;
  // Default on outside production so local/demo clients keep working during cutover.
  return process.env.NODE_ENV !== 'production';
}

function attachDomainRouters(router: Router): void {
  router.use(salesRouter);
  router.use(maintenanceRouter);
  router.use(planningRouter);
  router.use(logbookRouter);
  router.use(qualityRouter);
  router.use(dispatchRouter);
  router.use(inventoryRouter);
  router.use(capaRouter);
  router.use(formulationRouter);
  router.use(dashboardRouter);
  router.use(adminRouter);
}

function createMesaOpsDomainRouter(): Router {
  const router = express.Router();
  attachDomainRouters(router);
  return router;
}

export type MountMesaOpsOptions = {
  /** Mount legacy flat paths alongside `/mesaops/v1`. Default: env / non-production. */
  compat?: boolean;
};

/**
 * Mount MesaOps under `/mesaops/v1` with `requireService('mesaops')`.
 * Optionally also mounts the same routers at the old flat prefixes for one release.
 */
export function mountMesaOpsRouters(api: Router, opts: MountMesaOpsOptions = {}): void {
  const gate = requireService('mesaops');
  api.use(MESAOPS_API_PREFIX, gate, createMesaOpsDomainRouter());

  const compat = opts.compat ?? isMesaOpsApiCompatEnabled();
  if (!compat) return;

  if (!compatDeprecationLogged) {
    compatDeprecationLogged = true;
    console.warn(
      '[mesaops] MESAOPS_API_COMPAT is enabling legacy flat API paths '
      + '(/api/customers, /api/plans, …). Prefer /api/mesaops/v1/*; remove the shim after clients migrate.',
    );
  }
  // Same handlers at the historical root paths for temporary compatibility.
  api.use(gate, createMesaOpsDomainRouter());
}

export {
  salesRouter,
  maintenanceRouter,
  planningRouter,
  logbookRouter,
  qualityRouter,
  dispatchRouter,
  inventoryRouter,
  capaRouter,
  formulationRouter,
  dashboardRouter,
  adminRouter,
};
