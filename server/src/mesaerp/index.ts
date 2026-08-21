import type { Router } from 'express';
import { requireService } from '../middleware/serviceEntitlement';
import { mesaErpRouter } from './router';
import { mesaErpVendorAccessRouter } from './vendorAccessRouter';
import { mesaErpSourceToPayRouter } from './sourceToPayRouter';
import { mesaErpCommercialManufacturingRouter } from './commercialManufacturingRouter';
import { mesaErpIndiaComplianceRouter } from './indiaComplianceRouter';
import { mesaErpValuedInventoryRouter } from './valuedInventoryRouter';
import { mesaErpFinanceControlRouter } from './financeControlRouter';
import { mesaErpPlanningRouter } from './planningRouter';
import { mesaErpHandoffTdsRouter } from './handoffTdsRouter';
import { supplierManagementRouter, supplierPortalRouter } from './supplierPortalRouter';

export { createMesaErpRouter, mesaErpRouter, MESAERP_PERMISSIONS } from './router';
export { InMemoryMesaErpRepository, type MesaErpRepository } from './repository';
export { PrismaMesaErpRepository } from './prismaRepository';
export { createMesaErpVendorAccessRouter, mesaErpVendorAccessRouter } from './vendorAccessRouter';
export { createMesaErpValuedInventoryRouter, mesaErpValuedInventoryRouter, MESAERP_VALUED_INVENTORY_PERMISSION } from './valuedInventoryRouter';
export { createMesaErpFinanceControlRouter, mesaErpFinanceControlRouter } from './financeControlRouter';
export { createMesaErpPlanningRouter, mesaErpPlanningRouter, MESAERP_MRP_PERMISSION } from './planningRouter';
export { createMesaErpHandoffTdsRouter, mesaErpHandoffTdsRouter, MESAERP_HANDOFF_PERMISSION, MESAERP_TDS_PERMISSION } from './handoffTdsRouter';
export { createSupplierPortalRouter, createSupplierManagementRouter, supplierPortalRouter, supplierManagementRouter } from './supplierPortalRouter';
export * from './schemas';

const MESAERP_V1 = '/mesaerp/v1';

/** Mount all MesaERP routers under `/mesaerp/v1` with service entitlement. */
export function mountMesaErpRouters(api: Router): void {
  const gate = requireService('mesaerp');
  api.use(MESAERP_V1, gate, mesaErpRouter);
  api.use(MESAERP_V1, gate, mesaErpVendorAccessRouter);
  api.use(MESAERP_V1, gate, mesaErpSourceToPayRouter);
  api.use(MESAERP_V1, gate, mesaErpCommercialManufacturingRouter);
  api.use(MESAERP_V1, gate, mesaErpIndiaComplianceRouter);
  api.use(MESAERP_V1, gate, supplierManagementRouter);
  api.use(MESAERP_V1, gate, mesaErpValuedInventoryRouter);
  api.use(MESAERP_V1, gate, mesaErpFinanceControlRouter);
  api.use(MESAERP_V1, gate, mesaErpPlanningRouter);
  api.use(MESAERP_V1, gate, mesaErpHandoffTdsRouter);
}
