import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { ALL_SCREENS } from '../../lib/permissions';
import { employeeCreateSchema, employeeUpdateSchema, roleCreateSchema, roleUpdateSchema, grantsSetSchema } from './schemas';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

const USERS = 'screen:users';
const ACL = 'screen:acl';
export const adminRouter = express.Router();

// The caller's own effective access — the client uses this to gate its menu.
adminRouter.get('/me/permissions', ah(async (req) => ({ isAdmin: req.user?.isAdmin ?? false, screens: req.user?.screens ?? [] })));
// Roster for the login picker / role switcher (any authed member; resolves via
// the admin fallback pre-login).
adminRouter.get('/directory', ah(() => svc.listDirectory()));
// Screen catalog for the roles editor.
adminRouter.get('/screens', requirePermission(ACL), ah(async () => ({ screens: ALL_SCREENS })));

// Employees (People & Roles).
adminRouter.get('/employees', requirePermission(USERS), ah(() => svc.listEmployees()));
adminRouter.post('/employees', requirePermission(USERS), validateBody(employeeCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createEmployee(req.body); }));
adminRouter.patch('/employees/:id', requirePermission(USERS), validateBody(employeeUpdateSchema),
  ah((req) => svc.updateEmployee(req.params.id, req.body)));

// Roles list is read by both the employee form and the roles page.
adminRouter.get('/roles', requirePermission(USERS), ah(() => svc.listRoles()));
adminRouter.post('/roles', requirePermission(ACL), validateBody(roleCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createRole(req.body); }));
adminRouter.patch('/roles/:id', requirePermission(ACL), validateBody(roleUpdateSchema),
  ah((req) => svc.updateRole(req.params.id, req.body)));
adminRouter.delete('/roles/:id', requirePermission(ACL), ah((req) => svc.deleteRole(req.params.id)));

// Per-employee screen overrides.
adminRouter.get('/employees/:id/grants', requirePermission(ACL), ah((req) => svc.listGrants(req.params.id)));
adminRouter.put('/employees/:id/grants', requirePermission(ACL), validateBody(grantsSetSchema),
  ah((req) => svc.setGrants(req.params.id, req.body)));
