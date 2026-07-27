/**
 * accessCatalog.ts — the single source of truth for what can be toggled.
 * FEATURES: every screen + high-stakes action, grouped by area, for the admin UI.
 * ROLE_DEFAULT_SCREENS: which screens each role sees by default (the "role preset").
 * Actions default to allowed (they live inside already-gated screens).
 */

import { Feature } from './accessTypes';

export const screenKey = (id: string): string => (id.startsWith('screen:') ? id : `screen:${id}`);
export const actionKey = (verb: string): string => (verb.startsWith('action:') ? verb : `action:${verb}`);
export const stripScreen = (key: string): string => key.replace(/^screen:/, '');

const S = (id: string, label: string, area: string): Feature => ({ key: `screen:${id}`, label, area, kind: 'screen' });
const A = (verb: string, label: string, area: string): Feature => ({ key: `action:${verb}`, label, area, kind: 'action' });

export const FEATURES: Feature[] = [
  // General
  S('dashboard', 'Home', 'General'),
  // Managing Director / exec
  S('plant_overview', 'Plant Overview', 'Managing Director'),
  S('quality_memory', 'Quality Memory', 'Managing Director'),
  S('management_review', 'Management Review', 'Managing Director'),
  S('reports', 'Reports & BI', 'Managing Director'),
  S('inventory', 'Inventory (stock)', 'Managing Director'),
  S('capa', 'CAPA & Complaints', 'Managing Director'),
  // Planning
  S('orders_to_plan', 'Orders to Plan', 'Planning'),
  S('plan_board', 'Plan Board', 'Planning'),
  S('formulations', 'Formulations', 'Planning'),
  S('machine_capacity', 'Machine Capacity', 'Planning'),
  S('material_availability', 'Material Availability', 'Planning'),
  A('order.plan', 'Plan an order onto a machine', 'Planning'),
  A('formula.edit', 'Edit a formulation', 'Planning'),
  // Operator
  S('hourly_grid', 'Hourly Log Grid', 'Operator'),
  S('raise_breakdown', 'Raise Breakdown', 'Operator'),
  S('shift_summary', 'Shift Summary', 'Operator'),
  A('reading.save', 'Save an hourly reading', 'Operator'),
  A('breakdown.raise', 'Raise a breakdown', 'Operator'),
  // Quality
  S('incoming', 'Incoming Inspection', 'Quality'),
  S('roll_queue', 'Roll Inspection Queue', 'Quality'),
  S('holds', 'Holds', 'Quality'),
  S('disposal_regrind', 'Disposal → Regrind', 'Quality'),
  S('calibration', 'Calibration Due', 'Quality'),
  A('qa.pass', 'Pass a roll', 'Quality'),
  A('qa.hold', 'Place a roll on hold', 'Quality'),
  A('qa.override', 'Override a QA verdict', 'Quality'),
  A('incoming.accept', 'Accept an incoming lot', 'Quality'),
  // Store
  S('receive', 'Receive Material', 'Stores'),
  S('issue_lot', 'Issue Lot', 'Stores'),
  S('rm_stock', 'RM Stock Board', 'Stores'),
  S('fg_putaway', 'FG Put-away', 'Stores'),
  S('regrind_lots', 'Regrind Lots', 'Stores'),
  A('lot.issue', 'Issue a lot to production', 'Stores'),
  A('fg.putaway', 'Put finished goods away', 'Stores'),
  A('pallet.release', 'Release a held pallet', 'Stores'),
  // Sales
  S('inquiries', 'Inquiries', 'Sales'),
  S('quotations', 'Quotations', 'Sales'),
  S('orders', 'Orders', 'Sales'),
  S('sales_customers', 'Customers', 'Sales'),
  S('sales_complaints', 'Complaints', 'Sales'),
  A('order.approve', 'Confirm an order to production', 'Sales'),
  A('order.setPriority', 'Set order priority', 'Sales'),
  // Dispatch
  S('ready', 'Ready to Dispatch', 'Dispatch'),
  S('gate_pass', 'Gate Pass', 'Dispatch'),
  S('vehicles_today', 'Vehicles Today', 'Dispatch'),
  S('dispatch_history', 'Dispatch History', 'Dispatch'),
  A('gatepass.release', 'Release a gate pass', 'Dispatch'),
  A('gatepass.print', 'Print a gate pass', 'Dispatch'),
  A('dispatch.mark', 'Mark an order dispatched', 'Dispatch'),
  // Maintenance
  S('breakdowns', 'Breakdowns', 'Maintenance'),
  S('preventive', 'Preventive Schedule', 'Maintenance'),
  S('downtime', 'Downtime Analytics', 'Maintenance'),
  S('machine_history', 'Machine History', 'Maintenance'),
  S('calibration_reg', 'Calibration Register', 'Maintenance'),
  A('breakdown.close', 'Close a breakdown', 'Maintenance'),
  // Records (the re-added modules)
  S('logbooks', 'Production Log Book', 'Records'),
  S('manufacturing', 'Manufacturing Standards', 'Records'),
  S('template_builder', 'Template Builder', 'Records'),
  A('logbook.edit', 'Edit the production log book', 'Records'),
  // Administration
  S('users', 'Employee Directory', 'Administration'),
  S('acl', 'Roles & Access', 'Administration'),
];

// The ~15 high-stakes actions wired first (§5). Others stay default-allow.
export const WIRED_ACTIONS: string[] = [
  'action:order.approve', 'action:order.setPriority', 'action:qa.pass', 'action:qa.hold',
  'action:qa.override', 'action:incoming.accept', 'action:lot.issue', 'action:pallet.release',
  'action:fg.putaway', 'action:gatepass.release', 'action:gatepass.print', 'action:dispatch.mark',
  'action:order.plan', 'action:logbook.edit', 'action:breakdown.close',
];

// Role preset: the screens each role sees by default (bare ids). Administrator = all.
export const ROLE_DEFAULT_SCREENS: Record<string, string[]> = {
  'Managing Director': ['dashboard', 'plant_overview', 'quality_memory', 'management_review', 'reports', 'inventory', 'capa', 'logbooks', 'manufacturing', 'template_builder'],
  'Production Planner': ['dashboard', 'orders_to_plan', 'plan_board', 'formulations', 'machine_tasks', 'logbooks', 'logbook_templates'],
  'Operator': ['dashboard', 'hourly_grid', 'raise_breakdown', 'shift_summary'],
  'Quality Inspector': ['dashboard', 'incoming', 'roll_queue', 'holds', 'disposal_regrind', 'calibration'],
  'Store Manager': ['dashboard', 'receive', 'issue_lot', 'rm_stock', 'fg_putaway', 'regrind_lots'],
  'Sales Executive': ['dashboard', 'inquiries', 'quotations', 'orders', 'sales_customers', 'sales_complaints'],
  'Dispatch Executive': ['dashboard', 'ready', 'gate_pass', 'vehicles_today', 'dispatch_history'],
  'Maintenance Head': ['dashboard', 'breakdowns', 'preventive', 'downtime', 'machine_history', 'calibration_reg'],
  'Administrator': ['dashboard', 'users', 'acl'],
};

// Which roles can be granted which extra screens by default lives per-employee; the
// three re-added modules default to Admin (all) + MD (above) only.
export function roleSeesScreenByDefault(role: string, screenId: string): boolean {
  if (role === 'Owner' || role === 'Administrator' || role === 'Admin' || role === 'Management') return true;
  const list = ROLE_DEFAULT_SCREENS[role];
  return list ? list.includes(screenId) : false;
}

export function featuresByArea(): { area: string; features: Feature[] }[] {
  const order: string[] = [];
  const map = new Map<string, Feature[]>();
  for (const f of FEATURES) {
    if (!map.has(f.area)) { map.set(f.area, []); order.push(f.area); }
    map.get(f.area)!.push(f);
  }
  return order.map((area) => ({ area, features: map.get(area)! }));
}
