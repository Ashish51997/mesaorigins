# Technical Requirements Document (TRD) — Mass Polimer ERP

| | |
|---|---|
| **Product** | Mass Polimer ERP — multi-tenant SaaS |
| **Document** | Technical Requirements Document |
| **Version** | 1.0 |
| **Status** | Baseline (foundation + tenancy + sales slice implemented) |
| **Related** | `BRD.md` (business), `SYSTEM_ARCHITECTURE.md` (blueprint), `BACKEND_ARCHITECTURE.md`, `PRODUCTION_READINESS.md` |

> IDs: **TR-##** technical requirements · **NFR-##** non-functional requirements. Each traces to BRD functional requirements (FR-*) in §19.

---

## 1. Purpose & scope

Defines the technical design and requirements to build the system specified in `BRD.md`: a multi-tenant SaaS ERP as a **type-safe modular monolith** (React SPA + one Express/PostgreSQL API), reached from the existing click-dummy by a strangler migration. This TRD is authoritative for engineering; `SYSTEM_ARCHITECTURE.md` holds the diagrams and rationale.

## 2. Architecture overview

- **TR-01** Single deployable **modular monolith**: a React SPA and one Express API over PostgreSQL. Domain modules are bounded within the monolith (`modules/<domain>`). No microservices/Kubernetes. *(BR-01)*
- **TR-02** **Multi-tenant, pooled**: all tenants share the app and one database; every tenant-owned row carries `organizationId`. A **silo** (dedicated DB) tier exists for enterprise. *(BR-05, BR-08)*
- **TR-03** **Server is authoritative**: all data access and authorization decisions are server-side; the SPA is a view. *(BR-02, BR-R6, BR-R7)*
- **TR-04** **Type-safe end to end**: TypeScript across client and server, Zod at the HTTP boundary, Prisma at the DB boundary.

```
React SPA ──REST + auth token──▶ Express API ──Prisma──▶ PostgreSQL (RLS, organizationId)
   │  TanStack Query                │ auth→tenant→authz→validate→service        │
   └─ Firebase Auth (identity) ◀────┘ verify ID token          Stripe · R2 storage · email/WhatsApp
```

## 3. Technology stack

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite, TypeScript, TanStack Query, React Router (target), Tailwind v4, lucide-react |
| API | Node + TypeScript, Express 4, Zod validation, OpenAPI (target) |
| ORM / DB | Prisma 6, PostgreSQL 16 |
| Identity | Firebase Auth (Google + email/password), verified server-side via Admin SDK (Phase 2) |
| Billing | Stripe Billing (target) |
| Storage | S3-compatible object storage (Cloudflare R2) for attachments/photos/PDFs (target) |
| Local dev | Docker Compose Postgres; `tsx` dev server |
| Runtime tests | Vitest (unit + jsdom), Supertest (API integration), Playwright (E2E, target) |

## 4. System components

| Component | Responsibility |
|---|---|
| SPA shell (`src/App.tsx`) | Role-aware navigation, session, theme, tenant/org context |
| API entry (`server/src/index.ts`) | Boot API + serve SPA; strangler `/api/data` bridge |
| Middleware chain | `requestLog → authenticate → resolveTenant → requirePermission → validateBody → error` |
| Domain modules | `modules/sales` (built), planning, logbook, quality, inventory, dispatch, capa, admin, trace |
| Platform plane | organizations, memberships, invitations, billing, super-admin |
| Guarded Prisma client (`server/src/db.ts`) | Tenant-scoped data access + RLS arming |

## 5. Multi-tenancy technical design (critical)

- **TR-10** Isolation is **defence in depth** — a single mistake must not leak data across tenants. *(BR-05, BR-R6)*
  1. **PostgreSQL Row-Level Security** (`ENABLE` + **`FORCE`**) on all tenant-owned tables, policy `USING/WITH CHECK ("organizationId" = current_setting('app.current_tenant', true))`; fail-closed when unset.
  2. **App-layer guard** (Prisma `$extends`): reads the request's tenant from `AsyncLocalStorage`, sets the `app.current_tenant` GUC per operation, and injects `organizationId` on writes; a tenant-model query with no context throws.
- **TR-11** The app connects as a **non-superuser role** (`app_user`) so RLS binds — superusers/`BYPASSRLS` roles ignore RLS. Migrations/seed use a privileged owner role via Prisma `directUrl`. Role setup: `server/prisma/setup-roles.sql`. *(BR-05)*
- **TR-12** **Tenant is server-derived** from the authenticated user's `Membership`, never from client input.
- **TR-13** Global (no-RLS) tables — `Organization`, `User`, `Membership` — form the identity plane, queried before a tenant is resolved; `Membership` lists are filtered by org explicitly.
- **TR-14** Multi-step writes run in an atomic, RLS-scoped transaction (`tenantTx`) and emit an `AuditEvent`. *(FR-TRC-03)*
- **TR-15 (target)** Enterprise **silo**: connection resolved per tenant to a dedicated database. *(BR-08)*

## 6. Data model & persistence

- **TR-20** One table per domain entity; **foreign keys** enforce the value chain (customer→inquiry→order→plan→logbook→QA→inventory→dispatch). *(BR-02)*
- **TR-21** `organizationId` on every tenant-owned table; **uniqueness is per-tenant** via composite constraints (e.g. `@@unique([organizationId, soNumber])`, `[organizationId, inquiryNumber]`). *(BR-R5)*
- **TR-22** **Optimistic locking** via a `version` column → `409 Conflict` on stale writes.
- **TR-23** IDs are DB-generated (`cuid`); document numbers are server-issued per-tenant sequences (not array length). *(FR-SAL-07)*
- **TR-24** Deeply-nested logbook measurement data is stored as `Json`; relationships needing integrity are relations.
- **TR-25** Append-only `AuditEvent` (tenant-scoped) is the substrate for the Batch Passport and compliance. *(FR-TRC-01/03)*
- **TR-26** Migrations are Prisma-managed and code-reviewed; RLS is applied via a dedicated migration; managed-provider PITR backups (target).

Core entities: Organization, User, Membership · Customer, Inquiry, SalesOrder · ProductionPlan · LogbookTemplate, MachineLogbook · QualityInspection, PackingRecord · InventoryTransaction · DispatchRecord · Complaint, CAPARecord · Recipe/BOMItem, MaintenanceTask, Machine, Supplier · PermissionRule, EmployeeGrant, Delegation · AuditEvent.

## 7. API design & conventions

- **TR-30** RESTful resource endpoints under `/api`; JSON. Bodies validated by Zod (`422` + field details on failure). *(BR-01)*
- **TR-31** Standard error envelope `{ error: { code, message, details? } }` with correct HTTP status; Prisma errors mapped (`P2025`→404, `P2002`→409, `P2003`→409).
- **TR-32** Lifecycle transitions are explicit endpoints, transactional across tables where needed.
- **TR-33 (target)** OpenAPI spec generated from Zod for documentation and typed clients.

### 7.1 Endpoint catalog

**Implemented (sales slice):**
| Method & path | Purpose | AuthZ |
|---|---|---|
| `GET /api/health` | Liveness (public) | — |
| `GET /api/me` | Current identity: user, org, role | authenticated |
| `GET /api/members` | Org member directory | `screen:users` |
| `GET/POST /api/customers` | List / create customer (GST-unique) | `screen:sales_customers` |
| `GET/POST /api/inquiries` | List / create enquiry (server number) | `screen:inquiries` |
| `POST /api/inquiries/:id/quote` | Issue a quotation | `screen:quotations` |
| `GET /api/orders` | List orders | `screen:orders` |
| `POST /api/orders` | Confirm order (dup-guard, server SO no.) | `action:order.approve` |
| `POST /api/orders/:id/cancel` | Cancel a pending order | `screen:orders` |
| `GET/POST /api/data` | Legacy blob (strangler; un-migrated modules) | — |

**Planned (per module, following the same pattern):** planning (`/api/plans`, capacity), logbook (`/api/logbooks`, templates), quality (`/api/inspections`, holds), inventory (`/api/inventory`, issues), dispatch (`/api/dispatches`, gate-pass), capa (`/api/complaints`, `/api/capa`), trace (`/api/trace/:id`), admin (`/api/roles`, grants, delegations), platform (`/api/orgs`, invitations, billing webhooks).

## 8. Authentication & authorization

- **TR-40** Identity via **Firebase Auth**; the API verifies the ID token server-side (Admin SDK) and resolves the user's `Membership` → active org + role. *(FR-SAAS-01, BR-R6)* Current build uses a **dev-stub identity seam** (`x-dev-user` header) with Firebase verification as the only swap needed for Phase 2.
- **TR-41** **RBAC** enforced server-side by `requirePermission(featureKey)` (`screen:*` / `action:*`), from a role→permission catalog; per-employee grants and **time-boxed delegations** layer on (expiry enforced). The client `can()` is a cosmetic hint only. *(FR-ADM-02/03, BR-R7)*
- **TR-42 (target)** **Entitlements**: plan → enabled modules + limits checked alongside permissions; over-limit/past-due returns `402/403`. *(FR-SAAS-04)*

## 9. Frontend technical design

- **TR-50** Server state via **TanStack Query** (`src/lib/queries/*`) over a typed `apiClient` (`src/lib/apiClient.ts`) that attaches the auth token and unwraps the error envelope; migrated per domain (sales done). *(BR-04)*
- **TR-51 (target)** **React Router** with route-level `lazy()` code-splitting (URL-addressable screens; fixes the single ~1.6 MB bundle).
- **TR-52** UI-only state consolidated on a small store (Zustand, target); Tailwind v4 tokens; multilingual + touch-first. *(BR-04)*
- **TR-53 (target)** Live boards via **SSE** (per-tenant channels) → query invalidation. *(BR-06)*

## 10. Integrations

| Integration | Use | Status |
|---|---|---|
| Firebase Auth | Identity (Google + email/pw) | seam built, verify pending |
| Stripe Billing | Subscriptions, seats, webhooks | target |
| Object storage (R2/S3) | Attachments, defect photos, scanned sheets, PDFs (keys `tenants/<id>/…`) | target |
| PDF (headless Chromium) | Gate passes, invoices, logbook sheets (tenant-branded) | target |
| Email (Resend) / WhatsApp (Twilio) | Dispatch comms, complaint acks | target |

## 11. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-01 Performance | API p95 latency for standard reads/writes | < 300 ms |
| NFR-02 Frontend load | First meaningful paint on a mid-range tablet | < 3 s (needs code-splitting, TR-51) |
| NFR-03 Scalability | Stateless API replicas; pooled Postgres via PgBouncer; scale horizontally | many tenants / one deploy |
| NFR-04 Availability | Managed Postgres + multi-replica API | ≥ 99.5% |
| NFR-05 Durability | Point-in-time recovery backups | ≤ 24h RPO |
| NFR-06 Security | See §12 | — |
| NFR-07 Tenant isolation | No cross-tenant read/write under any code path | enforced (RLS + guard); tested |
| NFR-08 Auditability | Every state transition recorded with actor/time | AuditEvent |
| NFR-09 Observability | Structured logs + error tracking + health checks, tagged `tenantId` | pino + Sentry (target) |
| NFR-10 Usability | Touch-first shop-floor screens; EN + regional languages | — |
| NFR-11 Concurrency | Concurrent edits don't silently clobber | optimistic locking (TR-22) |
| NFR-12 Data residency | Enterprise silo option by region | target (TR-15) |

## 12. Security requirements

- **TR-60** All authorization server-side; client checks are cosmetic. *(BR-R7)*
- **TR-61** Tenant isolation via RLS + non-superuser role + app guard (TR-10/11). Mandatory **cross-tenant isolation tests** in CI. *(NFR-07)*
- **TR-62** Input validation (Zod) on every write; parameterized queries (Prisma); no raw string SQL with user input.
- **TR-63** Secrets in the host secret manager, never committed; `data.json`/`.env*` gitignored; Firebase web config restricted by origin.
- **TR-64 (target)** Helmet security headers, origin-locked CORS, `express-rate-limit` (per tenant + per IP), HTTPS everywhere.
- **TR-65** Least-privilege DB roles (owner for migrations, `app_user` for runtime).

## 13. DevOps, environments & CI/CD

- **TR-70** Environments: `dev` (local Docker Postgres), `staging`, `prod`; identical container images; config via validated env.
- **TR-71** Deployment: one container serves the API + built SPA (Render/Fly, target); managed Postgres (Neon); object storage (R2); optional CDN.
- **TR-72** CI (GitHub Actions, target): on PR → client `tsc` + server `tsc` → Vitest (unit) + Supertest (integration incl. isolation) → build; on merge → `prisma migrate deploy` → deploy → `/api/health` smoke.
- **TR-73** DB migrations run on deploy across the pool (and each silo).

## 14. Testing strategy

| Level | Tool | Scope | Status |
|---|---|---|---|
| Unit | Vitest (jsdom) | components, logic, hooks | 22 passing |
| API integration | Supertest + Postgres | routers, authz, validation, lifecycle | 6 passing (sales) |
| Isolation | Supertest / SQL | no cross-tenant read/write | verified |
| E2E | Playwright | order→plan→…→dispatch, login, two tenants | target |

## 15. Data migration

- **TR-80** Excel→ERP import maps spreadsheet rows to entities with validation; idempotent (dedupe by natural keys); bad rows surfaced not silently dropped. *(FR-SAAS-07)*
- **TR-81** Provisioning seed copies a baseline starter library (templates, roles, units) into each new org, then owned/editable by the tenant.

## 16. Implementation status

| Area | Status |
|---|---|
| Backend foundation (Express, Prisma schema, migrations, seed, middleware chain, dev-auth seam) | ✅ done |
| Multi-tenancy (Organization/User/Membership, `organizationId`, RLS + `app_user`, tenant guard, provisioning) — cross-tenant isolation verified | ✅ done |
| Sales slice (customers → inquiry → quotation → order) — REST modules + lifecycle + audit-bug fixes + integration tests; frontend on TanStack Query | ✅ done |
| Firebase-verify auth (Phase 2) | ⬜ seam ready |
| Onboarding + Stripe billing + entitlements + org switcher | ⬜ |
| Remaining domains end-to-end (planning, logbook, quality, inventory, dispatch, capa, admin) | ⬜ |
| Value-chain transactions + AuditEvent-backed Batch Passport | ⬜ |
| Real-time (SSE), files/PDF, notifications, observability, CI/CD, deploy | ⬜ |

## 17. Technical constraints & assumptions

- Two persistence paths (Postgres for migrated domains, legacy `data.json` for the rest) coexist during the strangler window — intended, temporary.
- Prisma `migrate reset` is blocked under some tooling; schema evolution uses forward migrations.
- RLS requires the app to connect as a non-superuser role (hard requirement, TR-11).
- Numbering uses per-tenant max+1 within a transaction (composite unique guards races); a dedicated sequence is a future hardening.

## 18. Risks (technical)

| Risk | Mitigation |
|---|---|
| Cross-tenant data leak | RLS + non-superuser role + app guard + mandatory isolation tests (TR-10/11/61) |
| Strangler divergence between Postgres and `data.json` | Migrate domain-by-domain; keep the window short; one source per domain |
| Single large bundle / slow load | Route-level code-splitting (TR-51) |
| Concurrent-edit clobber | Optimistic locking (TR-22) |
| Auth pivot risk (dev-stub → Firebase) | Isolated middleware seam; only the verify body changes (TR-40) |

## 19. Requirements traceability (BRD → TRD)

| BRD FR | Realised by |
|---|---|
| FR-SAL-01..08 | `modules/sales`, TR-20/21/23/30/32; endpoints §7.1 (done) |
| FR-PLN-01..06 | planning module (target), TR-20/32; capacity checks |
| FR-MFG-01..06 | logbook module (target) + existing logbook UI; TR-24 |
| FR-QUA-01..06 | quality module (target); value-chain txn TR-14 |
| FR-INV-01..05 | inventory module (target); ledger-derived balances |
| FR-DIS-01..04 | dispatch module (target); order-status txn |
| FR-CAP-01..04 | capa module (target); AuditEvent + gates |
| FR-TRC-01..03 | AuditEvent (TR-25) + trace projection; Batch Passport |
| FR-RPT-01..03 | reports over live state (target) |
| FR-ADM-01..04 | RBAC TR-41; Membership/PermissionRule/Grant/Delegation |
| FR-SAAS-01..07 | tenancy TR-10..14 (done); billing/onboarding TR-42 (target) |
| BR-02 (traceability) | FK value chain TR-20 + AuditEvent TR-25 |
| BR-05/06 (SaaS) | multi-tenancy TR-02/10/11; SSE TR-53 |
| BR-R1..R7 (rules) | service-layer logic + DB constraints + RBAC |
