import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/lib/apiClient';

export interface ErpPlanningPolicy {
  itemId: string; legalEntityId: string; itemCode: string; itemName: string; baseUom: string;
  leadTimeDays: number; safetyStock: string; minimumStock: string; maximumStock?: string;
  lotSizing: 'lot_for_lot' | 'fixed' | 'min_max'; fixedLotSize: string; minimumOrderQuantity: string;
  orderMultiple: string; supplyPolicy: 'make' | 'buy' | 'transfer'; planningWarehouseId?: string;
  transferSourceWarehouseId?: string; preferredVendorId?: string; rowVersion: number; updatedAt?: string;
}

export interface ErpPlanningBomComponent {
  id: string; lineNumber: number; componentItemId: string; componentItemCode: string; componentItemName: string;
  issueWarehouseId?: string; issueWarehouseCode?: string; quantity: string; uom: string; scrapPercentage: string;
  componentType: 'material' | 'packaging'; phase: string; dimensions: Record<string, unknown>;
}
export interface ErpPlanningBomRevision {
  revisionId: string; revisionNumber: number; revisionCode: string; effectiveFrom: string; effectiveTo?: string;
  outputQuantity: string; outputUom: string; yieldPercentage: string; notes: string; formulaParameters: Record<string, unknown>;
  components: ErpPlanningBomComponent[]; status: 'draft' | 'submitted' | 'approved' | 'retired';
  sourceSnapshotHash: string; rowVersion: number; createdBy: string; submittedAt?: string; approvedBy?: string; approvedAt?: string;
  createdAt: string; updatedAt: string;
}
export interface ErpPlanningBom {
  id: string; legalEntityId: string; bomCode: string; parentItemId: string; parentItemCode: string; parentItemName: string;
  parentUom: string; bomType: 'discrete' | 'formula'; description: string; active: boolean; rowVersion: number;
  revisions: ErpPlanningBomRevision[]; createdAt: string; updatedAt: string;
}
export interface ErpForecast {
  id: string; legalEntityId: string; financialYearId: string; forecastNumber: string; itemId: string; warehouseId: string;
  forecastDate: string; quantity: string; uom: string; status: 'draft' | 'submitted' | 'approved'; notes: string;
  sourceSnapshotHash: string; rowVersion: number; createdAt: string; updatedAt: string;
}
export interface ErpStockReservation {
  id: string; legalEntityId: string; reservationNumber: string; itemId: string; warehouseId: string; quantity: string; uom: string;
  batchNumber: string; serialNumber: string; sourceType: 'sales_order' | 'production_demand' | 'manual'; sourceId?: string;
  sourceLineId?: string; requiredOn?: string; status: 'active' | 'released' | 'cancelled'; sourceSnapshotHash: string;
  rowVersion: number; createdAt: string; updatedAt: string;
}
export interface ErpAtp {
  legalEntityId: string; itemId: string; itemCode: string; warehouseId: string; warehouseCode: string; uom: string;
  asOfDate: string; requiredOn: string; onHandQuantity: string; activeReservationQuantity: string;
  currentAvailableQuantity: string; openPurchaseSupply: string; openProductionSupply: string;
  projectedAvailableQuantity: string; calculatedFromSnapshotHash: string;
}
export interface ErpMrpRequirement {
  id: string; itemId: string; warehouseId: string; bomRevisionId?: string; level: number; requiredOn: string;
  grossRequirement: string; includedReservation: string; onHandQuantity: string; externalReservation: string;
  openPurchaseSupply: string; openProductionSupply: string; safetyStock: string; netRequirement: string;
  sourceRefs: unknown; calculationSnapshot: unknown; snapshotHash: string;
}
export interface ErpMrpSuggestion {
  id: string; legalEntityId: string; mrpRunId: string; requirementId: string; suggestionType: 'make' | 'purchase' | 'transfer';
  itemId: string; warehouseId: string; sourceWarehouseId?: string; quantity: string; uom: string; orderOn: string; requiredOn: string;
  status: 'draft' | 'submitted' | 'approved' | 'released'; planningSnapshot: unknown; sourceSnapshotHash: string;
  releasedResourceType?: string; releasedResourceId?: string; rowVersion: number; createdAt: string; updatedAt: string;
}
export interface ErpMrpRun {
  id: string; legalEntityId: string; financialYearId: string; runNumber: string; asOfDate: string; horizonEnd: string; status: string;
  parameters: Record<string, unknown>; demandSnapshot: unknown; supplySnapshot: unknown; sourceSnapshotHash: string;
  resultSnapshot: unknown; resultSnapshotHash: string; rowVersion: number; calculatedAt: string; createdAt: string;
  demandBasis: { forecastTreatment: 'additive'; linkedProductionDemandDeduplication: 'sales_order_line' };
  requirements: ErpMrpRequirement[]; suggestions: ErpMrpSuggestion[];
}
export interface ErpTransferProposal {
  id: string; legalEntityId: string; suggestionId: string; proposalNumber: string; itemId: string;
  fromWarehouseId: string; toWarehouseId: string; quantity: string; uom: string; requiredOn: string;
  status: string; sourceSnapshotHash: string; rowVersion: number; createdAt: string; updatedAt: string;
}

export interface ErpPlanningPolicyUpdate {
  expectedRowVersion: number; leadTimeDays: number; safetyStock: string; minimumStock: string; maximumStock?: string;
  lotSizing: 'lot_for_lot' | 'fixed' | 'min_max'; fixedLotSize: string; minimumOrderQuantity: string; orderMultiple: string;
  supplyPolicy: 'make' | 'buy' | 'transfer'; planningWarehouseId: string; transferSourceWarehouseId?: string; preferredVendorId?: string;
}
export interface ErpPlanningBomCreate {
  bomCode: string; parentItemId: string; bomType: 'discrete' | 'formula'; description: string;
  revision: { revisionCode: string; effectiveFrom: string; effectiveTo?: string; outputQuantity: string; outputUom: string;
    yieldPercentage: string; notes: string; formulaParameters: Record<string, unknown>;
    components: Array<{ componentItemId: string; issueWarehouseId?: string; quantity: string; uom: string; scrapPercentage: string; componentType: 'material' | 'packaging'; phase: string; dimensions: Record<string, unknown> }> };
}
export interface ErpForecastCreate { forecastNumber?: string; itemId: string; warehouseId: string; forecastDate: string; quantity: string; uom: string; notes: string }
export interface ErpStockReservationCreate { reservationNumber?: string; itemId: string; warehouseId: string; quantity: string; uom: string; batchNumber: string; serialNumber: string; sourceType: 'manual'; requiredOn?: string }
export interface ErpMrpRunCreate { runNumber?: string; asOfDate: string; horizonEnd: string; warehouseIds?: string[]; includeSalesOrders: boolean; includeForecasts: boolean; includeProductionDemands: boolean; forecastTreatment: 'additive' }

const root = (entityId: string) => `/mesaerp/v1/entities/${entityId}`;
const keys = {
  all: (entityId: string) => ['mesaerp', entityId, 'planning'] as const,
  boms: (entityId: string) => [...keys.all(entityId), 'boms'] as const,
  forecasts: (entityId: string) => [...keys.all(entityId), 'forecasts'] as const,
  reservations: (entityId: string) => [...keys.all(entityId), 'reservations'] as const,
  runs: (entityId: string) => [...keys.all(entityId), 'runs'] as const,
  transfers: (entityId: string) => [...keys.all(entityId), 'transfers'] as const,
  policy: (entityId: string, itemId: string) => [...keys.all(entityId), 'policy', itemId] as const,
  atp: (entityId: string, query: string) => [...keys.all(entityId), 'atp', query] as const,
};
export function useErpPlanningBoms(entityId: string) { return useQuery({ queryKey: keys.boms(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpPlanningBom[]>(`${root(entityId)}/planning-boms`) }); }
export function useErpForecasts(entityId: string) { return useQuery({ queryKey: keys.forecasts(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpForecast[]>(`${root(entityId)}/demand-forecasts`) }); }
export function useErpStockReservations(entityId: string) { return useQuery({ queryKey: keys.reservations(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpStockReservation[]>(`${root(entityId)}/stock-reservations`) }); }
export function useErpMrpRuns(entityId: string) { return useQuery({ queryKey: keys.runs(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpMrpRun[]>(`${root(entityId)}/mrp-runs`) }); }
export function useErpTransferProposals(entityId: string) { return useQuery({ queryKey: keys.transfers(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpTransferProposal[]>(`${root(entityId)}/transfer-proposals`) }); }
export function useErpPlanningPolicy(entityId: string, itemId: string) { return useQuery({ queryKey: keys.policy(entityId, itemId), enabled: Boolean(entityId && itemId), queryFn: () => api.get<ErpPlanningPolicy>(`${root(entityId)}/items/${itemId}/planning-policy`) }); }
export function useErpAtp(entityId: string, filters: { itemId: string; warehouseId: string; asOfDate: string; requiredOn: string }, enabled: boolean) {
  const query = new URLSearchParams(filters).toString();
  return useQuery({ queryKey: keys.atp(entityId, query), enabled: Boolean(entityId && filters.itemId && filters.warehouseId && enabled), queryFn: () => api.get<ErpAtp>(`${root(entityId)}/atp?${query}`) });
}

export function useErpPlanningActions(entityId: string) {
  const queryClient = useQueryClient(); const refresh = () => queryClient.invalidateQueries({ queryKey: keys.all(entityId) });
  const post = <T,>(path: string, input: unknown, requestKey: string) => api.postIdempotent<T>(`${root(entityId)}/${path}`, input, requestKey);
  return {
    updatePolicy: useMutation({ mutationFn: ({ itemId, input, requestKey }: { itemId: string; input: ErpPlanningPolicyUpdate; requestKey: string }) => api.patchIdempotent<ErpPlanningPolicy>(`${root(entityId)}/items/${itemId}/planning-policy`, input, requestKey), onSuccess: refresh }),
    createBom: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpPlanningBomCreate; requestKey: string }) => post<ErpPlanningBom>('planning-boms', input, requestKey), onSuccess: refresh }),
    transitionBomRevision: useMutation({ mutationFn: ({ bomId, revisionId, action, expectedRowVersion, requestKey }: { bomId: string; revisionId: string; action: 'submit' | 'approve'; expectedRowVersion: number; requestKey: string }) => post<ErpPlanningBom>(`planning-boms/${bomId}/revisions/${revisionId}/${action}`, { expectedRowVersion }, requestKey), onSuccess: refresh }),
    createForecast: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpForecastCreate; requestKey: string }) => post<ErpForecast>('demand-forecasts', input, requestKey), onSuccess: refresh }),
    transitionForecast: useMutation({ mutationFn: ({ forecastId, action, expectedRowVersion, requestKey }: { forecastId: string; action: 'submit' | 'approve'; expectedRowVersion: number; requestKey: string }) => post<ErpForecast>(`demand-forecasts/${forecastId}/${action}`, { expectedRowVersion }, requestKey), onSuccess: refresh }),
    createReservation: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpStockReservationCreate; requestKey: string }) => post<ErpStockReservation>('stock-reservations', input, requestKey), onSuccess: refresh }),
    transitionReservation: useMutation({ mutationFn: ({ reservationId, action, expectedRowVersion, requestKey }: { reservationId: string; action: 'release' | 'cancel'; expectedRowVersion: number; requestKey: string }) => post<ErpStockReservation>(`stock-reservations/${reservationId}/${action}`, { expectedRowVersion }, requestKey), onSuccess: refresh }),
    createMrpRun: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpMrpRunCreate; requestKey: string }) => post<ErpMrpRun>('mrp-runs', input, requestKey), onSuccess: refresh }),
    transitionSuggestion: useMutation({ mutationFn: ({ suggestionId, action, expectedRowVersion, requestKey }: { suggestionId: string; action: 'submit' | 'approve' | 'release'; expectedRowVersion: number; requestKey: string }) => post<ErpMrpSuggestion>(`mrp-suggestions/${suggestionId}/${action}`, { expectedRowVersion }, requestKey), onSuccess: refresh }),
  };
}
