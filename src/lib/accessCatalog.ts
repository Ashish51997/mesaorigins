/**
 * accessCatalog.ts — the single source of truth for what can be toggled.
 * FEATURES: every screen + high-stakes action, grouped by area, for the admin UI.
 * ROLE_DEFAULT_SCREENS: which screens each role sees by default (the "role preset").
 * Actions default to allowed (they live inside already-gated screens).
 *
 * Only real, rendered screens are catalogued here — placeholder / dummy route IDs
 * have been removed. Keep in sync with server/src/lib/permissions.ts.
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
  // Planning & Production
  S('orders_to_plan', 'Orders to Plan', 'Planning & Production'),
  S('plan_board', 'Plan Board', 'Planning & Production'),
  S('formulations', 'Formulations', 'Planning & Production'),
  S('logbook_templates', 'Logbook Templates', 'Planning & Production'),
  S('machine_tasks', 'Machine Tasks', 'Planning & Production'),
  S('logbooks', 'Production Log Book (via Machine Tasks)', 'Planning & Production'),
  S('logbook_ledger', 'Logbook Ledger', 'Planning & Production'),
  A('order.plan', 'Plan an order onto a machine', 'Planning & Production'),
  A('formula.edit', 'Edit a formulation', 'Planning & Production'),
  A('reading.save', 'Save an hourly reading', 'Planning & Production'),
  A('logbook.edit', 'Edit the production log book', 'Planning & Production'),
  // Quality
  S('roll_queue', 'Roll Inspection Queue', 'Quality'),
  S('holds', 'Holds', 'Quality'),
  A('qa.pass', 'Pass a roll', 'Quality'),
  A('qa.hold', 'Place a roll on hold', 'Quality'),
  A('qa.override', 'Override a QA verdict', 'Quality'),
  // Store
  S('receive', 'Receive Material', 'Stores'),
  S('issue_lot', 'Issue Lot', 'Stores'),
  S('rm_stock', 'RM Stock Board', 'Stores'),
  A('lot.issue', 'Issue a lot to production', 'Stores'),
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
  S('dispatch_history', 'Dispatch History', 'Dispatch'),
  A('dispatch.mark', 'Mark an order dispatched', 'Dispatch'),
  // Maintenance
  S('machines', 'Machines', 'Maintenance'),
  S('preventive', 'Preventive Schedule', 'Maintenance'),
  A('breakdown.close', 'Close a breakdown', 'Maintenance'),
  // Administration
  S('users', 'Employee Directory', 'Administration'),
  S('acl', 'Roles & Access', 'Administration'),
];

// The high-stakes actions wired first. Others stay default-allow.
export const WIRED_ACTIONS: string[] = [
  'action:order.approve', 'action:order.setPriority', 'action:qa.pass', 'action:qa.hold',
  'action:qa.override', 'action:lot.issue',
  'action:dispatch.mark',
  'action:order.plan', 'action:logbook.edit', 'action:breakdown.close',
];

// Role preset: the screens each role sees by default (bare ids). Administrator = all.
// Mirrors server/src/lib/permissions.ts ROLE_DEFAULT_SCREENS.
export const ROLE_DEFAULT_SCREENS: Record<string, string[]> = {
  'Managing Director': ['dashboard', 'rm_stock', 'dispatch_history', 'logbook_ledger'],
  'Production Planner': ['dashboard', 'orders_to_plan', 'plan_board', 'formulations', 'machine_tasks', 'logbooks', 'logbook_templates', 'logbook_ledger'],
  'Operator': ['dashboard', 'machine_tasks', 'logbooks', 'logbook_ledger'],
  'Quality Inspector': ['dashboard', 'roll_queue', 'holds'],
  'Store Manager': ['dashboard', 'receive', 'issue_lot', 'rm_stock'],
  'Sales Executive': ['dashboard', 'inquiries', 'quotations', 'orders', 'sales_customers', 'sales_complaints'],
  'Dispatch Executive': ['dashboard', 'ready', 'dispatch_history'],
  'Maintenance Head': ['dashboard', 'machines', 'preventive'],
  'Administrator': ['dashboard', 'users', 'acl', 'logbooks', 'logbook_templates', 'machine_tasks', 'logbook_ledger'],
};

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
