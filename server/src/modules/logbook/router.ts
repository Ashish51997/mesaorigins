import express, { type RequestHandler } from 'express';
import { requirePermission, requireAnyPermission } from '../../middleware/authz';
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
// Operators fill sheets; ledger viewers need the same plan gate to open a submitted entry.
logbookRouter.get('/logbook/plans', requireAnyPermission('screen:logbooks', 'screen:logbook_ledger'), ah(() => svc.listPlansToLog()));
logbookRouter.get('/logbook/formulas', requireAnyPermission('screen:logbooks', 'screen:logbook_ledger'), ah(() => svc.listActiveFormulas()));
// Machine-Tasks page: scheduled/running plans grouped by machine.
logbookRouter.get('/logbook/tasks', requirePermission('screen:machine_tasks'), ah(() => svc.listTasks()));
// Floor QR scan: resolve machine code → best active plan to open.
logbookRouter.get('/logbook/resolve', requirePermission('screen:machine_tasks'),
  ah((req) => {
    const machine = typeof req.query.machine === 'string' ? req.query.machine : '';
    return svc.resolveMachineLogbook(machine);
  }));
// Logbook Ledger: submitted history + summary (optional ?from=&to= YYYY-MM-DD).
logbookRouter.get('/logbook/ledger', requirePermission('screen:logbook_ledger'),
  ah((req) => svc.listLedger({
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
  })));

// Template builder (admin).
logbookRouter.post('/logbook/templates', requirePermission('screen:logbook_templates'), validateBody(templateCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createTemplate(req.body); }));
logbookRouter.patch('/logbook/templates/:id', requirePermission('screen:logbook_templates'), validateBody(templateUpdateSchema),
  ah((req) => svc.updateTemplate(req.params.id, req.body)));
logbookRouter.delete('/logbook/templates/:id', requirePermission('screen:logbook_templates'),
  ah((req) => svc.deleteTemplate(req.params.id)));

// The logbook for a plan (may be null until opened).
logbookRouter.get('/logbooks/plan/:planId', requireAnyPermission('screen:logbooks', 'screen:logbook_ledger'),
  ah((req) => svc.getLogbookForPlan(req.params.planId).then((lb) => lb ?? null)));

// Open (get-or-create) a draft, save edits, submit + lock.
// Ledger viewers may open an existing submitted sheet (get-or-create returns it).
logbookRouter.post('/logbooks', requireAnyPermission('action:logbook.edit', 'screen:logbook_ledger'), validateBody(logbookCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.openLogbook(req.body.productionPlanId); }));
logbookRouter.patch('/logbooks/:id', requirePermission('action:logbook.edit'), validateBody(logbookUpdateSchema),
  ah((req) => svc.updateLogbook(req.params.id, req.body)));
logbookRouter.post('/logbooks/:id/submit', requirePermission('action:logbook.edit'),
  ah((req) => svc.submitLogbook(req.params.id)));
