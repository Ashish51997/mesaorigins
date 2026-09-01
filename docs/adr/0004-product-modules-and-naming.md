# 4. Product modules and naming (MesaSell, MesaBook, MesaPlant)

Date: 2026-08-27
Status: accepted

## Context

The platform shipped three entitled services under engineering names that confuse buyers:
shop-floor buyers hear “ERP”; sales buyers hear three equal apps. Founder and sales need
outcome-first product names, a scalable module pattern for Analytics and Connect, and a
clear sunset path for legacy labels in customer-facing materials.

## Decision

- Customer-facing sellable modules use the **Mesa*** pattern: **MesaSell**, **MesaBook**,
  **MesaPlant**, **MesaAnalytics**.
- Platform brand remains **MesaOrigins**.
- Non-module surfaces: **Command** (MD exceptions), **Organization Control** (customer
  admin), **Platform Control** (MesaWorks only), **Connect** (external vendors; requires
  MesaBook).
- Command answers “what needs attention now?”; MesaAnalytics answers “how did we perform
  over time?” — they must not overlap as two executive dashboards.
- New modules declare buyer, users, requires, handoffs, cannot-own, and sidebar group in
  the capability registry before implementation.
- Customer-facing materials **hide** legacy names (MesaLeads, MesaERP,
  MesaOps). Live code paths may keep legacy IDs until a later rename phase.
- Packages: Plant Start, Commercial Start, Manufacturing Suite, Connect add-on,
  MesaAnalytics add-on.

## Consequences

- Sales and manuals speak one vocabulary; engineering may retain legacy route IDs until
  an explicit rename ADR.
- Sidebar groups (Executive, Operations, Commercial, Network, Intelligence, Administration)
  absorb future modules without flat-list growth.
- Independence rules from ADR-0003 remain; only customer-facing names change.

## Alternatives considered

- Keep MesaLeads / MesaERP / MesaOps in UI — rejected for sales clarity.
- Dual labels everywhere — rejected as noisy for manuals; optional About subtitle deferred.
- Merge Plant and Book into one product — rejected (ADR-0003).
