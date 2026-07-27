# Spec: QR/MFG/013 Machine Log Book — faithful sheet + fill panel

Status: agreed (grill-with-docs session, 2026-07-23). Reference file:
`~/Downloads/MachineLogBookSheet (1).tsx`.

## 1. Goal
Rebuild the **"Production (LOG BOOK)"** feature so the operator sheet is a
pixel-faithful replica of the reference (QR/MFG/013 Rev 02), backed by a
right-side fill panel covering every field, template-driven and persisted
through the existing save flow.

## 2. Interaction model
- Two-column layout: left = reference sheet, right = grouped fill panel.
- Single source of truth: one `activeLogbook` object. Sheet cells and panel
  inputs are **controlled** and bound to it.
- Two-way editable + live sync: typing in the sheet or the panel updates the
  same state; both re-render instantly.
- Reference `Cell`/`RangeCell` (amber out-of-range + permissible hint)/`DropCell`
  keep their exact look/behaviour but lift value/onChange up (controlled).
- Click-sync: clicking a cell/section on the sheet focuses the matching panel
  group and vice-versa.
- Sheet uses the reference's exact inline paper CSS (namespaced). Right panel
  uses the app's Tailwind. Responsive stack < 700px. Print retained.

## 3. Data model (greenfield — replaces current shapes)

### LogbookTemplate (static per-product specs — seeded; admin config deferred)
docNo, revNo, revDate, brandName, location, title, productName;
shifts [A,B,C,D], supervisors[];
lotNumberNote; dieZones [Die 6, Die 5]; barrelZones [Zone 4..1];
coil { perM:150, targetKg:7.8, bobbinGms:140, rangeLo:7.945, rangeHi:7.995, count:44 };
inspectionTimeSlots [9-10,12-1,3-4,6-7,8-9];
dimensionSpecs { top{nominal,tol,lo,hi}, bottom{...}, thickness{count:3,lo,hi} };
finishSpec 'Matt'; perMeterSpec '52 gms';
traceability { tableCount:2, rowsPerTable:15 };
rejectionReasons[7]; notes[2].

### MachineLogbook (operator entries — strings, matching the paper cells)
id, productionPlanId, templateId, status;
machineNo, date, shift, shiftSupervisor;
drawingNo, tag, formulaNo, dieZoneTemps{}, barrelZoneTemps{}, motorSpeed,
ampere, takeupSpeed, vacuum, extruderStartTime, productSetTime, shoreHardness,
productionPerHour, moldNo, productName;
coilWeights[count], hourlyInspections[{timeSlot,topDim,bottomDim,thickness[3],
finish,perMeter,colour,tearing,inspectionBy}];
traceabilityRows[{lotNumber,colour,code,winderPackedBy}] (tableCount*rowsPerTable);
totalRollsProduced, totalRollKgs, processWasteKg, lumpsWasteKg, rejectionKg,
totalConsumedKg, rejectionCounts{}, meterCheckedBy, meterCheckTime, meter,
meterCountSet, attachedImage?.

Taxonomy: printed constants/specs/ranges/vocabularies/labels -> template;
everything the operator writes -> logbook. RangeCell ranges come from template.

## 4. Sheet sections (faithful to reference)
1. Process Parameters — drawing/tag/formula + die/barrel zone temps + motor/
   ampere/takeup/vacuum grid, then extruder/set times, shore hardness, prod/hr,
   mold no, product name.
2. Inspection Report — dimension sketch (static SVG) + 150/M coil-weight list
   1-44 (RangeCell from coil range) + hourly inspection grid (time-slot rows,
   spec sub-labels, RangeCells from dimensionSpecs, DropCell inspector).
3. Traceability (Packing 2 Rolls) — two 15-row tables (lot/colour/code/winder).
4. Production Report — totals + waste/lumps/rejections + material consumed,
   rejection-reason counts, meter-checked block, notes, signature strip.

## 5. Right panel
Four collapsible groups mirroring the sections; every logbook field has an
input; dropdowns for shift/supervisor/inspector; range hinting on measurements.
Fixed counts (44 coil, 5 hourly, 30 traceability, 7 reasons) => no add-row UI.
Click-sync with the sheet.

## 6. Seeding & persistence
- Seed one default template with the exact reference values.
- Reseed mockData.ts with a fresh sample MachineLogbook in the new shape.
- Persistence unchanged: LogbookModule -> setMachineLogbooks/setTemplates props
  -> debounced POST /api/data. New logbook starts blank.

## 7. Deferred (task #1)
Generalize the Admin Template Builder to configure the new spec fields for
arbitrary products. For now the seeded template drives everything.

## 8. Files
- src/types.ts — redefine LogbookTemplate, MachineLogbook, sub-types; shift 'D'.
- src/components/MachineLogBookSheet.tsx — rewritten, controlled, template+logbook driven.
- src/components/LogbookModule.tsx — two-column editable sheet + grouped panel.
- src/mockData.ts — new seeded template + sample logbook.
- Consumers reading old fields (rolls, zoneTemperatures, machineId, old hourly
  shape) fixed reactively; `npm run lint` (tsc --noEmit) must pass.

## 9. Assumptions
- Measurement cells stored as strings (paper-faithful; RangeCell parses).
- traceabilityRows is the roll register downstream packing/dispatch reads.
- Signature strip stays print-only labels (no name inputs).
- No auth/Firestore changes; local POST /api/data path is the target.
