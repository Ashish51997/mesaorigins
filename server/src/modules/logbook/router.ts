import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { logbookCreateSchema, logbookUpdateSchema, templateCreateSchema, templateUpdateSchema } from './schemas';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const logbookRouter = express.Router();

// Templates are reference data (planner picker, template builder, operator sheet) —
// readable by any authed member.
logbookRouter.get('/logbook/templates', ah(() => svc.listTemplates()));
logbookRouter.get('/logbook/plans', requirePermission('screen:logbooks'), ah(() => svc.listPlansToLog()));
// Active formulations to fill the Formula No field from.
logbookRouter.get('/logbook/formulas', requirePermission('screen:logbooks'), ah(() => svc.listActiveFormulas()));
// Machine-Tasks page: scheduled/running plans grouped by machine.
logbookRouter.get('/logbook/tasks', requirePermission('screen:machine_tasks'), ah(() => svc.listTasks()));

// Template builder (admin).
logbookRouter.post('/logbook/templates', requirePermission('screen:logbook_templates'), validateBody(templateCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createTemplate(req.body); }));
logbookRouter.patch('/logbook/templates/:id', requirePermission('screen:logbook_templates'), validateBody(templateUpdateSchema),
  ah((req) => svc.updateTemplate(req.params.id, req.body)));
logbookRouter.delete('/logbook/templates/:id', requirePermission('screen:logbook_templates'),
  ah((req) => svc.deleteTemplate(req.params.id)));

// The logbook for a plan (may be null until opened).
logbookRouter.get('/logbooks/plan/:planId', requirePermission('screen:logbooks'),
  ah((req) => svc.getLogbookForPlan(req.params.planId).then((lb) => lb ?? null)));

// Open (get-or-create) a draft, save edits, submit + lock.
logbookRouter.post('/logbooks', requirePermission('action:logbook.edit'), validateBody(logbookCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.openLogbook(req.body.productionPlanId); }));
logbookRouter.patch('/logbooks/:id', requirePermission('action:logbook.edit'), validateBody(logbookUpdateSchema),
  ah((req) => svc.updateLogbook(req.params.id, req.body)));
logbookRouter.post('/logbooks/:id/submit', requirePermission('action:logbook.edit'),
  ah((req) => svc.submitLogbook(req.params.id)));
