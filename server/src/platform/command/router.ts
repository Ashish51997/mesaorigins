import express, { type RequestHandler } from 'express';
import { listCommandExceptions } from './service';
import { listProductCatalogPublic, PRODUCT_CATALOG } from '../productCatalog';
import type { PlatformServiceId } from '../productCatalog';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const commandRouter = express.Router();

commandRouter.get('/exceptions', ah(async (req, res) => {
  const organizationId = req.user?.organizationId ?? '';
  res.json(await listCommandExceptions(organizationId));
}));

/** Customer org admin: active vs available sellable modules. */
commandRouter.get('/organization-products', ah(async (req, res) => {
  const activeIds = new Set((req.user?.services ?? []).map((s) => s.id));
  const catalog = listProductCatalogPublic();
  const modules = Object.values(PRODUCT_CATALOG).map((m) => ({
    ...m,
    active: activeIds.has(m.id),
  }));
  const available = modules.filter((m) => !m.active);
  res.json({
    active: modules.filter((m) => m.active),
    available,
    surfaces: catalog.surfaces,
    packages: catalog.packages,
  });
}));

export function inferPackageProfile(serviceIds: string[]): string {
  const ids = new Set(serviceIds);
  const has = (id: PlatformServiceId) => ids.has(id);
  if (has('mesaops') && has('mesaleads') && has('mesaerp')) return 'manufacturing-suite';
  if (has('mesaleads') && has('mesaerp') && !has('mesaops')) return 'commercial-start';
  if (has('mesaops') && !has('mesaleads') && !has('mesaerp')) return 'plant-start';
  return 'custom';
}
