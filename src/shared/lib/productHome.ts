/** Client-safe post-login routing (stable service IDs; customer names in UI). */

export type HomeService = { id: string };

const PLANT_ROLES = new Set([
  'Operator',
  'Production Planner',
  'Quality Inspector',
  'Store Manager',
  'Dispatch Executive',
  'Maintenance Head',
  'Administrator',
]);

const EXEC_ROLES = new Set(['Managing Director', 'Owner']);

export function servicePath(serviceId: string): string | null {
  if (serviceId === 'mesaops') return '/mesaops';
  if (serviceId === 'mesaleads') return '/mesaleads';
  if (serviceId === 'mesaerp') return '/mesaerp';
  return null;
}

/**
 * Role-based post-login destination.
 * Returns null when the user should see the multi-product picker.
 */
export function resolvePostLoginDestination(role: string, services: HomeService[]): string | null {
  const active = services.filter((s) => servicePath(s.id));
  if (active.length === 0) return null;

  const ids = new Set(active.map((s) => s.id));
  const hasPlant = ids.has('mesaops');
  const hasSell = ids.has('mesaleads');
  const hasBook = ids.has('mesaerp');
  const normalized = role.trim();

  if (EXEC_ROLES.has(normalized) && hasPlant) return '/command';
  if (normalized === 'Sales Executive' && hasSell) return '/mesaleads';
  if (PLANT_ROLES.has(normalized) && hasPlant) return '/mesaops';
  if (hasBook && !hasPlant && !hasSell) return '/mesaerp';

  if (active.length === 1) return servicePath(active[0].id);

  return null;
}

export function productGroupLabel(serviceId: string): string {
  if (serviceId === 'mesaops') return 'Operations';
  if (serviceId === 'mesaleads' || serviceId === 'mesaerp') return 'Commercial';
  return 'Products';
}

const DISPLAY_NAMES: Record<string, string> = {
  mesaops: 'MesaPlant',
  mesaleads: 'MesaSell',
  mesaerp: 'MesaBook',
};

export function catalogName(serviceId: string, fallback = serviceId): string {
  return DISPLAY_NAMES[serviceId] ?? fallback;
}
