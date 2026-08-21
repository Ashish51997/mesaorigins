import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { formulationCreateSchema, formulationUpdateSchema } from './schemas';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const formulationRouter = express.Router();

// Formulations (BOM) — read on the Formulations screen; create/edit gated on formula.edit.
formulationRouter.get('/formulations', requirePermission('screen:formulations'), ah(() => svc.listFormulations()));
formulationRouter.post('/formulations', requirePermission('action:formula.edit'), validateBody(formulationCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createFormulation(req.body); }));
formulationRouter.patch('/formulations/:id', requirePermission('action:formula.edit'), validateBody(formulationUpdateSchema),
  ah((req) => svc.updateFormulation(req.params.id, req.body)));
