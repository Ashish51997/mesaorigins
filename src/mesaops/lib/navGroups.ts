/**
 * navGroups.ts — groups sidebar menu items into stepwise sections that follow the plant
 * value chain (Overview → Sales → Planning & Production → Quality → Stores → Dispatch →
 * Maintenance → Admin). Used by the sidebar to render group headers and by the menu
 * search to keep results ordered.
 *
 * Only real, rendered screens are listed here — placeholder / dummy route IDs are
 * intentionally omitted.
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
  sales_customers: 'sales', enquiry_desk: 'sales', inquiries: 'sales', quotations: 'sales', orders: 'sales', sales_complaints: 'sales',
  orders_to_plan: 'planning', plan_board: 'planning', formulations: 'planning', logbook_templates: 'planning',
  machine_tasks: 'planning',
  logbook_ledger: 'planning',
  roll_queue: 'quality', holds: 'quality',
  receive: 'stores', issue_lot: 'stores', rm_stock: 'stores',
  ready: 'dispatch', dispatch_history: 'dispatch',
  machines: 'maintenance', preventive: 'maintenance',
  users: 'admin', acl: 'admin',
};

/** Canonical within-group order (value chain). Unknown ids sort last. */
export const NAV_ITEM_ORDER: string[] = [
  'dashboard',
  'sales_customers', 'enquiry_desk', 'inquiries', 'quotations', 'orders', 'sales_complaints',
  'orders_to_plan', 'plan_board', 'formulations', 'logbook_templates', 'machine_tasks', 'logbook_ledger',
  'roll_queue', 'holds',
  'receive', 'issue_lot', 'rm_stock',
  'ready', 'dispatch_history',
  'machines', 'preventive',
  'users', 'acl',
];

const ORDER_INDEX = new Map(NAV_ITEM_ORDER.map((id, i) => [id, i]));

export const stepOf = (id: string): string => STEP_OF[id] ?? 'overview';

function byNavOrder<T extends { id: string }>(a: T, b: T): number {
  const ai = ORDER_INDEX.get(a.id) ?? Number.MAX_SAFE_INTEGER;
  const bi = ORDER_INDEX.get(b.id) ?? Number.MAX_SAFE_INTEGER;
  return ai - bi;
}

// Group items into value-chain steps, keeping step order and sorting items within each step.
export function groupNav<T extends { id: string }>(items: T[]): { step: NavStep; items: T[] }[] {
  return NAV_STEPS
    .map((step) => ({
      step,
      items: items.filter((it) => stepOf(it.id) === step.key).sort(byNavOrder),
    }))
    .filter((g) => g.items.length > 0);
}
