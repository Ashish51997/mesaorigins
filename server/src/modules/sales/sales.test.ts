import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';

// Integration tests against a live Postgres (seeded demo tenant). No auth header
// → dev-stub resolves the demo Administrator, who can do everything.
const app = buildApp();
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('sales slice — validation & authz', () => {
  it('rejects a customer with no name (422)', async () => {
    const r = await request(app).post('/api/customers').send({ gstNumber: 'X' });
    expect(r.status).toBe(422);
  });

  it('enforces GST uniqueness within the tenant (409)', async () => {
    const gst = `GST-${uniq()}`;
    const a = await request(app).post('/api/customers').send({ name: 'Dup A', gstNumber: gst });
    expect(a.status).toBe(201);
    const b = await request(app).post('/api/customers').send({ name: 'Dup B', gstNumber: gst });
    expect(b.status).toBe(409);
  });

  it('denies an Operator from confirming an order (403)', async () => {
    const r = await request(app).post('/api/orders').set('x-dev-user', 'EMP-007').send({ inquiryId: 'x' });
    expect(r.status).toBe(403);
  });

  it('scopes the customer list to the tenant', async () => {
    const r = await request(app).get('/api/customers');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
  });
});

describe('sales slice — lifecycle', () => {
  it('customer → inquiry → quote → order → cancel, with the guards', async () => {
    const cust = await request(app).post('/api/customers').send({ name: `Nova ${uniq()}`, gstNumber: `G-${uniq()}` });
    expect(cust.status).toBe(201);
    const customerId = cust.body.id as string;

    const inq = await request(app).post('/api/inquiries').send({
      customerId, product: 'RPVC pipe 20mm', quantity: 500, expectedDeliveryDate: '2026-09-01',
    });
    expect(inq.status).toBe(201);
    expect(inq.body.inquiryNumber).toMatch(/^INQ-\d{4}-\d+$/);
    expect(inq.body.status).toBe('submitted');
    const inquiryId = inq.body.id as string;

    // Cannot order before a quotation exists.
    const early = await request(app).post('/api/orders').send({ inquiryId });
    expect(early.status).toBe(409);

    const quote = await request(app).post(`/api/inquiries/${inquiryId}/quote`).send({ quotationPrice: 42 });
    expect(quote.status).toBe(200);
    expect(quote.body.status).toBe('quotation');
    expect(quote.body.quotationPrice).toBe(42);

    const order = await request(app).post('/api/orders').send({ inquiryId, priority: 'high' });
    expect(order.status).toBe(201);
    expect(order.body.soNumber).toMatch(/^SO-\d{4}-\d+$/);
    expect(order.body.status).toBe('pending');
    const orderId = order.body.id as string;

    // Duplicate-order guard (the audit bug, now impossible).
    const dupe = await request(app).post('/api/orders').send({ inquiryId });
    expect(dupe.status).toBe(409);

    // Cancel returns the inquiry to the quotation queue.
    const cancel = await request(app).post(`/api/orders/${orderId}/cancel`);
    expect(cancel.status).toBe(200);
    const inquiries = await request(app).get('/api/inquiries');
    const back = (inquiries.body as Array<{ id: string; status: string }>).find((i) => i.id === inquiryId);
    expect(back?.status).toBe('quotation');
  });

  it('rejects an inquiry with zero quantity (422)', async () => {
    const cust = await request(app).post('/api/customers').send({ name: `Zero ${uniq()}` });
    const r = await request(app).post('/api/inquiries').send({
      customerId: cust.body.id, product: 'X', quantity: 0, expectedDeliveryDate: '2026-09-01',
    });
    expect(r.status).toBe(422);
  });
});
