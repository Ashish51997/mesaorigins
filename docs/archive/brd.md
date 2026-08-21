# Business Requirements Document (BRD) — Mass Polimer ERP

| | |
|---|---|
| **Product** | Mass Polimer ERP — a multi-tenant SaaS for plastics/polymer extrusion manufacturers |
| **Document** | Business Requirements Document |
| **Version** | 1.0 |
| **Status** | Baseline |
| **Related** | `trd.md` (technical), `system-architecture.md`, `production-readiness.md` |

> Requirement IDs: **BR-##** business requirements/goals · **FR-<module>-##** functional requirements. Priority uses MoSCoW (**M**ust / **S**hould / **C**ould / **W**on't-now).

---

## 1. Executive summary

Mass Polimer ERP is a cloud ERP sold to small and mid-sized **plastics extrusion manufacturers** (pipes, profiles, coils, films) who today run production on **paper logbooks and spreadsheets**. It digitises the full **order-to-dispatch value chain** with **ISO 9001-grade traceability**, so any finished lot can be traced back to its shift, machine, operator, raw-material batch and quality result — and any complaint forward to its root cause.

It is delivered as a **multi-tenant SaaS**: one product, many manufacturer "tenants", each with isolated data, users, configuration and billing. The commercial model is per-plant subscription with tiered plans.

## 2. Business context & problem statement

Target customers are single- or few-plant polymer extrusion units. Their operational reality:

- **Paper shift logbooks** (e.g. formats `QR/MFG/012`, `QR/MFG/013`) filled by machine operators; data is siloed, illegible, and lost.
- **Spreadsheets and phone calls** for enquiries, quotations, orders, planning and dispatch — no single source of truth.
- **Weak traceability** — when a customer complains about a batch, tracing which shift/machine/material produced it takes days or is impossible, which fails ISO 9001 audits and erodes customer trust.
- **No live view** for the owner (Managing Director) of plant status, quality, stock or dispatch.

**BR-01 (M)** Replace paper/Excel with one connected system across sales, planning, production, quality, stores, dispatch and complaints.
**BR-02 (M)** Guarantee end-to-end batch traceability (raw material → shift/machine → quality → pallet → invoice → customer) and the reverse (complaint → batch → root cause).
**BR-03 (M)** Enforce ISO 9001 process discipline (controlled logbooks, mandatory quality gates, closed-loop CAPA).
**BR-04 (M)** Give each role a focused, shop-floor-friendly workspace (touch-first, multilingual).
**BR-05 (M)** Be sellable to many manufacturers as isolated tenants with subscription billing.
**BR-06 (S)** Give the owner a live plant, quality, stock and dispatch overview.
**BR-07 (S)** Import existing Excel data during onboarding.
**BR-08 (C)** Support enterprise customers needing data isolation/residency.

## 3. Vision & objectives

**Vision:** the operating system for a polymer plant — from a customer enquiry to a dispatched, fully-traceable roll — usable by an operator on the floor and an owner on their phone.

| Objective | Measure (see §14) |
|---|---|
| Digitise the value chain | % of orders processed end-to-end in-system |
| Traceability | Time to trace any lot both directions (target: seconds) |
| Quality discipline | % rolls passing through the QA gate; CAPA closure time |
| Adoption | Weekly active users per role; paper logbooks retired |
| Commercial | Tenants onboarded; MRR; churn |

## 4. Scope

### 4.1 In scope
Sales/CRM, Production Planning & Control (PPC), Manufacturing (machine logbooks + standards/BOM), Quality (in-line + incoming + disposal), Inventory & Stores (RM + FG), Dispatch, Complaints & CAPA, Maintenance, Reports/BI, Batch Traceability, Administration (users, roles, access control), Excel→ERP migration, multi-tenant onboarding & billing.

### 4.2 Out of scope (now)
Full financial accounting / GL, payroll/HR, e-invoicing/GST filing integration, procurement/purchase-order workflow, IoT/PLC machine-sensor integration, native mobile apps, per-tenant bespoke code. (Several are candidate future phases.)

## 5. Stakeholders & personas

| Persona | Role | Primary needs |
|---|---|---|
| **Vendor / Platform admin** | SaaS provider (us) | Provision tenants, billing, support, cross-tenant ops |
| **Plant Owner** | Managing Director (buyer) | Live overview, trust the numbers, ISO compliance, ROI |
| **Administrator** | Tenant IT/ops admin | Manage people, roles, access policy |
| **Sales Executive** | Sales | Log enquiries, quote, confirm orders, handle complaints |
| **Production Planner** | PPC | Turn orders into machine/shift schedules; check capacity & material |
| **Operator** | Shop floor | Fill the shift logbook / hourly readings; raise breakdowns |
| **Quality Inspector** | QA | Inspect rolls, pass/hold/reject, disposal, calibration |
| **Store Manager** | Stores | Receive/issue raw material, put away finished goods, stock |
| **Dispatch Executive** | Dispatch | Load vehicles, gate passes, invoices, dispatch |
| **Maintenance Head** | Maintenance | Breakdowns, preventive schedule, downtime, calibration register |

## 6. Business processes (the value chain)

```
Enquiry ─▶ Quotation ─▶ Order ─▶ Production Plan ─▶ Machine Logbook ─▶ Quality
   (Sales)                          (PPC)            (Manufacturing)    (QA)
                                                                         │
Customer ◀─ Dispatch ◀─ Finished-Goods Store ◀───────────────────────────┘
   │            (Dispatch)        (Stores)
   └─▶ Complaint ─▶ CAPA ─▶ Closure        Traceability spans every step
```

1. **Enquiry-to-Order** — capture a customer enquiry, quote a rate, confirm an order.
2. **Order-to-Plan** — schedule a confirmed order onto a machine/shift with capacity and material checks.
3. **Plan-to-Produce** — the operator runs the shift and fills the machine logbook; finished rolls are registered.
4. **Produce-to-Inspect** — QA inspects rolls (dimensions, finish, tearing) and passes / holds / rejects.
5. **Inspect-to-Store** — passed goods are put away as finished stock; raw material is received and issued.
6. **Store-to-Dispatch** — ready stock is loaded, gate-passed, invoiced and dispatched; the order closes.
7. **Complaint-to-CAPA** — a customer complaint is logged against a batch, investigated, and closed via CAPA.
8. **Cross-cutting** — traceability, reporting/BI, maintenance and administration run across all of the above.

## 7. Functional requirements by module

### 7.1 Sales & CRM
| ID | Requirement | Pri |
|---|---|---|
| FR-SAL-01 | Maintain a customer master (name, GST, contact, addresses, payment terms, status) | M |
| FR-SAL-02 | GST number must be unique within a tenant; required fields validated | M |
| FR-SAL-03 | Log an enquiry (customer, product, quantity, expected delivery, drawing/spec, remarks, file attachment) | M |
| FR-SAL-04 | Issue a quotation (rate/unit, optional discount/negotiation note) against an enquiry | M |
| FR-SAL-05 | Confirm an order from a quoted enquiry; exactly **one** order per enquiry (no duplicates) | M |
| FR-SAL-06 | Cancel a not-yet-planned order and return the enquiry to the quotation queue | S |
| FR-SAL-07 | Document numbers (enquiry/order) are system-issued and unique per tenant, never reused | M |
| FR-SAL-08 | Confirmed orders flow to Planning automatically | M |

### 7.2 Production Planning & Control (PPC)
| ID | Requirement | Pri |
|---|---|---|
| FR-PLN-01 | Show a queue of confirmed orders awaiting planning | M |
| FR-PLN-02 | Schedule an order onto a machine + shift + date with an assigned operator | M |
| FR-PLN-03 | Prevent double-booking a machine/shift/date | M |
| FR-PLN-04 | Warn when an order cannot fit before its due date (capacity conflict) | S |
| FR-PLN-05 | Resolve the correct formulation/BOM for the order's product and check material availability | S |
| FR-PLN-06 | A created plan flows to Manufacturing (gates the operator's logbook) | M |

### 7.3 Manufacturing — Machine Logbook & Standards
| ID | Requirement | Pri |
|---|---|---|
| FR-MFG-01 | Operator fills a digital shift logbook matching the controlled paper format for the machine | M |
| FR-MFG-02 | Guided entry covers **all** sections (process params, coil weights, hourly inspection, finished rolls, traceability, production report, sign-off) | M |
| FR-MFG-03 | Flag values outside permissible ranges (temperatures, dimensions, coil weights) | S |
| FR-MFG-04 | Draft logbooks auto-save; submit locks the sheet; a supervisor can reopen | M |
| FR-MFG-05 | Submitted logbook output (rolls/traceability) flows to Quality | M |
| FR-MFG-06 | Maintain formulations/BOM and manufacturing standards (OEE, yield) derived from real data | C |

### 7.4 Quality
| ID | Requirement | Pri |
|---|---|---|
| FR-QUA-01 | Queue produced rolls for inspection | M |
| FR-QUA-02 | Record dimensional/finish/tearing checks against spec and pass / hold / reject | M |
| FR-QUA-03 | A pass books finished-goods stock and creates a dispatchable pallet | M |
| FR-QUA-04 | Incoming (raw-material) inspection with accept/reject | S |
| FR-QUA-05 | Disposal & regrind register for rejected material | S |
| FR-QUA-06 | Calibration-due tracking for instruments | C |

### 7.5 Inventory & Stores
| ID | Requirement | Pri |
|---|---|---|
| FR-INV-01 | Receive raw material (supplier, lot, quantity) | M |
| FR-INV-02 | Issue a raw-material lot to a scheduled machine; stock decrements | M |
| FR-INV-03 | Put finished goods away; they become dispatchable stock | M |
| FR-INV-04 | Live RM and FG stock balances derived from the transaction ledger | M |
| FR-INV-05 | Regrind lot tracking | C |

### 7.6 Dispatch
| ID | Requirement | Pri |
|---|---|---|
| FR-DIS-01 | List finished goods ready to dispatch (from FG stock / confirmed orders) | M |
| FR-DIS-02 | Create a gate pass / loading list for a vehicle | M |
| FR-DIS-03 | Generate a dispatch record + invoice and set the order to "dispatched" | M |
| FR-DIS-04 | Dispatch history and vehicles-today views | S |

### 7.7 Complaints & CAPA
| ID | Requirement | Pri |
|---|---|---|
| FR-CAP-01 | Log a customer complaint linked to a real dispatched batch (severity, photo, description) | M |
| FR-CAP-02 | Auto-initiate a CAPA ticket; track root cause / corrective / preventive actions | M |
| FR-CAP-03 | A CAPA cannot be closed without mandatory root-cause fields; complaint closes only after CAPA closure | M |
| FR-CAP-04 | Time-bound response SLAs by severity | S |

### 7.8 Maintenance
| ID | Requirement | Pri |
|---|---|---|
| FR-MNT-01 | Raise and close machine breakdowns | M |
| FR-MNT-02 | Preventive maintenance schedule with due/overdue status | S |
| FR-MNT-03 | Downtime analytics, machine history, calibration register | C |

### 7.9 Traceability (Batch Passport)
| ID | Requirement | Pri |
|---|---|---|
| FR-TRC-01 | Trace any lot/roll/pallet/invoice/complaint number to its full lineage across the value chain, from live data | M |
| FR-TRC-02 | Forward and backward trace (siblings, regrind parent/child) | S |
| FR-TRC-03 | An append-only audit trail of who changed what, when | M |

### 7.10 Reports & BI
| ID | Requirement | Pri |
|---|---|---|
| FR-RPT-01 | Live dashboards and reports derived from actual state (production, quality, dispatch, complaints) | M |
| FR-RPT-02 | Working filters (by machine, customer, date) | M |
| FR-RPT-03 | Export to Excel/PDF | S |

### 7.11 Administration & Access Control
| ID | Requirement | Pri |
|---|---|---|
| FR-ADM-01 | Manage the employee directory (people, roles, status) per tenant | M |
| FR-ADM-02 | Role-based access to screens and high-stakes actions | M |
| FR-ADM-03 | Per-employee grants and **time-boxed** access delegations (auto-expire) | S |
| FR-ADM-04 | Access policy changes persist and propagate | M |

### 7.12 Onboarding, Tenancy & Billing (SaaS)
| ID | Requirement | Pri |
|---|---|---|
| FR-SAAS-01 | Self-serve signup provisions a new organization with baseline config (templates, roles, units) and an owner | M |
| FR-SAAS-02 | Invite teammates by email into an organization with a role | M |
| FR-SAAS-03 | Per-tenant configuration: logbook templates, product catalog, units, branding on documents, enabled modules | M |
| FR-SAAS-04 | Subscription billing (plan tiers, seats) with entitlements gating modules/limits | M |
| FR-SAAS-05 | Suspend / export / offboard a tenant | S |
| FR-SAAS-06 | A user may belong to multiple organizations and switch between them | S |
| FR-SAAS-07 | Excel→ERP import during onboarding (idempotent) | S |

## 8. Key business rules

- **BR-R1** One confirmed order per enquiry; cancelling a pending order returns the enquiry to quotation.
- **BR-R2** A roll may not be dispatched unless it passed QA and was put away as finished stock.
- **BR-R3** A submitted logbook is locked; corrections require a supervisor reopen (audited).
- **BR-R4** A complaint closes only after its CAPA is closed with root cause recorded.
- **BR-R5** GST number is unique per tenant; document numbers are unique per tenant and never reused.
- **BR-R6** A user only ever sees data belonging to their active organization.
- **BR-R7** High-stakes actions (confirm order, QA pass, gate-pass release, plan an order) are permission-gated by role.

## 9. Roles & access (summary matrix)

| Screen area | MD | Admin | Sales | Planner | Operator | QA | Store | Dispatch | Maint |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Dashboard/Home | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sales (enquiry→order) | 👁 | | ✅ | | | | | | |
| Planning | 👁 | | | ✅ | | | | | |
| Logbook / Manufacturing | 👁 | | | | ✅ | | | | |
| Quality | 👁 | | | | | ✅ | | | |
| Inventory / Stores | 👁 | | | | | | ✅ | | |
| Dispatch | 👁 | | | | | | | ✅ | |
| Maintenance | 👁 | | | | | | | | ✅ |
| Complaints & CAPA | ✅ | | ✅ | | | | | | |
| Reports/BI | ✅ | | | | | | | | |
| Users & Access | | ✅ | | | | | | | |

✅ full · 👁 read/oversight. Fine-grained per-action permissions and per-employee grants layer on top (FR-ADM-02/03).

## 10. Commercial model (SaaS)

- **Unit of subscription:** an Organization (one manufacturer/plant), billed per plan tier + seats.
- **Tiers (indicative):** Starter (core sales→dispatch), Growth (+ quality, maintenance, BI), Enterprise (+ dedicated data isolation/residency, SSO, priority support).
- **Entitlements:** plan determines enabled modules and limits (seats, machines, storage); over-limit/past-due is blocked gracefully, not broken.
- **Onboarding:** self-serve signup → baseline seed → invite team → optional Excel import.

## 11. Assumptions & dependencies

- Plant has basic internet and shared/tablet devices on the floor.
- Firebase (identity), Stripe (billing), a managed Postgres, and object storage are available cloud dependencies.
- Controlled logbook formats are provided by each tenant and modelled as configurable templates.

## 12. Constraints

- Multilingual UI (English + regional languages) for shop-floor usability.
- Touch-first ergonomics for operator/QA/store screens.
- ISO 9001 documentation and audit-trail obligations.
- Single-region default; enterprise data-residency by exception.

## 13. Compliance

ISO 9001:2015 quality-management alignment: controlled documents (logbook templates with doc/rev numbers), mandatory quality gates, calibration tracking, closed-loop CAPA, and a complete audit trail for traceability.

## 14. Success metrics / KPIs

| KPI | Target direction |
|---|---|
| Orders processed fully in-system | ↑ |
| Lot trace time (both directions) | ↓ (seconds) |
| Rolls passing through the QA gate | 100% |
| CAPA closure time | ↓ |
| Paper logbooks retired per tenant | ↑ |
| Tenants onboarded / MRR | ↑ · Churn ↓ |

## 15. Risks (business)

| Risk | Mitigation |
|---|---|
| Shop-floor adoption resistance | Guided entry, touch-first UI, multilingual, minimal typing |
| Data isolation breach across tenants | Enforced at the platform (see TRD §6); a breach is existential |
| Scope creep into full accounting/ERP | Explicit out-of-scope list; integrate rather than build |
| Migration data quality from Excel | Validated, idempotent import; surface bad rows |

## 16. Glossary

**Tenant/Organization** a manufacturer subscribing to the product · **Lot** a canonical production batch (format `DDMMYY·D/N·Mxx·Bnn`) · **Logbook** a machine's shift production record · **CAPA** Corrective & Preventive Action · **PPC** Production Planning & Control · **BOM/Formulation** the recipe for a product · **Batch Passport** the end-to-end trace view of a lot · **Entitlement** what a subscription plan permits.
