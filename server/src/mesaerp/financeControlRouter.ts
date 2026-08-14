import express, { type RequestHandler } from 'express';
import { REQUIRED_PERMISSION } from '../middleware/authz';
import { ApiError } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import {
  assetCapitalizeSchema, assetCreateSchema, assetDepreciationSchema, assetDisposalSchema, assetImpairmentSchema, assetTransferSchema,
  bankLineActionSchema, bankReconciliationCompleteSchema, bankStatementImportSchema, budgetCreateSchema, budgetTransitionSchema,
  consolidationEliminationCreateSchema, consolidationReportSchema, financeAccountCreateSchema, financeAccountUpdateSchema, financeReportQuerySchema,
  intercompanyCreateSchema, periodTransitionSchema,
} from './financeControlSchemas';
import { PrismaMesaErpFinanceControlService } from './financeControlService';

type Service = PrismaMesaErpFinanceControlService;
const ah = (handler: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { handler(req, res).then((value) => { if (!res.headersSent && value !== undefined) res.json(value); }).catch(next); };

function requireEntitlement(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) { res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } }); return; }
    if (!req.user.services.some((service) => service.id === 'mesaerp' && service.status === 'active')) {
      res.status(403).json({ error: { code: 'service_not_entitled', message: 'MesaERP is not active for this organization.' } }); return;
    }
    next();
  };
}

function requirePermission(service: Service, permission: string): RequestHandler {
  const handler: RequestHandler = async (req, res, next) => {
    try {
      const user = req.user; const legalEntityId = req.params.legalEntityId || '';
      if (!user) { res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign-in required.' } }); return; }
      const allowed = Boolean(legalEntityId) && await service.hasPermission({ organizationId: user.organizationId, membershipId: user.membershipId, legalEntityId, permission });
      if (!allowed) { res.status(403).json({ error: { code: 'forbidden', message: `Missing explicit MesaERP permission: ${permission}.` } }); return; }
      next();
    } catch (error) { next(error); }
  };
  return Object.assign(handler, { [REQUIRED_PERMISSION]: permission });
}

function idempotencyKey(req: express.Request) {
  const key = (req.header('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new ApiError(400, 'idempotency_key_required', 'A valid Idempotency-Key header is required.');
  return key;
}

function reportQuery(req: express.Request) {
  const values = Object.fromEntries(Object.entries(req.query).filter(([, value]) => typeof value === 'string'));
  const parsed = financeReportQuerySchema.safeParse(values);
  if (!parsed.success) throw new ApiError(422, 'validation_error', parsed.error.issues.map((issue) => issue.message).join('; '));
  return parsed.data;
}

export function createMesaErpFinanceControlRouter(service = new PrismaMesaErpFinanceControlService()) {
  const router = express.Router(); router.use(requireEntitlement());
  const accountManage = requirePermission(service, 'mesaerp.account.manage');
  const periodManage = requirePermission(service, 'mesaerp.period.manage');
  const periodReopen = requirePermission(service, 'mesaerp.period.reopen');
  const banking = requirePermission(service, 'mesaerp.banking.manage');
  const asset = requirePermission(service, 'mesaerp.asset.manage');
  const budget = requirePermission(service, 'mesaerp.budget.manage');
  const reports = requirePermission(service, 'mesaerp.reports.read');
  const intercompany = requirePermission(service, 'mesaerp.intercompany.manage');
  const consolidation = requirePermission(service, 'mesaerp.consolidation.manage');

  router.get('/entities/:legalEntityId/accounts/tree', accountManage, ah((req) => service.accountTree(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/accounts', accountManage, validateBody(financeAccountCreateSchema), ah(async (req, res) => { res.status(201); return service.createAccount(req.params.legalEntityId, req.body, idempotencyKey(req)); }));
  router.patch('/entities/:legalEntityId/accounts/:accountId', accountManage, validateBody(financeAccountUpdateSchema), ah((req) => service.updateAccount(req.params.legalEntityId, req.params.accountId, req.body, idempotencyKey(req))));

  router.get('/entities/:legalEntityId/accounting-periods', reports, ah((req) => service.listPeriods(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/accounting-periods/:periodId/soft-close', periodManage, validateBody(periodTransitionSchema), ah((req) => service.transitionPeriod(req.params.legalEntityId, req.params.periodId, 'soft_closed', req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/accounting-periods/:periodId/lock', periodManage, validateBody(periodTransitionSchema), ah((req) => service.transitionPeriod(req.params.legalEntityId, req.params.periodId, 'locked', req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/accounting-periods/:periodId/reopen', periodReopen, validateBody(periodTransitionSchema), ah((req) => service.transitionPeriod(req.params.legalEntityId, req.params.periodId, 'open', req.body, idempotencyKey(req))));

  router.get('/entities/:legalEntityId/bank-reconciliations', banking, ah((req) => service.listBankReconciliations(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/bank-reconciliations', banking, validateBody(bankStatementImportSchema), ah(async (req, res) => { res.status(201); return service.importBankStatement(req.params.legalEntityId, req.body, idempotencyKey(req)); }));
  router.get('/entities/:legalEntityId/bank-reconciliations/:reconciliationId', banking, ah((req) => service.getBankReconciliation(req.params.legalEntityId, req.params.reconciliationId)));
  router.post('/entities/:legalEntityId/bank-reconciliations/:reconciliationId/lines/:lineId/action', banking, validateBody(bankLineActionSchema), ah((req) => service.updateBankLine(req.params.legalEntityId, req.params.reconciliationId, req.params.lineId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/bank-reconciliations/:reconciliationId/complete', banking, validateBody(bankReconciliationCompleteSchema), ah((req) => service.completeBankReconciliation(req.params.legalEntityId, req.params.reconciliationId, req.body, idempotencyKey(req))));

  router.get('/entities/:legalEntityId/assets', asset, ah((req) => service.listAssets(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/assets', asset, validateBody(assetCreateSchema), ah(async (req, res) => { res.status(201); return service.createAsset(req.params.legalEntityId, req.body, idempotencyKey(req)); }));
  router.get('/entities/:legalEntityId/assets/:assetId', asset, ah((req) => service.getAsset(req.params.legalEntityId, req.params.assetId)));
  router.post('/entities/:legalEntityId/assets/:assetId/capitalize', asset, validateBody(assetCapitalizeSchema), ah((req) => service.capitalizeAsset(req.params.legalEntityId, req.params.assetId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/assets/:assetId/transfer', asset, validateBody(assetTransferSchema), ah((req) => service.transferAsset(req.params.legalEntityId, req.params.assetId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/assets/:assetId/depreciation-proposals', asset, validateBody(assetDepreciationSchema), ah((req) => service.proposeDepreciation(req.params.legalEntityId, req.params.assetId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/assets/:assetId/impairment-proposals', asset, validateBody(assetImpairmentSchema), ah((req) => service.proposeImpairment(req.params.legalEntityId, req.params.assetId, req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/assets/:assetId/disposal-proposals', asset, validateBody(assetDisposalSchema), ah((req) => service.proposeDisposal(req.params.legalEntityId, req.params.assetId, req.body, idempotencyKey(req))));

  router.get('/entities/:legalEntityId/budgets', budget, ah((req) => service.listBudgets(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/budgets', budget, validateBody(budgetCreateSchema), ah(async (req, res) => { res.status(201); return service.createBudget(req.params.legalEntityId, req.body, idempotencyKey(req)); }));
  router.get('/entities/:legalEntityId/budgets/:budgetId', budget, ah((req) => service.getBudget(req.params.legalEntityId, req.params.budgetId)));
  router.post('/entities/:legalEntityId/budgets/:budgetId/submit', budget, validateBody(budgetTransitionSchema), ah((req) => service.transitionBudget(req.params.legalEntityId, req.params.budgetId, 'submitted', req.body, idempotencyKey(req))));
  router.post('/entities/:legalEntityId/budgets/:budgetId/approve', budget, validateBody(budgetTransitionSchema), ah((req) => service.transitionBudget(req.params.legalEntityId, req.params.budgetId, 'approved', req.body, idempotencyKey(req))));
  router.get('/entities/:legalEntityId/budgets/:budgetId/variance', reports, ah((req) => service.budgetVariance(req.params.legalEntityId, req.params.budgetId)));

  router.get('/entities/:legalEntityId/intercompany-pairs', intercompany, ah((req) => service.listIntercompanyPairs(req.params.legalEntityId)));
  router.post('/entities/:legalEntityId/intercompany-pairs', intercompany, validateBody(intercompanyCreateSchema), ah(async (req, res) => { res.status(201); return service.createIntercompanyPair(req.params.legalEntityId, req.body, idempotencyKey(req)); }));
  router.post('/entities/:legalEntityId/consolidation/report', consolidation, validateBody(consolidationReportSchema), ah((req) => {
    if (!req.body.legalEntityIds.includes(req.params.legalEntityId)) throw new ApiError(422, 'anchor_entity_required', 'The route legal entity must be included in legalEntityIds.');
    return service.consolidationReport(req.body);
  }));
  router.post('/entities/:legalEntityId/consolidation/elimination-vouchers', consolidation, validateBody(consolidationEliminationCreateSchema), ah(async (req, res) => {
    res.status(201); return service.createConsolidationElimination(req.params.legalEntityId, req.body, idempotencyKey(req));
  }));

  const reportKinds = ['day-book', 'general-ledger', 'trial-balance', 'profit-and-loss', 'balance-sheet', 'cash-bank-book', 'cash-flow', 'bill-ageing', 'dimensions'] as const;
  for (const kind of reportKinds) router.get(`/entities/:legalEntityId/reports/${kind}`, reports, ah((req) => service.report(req.params.legalEntityId, kind, reportQuery(req))));
  router.get('/entities/:legalEntityId/reports/budget-variance', reports, ah((req) => {
    const query = reportQuery(req); if (!query.budgetId) throw new ApiError(422, 'budget_filter_required', 'budgetId is required.');
    return service.budgetVariance(req.params.legalEntityId, query.budgetId);
  }));
  return router;
}

export const mesaErpFinanceControlRouter = createMesaErpFinanceControlRouter();
