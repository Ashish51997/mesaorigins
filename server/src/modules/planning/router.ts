import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { ApiError } from '../../middleware/error';
import { requireMesaErpHandoffSignature } from '../../middleware/internalServiceAuth';
import { mesaErpOperationalOrderHandoffSchema, mesaErpOutboxHandoffAcceptSchema, operationalOrderCreateSchema, planCreateSchema, planReleaseSchema, planUpdateSchema } from './schemas';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const planningRouter = express.Router();

function idempotencyKey(req: express.Request): string {
  const key = (req.header('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new ApiError(400, 'idempotency_key_required', 'A valid Idempotency-Key header is required.');
  }
  return key;
}

// MesaOps-owned demand. It works without a MesaERP sales order and carries its
// source type separately from its plant lifecycle.
planningRouter.get('/operational-orders', requirePermission('screen:orders_to_plan'), ah(() => svc.listOperationalOrders()));
planningRouter.post('/operational-orders', requirePermission('action:operational_order.create'), validateBody(operationalOrderCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createOperationalOrder(req.body, idempotencyKey(req)); }));
planningRouter.post('/operational-orders/handoffs/mesaerp', requirePermission('action:operational_order.create'), requireMesaErpHandoffSignature, validateBody(mesaErpOperationalOrderHandoffSchema),
  ah(async (req, res) => {
    const result = await svc.acceptMesaErpOperationalOrder(req.body);
    res.status(result.status === 'accepted' ? 201 : result.status === 'conflict' ? 409 : 200);
    return result;
  }));
planningRouter.get('/operational-orders/handoffs/mesaerp', requirePermission('screen:orders_to_plan'),
  ah(() => svc.listMesaErpOperationalOrderHandoffs()));
planningRouter.post('/operational-orders/handoffs/mesaerp/:eventId/accept', requirePermission('action:operational_order.create'), validateBody(mesaErpOutboxHandoffAcceptSchema),
  ah(async (req, res) => {
    idempotencyKey(req); // event id is the durable dedupe identity; header is still mandatory for every write.
    const result = await svc.acceptMesaErpOperationalOrderFromOutbox(req.params.eventId, req.body);
    res.status(result.status === 'accepted' ? 201 : result.status === 'conflict' ? 409 : 200);
    return result;
  }));

// Orders awaiting planning + operator roster for assignment.
planningRouter.get('/planning/orders', requirePermission('screen:orders_to_plan'), ah(() => svc.listOrdersToPlan()));
planningRouter.get('/planning/operators', requirePermission('screen:orders_to_plan'), ah(() => svc.listOperators()));

// Production plans.
planningRouter.get('/plans', requirePermission('screen:plan_board'), ah(() => svc.listPlans()));
planningRouter.post('/plans', requirePermission('action:order.plan'), validateBody(planCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createPlan(req.body, idempotencyKey(req)); }));
planningRouter.patch('/plans/:id', requirePermission('action:order.plan'), validateBody(planUpdateSchema),
  ah((req) => svc.updatePlan(req.params.id, req.body, idempotencyKey(req))));
planningRouter.post('/plans/:id/release', requirePermission('action:order.plan'), validateBody(planReleaseSchema),
  ah((req) => svc.releasePlan(req.params.id, req.body, idempotencyKey(req))));
