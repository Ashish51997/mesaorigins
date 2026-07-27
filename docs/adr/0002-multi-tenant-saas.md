# 2. Multi-tenant SaaS as the production target

Date: 2026-07-25
Status: accepted

## Context
The product is a click-dummy (client-only stores + localStorage). We chose to take it to
production as a **multi-tenant SaaS** (many plants/customers on one system) rather than a
single-plant internal tool or a per-customer on-prem install. The feature roadmap is
front-office-first (Sales+Planning MVP), so tenant isolation must exist before the first
paying pilot even though only one tenant is live at launch.

## Decision
- Build tenant-awareness into the foundation (Phase 0): `tenant_id` on every table, tenant
  context on every request, Postgres row-level security, per-tenant config (templates,
  machines, branding, entitlements).
- Reuse the already-built **feature-catalog RBAC** (`accessStore`/`checkPermission`) as the
  server-side authorization layer — the same model gates API endpoints, not just the UI.
- Separate **super-admin** (SaaS operator, cross-tenant) from a tenant's **Administrator**
  (within one tenant).
- Custom backend (NestJS + Postgres + Prisma) over the existing Firebase scaffolding, for
  relational integrity (traceability, mass-balance, planning) and query power.
- Preserve the client store interfaces so screens migrate from localStorage to API with
  minimal churn.

## Consequences
- Largest Phase 0 of the options (isolation, billing, infra) before feature depth — mitigated
  by shipping one deep vertical (Sales+Planning) to a pilot tenant first.
- Every feature phase inherits tenant scoping and server-enforced access for free.
- Firebase scaffolding in the current code is retired in favour of the custom backend; the
  RBAC/Employee model we built carries forward as the authz core.
- Relational model fits traceability/mass-balance/planning better than document storage, at
  the cost of more schema/migration work.

## Alternatives considered
- **Single-plant on Firebase** — fastest to real, rejected because the goal is to sell to
  multiple plants; retrofitting tenancy later is costly.
- **Single-plant custom backend** — same stack minus tenancy; rejected for the same reason.
- **Per-customer on-prem** — avoids tenancy but multiplies ops/support; rejected.
