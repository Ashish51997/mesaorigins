/**
 * Legacy blob store (data.json) — carried over from the original server.ts.
 *
 * This backs the domains not yet migrated to Postgres. As each domain moves to
 * a real REST resource, its keys leave this store and this file shrinks; delete
 * it once every domain is migrated. Kept behaviourally identical to the old
 * server so the un-migrated frontend needs no changes during the transition.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  initialCustomers,
  initialInquiries,
  initialSalesOrders,
  initialProductionPlans,
  initialLogbookTemplates,
  initialMachineLogbooks,
  initialQualityInspections,
  initialPackingRecords,
  initialInventoryTransactions,
  initialDispatchRecords,
  initialCustomerComplaints,
  initialCapaRecords,
} from '../../../src/mockData';

const DATA_FILE_PATH = path.join(process.cwd(), 'data.json');

const initialRecipes = [
  { id: 'bom-1', productName: 'Grade-A Heavy Gauge Compounding', standardYieldPortion: 98.5, items: [
    { id: 'item-1', name: 'LLDPE Resin (Virgin)', portion: 65, unitCost: 1.45 },
    { id: 'item-2', name: 'HDPE Premium Polymer', portion: 20, unitCost: 1.6 },
    { id: 'item-3', name: 'Slip & Anti-block Agent', portion: 5, unitCost: 3.2 },
    { id: 'item-4', name: 'UV Stabilizer Complex', portion: 3, unitCost: 4.5 },
    { id: 'item-5', name: 'Carbon Black Masterbatch', portion: 7, unitCost: 1.8 },
  ] },
  { id: 'bom-2', productName: 'Eco-Poly Green Recycled Compound', standardYieldPortion: 95.0, items: [
    { id: 'item-6', name: 'Recycled LLDPE Flakes', portion: 75, unitCost: 0.85 },
    { id: 'item-7', name: 'Calcium Carbonate Filler', portion: 15, unitCost: 0.35 },
    { id: 'item-8', name: 'Green Pigment Concentrate', portion: 6, unitCost: 2.1 },
    { id: 'item-9', name: 'Antioxidant Heat Stabilizer', portion: 4, unitCost: 5.2 },
  ] },
  { id: 'bom-3', productName: 'Metallocene High-Clarity Stretch Film', standardYieldPortion: 99.0, items: [
    { id: 'item-10', name: 'Octene LLDPE Copolymer', portion: 60, unitCost: 1.75 },
    { id: 'item-11', name: 'Metallocene Plastomer', portion: 30, unitCost: 2.3 },
    { id: 'item-12', name: 'Tackifier Cling Masterbatch', portion: 10, unitCost: 3.8 },
  ] },
];

const initialMaintenanceTasks = [
  { id: 'pm-1', machineId: 'Extruder-01', taskName: 'Thermocouple Calibration & Die Zone Check', type: 'Calibration', dueDate: '2026-07-20', frequency: 'Monthly', status: 'scheduled', cost: 150 },
  { id: 'pm-2', machineId: 'Extruder-02', taskName: 'Gearbox Oil Flush & Bearing Inspection', type: 'Preventive', dueDate: '2026-07-12', frequency: 'Quarterly', status: 'overdue', cost: 450 },
  { id: 'pm-3', machineId: 'Extruder-04', taskName: 'Die Lips Clearance & Die Face Polishing', type: 'Overhaul', dueDate: '2026-07-14', frequency: 'Weekly', status: 'completed', cost: 300 },
  { id: 'pm-4', machineId: 'Extruder-03', taskName: 'Barrel Clearance & Heating Band Replacement', type: 'Preventive', dueDate: '2026-07-15', frequency: 'Semiannually', status: 'scheduled', cost: 850 },
];

function getInitialData(): Record<string, unknown> {
  return {
    customers: initialCustomers,
    inquiries: initialInquiries,
    salesOrders: initialSalesOrders,
    productionPlans: initialProductionPlans,
    templates: initialLogbookTemplates,
    machineLogbooks: initialMachineLogbooks,
    inspections: initialQualityInspections,
    packingRecords: initialPackingRecords,
    inventory: initialInventoryTransactions,
    dispatches: initialDispatchRecords,
    complaints: initialCustomerComplaints,
    capas: initialCapaRecords,
    recipes: initialRecipes,
    maintenanceTasks: initialMaintenanceTasks,
    permissions: [],
    aclRequests: [],
  };
}

function readStore(): Record<string, unknown> {
  try {
    if (fs.existsSync(DATA_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_FILE_PATH, 'utf-8'));
    }
    const defaults = getInitialData();
    fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  } catch (err) {
    console.error('[legacy] error reading data.json:', err);
    return {};
  }
}

function writeStore(data: Record<string, unknown>): void {
  try {
    fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[legacy] error writing data.json:', err);
  }
}

export const legacyDataRouter = express.Router();

legacyDataRouter.get('/', (_req, res) => {
  res.json(readStore());
});

legacyDataRouter.post('/', (req, res) => {
  try {
    const merged = { ...readStore(), ...(req.body ?? {}) };
    writeStore(merged);
    res.json({ success: true });
  } catch (err) {
    console.error('[legacy] error in POST /api/data:', err);
    res.status(500).json({ error: { code: 'internal', message: 'Failed to synchronize data.' } });
  }
});
