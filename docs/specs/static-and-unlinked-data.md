# Static & Unlinked Data Report

Inventory of **static seed data**, **legacy blob stores**, and **broken / soft links** still present in the Mass Polimer ERP codebase.

Generated from the live workspace (`data.json`, `src/mockData.ts`, client localStorage stores, and the Postgres migration path).

---

## 1. Summary

The app currently has **three overlapping data planes**:

| Plane | Location | Role today |
|---|---|---|
| **Postgres (authoritative for migrated domains)** | `server/prisma` + `/api/*` modules | Sales, planning, logbook, quality, inventory, dispatch, CAPA, formulation, dashboard, admin |
| **Legacy blob** | `data.json` via `GET/POST /api/data` | Still loaded/saved by `App.tsx`, but most screens no longer consume those arrays |
| **Client static / localStorage** | `src/mockData.ts`, `userStore`, `accessStore`, `roles`, `accessCatalog` | Machines, suppliers, batch lineages, employee directory, ACL overrides, session/theme |

**Bottom line:** most operational screens now read Postgres through TanStack Query, but a large amount of **static demo data and legacy sync code remains loaded, duplicated, or disconnected**.

---

## 2. Static data sources

### 2.1 `src/mockData.ts` — primary static seed

| Export | Count | Linked to Postgres seed? | Still used by UI? |
|---|---:|---|---|
| `initialCustomers` | 4 | Yes (`seed.ts`) | Indirectly (seed only); Sales UI uses API |
| `initialInquiries` | 3 | Yes | Seed / legacy blob |
| `initialSalesOrders` | 5 | Yes | Seed / legacy blob |
| `initialProductionPlans` | 1 | Yes | Seed / legacy blob |
| `initialLogbookTemplates` | 2 | Yes | Seed / tests / legacy blob |
| `initialMachineLogbooks` | 1 | Yes | Seed / tests / legacy blob |
| `initialQualityInspections` | 3 | Yes | Seed / legacy blob |
| `initialPackingRecords` | 2 | **No model in Prisma** | Synced in App state only — **not rendered** |
| `initialInventoryTransactions` | 4 | Yes | Seed / legacy blob |
| `initialDispatchRecords` | 1 | Yes | Seed / legacy blob |
| `initialCustomerComplaints` | 2 | Yes | Seed / legacy blob |
| `initialCapaRecords` | 1 | Yes | Seed / legacy blob |
| `initialMachines` | 9 | Yes (`Machine` model) | **Yes — hardcoded in Store + Maintenance screens + simulation** |
| `initialSuppliers` | 5 | **No Prisma model** | **Static only** — not in `data.json`, not seeded to API |
| `initialBatchLineages` | 2 | **No Prisma model** | **Static only** — Batch Passport demo narrative |

### 2.2 Inline static arrays in `server/src/legacy/dataJson.ts`

Not exported from `mockData.ts`; hard-coded in the legacy router:

- `initialRecipes` (3 BOM recipes) — **parallel / outdated** vs Postgres `Formulation` module
- `initialMaintenanceTasks` (4 PM tasks) — uses machine IDs `Extruder-01..04`, which **do not match** `M01..M09`

### 2.3 Client localStorage static seeds

| Store | Key(s) | What it holds |
|---|---|---|
| `src/lib/userStore.ts` | `mp_employees` | 19 seeded employees (directory). Parallel to Postgres `Membership` / admin directory |
| `src/lib/accessStore.ts` | `mp_permissions`, `mp_grants`, `mp_delegations` | Role overrides, per-employee grants, ACL requests |
| `src/App.tsx` | `erp_session`, `theme` | Signed-in session + UI theme |

These are **browser-local**, not tenant-scoped Postgres truth. Admin UI may still mutate them even while server `/me/permissions` is also used for menu gating.

### 2.4 Catalog constants (code-as-data)

| File | What |
|---|---|
| `src/lib/roles.ts` | Role list, theme, home screen |
| `src/lib/accessCatalog.ts` | Feature catalog + role default screens |
| `server/src/lib/permissions.ts` | Server-side port of the same policy |

These are intentional static catalogs, not orphan demo rows — but they **duplicate** between client and server.

---

## 3. `data.json` inventory (legacy blob)

Counts currently on disk:

| Key | Rows | Notes |
|---|---:|---|
| `customers` | 4 | Also in Postgres |
| `inquiries` | 3 | Also in Postgres |
| `salesOrders` | 5 | Also in Postgres |
| `productionPlans` | 1 | Also in Postgres |
| `templates` | 2 | Also in Postgres |
| `machineLogbooks` | 1 | Also in Postgres |
| `inspections` | 3 | Also in Postgres |
| `packingRecords` | 2 | **No Postgres table** |
| `inventory` | 4 | Also in Postgres |
| `dispatches` | 1 | Also in Postgres |
| `complaints` | 2 | Also in Postgres |
| `capas` | 1 | Also in Postgres |
| `recipes` | 3 | **Legacy BOM**; Postgres uses `Formulation` instead |
| `maintenanceTasks` | 4 | Also in Postgres (but different machine IDs) |
| `permissions` | 0 | Empty — ACL moved to localStorage / DB |
| `aclRequests` | 0 | Empty — ACL moved to localStorage / DB |

`App.tsx` still:

1. Initializes React state from `mockData`
2. Overwrites it from `GET /api/data` (or Firestore when Google SSO is used)
3. Debounced `POST /api/data` / Firestore writes on state change

…but migrated screens are passed **empty stub arrays** and read the API via hooks instead. So the blob sync is largely **write-noise / dead weight** for those domains.

---

## 4. Unlinked / inconsistent relationships

Hard foreign keys inside `data.json` (customer ↔ inquiry ↔ order ↔ plan ↔ capa) mostly resolve. The real problems are **soft links, naming mismatches, and domain gaps**.

### 4.1 Machine ID inconsistency

| Source | Machine IDs used |
|---|---|
| `initialMachines` / Store / Maintenance UI | `M01` … `M09` |
| `productionPlans.plan-1` | `M04` |
| `machineLogbooks.log-101` | `M09` |
| `maintenanceTasks` in `data.json` | `Extruder-01`, `Extruder-02`, `Extruder-03`, `Extruder-04` |

**Unlinked:** all 4 PM tasks reference machine names that **do not exist** in `initialMachines`.

### 4.2 Plan ↔ logbook machine mismatch

| Record | Field | Value |
|---|---|---|
| `plan-1` | `machineId` | `M04` |
| `log-101` | `productionPlanId` | `plan-1` |
| `log-101` | `machineId` | `M09` |

The submitted logbook claims to belong to plan-1, but it was recorded on a **different machine** than the plan.

### 4.3 Inspections have no parent links

All 3 inspections (`insp-1..3`) have:

- no `logbookId` / `machineLogbookId`
- no `salesOrderId`

They only share loose string affinity via `lotNumber` / `rollNumber` (`LOT-LD-260713-01`, `R-LD-12B-00x`).

### 4.4 Packing records are orphaned

`pack-1` / `pack-2`:

- no `inspectionId`
- no `salesOrderId`
- no `logbookId`
- linked only by `rollNumber` string

Also: **no Prisma `PackingRecord` model**, and App state for packing is **never passed into a visible screen**.

### 4.5 Complaints not tied to sales orders / known lots

| Complaint | `customerId` | `salesOrderId` | `batchNumber` | Present in inventory/log lots? |
|---|---|---|---|---|
| `comp-1` | `cust-1` | **null** | `LOT-LD-250622-04` | **No** |
| `comp-104` | `cust-2` | **null** | `180726·N·M08·B03` | **No** (exists only in static `initialBatchLineages`) |

`capa-1` correctly points at `comp-1`, but the complaint itself is detached from the order/dispatch chain.

### 4.6 Dispatch vs order status mismatch

| Record | Value |
|---|---|
| `disp-1.salesOrderId` | `so-1` |
| `disp-1.status` | `shipped` |
| `so-1.status` | `planned` |

Order was never moved to a dispatched / completed status, so the commercial and logistics states disagree.

### 4.7 Inventory references are free-text only

Examples:

- `inv-2.reference = REQ-MFG-Extruder01` — no matching machine / request entity
- `inv-4.reference = LOG-101` — informal pointer to `log-101`, not an FK

No `machineId` / `logbookId` columns in the blob rows.

### 4.8 Duplicate sales-order linkage on same inquiry

`inq-1` has **two** sales orders (`so-1`, `so-4`). Historically the seed even dropped duplicates for unique constraints when loading Postgres. The blob still carries both.

### 4.9 Recipes vs Formulations fork

| Legacy blob | Postgres |
|---|---|
| `data.json` → `recipes` (3 polymer film BOMs) | `Formulation` + revisions (seeded separately) |

Same conceptual domain, **two incompatible static datasets**. UI formulation screens use the API; the blob `recipes` array is leftover.

### 4.10 Static suppliers & batch lineages never enter the blob/API

`initialSuppliers` and `initialBatchLineages` exist only in `mockData.ts`.

- Not written to `data.json`
- Not in Firestore collection list as first-class synced entities for suppliers/lineages (Firestore sync list also omits `recipes` / `maintenanceTasks` inconsistently vs blob)
- Batch Passport narrative (`lin-clean`, `lin-fail`) is **demo story data**, not derived from live transactions

---

## 5. Dead / unlinked code paths

| Path | Status |
|---|---|
| `App.tsx` lifted state for customers/orders/plans/logbooks/etc. | Still synced to `/api/data`, but screens get `[]` stubs |
| `packingRecords` state | Loaded + saved, **never rendered** |
| `data.json` `permissions` / `aclRequests` | Always empty; ACL lives in localStorage (+ server admin module) |
| `src/lib/firebaseSync.ts` | Still active for Google SSO path; parallel legacy cloud blob |
| `initialBatchLineages` | Static passport demos; not generated from AuditEvent / live chain |
| `initialSuppliers` | Static store demo list; no API resource |
| Legacy `recipes` in `dataJson.ts` | Superseded by Formulation module |

---

## 6. What is migrated vs still static

### Migrated (API + Postgres + query hooks)

- Sales (customers, inquiries, quotations, orders)
- Planning
- Logbook / templates
- Quality
- Inventory
- Dispatch
- CAPA / complaints
- Formulation
- Dashboard summary
- Admin permissions (server-side)

### Still static / client-only / unlinked

- Machine list used directly from `initialMachines` in Store + Maintenance UIs
- Suppliers (`initialSuppliers`)
- Batch Passport lineages (`initialBatchLineages`)
- Employee directory seed in `userStore` (localStorage)
- Client ACL overrides in `accessStore` (localStorage)
- Packing records (blob only, unused UI)
- Legacy `recipes` + `Extruder-*` maintenance IDs in `data.json`
- Dual persistence leftovers: `/api/data` + Firestore sync in `App.tsx`

---

## 7. Recommended cleanup order

1. **Stop writing migrated domains to `/api/data` / Firestore** from `App.tsx` (remove lifted state + debounced blob sync).
2. **Delete or quarantine unused blob keys:** `packingRecords`, `recipes`, empty `permissions` / `aclRequests`.
3. **Normalize machine IDs** to `M01..M09` everywhere (fix maintenance seed / UI).
4. **Fix seed consistency:** plan machine = logbook machine; dispatch status ↔ order status; complaints require `salesOrderId` + known lot.
5. **Wire or remove static-only sets:** suppliers, batch lineages, packing — either become Postgres entities or leave the runtime path.
6. **Collapse duplicate directories:** localStorage `userStore` / `accessStore` → server admin APIs only.
7. Once nothing reads it, **delete `data.json` + `server/src/legacy/dataJson.ts`**.

---

## 8. Quick reference — key files

| File | Why it matters |
|---|---|
| `data.json` | Live legacy blob on disk |
| `src/mockData.ts` | Static seed + machines/suppliers/lineages |
| `server/src/legacy/dataJson.ts` | `/api/data` bridge + inline recipes/PM |
| `src/App.tsx` | Still initializes/syncs blob state while screens use API |
| `src/lib/userStore.ts` | Static employee directory in localStorage |
| `src/lib/accessStore.ts` | Static ACL state in localStorage |
| `src/lib/firebaseSync.ts` | Parallel Firestore blob sync |
| `src/lib/queries/*.ts` | Migrated API consumers |
| `server/prisma/schema.prisma` | Authoritative relational model |
| `server/prisma/seed.ts` | Demo tenant seeded from mockData (+ formulations) |
