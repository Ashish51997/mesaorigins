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
  inquiries: 'sales', quotations: 'sales', orders: 'sales', sales_customers: 'sales', sales_complaints: 'sales',
  orders_to_plan: 'planning', plan_board: 'planning', formulations: 'planning', logbook_templates: 'planning',
  machine_tasks: 'planning',
  logbook_ledger: 'planning',
  roll_queue: 'quality', holds: 'quality',
  receive: 'stores', issue_lot: 'stores', rm_stock: 'stores',
  ready: 'dispatch', dispatch_history: 'dispatch',
  machines: 'maintenance', preventive: 'maintenance',
  users: 'admin', acl: 'admin',
};

export const stepOf = (id: string): string => STEP_OF[id] ?? 'overview';

// Group items into value-chain steps, keeping step order and dropping empty steps.
export function groupNav<T extends { id: string }>(items: T[]): { step: NavStep; items: T[] }[] {
  return NAV_STEPS
    .map((step) => ({ step, items: items.filter((it) => stepOf(it.id) === step.key) }))
    .filter((g) => g.items.length > 0);
}
