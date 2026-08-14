import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';

export interface ErpInventoryItem {
  id: string;
  legalEntityId: string;
  itemCode: string;
  name: string;
  itemType: 'inventory' | 'service' | 'asset' | 'expense';
  category: string;
  baseUom: string;
  uomConversions: Array<{ uom: string; factorToBase: string }>;
  hsnSacCode: string;
  gstRate: string;
  valuationMethod: 'moving_average' | 'fifo';
  batchTracked: boolean;
  serialTracked: boolean;
  expiryTracked: boolean;
  inventoryAccount: string;
  consumptionAccount: string;
  salesAccount: string;
  purchaseAccount: string;
  active: boolean;
  attributes: Record<string, unknown>;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}
export interface ErpWarehouse {
  id: string;
  legalEntityId: string;
  code: string;
  name: string;
  kind: 'plant' | 'warehouse' | 'godown' | 'subcontractor';
  plantCode: string;
  branchCode: string;
  address: Record<string, unknown>;
  allowNegative: false;
  active: boolean;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ErpStockBalance {
  legalEntityId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseCode: string;
  batchNumber: string;
  serialNumber: string;
  expiryDate?: string;
  uom: string;
  quantity: string;
  value: string;
  unitCost: string;
}

export interface ErpStockMovement extends ErpStockBalance {
  id: string;
  movementType: string;
  businessDate: string;
  valuationMethod: string;
  valuationLayer: Record<string, unknown>;
  sourceDocumentId: string;
  voucherId: string;
  occurredAt: string;
}

export interface ErpInventoryPostingLink {
  sourceType: string;
  sourceId: string;
  voucherId: string;
  voucherStatus: string;
  sourceSnapshotHash?: string;
}

export interface ErpPhysicalCount {
  id: string;
  countNumber: string;
  businessDate: string;
  warehouseId: string;
  reference: string;
  status: string;
  rowVersion: number;
  lines: Array<{
    itemId: string;
    countedQuantity: string;
    bookQuantity: string;
    varianceQuantity: string;
    uom: string;
    batchNumber?: string;
    serialNumber?: string;
  }>;
  posting: ErpInventoryPostingLink;
}

export interface ErpInventoryItemCreate {
  itemCode: string;
  name: string;
  itemType: 'inventory' | 'service' | 'asset' | 'expense';
  category: string;
  baseUom: string;
  uomConversions: Array<{ uom: string; factorToBase: string }>;
  hsnSacCode: string;
  gstRate: string;
  valuationMethod: 'moving_average' | 'fifo';
  batchTracked: boolean;
  serialTracked: boolean;
  expiryTracked: boolean;
  inventoryAccount?: string;
  consumptionAccount?: string;
  salesAccount?: string;
  purchaseAccount?: string;
  active: boolean;
  attributes: Record<string, unknown>;
}

export interface ErpWarehouseCreate {
  code: string;
  name: string;
  kind: 'plant' | 'warehouse' | 'godown' | 'subcontractor';
  plantCode: string;
  branchCode: string;
  address: Record<string, unknown>;
  active: boolean;
}

export interface ErpStockAdjustmentCreate {
  businessDate: string;
  reference: string;
  reason: string;
  lines: Array<{
    itemId: string;
    warehouseId: string;
    quantity: string;
    uom: string;
    unitCost?: string;
    adjustmentAccount: string;
    batchNumber: string;
    serialNumber: string;
    expiryDate?: string;
  }>;
}

export interface ErpStockTransferCreate {
  businessDate: string;
  reference: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  lines: Array<{
    itemId: string;
    quantity: string;
    uom: string;
    batchNumber: string;
    serialNumber: string;
    expiryDate?: string;
  }>;
}

export interface ErpPhysicalCountCreate {
  countNumber?: string;
  businessDate: string;
  warehouseId: string;
  reference: string;
  lines: Array<{
    itemId: string;
    countedQuantity: string;
    uom: string;
    receiptUnitCost?: string;
    adjustmentAccount: string;
    batchNumber: string;
    serialNumber: string;
    expiryDate?: string;
  }>;
}

const keys = {
  all: (entityId: string) => ['mesaerp', entityId, 'valued-inventory'] as const,
  items: (entityId: string) => [...keys.all(entityId), 'items'] as const,
  warehouses: (entityId: string) => [...keys.all(entityId), 'warehouses'] as const,
  balances: (entityId: string) => [...keys.all(entityId), 'balances'] as const,
  ledger: (entityId: string) => [...keys.all(entityId), 'ledger'] as const,
  posting: (entityId: string, sourceType: string, sourceId: string) => [...keys.all(entityId), 'posting', sourceType, sourceId] as const,
};

const base = (entityId: string) => `/mesaerp/v1/entities/${entityId}`;

export function useErpInventoryItems(entityId: string) {
  return useQuery({ queryKey: keys.items(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpInventoryItem[]>(`${base(entityId)}/items`) });
}

export function useErpWarehouses(entityId: string) {
  return useQuery({ queryKey: keys.warehouses(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpWarehouse[]>(`${base(entityId)}/warehouses`) });
}

export function useErpStockBalances(entityId: string) {
  return useQuery({ queryKey: keys.balances(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpStockBalance[]>(`${base(entityId)}/stock-balances`) });
}

export function useErpStockLedger(entityId: string) {
  return useQuery({ queryKey: keys.ledger(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpStockMovement[]>(`${base(entityId)}/stock-ledger`) });
}

export function useErpInventoryPostingLink(entityId: string, sourceType: string, sourceId: string) {
  return useQuery({
    queryKey: keys.posting(entityId, sourceType, sourceId),
    enabled: Boolean(entityId && sourceType && sourceId),
    queryFn: () => api.get<ErpInventoryPostingLink>(`${base(entityId)}/posting-links/${encodeURIComponent(sourceType)}/${encodeURIComponent(sourceId)}`),
  });
}

export function useErpInventoryActions(entityId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.all(entityId) });
  return {
    createItem: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpInventoryItemCreate; requestKey: string }) => api.postIdempotent<ErpInventoryItem>(`${base(entityId)}/items`, input, requestKey), onSuccess: refresh }),
    updateItem: useMutation({ mutationFn: ({ itemId, input, requestKey }: { itemId: string; input: Partial<ErpInventoryItemCreate> & { expectedRowVersion: number }; requestKey: string }) => api.patchIdempotent<ErpInventoryItem>(`${base(entityId)}/items/${itemId}`, input, requestKey), onSuccess: refresh }),
    createWarehouse: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpWarehouseCreate; requestKey: string }) => api.postIdempotent<ErpWarehouse>(`${base(entityId)}/warehouses`, input, requestKey), onSuccess: refresh }),
    updateWarehouse: useMutation({ mutationFn: ({ warehouseId, input, requestKey }: { warehouseId: string; input: Partial<ErpWarehouseCreate> & { expectedRowVersion: number }; requestKey: string }) => api.patchIdempotent<ErpWarehouse>(`${base(entityId)}/warehouses/${warehouseId}`, input, requestKey), onSuccess: refresh }),
    createAdjustment: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpStockAdjustmentCreate; requestKey: string }) => api.postIdempotent<ErpInventoryPostingLink>(`${base(entityId)}/stock-adjustments`, input, requestKey), onSuccess: refresh }),
    createTransfer: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpStockTransferCreate; requestKey: string }) => api.postIdempotent<ErpInventoryPostingLink>(`${base(entityId)}/stock-transfers`, input, requestKey), onSuccess: refresh }),
    createPhysicalCount: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpPhysicalCountCreate; requestKey: string }) => api.postIdempotent<ErpPhysicalCount>(`${base(entityId)}/physical-counts`, input, requestKey), onSuccess: refresh }),
  };
}
