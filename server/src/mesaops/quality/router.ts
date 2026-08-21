import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { inspectionCreateSchema } from './schemas';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const qualityRouter = express.Router();

// Roll inspection queue (packed rolls from submitted logbooks) + history.
qualityRouter.get('/quality/queue', requirePermission('screen:roll_queue'), ah(() => svc.listQueue()));
qualityRouter.get('/quality/inspections', requirePermission('screen:roll_queue'), ah(() => svc.listInspections()));

// Record a pass / hold / fail (a pass books finished-goods stock).
qualityRouter.post('/quality/inspections', requirePermission('action:qa.pass'), validateBody(inspectionCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createInspection(req.body); }));
