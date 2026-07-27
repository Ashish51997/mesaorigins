import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { maintenanceCreateSchema } from './schemas';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const maintenanceRouter = express.Router();

// Machine registry — reference data available to any signed-in org member.
maintenanceRouter.get('/machines', ah(() => svc.listMachines()));

// Maintenance tasks (Maintenance Head's Preventive Schedule).
maintenanceRouter.get('/maintenance', requirePermission('screen:preventive'), ah(() => svc.listMaintenance()));
maintenanceRouter.post('/maintenance', requirePermission('screen:preventive'), validateBody(maintenanceCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.addMaintenance(req.body); }));
maintenanceRouter.post('/maintenance/:id/complete', requirePermission('screen:preventive'),
  ah((req) => svc.completeMaintenance(req.params.id)));
