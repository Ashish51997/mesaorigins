import express, { type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { ALL_SCREENS } from '../../lib/permissions';
import { ApiError } from '../../middleware/error';
import {
  employeeCreateSchema,
  employeeUpdateSchema,
  roleCreateSchema,
  roleUpdateSchema,
  grantsSetSchema,
  passwordSetSchema,
  mesaOpsRoleAssignmentCreateSchema,
  mesaOpsRoleAssignmentRevokeSchema,
} from './schemas';
import * as svc from './service';
import {
  mesaOpsStatutoryRuleProfileApproveSchema,
  mesaOpsStatutoryRuleProfileCreateSchema,
} from '../dispatch/statutoryProfileSchemas';
import * as statutoryProfiles from '../dispatch/statutoryProfileService';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

const USERS = 'screen:users';
const ACL = 'screen:acl';
export const adminRouter = express.Router();

function idempotencyKey(req: express.Request): string {
  const key = (req.header('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new ApiError(400, 'idempotency_key_required', 'A valid Idempotency-Key header is required.');
  }
  return key;
}

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
adminRouter.post('/employees/:id/password', requirePermission(USERS), validateBody(passwordSetSchema),
  ah((req) => svc.setEmployeePassword(req.params.id, req.body)));

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

// Explicit MesaOps scope administration. The service id is fixed server-side;
// this surface cannot create, edit or revoke a MesaERP role assignment.
adminRouter.get('/mesaops/role-assignments', requirePermission(ACL),
  ah(() => svc.listMesaOpsRoleAssignments()));
adminRouter.post('/mesaops/role-assignments', requirePermission(ACL), validateBody(mesaOpsRoleAssignmentCreateSchema),
  ah(async (req, res) => {
    res.status(201);
    return svc.createMesaOpsRoleAssignment(req.body, idempotencyKey(req));
  }));
adminRouter.post('/mesaops/role-assignments/:id/revoke', requirePermission(ACL), validateBody(mesaOpsRoleAssignmentRevokeSchema),
  ah((req) => svc.revokeMesaOpsRoleAssignment(req.params.id, req.body, idempotencyKey(req))));

// Independent MesaOps statutory applicability register. These exact action
// permissions all map to Plant Administration/ACL server-side; the approval
// action still requires a checker membership distinct from the draft maker.
adminRouter.get('/mesaops/admin/statutory-rule-profiles', requirePermission('action:mesaops.statutory_rule_profile.view'),
  ah(() => statutoryProfiles.listMesaOpsStatutoryRuleProfiles()));
adminRouter.get('/mesaops/admin/statutory-rule-profiles/:id', requirePermission('action:mesaops.statutory_rule_profile.view'),
  ah((req) => statutoryProfiles.getMesaOpsStatutoryRuleProfile(req.params.id)));
adminRouter.post('/mesaops/admin/statutory-rule-profiles', requirePermission('action:mesaops.statutory_rule_profile.create'),
  validateBody(mesaOpsStatutoryRuleProfileCreateSchema),
  ah(async (req, res) => {
    res.status(201);
    return statutoryProfiles.createMesaOpsStatutoryRuleProfile(req.body, idempotencyKey(req));
  }));
adminRouter.post('/mesaops/admin/statutory-rule-profiles/:id/approve', requirePermission('action:mesaops.statutory_rule_profile.approve'),
  validateBody(mesaOpsStatutoryRuleProfileApproveSchema),
  ah((req) => statutoryProfiles.approveMesaOpsStatutoryRuleProfile(req.params.id, req.body, idempotencyKey(req))));
