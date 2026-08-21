/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { checkPermission } from '@mesaops/lib/aclUtils';
import { calculateOEE, calculateRecipeCost, calculateCompoundingYield, calculateTotalDowntime } from '@mesaops/lib/mfgUtils';
import { calculateStockLevel, filterTransactionsByType } from '@mesaops/lib/inventoryUtils';
import { evaluateRollDecision, generateQRMetadata, validateMachineParameters, validateDisposalMethod } from '@mesaops/lib/qaUtils';
import { isCAPAOverdue, getTargetResolutionDays } from '@mesaops/lib/complaintUtils';

import { PermissionRule, ACLRequest } from '@mesaops/lib/accessTypes';
import { BOMRecipe, InventoryTransaction } from '@mesaops/types';

interface TestResult {
  name: string;
  passed: boolean;
  module: string;
  error?: string;
}

const results: TestResult[] = [];

function assert(name: string, module: string, condition: boolean, message?: string) {
  if (condition) {
    results.push({ name, passed: true, module });
  } else {
    results.push({ name, passed: false, module, error: message || 'Assertion failed' });
  }
}

// ==========================================
// 1. ACL & ROLE SECURITY CLEARANCE TESTS
// ==========================================
function runAclTests() {
  const dummyPermissions: PermissionRule[] = [];
  const dummyRequests: ACLRequest[] = [];

  // Preset validations
  assert(
    "Management gets dashboard access by default",
    "Access Control",
    checkPermission("Management", "dashboard", "admin@masspolymer.com", dummyPermissions, dummyRequests) === true
  );

  assert(
    "Operator is blocked from planning module by default",
    "Access Control",
    checkPermission("Production Operator", "planning", "op@masspolymer.com", dummyPermissions, dummyRequests) === false
  );

  assert(
    "Production Planner gets access to planning by default",
    "Access Control",
    checkPermission("Production Planner", "planning", "plan@masspolymer.com", dummyPermissions, dummyRequests) === true
  );

  // Administrative Matrix Overrides
  const overridePermissions: PermissionRule[] = [
    { id: "Production Operator-planning", role: "Production Operator", module: "planning", allowed: true },
    { id: "Production Planner-planning", role: "Production Planner", module: "planning", allowed: false }
  ];

  assert(
    "Operator is allowed planning via administrator matrix override",
    "Access Control",
    checkPermission("Production Operator", "planning", "op@masspolymer.com", overridePermissions, dummyRequests) === true
  );

  assert(
    "Production Planner is denied planning via administrator matrix override",
    "Access Control",
    checkPermission("Production Planner", "planning", "plan@masspolymer.com", overridePermissions, dummyRequests) === false
  );

  // Temporary Bypass Requests
  const activeBypassRequests: ACLRequest[] = [
    {
      id: "req-1",
      userEmail: "op@masspolymer.com",
      displayName: "Amit Patel",
      requestedRole: "Production Operator",
      requestedModule: "planning",
      durationMinutes: 120,
      reason: "Urgent shift schedule change override",
      status: "approved",
      requestedAt: "2026-07-17T12:00:00"
    },
    {
      id: "req-2",
      userEmail: "op2@masspolymer.com",
      displayName: "John Doe",
      requestedRole: "Production Operator",
      requestedModule: "planning",
      durationMinutes: 120,
      reason: "Compounding adjustment",
      status: "pending",
      requestedAt: "2026-07-17T12:15:00"
    }
  ];

  assert(
    "Operator gets planning access via approved delegation bypass",
    "Access Control",
    checkPermission("Production Operator", "planning", "op@masspolymer.com", [], activeBypassRequests) === true
  );

  assert(
    "Operator remains blocked with pending delegation bypass",
    "Access Control",
    checkPermission("Production Operator", "planning", "op2@masspolymer.com", [], activeBypassRequests) === false
  );
}

// ==========================================
// 2. MANUFACTURING COMPOUNDING & OEE TESTS
// ==========================================
function runMfgTests() {
  // OEE Live values (Availability * Performance * Quality)
  assert(
    "Standard OEE computation",
    "Compounding & OEE",
    Math.abs(calculateOEE(92, 88, 99.2) - 80.3123) < 0.01,
    `Expected ~80.31%, got ${calculateOEE(92, 88, 99.2)}`
  );

  assert(
    "Perfect OEE computation",
    "Compounding & OEE",
    calculateOEE(100, 100, 100) === 100
  );

  assert(
    "Degraded OEE handles boundary zero values gracefully",
    "Compounding & OEE",
    calculateOEE(0, 85, 95) === 0
  );

  // Compound Bill of Material (BOM) Weighted average costing
  const testRecipe: BOMRecipe = {
    id: "bom-test",
    productName: "Compounded Polymer Grade X",
    standardYieldPortion: 98,
    items: [
      { id: "itm-1", name: "LLDPE Virgin Resin", portion: 70, unitCost: 1.50 },
      { id: "itm-2", name: "HDPE Premium", portion: 20, unitCost: 2.00 },
      { id: "itm-3", name: "Carbon Masterbatch", portion: 10, unitCost: 3.50 }
    ]
  };

  const expectedWeightedCost = (1.50 * 0.70) + (2.00 * 0.20) + (3.50 * 0.10); // 1.05 + 0.40 + 0.35 = 1.80
  assert(
    "Weighted average costing of polymer recipe BOM",
    "Compounding & OEE",
    Math.abs(calculateRecipeCost(testRecipe) - expectedWeightedCost) < 0.001,
    `Expected cost $1.80, got ${calculateRecipeCost(testRecipe)}`
  );

  // Dynamic Compound Yield calculation
  assert(
    "Compounding Material Yield",
    "Compounding & OEE",
    calculateCompoundingYield(1000, 985, 15) === 98.5,
    `Expected 98.5% yield, got ${calculateCompoundingYield(1000, 985, 15)}`
  );
}

// ==========================================
// 3. INVENTORY TRANSACTION LEDGER TESTS
// ==========================================
function runInventoryTests() {
  const dummyTransactions: InventoryTransaction[] = [
    {
      id: "tx-1",
      type: "raw_material",
      direction: "in",
      itemCode: "RM-POLY-01",
      itemName: "LLDPE Resin Grade H",
      quantity: 5000,
      unit: "Kgs",
      date: "2026-07-15",
      handler: "Store Manager"
    },
    {
      id: "tx-2",
      type: "raw_material",
      direction: "out",
      itemCode: "RM-POLY-01",
      itemName: "LLDPE Resin Grade H",
      quantity: 1200,
      unit: "Kgs",
      date: "2026-07-16",
      handler: "Operator"
    },
    {
      id: "tx-3",
      type: "finished_goods",
      direction: "in",
      itemCode: "FG-ROLL-12",
      itemName: "Finished 12mm Poly Roll",
      quantity: 150,
      unit: "Kgs",
      date: "2026-07-17",
      handler: "Inspector"
    }
  ];

  // Stock tracking balance verification
  assert(
    "Inventory tracking correctly adds received raw polymer",
    "Inventory Control",
    calculateStockLevel("RM-POLY-01", dummyTransactions, 0) === 3800,
    `Expected stock level 3800, got ${calculateStockLevel("RM-POLY-01", dummyTransactions, 0)}`
  );

  assert(
    "Inventory with non-zero initial stock level",
    "Inventory Control",
    calculateStockLevel("RM-POLY-01", dummyTransactions, 2000) === 5800,
    `Expected stock level 5800, got ${calculateStockLevel("RM-POLY-01", dummyTransactions, 2000)}`
  );

  // Transaction types grouping
  const rawMaterials = filterTransactionsByType(dummyTransactions, "raw_material");
  assert(
    "Filter transaction ledger by type: raw material",
    "Inventory Control",
    rawMaterials.length === 2 && rawMaterials.every(tx => tx.type === "raw_material")
  );
}

// ==========================================
// 4. QUALITY ASSURANCE INSPECTION TESTS
// ==========================================
function runQualityTests() {
  // Decision rules evaluation
  assert(
    "All passes yield approved QA certificate decision",
    "Quality Assurance",
    evaluateRollDecision("pass", "pass", "pass", true) === "pass"
  );

  assert(
    "Surface finish fail flags roll as rejected",
    "Quality Assurance",
    evaluateRollDecision("fail", "pass", "pass", true) === "fail"
  );

  assert(
    "Out-of-bound dimensions check flags roll as rejected",
    "Quality Assurance",
    evaluateRollDecision("pass", "pass", "pass", false) === "fail"
  );

  // Packing labels standard QR text pattern format
  const generatedQR = generateQRMetadata("R-LD-12B-001", 25.4, "LOT-901");
  assert(
    "Packing label contains exact standardized QR code format metadata",
    "Quality Assurance",
    generatedQR === "MPERP::R-LD-12B-001::WT:25.4::LOT:LOT-901",
    `Expected MPERP::R-LD-12B-001::WT:25.4::LOT:LOT-901, got: ${generatedQR}`
  );
}

// ==========================================
// 5. CUSTOMER COMPLAINTS & CAPA SLA TESTS
// ==========================================
function runComplaintTests() {
  // SLA days lookup
  assert(
    "High severity SLA triggers immediate 3-day turnaround limit",
    "SLA & CAPA Control",
    getTargetResolutionDays("high") === 3
  );

  assert(
    "Medium severity SLA triggers standard 10-day limit",
    "SLA & CAPA Control",
    getTargetResolutionDays("medium") === 10
  );

  assert(
    "Low severity SLA allows generous 30-day limit",
    "SLA & CAPA Control",
    getTargetResolutionDays("low") === 30
  );

  // Overdue corrective/preventive action verification
  assert(
    "CAPA preventive action plan flags overdue when target date expires",
    "SLA & CAPA Control",
    isCAPAOverdue("2026-07-15", "in_progress", "2026-07-16") === true
  );

  assert(
    "CAPA preventive action plan is not flagged overdue once closed",
    "SLA & CAPA Control",
    isCAPAOverdue("2026-07-15", "closed", "2026-07-16") === false
  );

  assert(
    "CAPA with future target date is safe",
    "SLA & CAPA Control",
    isCAPAOverdue("2026-07-20", "open", "2026-07-16") === false
  );
}

// ==========================================
// 6. NEW 11-STEP MANUFACTURING PROCESS PATHWAY TESTS
// ==========================================
function runNewFeaturesTests() {
  // In-line temperature and pressure bounds check
  assert(
    "In-line machine melt temp 200C and 4.2 bar water is stable",
    "11-Step Manufacturing",
    validateMachineParameters(200, 4.2) === true
  );

  assert(
    "In-line machine melt temp 150C (under-heated) is marked unstable",
    "11-Step Manufacturing",
    validateMachineParameters(150, 4.2) === false
  );

  assert(
    "In-line machine cooling pressure 7.5 bar (extreme) is marked unstable",
    "11-Step Manufacturing",
    validateMachineParameters(220, 7.5) === false
  );

  // Rejected scrap disposal method checks
  assert(
    "Scrap polymer disposal via Regrinded & Recycled with no approval required is approved",
    "11-Step Manufacturing",
    validateDisposalMethod("Regrinded & Recycled", false, false) === true
  );

  assert(
    "Contractor sale requires administrative approval check",
    "11-Step Manufacturing",
    validateDisposalMethod("Sold to Scrap Contractor", true, false) === false
  );

  assert(
    "Contractor sale with administrative sign-off passes",
    "11-Step Manufacturing",
    validateDisposalMethod("Sold to Scrap Contractor", true, true) === true
  );

  // Breakdown downtime hours calculation math check
  const testMaintenanceTasks = [
    { type: 'Preventive' as const, cost: 200 },
    { type: 'Breakdown' as const, downtimeHours: 4.5, cost: 1200 },
    { type: 'Calibration' as const, cost: 150 },
    { type: 'Breakdown' as const, downtimeHours: 2.2, cost: 350 }
  ];

  assert(
    "Aggregate shift downtime adds only sudden breakdown logs correctly",
    "11-Step Manufacturing",
    Math.abs(calculateTotalDowntime(testMaintenanceTasks) - 6.7) < 0.001,
    `Expected 6.7 hours, calculated ${calculateTotalDowntime(testMaintenanceTasks)}`
  );
}

// ==========================================
// MASTER TEST SUITE RUNNER
// ==========================================
export function runMasterTestSuite() {
  console.log("\x1b[36m=========================================");
  console.log("     MASS POLYMER ERP INTEGRATED TESTS   ");
  console.log("=========================================\x1b[0m");

  runAclTests();
  runMfgTests();
  runInventoryTests();
  runQualityTests();
  runComplaintTests();
  runNewFeaturesTests();

  const passedTests = results.filter(r => r.passed);
  const failedTests = results.filter(r => !r.passed);

  // Group by module for polished scannable reports
  const modules = Array.from(new Set(results.map(r => r.module)));
  
  modules.forEach(m => {
    console.log(`\n\x1b[35m[Module: ${m}]\x1b[0m`);
    results.filter(r => r.module === m).forEach(r => {
      if (r.passed) {
        console.log(`  \x1b[32m✅ PASSED\x1b[0m: ${r.name}`);
      } else {
        console.log(`  \x1b[31m❌ FAILED\x1b[0m: ${r.name} - Reason: ${r.error}`);
      }
    });
  });

  console.log("\n\x1b[36m=========================================");
  console.log("             TESTING SUMMARY             ");
  console.log("=========================================\x1b[0m");
  console.log(`  TOTAL TESTS EXECUTED : ${results.length}`);
  console.log(`  PASSED               : \x1b[32m${passedTests.length}\x1b[0m`);
  console.log(`  FAILED               : \x1b[31m${failedTests.length}\x1b[0m`);
  console.log("\x1b[36m=========================================\x1b[0m");

  if (failedTests.length > 0) {
    console.error("\x1b[31m⚠️  Integrated Suite Failure: Some critical pathways did not pass.\x1b[0m\n");
    process.exit(1);
  } else {
    console.log("\x1b[32m🎉 EXCELLENT! Every single business logic pathways, permissions presets, manufacturing math, QA metrics and SLAs are fully sound and valid!\x1b[0m\n");
    process.exit(0);
  }
}

// Execute test suite directly
runMasterTestSuite();
