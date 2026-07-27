import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { nextNumber } from '../../lib/ids';
import { ApiError } from '../../middleware/error';
import type { ComplaintCreate, CapaUpdate } from './schemas';

function ctx() {
  const c = tenantContext.getStore();
  if (!c) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return c;
}
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Dispatched batches a complaint can be raised against. */
export function listBatches() {
  return prisma.dispatchRecord.findMany({
    include: { salesOrder: { select: { soNumber: true, product: true, customerId: true, customer: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
}

/** Complaints, each with its customer and CAPA (Complaint.capaId is a plain id). */
export async function listComplaints() {
  const complaints = await prisma.complaint.findMany({ include: { customer: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
  const capas = await prisma.cAPARecord.findMany();
  const byId = new Map(capas.map((k) => [k.id, k]));
  return complaints.map((c) => ({ ...c, capa: c.capaId ? byId.get(c.capaId) ?? null : null }));
}

export function listCapas() {
  return prisma.cAPARecord.findMany({ orderBy: { createdAt: 'desc' } });
}

/** Log a complaint against a dispatched batch and auto-open a CAPA. */
export async function createComplaint(input: ComplaintCreate) {
  const c = ctx();
  const dispatch = await prisma.dispatchRecord.findFirst({
    where: { salesOrderId: input.salesOrderId },
    include: { salesOrder: { select: { customerId: true, product: true } } },
  });
  if (!dispatch) throw new ApiError(422, 'not_dispatched', 'A complaint can only be raised against a dispatched order.');

  const nums = await prisma.complaint.findMany({ select: { complaintNumber: true } });
  const complaintNumber = nextNumber(nums.map((x) => x.complaintNumber), `C-${new Date().getFullYear()}-`, 100);
  const slaDays = input.severity === 'high' ? 3 : input.severity === 'medium' ? 7 : 14;

  return tenantTx(async (tx) => {
    const complaint = await tx.complaint.create({
      data: {
        organizationId: c.organizationId, complaintNumber, customerId: dispatch.salesOrder.customerId,
        batchNumber: dispatch.invoiceNumber, product: dispatch.salesOrder.product, description: input.description,
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
  const capa = await prisma.cAPARecord.findUnique({ where: { id } });
  if (!capa) throw new ApiError(404, 'not_found', 'CAPA not found.');
  if (capa.status === 'closed') throw new ApiError(409, 'closed', 'This CAPA is closed.');
  return tenantTx(async (tx) => tx.cAPARecord.update({ where: { id }, data: { ...patch, status: 'in_progress', version: { increment: 1 } } }));
}

/** Close a CAPA — root cause / corrective / preventive are all mandatory
 *  (fixes the audit's "Close Ticket bypasses the required fields"). */
export async function closeCapa(id: string) {
  const capa = await prisma.cAPARecord.findUnique({ where: { id } });
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
  const complaint = await prisma.complaint.findUnique({ where: { id } });
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
