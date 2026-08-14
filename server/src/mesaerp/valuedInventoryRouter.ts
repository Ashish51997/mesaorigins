import express, { type RequestHandler } from 'express';
import { REQUIRED_PERMISSION } from '../middleware/authz';
import { ApiError } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import { PrismaMesaErpValuedInventoryService } from './valuedInventoryService';
import {
  itemCreateSchema,
  itemUpdateSchema,
  physicalCountCreateSchema,
  stockAdjustmentCreateSchema,
  stockTransferCreateSchema,
  warehouseCreateSchema,
  warehouseUpdateSchema,
} from './valuedInventorySchemas';

export const MESAERP_VALUED_INVENTORY_PERMISSION = 'mesaerp.inventory.manage' as const;

type Service = PrismaMesaErpValuedInventoryService;

function requireEntitlement(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } });
      return;
    }
    if (!req.user.services.some((service) => service.id === 'mesaerp' && service.status === 'active')) {
      res.status(403).json({ error: { code: 'service_not_entitled', message: 'MesaERP is not active for this organization.' } });
      return;
    }
    next();
  };
}

function requireInventoryPermission(service: Service): RequestHandler {
  const handler: RequestHandler = async (req, res, next) => {
    try {
      const user = req.user;
      const legalEntityId = req.params.legalEntityId || '';
      if (!user) {
        res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } });
        return;
      }
      const allowed = Boolean(legalEntityId) && await service.hasPermission({
        organizationId: user.organizationId,
        membershipId: user.membershipId,
        legalEntityId,
        permission: MESAERP_VALUED_INVENTORY_PERMISSION,
      });
      if (!allowed) {
        res.status(403).json({ error: { code: 'forbidden', message: `Missing explicit MesaERP permission: ${MESAERP_VALUED_INVENTORY_PERMISSION}.` } });
        return;
      }
      next();
    } catch (error) { next(error); }
  };
  return Object.assign(handler, { [REQUIRED_PERMISSION]: MESAERP_VALUED_INVENTORY_PERMISSION });
}

function idempotencyKey(req: express.Request): string {
  const key = (req.header('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new ApiError(400, 'idempotency_key_required', 'A valid Idempotency-Key header is required.');
  return key;
}

const ah = (handler: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { handler(req, res).then((value) => { if (!res.headersSent && value !== undefined) res.json(value); }).catch(next); };

function optionalFilter(req: express.Request, name: 'itemId' | 'warehouseId') {
  const value = typeof req.query[name] === 'string' ? req.query[name].trim() : '';
  if (value.length > 128) throw new ApiError(422, 'invalid_filter', `${name} is too long.`);
  return value || undefined;
}

export function createMesaErpValuedInventoryRouter(service = new PrismaMesaErpValuedInventoryService()) {
  const router = express.Router();
  router.use(requireEntitlement());
  const permission = requireInventoryPermission(service);

  router.get('/entities/:legalEntityId/items', permission, ah((req) => service.listItems(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/items', permission, validateBody(itemCreateSchema), ah(async (req, res) => {
    res.status(201); return service.createItem(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.get('/entities/:legalEntityId/items/:itemId', permission, ah((req) => service.getItem(req.params.legalEntityId, req.params.itemId)));
  router.patch('/entities/:legalEntityId/items/:itemId', permission, validateBody(itemUpdateSchema), ah((req) => service.updateItem(req.params.legalEntityId, req.params.itemId, req.body, idempotencyKey(req))));

  router.get('/entities/:legalEntityId/warehouses', permission, ah((req) => service.listWarehouses(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/warehouses', permission, validateBody(warehouseCreateSchema), ah(async (req, res) => {
    res.status(201); return service.createWarehouse(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.get('/entities/:legalEntityId/warehouses/:warehouseId', permission, ah((req) => service.getWarehouse(req.params.legalEntityId, req.params.warehouseId)));
  router.patch('/entities/:legalEntityId/warehouses/:warehouseId', permission, validateBody(warehouseUpdateSchema), ah((req) => service.updateWarehouse(req.params.legalEntityId, req.params.warehouseId, req.body, idempotencyKey(req))));

  router.get('/entities/:legalEntityId/stock-balances', permission, ah((req) => service.listStockBalances(req.params.legalEntityId, { itemId: optionalFilter(req, 'itemId'), warehouseId: optionalFilter(req, 'warehouseId') })));
  router.get('/entities/:legalEntityId/stock-ledger', permission, ah((req) => service.listStockLedger(req.params.legalEntityId, { itemId: optionalFilter(req, 'itemId'), warehouseId: optionalFilter(req, 'warehouseId') })));
  router.post('/entities/:legalEntityId/stock-adjustments', permission, validateBody(stockAdjustmentCreateSchema), ah(async (req, res) => {
    res.status(201); return service.createAdjustment(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.post('/entities/:legalEntityId/stock-transfers', permission, validateBody(stockTransferCreateSchema), ah(async (req, res) => {
    res.status(201); return service.createTransfer(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.post('/entities/:legalEntityId/physical-counts', permission, validateBody(physicalCountCreateSchema), ah(async (req, res) => {
    res.status(201); return service.createPhysicalCount(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.get('/entities/:legalEntityId/physical-counts/:countId', permission, ah((req) => service.getPhysicalCount(req.params.legalEntityId, req.params.countId)));
  router.get('/entities/:legalEntityId/posting-links/:sourceType/:sourceId', permission, ah((req) => service.getPostingLink(req.params.legalEntityId, req.params.sourceType, req.params.sourceId)));
  return router;
}

export const mesaErpValuedInventoryRouter = createMesaErpValuedInventoryRouter();
