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

export interface ManagementKpi {
  value: number;
  trendPct: number | null;
  vs: string;
}

export interface ApiManagementOverview {
  context: { shift: 'D' | 'N'; asOf: string };
  kpis: {
    productionKg: ManagementKpi;
    scrapRatePct: ManagementKpi;
    onTimeDeliveryPct: ManagementKpi;
    complaints: { open: number; high: number; medium: number; low: number };
  };
  productionSeries: Array<{ date: string; productionKg: number; scrapKg: number }>;
  feedbackOpen: Array<{ rank: number; title: string; occurrences: number; openCount: number }>;
  queues: {
    qa: { waitingRolls: number; alerts: string[]; actions: string[] };
    dispatch: { vehicles: number; alerts: string[]; actions: string[] };
  };
  alerts: Array<{ id: string; severity: 'critical' | 'warning' | 'info'; message: string; href?: string }>;
}

export function useSummary() {
  return useQuery({ queryKey: ['summary'], queryFn: () => api.get<ApiSummary>('/summary') });
}

export function useManagementOverview(enabled = true) {
  return useQuery({
    queryKey: ['management-overview'],
    queryFn: () => api.get<ApiManagementOverview>('/management/overview'),
    enabled,
  });
}
