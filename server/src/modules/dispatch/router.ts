import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { dispatchCreateSchema } from './schemas';
import { ApiError } from '../../middleware/error';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const dispatchRouter = express.Router();

function idempotencyKey(req: express.Request): string {
  const key = (req.header('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new ApiError(400, 'idempotency_key_required', 'A valid Idempotency-Key header is required.');
  return key;
}

// Orders ready to ship (production complete) + dispatch history.
dispatchRouter.get('/dispatch/ready', requirePermission('screen:ready'), ah(() => svc.listReady()));
dispatchRouter.get('/dispatches', requirePermission('screen:dispatch_history'), ah(() => svc.listDispatches()));

// Dispatch an order: gate-pass/document reference, order status, FG stock out.
dispatchRouter.post('/dispatches', requirePermission('action:dispatch.mark'), validateBody(dispatchCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createDispatch(req.body, idempotencyKey(req)); }));
