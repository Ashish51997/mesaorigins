/**
 * plantData.ts — the shape the dashboard reads the plant through.
 *
 * These are deliberately minimal structural types rather than the strict domain
 * unions in types.ts. The API returns supersets with `status: string` (the
 * server carries states the client union never listed), so a dashboard typed
 * against the strict unions would need a cast at every boundary. Declaring only
 * the fields actually rendered means both the API shapes and the seeded records
 * satisfy these without casting, and adding a server field never breaks a build.
 *
 * Everything here is read-only: the dashboard shows work and hands off to the
 * screen that owns the change. It never writes.
 */

export interface DashCustomer {
  id: string;
  name: string;
}

export interface DashInquiry {
  id: string;
  inquiryNumber: string;
  customerId: string;
  status: string;
  expectedDeliveryDate: string;
}

export interface DashOrder {
  id: string;
  soNumber: string;
  customerId: string;
  product: string;
  quantity: number;
  deliveryDate: string;
  status: string;
}

export interface DashPlan {
  id: string;
  salesOrderId: string;
  machineId: string;
  shift: string;
  operatorName: string;
  status: string;
}

export interface DashRoll {
  rollNumber: string;
  weight: number;
  status: string;
}

/**
 * A shift log book. This is the only record that carries rejected weight and
 * its reasons, which is why Layer 2's Pareto is built from it.
 */
export interface DashLogbook {
  id: string;
  productionPlanId: string;
  machineId: string;
  date: string;
  shift: string;
  productName: string;
  status: string;
  rolls: DashRoll[];
  /** Stored as strings on the sheet, exactly as the paper form was filled in. */
  rejectionKg: string;
  totalRollKgs: string;
  rejectionCounts: Record<string, string>;
  meterCheckTime: string;
}

export interface DashInspection {
  id: string;
  rollNumber: string;
  lotNumber: string;
  decision: string;
  remarks: string;
  date: string;
}

export interface DashPacking {
  id: string;
  rollNumber: string;
  palletNumber: string;
  labelGenerated: boolean;
}

/** On-hand stock, as the inventory API reports it. */
export interface DashStockRow {
  itemName: string;
  onHand: number;
}

export interface DashDispatch {
  id: string;
  invoiceNumber: string;
  vehicleNumber: string;
  transporter: string;
  dispatchDate: string;
  status: string;
}

export interface DashComplaint {
  id: string;
  complaintNumber: string;
  customerId: string;
  batchNumber: string;
  description: string;
  severity: string;
  status: string;
  date: string;
}

export interface DashCapa {
  id: string;
  rootCause: string;
  correctiveAction: string;
  responsiblePerson: string;
  dueDate: string;
  status: string;
}

export interface DashMaintenance {
  id: string;
  machineId: string;
  type: string;
  dueDate: string;
  status: string;
}

export interface DashMachine {
  id: string;
  line: string;
  status: string;
  statusReason?: string | undefined;
  currentProduct?: string | undefined;
}

export interface DashFormula {
  id: string;
  code: string;
  rev: number;
  product: string;
  locked: boolean;
  lockReason: string;
  capaId: string | null;
}

/** Everything the dashboard layer reads, in one bag. */
export interface PlantData {
  customers: DashCustomer[];
  inquiries: DashInquiry[];
  salesOrders: DashOrder[];
  productionPlans: DashPlan[];
  machineLogbooks: DashLogbook[];
  inspections: DashInspection[];
  packingRecords: DashPacking[];
  rawMaterialStock: DashStockRow[];
  finishedGoodsStock: DashStockRow[];
  dispatches: DashDispatch[];
  complaints: DashComplaint[];
  capas: DashCapa[];
  maintenanceTasks: DashMaintenance[];
  machines: DashMachine[];
  formulations: DashFormula[];
}

/** Total on-hand across stock rows, ignoring negative corrections. */
export const totalOnHand = (rows: DashStockRow[]): number =>
  rows.reduce((sum, r) => sum + Math.max(0, r.onHand), 0);

/** An empty plant — what the dashboard renders against while queries load. */
export const EMPTY_PLANT: PlantData = {
  customers: [], inquiries: [], salesOrders: [], productionPlans: [], machineLogbooks: [],
  inspections: [], packingRecords: [], rawMaterialStock: [], finishedGoodsStock: [],
  dispatches: [], complaints: [], capas: [], maintenanceTasks: [], machines: [], formulations: [],
};
