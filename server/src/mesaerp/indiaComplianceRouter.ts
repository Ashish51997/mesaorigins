import express, { type RequestHandler } from 'express';
import { REQUIRED_PERMISSION } from '../middleware/authz';
import { ApiError } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import {
  complianceRuleProfileApproveSchema,
  complianceRuleProfileCreateSchema,
  complianceTransitionSchema,
  eWayBillCreateSchema,
  eWayExtendSchema,
  eWayVehicleUpdateSchema,
  externalEWayBillCreateSchema,
  gstr2bUploadSchema,
  inboundEInvoiceCreateSchema,
  inboundGstr2bReconcileSchema,
  inboundItcDecisionSchema,
  outboundEInvoiceCreateSchema,
  outboundEInvoiceManualAckSchema,
  statutoryCancelSchema,
} from './indiaComplianceSchemas';
import {
  PrismaMesaErpIndiaComplianceService,
  type MesaErpIndiaComplianceService,
  type TaxDocumentDto,
} from './indiaComplianceService';

export const MESAERP_INDIA_COMPLIANCE_PERMISSION = 'mesaerp.tax.manage';

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

function requireExactPermission(service: MesaErpIndiaComplianceService): RequestHandler {
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
        permission: MESAERP_INDIA_COMPLIANCE_PERMISSION,
      });
      if (!allowed) {
        res.status(403).json({ error: { code: 'forbidden', message: `Missing explicit MesaERP permission: ${MESAERP_INDIA_COMPLIANCE_PERMISSION}.` } });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
  return Object.assign(handler, { [REQUIRED_PERMISSION]: MESAERP_INDIA_COMPLIANCE_PERMISSION });
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

export function createMesaErpIndiaComplianceRouter(
  service: MesaErpIndiaComplianceService = new PrismaMesaErpIndiaComplianceService(),
): express.Router {
  const router = express.Router();
  router.use(requireEntitlement());
  const permission = requireExactPermission(service);

  const created = (handler: (req: express.Request) => Promise<unknown>): RequestHandler =>
    ah(async (req, res) => {
      res.status(201);
      return handler(req);
    });

  router.get('/entities/:legalEntityId/compliance-rule-profiles', permission, ah((req) => service.listRuleProfiles(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/compliance-rule-profiles', permission, validateBody(complianceRuleProfileCreateSchema), created((req) => service.createRuleProfile(req.params.legalEntityId, req.body, idempotencyKey(req))));
  router.get('/entities/:legalEntityId/compliance-rule-profiles/:profileId', permission, ah((req) => service.getRuleProfile(req.params.legalEntityId, req.params.profileId)));
  router.post('/entities/:legalEntityId/compliance-rule-profiles/:profileId/approve', permission, validateBody(complianceRuleProfileApproveSchema), ah((req) => service.approveRuleProfile(req.params.legalEntityId, req.params.profileId, req.body, idempotencyKey(req))));

  const collection = (path: string, kind: TaxDocumentDto['documentKind']) => {
    router.get(`/entities/:legalEntityId/${path}`, permission, ah((req) => service.listTaxDocuments(req.params.legalEntityId, kind)));
    router.get(`/entities/:legalEntityId/${path}/:documentId`, permission, ah((req) => service.getTaxDocument(req.params.legalEntityId, kind, req.params.documentId)));
  };

  collection('e-invoices/outbound', 'outbound_e_invoice');
  router.post('/entities/:legalEntityId/e-invoices/outbound', permission, validateBody(outboundEInvoiceCreateSchema), created((req) => service.createOutboundEInvoice(req.params.legalEntityId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-invoices/outbound/:documentId/approve', permission, validateBody(complianceTransitionSchema), ah((req) => service.approveOutboundEInvoice(req.params.legalEntityId, req.params.documentId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-invoices/outbound/:documentId/submit', permission, validateBody(complianceTransitionSchema), ah((req) => service.submitOutboundEInvoice(req.params.legalEntityId, req.params.documentId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-invoices/outbound/:documentId/import-acknowledgement', permission, validateBody(outboundEInvoiceManualAckSchema), ah((req) => service.importOutboundEInvoiceAcknowledgement(req.params.legalEntityId, req.params.documentId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-invoices/outbound/:documentId/cancel', permission, validateBody(statutoryCancelSchema), ah((req) => service.cancelOutboundEInvoice(req.params.legalEntityId, req.params.documentId, req.body, idempotencyKey(req))));

  collection('e-way-bills', 'e_way_bill');
  router.post('/entities/:legalEntityId/e-way-bills', permission, validateBody(eWayBillCreateSchema), created((req) => service.createEWayBill(req.params.legalEntityId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-way-bills/external-evidence', permission, validateBody(externalEWayBillCreateSchema), created((req) => service.createExternalEWayBill(req.params.legalEntityId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-way-bills/:documentId/approve', permission, validateBody(complianceTransitionSchema), ah((req) => service.approveEWayBill(req.params.legalEntityId, req.params.documentId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-way-bills/:documentId/generate', permission, validateBody(complianceTransitionSchema), ah((req) => service.generateEWayBill(req.params.legalEntityId, req.params.documentId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-way-bills/:documentId/verify-external', permission, validateBody(complianceTransitionSchema), ah((req) => service.verifyExternalEWayBill(req.params.legalEntityId, req.params.documentId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-way-bills/:documentId/update-vehicle', permission, validateBody(eWayVehicleUpdateSchema), ah((req) => service.updateEWayBillVehicle(req.params.legalEntityId, req.params.documentId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-way-bills/:documentId/extend', permission, validateBody(eWayExtendSchema), ah((req) => service.extendEWayBill(req.params.legalEntityId, req.params.documentId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-way-bills/:documentId/cancel', permission, validateBody(statutoryCancelSchema), ah((req) => service.cancelEWayBill(req.params.legalEntityId, req.params.documentId, req.body, idempotencyKey(req))));

  collection('e-invoices/inbound', 'inbound_e_invoice');
  router.post('/entities/:legalEntityId/e-invoices/inbound', permission, validateBody(inboundEInvoiceCreateSchema), created((req) => service.createInboundEInvoice(req.params.legalEntityId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-invoices/inbound/:documentId/reconcile-gstr2b', permission, validateBody(inboundGstr2bReconcileSchema), ah((req) => service.reconcileInboundEInvoice(req.params.legalEntityId, req.params.documentId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/e-invoices/inbound/:documentId/itc', permission, validateBody(inboundItcDecisionSchema), ah((req) => service.decideInboundItc(req.params.legalEntityId, req.params.documentId, req.body, idempotencyKey(req))));

  collection('gstr2b', 'gstr2b');
  router.post('/entities/:legalEntityId/gstr2b', permission, validateBody(gstr2bUploadSchema), created((req) => service.uploadGstr2b(req.params.legalEntityId, req.body, idempotencyKey(req))));

  return router;
}

export const mesaErpIndiaComplianceRouter = createMesaErpIndiaComplianceRouter();
