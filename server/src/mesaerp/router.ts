import express, { type RequestHandler } from 'express';
import { ApiError } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import { REQUIRED_PERMISSION } from '../middleware/authz';
import type { MesaErpRepository } from './repository';
import { PrismaMesaErpRepository } from './prismaRepository';
import { hasAnyMesaErpCompanyAccess, hasMesaErpPermission } from './access';
import { legalEntityCreateSchema, voucherCreateSchema, voucherPostSchema, voucherReversalCreateSchema, voucherTransitionSchema, voucherUpdateSchema } from './schemas';
import * as service from './service';

const DEFAULT_REPOSITORY = new PrismaMesaErpRepository();

export const MESAERP_PERMISSIONS = {
  legalEntityManage: 'mesaerp.legal_entity.manage',
  voucherRead: 'mesaerp.voucher.read',
  voucherCreate: 'mesaerp.voucher.create',
  voucherEdit: 'mesaerp.voucher.edit',
  voucherSubmit: 'mesaerp.voucher.submit',
  voucherApprove: 'mesaerp.voucher.approve',
  voucherPost: 'mesaerp.voucher.post',
  voucherReverse: 'mesaerp.voucher.reverse',
} as const;

function requireMesaErpEntitlement(): RequestHandler {
  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } });
      return;
    }
    if (!user.services.some((entry) => entry.id === 'mesaerp' && entry.status === 'active')) {
      res.status(403).json({ error: { code: 'service_not_entitled', message: 'MesaERP is not active for this organization.' } });
      return;
    }
    next();
  };
}

export type MesaErpPermissionResolver = (req: express.Request, permission: string, legalEntityId?: string) => Promise<boolean>;
export type MesaErpCompanyAccessResolver = (req: express.Request, legalEntityId: string) => Promise<boolean>;

const defaultPermissionResolver: MesaErpPermissionResolver = (req, permission, legalEntityId) => {
  const user = req.user;
  if (!user) return Promise.resolve(false);
  return hasMesaErpPermission({
    organizationId: user.organizationId,
    membershipId: user.membershipId,
    permission,
    legalEntityId,
  });
};

const defaultCompanyAccessResolver: MesaErpCompanyAccessResolver = (req, legalEntityId) => {
  const user = req.user;
  if (!user) return Promise.resolve(false);
  return hasAnyMesaErpCompanyAccess({
    organizationId: user.organizationId,
    membershipId: user.membershipId,
    legalEntityId,
  });
};

/** Exact grants only; unlike legacy action guards, unknown MesaERP actions deny. */
function requireMesaErpPermission(permission: string, resolvePermission: MesaErpPermissionResolver): RequestHandler {
  const handler: RequestHandler = async (req, res, next) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } });
      return;
    }
    try {
      // Legacy MesaOps/organization administrators do not inherit finance
      // authority. MesaERP always requires an explicit service role grant.
      if (!(await resolvePermission(req, permission, req.params.legalEntityId))) {
        res.status(403).json({ error: { code: 'forbidden', message: 'Your company-scoped MesaERP role is not permitted to perform this action.' } });
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

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export function createMesaErpRouter(
  repository: MesaErpRepository = DEFAULT_REPOSITORY,
  resolvePermission: MesaErpPermissionResolver = defaultPermissionResolver,
  resolveCompanyAccess: MesaErpCompanyAccessResolver = defaultCompanyAccessResolver,
): express.Router {
  const router = express.Router();
  router.use(requireMesaErpEntitlement());

  // Company discovery is permission-family agnostic: a vendor-only or access
  // administrator assignment must be able to select its entitled company.
  router.get('/entities',
    ah(async (req) => {
      const entities = await service.listLegalEntities(repository);
      const allowed = await Promise.all(entities.map((entity) => (
        resolveCompanyAccess(req, entity.id)
      )));
      return entities.filter((_entity, index) => allowed[index]);
    }));
  router.post('/entities', requireMesaErpPermission(MESAERP_PERMISSIONS.legalEntityManage, resolvePermission), validateBody(legalEntityCreateSchema),
    ah(async (req, res) => { res.status(201); return service.createLegalEntity(repository, req.body, idempotencyKey(req)); }));

  router.get('/entities/:legalEntityId/accounts', requireMesaErpPermission(MESAERP_PERMISSIONS.voucherRead, resolvePermission),
    ah((req) => service.listAccounts(repository, req.params.legalEntityId)));
  router.get('/entities/:legalEntityId/vouchers', requireMesaErpPermission(MESAERP_PERMISSIONS.voucherRead, resolvePermission),
    ah((req) => service.listVouchers(repository, req.params.legalEntityId)));

  router.post('/entities/:legalEntityId/vouchers', requireMesaErpPermission(MESAERP_PERMISSIONS.voucherCreate, resolvePermission), validateBody(voucherCreateSchema),
    ah(async (req, res) => { res.status(201); return service.createVoucher(repository, req.params.legalEntityId, req.body, idempotencyKey(req)); }));
  router.get('/entities/:legalEntityId/vouchers/:voucherId', requireMesaErpPermission(MESAERP_PERMISSIONS.voucherRead, resolvePermission),
    ah((req) => service.getVoucher(repository, req.params.legalEntityId, req.params.voucherId)));
  router.patch('/entities/:legalEntityId/vouchers/:voucherId', requireMesaErpPermission(MESAERP_PERMISSIONS.voucherEdit, resolvePermission), validateBody(voucherUpdateSchema),
    ah((req) => service.updateVoucher(repository, req.params.legalEntityId, req.params.voucherId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/vouchers/:voucherId/submit', requireMesaErpPermission(MESAERP_PERMISSIONS.voucherSubmit, resolvePermission), validateBody(voucherTransitionSchema),
    ah((req) => service.submitVoucher(repository, req.params.legalEntityId, req.params.voucherId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/vouchers/:voucherId/approve', requireMesaErpPermission(MESAERP_PERMISSIONS.voucherApprove, resolvePermission), validateBody(voucherTransitionSchema),
    ah((req) => service.approveVoucher(repository, req.params.legalEntityId, req.params.voucherId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/vouchers/:voucherId/post', requireMesaErpPermission(MESAERP_PERMISSIONS.voucherPost, resolvePermission), validateBody(voucherPostSchema),
    ah((req) => service.postVoucher(repository, req.params.legalEntityId, req.params.voucherId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/vouchers/:voucherId/reversals', requireMesaErpPermission(MESAERP_PERMISSIONS.voucherReverse, resolvePermission), validateBody(voucherReversalCreateSchema),
    ah(async (req, res) => { res.status(201); return service.createVoucherReversal(repository, req.params.legalEntityId, req.params.voucherId, req.body, idempotencyKey(req)); }));
  router.get('/entities/:legalEntityId/vouchers/:voucherId/journal-entry', requireMesaErpPermission(MESAERP_PERMISSIONS.voucherRead, resolvePermission),
    ah((req) => service.getJournalForVoucher(repository, req.params.legalEntityId, req.params.voucherId)));

  return router;
}

export const mesaErpRouter = createMesaErpRouter();
