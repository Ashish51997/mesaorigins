import express, { type RequestHandler } from 'express';
import { REQUIRED_PERMISSION } from '../middleware/authz';
import { ApiError } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import {
  handoffAcceptSchema,
  handoffEventRouteApproveSchema,
  handoffEventRouteCreateSchema,
  handoffMappingApproveSchema,
  handoffMappingCreateSchema,
  handoffMappingUpdateSchema,
  handoffReceiveSchema,
  handoffRejectSchema,
  handoffRetrySchema,
  tdsDeductionCreateSchema,
  tdsRateCreateSchema,
  tdsReportQuerySchema,
  tdsSectionCreateSchema,
  tdsTransitionSchema,
  vendorTdsClassificationCreateSchema,
} from './handoffTdsSchemas';
import { PrismaMesaErpHandoffService } from './handoffService';
import { PrismaMesaErpTdsService } from './tdsService';

type PermissionService = {
  hasPermission(input: { organizationId: string; membershipId: string; legalEntityId: string; permission: string }): Promise<boolean>;
};

export const MESAERP_HANDOFF_PERMISSION = 'mesaerp.handoff.manage';
export const MESAERP_TDS_PERMISSION = 'mesaerp.tds.manage';

const ah = (handler: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { handler(req, res).then((value) => { if (!res.headersSent && value !== undefined) res.json(value); }).catch(next); };

function requireEntitlement(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) { res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } }); return; }
    if (!req.user.services.some((service) => service.id === 'mesaerp' && service.status === 'active')) {
      res.status(403).json({ error: { code: 'service_not_entitled', message: 'MesaERP is not active for this organization.' } }); return;
    }
    next();
  };
}

function requirePermission(service: PermissionService, permission: string): RequestHandler {
  const handler: RequestHandler = async (req, res, next) => {
    try {
      const user = req.user;
      const legalEntityId = req.params.legalEntityId || '';
      if (!user) { res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } }); return; }
      const allowed = Boolean(legalEntityId) && await service.hasPermission({
        organizationId: user.organizationId, membershipId: user.membershipId, legalEntityId, permission,
      });
      if (!allowed) { res.status(403).json({ error: { code: 'forbidden', message: `Missing explicit MesaERP permission: ${permission}.` } }); return; }
      next();
    } catch (error) { next(error); }
  };
  return Object.assign(handler, { [REQUIRED_PERMISSION]: permission });
}

function idempotencyKey(req: express.Request): string {
  const key = (req.header('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new ApiError(400, 'idempotency_key_required', 'A valid Idempotency-Key header is required.');
  return key;
}

function tdsReportQuery(req: express.Request) {
  const raw = Object.fromEntries(Object.entries(req.query).filter(([, value]) => typeof value === 'string'));
  const parsed = tdsReportQuerySchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(422, 'validation_error', parsed.error.issues.map((issue) => issue.message).join('; '));
  return parsed.data;
}

export function createMesaErpHandoffTdsRouter(
  handoff = new PrismaMesaErpHandoffService(),
  tds = new PrismaMesaErpTdsService(),
) {
  const router = express.Router();
  router.use(requireEntitlement());
  const handoffPermission = requirePermission(handoff, MESAERP_HANDOFF_PERMISSION);
  const tdsPermission = requirePermission(tds, MESAERP_TDS_PERMISSION);

  router.get('/entities/:legalEntityId/handoff-mappings', handoffPermission, ah((req) => handoff.listMappings(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/handoff-mappings', handoffPermission, validateBody(handoffMappingCreateSchema), ah(async (req, res) => {
    res.status(201); return handoff.createMapping(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.patch('/entities/:legalEntityId/handoff-mappings/:mappingId', handoffPermission, validateBody(handoffMappingUpdateSchema), ah((req) => (
    handoff.updateMapping(req.params.legalEntityId, req.params.mappingId, req.body, idempotencyKey(req))
  )));
  router.post('/entities/:legalEntityId/handoff-mappings/:mappingId/approve', handoffPermission, validateBody(handoffMappingApproveSchema), ah((req) => (
    handoff.approveMapping(req.params.legalEntityId, req.params.mappingId, req.body, idempotencyKey(req))
  )));

  router.get('/entities/:legalEntityId/handoff-event-routes', handoffPermission, ah((req) => handoff.listEventRoutes(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/handoff-event-routes', handoffPermission, validateBody(handoffEventRouteCreateSchema), ah(async (req, res) => {
    res.status(201); return handoff.createEventRoute(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.post('/entities/:legalEntityId/handoff-event-routes/:routeId/approve', handoffPermission, validateBody(handoffEventRouteApproveSchema), ah((req) => (
    handoff.approveEventRoute(req.params.legalEntityId, req.params.routeId, req.body, idempotencyKey(req))
  )));

  router.get('/entities/:legalEntityId/handoff-inbox', handoffPermission, ah((req) => handoff.listInbox(req.params.legalEntityId)));
  router.get('/entities/:legalEntityId/handoff-inbox/:inboxId', handoffPermission, ah((req) => handoff.getInbox(req.params.legalEntityId, req.params.inboxId)));
  router.post('/entities/:legalEntityId/handoff-inbox/events/:eventId/receive', handoffPermission, validateBody(handoffReceiveSchema), ah(async (req, res) => {
    res.status(201); return handoff.receive(req.params.legalEntityId, req.params.eventId, req.body, idempotencyKey(req));
  }));
  router.post('/entities/:legalEntityId/handoff-inbox/:inboxId/accept', handoffPermission, validateBody(handoffAcceptSchema), ah((req) => (
    handoff.accept(req.params.legalEntityId, req.params.inboxId, req.body, idempotencyKey(req))
  )));
  router.post('/entities/:legalEntityId/handoff-inbox/:inboxId/reject', handoffPermission, validateBody(handoffRejectSchema), ah((req) => (
    handoff.reject(req.params.legalEntityId, req.params.inboxId, req.body, idempotencyKey(req))
  )));
  router.post('/entities/:legalEntityId/handoff-inbox/:inboxId/retry', handoffPermission, validateBody(handoffRetrySchema), ah((req) => (
    handoff.retry(req.params.legalEntityId, req.params.inboxId, req.body, idempotencyKey(req))
  )));

  router.get('/entities/:legalEntityId/tds/sections', tdsPermission, ah((req) => tds.listSections(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/tds/sections', tdsPermission, validateBody(tdsSectionCreateSchema), ah(async (req, res) => {
    res.status(201); return tds.createSection(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.post('/entities/:legalEntityId/tds/sections/:sectionId/approve', tdsPermission, validateBody(tdsTransitionSchema), ah((req) => (
    tds.approveSection(req.params.legalEntityId, req.params.sectionId, req.body, idempotencyKey(req))
  )));
  router.get('/entities/:legalEntityId/tds/sections/:sectionId/rates', tdsPermission, ah((req) => tds.listRates(req.params.legalEntityId, req.params.sectionId)));
  router.post('/entities/:legalEntityId/tds/sections/:sectionId/rates', tdsPermission, validateBody(tdsRateCreateSchema), ah(async (req, res) => {
    res.status(201); return tds.createRate(req.params.legalEntityId, req.params.sectionId, req.body, idempotencyKey(req));
  }));
  router.post('/entities/:legalEntityId/tds/rates/:rateId/approve', tdsPermission, validateBody(tdsTransitionSchema), ah((req) => (
    tds.approveRate(req.params.legalEntityId, req.params.rateId, req.body, idempotencyKey(req))
  )));

  router.get('/entities/:legalEntityId/vendors/:vendorId/tds-classifications', tdsPermission, ah((req) => (
    tds.listVendorClassifications(req.params.legalEntityId, req.params.vendorId)
  )));
  router.post('/entities/:legalEntityId/vendors/:vendorId/tds-classifications', tdsPermission, validateBody(vendorTdsClassificationCreateSchema), ah(async (req, res) => {
    res.status(201); return tds.createVendorClassification(req.params.legalEntityId, req.params.vendorId, req.body, idempotencyKey(req));
  }));
  router.post('/entities/:legalEntityId/tds/vendor-classifications/:classificationId/approve', tdsPermission, validateBody(tdsTransitionSchema), ah((req) => (
    tds.approveVendorClassification(req.params.legalEntityId, req.params.classificationId, req.body, idempotencyKey(req))
  )));

  router.get('/entities/:legalEntityId/tds/deductions', tdsPermission, ah((req) => tds.listDeductions(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/tds/deductions', tdsPermission, validateBody(tdsDeductionCreateSchema), ah(async (req, res) => {
    res.status(201); return tds.createDeduction(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.post('/entities/:legalEntityId/tds/deductions/:deductionId/submit', tdsPermission, validateBody(tdsTransitionSchema), ah((req) => (
    tds.transitionDeduction(req.params.legalEntityId, req.params.deductionId, 'submit', req.body, idempotencyKey(req))
  )));
  router.post('/entities/:legalEntityId/tds/deductions/:deductionId/approve', tdsPermission, validateBody(tdsTransitionSchema), ah((req) => (
    tds.transitionDeduction(req.params.legalEntityId, req.params.deductionId, 'approve', req.body, idempotencyKey(req))
  )));
  router.get('/entities/:legalEntityId/reports/tds-deductions', tdsPermission, ah((req) => tds.report(req.params.legalEntityId, tdsReportQuery(req))));

  return router;
}

export const mesaErpHandoffTdsRouter = createMesaErpHandoffTdsRouter();
