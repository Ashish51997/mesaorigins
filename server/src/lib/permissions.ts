/**
 * Server-side authorization policy — the source of truth.
 *
 * Mirrors src/lib/accessCatalog.ts (ROLE_DEFAULT_SCREENS) so the client `can()`
 * is only a UX hint while the server actually enforces access. Keep the two in
 * sync until this is extracted into a package both import.
 *
 * Screens: a role may open a screen if it's in that role's default set (or the
 * role is an admin). Actions: gated by the screen they live on (matching the
 * client's "actions default to allowed inside a gated screen"), so e.g. an
 * Operator cannot POST an order approval even though the action isn't a screen.
 */

// Default screens per built-in role — mirrors the surviving (real) app screens.
// Seeds the tenant Role rows; admins get everything regardless (isAdmin).
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

// Roles that implicitly see everything. 'Owner' is the top-level superuser:
// full access to every screen and action across the whole application. These
// seed as isAdmin=true Roles; the effective check below reads isAdmin from the DB.
export const ADMIN_ROLES = new Set(['Owner', 'Administrator', 'Admin', 'Management']);

// Each high-stakes action → the screen it lives on. A role may perform the
// action only if it may open that screen. (Mirrors accessCatalog WIRED_ACTIONS.)
const ACTION_SCREEN: Record<string, string> = {
  'order.approve': 'orders',
  'order.setPriority': 'orders',
  'order.plan': 'plan_board',
  'formula.edit': 'formulations',
  'reading.save': 'logbooks',
  'breakdown.raise': 'machine_tasks',
  'qa.pass': 'roll_queue',
  'qa.hold': 'roll_queue',
  'qa.override': 'roll_queue',
  'incoming.accept': 'receive',
  'lot.issue': 'issue_lot',
  'fg.putaway': 'rm_stock',
  'pallet.release': 'ready',
  'gatepass.release': 'ready',
  'gatepass.print': 'ready',
  'dispatch.mark': 'ready',
  'logbook.edit': 'logbooks',
  'breakdown.close': 'preventive',
};

export function roleAllowsScreen(role: string, screenId: string): boolean {
  if (ADMIN_ROLES.has(role)) return true;
  if (screenId === 'dashboard') return true; // Home is always available
  return (ROLE_DEFAULT_SCREENS[role] ?? []).includes(screenId);
}

/**
 * featureKey is 'screen:<id>' or 'action:<verb>'. Returns whether `role` is
 * allowed. Unknown actions default to allowed (they live inside gated screens),
 * matching the client policy.
 */
export function roleHasPermission(role: string, featureKey: string): boolean {
  if (ADMIN_ROLES.has(role)) return true;
  if (featureKey.startsWith('screen:')) return roleAllowsScreen(role, featureKey.slice(7));
  if (featureKey.startsWith('action:')) {
    const verb = featureKey.slice(7);
    const screen = ACTION_SCREEN[verb];
    return screen ? roleAllowsScreen(role, screen) : true;
  }
  return roleAllowsScreen(role, featureKey);
}

/**
 * DB-driven access check. `screens` is the effective screen set for the actor
 * (their Role's screens with per-employee grants applied); `isAdmin` bypasses.
 * Actions inherit from ACTION_SCREEN; unknown actions default to allowed.
 */
export function accessAllows(screens: string[], isAdmin: boolean, featureKey: string): boolean {
  if (isAdmin) return true;
  const allowed = (id: string) => id === 'dashboard' || screens.includes(id);
  if (featureKey.startsWith('screen:')) return allowed(featureKey.slice(7));
  if (featureKey.startsWith('action:')) {
    const screen = ACTION_SCREEN[featureKey.slice(7)];
    return screen ? allowed(screen) : true;
  }
  return allowed(featureKey);
}

/** The full list of screen ids the platform knows about (for the roles editor). */
export const ALL_SCREENS: string[] = [
  'dashboard', 'inquiries', 'quotations', 'orders', 'sales_customers', 'sales_complaints',
  'orders_to_plan', 'plan_board', 'formulations', 'machine_tasks', 'logbooks', 'logbook_templates', 'logbook_ledger',
  'roll_queue', 'holds', 'receive', 'issue_lot', 'rm_stock', 'ready', 'dispatch_history',
  'preventive', 'machines', 'users', 'acl',
];
