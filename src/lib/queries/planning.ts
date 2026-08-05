import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';

export interface ApiPlanOrder {
  id: string; soNumber: string; product: string; quantity: number; deliveryDate: string;
  priority: string; status: string; customer: { name: string };
}
export interface ApiPlan {
  id: string; salesOrderId: string; machineId: string; shift: string; operatorName: string;
  scheduledStartDate: string; scheduledEndDate: string; status: string;
  supervisor: string; drawingNo: string; formulaNo: string; moldNo: string; productName: string;
  logbookTemplateId?: string | null;
  machine: { code: string; line: string };
  salesOrder: { soNumber: string; product: string; deliveryDate: string; customer: { name: string } };
  logbook?: { id: string; status: string } | null;
}
export interface ApiOperator {
  id: string; employeeCode: string; role: string; user: { name: string };
}

const keys = {
  ordersToPlan: ['planning', 'orders'] as const,
  plans: ['plans'] as const,
  operators: ['planning', 'operators'] as const,
};

export function useOrdersToPlan() {
  return useQuery({ queryKey: keys.ordersToPlan, queryFn: () => api.get<ApiPlanOrder[]>('/planning/orders') });
}
export function usePlans() {
  return useQuery({ queryKey: keys.plans, queryFn: () => api.get<ApiPlan[]>('/plans') });
}
export function useOperators() {
  return useQuery({ queryKey: keys.operators, queryFn: () => api.get<ApiOperator[]>('/planning/operators') });
}

function invalidatePlanning(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: keys.plans });
  qc.invalidateQueries({ queryKey: keys.ordersToPlan });
  qc.invalidateQueries({ queryKey: ['orders'] });
  qc.invalidateQueries({ queryKey: ['logbook', 'tasks'] });
  qc.invalidateQueries({ queryKey: ['logbook', 'plans'] });
  qc.invalidateQueries({ queryKey: ['dashboard'] });
  qc.invalidateQueries({ queryKey: ['summary'] });
}

export function useSchedulePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<ApiPlan>('/plans', body),
    onSuccess: () => invalidatePlanning(qc),
  });
}
export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch<ApiPlan>(`/plans/${id}`, body),
    onSuccess: () => invalidatePlanning(qc),
  });
}
export function useReleasePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean }>(`/plans/${id}/release`),
    onSuccess: () => invalidatePlanning(qc),
  });
}

/** True while a scheduled plan may still be edited (before start, draft logbook). */
export function planIsEditable(pl: ApiPlan, now = Date.now()): boolean {
  if (pl.status !== 'scheduled') return false;
  if (pl.logbook?.status === 'submitted') return false;
  const start = Date.parse(pl.scheduledStartDate);
  return Number.isFinite(start) ? now < start : true;
}
