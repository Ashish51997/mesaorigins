# Mass Polymer ERP Enterprise Suite
## Comprehensive Business Document & Unified Workflow Specification

This specification serves as the official operational reference manual and workflow topology for the **Mass Polymer Industries ERP Enterprise Suite (Terminal 04)**. It describes every business-critical pipeline, standard operating procedure (SOP), user clearance level, quantitative mathematical model, and data synchronization pattern that governs our compounding and extrusion plant.

---

## 1. Corporate Identity & System Security Architecture

The Mass Polymer ERP is a high-security intranet portal. To guarantee data isolation across physical plant terminals, the suite operates on two core pillars:
1. **Dynamic Departmental Clearance**: Active sessions are restricted strictly to authorized modules.
2. **Real-Time Synchronized Ledger**: Shift logs, inventory ledger transactions, and quality gates are automatically saved locally and synchronized continuously with both our central backup server container and **Google Cloud Firestore** for durable remote audit tracking.

---

## 2. User Personas & Department Clearance (RBAC Matrix)

Our plant operates on role-based access control (RBAC). The following table defines our seven corporate personas and their clearance matrix across the ERP modules:

| Persona & Role | Primary Department | Clearance Level | Accessible ERP Modules |
| :--- | :--- | :--- | :--- |
| **Madan Lal**<br>Managing Director (MD) | Executive Board | **Tier 1 (Admin)** | All Modules, Financial Overrides, Security Matrix Control, KPIs |
| **Rajesh Kumar**<br>Production Planner | Operations & Scheduling | Tier 2 (Planner) | Planning, Formulation, Reports, Machine Logbooks (Read Only) |
| **Amit Patel**<br>Production Operator | Shop-Floor Extrusion | Tier 3 (Operator) | Machine Logbooks, Formulation (Read Only), Inventory (Issues Only) |
| **Sunita Sharma**<br>Quality Inspector | Quality Assurance (QA) | Tier 2 (Inspector) | Quality Gates, Secondary Packing, Complaints, CAPAs |
| **Vikram Singh**<br>Store Manager | Inventory Control | Tier 2 (Warehouse) | Inventory Ledgers, Raw Materials, Finished Goods, Dispatch (Read) |
| **Neha Gupta**<br>Sales Executive | Commercial & CRM | Tier 2 (Sales) | Customers, Inquiries, Sales Orders, Complaints (Read Only) |
| **Sanjay Verma**<br>Dispatch Executive | Logistics & Dispatch | Tier 3 (Logistics) | Packing Records, Vehicle Gate Passes, Truck Ledgers |

### Operational Matrix Access Control Rules

```
+-----------------------------------------------------------------------------------------+
|                                    SECURITY LEVEL GATE                                  |
+-----------------------------------------------------------------------------------------+
|  Tier 1 (Admin)        --> Overrides and approves all delegations/bypass requests.      |
|  Tier 2 (Professional) --> Inputs schedules, formulas, inspections, or inventory bins.    |
|  Tier 3 (Field-Staff)  --> Records hourly parameters, packs rolls, logs gate dispatches.  |
+-----------------------------------------------------------------------------------------+
```

---

## 3. End-to-End Master Business Flows

### A. Authentication & Session Initiation Flow
1. **Selection / Verification**: 
   - A staff member approaches the terminal and chooses between a **Corporate Preset Profile** (1-click entry for verified personnel) and **Custom ID Sign-In** (manual entry for site contractors).
   - Alternatively, administrative staff connect via **Google SSO Single Sign-In** to lock in remote cloud database privileges.
2. **Authorization**: The system checks the session's email domain and active role.
3. **Session Anchoring**: The authenticated profile is cached in `localStorage` (`erp_session`), ensuring that the operator is not logged out mid-shift during power fluctuations.

---

### B. Sales & Commercial Pipeline Flow
```
[Customer CRM] ---> [Sales Inquiry (RFQ)] ---> [Quotation Pricing] ---> [Sales Order Created]
```
1. **Customer Onboarding**: Sales Executives record the customer’s GST numbers, contact details, payment terms (e.g., Net 30), and billing/delivery coordinates.
2. **Sales Inquiry (RFQ)**: Requests for quotes are submitted as drafts, detailing specific product grades, requested quantities, drawing references, and desired timelines.
3. **Quotation & Approval**: Executives compute the pricing. Once validated, the inquiry transitions to `quotation` status.
4. **Sales Order Generation**: Upon buyer approval, a formal **Sales Order (SO)** is locked with a priority flag (Low, Medium, High) and instructions. The SO initializes with a status of `pending`.

---

### C. Master Production Scheduling (MPS) Flow
1. **Capacity Audit**: Planners review active machine calendars (Line 1 to Line 4) and operator availability.
2. **Machine Allocation**: The Planner binds the `Sales Order` to a physical extruder, selecting an operator and shift (A, B, or C).
3. **Scheduling Window**: Planners set the precise start and end timestamps.
4. **State Transition**: The parent Sales Order transitions to `planned`, and a `ProductionPlan` is added to the Gantt queue.

---

### D. bill of Materials (BOM) & Formulation Standardization Flow
1. **Material Formulation**: Engineers specify stoichiometric portions ($w_i$) for masterbatches, virgin resins, and stabilizing additives.
2. **Auto-Normalization Engine**: If raw input values sum to other than $100.0\%$, the system applies standard stoichiometric scaling:
   $$w_i' = \left( \frac{w_i}{\sum_{j=1}^{n} w_j} \right) \times 100$$
3. **Costing Engine**: The system calculates the weighted average compound cost per Kg:
   $$\text{Recipe Cost} = \sum \left( \text{Unit Cost}_i \times \frac{\text{Portion}_i}{100} \right)$$
4. **Predictive Calibration (Maintenance)**: Planners track preventive maintenance (PM) schedules, die clearances, and extruder screw calibrations to avoid process drift.

---

### E. Machine Logbook & Shift Operator Flow
1. **Shift Initialization**: The Shop-Floor Operator logs active lot numbers, supervisorial sign-offs, and starting extruder speeds.
2. **Parametric Log**: Operators record zone temperatures ($^\circ\text{C}$), motor speeds, extruder pressures, and amperage hourly to verify compound stability.
3. **Roll Recording**: Finished rolls are wound, weighed, and recorded under the active lot with length, weight, and status tags.
4. **Shift Closure**: Operators record consumed polymer resin, final output weight, and scrap weight. The system computes compounding yield:
   $$\text{Yield} \% = \left( \frac{\text{Output Kg}}{\text{Total Consumed Kg}} \right) \times 100$$
5. **Image Verification**: Operators upload photos of physical manual logsheets for compliance audits.

---

### F. Quality Assurance & Secondary Verification Flow
```
[Operator Roll Entry] ---> [QA Visual & Tearing Audit] ---> [Thickness Dimension Tolerances] ---> [Decisive Certificate]
```
1. **Quality Inspection**: QA Inspectors pull active rolls from the queue.
2. **Dimensional Tolerance Guard**: Inspections measure micron wall-thickness and surface finishes.
3. **Physical-Mechanical Verification**: Inspectors log tearing and colour matches.
4. **Decisive Pass/Fail Evaluation**:
   - If finish, colour, tearing, and dimensional fields pass, the roll is certified as `pass`.
   - Any out-of-spec metric redirects the roll to `hold` or `fail` registers.
5. **Inventory Hand-off**: Approved rolls trigger a finished goods inventory entry automatically.

---

### G. Warehousing & Inventory Control Ledger Flow
1. **Raw Material Receipt**: Silo managers log incoming resin shipments with lot numbers and quantities. This records an `in` transaction for raw materials.
2. **Compounding Issue**: Operators record the withdrawal of resins for compounding batches. This records an `out` transaction for raw materials.
3. **Finished Goods Storage**: Approved QA rolls are received into the finished stock store. This records an `in` transaction for finished goods.
4. **Ledger Reconciliation**: Stock balance calculations compute running levels across the ledger:
   $$\text{Stock Level} = \text{Initial Stock} + \sum \text{Transactions (In)} - \sum \text{Transactions (Out)}$$

---

### H. Logistics, Packing & Gate Pass Dispatches Flow
1. **Secondary Pallet Packing**: Dispatch teams pack passed rolls onto pallets, logging weights and pallet serial numbers.
2. **Standard QR Generation**: A standardized QR metadata string is printed onto the secondary label:
   `MPERP::<Roll_Number>::WT::<Weight_Kg>::LOT::<Lot_Number>`
3. **Truck & Invoice Matching**: Logisticians input carrier truck details, drivers' names, transporter names, and invoice references.
4. **Gate Pass Issuance**: The dispatch record is flagged as `shipped`, shifting the corresponding Sales Order status to `dispatched` and updating ETA trackers.

---

### I. Customer Complaints, CAPA & SLA Control Flow
```
[Customer Complaint] ---> [SLA Clock Initiated] ---> [Root-Cause Investigation] ---> [8D Preventive CAPA Lock]
```
1. **Complaint Log**: Customers report defects (e.g., surface marks). The Sales Team logs complaints with photos and batch numbers.
2. **SLA Severity Assignment**:
   - **High Severity**: Requires investigation closure within **3 Days**.
   - **Medium Severity**: Requires closure within **10 Days**.
   - **Low Severity**: Allows up to **30 Days** for resolution.
3. **8D Corrective & Preventive Action (CAPA)**: QA Engineers link complaints to CAPA files, detailing root-causes, corrective solutions, and future preventive safeguards.
4. **SLA Guard**: The system tracks target dates and flags unresolved CAPAs as `overdue` if they exceed target timelines.

---

### J. Delegation & Security Override Flow
1. **Bypass Request**: When a field operator requires temporary access to a planning or commercial module, they submit a formal `ACLRequest`.
2. **Admin Evaluation**: Managing Directors (Tier 1) review pending requests in real-time.
3. **Administrative Override**: MDs approve the bypass, setting a lease duration (e.g., 120 minutes) and documenting the audit reason.
4. **Module Unlock**: The operator's terminal unlocks the restricted module for the specified window, keeping an immutable log of the override event.

---

## 4. Verification & Computational Soundness

All calculations described in this specification are verified continuously by our automated Jest/Vite testing suite (`src/test-all-features.ts`). Running `npm test` executes **32 core business pathways** including:
* **Access Control Guard Gates**: Testing operator blockades, custom preset switches, and administrative bypass leases.
* **OEE Math Engine**: Verifying exact decimal multiplication of Availability, Performance, and Quality components.
* **11-Step Manufacturing Compliance Gates**:
  - *In-Line Parameter Auditing*: Validating extruder melt temperatures (160-240°C) and water pressures (2-6 bar).
  - *Rejected Material Disposal*: Verifying ISO-compliant methods ('Regrinded & Recycled', 'Sold to Scrap Contractor', 'Safely Landfilled').
  - *Breakdown & Preventive Maintenance*: Calculating and aggregating unexpected shift halt hours separate from scheduled calibrations.
* **BOM Costs**: Confirming weighted costing against manual batch totals.
* **SLA Timelines**: Validating CAPA overdue logic.

```bash
# To run the official business logic validation suite:
npm test
```

---

*This document is the official blueprint of Mass Polymer Industries Ltd. ERP workflows. All modifications to the data structure, endpoints, or role permissions must update this file to maintain architectural alignment.*
