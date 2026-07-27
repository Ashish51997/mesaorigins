import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { receiveSchema, issueSchema } from './schemas';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const inventoryRouter = express.Router();

// Ledger-derived stock board + the ledger itself.
inventoryRouter.get('/inventory/stock', requirePermission('screen:rm_stock'), ah(() => svc.listStock()));
inventoryRouter.get('/inventory/transactions', requirePermission('screen:rm_stock'), ah(() => svc.listTransactions()));

// Raw-material receive / issue-to-machine.
inventoryRouter.post('/inventory/receive', requirePermission('screen:receive'), validateBody(receiveSchema),
  ah(async (req, res) => { res.status(201); return svc.receive(req.body); }));
inventoryRouter.post('/inventory/issue', requirePermission('action:lot.issue'), validateBody(issueSchema),
  ah(async (req, res) => { res.status(201); return svc.issue(req.body); }));
