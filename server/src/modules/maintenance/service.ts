import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { ApiError } from '../../middleware/error';
import { assertMesaOpsPlantAccess, plantCodeFilter, resolveMesaOpsPlantScope } from '../../lib/mesaOpsScope';
import type { MachineCreate, MaintenanceCreate } from './schemas';

function org(): string {
  const ctx = tenantContext.getStore();
  if (!ctx) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return ctx.organizationId;
}

const withMachine = { machine: { select: { code: true, line: true, status: true, plantCode: true } } };

/** The org's machine registry (reference data for the maintenance form). */
export async function listMachines() {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  return prisma.machine.findMany({ where: plants ? { plantCode: plants } : undefined, orderBy: { code: 'asc' } });
}

/** Register a new extruder / line machine in the tenant. */
export async function createMachine(input: MachineCreate) {
  const scope = await resolveMesaOpsPlantScope();
  const plantCode = input.plantCode.toUpperCase();
  assertMesaOpsPlantAccess(scope, plantCode);
  const code = input.code.trim().toUpperCase();
  const existing = await prisma.machine.findFirst({ where: { organizationId: org(), code } });
  if (existing) throw new ApiError(409, 'conflict', `Machine ${code} is already registered.`);
  return tenantTx(async (tx) => {
    const machine = await tx.machine.create({
      data: {
        organizationId: org(),
        plantCode,
        code,
        line: input.line.trim(),
        family: input.family.trim() || 'PVC',
        logbookFormat: (input.logbookFormat ?? '').trim(),
        status: input.status,
      },
    });
    await audit(tx, { action: 'machine.create', entity: 'Machine', entityId: machine.id, after: { code: machine.code, line: machine.line } });
    return machine;
  });
}

/** Maintenance tasks for the org, each with its machine. */
export async function listMaintenance() {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  return prisma.maintenanceTask.findMany({
    where: plants ? { machine: { plantCode: plants } } : undefined,
    include: withMachine,
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
  });
}

/** Add a maintenance task against an existing machine in the tenant. */
export async function addMaintenance(input: MaintenanceCreate) {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  const machine = await prisma.machine.findFirst({
    where: { id: input.machineId, ...(plants ? { plantCode: plants } : {}) },
  });
  if (!machine) throw new ApiError(422, 'bad_machine', 'That machine does not exist.');
  return tenantTx(async (tx) => {
    const task = await tx.maintenanceTask.create({
      data: { ...input, status: 'scheduled', organizationId: org() },
      include: withMachine,
    });
    await audit(tx, { action: 'maintenance.create', entity: 'MaintenanceTask', entityId: task.id, after: task });
    return task;
  });
}

/** Mark a task complete. */
export async function completeMaintenance(id: string) {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  const task = await prisma.maintenanceTask.findFirst({
    where: { id, ...(plants ? { machine: { plantCode: plants } } : {}) },
    include: { machine: { select: { plantCode: true } } },
  });
  if (!task) throw new ApiError(404, 'not_found', 'Task not found.');
  return tenantTx(async (tx) => {
    const updated = await tx.maintenanceTask.update({
      where: { id },
      data: { status: 'completed', version: { increment: 1 } },
      include: withMachine,
    });
    await audit(tx, { action: 'maintenance.complete', entity: 'MaintenanceTask', entityId: id, before: task, after: updated });
    return updated;
  });
}
