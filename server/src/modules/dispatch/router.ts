import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { dispatchCreateSchema } from './schemas';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const dispatchRouter = express.Router();

// Orders ready to ship (production complete) + dispatch history.
dispatchRouter.get('/dispatch/ready', requirePermission('screen:ready'), ah(() => svc.listReady()));
dispatchRouter.get('/dispatches', requirePermission('screen:dispatch_history'), ah(() => svc.listDispatches()));

// Dispatch an order: record + invoice, order → dispatched, FG stock out.
dispatchRouter.post('/dispatches', requirePermission('action:dispatch.mark'), validateBody(dispatchCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createDispatch(req.body); }));
