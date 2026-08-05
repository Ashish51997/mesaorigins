import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { planCreateSchema, planUpdateSchema } from './schemas';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const planningRouter = express.Router();

// Orders awaiting planning + operator roster for assignment.
planningRouter.get('/planning/orders', requirePermission('screen:orders_to_plan'), ah(() => svc.listOrdersToPlan()));
planningRouter.get('/planning/operators', requirePermission('screen:orders_to_plan'), ah(() => svc.listOperators()));

// Production plans.
planningRouter.get('/plans', requirePermission('screen:plan_board'), ah(() => svc.listPlans()));
planningRouter.post('/plans', requirePermission('action:order.plan'), validateBody(planCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createPlan(req.body); }));
planningRouter.patch('/plans/:id', requirePermission('action:order.plan'), validateBody(planUpdateSchema),
  ah((req) => svc.updatePlan(req.params.id, req.body)));
planningRouter.post('/plans/:id/release', requirePermission('action:order.plan'),
  ah((req) => svc.releasePlan(req.params.id)));
