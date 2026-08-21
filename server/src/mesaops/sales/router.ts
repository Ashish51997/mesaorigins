import express, { type RequestHandler } from 'express';
import { requirePermission, requireAnyPermission } from '../../middleware/authz';
import { validateBody } from '../../middleware/validate';
import { customerCreateSchema, inquiryCreateSchema, quoteSchema, orderConfirmSchema } from './schemas';
import * as svc from './service';

// Wraps an async handler: sends its return value as JSON, forwards errors.
const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent && data !== undefined) res.json(data); })
      .catch(next);
  };

export const salesRouter = express.Router();

// Directory
salesRouter.get('/members', requirePermission('screen:users'), ah(() => svc.listMembers()));

// Customers
salesRouter.get('/customers', requirePermission('screen:sales_customers'), ah(() => svc.listCustomers()));
salesRouter.post('/customers', requirePermission('screen:sales_customers'), validateBody(customerCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createCustomer(req.body); }));

// Inquiries
salesRouter.get('/inquiries', requireAnyPermission('screen:enquiry_desk', 'screen:inquiries'), ah(() => svc.listInquiries()));
salesRouter.post('/inquiries', requireAnyPermission('screen:enquiry_desk', 'screen:inquiries'), validateBody(inquiryCreateSchema),
  ah(async (req, res) => { res.status(201); return svc.createInquiry(req.body); }));
salesRouter.post('/inquiries/:id/quote', requireAnyPermission('screen:enquiry_desk', 'screen:quotations'), validateBody(quoteSchema),
  ah((req) => svc.quoteInquiry(req.params.id, req.body)));

// Orders
salesRouter.get('/orders', requirePermission('screen:orders'), ah(() => svc.listOrders()));
salesRouter.post('/orders', requirePermission('action:order.approve'), validateBody(orderConfirmSchema),
  ah(async (req, res) => { res.status(201); return svc.confirmOrder(req.body); }));
salesRouter.post('/orders/:id/cancel', requirePermission('screen:orders'),
  ah((req) => svc.cancelOrder(req.params.id)));
