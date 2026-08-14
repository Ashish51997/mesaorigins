import express, { type RequestHandler } from 'express';
import { ApiError } from '../middleware/error';
import { REQUIRED_PERMISSION } from '../middleware/authz';
import { validateBody } from '../middleware/validate';
import {
  purchaseMatchApproveSchema,
  purchaseMatchCreateSchema,
  sourceToPayDocumentCreateSchema,
  sourceToPayTransitionSchema,
  type SourceToPayDocumentType,
} from './sourceToPaySchemas';
import {
  PrismaMesaErpSourceToPayService,
  type MesaErpSourceToPayService,
} from './sourceToPayService';

export const MESAERP_SOURCE_TO_PAY_PERMISSIONS = {
  requisition: 'mesaerp.sourcing.manage',
  procurement: 'mesaerp.procurement.manage',
  match: 'mesaerp.purchase.match',
} as const;

const DOCUMENT_ROUTES: Array<{
  path: string;
  type: SourceToPayDocumentType;
  permission: string;
}> = [
  { path: 'purchase-requisitions', type: 'purchase_requisition', permission: MESAERP_SOURCE_TO_PAY_PERMISSIONS.requisition },
  { path: 'purchase-orders', type: 'purchase_order', permission: MESAERP_SOURCE_TO_PAY_PERMISSIONS.procurement },
  { path: 'goods-receipts', type: 'goods_receipt', permission: MESAERP_SOURCE_TO_PAY_PERMISSIONS.procurement },
  { path: 'supplier-invoices', type: 'supplier_invoice', permission: MESAERP_SOURCE_TO_PAY_PERMISSIONS.procurement },
];

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

function requireExactPermission(service: MesaErpSourceToPayService, permission: string): RequestHandler {
  const handler: RequestHandler = async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } });
        return;
      }
      const legalEntityId = req.params.legalEntityId || '';
      const allowed = legalEntityId && await service.hasPermission({
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

export function createMesaErpSourceToPayRouter(
  service: MesaErpSourceToPayService = new PrismaMesaErpSourceToPayService(),
): express.Router {
  const router = express.Router();
  router.use(requireEntitlement());

  for (const resource of DOCUMENT_ROUTES) {
    const permission = requireExactPermission(service, resource.permission);
    router.get(
      `/entities/:legalEntityId/${resource.path}`,
      permission,
      ah((req) => service.listDocuments(req.params.legalEntityId, resource.type)),
    );
    router.post(
      `/entities/:legalEntityId/${resource.path}`,
      permission,
      validateBody(sourceToPayDocumentCreateSchema),
      ah(async (req, res) => {
        res.status(201);
        return service.createDocument(req.params.legalEntityId, resource.type, req.body, idempotencyKey(req));
      }),
    );
    router.get(
      `/entities/:legalEntityId/${resource.path}/:documentId`,
      permission,
      ah((req) => service.getDocument(req.params.legalEntityId, resource.type, req.params.documentId)),
    );
    router.post(
      `/entities/:legalEntityId/${resource.path}/:documentId/submit`,
      permission,
      validateBody(sourceToPayTransitionSchema),
      ah((req) => service.submitDocument(
        req.params.legalEntityId,
        resource.type,
        req.params.documentId,
        req.body,
        idempotencyKey(req),
      )),
    );
    router.post(
      `/entities/:legalEntityId/${resource.path}/:documentId/approve`,
      permission,
      validateBody(sourceToPayTransitionSchema),
      ah((req) => service.approveDocument(
        req.params.legalEntityId,
        resource.type,
        req.params.documentId,
        req.body,
        idempotencyKey(req),
      )),
    );
  }

  const matchPermission = requireExactPermission(service, MESAERP_SOURCE_TO_PAY_PERMISSIONS.match);
  router.get(
    '/entities/:legalEntityId/purchase-matches',
    matchPermission,
    ah((req) => service.listMatches(req.params.legalEntityId)),
  );
  router.post(
    '/entities/:legalEntityId/purchase-matches',
    matchPermission,
    validateBody(purchaseMatchCreateSchema),
    ah(async (req, res) => {
      res.status(201);
      return service.createMatch(req.params.legalEntityId, req.body, idempotencyKey(req));
    }),
  );
  router.get(
    '/entities/:legalEntityId/purchase-matches/:matchCaseId',
    matchPermission,
    ah((req) => service.getMatch(req.params.legalEntityId, req.params.matchCaseId)),
  );
  router.post(
    '/entities/:legalEntityId/purchase-matches/:matchCaseId/approve',
    matchPermission,
    validateBody(purchaseMatchApproveSchema),
    ah((req) => service.approveMatch(
      req.params.legalEntityId,
      req.params.matchCaseId,
      req.body,
      idempotencyKey(req),
    )),
  );

  return router;
}

export const mesaErpSourceToPayRouter = createMesaErpSourceToPayRouter();
