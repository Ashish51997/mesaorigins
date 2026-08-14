import { describe, expect, it } from 'vitest';
import { allowsLegacyMesaOpsUnassignedAccess, deriveMesaOpsPlantScope } from './mesaOpsScope';

describe('MesaOps plant scope migration behavior', () => {
  it('defaults an unassigned membership to no plant access', () => {
    expect(deriveMesaOpsPlantScope([])).toEqual({ explicit: false, allPlants: false, plantCodes: [] });
  });

  it('allows the legacy fallback only through an explicit non-production flag', () => {
    expect(allowsLegacyMesaOpsUnassignedAccess({ NODE_ENV: 'test', MESAOPS_ALLOW_LEGACY_UNASSIGNED: '1' })).toBe(true);
    expect(allowsLegacyMesaOpsUnassignedAccess({ NODE_ENV: 'development' })).toBe(false);
    expect(allowsLegacyMesaOpsUnassignedAccess({ NODE_ENV: 'production', MESAOPS_ALLOW_LEGACY_UNASSIGNED: '1' })).toBe(false);
    expect(deriveMesaOpsPlantScope([], false, true)).toEqual({ explicit: false, allPlants: true, plantCodes: [] });
  });

  it('fails closed after the last explicit assignment is revoked or expires', () => {
    expect(deriveMesaOpsPlantScope([], true)).toEqual({ explicit: true, allPlants: false, plantCodes: [] });
    expect(deriveMesaOpsPlantScope([], true, true)).toEqual({ explicit: true, allPlants: false, plantCodes: [] });
  });

  it('recognizes an explicit all-plant assignment', () => {
    expect(deriveMesaOpsPlantScope([
      { plantCode: null, warehouseId: null, legalEntityId: null },
    ])).toEqual({ explicit: true, allPlants: true, plantCodes: [] });
  });

  it('fails closed to assigned plants after the first explicit assignment', () => {
    expect(deriveMesaOpsPlantScope([
      { plantCode: 'PLANT-A', warehouseId: null, legalEntityId: null },
      { plantCode: 'PLANT-B', warehouseId: null, legalEntityId: null },
    ])).toEqual({ explicit: true, allPlants: false, plantCodes: ['PLANT-A', 'PLANT-B'] });
  });

  it('does not treat a warehouse-only assignment as plant-wide access', () => {
    expect(deriveMesaOpsPlantScope([
      { plantCode: null, warehouseId: 'warehouse-1', legalEntityId: null },
    ])).toEqual({ explicit: true, allPlants: false, plantCodes: [] });
  });
});
