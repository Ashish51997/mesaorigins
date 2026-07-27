# Spec: Logbook Template Builder · Plan→Template · Machine-Tasks Logging

> Spec-only. From the 7 provided MACHINE LOG BOOK reports (QR/MFG/013). No code
> until signed off. Decisions locked in the grilling are marked ✅.

## 1. Goal
Three connected capabilities:
1. **Template builder** — an admin UI to create/edit/clone logbook templates in **two configurable layout families** (Pipe/Nos + Coil/Roll), matching the real reports.
2. **Plan → template** — at planning, the planner **picks a template** for the plan (pre-filled, overridable); the operator's logbook uses exactly that template.
3. **Machine-Tasks page** — scheduled/running plans **grouped by machine**; clicking a task opens that plan's logbook sheet to fill/submit.

## 2. Vocabulary (domain)
- **Template** — the printed constants + specs + ranges + vocabularies of a report format for one product (doc no, rev, zones, ranges, hourly slots, rejection reasons, notes). *What's pre-printed.*
- **Logbook** — one operator's shift entry against a plan, using a template. *What's written by hand.*
- **Layout family** — the report's structural shape. Two exist:
  - **Pipe / "Nos"** — rigid PVC, counted in **Nos**, Shore **D**, inspection = OD·Weight·Colour·OK/NotOk·By, 1-column traceability ("Packing N Nos").
  - **Coil / "Roll"** — soft PVC film/coil, counted in **Rolls**, Shore **A**, inspection = TopDim·BottomDim·Thickness×N·Finish·PerMeter·Colour·Tearing·By, 2-column traceability + per-roll weight list ("Packing N Rolls").
- **Task** — a scheduled `ProductionPlan` on a machine (order · product · shift · date).

## 3. Data model (extend, don't replace)
- **`LogbookTemplate`** += `layout String @default("coil")` (`"pipe" | "coil"`), and reuse the existing Json spec fields; add `hardnessType` (`"A" | "D"`), `productionUnit` (`"nos" | "roll"`), `packingNote`, and pipe specs (`odSpec`, `weightSpec`) inside a `layoutSpecs Json`. Existing coil fields (`coil`, `dimensionSpecs`, `traceability`, `zoneSpecs`) stay for the coil layout.
- **`ProductionPlan`** += `logbookTemplateId String?` (FK → LogbookTemplate). ✅ Set at scheduling.
- **`MachineLogbook`** — no schema change (`hourlyInspections`/`traceabilityRows`/`rolls` are `Json`); their **shape varies by layout**, and the sheet renders per `template.layout`:
  - pipe row: `{ timeSlot, od, weight, colour, okNotOk, inspectionBy }`
  - coil row: `{ timeSlot, topDim, bottomDim, thickness[], finish, perMeter, colour, tearing, inspectionBy }` (already the case)
- Migration `logbook_templates_v2` (additive) + RLS unchanged (both tables already tenant-scoped).

## 4. Layout families — fields (faithful to the reports)
**Shared (both):** header (Machine No, Date, Shift, Shift Supervisor, Drawing No, Tag, Formula No, Mold No, Product Name) · Zone-wise temps (Die 6, Die 5, Barrel Zone 4/3/2/1) with per-zone ranges · Main Motor Speed · Ampere · Takeup Speed · Vaccum · Extruder start time · Product/Item set time · Production Per Hour · hourly inspection time slots · Production Report (Down Time Hrs, Inevitable process waste kg, Lumps waste kg, Rejections kg, Total material consumed kg) · Reason-for-Rejections list · M/c Down-Time Categories list · Meter checked-by/Time/Meter/Meter Count Set · Notes 1 & 2 · Inspector + Shift-Incharge signatures.

**Pipe/Nos extra:** Shore **D** Hardness · **Die & Sizer Gap** · OD spec (e.g. `11 +0.2 mm`) · Length spec · Weight spec (e.g. `176–178 g`) · Inspection cols **OD · Weight · Colour · OK/Not-ok · Inspection By** · Traceability **1 column** (Lot Number · Colour · Code · Pkt in kg · Packed By), "Packing **N Nos**" · Production **Total Nos Produced (Nos, kgs)**.

**Coil/Roll extra:** Shore **A** Hardness · Coil-weight spec (`150/M 7.8 kg + bobbin`, range) + per-roll weight list · Inspection cols **Top-Dim · Bottom-Dim · Thickness×3 · Finish · Per-meter · Colour · Tearing · By** · Traceability **2 columns** (Lot Number · Colour · Code · Winder/Packed By), "Packing **N Rolls**" · Production **Total Roll Produced (Roll, Kgs)**.

## 5. Template builder (Admin) — screen `logbook_templates`
- List templates (doc no · rev · product · layout badge · #plans using it).
- **New / Edit** modal: choose **layout** (Pipe/Coil) → a form of that family's parameters:
  header constants (docNo, revNo, revDate, brand, location, title, productName, moldNo, formulaNo, drawingNo, tag) · shifts[] · supervisors[] · **Die/Barrel zones + min/max ranges** · hourly **time slots[]** · hardness type + range · **inspection specs** (pipe: OD/Length/Weight; coil: dims/thickness/finish/per-meter + coil weight) · **traceability count** (rows; coil = tables×rows) · **rejection reasons[]** · **down-time categories[]** · notes[].
- **Clone** an existing template (fast start for a new product on the same layout).
- Live **preview** of the sheet as parameters change (reuse `MachineLogBookSheet`).
- Persist via API (tenant-scoped, audited). CRUD: `GET/POST/PATCH/DELETE /api/logbook/templates`.

## 6. Planning → template ✅
- `Schedule-Plan` modal gains **Logbook template** `<select>` (all templates), **pre-selected** to the best match (by `machine.logbookFormat`/product), planner may change.
- `POST /api/plans` accepts `logbookTemplateId`; stored on the plan.
- `openLogbook` resolves the template from **`plan.logbookTemplateId`** (fallback: machine format, then first template).

## 7. Machine-Tasks page ✅ — screen `machine_tasks`
- Groups scheduled/running plans **by machine**. Each **task card**: order (SO) · product · shift · date · **template name + layout** · **log status** (none/draft/submitted) · **[Log]** action.
- Clicking a task **opens that plan's logbook sheet** (the existing fill workspace, template-driven) inline/route → fill → submit (submit still books RM consumption, per the existing flow).
- Becomes the operator's primary logging entry (the current plain "scheduled extruder" dropdown is replaced by this page).

## 8. Templates to build (from the reports)
| # | Layout | Doc | Product | Source imgs |
|---|---|---|---|---|
| 1 | **Pipe/Nos** | QR/MFG/013 Rev 03 | `007 SM RPVC010.C 11MM 1180MM 178G N/V White` | 1,2,4,5,7 |
| 2 | **Coil/Roll** | QR/MFG/013 Rev 02 | `090 SM SPVC042 Z 150M 7.8K M/V Black (Rev-1)` | 3 (already seeded — re-tag `layout:coil`) |

Extracted spec values (seed): **Pipe** — zones Die6≈185 / Die5≈186 / Z3 195 / Z2 175 / Z1 165; Shore D ~82; OD 11 +0.2; Weight 176–178 g; Length 1180–1185; slots 9-10,12-1,3-4,6-7,8-9; reject reasons Finishing/Weight/Profile-Length/Cutting/Line-Mark/Other; traceability "200 Nos". **Coil** — as currently seeded; reject reasons Finishing/Roughness/Coil-Weight/Cut-Mark/Line-Mark/Bubble/Others; "2 Rolls". *(Machines tagged `QR/MFG/012` (LDPE) have no report provided — left on the coil layout unless you supply one.)*

## 9. Access
- **Template builder** (`logbook_templates`): Admin / Owner (built-in roles get it; assignable to any role via the RBAC we just shipped).
- **Machine-Tasks** (`machine_tasks`): Operator + Admin/Owner + Owner superset; Planner may view.
- Both enforced server-side by the dynamic-RBAC screen set.

## 10. Build plan (once signed off) — verified commits
1. Model + migration + seed both templates (Pipe + Coil) + `plan.logbookTemplateId`.
2. Backend: template CRUD API + plan template selection + `openLogbook` uses plan template + a `GET /logbook/tasks` (plans grouped by machine).
3. Frontend: **Pipe layout** in `MachineLogBookSheet` (+ fill panel) driven by `template.layout`.
4. Frontend: **Template builder** page.
5. Frontend: **Machine-Tasks** page + Schedule-modal template picker; wire menus/RBAC.
Each gated on client+server tsc + tests + build; existing 44 server / 31 client tests stay green.

## 11. Assumptions / open
- Templates & plans are per-tenant (already). ✅
- Pipe traceability default rows configurable (default ~14 visible, capacity to "200 Nos").
- `docNo` isn't unique per tenant today — the builder treats (docNo + productName) as the human key; ids are cuid.
- Print stylesheet parity kept for both layouts (reuse existing print CSS).
