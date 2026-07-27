/**
 * navGroups.ts — groups sidebar menu items into stepwise sections that follow the plant
 * value chain (Overview → Sales → Planning → Production → Quality → Stores → Dispatch →
 * Maintenance → Admin). Used by the sidebar to render group headers and by the menu
 * search to keep results ordered.
 */

export interface NavStep { key: string; label: string; }

export const NAV_STEPS: NavStep[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'sales', label: 'Sales & Orders' },
  { key: 'planning', label: 'Planning' },
  { key: 'production', label: 'Production' },
  { key: 'quality', label: 'Quality' },
  { key: 'stores', label: 'Stores' },
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'admin', label: 'Admin & Reports' }
];

const STEP_OF: Record<string, string> = {
  dashboard: 'overview', plant_overview: 'overview', management_review: 'overview', quality_memory: 'overview', reports: 'overview',
  customers: 'sales', sales: 'sales', inquiries: 'sales', quotations: 'sales', orders: 'sales', sales_customers: 'sales', sales_complaints: 'sales',
  planning: 'planning', orders_to_plan: 'planning', plan_board: 'planning', formulations: 'planning', machine_capacity: 'planning', material_availability: 'planning',
  manufacturing: 'production', logbooks: 'production', template_builder: 'production', hourly_grid: 'production', raise_breakdown: 'production', shift_summary: 'production',
  quality: 'quality', incoming: 'quality', roll_queue: 'quality', holds: 'quality', disposal_regrind: 'quality', calibration: 'quality',
  inventory: 'stores', receive: 'stores', issue_lot: 'stores', rm_stock: 'stores', fg_putaway: 'stores', regrind_lots: 'stores',
  dispatch: 'dispatch', ready: 'dispatch', gate_pass: 'dispatch', vehicles_today: 'dispatch', dispatch_history: 'dispatch',
  breakdowns: 'maintenance', preventive: 'maintenance', downtime: 'maintenance', machine_history: 'maintenance', calibration_reg: 'maintenance',
  users: 'admin', acl: 'admin', capa: 'admin', migration: 'admin'
};

export const stepOf = (id: string): string => STEP_OF[id] ?? 'overview';

// Curated cross-step relations that follow the actual workflow (order → plan, roll → hold,
// FG → dispatch, etc.). Same-step siblings are added automatically after these.
const CROSS: Record<string, string[]> = {
  inquiries: ['quotations'], quotations: ['orders'], orders: ['orders_to_plan'],
  sales_complaints: ['capa', 'holds'], sales_customers: ['orders'],
  orders_to_plan: ['orders', 'plan_board'], plan_board: ['machine_capacity', 'material_availability'],
  formulations: ['material_availability', 'issue_lot'], material_availability: ['rm_stock'],
  logbooks: ['roll_queue', 'template_builder', 'hourly_grid'], template_builder: ['logbooks'],
  hourly_grid: ['logbooks', 'raise_breakdown'], raise_breakdown: ['breakdowns'], shift_summary: ['logbooks'],
  incoming: ['rm_stock', 'receive'], roll_queue: ['holds', 'disposal_regrind', 'logbooks'],
  holds: ['disposal_regrind'], disposal_regrind: ['regrind_lots'], calibration: ['calibration_reg'],
  receive: ['rm_stock', 'incoming'], issue_lot: ['rm_stock', 'formulations'], rm_stock: ['issue_lot'],
  fg_putaway: ['ready'], regrind_lots: ['disposal_regrind'],
  ready: ['gate_pass', 'fg_putaway'], gate_pass: ['vehicles_today', 'dispatch_history'],
  vehicles_today: ['gate_pass'], dispatch_history: ['gate_pass'],
  breakdowns: ['machine_history', 'preventive'], preventive: ['machine_history', 'calibration_reg'],
  downtime: ['breakdowns', 'machine_history'], machine_history: ['breakdowns'], calibration_reg: ['calibration'],
  plant_overview: ['quality_memory', 'reports'], quality_memory: ['capa', 'reports'],
  management_review: ['reports'], reports: ['management_review'], capa: ['quality_memory', 'sales_complaints'],
  inventory: ['rm_stock', 'fg_putaway'], users: ['acl'], acl: ['users'], migration: ['reports']
};

// Related features for a given screen: curated cross-links first, then same-step siblings.
export function relatedOf(id: string): string[] {
  const step = STEP_OF[id];
  const siblings = step ? Object.keys(STEP_OF).filter((x) => STEP_OF[x] === step && x !== id) : [];
  const out: string[] = [];
  for (const x of [...(CROSS[id] ?? []), ...siblings]) {
    if (x !== id && !out.includes(x)) out.push(x);
  }
  return out.slice(0, 6);
}

// Group items into value-chain steps, keeping step order and dropping empty steps.
export function groupNav<T extends { id: string }>(items: T[]): { step: NavStep; items: T[] }[] {
  return NAV_STEPS
    .map((step) => ({ step, items: items.filter((it) => stepOf(it.id) === step.key) }))
    .filter((g) => g.items.length > 0);
}
