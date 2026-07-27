import { z } from 'zod';

export const logbookCreateSchema = z.object({
  productionPlanId: z.string().min(1, 'A scheduled plan is required'),
});
export type LogbookCreate = z.infer<typeof logbookCreateSchema>;

// Logbook template builder — the complex Json sub-shapes pass through as-is.
export const templateCreateSchema = z.object({
  productName: z.string().trim().min(1, 'Product name is required'),
  layout: z.enum(['pipe', 'coil']).default('coil'),
  docNo: z.string().trim().optional(), revNo: z.string().trim().optional(), revDate: z.string().trim().optional(),
  brandName: z.string().trim().optional(), location: z.string().trim().optional(), title: z.string().trim().optional(),
  hardnessType: z.enum(['A', 'D']).optional(), productionUnit: z.enum(['nos', 'roll']).optional(), packingNote: z.string().trim().optional(),
  shifts: z.array(z.string()).optional(), supervisors: z.array(z.string()).optional(), lotNumberNote: z.string().trim().optional(),
  dieZones: z.array(z.string()).optional(), barrelZones: z.array(z.string()).optional(),
  zoneSpecs: z.record(z.object({ target: z.number(), min: z.number(), max: z.number() })).optional(),
  coil: z.any().optional(), inspectionTimeSlots: z.array(z.string()).optional(), dimensionSpecs: z.any().optional(),
  finishSpec: z.string().trim().optional(), perMeterSpec: z.string().trim().optional(), traceability: z.any().optional(),
  rejectionReasons: z.array(z.string()).optional(), notes: z.array(z.string()).optional(), pipeSpecs: z.any().optional(),
});
export type TemplateInput = z.infer<typeof templateCreateSchema>;
export const templateUpdateSchema = templateCreateSchema.partial();

const s = z.string();
// Editable logbook fields. `.partial()` → all optional (a draft is saved
// incrementally); unknown keys are stripped by Zod, so status/id/org can't be set.
export const logbookUpdateSchema = z
  .object({
    machineId: s, date: s, shift: s, supervisor: s, drawingNo: s, tag: s, formulaNo: s,
    motorSpeed: s, ampere: s, takeupSpeed: s, vacuum: s, extruderStartTime: s, productSetTime: s,
    shoreHardness: s, productionPerHour: s, moldNo: s, productName: s,
    scrapKg: s, operatorSignature: s, supervisorSignature: s,
    totalRollsProduced: s, totalRollKgs: s, processWasteKg: s, lumpsWasteKg: s, rejectionKg: s, totalConsumedKg: s,
    meterCheckedBy: s, meterCheckTime: s, meter: s, meterCountSet: s, attachedImage: s,
    dieZoneTemps: z.record(s), barrelZoneTemps: z.record(s), rejectionCounts: z.record(s),
    coilWeights: z.array(s),
    hourlyInspections: z.array(z.any()), traceabilityRows: z.array(z.any()), rolls: z.array(z.any()),
  })
  .partial();
export type LogbookUpdate = z.infer<typeof logbookUpdateSchema>;
