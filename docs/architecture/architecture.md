# MesaOrigins manufacturing platform architecture

MesaOrigins is a modular manufacturing platform delivered as one React, Express and
PostgreSQL application. Its three product services are independently entitled and
independently operable:

| Service | Source of truth |
|---|---|
| **MesaLeads** | Leads, requirements, technical review, quotations and customer decisions |
| **MesaERP** | Companies, vendors, sourcing, procurement, customers, sales, valued inventory, business MRP, manufacturing accounting, finance, tax and reporting |
| **MesaOps** | Operational demand, machine and shift planning, job execution, physical material movement, QA, traceability, maintenance, packing and dispatch |

Shared platform services provide identity, organization tenancy, service entitlement,
audit evidence and reliable event infrastructure. They do not merge the business
lifecycles owned by the three services.

The detailed boundary decision is recorded in
[`0003-mesaerp-mesaops-independent-boundary.md`](../adr/0003-mesaerp-mesaops-independent-boundary.md).

HTTP prefixes and mount order: [`api-services.md`](./api-services.md).

## Runtime topology

```text
Browser
  React 19 + Vite + TanStack Query
        |
        | HTTPS / JSON
        v
Express API
  authentication -> tenant resolution -> service entitlement -> exact permission
        |
        | Prisma transactions with tenant context
        v
PostgreSQL 16
  forced row-level security + append-only evidence + transactional outbox/inbox
```

The application remains a modular monolith. Service boundaries are enforced in API
middleware, authorization, database ownership and event contracts without introducing
distributed-transaction failure modes.

## Service independence

- An organization can enable MesaLeads, MesaERP or MesaOps in any combination.
- Every service has native create APIs and its own lifecycle. A cross-service source is
  optional.
- MesaERP can record issue, completion, scrap, recovery and batch cost without MesaOps.
- MesaOps can create local customer, internal, forecast, replenishment, trial, rework or
  imported operational demand without MesaERP.
- Machine, line, shift and operator assignment always remains in MesaOps.
- Destination records are local drafts created from immutable snapshots. Source status is
  displayed separately from destination status and link state.
- Source failure never rolls back a destination record, and destination failure never
  rolls back the source event.

## Identity, roles and access

Authorization is layered:

1. A shared identity resolves one organization membership.
2. The organization must hold an active entitlement for the requested service.
3. MesaERP requires an explicit company-scoped role assignment and exact permission.
   Financial access is default-deny; the legacy organization-admin flag is not a finance
   bypass.
4. MesaOps plant access is explicit and default-deny in production. An active all-scope
   assignment grants every plant; otherwise the caller sees only assigned plant codes.
   The additive migration preserves eligible legacy access by recording it against a
   dedicated permissionless system role, while any existing assignment history is left
   unchanged. Zero history grants nothing. A legacy zero-history fallback exists only when
   a local/test process explicitly sets `MESAOPS_ALLOW_LEGACY_UNASSIGNED=1`; production
   ignores that flag.
5. Supplier portal users authenticate through a separate supplier session and are
   restricted to their vendor and company. They cannot enter employee, voucher or journal
   APIs.

Sensitive accounting, vendor bank, access and approval actions use maker-checker controls.
Assignments support validity windows and auditable revocation.

## Persistence and tenant isolation

PostgreSQL is the durable system of record for migrated domains. Tenant-owned tables carry
`organizationId`; MesaERP transactions additionally carry `legalEntityId`, financial-year
context, origin metadata and an optimistic row version.

The runtime connection uses a least-privilege database role. Request transactions set the
tenant context, and forced PostgreSQL row-level security provides a second isolation layer
beneath API filters. Financial quantities and values use Prisma/PostgreSQL `Decimal`, while
public JSON contracts use decimal strings.

The legacy `/api/data` document endpoint is retired; PostgreSQL is the only application
system of record. Deployments no longer mount `/app/storage`. An existing Docker named
volume may remain as an unmounted recovery artifact until its contents are independently
archived and an authorized retention decision removes it.

## Accounting and valued inventory

One versioned posting engine owns the legal ledger. Vouchers move through
`draft -> submitted -> approved -> posted -> reversed`. Debits and credits must balance in
the company base currency. Voucher numbering is scoped by company, voucher family and
financial year.

Posted evidence is immutable. Corrections create reversal, debit/credit-note or adjustment
documents; application code does not update posted journal rows in place. Accounting
periods support open, soft-closed and locked states with controlled reopening.

Valued inventory is a separate MesaERP ledger with moving weighted average or preselected
FIFO valuation. Approved source documents first create a posting link and a draft voucher.
Only the independently approved voucher post commits general-ledger and stock movements
atomically. MesaOps operational stock evidence cannot write these records directly.

## Manufacturing ownership

MesaERP owns planning BOM revisions, commercial availability, reservations, aggregate
production demand, material planning suggestions, manufacturing vouchers, WIP and actual
batch cost. It never selects an executable machine.

MesaOps owns `OperationalOrder`. A `ProductionPlan` references that local order and stores
the selected machine, shift, operator, dates, quantity and execution snapshot. Quantity and
schedule checks run under database locks so concurrent split plans cannot over-plan the
order or double-book a machine slot.

Plant execution, QA and physical dispatch use their own evidence and permissions. Dispatch
quantity is bounded by ordered, completed, packed, QA-released and previously undispatched
quantity. Statutory applicability is derived from an active rules profile; callers cannot
disable a required legal gate with a request flag.

## Reliable optional handoffs

Service transitions and their outbox events commit in the same database transaction. Each
event carries a stable ID, schema version, correlation ID, aggregate version, canonical
payload hash and immutable snapshot. Consumers deduplicate by consumer and event ID.

Trusted service handoffs use deployment-managed signing keys in addition to normal user
authorization. A browser cannot assert that a local order originated in MesaERP merely by
supplying source IDs and a hash. Invalid mappings, stale versions and out-of-order events
enter an exception state instead of being guessed or silently overwritten.

## India external compliance evidence

Provider-backed e-invoice and e-way-bill operations keep their adapter validation path.
Fallback acknowledgements, externally issued e-way bills, supplier e-invoices and GSTR-2B
uploads use a separate deployment-owned verifier attestation. The verifier signs a
canonical envelope that binds organization, legal entity, evidence kind, source-record
type/id, retained-payload hash, verifier reference and verification timestamp.

The API never treats a caller-supplied checksum or label as verification. It requires
`MESAERP_EXTERNAL_EVIDENCE_HMAC_KEY` to be canonical base64 decoding to at least 32 bytes,
and fails closed when the key or HMAC is invalid. External e-way activation, inbound-to-
GSTR-2B reconciliation and an ITC claimed decision re-verify the stored signed envelopes
against the immutable retained payload. This deployment attestation is not represented as
a government or provider signature.

## API conventions

MesaERP routes are company scoped under:

```text
/api/mesaerp/v1/entities/:legalEntityId/...
```

Every mutating ERP request uses an `Idempotency-Key`. Lifecycle changes also carry the
expected row version. Dates use ISO business dates, event timestamps use UTC, and money or
quantity values are decimal strings. The generated OpenAPI document is derived from the
actual Express route stack and is served beneath `/api/docs`.

MesaOps planning, dispatch and high-risk plant mutations use the same retry-safe and
optimistic-concurrency principles while retaining their existing service-native routes.

## Application entry points

- `/` — entitled-service selector
- `/mesaleads` — MesaLeads
- `/mesaerp` — MesaERP company workspace
- `/mesaops` — MesaOps plant workspace
- `/supplier-portal` — separately authenticated supplier workspace
- `/admin` — organization/service administration

## Build and deployment

```bash
npm run lint
npm run lint:server
npm run test:unit
npm run test:server
npm run build
npm start
```

The Vite client is emitted only under `dist/client`; the ESM Express bundle is emitted under
`dist/server`. Express exposes only the client directory, and production builds do not ship
a server source map. The production entry is `dist/server/server.mjs`. Docker Compose
provides a PostgreSQL service, an explicit one-shot
migration service and the non-root production application container. Seeding is a separate
profile because it recreates demo data and must never run implicitly against customer data.

Production secrets include the application database/authentication credentials, vendor-bank
encryption key and separate keys for trusted service handoffs, MesaERP-issued dispatch
evidence and externally verified compliance evidence. They belong in the deployment secret
store, never in repository environment files.

Production startup validates the public HTTPS origin, proxy-hop count, Auth.js secret and
four independent cryptographic keys. `/api/ready` additionally verifies database access
through a login-only runtime role with no elevated attributes, confirms every RLS-enabled
table remains forced, and confirms every migration packaged with the image is complete.
Forced RLS stays active during migrations; reviewed cross-tenant backfills use a separate
policy bound to the exact table-owning migration role and session, which `app_user` is
forbidden to inherit. Production persistence is Neon Postgres 16 (pooled `app_user` URL,
owner URL for the migrate job only) with Cloud Run and Neon both allowed to scale to zero.
Cloud Build gates releases on a non-superuser two-tenant upgrade fixture, the full test
suite, a Neon durability/snapshot gate, an additive migration job and a no-traffic
candidate smoke test before traffic promotion. Runtime revisions pin numeric Secret Manager
versions. Topology, cost stages and the idle contract are in
[`production.md`](./production.md).

## Change rules

- Add schema changes through forward-only Prisma migrations. Never reset or reseed customer
  databases during an upgrade.
- Run `npm run db:preflight:mesaerp` before the first MesaERP migration. Legacy sales orders
  already split over multiple plans require explicit planned-quantity reconciliation; the
  preflight is read-only and refuses to guess an allocation.
- Preserve accepted source snapshots and audit records when a service is disabled.
- Do not write journals or valued stock outside their posting engine.
- Do not put machine scheduling, operator tasks or plant logbooks in MesaERP.
- Do not make a service's native completion depend on a live call to another service.
- Quarantine ambiguous party, item, UOM, warehouse or legacy-plan mappings for explicit
  reconciliation.
