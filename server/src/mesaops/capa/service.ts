import type { Prisma } from '@prisma/client';
import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { nextNumber } from '../../lib/ids';
import { ApiError } from '../../middleware/error';
import { plantCodeFilter, resolveMesaOpsPlantScope } from '../../lib/mesaOpsScope';
import type { ComplaintCreate, CapaUpdate } from './schemas';

function ctx() {
  const c = tenantContext.getStore();
  if (!c) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return c;
}
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function complaintPlantWhere(): Promise<Prisma.ComplaintWhereInput | undefined> {
  const plants = plantCodeFilter(await resolveMesaOpsPlantScope());
  if (!plants) return undefined;
  const dispatches = await prisma.dispatchRecord.findMany({
    where: { operationalOrder: { plantCode: plants } },
    select: { invoiceNumber: true },
  });
  return { batchNumber: { in: dispatches.map((dispatch) => dispatch.invoiceNumber) } };
}

async function capaPlantWhere(): Promise<Prisma.CAPARecordWhereInput | undefined> {
  const complaintWhere = await complaintPlantWhere();
  if (!complaintWhere) return undefined;
  const complaints = await prisma.complaint.findMany({ where: complaintWhere, select: { id: true } });
  return { complaintId: { in: complaints.map((complaint) => complaint.id) } };
}

/** Dispatched batches a complaint can be raised against. */
export async function listBatches() {
  const plants = plantCodeFilter(await resolveMesaOpsPlantScope());
  const rows = await prisma.dispatchRecord.findMany({
    where: plants ? { operationalOrder: { plantCode: plants } } : undefined,
    include: {
      operationalOrder: { select: { orderNumber: true, productName: true, customerId: true, customerName: true } },
      salesOrder: { select: { soNumber: true, product: true, customerId: true, customer: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => ({
    ...row,
    salesOrder: {
      soNumber: row.operationalOrder.orderNumber,
      product: row.operationalOrder.productName,
      customerId: row.operationalOrder.customerId ?? row.salesOrder?.customerId ?? '',
      customer: { name: row.operationalOrder.customerName || row.salesOrder?.customer.name || 'Internal demand' },
    },
  }));
}

/** Complaints, each with its customer and CAPA (Complaint.capaId is a plain id). */
export async function listComplaints() {
  const where = await complaintPlantWhere();
  const complaints = await prisma.complaint.findMany({ where, include: { customer: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
  const capas = await prisma.cAPARecord.findMany({ where: { complaintId: { in: complaints.map((complaint) => complaint.id) } } });
  const byId = new Map(capas.map((k) => [k.id, k]));
  return complaints.map((c) => ({ ...c, capa: c.capaId ? byId.get(c.capaId) ?? null : null }));
}

export async function listCapas() {
  return prisma.cAPARecord.findMany({ where: await capaPlantWhere(), orderBy: { createdAt: 'desc' } });
}

/** Log a complaint against a dispatched batch and auto-open a CAPA. */
export async function createComplaint(input: ComplaintCreate) {
  const c = ctx();
  const plants = plantCodeFilter(await resolveMesaOpsPlantScope());
  const dispatch = await prisma.dispatchRecord.findFirst({
    where: {
      OR: [{ operationalOrderId: input.salesOrderId }, { salesOrderId: input.salesOrderId }],
      ...(plants ? { operationalOrder: { plantCode: plants } } : {}),
    },
    include: {
      operationalOrder: { select: { customerId: true, productName: true } },
      salesOrder: { select: { customerId: true, product: true } },
    },
  });
  if (!dispatch) throw new ApiError(422, 'not_dispatched', 'A complaint can only be raised against a dispatched order.');
  const customerId = dispatch.operationalOrder.customerId ?? dispatch.salesOrder?.customerId;
  if (!customerId) throw new ApiError(422, 'customer_required', 'A customer complaint cannot be raised for internal demand.');

  const nums = await prisma.complaint.findMany({ select: { complaintNumber: true } });
  const complaintNumber = nextNumber(nums.map((x) => x.complaintNumber), `C-${new Date().getFullYear()}-`, 100);
  const slaDays = input.severity === 'high' ? 3 : input.severity === 'medium' ? 7 : 14;

  return tenantTx(async (tx) => {
    const complaint = await tx.complaint.create({
      data: {
        organizationId: c.organizationId, complaintNumber, customerId,
        batchNumber: dispatch.invoiceNumber, product: dispatch.operationalOrder.productName, description: input.description,
        photoUrl: input.photoUrl, severity: input.severity, status: 'investigating', date: today(),
      },
    });
    const capa = await tx.cAPARecord.create({
      data: {
        organizationId: c.organizationId, complaintId: complaint.id, rootCause: '', correctiveAction: '',
        preventiveAction: '', responsiblePerson: '', dueDate: addDays(slaDays), status: 'open',
      },
    });
    const linked = await tx.complaint.update({ where: { id: complaint.id }, data: { capaId: capa.id } });
    await audit(tx, { action: 'complaint.log', entity: 'Complaint', entityId: complaint.id, after: linked });
    return { ...linked, capa };
  });
}

export async function updateCapa(id: string, patch: CapaUpdate) {
  const plantWhere = await capaPlantWhere();
  const capa = await prisma.cAPARecord.findFirst({ where: { id, ...(plantWhere ?? {}) } });
  if (!capa) throw new ApiError(404, 'not_found', 'CAPA not found.');
  if (capa.status === 'closed') throw new ApiError(409, 'closed', 'This CAPA is closed.');
  return tenantTx(async (tx) => tx.cAPARecord.update({ where: { id }, data: { ...patch, status: 'in_progress', version: { increment: 1 } } }));
}

/** Close a CAPA — root cause / corrective / preventive are all mandatory
 *  (fixes the audit's "Close Ticket bypasses the required fields"). */
export async function closeCapa(id: string) {
  const plantWhere = await capaPlantWhere();
  const capa = await prisma.cAPARecord.findFirst({ where: { id, ...(plantWhere ?? {}) } });
  if (!capa) throw new ApiError(404, 'not_found', 'CAPA not found.');
  if (capa.status === 'closed') throw new ApiError(409, 'already_closed', 'This CAPA is already closed.');
  if (!capa.rootCause.trim() || !capa.correctiveAction.trim() || !capa.preventiveAction.trim()) {
    throw new ApiError(422, 'incomplete', 'Root cause, corrective action and preventive action are all required before a CAPA can be closed.');
  }
  return tenantTx(async (tx) => {
    const closed = await tx.cAPARecord.update({ where: { id }, data: { status: 'closed', closedDate: today(), version: { increment: 1 } } });
    await audit(tx, { action: 'capa.close', entity: 'CAPARecord', entityId: id, after: closed });
    return closed;
  });
}

/** Resolve a complaint — only after its CAPA is closed. */
export async function resolveComplaint(id: string) {
  const plantWhere = await complaintPlantWhere();
  const complaint = await prisma.complaint.findFirst({ where: { id, ...(plantWhere ?? {}) } });
  if (!complaint) throw new ApiError(404, 'not_found', 'Complaint not found.');
  if (complaint.status === 'resolved') throw new ApiError(409, 'already_resolved', 'Complaint already resolved.');
  if (complaint.capaId) {
    const capa = await prisma.cAPARecord.findUnique({ where: { id: complaint.capaId } });
    if (capa && capa.status !== 'closed') throw new ApiError(409, 'capa_open', 'Close the CAPA before resolving the complaint.');
  }
  return tenantTx(async (tx) => {
    const resolved = await tx.complaint.update({ where: { id }, data: { status: 'resolved', version: { increment: 1 } } });
    await audit(tx, { action: 'complaint.resolve', entity: 'Complaint', entityId: id, after: resolved });
    return resolved;
  });
}
