import express, { type RequestHandler } from 'express';
import { REQUIRED_PERMISSION } from '../middleware/authz';
import { ApiError } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import {
  atpQuerySchema,
  demandForecastCreateSchema,
  mrpRunCreateSchema,
  planningBomCreateSchema,
  planningBomRevisionCreateSchema,
  planningBomRevisionUpdateSchema,
  planningPolicyUpdateSchema,
  rowVersionSchema,
  stockReservationCreateSchema,
} from './planningSchemas';
import { PrismaMesaErpPlanningService } from './planningService';

export const MESAERP_MRP_PERMISSION = 'mesaerp.mrp.manage' as const;

type Service = PrismaMesaErpPlanningService;

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

function requireMrpPermission(service: Service): RequestHandler {
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
        permission: MESAERP_MRP_PERMISSION,
      });
      if (!allowed) {
        res.status(403).json({ error: { code: 'forbidden', message: `Missing explicit MesaERP permission: ${MESAERP_MRP_PERMISSION}.` } });
        return;
      }
      next();
    } catch (error) { next(error); }
  };
  return Object.assign(handler, { [REQUIRED_PERMISSION]: MESAERP_MRP_PERMISSION });
}

function idempotencyKey(req: express.Request) {
  const key = (req.header('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new ApiError(400, 'idempotency_key_required', 'A valid Idempotency-Key header is required.');
  return key;
}

const ah = (handler: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { handler(req, res).then((value) => { if (!res.headersSent && value !== undefined) res.json(value); }).catch(next); };

export function createMesaErpPlanningRouter(service = new PrismaMesaErpPlanningService()) {
  const router = express.Router();
  router.use(requireEntitlement());
  const permission = requireMrpPermission(service);

  router.get('/entities/:legalEntityId/items/:itemId/planning-policy', permission, ah((req) =>
    service.getPlanningPolicy(req.params.legalEntityId, req.params.itemId)));
  router.patch('/entities/:legalEntityId/items/:itemId/planning-policy', permission, validateBody(planningPolicyUpdateSchema), ah((req) =>
    service.updatePlanningPolicy(req.params.legalEntityId, req.params.itemId, req.body, idempotencyKey(req))));

  router.get('/entities/:legalEntityId/planning-boms', permission, ah((req) => service.listBoms(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/planning-boms', permission, validateBody(planningBomCreateSchema), ah(async (req, res) => {
    res.status(201); return service.createBom(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.get('/entities/:legalEntityId/planning-boms/:bomId', permission, ah((req) => service.getBom(req.params.legalEntityId, req.params.bomId)));
  router.post('/entities/:legalEntityId/planning-boms/:bomId/revisions', permission, validateBody(planningBomRevisionCreateSchema), ah(async (req, res) => {
    res.status(201); return service.createBomRevision(req.params.legalEntityId, req.params.bomId, req.body, idempotencyKey(req));
  }));
  router.patch('/entities/:legalEntityId/planning-boms/:bomId/revisions/:revisionId', permission, validateBody(planningBomRevisionUpdateSchema), ah((req) =>
    service.updateBomRevision(req.params.legalEntityId, req.params.bomId, req.params.revisionId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/planning-boms/:bomId/revisions/:revisionId/submit', permission, validateBody(rowVersionSchema), ah((req) =>
    service.transitionBomRevision(req.params.legalEntityId, req.params.bomId, req.params.revisionId, 'submit', req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/planning-boms/:bomId/revisions/:revisionId/approve', permission, validateBody(rowVersionSchema), ah((req) =>
    service.transitionBomRevision(req.params.legalEntityId, req.params.bomId, req.params.revisionId, 'approve', req.body, idempotencyKey(req))));

  router.get('/entities/:legalEntityId/demand-forecasts', permission, ah((req) => service.listForecasts(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/demand-forecasts', permission, validateBody(demandForecastCreateSchema), ah(async (req, res) => {
    res.status(201); return service.createForecast(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.get('/entities/:legalEntityId/demand-forecasts/:forecastId', permission, ah((req) => service.getForecast(req.params.legalEntityId, req.params.forecastId)));
  router.post('/entities/:legalEntityId/demand-forecasts/:forecastId/submit', permission, validateBody(rowVersionSchema), ah((req) =>
    service.transitionForecast(req.params.legalEntityId, req.params.forecastId, 'submit', req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/demand-forecasts/:forecastId/approve', permission, validateBody(rowVersionSchema), ah((req) =>
    service.transitionForecast(req.params.legalEntityId, req.params.forecastId, 'approve', req.body, idempotencyKey(req))));

  router.get('/entities/:legalEntityId/stock-reservations', permission, ah((req) => service.listReservations(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/stock-reservations', permission, validateBody(stockReservationCreateSchema), ah(async (req, res) => {
    res.status(201); return service.createReservation(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.get('/entities/:legalEntityId/stock-reservations/:reservationId', permission, ah((req) => service.getReservation(req.params.legalEntityId, req.params.reservationId)));
  router.post('/entities/:legalEntityId/stock-reservations/:reservationId/release', permission, validateBody(rowVersionSchema), ah((req) =>
    service.transitionReservation(req.params.legalEntityId, req.params.reservationId, 'release', req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/stock-reservations/:reservationId/cancel', permission, validateBody(rowVersionSchema), ah((req) =>
    service.transitionReservation(req.params.legalEntityId, req.params.reservationId, 'cancel', req.body, idempotencyKey(req))));
  router.get('/entities/:legalEntityId/atp', permission, ah((req) => {
    const parsed = atpQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ApiError(422, 'validation_error', 'Invalid ATP query.', parsed.error.flatten());
    return service.getAtp(req.params.legalEntityId, parsed.data);
  }));

  router.get('/entities/:legalEntityId/mrp-runs', permission, ah((req) => service.listMrpRuns(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/mrp-runs', permission, validateBody(mrpRunCreateSchema), ah(async (req, res) => {
    res.status(201); return service.createMrpRun(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));
  router.get('/entities/:legalEntityId/mrp-runs/:runId', permission, ah((req) => service.getMrpRun(req.params.legalEntityId, req.params.runId)));
  router.get('/entities/:legalEntityId/mrp-runs/:runId/suggestions', permission, ah((req) => service.listMrpSuggestions(req.params.legalEntityId, req.params.runId)));
  router.post('/entities/:legalEntityId/mrp-suggestions/:suggestionId/submit', permission, validateBody(rowVersionSchema), ah((req) =>
    service.transitionMrpSuggestion(req.params.legalEntityId, req.params.suggestionId, 'submit', req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/mrp-suggestions/:suggestionId/approve', permission, validateBody(rowVersionSchema), ah((req) =>
    service.transitionMrpSuggestion(req.params.legalEntityId, req.params.suggestionId, 'approve', req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/mrp-suggestions/:suggestionId/release', permission, validateBody(rowVersionSchema), ah((req) =>
    service.transitionMrpSuggestion(req.params.legalEntityId, req.params.suggestionId, 'release', req.body, idempotencyKey(req))));

  router.get('/entities/:legalEntityId/transfer-proposals', permission, ah((req) => service.listTransferProposals(req.params.legalEntityId)));
  router.get('/entities/:legalEntityId/transfer-proposals/:proposalId', permission, ah((req) => service.getTransferProposal(req.params.legalEntityId, req.params.proposalId)));
  return router;
}

export const mesaErpPlanningRouter = createMesaErpPlanningRouter();
