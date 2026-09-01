/**
 * Customer-facing product catalog for MesaOrigins.
 * Stable service IDs (mesaops / mesaleads / mesaerp) stay for APIs and routes.
 * Display names follow ADR-0004: MesaPlant / MesaSell / MesaBook.
 */

export type PlatformServiceId = 'mesaops' | 'mesaleads' | 'mesaerp';

export type ProductCatalogEntry = {
  id: PlatformServiceId;
  /** Customer-facing module name */
  name: string;
  description: string;
  sortOrder: number;
  /** Product IA group */
  group: 'Operations' | 'Commercial';
  /** SPA path (unchanged in phase 1) */
  href: string;
};

export const PRODUCT_CATALOG: Record<PlatformServiceId, ProductCatalogEntry> = {
  mesaops: {
    id: 'mesaops',
    name: 'MesaPlant',
    description: 'Plan machines and shifts, execute, QA, move operational stock, and dispatch.',
    sortOrder: 10,
    group: 'Operations',
    href: '/mesaops',
  },
  mesaleads: {
    id: 'mesaleads',
    name: 'MesaSell',
    description: 'Win the order — enquiry, technical review, quotation, and customer decision.',
    sortOrder: 20,
    group: 'Commercial',
    href: '/mesaleads',
  },
  mesaerp: {
    id: 'mesaerp',
    name: 'MesaBook',
    description: 'Run the business books — procurement, valued inventory, costing, finance, and tax.',
    sortOrder: 30,
    group: 'Commercial',
    href: '/mesaerp',
  },
};

export function isPlatformServiceId(id: string): id is PlatformServiceId {
  return id === 'mesaops' || id === 'mesaleads' || id === 'mesaerp';
}

/** Prefer catalog presentation for known services; pass through unknown rows. */
export function presentService<T extends { id: string; name: string; description: string; status: string; sortOrder: number }>(
  service: T,
): T {
  if (!isPlatformServiceId(service.id)) return service;
  const entry = PRODUCT_CATALOG[service.id];
  return {
    ...service,
    name: entry.name,
    description: entry.description,
    sortOrder: entry.sortOrder,
  };
}

export function seedServiceRows() {
  return (Object.keys(PRODUCT_CATALOG) as PlatformServiceId[]).map((id) => ({
    id,
    name: PRODUCT_CATALOG[id].name,
    description: PRODUCT_CATALOG[id].description,
    status: 'active' as const,
    sortOrder: PRODUCT_CATALOG[id].sortOrder,
  }));
}

export function listProductCatalogPublic() {
  return {
    brand: 'MesaOrigins',
    modules: Object.values(PRODUCT_CATALOG),
    surfaces: [
      { id: 'command', name: 'Command', description: 'MD exceptions — what needs attention now.' },
      { id: 'organization-control', name: 'Organization Control', description: 'Customer admin: people, plants, access.' },
      { id: 'platform-control', name: 'Platform Control', description: 'MesaWorks-only org provisioning.' },
      { id: 'connect', name: 'Connect', description: 'Vendor collaboration; requires MesaBook.' },
      { id: 'mesa-analytics', name: 'MesaAnalytics', description: 'Historical intelligence (future add-on).' },
    ],
    packages: [
      { id: 'plant-start', name: 'Plant Start', includes: ['mesaops'] },
      { id: 'commercial-start', name: 'Commercial Start', includes: ['mesaleads', 'mesaerp'] },
      { id: 'manufacturing-suite', name: 'Manufacturing Suite', includes: ['mesaleads', 'mesaerp', 'mesaops'] },
    ],
  };
}
