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
import { PrismaClient } from '@prisma/client';
import { ROLE_DEFAULT_SCREENS, ADMIN_ROLES } from '../src/lib/permissions';
import { hashPassword } from '../src/lib/password';
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
} from '../../src/mockData';

// Seeding is admin tooling: connect with the privileged owner role (like
// migrations) so TRUNCATE works and inserts aren't gated by RLS.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL } },
});

const DEMO_ORG_ID = 'org-demo';
/** Default password for every seeded user (override with SEED_USER_PASSWORD). */
const SEED_PASSWORD = process.env.SEED_USER_PASSWORD || 'mesadesk123';

const EMPLOYEES = [
  { id: 'u19', employeeCode: 'EMP-019', name: 'Vikram Malhotra', email: 'vikram.malhotra@masspolymer.in', department: 'Management', role: 'Owner', shift: 'D', line: '—', status: 'active', joinDate: '2015-01', location: 'Bengaluru', lastSeen: 'on shift now' },
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

const ALL_TABLES = [
  'Organization', 'User', 'Membership', 'Role', 'EmployeeGrant', 'Customer', 'Inquiry', 'SalesOrder', 'ProductionPlan', 'LogbookTemplate',
  'MachineLogbook', 'QualityInspection', 'InventoryTransaction', 'DispatchRecord', 'Complaint',
  'CAPARecord', 'Formulation', 'MaintenanceTask', 'Machine', 'AuditEvent',
  'Account', 'Session', 'VerificationToken',
];

async function main(): Promise<void> {
  console.log('[seed] clearing tables (TRUNCATE, RLS-immune)…');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);

  console.log('[seed] provisioning demo organization…');
  const org = await prisma.organization.create({
    data: { id: DEMO_ORG_ID, name: 'Mass Polimer (Demo Plant)', slug: 'demo', status: 'active', plan: 'enterprise', subscriptionStatus: 'active' },
  });
  const O = org.id;

  const passwordHash = await hashPassword(SEED_PASSWORD);
  console.log(`[seed] hashing passwords for ${EMPLOYEES.length} users (SEED_USER_PASSWORD)…`);
  await prisma.user.createMany({
    data: EMPLOYEES.map((e) => ({ id: e.id, email: e.email, name: e.name, passwordHash })),
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
    const roleIdByName = new Map((await tx.role.findMany({ where: { organizationId: O }, select: { id: true, name: true } })).map((r) => [r.name, r.id]));
    for (const e of EMPLOYEES) {
      await tx.membership.update({ where: { id: `mem-${e.id}` }, data: { roleId: roleIdByName.get(e.role) } });
    }

    await tx.customer.createMany({ data: withOrg(initialCustomers) });
    await tx.logbookTemplate.createMany({ data: withOrg(initialLogbookTemplates) });
    // Machines first — production plans and maintenance tasks reference them (FK).
    await tx.machine.createMany({ data: initialMachines.map((m) => ({ organizationId: O, code: m.id, line: m.line, family: m.family, logbookFormat: m.logbookFormat, status: m.status, statusReason: m.statusReason, currentProduct: m.currentProduct, currentFormula: m.currentFormula, currentLot: m.currentLot })) });
    const machineIdByCode = new Map((await tx.machine.findMany({ select: { id: true, code: true } })).map((m) => [m.code, m.id]));

    await tx.inquiry.createMany({ data: withOrg(keptInquiries) });
    await tx.salesOrder.createMany({ data: withOrg(keptOrders) });
    // Plans reference a real machine — resolve the seed's machine code → id.
    await tx.productionPlan.createMany({
      data: keptPlans.filter((p) => machineIdByCode.has(p.machineId)).map((p) => ({ ...p, organizationId: O, machineId: machineIdByCode.get(p.machineId)! })),
    });
    await tx.machineLogbook.createMany({ data: withOrg(keptLogbooks) });
    await tx.qualityInspection.createMany({ data: withOrg(initialQualityInspections) });
    await tx.inventoryTransaction.createMany({ data: withOrg(initialInventoryTransactions) });
    await tx.dispatchRecord.createMany({ data: withOrg(keptDispatches) });
    await tx.complaint.createMany({ data: withOrg(keptComplaints) });
    await tx.cAPARecord.createMany({ data: withOrg(initialCapaRecords) });
    await tx.formulation.createMany({ data: FORMULATIONS.map((f) => ({ ...f, organizationId: O })) });
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
