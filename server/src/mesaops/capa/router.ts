import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { complaintCreateSchema, capaUpdateSchema } from './schemas';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

const GATE = 'screen:sales_complaints';
export const capaRouter = express.Router();

// Complaints (linked to a dispatched batch) + the batches to pick from.
capaRouter.get('/complaints/batches', requirePermission(GATE), ah(() => svc.listBatches()));
capaRouter.get('/complaints', requirePermission(GATE), ah(() => svc.listComplaints()));
capaRouter.post('/complaints', requirePermission(GATE), validateBody(complaintCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createComplaint(req.body); }));
capaRouter.post('/complaints/:id/resolve', requirePermission(GATE), ah((req) => svc.resolveComplaint(req.params.id)));

// CAPA tickets.
capaRouter.get('/capas', requirePermission(GATE), ah(() => svc.listCapas()));
capaRouter.patch('/capas/:id', requirePermission(GATE), validateBody(capaUpdateSchema),
  ah((req) => svc.updateCapa(req.params.id, req.body)));
capaRouter.post('/capas/:id/close', requirePermission(GATE), ah((req) => svc.closeCapa(req.params.id)));
