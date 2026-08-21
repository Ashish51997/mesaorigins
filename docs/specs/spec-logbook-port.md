# Spec: Logbook — full port (old features → new sheet + new theme)

Status: agreed via grill-with-docs (2026-07-25). Spec-only. Lands in Phase 2 of
[spec-production-roadmap.md](spec-production-roadmap.md). Source of the old behaviour:
git `main` (`LogbookModule.tsx` 1526 lines, `MachineLogBookSheet.tsx`).

## Principle
**Keep the new, add back the old.** The new build is a paper-faithful, inline-editable
replica of QR/MFG/013 with a print stylesheet — keep it and the new theme
(Poppins/Inter, primary #4438E0, soft shadows, pills, status = colour+icon+words). Layer
the old build's *guided data-entry product* and richer data model on top. Everything below
is restyled to the new design; nothing keeps the old look.

## Data model — union (extend the new types, don't replace)
Add back to `MachineLogbook`: `rolls: RollRecord[]` (rollNumber, weight, length, winderBy,
packedBy, status pending|passed|failed), `materialGrade`, a header `lotNumber`, computed
`scrapKg`/`rejectionKg`/`totalConsumedKg` (mass-balance), `rejectionReasonsChecked: string[]`,
`operatorSignature`/`supervisorSignature`, `attachedImage`. Keep all new fields (coil array,
thickness columns, meter checks, per-reason counts, doc metadata).
Add back to `LogbookTemplate`: `zoneTargetSpecs[] {zone, target, min, max}` (numeric
setpoints), arbitrary `dimensionSpecs[] {name, unit, target, min, max}`, editable
`rejectionReasons[]`, `sectionsConfig` (per-section enable). Keep the new paper-faithful
fields (coil config, inspectionTimeSlots, doc metadata).

## Features to port (each restyled)
1. **Guided wizard mode (optional).** A toggle on the sheet: "Sheet mode" (today's inline
   editing) ⇄ "Guided mode". Guided = one field at a time, Enter-to-advance, progress bar,
   "Field X/N", step badge, Prev/Next, and a **jump-to-field** dropdown. Both modes bind the
   same logbook and keep the sheet⇄panel scroll-sync + highlight.
2. **Finished-roll / spool register.** Add-roll form (auto-number `R-YYYY-00N`, net weight,
   length, winder, packed-by, QC status), a per-shift **total output kg**, and **auto
   mass-balance**: `rejectionKg = Σ failed`, `totalConsumedKg = passed+failed+scrap`. On the
   sheet, roll rows render in §3/§4 with pass/fail chips (colour+icon+words).
3. **Dynamic hourly rows.** Add/remove hourly inspection rows (modal or inline) with a chosen
   time slot + per-dimension inputs + finish/colour/tearing + inspector — instead of the
   fixed slot set.
4. **Real Template Builder.** Dynamic zone count with **target/min/max °C** per zone;
   **add/remove dimension** chips (name/unit/target, auto ±%); **add/remove rejection reason**
   chips; **live preview** pane (a read-only sheet re-rendering the draft). Replaces today's
   flat comma-separated form. Per-tenant in Phase 2.
5. **Zone-temp setpoints + out-of-range flagging.** Reuse the new `RangeCell` for zone temps:
   amber/rose when the recorded temp is outside the zone's min/max, with a "Target N°C" hint.
6. **Scanned-sheet image attach.** Upload → stored image; an on-sheet "Physical copy
   attached" indicator; view/replace.
7. **Signature sign-off.** Operator + Shift-supervisor blocks capturing name (+ timestamp);
   shown on the sheet and in print.
8. **Submit validation + lock.** Block empty submit (≥1 roll); draft → submitted → **locked**
   (read-only) with a clear status pill; consequence toast on submit (no blocking alerts —
   use the app's toast, not `window.alert`).
9. **Production-plan linkage (Phase 2, server).** Re-link a logbook to a production plan +
   sales order; auto-derive materialGrade + lot. (Deferred vs template-only keying until the
   Planning data is server-backed.)

## Print
Keep the new A4 `@media print` stylesheet; extend it to include rolls, signatures, and the
attached-image reference.

## Acceptance
An operator can fill a shift either by tabbing the sheet or via guided mode; register rolls
and see live mass-balance; a supervisor signs and locks it; an admin edits the tenant's
template (zones/dimensions/rejections) with a live preview; out-of-range temps and weights
flag automatically; the sheet prints as the paper form.
