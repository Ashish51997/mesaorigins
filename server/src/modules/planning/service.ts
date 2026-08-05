import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { ApiError } from '../../middleware/error';
import { seedDraftLogbook, syncDraftHeaderFromPlan } from '../logbook/service';
import type { PlanCreate, PlanUpdate } from './schemas';

function org(): string {
  const ctx = tenantContext.getStore();
  if (!ctx) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return ctx.organizationId;
}
const dateOf = (s: string) => (s || '').slice(0, 10);

const planInclude = {
  machine: { select: { code: true, line: true } },
  salesOrder: { select: { soNumber: true, product: true, deliveryDate: true, customer: { select: { name: true } } } },
  logbook: { select: { id: true, status: true } },
} as const;

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
    include: planInclude,
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

async function assertNoClash(machineId: string, shift: string, start: string, excludePlanId?: string) {
  const machine = await prisma.machine.findUnique({ where: { id: machineId } });
  if (!machine) throw new ApiError(422, 'bad_machine', 'That machine does not exist.');
  const clash = await prisma.productionPlan.findFirst({
    where: {
      machineId,
      shift,
      status: 'scheduled',
      scheduledStartDate: { startsWith: dateOf(start) },
      ...(excludePlanId ? { id: { not: excludePlanId } } : {}),
    },
  });
  if (clash) {
    throw new ApiError(409, 'double_booked', `${machine.code} · shift ${shift} on ${dateOf(start)} is already booked.`);
  }
  return machine;
}

function assertEditable(plan: { status: string; scheduledStartDate: string; logbook?: { status: string } | null }) {
  if (plan.status !== 'scheduled') {
    throw new ApiError(409, 'plan_locked', `Only a scheduled plan can be edited (status: ${plan.status}).`);
  }
  if (plan.logbook?.status === 'submitted') {
    throw new ApiError(409, 'plan_locked', 'This plan’s logbook is submitted — schedule can no longer change.');
  }
  const start = Date.parse(plan.scheduledStartDate);
  if (Number.isFinite(start) && Date.now() >= start) {
    throw new ApiError(409, 'already_started', 'Schedule start time has passed — this plan can no longer be edited.');
  }
}

/** Schedule an order onto a machine/shift/date and seed a draft logbook with the shift header. */
export async function createPlan(input: PlanCreate) {
  const order = await prisma.salesOrder.findUnique({ where: { id: input.salesOrderId } });
  if (!order) throw new ApiError(404, 'not_found', 'Order not found.');
  if (order.status !== 'pending') {
    throw new ApiError(409, 'not_plannable', `Order ${order.soNumber} is not awaiting planning (status: ${order.status}).`);
  }
  await assertNoClash(input.machineId, input.shift, input.scheduledStartDate);

  const productName = (input.productName || order.product || '').trim();
  if (!productName) throw new ApiError(422, 'bad_product', 'Product name is required.');

  const orgId = org();
  return tenantTx(async (tx) => {
    const plan = await tx.productionPlan.create({
      data: {
        organizationId: orgId,
        salesOrderId: input.salesOrderId,
        machineId: input.machineId,
        shift: input.shift,
        operatorName: input.operatorName,
        scheduledStartDate: input.scheduledStartDate,
        scheduledEndDate: input.scheduledEndDate,
        logbookTemplateId: input.logbookTemplateId || null,
        supervisor: input.supervisor,
        drawingNo: input.drawingNo,
        formulaNo: input.formulaNo,
        moldNo: input.moldNo,
        productName,
        status: 'scheduled',
      },
      include: { machine: { select: { code: true } }, salesOrder: { select: { soNumber: true } } },
    });
    await seedDraftLogbook(tx as never, plan.id, orgId);
    await tx.salesOrder.update({ where: { id: order.id }, data: { status: 'planned', version: { increment: 1 } } });
    await audit(tx, { action: 'order.plan', entity: 'ProductionPlan', entityId: plan.id, after: plan });
    return tx.productionPlan.findUniqueOrThrow({ where: { id: plan.id }, include: planInclude });
  });
}

/** Edit a scheduled plan until its start time (and while the logbook is still a draft). */
export async function updatePlan(id: string, patch: PlanUpdate) {
  const plan = await prisma.productionPlan.findUnique({
    where: { id },
    include: { logbook: { select: { id: true, status: true } }, machine: { select: { code: true } } },
  });
  if (!plan) throw new ApiError(404, 'not_found', 'Plan not found.');
  assertEditable(plan);

  const nextMachineId = patch.machineId ?? plan.machineId;
  const nextShift = patch.shift ?? plan.shift;
  const nextStart = patch.scheduledStartDate ?? plan.scheduledStartDate;
  if (patch.machineId || patch.shift || patch.scheduledStartDate) {
    await assertNoClash(nextMachineId, nextShift, nextStart, id);
  }

  const templateChanged = patch.logbookTemplateId !== undefined
    && patch.logbookTemplateId !== plan.logbookTemplateId;

  const orgId = org();
  return tenantTx(async (tx) => {
    const updated = await tx.productionPlan.update({
      where: { id },
      data: {
        ...(patch.machineId !== undefined ? { machineId: patch.machineId } : {}),
        ...(patch.shift !== undefined ? { shift: patch.shift } : {}),
        ...(patch.operatorName !== undefined ? { operatorName: patch.operatorName } : {}),
        ...(patch.scheduledStartDate !== undefined ? { scheduledStartDate: patch.scheduledStartDate } : {}),
        ...(patch.scheduledEndDate !== undefined ? { scheduledEndDate: patch.scheduledEndDate } : {}),
        ...(patch.logbookTemplateId !== undefined ? { logbookTemplateId: patch.logbookTemplateId } : {}),
        ...(patch.supervisor !== undefined ? { supervisor: patch.supervisor } : {}),
        ...(patch.drawingNo !== undefined ? { drawingNo: patch.drawingNo } : {}),
        ...(patch.formulaNo !== undefined ? { formulaNo: patch.formulaNo } : {}),
        ...(patch.moldNo !== undefined ? { moldNo: patch.moldNo } : {}),
        ...(patch.productName !== undefined ? { productName: patch.productName } : {}),
        version: { increment: 1 },
      },
    });
    await syncDraftHeaderFromPlan(tx as never, id, orgId, { templateChanged });
    await audit(tx, { action: 'plan.update', entity: 'ProductionPlan', entityId: id, before: plan, after: updated });
    return tx.productionPlan.findUniqueOrThrow({ where: { id }, include: planInclude });
  });
}

/** Release a plan — remove draft logbook (if any) and return the order to the planning queue. */
export async function releasePlan(id: string) {
  const plan = await prisma.productionPlan.findUnique({
    where: { id },
    include: { logbook: { select: { id: true, status: true } } },
  });
  if (!plan) throw new ApiError(404, 'not_found', 'Plan not found.');
  if (plan.logbook?.status === 'submitted') {
    throw new ApiError(409, 'plan_locked', 'Cannot release a plan whose logbook is already submitted.');
  }
  return tenantTx(async (tx) => {
    if (plan.logbook) {
      await tx.machineLogbook.delete({ where: { id: plan.logbook.id } });
    }
    await tx.productionPlan.delete({ where: { id } });
    await tx.salesOrder.update({ where: { id: plan.salesOrderId }, data: { status: 'pending', version: { increment: 1 } } });
    await audit(tx, { action: 'plan.release', entity: 'ProductionPlan', entityId: id, before: plan });
    return { ok: true };
  });
}
