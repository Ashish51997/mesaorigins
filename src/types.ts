/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Customer {
  id: string;
  name: string;
  gstNumber: string;
  contactPerson: string;
  phone: string;
  email: string;
  billingAddress: string;
  deliveryAddress: string;
  paymentTerms: string;
  status: 'active' | 'inactive';
}

export interface Inquiry {
  id: string;
  inquiryNumber: string;
  customerId: string;
  product: string;
  drawingRef: string;
  quantity: number;
  expectedDeliveryDate: string;
  remarks: string;
  status: 'draft' | 'submitted' | 'approved' | 'quotation';
  attachment?: string; // filename of an attached drawing / spec sheet
  quotationPrice?: number;
  negotiationNote?: string;
  discountPercent?: number;
  originalPrice?: number;
}

export interface SalesOrder {
  id: string;
  soNumber: string;
  inquiryId: string;
  customerId: string;
  product: string;
  quantity: number;
  deliveryDate: string;
  priority: 'low' | 'medium' | 'high';
  specialInstructions: string;
  status: 'pending' | 'planned' | 'in_production' | 'inspected' | 'packed' | 'dispatched';
}

export interface ProductionPlan {
  id: string;
  salesOrderId: string;
  machineId: string;
  shift: 'D' | 'N'; // Day / Night — the plant runs two shifts
  operatorName: string;
  scheduledStartDate: string;
  scheduledEndDate: string;
  status: 'scheduled' | 'running' | 'completed';
}

export interface ZoneTargetSpec {
  zoneNumber: number;
  targetTemp: number;
  minTemp: number;
  maxTemp: number;
}

export interface DimensionSpec {
  id: string;
  name: string;
  unit: string;
  targetValue: string;
  minValue: string;
  maxValue: string;
}

export interface ProcessParamSpec {
  id: string;
  name: string;
  unit: string;
  target: number;
  min: number;
  max: number;
}

/* ------------------------------------------------------------------ *
 * Machine Log Book — faithful digital replica of paper QR/MFG/013 Rev 02.
 * The LogbookTemplate holds the printed constants / per-product specs;
 * the MachineLogbook holds the operator-entered values. Measurement cells
 * are stored as strings, matching the free-text paper cells (RangeCell
 * parses them for its permissible-range check). See SPEC_LOGBOOK.md.
 * ------------------------------------------------------------------ */

export interface DimensionSpecRange {
  label: string;   // e.g. "Top Dim"
  nominal: number; // printed nominal, e.g. 13.4
  tol: number;     // printed tolerance, e.g. 0.2
  lo: number;      // permissible low  (nominal - tol)
  hi: number;      // permissible high (nominal + tol)
}

export interface ThicknessSpec {
  label: string; // e.g. "Thickness"
  count: number; // number of thickness columns (reference: 3)
  lo: number;    // permissible low
  hi: number;    // permissible high
}

export interface CoilConfig {
  perM: number;      // "150 / M"
  targetKg: number;  // coil weight target, e.g. 7.8
  bobbinGms: number; // added bobbin grams, e.g. 140
  rangeLo: number;   // permissible low,  e.g. 7.945
  rangeHi: number;   // permissible high, e.g. 7.995
  count: number;     // number of coil-weight cells, e.g. 44
}

export interface LogbookTemplate {
  id: string;
  // document identity
  docNo: string;       // "QR/MFG/013"
  revNo: string;       // "02"
  revDate: string;     // "14-07-2025"
  brandName: string;   // "MASS POLYMERS"
  location: string;    // "BENGALURU"
  title: string;       // "MACHINE LOG BOOK"
  productName: string; // default product name
  // controlled vocabularies
  shifts: string[];      // ['A','B','C','D']
  supervisors: string[]; // staff names for the shift / inspector dropdowns
  // section 1 — process parameters
  lotNumberNote: string; // "Refer to QR/Store/022"
  dieZones: string[];    // ['Die 6','Die 5']
  barrelZones: string[]; // ['Zone 4','Zone 3','Zone 2','Zone 1']
  // optional per-zone temperature setpoints (label -> target/min/max °C); when present,
  // the sheet + panel flag a recorded temp that falls outside [min, max].
  zoneSpecs?: Record<string, { target: number; min: number; max: number }>;
  // section 2 — inspection report
  coil: CoilConfig;
  inspectionTimeSlots: string[]; // ['9–10','12–1','3–4','6–7','8–9']
  dimensionSpecs: {
    top: DimensionSpecRange;
    bottom: DimensionSpecRange;
    thickness: ThicknessSpec;
  };
  finishSpec: string;   // "Matt"
  perMeterSpec: string; // "52 gms"
  // section 3 — traceability (packing rolls)
  traceability: { tableCount: number; rowsPerTable: number };
  // section 4 — production report
  rejectionReasons: string[]; // 7 checklist labels
  notes: string[];            // NOTE 1 / NOTE 2 static text
  // layout family — 'coil' (roll/film, Shore A) or 'pipe' (Nos, Shore D). Drives
  // the sheet's inspection columns, traceability shape and production unit.
  layout?: 'pipe' | 'coil';
  hardnessType?: 'A' | 'D';
  productionUnit?: 'nos' | 'roll';
  packingNote?: string;       // "Packing 200 Nos" / "Packing 2 Rolls"
  pipeSpecs?: {
    od?: { label: string; nominal: number; tol: number; lo: number; hi: number };
    weight?: { label: string; nominal: number; lo: number; hi: number };
    length?: { lo: number; hi: number };
    dieSizerGap?: string;
  };
}

export interface HourlyInspectionRow {
  timeSlot: string;      // driven by template.inspectionTimeSlots
  // coil layout
  topDim?: string;
  bottomDim?: string;
  thickness?: string[];  // length = template.dimensionSpecs.thickness.count
  finish?: string;
  perMeter?: string;
  tearing?: string;
  // pipe layout
  od?: string;
  weight?: string;
  okNotOk?: string;
  // both
  colour: string;
  inspectionBy: string;
}

export interface TraceabilityRow {
  lotNumber: string;
  colour: string;
  code: string;
  winderPackedBy?: string; // coil layout
  pktKg?: string;          // pipe layout
  packedBy?: string;       // pipe layout
  // ERP-only, not rendered on the paper sheet: the Quality module sets this
  // per packed roll so the QC / packing / dispatch flow keeps working.
  qcStatus?: 'pending' | 'passed' | 'failed';
}

// A finished roll/spool registered against a shift logbook (old-logbook feature).
export interface RollRecord {
  rollNumber: string;
  weight: number;   // kg
  length: number;   // m
  winderBy: string;
  packedBy: string;
  status: 'pending' | 'passed' | 'failed';
}

export interface MachineLogbook {
  id: string;
  productionPlanId: string;
  templateId: string;
  status: 'draft' | 'submitted';
  // finished-roll register + sign-off (old-logbook features)
  rolls: RollRecord[];
  scrapKg: string;             // start-up / process scrap (kg)
  operatorSignature: string;   // operator name
  supervisorSignature: string; // shift supervisor name
  // id row
  machineId: string;  // labelled "Machine No" on the sheet
  date: string;
  shift: string;      // one of template.shifts (A–D)
  supervisor: string; // "Shift Supervisor"
  // section 1 — process parameters
  drawingNo: string;
  tag: string;
  formulaNo: string;
  dieZoneTemps: Record<string, string>;    // zone label -> value
  barrelZoneTemps: Record<string, string>; // zone label -> value
  motorSpeed: string;
  ampere: string;
  takeupSpeed: string;
  vacuum: string;
  extruderStartTime: string;
  productSetTime: string;
  shoreHardness: string;
  productionPerHour: string;
  moldNo: string;
  productName: string;
  // section 2 — inspection report
  coilWeights: string[]; // length = template.coil.count
  hourlyInspections: HourlyInspectionRow[];
  // section 3 — traceability
  traceabilityRows: TraceabilityRow[]; // length = tableCount * rowsPerTable
  // section 4 — production report
  totalRollsProduced: string;
  totalRollKgs: string;
  processWasteKg: string;
  lumpsWasteKg: string;
  rejectionKg: string;
  totalConsumedKg: string;
  rejectionCounts: Record<string, string>; // reason -> count
  meterCheckedBy: string;
  meterCheckTime: string;
  meter: string;
  meterCountSet: string;
  attachedImage?: string; // Base64 or path of uploaded scanned sheet
}

export interface QualityInspection {
  id: string;
  rollNumber: string;
  lotNumber: string;
  dimensions: Record<string, string>;
  finish: 'pass' | 'fail';
  weight: number;
  colour: 'pass' | 'fail';
  tearingTest: 'pass' | 'fail';
  remarks: string;
  decision: 'pass' | 'fail' | 'hold';
  inspectedBy: string;
  date: string;
}

export interface PackingRecord {
  id: string;
  rollNumber: string;
  weight: number;
  palletNumber: string;
  packingDate: string;
  packedBy: string;
  labelGenerated: boolean;
  qrCode: string;
}

export interface InventoryTransaction {
  id: string;
  type: 'raw_material' | 'finished_goods';
  direction: 'in' | 'out';
  itemCode: string;
  itemName: string;
  quantity: number;
  unit: string;
  lotNumber?: string;
  reference?: string;
  date: string;
  handler: string;
}

export interface DispatchRecord {
  id: string;
  invoiceNumber: string;
  salesOrderId: string;
  vehicleNumber: string;
  transporter: string;
  driverName: string;
  dispatchDate: string;
  deliveryAddress: string;
  etaDate: string;
  status: 'shipped' | 'delivered';
  communicationTriggered: boolean;
}

export interface CustomerComplaint {
  id: string;
  complaintNumber: string;
  customerId: string;
  batchNumber: string;
  product: string;
  description: string;
  photoUrl?: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'investigating' | 'resolved';
  rootCause?: string;
  resolution?: string;
  capaId?: string;
  date: string;
}

export interface CAPARecord {
  id: string;
  complaintId?: string;
  rejectionId?: string; // or machineLogbookId for production rejection
  rootCause: string;
  correctiveAction: string;
  preventiveAction: string;
  responsiblePerson: string;
  dueDate: string;
  status: 'open' | 'in_progress' | 'closed';
  closedDate?: string;
}

export interface BOMItem {
  id: string;
  name: string;
  portion: number; // percentage (0-100)
  unitCost: number; // cost per Kg in USD
}

export interface BOMRecipe {
  id: string;
  productName: string;
  standardYieldPortion: number; // e.g. 98.5%
  items: BOMItem[];
}

export interface MaintenanceTask {
  id: string;
  machineId: string;
  taskName: string;
  type: 'Preventive' | 'Calibration' | 'Overhaul';
  dueDate: string;
  frequency: 'Weekly' | 'Monthly' | 'Quarterly' | 'Semiannually';
  status: 'completed' | 'scheduled' | 'overdue';
  cost: number;
}

/* ------------------------------------------------------------------ *
 * Click-dummy data spine (SPEC_ERP_CLICKDUMMY.md): machine registry,
 * suppliers, and explicit batch lineages for the Batch Passport.
 * Lot format everywhere: DDMMYY·D/N·Mxx·Bnn  (D = Day, N = Night).
 * ------------------------------------------------------------------ */

export interface Machine {
  id: string;                 // 'M01'..'M09'
  line: string;               // e.g. 'LDPE / co-extrusion coil'
  family: 'LDPE' | 'PVC';
  logbookFormat: string;      // 'QR/MFG/012' | 'QR/MFG/013'
  status: 'running' | 'attention' | 'stopped';
  statusReason?: string;      // words shown for attention/stopped
  currentProduct?: string;
  currentFormula?: string;    // 'RF03' | 'SF13' | ...
  currentLot?: string;
}

export interface Supplier {
  id: string;
  name: string;               // invented Indian firms (not real companies)
  material: string;           // 'RPVC resin', 'LDPE granules', ...
  isReprocess?: boolean;
  acceptRatePct?: number;     // supplier quality score (no decimals)
}

export type LineageStage =
  | 'supplier' | 'incoming' | 'store_issue' | 'formulation'
  | 'production' | 'qa' | 'regrind' | 'pallet' | 'dispatch' | 'complaint';

export interface LineageField { label: string; value: string; mono?: boolean; }

export interface LineageStep {
  stage: LineageStage;
  title: string;              // sentence-case card title
  docFormat?: string;         // paper format label for the card
  when: string;               // human date/time
  by?: string;                // person
  status?: 'pass' | 'fail' | 'hold' | 'info';
  flag?: string;              // amber warning sentence (e.g. accepted without trial)
  fields: LineageField[];
}

export interface BatchLineage {
  id: string;
  lot: string;                // canonical entry lot number
  headline: string;           // product
  machineId: string;
  outcome: 'clean' | 'complaint';
  aliases: string[];          // roll ids, pallet, invoice, complaint no — all searchable
  siblings: string[];         // sibling lots (forward trace)
  parentLot?: string;         // regrind child → parent
  steps: LineageStep[];
}

