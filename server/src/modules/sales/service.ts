import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { nextNumber } from '../../lib/ids';
import { ApiError } from '../../middleware/error';
import { hashCanonical } from '../../mesaerp/repository';
import { plantCodeFilter, resolveMesaOpsPlantScope } from '../../lib/mesaOpsScope';
import type { CustomerCreate, InquiryCreate, Quote, OrderConfirm } from './schemas';

function org(): string {
  const ctx = tenantContext.getStore();
  if (!ctx) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return ctx.organizationId;
}
const year = (): number => new Date().getFullYear();

/* ------------------------------------------------------------------ customers */

export function listCustomers() {
  return prisma.customer.findMany({ orderBy: { name: 'asc' } });
}

export async function createCustomer(input: CustomerCreate) {
  // GST must be unique within the tenant (audit finding). RLS already scopes this.
  if (input.gstNumber) {
    const dupe = await prisma.customer.findFirst({ where: { gstNumber: input.gstNumber } });
    if (dupe) throw new ApiError(409, 'gst_taken', `A customer with GST ${input.gstNumber} already exists.`);
  }
  return tenantTx(async (tx) => {
    const customer = await tx.customer.create({ data: { ...input, organizationId: org() } });
    await audit(tx, { action: 'customer.create', entity: 'Customer', entityId: customer.id, after: customer });
    return customer;
  });
}

/* ------------------------------------------------------------------ inquiries */

export function listInquiries() {
  return prisma.inquiry.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createInquiry(input: InquiryCreate) {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new ApiError(422, 'bad_customer', 'That customer does not exist.');

  const existing = await prisma.inquiry.findMany({ select: { inquiryNumber: true } });
  const inquiryNumber = nextNumber(existing.map((i) => i.inquiryNumber), `INQ-${year()}-`, 100);

  return tenantTx(async (tx) => {
    const inquiry = await tx.inquiry.create({
      data: { ...input, inquiryNumber, status: 'submitted', organizationId: org() },
    });
    await audit(tx, { action: 'inquiry.create', entity: 'Inquiry', entityId: inquiry.id, after: inquiry });
    return inquiry;
  });
}

export async function quoteInquiry(id: string, input: Quote) {
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry) throw new ApiError(404, 'not_found', 'Inquiry not found.');
  if (inquiry.status === 'ordered') throw new ApiError(409, 'already_ordered', 'This inquiry is already an order.');

  return tenantTx(async (tx) => {
    const updated = await tx.inquiry.update({
      where: { id },
      data: {
        status: 'quotation',
        quotationPrice: input.quotationPrice,
        negotiationNote: input.negotiationNote,
        discountPercent: input.discountPercent,
        version: { increment: 1 },
      },
    });
    await audit(tx, { action: 'inquiry.quote', entity: 'Inquiry', entityId: id, before: inquiry, after: updated });
    return updated;
  });
}

/* ------------------------------------------------------------------ orders */

export async function listOrders() {
  const plants = plantCodeFilter(await resolveMesaOpsPlantScope());
  return prisma.salesOrder.findMany({
    where: plants ? { operationalOrder: { is: { plantCode: plants } } } : undefined,
    orderBy: { createdAt: 'desc' },
  });
}

export async function confirmOrder(input: OrderConfirm) {
  const inquiry = await prisma.inquiry.findUnique({ where: { id: input.inquiryId } });
  if (!inquiry) throw new ApiError(404, 'not_found', 'Inquiry not found.');
  const customer = await prisma.customer.findUnique({ where: { id: inquiry.customerId } });
  if (!customer) throw new ApiError(422, 'bad_customer', 'The inquiry customer no longer exists.');
  if (!['quotation', 'approved'].includes(inquiry.status)) {
    throw new ApiError(409, 'not_quotable', `Inquiry must be quoted before it can become an order (status: ${inquiry.status}).`);
  }
  // Duplicate-order guard (audit finding): one order per inquiry. Also enforced
  // by the unique constraint on SalesOrder.inquiryId.
  const existingOrder = await prisma.salesOrder.findUnique({ where: { inquiryId: inquiry.id } });
  if (existingOrder) throw new ApiError(409, 'already_ordered', `Inquiry already has order ${existingOrder.soNumber}.`);

  return tenantTx(async (tx) => {
    const nums = await tx.salesOrder.findMany({ select: { soNumber: true } });
    const soNumber = nextNumber(nums.map((o) => o.soNumber), `SO-${year()}-`, 150);
    const order = await tx.salesOrder.create({
      data: {
        organizationId: org(),
        soNumber,
        inquiryId: inquiry.id,
        customerId: inquiry.customerId,
        product: inquiry.product,
        quantity: inquiry.quantity,
        deliveryDate: input.deliveryDate || inquiry.expectedDeliveryDate,
        priority: input.priority,
        specialInstructions: input.specialInstructions,
        status: 'pending',
      },
    });
    const dueDate = /^\d{4}-\d{2}-\d{2}/.test(order.deliveryDate)
      ? new Date(`${order.deliveryDate.slice(0, 10)}T00:00:00.000Z`)
      : null;
    const operationalSnapshot = {
      orderNumber: order.soNumber,
      customerId: order.customerId,
      customerName: customer.name,
      productName: order.product,
      quantity: String(order.quantity),
      dueDate: order.deliveryDate,
      priority: order.priority,
    };
    await tx.operationalOrder.create({
      data: {
        id: order.id,
        organizationId: org(),
        orderNumber: order.soNumber,
        sourceType: 'local_customer',
        sourceReference: order.soNumber,
        legacySalesOrderId: order.id,
        customerId: order.customerId,
        customerName: customer.name,
        productName: order.product,
        quantity: String(order.quantity),
        uom: 'units',
        dueDate,
        priority: order.priority,
        requirements: { specialInstructions: order.specialInstructions },
        originMetadata: { createdFrom: 'MesaOps SalesOrder' },
        sourceSnapshotHash: hashCanonical(operationalSnapshot),
        status: 'ready_to_plan',
      },
    });
    await tx.inquiry.update({ where: { id: inquiry.id }, data: { status: 'ordered', version: { increment: 1 } } });
    await audit(tx, { action: 'order.confirm', entity: 'SalesOrder', entityId: order.id, after: order });
    return order;
  });
}

export async function cancelOrder(id: string) {
  const plants = plantCodeFilter(await resolveMesaOpsPlantScope());
  return tenantTx(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "SalesOrder" WHERE "id" = ${id} FOR UPDATE`;
    const order = await tx.salesOrder.findFirst({
      where: { id, ...(plants ? { operationalOrder: { is: { plantCode: plants } } } : {}) },
    });
    if (!order) throw new ApiError(404, 'not_found', 'Order not found.');
    if (order.status !== 'pending') {
      throw new ApiError(409, 'not_cancellable', `Only a pending order can be cancelled (status: ${order.status}).`);
    }
    await tx.operationalOrder.deleteMany({ where: { legacySalesOrderId: order.id } });
    await tx.salesOrder.delete({ where: { id } });
    // Return the inquiry to the quotation queue so it can be re-ordered.
    await tx.inquiry.update({ where: { id: order.inquiryId }, data: { status: 'quotation', version: { increment: 1 } } });
    await audit(tx, { action: 'order.cancel', entity: 'SalesOrder', entityId: id, before: order });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ members (directory) */

export function listMembers() {
  // Membership is a global model (part of the identity plane, no RLS), so it
  // must be filtered by org explicitly — the tenant guard does not scope it.
  return prisma.membership.findMany({
    where: { organizationId: org() },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { employeeCode: 'asc' },
  });
}
