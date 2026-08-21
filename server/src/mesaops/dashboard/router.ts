import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const dashboardRouter = express.Router();

// Real KPI aggregates for the per-role dashboards. Gated on the dashboard screen,
// which every role holds.
dashboardRouter.get('/summary', requirePermission('screen:dashboard'), ah(() => svc.summary()));

// Managing Director plant overview (Figma management dashboard). MD-only screen.
dashboardRouter.get(
  '/management/overview',
  requirePermission('screen:management_dashboard'),
  ah(() => svc.managementOverview()),
);
