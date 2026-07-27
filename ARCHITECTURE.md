# Industrial ERP & Formulation System (Millennium Series)
## Technical Architecture & System Specification

This document provides a comprehensive technical overview of the full-stack architecture designed for the Industrial ERP, Formulation, and Standardization platform. It outlines the data schemas, backend endpoints, frontend component modularity, and physical-chemical formulation engines that power the system.

---

## 1. System Topology Overview

The application follows a full-stack monolithic architecture designed for containerized cloud deployment (Cloud Run, Docker) with local state synchronization.

```
+---------------------------------------------------------------------------------+
|                                 CLIENT PORTAL                                   |
|                        (React v18+ / Vite / Tailwind)                           |
+---------------------------------------------------------------------------------+
|   Management   |   BOM & OEE    |   Logbooks &   |  QA & Packing  |   Sales &   |
|   Dashboard    | Standards (D3) |   Shift Forms  |  Verification  |   Logistics |
+---------------------------------------------------------------------------------+
       |                                                                   ^
       | HTTP POST (Reactive State Sync)                                   | HTTP GET (JSON)
       v                                                                   |
+---------------------------------------------------------------------------------+
|                                 EXPRESS BACKEND                                 |
|                                (server.ts / tsx)                                |
+---------------------------------------------------------------------------------+
|             API Middleware             |             Vite Dev Proxy             |
+---------------------------------------------------------------------------------+
       |                                                                   ^
       | Read / Write                                                      | Auto-migration
       v                                                                   |
+---------------------------------------------------------------------------------+
|                                DATA PERSISTENCE                                 |
|                         (data.json / Flat-File Relational)                      |
+---------------------------------------------------------------------------------+
```

---

## 2. Full-Stack Data Persistence (`data.json`)

To ensure durable, persistent records across browser restarts and multiple client sessions, state is synchronized reactively with a flat-file JSON document database hosted on the server container.

### Relational Schema Layout

The `data.json` schema binds several manufacturing entities:

```json
{
  "customers": [],          // CRM Records (Customer Name, Code, Grade Requirements)
  "inquiries": [],          // Sales Inquiry pipeline and approval trackers
  "salesOrders": [],        // Active Commercial Dispatch orders matched with CRM
  "productionPlans": [],    // Allocated machine calendars, line outputs, and targets
  "templates": [],          // Schema definitions for Extrusion metrics
  "machineLogbooks": [],    // Real-time roll-by-roll extrusion shifts (Machine ID, operator)
  "inspections": [],        // QA dimensional audits (thickness, width, weight, tensile)
  "packingRecords": [],     // Final secondary packaging and barcoding records
  "inventory": [],          // Raw material silos (Resin) and finished goods store transactions
  "dispatches": [],         // Logistical truck dispatch ledgers (waybill, driver)
  "complaints": [],         // CRM Quality Complaints feedback loops
  "capas": [],              // Corrective & Preventive Action loop registers
  "recipes": [],            // Bill of Materials (BOM) formulas for compounds
  "maintenanceTasks": []    // Preventive Maintenance (PM) schedules and calibrations
}
```

---

## 3. API Routing Specifications

The backend (`server.ts`) exposes critical microservices and maps production-ready serving in an optimized runtime environment:

### Core Endpoints

*   **`GET /api/health`**
    *   *Purpose*: Readiness and Liveness probe for high-availability containers.
    *   *Response*: `{"status": "ok", "time": "2026-07-17T..."}`
*   **`GET /api/data`**
    *   *Purpose*: Fetches the entire compiled state database. On initial boot, the backend imports baseline standard configurations automatically to prevent empty states.
    *   *Response*: `JSON containing all relational ERP fields`
*   **`POST /api/data`**
    *   *Purpose*: Commits incremental state changes. Accepts full or partial payloads to update records.
    *   *Payload*: `{ "recipes": [...], "maintenanceTasks": [...] }`

---

## 4. Frontend Modular Architecture

The client side utilizes a highly structured, single-view reactive module switcher to isolate core concerns and prevent memory leakage during long shifts.

### Module Topology

1.  **`Dashboard.tsx`**: Management KPI hub utilizing customized `D3RadialProgress` rings to show live OEE rates, scrap waste metrics, line output capacities, and CRM approved order indexes.
2.  **`ManufacturingStandards.tsx`**: StandardizedWorldwide Industrial Formulation center. Isolates:
    *   *BOM Formulation & Normalization*: Scales feed elements to exact stoichiometric proportions ($100\%$).
    *   *D3 OEE Live Simulator*: Half-dial needle dashboard calculating:
        $$\text{OEE} = \text{Availability} \times \text{Performance} \times \text{Quality}$$
    *   *Predictive PM Ledger*: Coordinates extruder alignments, gearbox oil flushes, and die clearances.
3.  **`Planning.tsx`**: Gantt-style machine allocation calendars showing active/idle line capacities.
4.  **`Reports.tsx`**: Compiled shift logbooks mapped through custom `D3BarChart` (extruder throughputs), `D3DonutChart` (QA pass/fail ratios), and `D3LineChart` (interactive timeline trends).
5.  **`LogbookModule.tsx`**: Operator interface for submitting shift rolls, material inputs, and downtime alerts.
6.  **`QualityPacking.tsx`**: QA inspector panel tracking micron thickness deviation, tensile limits, and bubble cooling profiles.

---

## 5. Standardized Industrial Math Formulations

The architecture handles core manufacturing metrics using standardized equations:

### A. Overall Equipment Effectiveness (OEE)
$$\text{OEE} = A \times P \times Q$$
*   **Availability ($A$)**:
    $$A = \frac{\text{Actual Run Time}}{\text{Scheduled Production Time}}$$
*   **Performance ($P$)**:
    $$P = \frac{\text{Actual Output Mass (Kg)}}{\text{Ideal Theoretical Throughput Speed (Kg)}}$$
*   **Quality ($Q$)**:
    $$Q = \frac{\text{Conforming Material Weight}}{\text{Total Scrap + Conforming Material Weight}}$$

### B. Bill of Materials (BOM) Auto-Normalization
When adding custom chemical additives, fillers, or masterbatches, total proportions might deviate from exactly $100.0\%$. The system implements a proportion-scaling algorithm:
$$w_i' = \left( \frac{w_i}{\sum_{j=1}^{n} w_j} \right) \times 100$$
*Where $w_i$ is the raw portion feed, and $w_i'$ is the normalized stoichiometric ratio percentage.*

---

## 6. High-Contrast Interactive D3.js Engines

All charts (`D3Charts.tsx`) are hand-coded directly with the raw **D3.js** library, avoiding heavy standard wrappers and enabling beautiful CSS-injected vector SVG elements.

*   **D3BarChart**: Incorporates horizontal guideline grids, vertical linear-gradient defs, and custom tooltips with mouse coordinate tracking (`d3.pointer`).
*   **D3DonutChart**: Features radial sector expansion on hover (`d3.arc().outerRadius * 1.08`) and dynamic central text interpolation showing absolute value weights versus total batch sizes.
*   **D3LineChart**: Integrates continuous area opacity slopes, monotone curve calculations (`d3.curveMonotoneX`), dual-axis tracking (comparing primary outputs versus targets), and interactive vertical crosshair grids.
*   **D3GaugeChart**: High-precision half-dial needle dashboard. Renders red, amber, and green sectors, calculates trigonometric coordinates for the needle pointer, and handles smooth angular ease-in animations (`d3.easeCubicOut`).

---

## 7. Build, Bundling & Container Compatibility

The platform is designed to compile efficiently for high-performance production workloads.

```bash
# Developer Sandbox Startup
npm run dev

# Production Build Sequence
npm run build
```

The build sequence utilizes **Vite** to package highly optimized client-side assets under `dist/`, while **esbuild** compiles the full-stack server into a single standalone CommonJS bundle:
```bash
esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs
```
This ensures high-speed startup, avoids directory resolution path errors across execution runtimes, and remains perfectly compatible with secure container ports (`0.0.0.0:3000`).
