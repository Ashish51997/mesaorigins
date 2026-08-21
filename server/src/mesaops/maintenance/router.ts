import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { machineCreateSchema, maintenanceCreateSchema } from './schemas';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const maintenanceRouter = express.Router();

// Machine registry — list is available to any signed-in org member; create is
// gated to the Maintenance Machines screen (Maintenance Head + grants).
maintenanceRouter.get('/machines', ah(() => svc.listMachines()));
maintenanceRouter.post('/machines', requirePermission('screen:machines'), validateBody(machineCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createMachine(req.body); }));

// Maintenance tasks (Maintenance Head's Preventive Schedule).
maintenanceRouter.get('/maintenance', requirePermission('screen:preventive'), ah(() => svc.listMaintenance()));
maintenanceRouter.post('/maintenance', requirePermission('screen:preventive'), validateBody(maintenanceCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.addMaintenance(req.body); }));
maintenanceRouter.post('/maintenance/:id/complete', requirePermission('screen:preventive'),
  ah((req) => svc.completeMaintenance(req.params.id)));
