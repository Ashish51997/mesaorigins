# Spec: Access & Role Management + Employee Directory

Status: agreed via grill-with-docs (2026-07-25). Spec-only — no code until approved.
Guiding constraint: **reuse the existing access code; do not rewrite.** Glossary in
[CONTEXT.md](CONTEXT.md); rationale in [ADR-0001](docs/adr/0001-feature-key-access-model.md).

## 1. Goal
An Administrator-owned portal to enable/disable **any feature for any employee**, on top
of role defaults, plus an HR-lite **Employee Directory**. Re-expose three orphaned
modules (`logbooks`, `manufacturing`, `template_builder`) as toggleable features.

## 2. Model (what a "feature" is)
A **Feature** is one toggleable capability, in a single **Feature Catalog** grouped by
module. Two kinds share one key space:
- **Screen feature** — `screen:<moduleId>` (a sidebar destination).
- **Action feature** — `action:<verb>` (a consequential button inside a screen).

**Effective access** for an employee resolves in this order (first match wins):
1. **Delegation** — an approved, unexpired `ACLRequest` for this employee+feature → allow.
2. **Employee grant** — a per-employee override (`on`/`off`) → that value.
3. **Role override** — a `PermissionRule` for this role+feature (matrix) → its `allowed`.
4. **Role preset default** — screens: in the role's default set? actions: **allow** unless
   the preset restricts it.
5. **Fallback** — screens not in any of the above are **hidden** (opt-in per role);
   actions default **allow** (opt-out).

This is the existing `checkPermission` 3-step logic (bypass → matrix → preset) with the
`moduleId` parameter generalised to a `featureKey`, plus one new layer (employee grant).

## 3. Reuse map (existing → change)
| Existing | Change |
|---|---|
| `aclUtils.checkPermission(role, moduleId, …)` | Rename param to `featureKey`; insert the employee-grant layer. Same 3 tiers otherwise. |
| `PermissionRule` (`role-module`) | Reused as the **role override**; `module`→`feature`. |
| `ACLRequest` delegation flow | **Kept as-is** (temporary bypass; employee requests, admin resolves). |
| `AclManagement.tsx` matrix + audit + requests tabs | Reused for role defaults + audit + delegation. Columns become the feature catalog (screens then actions, grouped by module). |
| `userStore.ts` (`DirUser`) | Extended to `Employee` (see §6) + CRUD + localStorage. |
| `AdminScreens.tsx` (`AdminHome`, `UserDirectory`) | `UserDirectory` → the Employee Directory; add `EmployeeProfile` with the access panel. |
| App `currentNavItems` / `canViewActive` | Screens filtered by **effective access** (hide disabled). Already role-scoped; now honors overrides. |
| — (new) | `can(featureKey)` helper for the current employee; gates action buttons. |
| — (new) | `EmployeeGrant` type + store (per-employee override). |

## 4. New/changed types
```
Feature      { key, label, module, kind: 'screen' | 'action' }
PermissionRule (existing)  role override: id=`${role}-${featureKey}`
EmployeeGrant { id: `${employeeId}-${featureKey}`, employeeId, featureKey,
                state: 'on' | 'off', by, at }              // NEW per-employee override
Employee     (extends DirUser — see §6)
ACLRequest   (existing, unchanged)                          // delegation
```
Persistence: `mp_permissions`, `mp_grants`, `mp_employees`, `mp_delegations` in
localStorage; hydrated on load, written on change.

## 5. Feature catalog (v1)
**Screens** — the full module set incl. the three re-added:
`dashboard, plant_overview, quality_memory, management_review, reports, inventory, capa,
users, acl, logbooks, manufacturing, template_builder, orders_to_plan, plan_board,
formulations, machine_capacity, material_availability, hourly_grid, raise_breakdown,
shift_summary, incoming, roll_queue, holds, disposal_regrind, calibration, receive,
issue_lot, rm_stock, fg_putaway, regrind_lots, inquiries, quotations, orders,
sales_customers, sales_complaints, ready, gate_pass, vehicles_today, dispatch_history,
breakdowns, preventive, downtime, machine_history, calibration_reg`.

**Actions (high-stakes, wired first — ~15):**
`order.approve, order.setPriority, qa.pass, qa.hold, qa.override, incoming.accept,
lot.issue, pallet.release, fg.putaway, gatepass.release, gatepass.print, dispatch.mark,
order.plan, logbook.edit, breakdown.close`.
All other actions stay default-allow until wired later.

**Re-added-module defaults:** `logbooks`, `manufacturing`, `template_builder` →
Administrator + Managing Director only. Any employee can be granted them individually.

## 6. Employee Directory
Extend `DirUser` → `Employee`:
`id, employeeCode (EMP-0xx), name, photo/initials, email, phone, department, role,
shift (D/N), line (e.g. M08 | —), status (active | on_leave | inactive), joinDate, location`.
Departments: Management, Sales, Production, Quality, Stores, Dispatch, Maintenance,
Administration.

Directory UI (Administrator only):
- Search box + filters (role ▾, department ▾, status ▾); table/card hybrid.
- Status shown as colour **+ icon + words** (Active / On leave / Inactive) per house rule.
- **+ Add employee** → form (name, code, email, phone, dept, role, shift, line, joinDate)
  → picking a role **auto-provisions** role-default access.
- Row → **Employee profile**: identity header + tabs **Details** (edit/deactivate) and
  **Access** (the tri-state panel).
- Access panel: features grouped by module; each row a segmented control
  **Inherit · ON · OFF**; "Inherit" shows the resolved role default inline (e.g.
  "Inherit — allowed by role"). Writes `EmployeeGrant`s. A "Reset to role defaults"
  clears all grants for the person.

## 7. Admin portal IA (Administrator sidebar)
`Home · Employee Directory · Roles & Access (matrix) · Access Requests (delegation) ·
Audit log`. MD: read-only exec (no portal). Everyone else: no portal.

## 8. Enforcement points
- **Sidebar**: `currentNavItems` filtered by `can('screen:'+id)` → disabled screens vanish.
- **Deep nav**: opening a disabled screen id falls back to the role home (no wall).
- **Action buttons**: the ~15 above wrapped so that when `!can('action:x')` the button is
  rendered greyed + `title="No access — ask your administrator"`.
- **Default-allow** everywhere unspecified → nothing breaks; toggles are additive.

## 9. Build phases (each: tsc + tests + build green, commit)
1. Generalise `checkPermission` to `featureKey`; add `EmployeeGrant` store + `can()`; localStorage.
2. Feature catalog + role presets (existing + 3 re-added at Admin/MD).
3. Employee Directory: `Employee` fields + CRUD + directory UI + profile Details tab.
4. Access panel (tri-state) in the profile; write/read grants; role matrix reused.
5. Enforce: sidebar screen-hiding; wire the ~15 action buttons; re-add routes/nav for
   `logbooks`, `manufacturing`, `template_builder`.
6. Delegation + audit tabs reused; persistence + seed demo data; verify on live.

## 10. Out of scope (v1)
Real auth/SSO, org hierarchy/reporting lines, bulk CSV import, view-vs-edit per screen
(actions cover the important cases), wiring every action (only the ~15 high-stakes now).

## 11. Resolved
- **Status vs access:** `active` = normal; `on_leave` = keeps access, shown as a badge;
  `inactive` = sign-in suspended (the existing `active` gate). Only `inactive` blocks login.
- **Seed:** expand the directory to **~18 employees** across all departments (2–3 per
  role, mixed shifts, ≥1 on-leave and ≥1 inactive) so search/filters feel real.
