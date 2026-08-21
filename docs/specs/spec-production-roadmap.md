# Spec: Production Roadmap — click-dummy → multi-tenant SaaS

Status: agreed via grill-with-docs (2026-07-25). Spec-only. Glossary in [context.md](context.md);
architecture rationale in [ADR-0002](../adr/0002-multi-tenant-saas.md); the Phase-2 logbook
detail in [spec-logbook-port.md](spec-logbook-port.md).

## Decisions (this grilling)
1. Deliverable = **one hybrid phased roadmap** (production foundation + feature phases).
2. Target = **multi-tenant SaaS** (custom backend, tenant isolation, per-tenant config, billing).
3. MVP ordering = **front-office first**: Sales+Planning → Production+Quality → Stores+Dispatch → Maintenance+Admin+Reports.
4. Logbook = **full port** (union of old features onto the new sheet + new theme) — Phase 2.

## How to read this
The current app is a **click-dummy**: all state lives in module stores (`useSyncExternalStore`
+ localStorage) with no backend. Every phase below turns one slice of that into a real,
tenant-scoped, server-backed product. Phases are **independently shippable**; the store
interfaces are preserved so the UI changes little as each store moves server-side.

---

## Phase 0 — Multi-tenant foundation (platform, no new user features)
The plumbing everything else rides on.
- **Backend**: NestJS + PostgreSQL + Prisma; typed API (tRPC or REST + OpenAPI).
- **Multi-tenancy**: `tenant_id` on every table; tenant-context middleware; Postgres
  row-level security; per-tenant config (templates, machines, suppliers, branding).
- **Auth**: OAuth/OIDC + JWT (Auth0/Clerk or self-hosted). Sign-in maps to an **Employee**
  and a **Role**; the **feature-catalog RBAC we already built** (`accessStore`/`checkPermission`)
  becomes the server authorization layer — enforced on every endpoint, not just the UI.
- **Store migration**: move `accessStore`, `userStore`, `flowStore`, `plannerStore`,
  `salesFlowStore`, `warehouseStore`, `operatorStore`, `maintenanceStore` from localStorage to
  API-backed data, keeping their hook signatures so screens are largely untouched.
- **Billing**: Stripe subscriptions; plan tiers → feature entitlements + seat/usage limits;
  tenant self-serve admin + a super-admin console.
- **Infra**: Docker, CI/CD, migrations, backups, secrets, staging+prod, observability
  (structured logs, metrics, error tracking, uptime).
- **Cross-cutting** (start here, sustain throughout): audit log, i18n (already stubbed),
  real offline sync (upgrade the existing offline queue), test harness (unit/integration/e2e),
  accessibility, print/PDF service.

## Phase 1 — MVP: Front office (Sales + Planning) — tenant-scoped, first pilot
- **Sales**: Customers/CRM, Inquiries, Quotations, Orders (confirm + priority),
  Complaints/CAPA intake.
- **Planning**: Orders-to-Plan, Plan Board, Formulations, Machine Capacity, Material
  Availability.
- Ships to the **pilot tenant** with real auth + server-enforced RBAC. Exit criteria: a
  customer can run enquiry→quote→order→plan end-to-end on real data.

## Phase 2 — Production + Quality (includes the full logbook port)
- **Production Log Book**: the full port — see [spec-logbook-port.md](spec-logbook-port.md).
  Server-persisted, **per-tenant templates**.
- **Operator**: hourly log grid, raise breakdown, shift summary.
- **Quality**: incoming inspection (QR/QC/025), roll inspection (pass/hold/fail), holds,
  disposal→regrind, calibration due.
- **Traceability / Batch Passport** (both lineages) — server-backed, per-tenant.

## Phase 3 — Stores + Dispatch
- **Stores**: receive material, issue lot (scan-first), RM stock board, FG put-away, regrind.
- **Dispatch**: ready-to-dispatch, gate pass (checklist + print/PDF), vehicles, history,
  e-Waybill integration.

## Phase 4 — Maintenance + Admin + Reports/BI
- **Maintenance**: breakdowns, preventive schedule, downtime analytics, machine history,
  calibration register.
- **Admin (hardened for SaaS)**: Employee directory, Roles & Access (server-enforced),
  delegation, audit; tenant-admin vs super-admin separation.
- **Reports/BI**: dashboards, scheduled exports, analytics; Excel→ERP **Migration Hub**
  repositioned as **tenant onboarding/import**.

## Cross-cutting (every phase)
Testing & CI gates · security review · performance budgets · shop-floor **PWA/tablet**
(offline-first) · print/PDF (logbook, gate pass, invoice) · data import/onboarding ·
observability · docs.

## Out of scope (initial)
Native mobile apps, marketplace/integrations beyond e-Waybill, ML/anomaly detection,
white-label theming per tenant beyond logo/colours.

## Open questions
- Pilot tenant identity + timeline for Phase 1?
- Auth provider: managed (Auth0/Clerk) vs self-hosted?
- Do we also build a **click-dummy logbook port now** as a tangible Phase-2 preview, or keep
  the logbook spec-only until Phase 2?
