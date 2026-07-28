/**
 * navGroups.ts — groups sidebar menu items into stepwise sections that follow the plant
 * value chain (Overview → Sales → Planning & Production → Quality → Stores → Dispatch →
 * Maintenance → Admin). Used by the sidebar to render group headers and by the menu
 * search to keep results ordered.
 *
 * Only real, rendered screens are listed here — placeholder / dummy route IDs are
 * intentionally omitted so Related links never jump to dead destinations.
 * Log books are opened from Machine Tasks only (not a sidebar destination).
 */

export interface NavStep { key: string; label: string; }

export const NAV_STEPS: NavStep[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'sales', label: 'Sales & Orders' },
  { key: 'planning', label: 'Planning & Production' },
  { key: 'quality', label: 'Quality' },
  { key: 'stores', label: 'Stores' },
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'admin', label: 'Admin & Reports' }
];

const STEP_OF: Record<string, string> = {
  dashboard: 'overview',
  inquiries: 'sales', quotations: 'sales', orders: 'sales', sales_customers: 'sales', sales_complaints: 'sales',
  orders_to_plan: 'planning', plan_board: 'planning', formulations: 'planning', logbook_templates: 'planning',
  machine_tasks: 'planning',
  roll_queue: 'quality', holds: 'quality',
  receive: 'stores', issue_lot: 'stores', rm_stock: 'stores',
  ready: 'dispatch', dispatch_history: 'dispatch',
  machines: 'maintenance', preventive: 'maintenance',
  users: 'admin', acl: 'admin',
};

export const stepOf = (id: string): string => STEP_OF[id] ?? 'overview';

// Curated cross-step relations that follow the actual workflow (order → plan, roll → hold,
// FG → dispatch, etc.). Same-step siblings are added automatically after these.
// Log books are not linked here — open them from Machine Tasks.
const CROSS: Record<string, string[]> = {
  inquiries: ['quotations'], quotations: ['orders'], orders: ['orders_to_plan'],
  sales_complaints: ['holds', 'orders'], sales_customers: ['orders'],
  orders_to_plan: ['orders', 'plan_board'], plan_board: ['machine_tasks'],
  formulations: ['issue_lot', 'rm_stock'],
  logbook_templates: ['plan_board', 'machine_tasks'],
  machine_tasks: ['plan_board'],
  roll_queue: ['holds'],
  holds: ['roll_queue', 'sales_complaints'],
  receive: ['rm_stock'], issue_lot: ['rm_stock', 'formulations'], rm_stock: ['issue_lot', 'receive'],
  ready: ['dispatch_history', 'rm_stock'], dispatch_history: ['ready'],
  machines: ['preventive', 'machine_tasks'],
  preventive: ['machines', 'machine_tasks'],
  users: ['acl'], acl: ['users'],
};

// Related features for a given screen: curated cross-links first, then same-step siblings.
export function relatedOf(id: string): string[] {
  const step = STEP_OF[id];
  const siblings = step ? Object.keys(STEP_OF).filter((x) => STEP_OF[x] === step && x !== id) : [];
  const out: string[] = [];
  for (const x of [...(CROSS[id] ?? []), ...siblings]) {
    if (x !== id && !out.includes(x) && STEP_OF[x]) out.push(x);
  }
  return out.slice(0, 6);
}

// Group items into value-chain steps, keeping step order and dropping empty steps.
export function groupNav<T extends { id: string }>(items: T[]): { step: NavStep; items: T[] }[] {
  return NAV_STEPS
    .map((step) => ({ step, items: items.filter((it) => stepOf(it.id) === step.key) }))
    .filter((g) => g.items.length > 0);
}
