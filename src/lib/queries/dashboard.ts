import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';

export interface ApiSummary {
  orders: { pending: number; planned: number; dispatched: number };
  inquiriesOpen: number;
  plans: { scheduled: number; running: number };
  logbooksSubmitted: number;
  complaintsOpen: number;
  capasOpen: number;
  customers: number;
  maintenanceOpen: number;
  stock: { rawMaterialKg: number; finishedGoodsKg: number };
}

export function useSummary() {
  return useQuery({ queryKey: ['summary'], queryFn: () => api.get<ApiSummary>('/summary') });
}
