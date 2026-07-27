import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { ApiError } from '../../middleware/error';
import type { PlanCreate } from './schemas';

function org(): string {
  const ctx = tenantContext.getStore();
  if (!ctx) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return ctx.organizationId;
}
const dateOf = (s: string) => (s || '').slice(0, 10);

/** Confirmed orders awaiting planning. */
export function listOrdersToPlan() {
  return prisma.salesOrder.findMany({
    where: { status: 'pending' },
    include: { customer: { select: { name: true } } },
    orderBy: { deliveryDate: 'asc' },
  });
}

/** Production plans with their machine + order + customer. */
export function listPlans() {
  return prisma.productionPlan.findMany({
    include: {
      machine: { select: { code: true, line: true } },
      salesOrder: { select: { soNumber: true, product: true, deliveryDate: true, customer: { select: { name: true } } } },
    },
    orderBy: { scheduledStartDate: 'asc' },
  });
}

/** Operators available for assignment (Membership is global — filter by org). */
export function listOperators() {
  return prisma.membership.findMany({
    where: { organizationId: org(), role: 'Operator', status: 'active' },
    include: { user: { select: { name: true } } },
    orderBy: { employeeCode: 'asc' },
  });
}

/** Schedule an order onto a machine/shift/date. */
export async function createPlan(input: PlanCreate) {
  const order = await prisma.salesOrder.findUnique({ where: { id: input.salesOrderId } });
  if (!order) throw new ApiError(404, 'not_found', 'Order not found.');
  if (order.status !== 'pending') {
    throw new ApiError(409, 'not_plannable', `Order ${order.soNumber} is not awaiting planning (status: ${order.status}).`);
  }
  const machine = await prisma.machine.findUnique({ where: { id: input.machineId } });
  if (!machine) throw new ApiError(422, 'bad_machine', 'That machine does not exist.');

  // Prevent double-booking the same machine + shift + day.
  const clash = await prisma.productionPlan.findFirst({
    where: { machineId: input.machineId, shift: input.shift, status: 'scheduled', scheduledStartDate: { startsWith: dateOf(input.scheduledStartDate) } },
  });
  if (clash) {
    throw new ApiError(409, 'double_booked', `${machine.code} · shift ${input.shift} on ${dateOf(input.scheduledStartDate)} is already booked.`);
  }

  return tenantTx(async (tx) => {
    const plan = await tx.productionPlan.create({
      data: { ...input, status: 'scheduled', organizationId: org() },
      include: { machine: { select: { code: true } }, salesOrder: { select: { soNumber: true } } },
    });
    await tx.salesOrder.update({ where: { id: order.id }, data: { status: 'planned', version: { increment: 1 } } });
    await audit(tx, { action: 'order.plan', entity: 'ProductionPlan', entityId: plan.id, after: plan });
    return plan;
  });
}

/** Release a plan — remove it and return the order to the planning queue. */
export async function releasePlan(id: string) {
  const plan = await prisma.productionPlan.findUnique({ where: { id } });
  if (!plan) throw new ApiError(404, 'not_found', 'Plan not found.');
  return tenantTx(async (tx) => {
    await tx.productionPlan.delete({ where: { id } });
    await tx.salesOrder.update({ where: { id: plan.salesOrderId }, data: { status: 'pending', version: { increment: 1 } } });
    await audit(tx, { action: 'plan.release', entity: 'ProductionPlan', entityId: id, before: plan });
    return { ok: true };
  });
}
