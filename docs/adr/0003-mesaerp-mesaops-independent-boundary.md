# 3. MesaERP and MesaOps as independent manufacturing services

Date: 2026-08-14
Status: accepted

## Context

Manufacturing customers need both a legal business system and a detailed plant execution
system. Combining their lifecycles would make production depend on finance availability,
and would let plant records mutate accounting evidence. Duplicating machine scheduling in
the ERP would also create two competing production plans.

## Decision

- `MesaERP` owns legal entities, company access, vendors, sourcing, procurement, customers,
  sales documents, valued inventory, MRP, costing, accounting, banking reconciliation,
  statutory evidence, assets, budgets and financial reporting.
- `MesaOps` owns operational orders, machines, shifts, operators, machine plans, tasks,
  logbooks, physical material movement, QA, traceability, maintenance, packing, gate passes
  and physical dispatch. Machine assignment never moves into MesaERP.
- `MesaLeads`, `MesaERP` and `MesaOps` have separate organization entitlements. Disabling
  one service does not delete accepted records or prevent another service's native flow.
- MesaERP can complete production with manufacturing issue, return and completion vouchers
  when MesaOps is absent. MesaOps can start from local customer, internal, forecast,
  replenishment, trial, rework or imported demand when MesaERP is absent.
- Optional handoffs use a transactional outbox/inbox, immutable source snapshots, canonical
  SHA-256 hashes, correlation IDs and explicit `linked`, `stale`, `conflict` or `unlinked`
  states. A destination creates and owns a local draft; neither service shares lifecycle
  status or rolls back the other.
- A background publisher polls each tenant under its PostgreSQL RLS context, claims bounded
  batches with advisory and row locks, verifies both envelope and source hashes, and records
  an idempotent destination receipt before marking an event published. Failed deliveries use
  exponential retry. Company-less MesaOps evidence remains pending as
  `company_route_required` until a maker-checker routing decision exists.
- MesaERP accounting and valued inventory are the legal books. Approved source documents
  generate immutable draft postings; a separate checker approves them, and GL plus valued
  stock commit atomically only when the accounting voucher posts.
- Authorization has three layers: shared tenant identity and service entitlement, explicit
  company-scoped MesaERP roles with default-deny finance permissions, and explicit
  plant-scoped MesaOps assignments. Supplier identities use a separate vendor-scoped
  session and cannot enter employee or journal APIs.
- There is no external accounting-system-specific exchange, synchronization or
  reconciliation feature.

## Consequences

- Production can continue through a finance outage, and finance can operate without a live
  plant service. Delayed handoffs become visible exceptions instead of distributed
  rollbacks.
- The same business event may have two truthful statuses: its source lifecycle and the
  destination's independently owned lifecycle. The UI must display source-link state
  separately from both.
- Cross-service automation requires explicit item, UOM, warehouse, customer and company
  mappings. Ambiguous mappings are quarantined rather than guessed.
- Financial corrections use reversals, debit or credit notes, and adjustment vouchers;
  posted evidence is not edited or deleted.

## Alternatives considered

- **One combined ERP/MES lifecycle** — rejected because finance or statutory downtime would
  hold plant execution hostage and cross-domain rollback would be unsafe.
- **Machine planning in both services** — rejected because two executable schedules would
  compete for the same machine, shift and operator capacity.
- **Shared transaction rows across services** — rejected because a source edit could silently
  change an accepted destination record and break auditability.
- **A legacy accounting package as the book of record** — rejected for this product
  direction; MesaERP is the native legal accounting and valued-inventory system.
