# Demo story: Apex Polymers

Fictional demo tenant for product storytelling. English only. No legacy product names.

## Organization

| Field | Value |
| --- | --- |
| Organization | Apex Polymers Pvt Ltd |
| Industry | Polymer extrusion (pipes and profiles) |
| Default plant | Plant 1 — Pune |
| Default company | Apex Polymers — India (FY 2025-26) |
| Tagline in demos | From enquiry to gate pass on one platform |

## People (shared cast)

| Name | Role | Primary home |
| --- | --- | --- |
| Ravi Mehta | Managing Director | Command |
| Priya Shah | Administrator | Organization Control |
| Anil Desai | Sales | MesaSell |
| Meera Joshi | Production Planner | MesaPlant |
| Suresh Patil | Operator (Line E-02) | MesaPlant |
| Kavita Nair | Quality Inspector | MesaPlant |
| Imran Khan | Store | MesaPlant |
| Deepa Rao | Dispatch | MesaPlant |
| Vikram Singh | Maintenance | MesaPlant |
| Neha Gupta | Finance | MesaBook |
| Rohit Malhotra | Procurement | MesaBook |
| Sunil Vendor | Supplier (Connect) | Connect |
| MesaWorks Ops | Platform operator | Platform Control |

## Sample records (consistent IDs)

| Id | Record |
| --- | --- |
| `Q-1042` | Quote for BlueTech Pipes — 500 m HDPE coil |
| `SO-2201` | Commercial sales order (MesaBook) linked from quote |
| `OO-881` | Operational order on Plant 1 |
| `PLAN-441` | Machine plan on E-02, Shift A |
| `LOT-19A` | Lot with QA hold |
| `PO-330` | Purchase order to Sunil Vendor |
| `GP-77` | Gate pass blocked by QA hold |

## Link-state examples in the story

- Quote → sales order: **Linked**
- Operational order without commercial source: **Not linked**
- Plant evidence waiting company map: **Needs mapping**
- Quote revised after SO accepted: **Stale**
- Destination qty diverged: **Conflict**

## Multi-plant scale appendix

| Plant | City | Entitled in Suite demo |
| --- | --- | --- |
| Plant 1 | Pune | Yes |
| Plant 2 | Nashik | Toggle: entitled or “not entitled” for scale demo |

Sales can describe multi-plant growth with the org-level plant switcher without a product redesign.
