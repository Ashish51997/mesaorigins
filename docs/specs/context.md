# CONTEXT — Mass Polimer ERP click-dummy

Glossary for the Access & Role Management system. Terms only — no implementation.

## Product / SaaS

- **Tenant** — one customer organisation (a manufacturing company / plant group) with
  isolated data. Every row carries a `tenant_id`; users, employees, templates, logbooks,
  and access rules all belong to exactly one tenant. A **Pilot tenant** is the first live
  customer used to prove Phase 1.
- **Subscription / Plan** — a tenant's billing tier (seats, feature entitlements, usage
  limits). Distinct from **Role** (a person's job) and **Feature** (a capability).
- **Super-admin** — the SaaS operator (us), across tenants; distinct from a tenant's own
  **Administrator** (manages people/access within one tenant).

See [spec-production-roadmap.md](spec-production-roadmap.md),
[spec-logbook-port.md](spec-logbook-port.md), and
[ADR-0002](../adr/0002-multi-tenant-saas.md).

## Access & Role Management

- **Employee** — a person with a login (today: `DirUser` in `userStore`). Holds exactly
  one **Role**. Distinct from the transient signed-in session.
- **Role** — a job function (Managing Director, Production Planner, Operator, Quality
  Inspector, Store Manager, Sales Executive, Dispatch Executive, Maintenance Head,
  Administrator). Determines the employee's **default feature set**, theme, and home.
- **Feature** — a single toggleable capability. Two kinds:
  - **Screen feature** — a sidebar destination / module (e.g. `screen:logbooks`,
    `screen:manufacturing`, `screen:template_builder`, `screen:reports`).
  - **Action feature** — a consequential operation inside a screen (e.g.
    `action:order.approve`, `action:qa.override`, `action:hold.release`,
    `action:lot.issue`, `action:gatepass.print`, `action:logbook.edit`).
- **Feature Catalog** — the master list of all features, grouped by module. The single
  source of truth the Admin portal renders and toggles against.
- **Grant / Override** — a per-employee rule that turns a specific feature ON or OFF for
  one person, on top of their role default. (Reuses `PermissionRule`, re-keyed to the
  employee instead of only the role.)
- **Effective access** — what an employee can actually do:
  `role default → ± per-employee grant/revoke → ± temporary delegation`.
- **Delegation (temporary bypass)** — the existing `ACLRequest` flow: an employee
  requests time-boxed access to a feature; an admin approves/denies. Kept as-is.
- **Admin portal** — the Administrator's screens for managing employees, roles, and
  feature access. Built by extending the existing `AclManagement` + `AdminScreens`.
- **Default-allow** — a feature with no explicit rule and no role-preset restriction is
  permitted. Enforcement of action features rolls out incrementally from high-stakes
  buttons; unwired actions stay allowed.

## Decisions locked (this grilling session)

1. Access unit = **role default + per-employee override** (not pure-role, not pure-person).
2. Feature grain = **action-level**, via a unified catalog of screen + action features.
3. Enforcement = **reuse `checkPermission`** for both kinds; `can(key)` helper gates
   actions; **default-allow**, wire high-stakes actions first (no rewrite).
4. Re-expose `template_builder`, `manufacturing`, `logbooks` as screen features,
   **default to Administrator + Managing Director only**, granted outward per employee.
5. Portal = existing **role×feature matrix** (role defaults) + a new **per-employee
   access panel** (tri-state: Inherit / Force ON / Force OFF), opened from the directory.
6. Disabled UX = disabled **screen** vanishes from the sidebar; disabled **action**
   button stays visible but greyed with a "No access" tooltip. No restricted wall.
7. Persistence = **localStorage** (like theme/session); admin setup survives reload.
8. Employee Directory = **HR-lite, admin-managed** (CRUD, rich fields, search/filter);
   row → profile → access panel; add employee + role auto-provisions role defaults.
9. Authority = **Administrator only** owns the portal; MD is read-only exec.

See [spec-access-mgmt.md](spec-access-mgmt.md) and
[ADR-0001](../adr/0001-feature-key-access-model.md).

**Status: built** — all 6 phases shipped (P1 engine · P2 wiring · P3 directory ·
P4 access panel · P5 enforcement + 3 re-added modules · P6 counts + verify).
