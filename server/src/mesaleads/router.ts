import express, { type RequestHandler } from 'express';
import { validateBody } from '../middleware/validate';
import { ApiError } from '../middleware/error';
import { requireAnyPermission, requirePermission } from '../middleware/authz';
import {
  activityCreateSchema,
  formCreateSchema,
  formLinkCreateSchema,
  formUpdateSchema,
  leadCreateSchema,
  leadUpdateSchema,
  publicSubmissionSchema,
  customerDecisionChallengeSchema,
  customerQuoteDecisionSchema,
  fulfillmentCreateSchema,
  fulfillmentUpdateSchema,
  milestoneCreateSchema,
  milestoneUpdateSchema,
  quoteCreateSchema,
  quoteTransitionSchema,
  quoteUpdateSchema,
} from './schemas';
import * as svc from './service';

const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const publicMesaLeadsRouter = express.Router();

const PUBLIC_WINDOW_MS = 15 * 60 * 1_000;
const PUBLIC_BUCKET_LIMIT = 5_000;
// Bounded single-instance protection. Multi-replica production should enforce
// the same policy at the gateway or a shared rate-limit store.
const publicHits = new Map<string, { count: number; resetAt: number }>();
const rateLimitPublicForms: RequestHandler = (req, res, next) => {
  const now = Date.now();
  // The untrusted token is deliberately not part of the bucket key. A caller
  // cannot create unbounded entries by rotating random path segments.
  const key = `${req.ip || req.socket.remoteAddress || 'unknown'}:${req.method}`;
  const current = publicHits.get(key);
  if (!current && publicHits.size >= PUBLIC_BUCKET_LIMIT) {
    const oldest = publicHits.keys().next().value as string | undefined;
    if (oldest) publicHits.delete(oldest);
  }
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + PUBLIC_WINDOW_MS } : current;
  entry.count += 1;
  publicHits.set(key, entry);
  const limit = req.method === 'POST' ? 20 : 120;
  if (entry.count > limit) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1_000))));
    res.status(429).json({ error: { code: 'rate_limited', message: 'Too many questionnaire requests. Please try again later.' } });
    return;
  }
  next();
};

const publicSecurityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};

publicMesaLeadsRouter.get('/public/mesaleads/forms/:token', publicSecurityHeaders, rateLimitPublicForms, ah((req) => svc.getPublicForm(req.params.token)));
publicMesaLeadsRouter.post(
  '/public/mesaleads/forms/:token',
  publicSecurityHeaders,
  rateLimitPublicForms,
  validateBody(publicSubmissionSchema),
  ah(async (req, res) => {
    const result = await svc.submitPublicForm(req.params.token, req.body);
    res.status(201);
    return result;
  }),
);
publicMesaLeadsRouter.get('/public/mesaleads/portal/:token', publicSecurityHeaders, rateLimitPublicForms, ah((req) => svc.getPublicPortal(req.params.token)));
publicMesaLeadsRouter.post(
  '/public/mesaleads/portal/:token/decision-challenges',
  publicSecurityHeaders,
  rateLimitPublicForms,
  validateBody(customerDecisionChallengeSchema),
  ah(async (req, res) => {
    const result = await svc.createDecisionChallenge(req.params.token, req.body);
    res.status(202);
    return result;
  }),
);
publicMesaLeadsRouter.post(
  '/public/mesaleads/portal/:token/quotes/:quoteId/decision',
  publicSecurityHeaders,
  rateLimitPublicForms,
  validateBody(customerQuoteDecisionSchema),
  ah((req) => svc.decidePublicQuote(req.params.token, req.params.quoteId, req.body)),
);

const requireMesaLeads: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.user?.organizationId) throw new ApiError(401, 'unauthenticated', 'Sign-in required.');
    await svc.assertMesaLeadsEntitlement(req.user.organizationId);
    next();
  } catch (error) {
    next(error);
  }
};

export const mesaLeadsRouter = express.Router();
mesaLeadsRouter.use('/mesaleads', requireMesaLeads);
const requireLeadAccess = requireAnyPermission('screen:enquiry_desk', 'screen:inquiries');
const requireFormAdmin = requirePermission('screen:users');

mesaLeadsRouter.get('/mesaleads/summary', requireLeadAccess, ah(() => svc.getSummary()));

mesaLeadsRouter.get('/mesaleads/attachments/:id', requireLeadAccess, async (req, res, next) => {
  try {
    const attachment = await svc.getAttachmentDownload(req.params.id);
    const safeName = attachment.originalName
      .replace(/[\r\n/\\]/g, '_')
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/[";]/g, '_')
      .slice(0, 180) || 'attachment';
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(attachment.sizeBytes));
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(attachment.bytes);
  } catch (error) {
    next(error);
  }
});

mesaLeadsRouter.get('/mesaleads/leads', requireLeadAccess, ah(() => svc.listLeads()));
mesaLeadsRouter.get('/mesaleads/leads/:id', requireLeadAccess, ah((req) => svc.getLead(req.params.id)));
mesaLeadsRouter.post('/mesaleads/leads', requireLeadAccess, validateBody(leadCreateSchema), ah(async (req, res) => {
  res.status(201);
  return svc.createLead(req.body);
}));
mesaLeadsRouter.put('/mesaleads/leads/:id', requireLeadAccess, validateBody(leadUpdateSchema), ah((req) => svc.updateLead(req.params.id, req.body)));
mesaLeadsRouter.post('/mesaleads/leads/:id/activities', requireLeadAccess, validateBody(activityCreateSchema), ah(async (req, res) => {
  res.status(201);
  return svc.addActivity(req.params.id, req.body);
}));
mesaLeadsRouter.post('/mesaleads/leads/:id/quotes', requireLeadAccess, validateBody(quoteCreateSchema), ah(async (req, res) => {
  res.status(201);
  return svc.createQuote(req.params.id, req.body);
}));
mesaLeadsRouter.patch('/mesaleads/leads/:id/quotes/:quoteId', requireLeadAccess, validateBody(quoteUpdateSchema), ah((req) => svc.updateQuote(req.params.id, req.params.quoteId, req.body)));
mesaLeadsRouter.post('/mesaleads/leads/:id/quotes/:quoteId/send', requireLeadAccess, validateBody(quoteTransitionSchema), ah((req) => svc.sendQuote(req.params.id, req.params.quoteId, req.body)));
mesaLeadsRouter.post('/mesaleads/leads/:id/quotes/:quoteId/revise', requireLeadAccess, validateBody(quoteTransitionSchema), ah(async (req, res) => {
  res.status(201);
  return svc.reviseQuote(req.params.id, req.params.quoteId, req.body);
}));
mesaLeadsRouter.post('/mesaleads/leads/:id/fulfillment', requireLeadAccess, validateBody(fulfillmentCreateSchema), ah(async (req, res) => {
  res.status(201);
  return svc.createFulfillment(req.params.id, req.body);
}));
mesaLeadsRouter.patch('/mesaleads/leads/:id/fulfillment', requireLeadAccess, validateBody(fulfillmentUpdateSchema), ah((req) => svc.updateFulfillment(req.params.id, req.body)));
mesaLeadsRouter.post('/mesaleads/leads/:id/fulfillment/milestones', requireLeadAccess, validateBody(milestoneCreateSchema), ah(async (req, res) => {
  res.status(201);
  return svc.createMilestone(req.params.id, req.body);
}));
mesaLeadsRouter.patch('/mesaleads/leads/:id/fulfillment/milestones/:milestoneId', requireLeadAccess, validateBody(milestoneUpdateSchema), ah((req) => svc.updateMilestone(req.params.id, req.params.milestoneId, req.body)));

mesaLeadsRouter.get('/mesaleads/forms', requireLeadAccess, ah(() => svc.listForms()));
mesaLeadsRouter.get('/mesaleads/forms/:id', requireLeadAccess, ah((req) => svc.getForm(req.params.id)));
mesaLeadsRouter.post('/mesaleads/forms', requireFormAdmin, validateBody(formCreateSchema), ah(async (req, res) => {
  res.status(201);
  return svc.createForm(req.body);
}));
mesaLeadsRouter.put('/mesaleads/forms/:id', requireFormAdmin, validateBody(formUpdateSchema), ah((req) => svc.updateForm(req.params.id, req.body)));
mesaLeadsRouter.post('/mesaleads/forms/:id/clone', requireFormAdmin, ah(async (req, res) => {
  res.status(201);
  return svc.cloneFormRevision(req.params.id);
}));
mesaLeadsRouter.post('/mesaleads/forms/:id/publish', requireFormAdmin, ah((req) => svc.publishForm(req.params.id)));
mesaLeadsRouter.post('/mesaleads/forms/:id/archive', requireFormAdmin, ah((req) => svc.archiveForm(req.params.id)));
mesaLeadsRouter.post('/mesaleads/forms/:id/links', requireLeadAccess, validateBody(formLinkCreateSchema), ah(async (req, res) => {
  res.status(201);
  return svc.createFormLink(req.params.id, req.body);
}));
mesaLeadsRouter.post('/mesaleads/form-links/:id/revoke', requireLeadAccess, ah((req) => svc.revokeFormLink(req.params.id)));
