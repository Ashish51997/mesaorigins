import express, { type RequestHandler } from 'express';
import { REQUIRED_PERMISSION } from '../middleware/authz';
import { ApiError } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import {
  customerCreateSchema,
  customerUpdateSchema,
  manufacturingVoucherCreateSchema,
  productionDemandCreateSchema,
  rowVersionTransitionSchema,
  salesDocumentCreateSchema,
  type SalesDocumentType,
} from './commercialManufacturingSchemas';
import {
  PrismaMesaErpCommercialManufacturingService,
  type MesaErpCommercialManufacturingService,
} from './commercialManufacturingService';

export const MESAERP_COMMERCIAL_MANUFACTURING_PERMISSIONS = {
  sales: 'mesaerp.sales.manage',
  manufacturing: 'mesaerp.manufacturing.manage',
} as const;

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

function requireExactPermission(service: MesaErpCommercialManufacturingService, permission: string): RequestHandler {
  const handler: RequestHandler = async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } });
        return;
      }
      const legalEntityId = req.params.legalEntityId || '';
      const allowed = Boolean(legalEntityId) && await service.hasPermission({
        organizationId: user.organizationId,
        membershipId: user.membershipId,
        legalEntityId,
        permission,
      });
      if (!allowed) {
        res.status(403).json({ error: { code: 'forbidden', message: `Missing explicit MesaERP permission: ${permission}.` } });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
  return Object.assign(handler, { [REQUIRED_PERMISSION]: permission });
}

function idempotencyKey(req: express.Request): string {
  const key = (req.header('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new ApiError(400, 'idempotency_key_required', 'A valid Idempotency-Key header is required.');
  }
  return key;
}

const ah = (handler: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    handler(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export function createMesaErpCommercialManufacturingRouter(
  service: MesaErpCommercialManufacturingService = new PrismaMesaErpCommercialManufacturingService(),
): express.Router {
  const router = express.Router();
  router.use(requireEntitlement());

  const salesPermission = requireExactPermission(service, MESAERP_COMMERCIAL_MANUFACTURING_PERMISSIONS.sales);
  router.get('/entities/:legalEntityId/customers', salesPermission, ah((req) => service.listCustomers(req.params.legalEntityId)));
  router.post(
    '/entities/:legalEntityId/customers',
    salesPermission,
    validateBody(customerCreateSchema),
    ah(async (req, res) => {
      res.status(201);
      return service.createCustomer(req.params.legalEntityId, req.body, idempotencyKey(req));
    }),
  );
  router.get('/entities/:legalEntityId/customers/:customerId', salesPermission, ah((req) => service.getCustomer(req.params.legalEntityId, req.params.customerId)));
  router.patch(
    '/entities/:legalEntityId/customers/:customerId',
    salesPermission,
    validateBody(customerUpdateSchema),
    ah((req) => service.updateCustomer(req.params.legalEntityId, req.params.customerId, req.body, idempotencyKey(req))),
  );

  const salesResources: Array<{ path: string; type: SalesDocumentType }> = [
    { path: 'sales-orders', type: 'sales_order' },
    { path: 'sales-invoices', type: 'sales_invoice' },
  ];
  for (const resource of salesResources) {
    const collection = `/entities/:legalEntityId/${resource.path}`;
    router.get(collection, salesPermission, ah((req) => service.listSalesDocuments(req.params.legalEntityId, resource.type)));
    router.post(
      collection,
      salesPermission,
      validateBody(salesDocumentCreateSchema),
      ah(async (req, res) => {
        res.status(201);
        return service.createSalesDocument(req.params.legalEntityId, resource.type, req.body, idempotencyKey(req));
      }),
    );
    router.get(`${collection}/:documentId`, salesPermission, ah((req) => service.getSalesDocument(req.params.legalEntityId, resource.type, req.params.documentId)));
    router.post(
      `${collection}/:documentId/submit`,
      salesPermission,
      validateBody(rowVersionTransitionSchema),
      ah((req) => service.transitionSalesDocument(req.params.legalEntityId, resource.type, req.params.documentId, 'submit', req.body, idempotencyKey(req))),
    );
    router.post(
      `${collection}/:documentId/approve`,
      salesPermission,
      validateBody(rowVersionTransitionSchema),
      ah((req) => service.transitionSalesDocument(req.params.legalEntityId, resource.type, req.params.documentId, 'approve', req.body, idempotencyKey(req))),
    );
  }

  const manufacturingPermission = requireExactPermission(service, MESAERP_COMMERCIAL_MANUFACTURING_PERMISSIONS.manufacturing);
  router.get('/entities/:legalEntityId/production-demands', manufacturingPermission, ah((req) => service.listProductionDemands(req.params.legalEntityId)));
  router.post(
    '/entities/:legalEntityId/production-demands',
    manufacturingPermission,
    validateBody(productionDemandCreateSchema),
    ah(async (req, res) => {
      res.status(201);
      return service.createProductionDemand(req.params.legalEntityId, req.body, idempotencyKey(req));
    }),
  );
  router.get('/entities/:legalEntityId/production-demands/:demandId', manufacturingPermission, ah((req) => service.getProductionDemand(req.params.legalEntityId, req.params.demandId)));
  for (const action of ['approve', 'release'] as const) {
    router.post(
      `/entities/:legalEntityId/production-demands/:demandId/${action}`,
      manufacturingPermission,
      validateBody(rowVersionTransitionSchema),
      ah((req) => service.transitionProductionDemand(req.params.legalEntityId, req.params.demandId, action, req.body, idempotencyKey(req))),
    );
  }

  router.get('/entities/:legalEntityId/manufacturing-vouchers', manufacturingPermission, ah((req) => service.listManufacturingVouchers(req.params.legalEntityId)));
  router.post(
    '/entities/:legalEntityId/manufacturing-vouchers',
    manufacturingPermission,
    validateBody(manufacturingVoucherCreateSchema),
    ah(async (req, res) => {
      res.status(201);
      return service.createManufacturingVoucher(req.params.legalEntityId, req.body, idempotencyKey(req));
    }),
  );
  router.get('/entities/:legalEntityId/manufacturing-vouchers/:voucherId', manufacturingPermission, ah((req) => service.getManufacturingVoucher(req.params.legalEntityId, req.params.voucherId)));
  for (const action of ['submit', 'approve', 'post'] as const) {
    router.post(
      `/entities/:legalEntityId/manufacturing-vouchers/:voucherId/${action}`,
      manufacturingPermission,
      validateBody(rowVersionTransitionSchema),
      ah((req) => service.transitionManufacturingVoucher(req.params.legalEntityId, req.params.voucherId, action, req.body, idempotencyKey(req))),
    );
  }

  router.get('/entities/:legalEntityId/batch-costs', manufacturingPermission, ah((req) => service.listBatchCosts(req.params.legalEntityId)));
  router.get('/entities/:legalEntityId/batch-costs/:batchCostId', manufacturingPermission, ah((req) => service.getBatchCost(req.params.legalEntityId, req.params.batchCostId)));

  return router;
}

export const mesaErpCommercialManufacturingRouter = createMesaErpCommercialManufacturingRouter();
