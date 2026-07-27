import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';

export interface ApiStockRow { itemName: string; unit: string; onHand: number }
export interface ApiStock { rawMaterials: ApiStockRow[]; finishedGoods: ApiStockRow[] }

const keys = { stock: ['inventory', 'stock'] as const };

export function useStock() {
  return useQuery({ queryKey: keys.stock, queryFn: () => api.get<ApiStock>('/inventory/stock') });
}
export function useReceive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/inventory/receive', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.stock }),
  });
}
export function useIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/inventory/issue', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.stock }),
  });
}
