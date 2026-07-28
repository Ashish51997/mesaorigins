import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { ApiError } from '../../middleware/error';
import type { LogbookUpdate, TemplateInput } from './schemas';
import { summarizeLogbookIssues, validateLogbookForSubmit } from './validate';

function tctx() {
  const c = tenantContext.getStore();
  if (!c) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return c;
}
function org(): string {
  return tctx().organizationId;
}
const today = () => new Date().toISOString().slice(0, 10);

// The formulation a logbook recorded in its Formula No. The picker offers
// "<code> · Rev <n>" (see listActiveFormulas), so parse that; fall back to the
// active revision of a bare code. Returns null if it can't be matched.
async function resolveFormula(formulaNo: string) {
  const sVal = (formulaNo || '').trim();
  if (!sVal) return null;
  const m = sVal.match(/^(.+?)\s*·\s*Rev\s*(\d+)$/i);
  if (m) {
    const byRev = await prisma.formulation.findFirst({ where: { code: m[1].trim(), rev: Number(m[2]) } });
    if (byRev) return byRev;
  }
  return prisma.formulation.findFirst({ where: { code: sVal, active: true } });
}

/** Logbook templates for the tenant. */
export function listTemplates() {
  return prisma.logbookTemplate.findMany({ orderBy: { docNo: 'asc' } });
}

/** Active formulations to pick from when filling a logbook's Formula No. Read
 *  under the logbook's own gate so any role that can fill a sheet can list them. */
export function listActiveFormulas() {
  return prisma.formulation.findMany({
    where: { active: true },
    select: { id: true, code: true, rev: true, product: true },
    orderBy: [{ code: 'asc' }, { rev: 'desc' }],
  });
}

/** Scheduled/running plans grouped by machine — powers the Machine-Tasks page. */
export async function listTasks() {
  const plans = await prisma.productionPlan.findMany({
    where: { status: { in: ['scheduled', 'running'] } },
    include: {
      machine: { select: { code: true, line: true } },
      salesOrder: { select: { soNumber: true, product: true } },
      logbook: { select: { id: true, status: true } },
      logbookTemplate: { select: { id: true, productName: true, layout: true, docNo: true } },
    },
    orderBy: [{ machineId: 'asc' }, { scheduledStartDate: 'asc' }],
  });
  const byMachine = new Map<string, { machine: string; line: string; tasks: typeof plans }>();
  for (const p of plans) {
    const k = p.machine.code;
    if (!byMachine.has(k)) byMachine.set(k, { machine: k, line: p.machine.line, tasks: [] });
    byMachine.get(k)!.tasks.push(p);
  }
  return [...byMachine.values()];
}

/* ---------------------------------------------------------------- template builder */

// Fill the required Json columns with layout-appropriate defaults when the builder omits them.
function templateData(orgId: string, input: TemplateInput) {
  const isPipe = input.layout === 'pipe';
  return {
    organizationId: orgId,
    docNo: input.docNo ?? '', revNo: input.revNo ?? '', revDate: input.revDate ?? '',
    brandName: input.brandName ?? 'MASS POLYMERS', location: input.location ?? '', title: input.title ?? 'MACHINE LOG BOOK',
    productName: input.productName, layout: input.layout ?? 'coil',
    hardnessType: input.hardnessType ?? (isPipe ? 'D' : 'A'), productionUnit: input.productionUnit ?? (isPipe ? 'nos' : 'roll'),
    packingNote: input.packingNote ?? '', shifts: input.shifts ?? ['D', 'N'], supervisors: input.supervisors ?? [],
    lotNumberNote: input.lotNumberNote ?? '', dieZones: input.dieZones ?? [], barrelZones: input.barrelZones ?? [],
    zoneSpecs: input.zoneSpecs ?? {},
    coil: input.coil ?? { perM: 0, targetKg: 0, bobbinGms: 0, rangeLo: 0, rangeHi: 0, count: isPipe ? 0 : 44 },
    inspectionTimeSlots: input.inspectionTimeSlots ?? ['9–10', '12–1', '3–4', '6–7', '8–9'],
    dimensionSpecs: input.dimensionSpecs ?? { top: { label: '', nominal: 0, tol: 0, lo: 0, hi: 0 }, bottom: { label: '', nominal: 0, tol: 0, lo: 0, hi: 0 }, thickness: { label: '', count: isPipe ? 0 : 3, lo: 0, hi: 0 } },
    finishSpec: input.finishSpec ?? '', perMeterSpec: input.perMeterSpec ?? '',
    traceability: input.traceability ?? { tableCount: isPipe ? 1 : 2, rowsPerTable: 14 },
    rejectionReasons: input.rejectionReasons ?? [], notes: input.notes ?? [], pipeSpecs: input.pipeSpecs ?? {},
  };
}

export async function createTemplate(input: TemplateInput) {
  const c = tctx();
  return tenantTx(async (tx) => {
    const t = await tx.logbookTemplate.create({ data: templateData(c.organizationId, input) as never });
    await audit(tx, { action: 'template.create', entity: 'LogbookTemplate', entityId: t.id, after: { productName: t.productName, layout: t.layout } });
    return t;
  });
}

export async function updateTemplate(id: string, patch: Partial<TemplateInput>) {
  const c = tctx();
  const cur = await prisma.logbookTemplate.findFirst({ where: { id, organizationId: c.organizationId } });
  if (!cur) throw new ApiError(404, 'not_found', 'Template not found.');
  return tenantTx(async (tx) => {
    const t = await tx.logbookTemplate.update({ where: { id }, data: { ...patch, version: { increment: 1 } } as never });
    await audit(tx, { action: 'template.update', entity: 'LogbookTemplate', entityId: id, after: { fields: Object.keys(patch) } });
    return t;
  });
}

export async function deleteTemplate(id: string) {
  const c = tctx();
  const cur = await prisma.logbookTemplate.findFirst({
    where: { id, organizationId: c.organizationId },
    include: { _count: { select: { logbooks: true, productionPlans: true } } },
  });
  if (!cur) throw new ApiError(404, 'not_found', 'Template not found.');
  if (cur._count.logbooks > 0 || cur._count.productionPlans > 0) {
    throw new ApiError(409, 'in_use', `In use by ${cur._count.logbooks} logbook(s) / ${cur._count.productionPlans} plan(s).`);
  }
  return tenantTx(async (tx) => {
    await tx.logbookTemplate.delete({ where: { id } });
    await audit(tx, { action: 'template.delete', entity: 'LogbookTemplate', entityId: id, before: { productName: cur.productName } });
    return { ok: true };
  });
}

/** Scheduled plans that can carry a shift logbook, each with its machine, order,
 *  and existing logbook (if any). This is the operator's gate. */
export function listPlansToLog() {
  return prisma.productionPlan.findMany({
    where: { status: { in: ['scheduled', 'running'] } },
    include: {
      machine: { select: { code: true, logbookFormat: true } },
      salesOrder: { select: { soNumber: true, product: true } },
      logbook: { select: { id: true, status: true } },
    },
    orderBy: { scheduledStartDate: 'asc' },
  });
}

/** The logbook for a plan, or null. */
export function getLogbookForPlan(planId: string) {
  return prisma.machineLogbook.findUnique({ where: { productionPlanId: planId } });
}

// Resolve the template whose document number matches the machine's logbook format
// (fixes the "always templates[0]" bug); fall back to the first template.
async function resolveTemplate(logbookFormat: string) {
  const byFormat = logbookFormat ? await prisma.logbookTemplate.findFirst({ where: { docNo: logbookFormat } }) : null;
  return byFormat ?? (await prisma.logbookTemplate.findFirst({ orderBy: { docNo: 'asc' } }));
}

// Build a blank logbook from a plan + template, sized/shaped per the template's
// layout family ('coil' → dim/thickness rows + coil weights; 'pipe' → OD/weight rows).
function buildBlank(plan: { id: string; machine: { code: string }; salesOrder: { product: string } | null }, template: {
  id: string; layout?: string; coil: unknown; dimensionSpecs: unknown; traceability: unknown; inspectionTimeSlots: string[]; productName: string;
}) {
  const isPipe = (template.layout ?? 'coil') === 'pipe';
  const coil = template.coil as { count?: number } | null;
  const dims = template.dimensionSpecs as { thickness?: { count?: number } } | null;
  const trace = template.traceability as { tableCount?: number; rowsPerTable?: number } | null;
  const thicknessCount = dims?.thickness?.count ?? 3;
  const slots = template.inspectionTimeSlots ?? [];
  const traceLen = (trace?.tableCount ?? 1) * (trace?.rowsPerTable ?? 0);
  return {
    productionPlanId: plan.id,
    templateId: template.id,
    status: 'draft',
    machineId: plan.machine.code,
    productName: plan.salesOrder?.product ?? template.productName ?? '',
    coilWeights: isPipe ? [] : Array.from({ length: coil?.count ?? 0 }, () => ''),
    hourlyInspections: slots.map((slot) => isPipe
      ? { timeSlot: slot, od: '', weight: '', colour: '', okNotOk: '', inspectionBy: '' }
      : { timeSlot: slot, topDim: '', bottomDim: '', thickness: Array.from({ length: thicknessCount }, () => ''), finish: '', perMeter: '', colour: '', tearing: '', inspectionBy: '' }),
    traceabilityRows: Array.from({ length: traceLen }, () => isPipe
      ? { lotNumber: '', colour: '', code: '', pktKg: '', packedBy: '' }
      : { lotNumber: '', colour: '', code: '', winderPackedBy: '' }),
  };
}

/** Get-or-create the draft logbook for a scheduled plan. */
export async function openLogbook(productionPlanId: string) {
  const existing = await prisma.machineLogbook.findUnique({ where: { productionPlanId } });
  if (existing) return existing;

  const plan = await prisma.productionPlan.findUnique({
    where: { id: productionPlanId },
    include: { machine: { select: { code: true, logbookFormat: true } }, salesOrder: { select: { product: true } } },
  });
  if (!plan) throw new ApiError(404, 'not_found', 'Production plan not found.');
  if (!['scheduled', 'running'].includes(plan.status)) {
    throw new ApiError(409, 'not_schedulable', `Plan is not active (status: ${plan.status}).`);
  }
  // The plan's chosen template wins (set at planning); fall back to the machine's format.
  const template = plan.logbookTemplateId
    ? await prisma.logbookTemplate.findUnique({ where: { id: plan.logbookTemplateId } })
    : await resolveTemplate(plan.machine.logbookFormat);
  if (!template) throw new ApiError(422, 'no_template', 'No logbook template configured.');

  const blank = buildBlank(plan, template as never);
  return tenantTx(async (tx) => {
    const logbook = await tx.machineLogbook.create({ data: { ...blank, organizationId: org() } });
    await audit(tx, { action: 'logbook.open', entity: 'MachineLogbook', entityId: logbook.id, after: { productionPlanId } });
    return logbook;
  });
}

/** Save draft edits (only while unlocked). */
export async function updateLogbook(id: string, patch: LogbookUpdate) {
  const current = await prisma.machineLogbook.findUnique({ where: { id } });
  if (!current) throw new ApiError(404, 'not_found', 'Logbook not found.');
  if (current.status === 'submitted') throw new ApiError(409, 'locked', 'This logbook is submitted and locked.');
  return tenantTx(async (tx) => {
    return tx.machineLogbook.update({ where: { id }, data: { ...patch, version: { increment: 1 } } });
  });
}

/** Submit + lock a logbook, mark the plan running, and book the raw material the
 *  shift consumed — the recorded formulation's BOM expanded across the mass
 *  balance (fixes the "production never moves RM stock" gap). One RM `out` ledger
 *  row per formulation component; consumption is not blocked on stock levels (a
 *  negative balance correctly flags unreceipted RM). Booked exactly once, since a
 *  submitted logbook is locked against re-submit. */
export async function submitLogbook(id: string) {
  const lb = await prisma.machineLogbook.findUnique({ where: { id } });
  if (!lb) throw new ApiError(404, 'not_found', 'Logbook not found.');
  if (lb.status === 'submitted') throw new ApiError(409, 'already_submitted', 'This logbook is already submitted.');

  const template = await prisma.logbookTemplate.findUnique({ where: { id: lb.templateId } });
  const issues = validateLogbookForSubmit(
    {
      operatorSignature: lb.operatorSignature,
      supervisorSignature: lb.supervisorSignature,
      date: lb.date,
      shift: lb.shift,
      supervisor: lb.supervisor,
      productName: lb.productName,
      formulaNo: lb.formulaNo,
      drawingNo: lb.drawingNo,
      motorSpeed: lb.motorSpeed,
      ampere: lb.ampere,
      takeupSpeed: lb.takeupSpeed,
      vacuum: lb.vacuum,
      shoreHardness: lb.shoreHardness,
      productionPerHour: lb.productionPerHour,
      totalRollsProduced: lb.totalRollsProduced,
      totalRollKgs: lb.totalRollKgs,
      processWasteKg: lb.processWasteKg,
      lumpsWasteKg: lb.lumpsWasteKg,
      rejectionKg: lb.rejectionKg,
      totalConsumedKg: lb.totalConsumedKg,
      meter: lb.meter,
      meterCountSet: lb.meterCountSet,
      scrapKg: lb.scrapKg,
      dieZoneTemps: (lb.dieZoneTemps as Record<string, string>) ?? {},
      barrelZoneTemps: (lb.barrelZoneTemps as Record<string, string>) ?? {},
      coilWeights: Array.isArray(lb.coilWeights) ? (lb.coilWeights as string[]) : [],
      hourlyInspections: Array.isArray(lb.hourlyInspections) ? (lb.hourlyInspections as Array<Record<string, unknown>>) : [],
      rejectionCounts: (lb.rejectionCounts as Record<string, string>) ?? {},
      traceabilityRows: Array.isArray(lb.traceabilityRows) ? (lb.traceabilityRows as Array<{ pktKg?: string }>) : [],
    },
    (template as unknown as Parameters<typeof validateLogbookForSubmit>[1]) ?? {},
  );
  if (issues.length) {
    throw new ApiError(422, 'validation_failed', summarizeLogbookIssues(issues));
  }

  const c = tctx();
  // Total RM consumed this shift = the reported total, else derived from the roll
  // register + start-up scrap (the sheet's mass balance).
  const rolls = Array.isArray(lb.rolls) ? (lb.rolls as unknown as Array<{ weight?: number }>) : [];
  const reported = Number.parseFloat(lb.totalConsumedKg);
  const producedKg = Number.isFinite(reported) && reported > 0
    ? reported
    : rolls.reduce((sum, r) => sum + (Number(r?.weight) || 0), 0) + (Number.parseFloat(lb.scrapKg) || 0);

  // Split it across the recorded formulation's components (percent of mass).
  const formula = await resolveFormula(lb.formulaNo);
  const components = (formula?.components as unknown as Array<{ name?: string; pct?: number; lotId?: string }> | undefined) ?? [];
  const consumption = producedKg > 0
    ? components
        .filter((k) => k && (k.name ?? '').trim() && Number(k.pct) > 0)
        .map((k) => ({
          organizationId: c.organizationId, type: 'raw_material', direction: 'out',
          itemCode: k.name!.trim(), itemName: k.name!.trim(),
          quantity: Math.round(producedKg * (Number(k.pct) / 100) * 1000) / 1000,
          unit: 'kg', lotNumber: k.lotId?.trim() || null,
          reference: `Consumed · ${formula!.code} Rev ${formula!.rev} · plan ${lb.productionPlanId}`,
          date: today(), handler: lb.operatorSignature.trim() || c.email,
        }))
    : [];

  return tenantTx(async (tx) => {
    const submitted = await tx.machineLogbook.update({ where: { id }, data: { status: 'submitted', version: { increment: 1 } } });
    await tx.productionPlan.update({ where: { id: lb.productionPlanId }, data: { status: 'running', version: { increment: 1 } } });
    if (consumption.length) await tx.inventoryTransaction.createMany({ data: consumption });
    await audit(tx, {
      action: 'logbook.submit', entity: 'MachineLogbook', entityId: id,
      after: { status: 'submitted', formula: formula?.code ?? null, rmConsumedKg: producedKg, rmLines: consumption.length },
    });
    return submitted;
  });
}
