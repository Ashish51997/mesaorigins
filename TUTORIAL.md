# Mass Polymer Industries ERP - Interactive User Tutorial
## Step-by-Step Operator, Planner, and Quality Inspector Handbook

Welcome to the **Mass Polymer ERP Enterprise Suite** user tutorial! This guide provides clear, practical instructions on how to use every single module and complete day-to-day operations. Whether you are an operator logging machine parameters or the Managing Director reviewing high-level KPI charts, this tutorial will walk you through the correct workflows.

---

## Table of Contents
1. [Module 1: The Login Portal & Profile Switching](#module-1-the-login-portal--profile-switching)
2. [Module 2: Management KPI Dashboard](#module-2-management-kpi-dashboard)
3. [Module 3: Commercial & CRM (Customers, Inquiries, Sales Orders)](#module-3-commercial--crm-customers-inquiries-sales-orders)
4. [Module 4: Master Production Scheduling (MPS)](#module-4-master-production-scheduling-mps)
5. [Module 5: Formulation & Standards (Recipes & PM Calibration)](#module-5-formulation--standards-recipes--pm-calibration)
6. [Module 6: Extrusion Machine Shift Logbooks](#module-6-extrusion-machine-shift-logbooks)
7. [Module 7: Quality Assurance Inspections & Secondary Packing](#module-7-quality-assurance-inspections--secondary-packing)
8. [Module 8: Warehouse Ledger & Inventory Control](#module-8-warehouse-ledger--inventory-control)
9. [Module 9: Gate Pass Logistics & Shipping dispatches](#module-9-gate-pass-logistics--shipping-dispatches)
10. [Module 10: Complaints, CAPA Tracking, & SLA Management](#module-10-complaints-capa-tracking--sla-management)
11. [Module 11: Security Overrides & Bypass Delegation (ACL Requests)](#module-11-security-overrides--bypass-delegation-acl-requests)

---

## Module 1: The Login Portal & Profile Switching

The ERP suite begins at the **Mass Polymer Intranet Gateway**. It isolates user tasks according to their real-world jobs.

### 💡 How to switch users:
1. **Using Preset Staff Profiles**:
   - In the **Select Corporate Profile** tab, you will see pre-configured profiles (e.g., *Madan Lal*, *Rajesh Kumar*, *Amit Patel*).
   - Click on any profile card. The terminal will log you in instantly with that user's specific access rights, email, and department context.
2. **Using Custom ID Sign-In**:
   - Click the **Custom ID Sign-In** tab.
   - Enter your name, corporate email address, and select your target department clearance level from the dropdown.
   - Click **Initialize Custom Session**.
3. **Connecting Administrative Google SSO**:
   - For administrators who want persistent cloud storage, click the **Connect Administrative Google SSO** button. This will open a standard secure popup.
4. **Logging Out / Switching**:
   - To sign out or change profiles instantly, click the high-visibility **🔄 Switch Staff** button in the top-right header, or click the **Exit / Sign Out** button in the sidebar. This drops you back to the Intranet Gateway for single-click operator switching.

---

## Module 2: Management KPI Dashboard

Designed primarily for **Madan Lal (MD)**, this module aggregates real-time plant statistics into highly interactive visual indicators.

### 📊 Key Visual Indicators:
* **Active OEE Gauge**: Monitors plant-wide efficiency. If OEE falls below $75\%$, it displays an amber or red warning.
* **Inspected Rolls Ratio**: A progress bar showing how many manufactured rolls have passed visual and thickness QA inspections.
* **Active Extrusion Lines**: Indicates how many of the 4 extrusion lines are currently running a scheduled job.
* **Interactive D3/Recharts Analytics**: View historical production tonnage, monthly sales figures, and defect distribution categories dynamically.

---

## Module 3: Commercial & CRM (Customers, Inquiries, Sales Orders)

This module handles raw pipeline demands. It is the primary workshop for **Neha Gupta (Sales)**.

### 📝 Step-by-Step Walkthrough:
1. **Onboard a New Customer**:
   - Open the **Customers & Inquiries** module.
   - Click **Add Customer**. Enter their corporate company name, contact email, phone number, GST registration number, and billing/delivery address.
   - Click **Save Customer**.
2. **Record a Sales Inquiry (RFQ)**:
   - Click on an onboarded customer's profile, then click **New Inquiry**.
   - Select the target Polymer Grade (e.g., *Grade A Heavy Duty*, *Grade B Standard*).
   - Input the desired roll quantity (in units/Kgs) and desired delivery date.
   - Click **Create Inquiry**. It will start as a `draft`.
3. **Approve a Quotation**:
   - Review the inquiry. Once pricing calculations are finalized, click **Issue Quotation**. This shifts its status to `quotation`.
4. **Generate a formal Sales Order (SO)**:
   - Click **Convert to Sales Order** on any approved quotation. This creates a high-priority work order in the master production queue.

---

## Module 4: Master Production Scheduling (MPS)

Operated by **Rajesh Kumar (Planner)**, this screen coordinates active floor capacity with pending sales orders.

### 📅 Step-by-Step Walkthrough:
1. Navigate to **Production Planning**.
2. Locate the list of **Pending Orders** on the left panel.
3. Click **Schedule Order** on any pending customer demand.
4. Fill in the **Allocation parameters**:
   - Select the target Extrusion Line (Line 1 to Line 4).
   - Assign the lead Shift Operator (e.g., *Amit Patel*).
   - Pick the shift window (Shift A: Morning, Shift B: Evening, Shift C: Night).
   - Specify start and end calendar dates.
5. Click **Confirm Allocation**. The Sales Order will now transition to `planned`, and a visual scheduling card will appear in the Gantt layout.

---

## Module 5: Formulation & Standards (Recipes & PM Calibration)

Ensures that chemical mixtures and physical machines are calibrated precisely to avoid quality rejects.

### 🧪 Formulation (Bill of Materials):
1. Navigate to **Formulation & Standards**.
2. Under **Recipes**, you can view or modify polymer standard mixtures.
3. To add a new formulation, click **New Recipe**.
4. Input ingredients (such as *LLDPE Resin*, *HDPE Resin*, *Carbon Black Masterbatch*).
5. Specify the target **percentage portions**. If they do not add up to exactly $100\%$, the system's normalization engine will adjust them automatically!
6. Click **Save Recipe**. The calculated weighted average compounding cost per Kg will appear on the card instantly.

### 🔧 Preventive Maintenance (PM Calibrations):
1. Navigate to the **PM Scheduler** tab.
2. View scheduled calibration intervals, periodic die face polishing, and overhaul schedules.
3. Enter machine parameters, planned target date, and estimated maintenance budget to schedule ahead.

### 🚨 Breakdown Maintenance (Emergency Repetition Log):
1. When sudden machinery halts or failures occur (e.g., pressure transducer rupture or belt snap), select **🚨 Sudden Breakdown** as the Service Type.
2. Input the exact **Halt Date** and associated maintenance repair costs.
3. Detail **Downtime Duration** (in hours) and the precise **Corrective Action taken** to restore production to stable limits.
4. Saving a breakdown automatically logs it into the Industrial Machine Service Ledger as completed, keeping an audit trail of corrective maintenance.

---

## Module 6: Extrusion Machine Shift Logbooks

Designed for **Amit Patel (Operator)** on the shop floor. This screen acts as a regulatory checklist for every running extruder line.

### ✍️ Shift Logging Workflow:
1. Navigate to **Machine Logbooks**.
2. Select your assigned Extrusion Line (Line 1 - Line 4).
3. Click **Start New Shift Logbook**.
4. Enter the active **Lot Number**, starting polymer raw material weights, and the supervising coordinator's name.
5. **Record Hourly Parameters**:
   - Every hour, click **Log Hourly Parameter**.
   - Input Zone Temperatures (Zone 1 through Zone 4, in $^\circ\text{C}$), motor speed (RPM), and die pressure (PSI). This keeps a stable profile of extruder performance.
6. **Log Manufactured Rolls**:
   - Every time a full roll is wound, click **Log New Roll Output**.
   - Input the roll weight (in Kgs) and surface length (meters).
7. **Complete Shift & Yield Calculation**:
   - At the end of the shift, click **Close Shift Logbook**.
   - Input the final scrap weight (in Kgs).
   - The system automatically computes and displays the **Material Yield %** to monitor material losses.

---

## Module 7: Quality Assurance Inspections & Secondary Packing

Operated by **Sunita Sharma (QA Inspector)**. No roll can leave the factory floor without passing this gate.

### 📋 The 4-Tab Quality System:
This module is structured into four distinct workflow panels:
1. **📏 In-line Inspection**: Real-time hourly machine parameters checklist. Inspectors verify extruder melt temperature (160-240°C) and water pressure (2-6 bar) stability.
2. **🔍 Pending QA Inspections**: Standard visual, color-match, dimension, and elongation tearing tests for manufactured rolls.
3. **📦 Secondary Packing & Palletizing**: Bundling certified rolls into pallets, generating secondary labels with immutable QR metadata codes.
4. **♻️ Rejected Material Disposal**: Logging and tracking scrap material disposal methods ('Regrinded & Recycled', 'Sold to Scrap Contractor', 'Safely Landfilled') with administrative clearance tags.

### 🔍 Quality Audit Steps:
1. Navigate to **Quality & Packing** and select **Pending QA Inspections**.
2. Under the queue, you will see a list of rolls recorded by shop-floor operators.
3. Click **Audit Roll** on any pending roll.
4. Input the measured quality parameters:
   - **Dimensional Tolerances**: Select whether the micron thickness and width fall within ISO tolerances (Pass / Fail).
   - **Surface Finish**: Verify visual surface defects (No visual blemishes).
   - **Colour Match**: Confirm standard dye consistency.
   - **Mechanical Tearing Test**: Check resistance to elongation.
5. Click **Submit Inspection Certificate**:
   - If all parameters pass, the roll is certified as `pass` and made available for inventory storage.
   - If any metric fails, the roll is marked as `fail` or placed on `hold` to prevent shipment.
6. **Secondary Packing & Palletizing**:
   - Select passed rolls and assign them to a transport pallet.
   - Click **Generate Label**. The screen will generate a high-contrast package slip containing an **immutable QR metadata barcode** containing weight and lot statistics.

---

## Module 8: Warehouse Ledger & Inventory Control

Managed by **Vikram Singh (Store Manager)**. Tracks physical polymer stocks from raw resin silos to finished products.

### 📦 Inventory Ledger Steps:
1. Navigate to **Inventory Control**.
2. **Log Raw Material Deliveries**:
   - When a shipping truck delivers new polymer resins, click **Log Transaction**.
   - Select **Raw Material**, set the direction to **IN**, input the item code, and quantity in Kgs. This increments your raw stock buffer.
3. **Log Shop-Floor Material Issuance**:
   - When compounding operators draw material from the silos, log a transaction with direction **OUT** to deduct the material.
4. **Reconcile Stock Balances**:
   - Scroll through the real-time Ledger Table to trace every resin shipment and finished roll transaction. The ledger automatically sums transaction values to keep a correct count of current inventory.

---

## Module 9: Gate Pass Logistics & Shipping Dispatches

Operated by **Sanjay Verma (Dispatch Executive)**. Coordinates external shipping carriers and tracks delivery ETAs.

### 🚚 Shipping Steps:
1. Navigate to **Dispatch Module**.
2. Select **Pending Orders** ready for shipment.
3. Click **Prepare Gate Pass & Dispatch**.
4. Enter logistics parameters:
   - Transporter Name & Carrier Vehicle License Number.
   - Driver Name and mobile contact.
   - Invoice Reference Code.
   - Estimated Date of Arrival (ETA).
5. Click **Issue Gate Pass**. The gate pass is printed, the record shifts to `shipped`, and the sales order updates automatically.

---

## Module 10: Complaints, CAPA Tracking, & SLA Management

Handles buyer issues and ensures the QA team follows up with corrective actions.

### ⚠️ SLA & Quality Improvement Flow:
1. Navigate to **Complaints & CAPAs**.
2. **Log Customer Complaint**:
   - When a buyer reports a defect, click **Log Complaint**.
   - Input the customer, related sales order, defect type, and assign a severity level (Low, Medium, or High).
   - The system automatically starts an **SLA Resolution Clock** (3 Days for High, 10 Days for Medium, 30 Days for Low).
3. **Formulate a CAPA (Corrective & Preventive Action) Plan**:
   - Click **Link to CAPA** on an active complaint.
   - Input the corrective actions (e.g., *Re-calibrating Line 2 extruder zone 3 heaters*) and preventive actions (e.g., *Installing dual thermocouples*).
   - Assign a target implementation date. If this date passes without the CAPA status changing to `closed`, the system highlights it as **Overdue** to notify the executive board.

---

## Module 11: Security Overrides & Bypass Delegation (ACL Requests)

What happens when an Operator needs to view a Sales Order or a Sales Executive needs to look up a recipe cost? This module manages secure temporary delegations.

### 🛡️ Step-by-Step Bypass Steps:
1. **Submit a Bypass Request (As a standard user)**:
   - If you click on a module and get a "Permission Denied" alert, locate the **Request Temporary Access** form.
   - Select the module you need temporary access to.
   - Enter the reason for access and the requested duration in minutes.
   - Click **Submit Bypass Request**.
2. **Approve / Reject the Request (As Madan Lal - MD)**:
   - Log in as **Madan Lal**.
   - Navigate to the **ACL Management** screen (shield icon in sidebar).
   - Here, you will see a live grid of **Bypass Delegation Logs**.
   - Click **Approve** or **Reject** on any pending request.
   - Once approved, the operator's access will instantly be activated on their terminal!
3. **Change Permissions Permanently**:
   - On the same **ACL Management** screen, Madan Lal can adjust the permanent role matrix directly.
   - Click the checkmarks under each role column to toggle access permissions permanently. Changes save immediately to our remote Firestore database.

---

*This concludes the Mass Polymer ERP User Tutorial. If you encounter any bugs, run `npm test` from your system terminal to verify the integrity of all mathematical calculations and system pathways.*
