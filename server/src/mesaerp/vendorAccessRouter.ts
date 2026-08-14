import express, { type RequestHandler } from 'express';
import { ApiError } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import { REQUIRED_PERMISSION } from '../middleware/authz';
import {
  PrismaMesaErpVendorAccessService,
  type MesaErpVendorAccessService,
} from './vendorAccessService';
import {
  roleAssignmentCreateSchema,
  roleAssignmentRevokeSchema,
  erpRoleCreateSchema,
  rolePermissionsReplaceSchema,
  vendorBankCreateSchema,
  vendorBankVerifySchema,
  vendorCreateSchema,
  vendorLifecycleTransitionSchema,
} from './vendorAccessSchemas';

export const MESAERP_VENDOR_ACCESS_PERMISSIONS = {
  vendorRead: 'mesaerp.vendor.read',
  vendorCreate: 'mesaerp.vendor.manage',
  vendorReview: 'mesaerp.vendor.manage',
  vendorBankAdd: 'mesaerp.vendor.manage',
  vendorBankVerify: 'mesaerp.vendor.bank.verify',
  accessRead: 'mesaerp.access.manage',
  accessAssign: 'mesaerp.access.manage',
  accessRevoke: 'mesaerp.access.manage',
} as const;

function requireEntitlement(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } });
      return;
    }
    if (!req.user.services.some((service) => service.id === 'mesaerp' && service.status === 'active')) {
      res.status(403).json({ error: { code: 'service_not_entitled', message: 'MesaERP is not active for this organization.' } });
      return;
    }
    next();
  };
}

function requireExactPermission(service: MesaErpVendorAccessService, permission: string): RequestHandler {
  const handler: RequestHandler = async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } });
        return;
      }
      const legalEntityId = req.params.legalEntityId || '';
      if (!legalEntityId) {
        res.status(400).json({ error: { code: 'legal_entity_required', message: 'A legal entity is required.' } });
        return;
      }
      const allowed = await service.hasPermission({
        organizationId: user.organizationId,
        membershipId: user.membershipId,
        legalEntityId,
        permission,
      });
      if (!allowed) {
        res.status(403).json({ error: { code: 'forbidden', message: `Missing explicit MesaERP permission: ${permission}.` } });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
  return Object.assign(handler, { [REQUIRED_PERMISSION]: permission });
}

function idempotencyKey(req: express.Request): string {
  const key = (req.header('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new ApiError(400, 'idempotency_key_required', 'A valid Idempotency-Key header is required.');
  }
  return key;
}

const ah = (handler: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    handler(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export function createMesaErpVendorAccessRouter(
  service: MesaErpVendorAccessService = new PrismaMesaErpVendorAccessService(),
): express.Router {
  const router = express.Router();
  router.use(requireEntitlement());

  router.get(
    '/entities/:legalEntityId/vendors',
    requireExactPermission(service, MESAERP_VENDOR_ACCESS_PERMISSIONS.vendorRead),
    ah((req) => service.listVendors(req.params.legalEntityId)),
  );
  router.post(
    '/entities/:legalEntityId/access/roles',
    requireExactPermission(service, MESAERP_VENDOR_ACCESS_PERMISSIONS.accessAssign),
    validateBody(erpRoleCreateSchema),
    ah(async (req, res) => {
      res.status(201);
      return service.createRole(req.params.legalEntityId, req.body, idempotencyKey(req));
    }),
  );
  router.post(
    '/entities/:legalEntityId/vendors',
    requireExactPermission(service, MESAERP_VENDOR_ACCESS_PERMISSIONS.vendorCreate),
    validateBody(vendorCreateSchema),
    ah(async (req, res) => {
      res.status(201);
      return service.createVendor(req.params.legalEntityId, req.body, idempotencyKey(req));
    }),
  );
  router.post(
    '/entities/:legalEntityId/vendors/:vendorId/lifecycle',
    requireExactPermission(service, MESAERP_VENDOR_ACCESS_PERMISSIONS.vendorReview),
    validateBody(vendorLifecycleTransitionSchema),
    ah((req) => service.transitionVendor(req.params.legalEntityId, req.params.vendorId, req.body, idempotencyKey(req))),
  );
  router.post(
    '/entities/:legalEntityId/vendors/:vendorId/bank-accounts',
    requireExactPermission(service, MESAERP_VENDOR_ACCESS_PERMISSIONS.vendorBankAdd),
    validateBody(vendorBankCreateSchema),
    ah(async (req, res) => {
      res.status(201);
      return service.addVendorBank(req.params.legalEntityId, req.params.vendorId, req.body, idempotencyKey(req));
    }),
  );
  router.post(
    '/entities/:legalEntityId/vendors/:vendorId/bank-accounts/:bankAccountId/verify',
    requireExactPermission(service, MESAERP_VENDOR_ACCESS_PERMISSIONS.vendorBankVerify),
    validateBody(vendorBankVerifySchema),
    ah((req) => service.verifyVendorBank(
      req.params.legalEntityId,
      req.params.vendorId,
      req.params.bankAccountId,
      req.body,
      idempotencyKey(req),
    )),
  );

  router.get(
    '/entities/:legalEntityId/access/roles',
    requireExactPermission(service, MESAERP_VENDOR_ACCESS_PERMISSIONS.accessRead),
    ah((req) => service.listRoles(req.params.legalEntityId)),
  );
  router.put(
    '/entities/:legalEntityId/access/roles/:roleId/permissions',
    requireExactPermission(service, MESAERP_VENDOR_ACCESS_PERMISSIONS.accessAssign),
    validateBody(rolePermissionsReplaceSchema),
    ah((req) => service.replaceRolePermissions(
      req.params.legalEntityId,
      req.params.roleId,
      req.body,
      idempotencyKey(req),
    )),
  );

  router.get(
    '/entities/:legalEntityId/access/permissions',
    requireExactPermission(service, MESAERP_VENDOR_ACCESS_PERMISSIONS.accessRead),
    ah((req) => service.listPermissions(req.params.legalEntityId)),
  );
  router.get(
    '/entities/:legalEntityId/access/role-assignments',
    requireExactPermission(service, MESAERP_VENDOR_ACCESS_PERMISSIONS.accessRead),
    ah((req) => service.listRoleAssignments(req.params.legalEntityId)),
  );
  router.post(
    '/entities/:legalEntityId/access/role-assignments',
    requireExactPermission(service, MESAERP_VENDOR_ACCESS_PERMISSIONS.accessAssign),
    validateBody(roleAssignmentCreateSchema),
    ah(async (req, res) => {
      res.status(201);
      return service.assignRole(req.params.legalEntityId, req.body, idempotencyKey(req));
    }),
  );
  router.post(
    '/entities/:legalEntityId/access/role-assignments/:assignmentId/revoke',
    requireExactPermission(service, MESAERP_VENDOR_ACCESS_PERMISSIONS.accessRevoke),
    validateBody(roleAssignmentRevokeSchema),
    ah((req) => service.revokeRole(
      req.params.legalEntityId,
      req.params.assignmentId,
      req.body,
      idempotencyKey(req),
    )),
  );

  return router;
}

export const mesaErpVendorAccessRouter = createMesaErpVendorAccessRouter();
