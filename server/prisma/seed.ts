/**
 * Seeds a demo tenant. Provisioning shape a real signup will follow:
 *   1. create an Organization
 *   2. create global Users + their Memberships (role) in that org
 *   3. insert the org's domain data (here, from the app's mock data)
 *
 * Idempotent: TRUNCATE (RLS-immune) then re-insert. Tenant rows go in inside a
 * transaction that sets `app.current_tenant`, so Postgres RLS accepts them. FK-
 * filters + de-duplicates the mock data (surfacing its dangling refs and the
 * duplicate sales orders the new per-tenant constraints reject).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ROLE_DEFAULT_SCREENS, ADMIN_ROLES } from '../src/lib/permissions';
import { hashPassword } from '../src/lib/password';
import { canonicalHash } from '../src/lib/canonical';
import {
  initialCustomers,
  initialInquiries,
  initialSalesOrders,
  initialProductionPlans,
  initialLogbookTemplates,
  initialMachineLogbooks,
  initialQualityInspections,
  initialInventoryTransactions,
  initialDispatchRecords,
  initialCustomerComplaints,
  initialCapaRecords,
  initialMachines,
} from '../../src/mesaops/mockData';

// Seeding is admin tooling: connect with the privileged owner role (like
// migrations) so TRUNCATE works and inserts aren't gated by RLS.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL } },
});

const DEMO_ORG_ID = 'org-demo';
const DEMO_MESAOPS_PLANT_ACCESS_ROLE_ID = `mesaops-plant-access-${createHash('md5').update(DEMO_ORG_ID).digest('hex')}`;
/** Default password for every seeded user (override with SEED_USER_PASSWORD). */
const SEED_PASSWORD = process.env.SEED_USER_PASSWORD || 'mesaorigins123';
const PRODUCT_OWNER_EMAIL = 'aroul303@gmail.com';
const PRODUCT_OWNER_PASSWORD = 'ashish123';

const EMPLOYEES = [
  { id: 'u19', employeeCode: 'EMP-019', name: 'Vikram Malhotra', email: 'vikram.malhotra@masspolymer.in', department: 'Management', role: 'Owner', shift: 'D', line: '—', status: 'active', joinDate: '2015-01', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u20', employeeCode: 'EMP-020', name: 'Aroul', email: 'aroul303@gmail.com', department: 'Product', role: 'Administrator', shift: 'D', line: '—', status: 'active', joinDate: '2026-08', location: 'Bengaluru', lastSeen: 'product owner' },
  { id: 'u1', employeeCode: 'EMP-001', name: 'Madan Lal', email: 'madan.lal@masspolymer.in', department: 'Management', role: 'Managing Director', shift: 'D', line: '—', status: 'active', joinDate: '2016-04', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u2', employeeCode: 'EMP-002', name: 'Deepak Bansal', email: 'deepak.bansal@masspolymer.in', department: 'Administration', role: 'Administrator', shift: 'D', line: '—', status: 'active', joinDate: '2018-07', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u3', employeeCode: 'EMP-003', name: 'Amit Verma', email: 'amit.verma@masspolymer.in', department: 'Sales', role: 'Sales Executive', shift: 'D', line: '—', status: 'active', joinDate: '2019-02', location: 'Bengaluru', lastSeen: 'today, 10:20' },
  { id: 'u4', employeeCode: 'EMP-004', name: 'Kavya Reddy', email: 'kavya.reddy@masspolymer.in', department: 'Sales', role: 'Sales Executive', shift: 'D', line: '—', status: 'active', joinDate: '2021-09', location: 'Bengaluru', lastSeen: 'today, 09:40' },
  { id: 'u5', employeeCode: 'EMP-005', name: 'Sneha Rao', email: 'sneha.rao@masspolymer.in', department: 'Production', role: 'Production Planner', shift: 'D', line: '—', status: 'active', joinDate: '2017-11', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u6', employeeCode: 'EMP-006', name: 'Latha Menon', email: 'latha.menon@masspolymer.in', department: 'Production', role: 'Production Planner', shift: 'D', line: '—', status: 'on_leave', joinDate: '2020-03', location: 'Bengaluru', lastSeen: '6 days ago' },
  { id: 'u7', employeeCode: 'EMP-007', name: 'Nandlal', email: 'nandlal@masspolymer.in', department: 'Production', role: 'Operator', shift: 'N', line: 'M08', status: 'active', joinDate: '2019-06', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u8', employeeCode: 'EMP-008', name: 'Ganesh Pai', email: 'ganesh.pai@masspolymer.in', department: 'Production', role: 'Operator', shift: 'N', line: 'M05', status: 'active', joinDate: '2022-01', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u9', employeeCode: 'EMP-009', name: 'Rohit Yadav', email: 'rohit.yadav@masspolymer.in', department: 'Production', role: 'Operator', shift: 'D', line: 'M03', status: 'inactive', joinDate: '2018-08', location: 'Bengaluru', lastSeen: 'left the company' },
  { id: 'u10', employeeCode: 'EMP-010', name: 'Nitesh Kumar', email: 'nitesh.kumar@masspolymer.in', department: 'Quality', role: 'Quality Inspector', shift: 'D', line: '—', status: 'active', joinDate: '2019-05', location: 'Bengaluru', lastSeen: 'today, 09:05' },
  { id: 'u11', employeeCode: 'EMP-011', name: 'Priya Nair', email: 'priya.nair@masspolymer.in', department: 'Quality', role: 'Quality Inspector', shift: 'D', line: '—', status: 'active', joinDate: '2021-04', location: 'Bengaluru', lastSeen: 'today, 07:55' },
  { id: 'u12', employeeCode: 'EMP-012', name: 'Farhan Ali', email: 'farhan.ali@masspolymer.in', department: 'Quality', role: 'Quality Inspector', shift: 'N', line: '—', status: 'on_leave', joinDate: '2020-10', location: 'Bengaluru', lastSeen: '2 days ago' },
  { id: 'u13', employeeCode: 'EMP-013', name: 'Ravi Shankar', email: 'ravi.shankar@masspolymer.in', department: 'Stores', role: 'Store Manager', shift: 'D', line: '—', status: 'active', joinDate: '2017-02', location: 'Bengaluru', lastSeen: 'today, 08:40' },
  { id: 'u14', employeeCode: 'EMP-014', name: 'Meena Kulkarni', email: 'meena.kulkarni@masspolymer.in', department: 'Stores', role: 'Store Manager', shift: 'D', line: '—', status: 'active', joinDate: '2022-06', location: 'Bengaluru', lastSeen: 'yesterday' },
  { id: 'u15', employeeCode: 'EMP-015', name: 'Pankaj Singh', email: 'pankaj.singh@masspolymer.in', department: 'Dispatch', role: 'Dispatch Executive', shift: 'D', line: '—', status: 'active', joinDate: '2019-12', location: 'Bengaluru', lastSeen: 'yesterday' },
  { id: 'u16', employeeCode: 'EMP-016', name: 'Salim Shaikh', email: 'salim.shaikh@masspolymer.in', department: 'Dispatch', role: 'Dispatch Executive', shift: 'N', line: '—', status: 'active', joinDate: '2021-07', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u17', employeeCode: 'EMP-017', name: 'Suresh Kumar', email: 'suresh.kumar@masspolymer.in', department: 'Maintenance', role: 'Maintenance Head', shift: 'D', line: '—', status: 'active', joinDate: '2016-09', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u18', employeeCode: 'EMP-018', name: 'Anil Kapoor', email: 'anil.kapoor@masspolymer.in', department: 'Maintenance', role: 'Maintenance Head', shift: 'N', line: '—', status: 'active', joinDate: '2020-05', location: 'Bengaluru', lastSeen: 'on shift now' },
];


// machineCode is resolved to the real Machine.id at seed time (see below).
const MAINTENANCE = [
  { machineCode: 'M01', taskName: 'Thermocouple Calibration & Die Zone Check', type: 'Calibration', dueDate: '2026-07-20', frequency: 'Monthly', status: 'scheduled', cost: 150 },
  { machineCode: 'M02', taskName: 'Gearbox Oil Flush & Bearing Inspection', type: 'Preventive', dueDate: '2026-07-12', frequency: 'Quarterly', status: 'overdue', cost: 450 },
  { machineCode: 'M04', taskName: 'Die Lips Clearance & Die Face Polishing', type: 'Overhaul', dueDate: '2026-07-14', frequency: 'Weekly', status: 'completed', cost: 300 },
  { machineCode: 'M03', taskName: 'Barrel Clearance & Heating Band Replacement', type: 'Preventive', dueDate: '2026-07-15', frequency: 'Semiannually', status: 'scheduled', cost: 850 },
];

function keep<T>(rows: T[], ok: (r: T) => boolean, label: string): T[] {
  const kept = rows.filter(ok);
  if (kept.length !== rows.length) console.warn(`[seed] ${label}: skipped ${rows.length - kept.length} row(s) with a missing parent reference.`);
  return kept;
}
function uniqueBy<T>(rows: T[], key: (r: T) => string, label: string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) { const k = key(r); if (seen.has(k)) continue; seen.add(k); out.push(r); }
  if (out.length !== rows.length) console.warn(`[seed] ${label}: dropped ${rows.length - out.length} duplicate row(s) violating a unique constraint.`);
  return out;
}

// Formulations (BOM) — coded RM-component recipes with revisions; the latest
// active revision is used on the line. RF03 Rev 1 is locked by a CAPA.
const FORMULATIONS = [
  { code: 'RF03', rev: 1, product: '007 SM RPVC010.C 11MM White', active: false, locked: true, lockReason: 'Locked by CAPA-012 (weight variation) — use Rev 2 instead.', capaId: 'CAPA-012',
    components: [{ name: 'RPVC resin', pct: 78, lotId: 'SVP·RPVC·2607·14' }, { name: 'CaCO3 filler', pct: 14, lotId: 'KM·CACO3·1907·02' }, { name: 'Stabilizer', pct: 5, lotId: 'AA·STB·1507·09' }, { name: 'Reprocess LDPE', pct: 3, lotId: 'DRP·LDPE·1707·03' }] },
  { code: 'RF03', rev: 2, product: '007 SM RPVC010.C 11MM White', active: true, locked: false, lockReason: '', capaId: null,
    components: [{ name: 'RPVC resin', pct: 80, lotId: 'SVP·RPVC·2607·14' }, { name: 'CaCO3 filler', pct: 14, lotId: 'KM·CACO3·1907·02' }, { name: 'Stabilizer', pct: 6, lotId: 'AA·STB·1507·09' }] },
  { code: 'SF13', rev: 1, product: '090 SM SPVC042 Z 150M Black', active: true, locked: false, lockReason: '', capaId: null,
    components: [{ name: 'SPVC resin', pct: 82, lotId: 'SVP·SPVC·2207·05' }, { name: 'CaCO3 filler', pct: 12, lotId: 'KM·CACO3·1907·02' }, { name: 'Stabilizer', pct: 6, lotId: 'AA·STB·1507·09' }] },
];

const IMM_FORM_ID = 'mesaleads-form-imm';
const IMM_QUESTIONS: Array<{
  key: string;
  type: string;
  label: string;
  helpText?: string;
  required?: boolean;
  options?: string[];
  visibilityRule?: Prisma.InputJsonValue;
}> = [
  { key: 'customer_details', type: 'section', label: 'Customer details' },
  { key: 'customer_name', type: 'short_text', label: 'Customer name', required: true },
  { key: 'contact_number', type: 'phone', label: 'Contact number', required: true },
  { key: 'email', type: 'email', label: 'Email address' },
  { key: 'company_name', type: 'short_text', label: 'Company name', required: true },
  { key: 'company_address', type: 'long_text', label: 'Company address' },
  { key: 'gstin', type: 'short_text', label: 'GSTIN' },
  { key: 'product_requirements', type: 'section', label: 'Product requirements' },
  { key: 'product_details', type: 'long_text', label: 'Product or item details', required: true },
  { key: 'polymer_material', type: 'short_text', label: 'Polymer or material and grade', required: true },
  { key: 'shot_weight', type: 'number', label: 'Product shot weight (grams)', required: true, helpText: 'Enter the complete moulded shot weight including runners.' },
  { key: 'product_dimensions', type: 'short_text', label: 'Product dimensions' },
  { key: 'target_output', type: 'number', label: 'Target production output per day' },
  { key: 'desired_timeline', type: 'date', label: 'Desired commissioning date' },
  { key: 'sample_upload', type: 'file', label: 'Drawing, sample or product photos', helpText: 'Upload a JPG, PNG or PDF up to 5 MB.' },
  { key: 'requirement_scope', type: 'single_select', label: 'Requirement scope', required: true, options: ['machine_only', 'machine_mold', 'mold_only'] },
  { key: 'mold_requirement', type: 'single_select', label: 'Mold requirement', required: true, options: ['existing_mold', 'new_mold'], visibilityRule: { questionKey: 'requirement_scope', operator: 'not_equals', value: 'machine_only' } },
  { key: 'mold_details', type: 'long_text', label: 'Mold dimensions, weight, cavities and drawing details', required: true, visibilityRule: { questionKey: 'requirement_scope', operator: 'not_equals', value: 'machine_only' } },
  { key: 'site_requirements', type: 'section', label: 'Factory and utilities' },
  { key: 'three_phase_power', type: 'yes_no', label: 'Is three-phase power available?', required: true },
  { key: 'factory_location', type: 'long_text', label: 'Factory location and available floor area', required: true },
  { key: 'connected_power', type: 'number', label: 'Total connected power (kW)' },
  { key: 'auxiliaries', type: 'multi_select', label: 'Required auxiliaries', options: ['Grinder', 'Hopper dryer', 'Material loader', 'MTC', 'Chiller', 'Other'] },
  { key: 'additional_notes', type: 'long_text', label: 'Additional requirements or notes' },
];

const ERP_PERMISSIONS = [
  ['mesaerp.legal_entity.manage', 'Manage legal entities', 'high'],
  ['mesaerp.vendor.read', 'View vendors', 'standard'],
  ['mesaerp.vendor.manage', 'Manage vendor lifecycle', 'sensitive'],
  ['mesaerp.vendor.bank.verify', 'Verify vendor bank changes', 'high'],
  ['mesaerp.sourcing.manage', 'Manage sourcing and RFQs', 'sensitive'],
  ['mesaerp.procurement.manage', 'Manage procurement', 'sensitive'],
  ['mesaerp.purchase.match', 'Approve three-way matches', 'high'],
  ['mesaerp.sales.manage', 'Manage sales documents', 'sensitive'],
  ['mesaerp.inventory.manage', 'Manage valued inventory', 'high'],
  ['mesaerp.manufacturing.manage', 'Manage manufacturing accounting', 'high'],
  ['mesaerp.mrp.manage', 'Manage manufacturing planning', 'high'],
  ['mesaerp.voucher.read', 'View accounting vouchers', 'standard'],
  ['mesaerp.voucher.create', 'Create accounting vouchers', 'sensitive'],
  ['mesaerp.voucher.edit', 'Edit draft vouchers', 'sensitive'],
  ['mesaerp.voucher.submit', 'Submit vouchers', 'sensitive'],
  ['mesaerp.voucher.approve', 'Approve vouchers', 'high'],
  ['mesaerp.voucher.post', 'Post vouchers', 'high'],
  ['mesaerp.voucher.reverse', 'Reverse posted vouchers', 'high'],
  ['mesaerp.banking.manage', 'Manage banking and reconciliation', 'high'],
  ['mesaerp.tax.manage', 'Manage tax and statutory documents', 'high'],
  ['mesaerp.asset.manage', 'Manage fixed assets', 'sensitive'],
  ['mesaerp.budget.manage', 'Manage budgets', 'sensitive'],
  ['mesaerp.reports.read', 'View financial reports', 'standard'],
  ['mesaerp.handoff.manage', 'Resolve service handoffs', 'high'],
  ['mesaerp.tds.manage', 'Manage TDS evidence', 'high'],
  ['mesaerp.access.manage', 'Manage MesaERP roles and access', 'high'],
  ['mesaerp.period.reopen', 'Reopen an accounting period', 'high'],
  ['mesaerp.account.manage', 'Manage chart of accounts', 'high'],
  ['mesaerp.period.manage', 'Close accounting periods', 'high'],
  ['mesaerp.intercompany.manage', 'Manage intercompany pairs', 'high'],
  ['mesaerp.consolidation.manage', 'Run consolidation reports', 'high'],
] as const;

const ERP_ACCOUNTS = [
  ['1000', 'Cash', 'asset'], ['1010', 'Bank', 'asset'], ['1100', 'Trade receivables', 'asset'],
  ['1200', 'Raw material inventory', 'asset'], ['1210', 'Work in progress', 'asset'],
  ['1220', 'Finished goods inventory', 'asset'], ['1300', 'GST input credit', 'asset'],
  ['2000', 'Trade payables', 'liability'], ['2010', 'Goods received not invoiced', 'liability'], ['2100', 'GST output payable', 'liability'],
  ['3000', 'Retained earnings', 'equity'], ['4000', 'Sales', 'income'],
  ['5000', 'Purchases and material consumption', 'expense'], ['5100', 'Cost of goods sold', 'expense'],
  ['5200', 'Direct labour', 'expense'], ['5300', 'Machine and factory overhead', 'expense'],
] as const;

const ALL_TABLES = [
  'ErpTdsDeduction', 'ErpVendorTdsClassification', 'ErpTdsRate', 'ErpTdsSection',
  'ErpPlantDispatchEvidence', 'ErpPlantQaEvidence', 'ErpHandoffInboxEvent', 'ErpHandoffEventRoute', 'ErpHandoffMapping',
  'ErpIdempotencyRecord', 'IntegrationInboxReceipt', 'IntegrationOutboxEvent', 'SourceLink',
  'ErpTransferProposal', 'ErpMrpSuggestion', 'ErpMrpRequirement', 'ErpMrpRun', 'ErpStockReservation',
  'ErpDemandForecast', 'ErpPlanningBomComponent', 'ErpPlanningBomRevision', 'ErpPlanningBom',
  'ErpTaxDocument', 'ErpBatchCost', 'ErpManufacturingVoucher', 'ErpProductionDemand',
  'ErpValuationConsumption', 'ErpValuationLayer', 'ErpInventoryCount', 'ErpPostingLink',
  'ErpStockMovement', 'ErpAssetEvent', 'ErpIntercompanyPair', 'ErpVoucherLine', 'ErpVoucher', 'ErpMatchCase', 'ErpDocumentLink',
  'ErpDocumentLine', 'ErpDocument', 'ErpNumberSeries', 'ErpBudget', 'ErpAsset',
  'ErpBankReconciliation', 'SupplierPortalUser', 'ErpVendorDocument', 'ErpVendorBankAccount',
  'ErpVendor', 'ErpCustomer', 'ErpItem', 'RoleAssignment', 'RolePermission', 'ApprovalPolicy',
  'Delegation', 'ErpWarehouse', 'ErpAccount', 'AccountingPeriod', 'FinancialYear', 'LegalEntity',
  'Permission', 'OperationalOrder',
  'Organization', 'Service', 'OrganizationService', 'User', 'Membership', 'Role', 'EmployeeGrant', 'Customer', 'Inquiry', 'SalesOrder', 'ProductionPlan', 'LogbookTemplate',
  'MachineLogbook', 'QualityInspection', 'InventoryTransaction', 'DispatchRecord', 'Complaint',
  'CAPARecord', 'Formulation', 'MaintenanceTask', 'Machine', 'AuditEvent',
  'LeadForm', 'LeadFormQuestion', 'LeadFormLink', 'MesaLead', 'LeadSubmission', 'LeadActivity', 'LeadAttachment',
  'Account', 'Session', 'VerificationToken',
];

async function main(): Promise<void> {
  console.log('[seed] clearing tables (TRUNCATE, RLS-immune)…');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);

  await prisma.service.createMany({
    data: [
      { id: 'mesaops', name: 'MesaPlant', description: 'Plan machines and shifts, execute, QA, move operational stock, and dispatch.', status: 'active', sortOrder: 10 },
      { id: 'mesaleads', name: 'MesaSell', description: 'Win the order — enquiry, technical review, quotation, and customer decision.', status: 'active', sortOrder: 20 },
      { id: 'mesaerp', name: 'MesaBook', description: 'Run the business books — procurement, valued inventory, costing, finance, and tax.', status: 'active', sortOrder: 30 },
    ],
  });
  await prisma.permission.createMany({
    data: ERP_PERMISSIONS.map(([key, label, riskLevel]) => ({
      id: key, serviceId: 'mesaerp', key, label, riskLevel,
    })),
  });

  console.log('[seed] provisioning demo organization…');
  const org = await prisma.organization.create({
    data: { id: DEMO_ORG_ID, name: 'MesaOrigins (Demo Plant)', slug: 'demo', status: 'active', plan: 'enterprise', subscriptionStatus: 'active' },
  });
  const O = org.id;
  await prisma.organizationService.createMany({
    data: [
      { organizationId: O, serviceId: 'mesaops' },
      { organizationId: O, serviceId: 'mesaleads' },
      { organizationId: O, serviceId: 'mesaerp' },
    ],
  });

  const defaultPasswordHash = await hashPassword(SEED_PASSWORD);
  const productOwnerHash = await hashPassword(PRODUCT_OWNER_PASSWORD);
  console.log(`[seed] hashing passwords for ${EMPLOYEES.length} users (SEED_USER_PASSWORD + onboarding owner override)…`);
  await prisma.user.createMany({
    data: EMPLOYEES.map((e) => ({
      id: e.id,
      email: e.email,
      name: e.name,
      passwordHash: e.email === PRODUCT_OWNER_EMAIL ? productOwnerHash : defaultPasswordHash,
    })),
  });
  await prisma.membership.createMany({
    data: EMPLOYEES.map((e) => ({
      id: `mem-${e.id}`, organizationId: O, userId: e.id, employeeCode: e.employeeCode, department: e.department,
      role: e.role, shift: e.shift, line: e.line, status: e.status, joinDate: e.joinDate, location: e.location, lastSeen: e.lastSeen,
    })),
  });

  // Kept sets (FK-filtered + de-duplicated), FK ids taken from what survives.
  const customerIds = new Set(initialCustomers.map((c) => c.id));
  const templateIds = new Set(initialLogbookTemplates.map((t) => t.id));
  const keptInquiries = uniqueBy(keep(initialInquiries, (i) => customerIds.has(i.customerId), 'inquiries(fk)'), (i) => i.inquiryNumber, 'inquiries(number)');
  const keptInquiryIds = new Set(keptInquiries.map((i) => i.id));
  const keptOrders = uniqueBy(uniqueBy(keep(initialSalesOrders, (o) => keptInquiryIds.has(o.inquiryId) && customerIds.has(o.customerId), 'salesOrders(fk)'), (o) => o.inquiryId, 'salesOrders(inquiryId)'), (o) => o.soNumber, 'salesOrders(soNumber)');
  const keptOrderIds = new Set(keptOrders.map((o) => o.id));
  const keptPlans = keep(initialProductionPlans, (p) => keptOrderIds.has(p.salesOrderId), 'productionPlans');
  const keptPlanIds = new Set(keptPlans.map((p) => p.id));
  const keptLogbooks = uniqueBy(keep(initialMachineLogbooks, (l) => keptPlanIds.has(l.productionPlanId) && templateIds.has(l.templateId), 'machineLogbooks(fk)'), (l) => l.productionPlanId, 'machineLogbooks(planId)');
  const keptDispatches = uniqueBy(keep(initialDispatchRecords, (d) => keptOrderIds.has(d.salesOrderId), 'dispatches(fk)'), (d) => d.invoiceNumber, 'dispatches(invoiceNumber)');
  const keptComplaints = uniqueBy(keep(initialCustomerComplaints, (c) => customerIds.has(c.customerId), 'complaints(fk)'), (c) => c.complaintNumber, 'complaints(number)');

  const withOrg = <T extends object>(rows: T[]) => rows.map((r) => ({ ...r, organizationId: O })) as never;

  console.log('[seed] inserting tenant data (RLS-armed transaction)…');
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${O}, true)`;

    // Dynamic RBAC: seed the built-in roles for this org, then link each membership.
    const roleNames = [...new Set(EMPLOYEES.map((e) => e.role))];
    await tx.role.createMany({
      data: roleNames.map((name) => ({
        organizationId: O, name, screens: ROLE_DEFAULT_SCREENS[name] ?? [], isAdmin: ADMIN_ROLES.has(name), isSystem: true,
      })),
    });
    await tx.role.create({
      data: {
        id: DEMO_MESAOPS_PLANT_ACCESS_ROLE_ID, organizationId: O,
        name: 'MesaOps Plant Access', screens: [], isAdmin: false, isSystem: true,
      },
    });
    await tx.role.create({
      data: {
        id: 'role-mesaerp-finance-admin', organizationId: O,
        name: 'MesaERP Finance Administrator', screens: [], isAdmin: false, isSystem: false,
      },
    });
    await tx.role.create({
      data: {
        id: 'role-mesaerp-platform-admin', organizationId: O,
        name: 'MesaERP Platform Administrator', screens: [], isAdmin: false, isSystem: true,
      },
    });
    const roleIdByName = new Map((await tx.role.findMany({ where: { organizationId: O }, select: { id: true, name: true } })).map((r) => [r.name, r.id]));
    for (const e of EMPLOYEES) {
      await tx.membership.update({ where: { id: `mem-${e.id}` }, data: { roleId: roleIdByName.get(e.role) } });
    }
    // Production plant access is assignment-driven. Seed active demo users
    // with the same explicit all-plant evidence and permissionless scope role
    // used by the additive migration; inactive/on-leave users remain unassigned
    // until an administrator deliberately grants a scope.
    await tx.roleAssignment.createMany({
      data: EMPLOYEES.filter((employee) => employee.status === 'active').map((employee) => ({
        id: `mesaops-seed-all-plant-${employee.id}`,
        organizationId: O,
        membershipId: `mem-${employee.id}`,
        roleId: DEMO_MESAOPS_PLANT_ACCESS_ROLE_ID,
        serviceId: 'mesaops',
        legalEntityId: null,
        plantCode: null,
        warehouseId: null,
        status: 'active',
      })),
    });

    const erpRoleId = 'role-mesaerp-finance-admin';
    const legalEntityId = 'entity-demo';
    const financialYearId = 'fy-demo-2026-27';
    await tx.legalEntity.create({
      data: {
        id: legalEntityId, organizationId: O, code: 'DEMO01', legalName: 'MesaOrigins Demo Manufacturing Private Limited',
        countryCode: 'IN', baseCurrency: 'INR', fiscalYearStartMonth: 4,
      },
    });
    await tx.role.update({ where: { id: erpRoleId }, data: { erpLegalEntityId: legalEntityId } });
    await tx.financialYear.create({
      data: {
        id: financialYearId, organizationId: O, legalEntityId, code: '2026-27',
        startsOn: new Date('2026-04-01T00:00:00.000Z'), endsOn: new Date('2027-03-31T00:00:00.000Z'),
      },
    });
    await tx.accountingPeriod.createMany({
      data: Array.from({ length: 12 }, (_, index) => {
        const startsOn = new Date(Date.UTC(2026, 3 + index, 1));
        const endsOn = new Date(Date.UTC(2026, 4 + index, 0));
        return {
          organizationId: O, legalEntityId, financialYearId, periodNumber: index + 1,
          name: startsOn.toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
          startsOn, endsOn,
        };
      }),
    });
    await tx.erpAccount.createMany({
      data: ERP_ACCOUNTS.map(([code, name, accountType]) => ({
        id: `erp-acct-${code}`, organizationId: O, legalEntityId, code, name, accountType, currency: 'INR',
        classification: code === '1000' ? 'cash' : code === '1010' ? 'bank' : code === '1100' ? 'receivable'
          : code === '2000' ? 'payable' : code === '3000' ? 'equity' : code === '4000' ? 'revenue'
            : code === '5100' ? 'cogs' : accountType === 'expense' ? 'operating_expense' : code.startsWith('12') ? 'inventory' : code.startsWith('13') || code.startsWith('21') ? 'tax' : 'other',
        cashFlowClass: code === '1000' || code === '1010' ? 'cash' : code.startsWith('12') || code.startsWith('11') || code.startsWith('20') || code.startsWith('4') || code.startsWith('5') ? 'operating' : 'non_cash',
        reconciliationRequired: code === '1010',
      })),
    });
    await tx.rolePermission.createMany({
      data: ERP_PERMISSIONS.map(([permissionId]) => ({
        organizationId: O, roleId: erpRoleId, permissionId, effect: 'allow',
      })),
    });
    await tx.rolePermission.create({
      data: {
        organizationId: O,
        roleId: 'role-mesaerp-platform-admin',
        permissionId: 'mesaerp.legal_entity.manage',
        effect: 'allow',
      },
    });
    await tx.roleAssignment.createMany({
      data: EMPLOYEES.filter((employee) => ['Owner', 'Administrator'].includes(employee.role)).map((employee) => ({
        organizationId: O, membershipId: `mem-${employee.id}`, roleId: erpRoleId,
        serviceId: 'mesaerp', legalEntityId,
      })),
    });
    const owner = EMPLOYEES.find((employee) => employee.role === 'Owner');
    if (owner) {
      await tx.roleAssignment.create({
        data: {
          organizationId: O,
          membershipId: `mem-${owner.id}`,
          roleId: 'role-mesaerp-platform-admin',
          serviceId: 'mesaerp',
        },
      });
    }
    await tx.approvalPolicy.create({
      data: {
        organizationId: O, legalEntityId, serviceId: 'mesaerp', action: 'voucher.approve', currency: 'INR',
        steps: [{ sequence: 1, permission: 'mesaerp.voucher.approve' }], allowSelfApproval: false,
      },
    });

    await tx.customer.createMany({ data: withOrg(initialCustomers) });
    await tx.logbookTemplate.createMany({ data: withOrg(initialLogbookTemplates) });
    // Machines first — production plans and maintenance tasks reference them (FK).
    await tx.machine.createMany({ data: initialMachines.map((m) => ({ organizationId: O, code: m.id, line: m.line, family: m.family, logbookFormat: m.logbookFormat, status: m.status, statusReason: m.statusReason, currentProduct: m.currentProduct, currentFormula: m.currentFormula, currentLot: m.currentLot })) });
    const machineIdByCode = new Map((await tx.machine.findMany({ select: { id: true, code: true } })).map((m) => [m.code, m.id]));

    await tx.inquiry.createMany({ data: withOrg(keptInquiries) });
    await tx.salesOrder.createMany({ data: withOrg(keptOrders) });
    await tx.operationalOrder.createMany({
      data: keptOrders.map((order) => ({
        id: order.id,
        organizationId: O,
        orderNumber: order.soNumber,
        sourceType: 'local_customer',
        sourceReference: order.soNumber,
        legacySalesOrderId: order.id,
        customerId: order.customerId,
        customerName: initialCustomers.find((customer) => customer.id === order.customerId)?.name ?? '',
        productName: order.product,
        quantity: String(order.quantity),
        uom: 'units',
        dueDate: /^\d{4}-\d{2}-\d{2}/.test(order.deliveryDate) ? new Date(`${order.deliveryDate.slice(0, 10)}T00:00:00.000Z`) : null,
        priority: order.priority,
        requirements: { specialInstructions: order.specialInstructions },
        originMetadata: { seededFrom: 'SalesOrder' },
        status: order.status === 'planned' ? 'planned' : order.status === 'dispatched' ? 'dispatched' : 'ready_to_plan',
      })),
    });
    // Plans reference a real machine — resolve the seed's machine code → id.
    await tx.productionPlan.createMany({
      data: keptPlans.filter((p) => machineIdByCode.has(p.machineId)).map((p) => ({
        ...p,
        organizationId: O,
        operationalOrderId: p.salesOrderId,
        plannedQuantity: String(keptOrders.find((order) => order.id === p.salesOrderId)?.quantity ?? 1),
        machineId: machineIdByCode.get(p.machineId)!,
      })),
    });
    await tx.machineLogbook.createMany({ data: withOrg(keptLogbooks) });
    await tx.qualityInspection.createMany({ data: withOrg(initialQualityInspections) });
    await tx.inventoryTransaction.createMany({ data: withOrg(initialInventoryTransactions) });
    await tx.dispatchRecord.createMany({
      data: keptDispatches.map((dispatch) => {
        const order = keptOrders.find((candidate) => candidate.id === dispatch.salesOrderId)!;
        const quantity = String(order.quantity);
        const evidenceSnapshot = {
          policy: 'seeded-legacy-dispatch:v1',
          historical: true,
          operationalOrderId: dispatch.salesOrderId,
          completedQuantity: quantity,
          packedQuantity: quantity,
          qaReleasedQuantity: quantity,
          previouslyDispatchedQuantity: '0',
          availableQuantity: quantity,
          dispatchQuantity: quantity,
        };
        return {
          ...dispatch,
          organizationId: O,
          operationalOrderId: dispatch.salesOrderId,
          gatePassNumber: `GP-${dispatch.id}`,
          quantity,
          uom: 'units',
          evidenceSnapshot,
          evidenceHash: canonicalHash(evidenceSnapshot),
          statutoryProfileVersion: 'MESAOPS-STATUTORY-BOOTSTRAP-1',
        };
      }),
    });
    await tx.complaint.createMany({ data: withOrg(keptComplaints) });
    await tx.cAPARecord.createMany({ data: withOrg(initialCapaRecords) });
    await tx.formulation.createMany({ data: FORMULATIONS.map((f) => ({ ...f, organizationId: O })) });
    await tx.leadForm.create({
      data: {
        id: IMM_FORM_ID,
        organizationId: O,
        familyKey: 'imm-requirement-questionnaire',
        name: 'IMM Requirement Questionnaire',
        description: 'Collect the product, mould, machine, factory and utility details needed to qualify an injection moulding enquiry.',
        status: 'draft',
      },
    });
    await tx.leadFormQuestion.createMany({
      data: IMM_QUESTIONS.map((question, sortOrder) => ({
        organizationId: O,
        formId: IMM_FORM_ID,
        key: question.key,
        type: question.type,
        label: question.label,
        helpText: question.helpText ?? '',
        required: question.required ?? false,
        options: question.options ?? [],
        ...(question.visibilityRule ? { visibilityRule: question.visibilityRule } : {}),
        sortOrder,
      })),
    });
    await tx.maintenanceTask.createMany({
      data: MAINTENANCE.map((t) => ({ organizationId: O, machineId: machineIdByCode.get(t.machineCode)!, taskName: t.taskName, type: t.type, dueDate: t.dueDate, frequency: t.frequency, status: t.status, cost: t.cost })),
    });

    const counts = {
      customers: await tx.customer.count(), inquiries: await tx.inquiry.count(), salesOrders: await tx.salesOrder.count(),
      productionPlans: await tx.productionPlan.count(), machineLogbooks: await tx.machineLogbook.count(), formulations: await tx.formulation.count(),
    };
    console.log('[seed] done — org', O, 'users', EMPLOYEES.length, counts);
  }, { timeout: 30000 });
}

main()
  .catch((err) => { console.error('[seed] failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
