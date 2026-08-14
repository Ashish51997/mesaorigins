import express, { type RequestHandler } from 'express';
import { ApiError } from '../middleware/error';
import { REQUIRED_PERMISSION } from '../middleware/authz';
import { validateBody } from '../middleware/validate';
import {
  agreementActivateSchema, asnCreateSchema, disputeCreateSchema, disputeResolveSchema,
  paymentProposalApproveSchema, paymentProposalCreateSchema, poAcknowledgementCreateSchema,
  portalChangeCreateSchema, portalInviteAcceptSchema, portalInviteCreateSchema, rfqCreateSchema,
  rfqIssueSchema, rfqSelectSchema, supplierDisputeResponseSchema, supplierInvoiceEvidenceCreateSchema,
  supplierQuotationCreateSchema, vendorChangeDecisionSchema, vendorDocumentCreateSchema,
  vendorDocumentReviewSchema,
} from './supplierPortalSchemas';
import {
  authenticateSupplier, clearSupplierCookie, requireSupplierPermission, supplierCookie,
} from './supplierPortalAuth';
import {
  PrismaSupplierManagementService, PrismaSupplierPortalService,
} from './supplierPortalService';

const INTERNAL_PERMISSIONS = {
  read: 'mesaerp.vendor.read', sourcing: 'mesaerp.sourcing.manage', vendor: 'mesaerp.vendor.manage',
  bankChecker: 'mesaerp.vendor.bank.verify', procurement: 'mesaerp.procurement.manage',
  paymentMake: 'mesaerp.voucher.create', paymentCheck: 'mesaerp.voucher.approve',
} as const;

function idempotencyKey(req: express.Request): string {
  const key = (req.header('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new ApiError(400, 'idempotency_key_required', 'A valid Idempotency-Key header is required.');
  return key;
}

const ah = (handler: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { handler(req, res).then((data) => { if (!res.headersSent && data !== undefined) res.json(data); }).catch(next); };

function noStore(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    next();
  };
}

const supplierBuckets = new Map<string, { count: number; resetAt: number }>();
const supplierRateLimit: RequestHandler = (req, res, next) => {
  const now = Date.now(); const key = `${req.ip || req.socket.remoteAddress || 'unknown'}:${req.method}`;
  const current = supplierBuckets.get(key); const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + 15 * 60 * 1000 } : current;
  entry.count += 1; supplierBuckets.set(key, entry);
  if (supplierBuckets.size > 5000) supplierBuckets.delete(supplierBuckets.keys().next().value as string);
  if (entry.count > (req.method === 'POST' ? 120 : 600)) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
    res.status(429).json({ error: { code: 'rate_limited', message: 'Too many supplier portal requests.' } }); return;
  }
  next();
};

export function createSupplierPortalRouter(
  service = new PrismaSupplierPortalService(),
  supplierAuth: RequestHandler = authenticateSupplier,
): express.Router {
  const router = express.Router();
  router.use('/supplier-portal/v1', noStore(), supplierRateLimit);
  router.post('/supplier-portal/v1/auth/accept', validateBody(portalInviteAcceptSchema), ah(async (req, res) => {
    const result = await service.acceptInvite(req.body.token);
    res.setHeader('Set-Cookie', supplierCookie(result.sessionToken, new Date(result.expiresAt)));
    res.status(201);
    const { sessionToken: _secret, ...safe } = result;
    return safe;
  }));
  router.use('/supplier-portal/v1', supplierAuth);
  router.post('/supplier-portal/v1/auth/logout', ah(async (req, res) => {
    await service.logout(req.supplier!, req.supplierSessionHash!);
    res.setHeader('Set-Cookie', clearSupplierCookie());
    return { ok: true };
  }));
  router.get('/supplier-portal/v1/me', ah(async (req) => {
    const workspace = await service.workspace(req.supplier!);
    return { user: workspace.user, vendor: workspace.vendor, controls: workspace.controls };
  }));
  router.get('/supplier-portal/v1/workspace', ah((req) => service.workspace(req.supplier!)));
  router.post('/supplier-portal/v1/profile-change-cases', requireSupplierPermission('supplier.profile.request_change'), validateBody(portalChangeCreateSchema), ah(async (req, res) => { res.status(201); return service.requestChange(req.supplier!, req.body, idempotencyKey(req)); }));
  router.post('/supplier-portal/v1/documents', requireSupplierPermission('supplier.documents.write'), validateBody(vendorDocumentCreateSchema), ah(async (req, res) => { res.status(201); return service.addDocument(req.supplier!, req.body, idempotencyKey(req)); }));
  router.post('/supplier-portal/v1/rfqs/:rfqId/quotations', requireSupplierPermission('supplier.rfq.respond'), validateBody(supplierQuotationCreateSchema), ah(async (req, res) => { res.status(201); return service.submitQuotation(req.supplier!, req.params.rfqId, req.body, idempotencyKey(req)); }));
  router.post('/supplier-portal/v1/purchase-orders/:purchaseOrderId/acknowledgements', requireSupplierPermission('supplier.po.respond'), validateBody(poAcknowledgementCreateSchema), ah(async (req, res) => { res.status(201); return service.acknowledgePo(req.supplier!, req.params.purchaseOrderId, req.body, idempotencyKey(req)); }));
  router.post('/supplier-portal/v1/asns', requireSupplierPermission('supplier.asn.write'), validateBody(asnCreateSchema), ah(async (req, res) => { res.status(201); return service.createAsn(req.supplier!, req.body, idempotencyKey(req)); }));
  router.post('/supplier-portal/v1/supplier-invoices/:supplierInvoiceId/evidence', requireSupplierPermission('supplier.invoice.evidence.write'), validateBody(supplierInvoiceEvidenceCreateSchema), ah(async (req, res) => { res.status(201); return service.addInvoiceEvidence(req.supplier!, req.params.supplierInvoiceId, req.body, idempotencyKey(req)); }));
  router.post('/supplier-portal/v1/disputes/:disputeId/responses', requireSupplierPermission('supplier.dispute.respond'), validateBody(supplierDisputeResponseSchema), ah((req) => service.respondToDispute(req.supplier!, req.params.disputeId, req.body, idempotencyKey(req))));
  return router;
}

function requireInternal(service: PrismaSupplierManagementService, permission: string): RequestHandler {
  const handler: RequestHandler = async (req, res, next) => {
    try {
      if (!req.user) { res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } }); return; }
      const legalEntityId = req.params.legalEntityId;
      if (!legalEntityId) { res.status(400).json({ error: { code: 'legal_entity_required', message: 'Legal entity is required.' } }); return; }
      const allowed = await service.hasPermission({ organizationId: req.user.organizationId, membershipId: req.user.membershipId, legalEntityId, permission });
      if (!allowed) { res.status(403).json({ error: { code: 'forbidden', message: `Missing explicit MesaERP permission: ${permission}.` } }); return; }
      next();
    } catch (error) { next(error); }
  };
  return Object.assign(handler, { [REQUIRED_PERMISSION]: permission });
}

export function createSupplierManagementRouter(service = new PrismaSupplierManagementService()): express.Router {
  const router = express.Router();
  const base = '/entities/:legalEntityId';
  router.get(`${base}/supplier-workspace`, requireInternal(service, INTERNAL_PERMISSIONS.read), ah((req) => service.workspace(req.params.legalEntityId)));
  router.post(`${base}/rfqs`, requireInternal(service, INTERNAL_PERMISSIONS.sourcing), validateBody(rfqCreateSchema), ah(async (req, res) => { res.status(201); return service.createRfq(req.params.legalEntityId, req.body, idempotencyKey(req)); }));
  router.post(`${base}/rfqs/:rfqId/issue`, requireInternal(service, INTERNAL_PERMISSIONS.sourcing), validateBody(rfqIssueSchema), ah((req) => service.issueRfq(req.params.legalEntityId, req.params.rfqId, req.body, idempotencyKey(req))));
  router.post(`${base}/rfqs/:rfqId/select`, requireInternal(service, INTERNAL_PERMISSIONS.sourcing), validateBody(rfqSelectSchema), ah((req) => service.selectQuotation(req.params.legalEntityId, req.params.rfqId, req.body, idempotencyKey(req))));
  router.post(`${base}/rate-agreements/:agreementId/activate`, requireInternal(service, INTERNAL_PERMISSIONS.sourcing), validateBody(agreementActivateSchema), ah((req) => service.activateAgreement(req.params.legalEntityId, req.params.agreementId, req.body, idempotencyKey(req))));
  router.post(`${base}/vendors/:vendorId/portal-invitations`, requireInternal(service, INTERNAL_PERMISSIONS.vendor), validateBody(portalInviteCreateSchema), ah(async (req, res) => { res.status(201); return service.invitePortalUser(req.params.legalEntityId, req.params.vendorId, req.body, idempotencyKey(req)); }));
  router.post(`${base}/vendors/:vendorId/documents`, requireInternal(service, INTERNAL_PERMISSIONS.vendor), validateBody(vendorDocumentCreateSchema), ah(async (req, res) => { res.status(201); return service.addVendorDocument(req.params.legalEntityId, req.params.vendorId, req.body, idempotencyKey(req)); }));
  router.post(`${base}/vendors/:vendorId/documents/:documentId/review`, requireInternal(service, INTERNAL_PERMISSIONS.vendor), validateBody(vendorDocumentReviewSchema), ah((req) => service.reviewVendorDocument(req.params.legalEntityId, req.params.vendorId, req.params.documentId, req.body, idempotencyKey(req))));
  router.post(`${base}/vendor-change-cases/:caseId/decide`, requireInternal(service, INTERNAL_PERMISSIONS.bankChecker), validateBody(vendorChangeDecisionSchema), ah((req) => service.decideVendorChange(req.params.legalEntityId, req.params.caseId, req.body, idempotencyKey(req))));
  router.post(`${base}/disputes`, requireInternal(service, INTERNAL_PERMISSIONS.procurement), validateBody(disputeCreateSchema), ah(async (req, res) => { res.status(201); return service.createDispute(req.params.legalEntityId, req.body, idempotencyKey(req)); }));
  router.post(`${base}/disputes/:disputeId/resolve`, requireInternal(service, INTERNAL_PERMISSIONS.procurement), validateBody(disputeResolveSchema), ah((req) => service.resolveDispute(req.params.legalEntityId, req.params.disputeId, req.body, idempotencyKey(req))));
  router.post(`${base}/payment-proposals`, requireInternal(service, INTERNAL_PERMISSIONS.paymentMake), validateBody(paymentProposalCreateSchema), ah(async (req, res) => { res.status(201); return service.createPaymentProposal(req.params.legalEntityId, req.body, idempotencyKey(req)); }));
  router.post(`${base}/payment-proposals/:proposalId/approve`, requireInternal(service, INTERNAL_PERMISSIONS.paymentCheck), validateBody(paymentProposalApproveSchema), ah((req) => service.approvePaymentProposal(req.params.legalEntityId, req.params.proposalId, req.body, idempotencyKey(req))));
  return router;
}

export const supplierPortalRouter = createSupplierPortalRouter();
export const supplierManagementRouter = createSupplierManagementRouter();
