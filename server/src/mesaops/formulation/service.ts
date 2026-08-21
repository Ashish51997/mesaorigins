import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { ApiError } from '../../middleware/error';
import type { FormulationCreate, FormulationUpdate } from './schemas';

function org(): string {
  const ctx = tenantContext.getStore();
  if (!ctx) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return ctx.organizationId;
}

/** All formulation revisions for the tenant, newest-active grouping first. */
export function listFormulations() {
  return prisma.formulation.findMany({ orderBy: [{ code: 'asc' }, { rev: 'asc' }] });
}

/**
 * Add a formulation. If the code already exists, this creates the next revision
 * and supersedes the prior active one (only the latest revision stays active).
 */
export async function createFormulation(input: FormulationCreate) {
  const code = input.code.trim();
  const siblings = await prisma.formulation.findMany({ where: { code }, select: { rev: true } });
  const rev = siblings.reduce((max, s) => Math.max(max, s.rev), 0) + 1;

  return tenantTx(async (tx) => {
    // A new revision becomes the active one; older revisions of the same code retire.
    if (siblings.length > 0) {
      await tx.formulation.updateMany({ where: { code, active: true }, data: { active: false } });
    }
    const created = await tx.formulation.create({
      data: {
        organizationId: org(), code, rev, product: input.product,
        components: input.components, active: true, locked: false,
      },
    });
    await audit(tx, { action: 'formula.create', entity: 'Formulation', entityId: created.id, after: created });
    return created;
  });
}

/** Edit a revision's components / product / active flag (locked revisions are frozen). */
export async function updateFormulation(id: string, patch: FormulationUpdate) {
  const current = await prisma.formulation.findUnique({ where: { id } });
  if (!current) throw new ApiError(404, 'not_found', 'Formulation not found.');
  if (current.locked) throw new ApiError(409, 'locked', `This revision is locked${current.lockReason ? ` (${current.lockReason})` : ''} and cannot be edited.`);

  return tenantTx(async (tx) => {
    // Activating this revision retires the other active revision of the same code.
    if (patch.active === true) {
      await tx.formulation.updateMany({ where: { code: current.code, active: true, id: { not: id } }, data: { active: false } });
    }
    const updated = await tx.formulation.update({ where: { id }, data: { ...patch, version: { increment: 1 } } });
    await audit(tx, { action: 'formula.edit', entity: 'Formulation', entityId: id, before: current, after: updated });
    return updated;
  });
}
