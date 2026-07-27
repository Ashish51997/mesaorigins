import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';

export interface ApiMachine {
  id: string; code: string; line: string; family: string; status: string;
}
export interface ApiMaintenanceTask {
  id: string; machineId: string; taskName: string; type: string; frequency: string;
  dueDate: string; status: string; cost: number;
  machine: { code: string; line: string; status: string };
}

const keys = { machines: ['machines'] as const, maintenance: ['maintenance'] as const };

export function useMachines() {
  return useQuery({ queryKey: keys.machines, queryFn: () => api.get<ApiMachine[]>('/machines') });
}
export function useMaintenanceTasks() {
  return useQuery({ queryKey: keys.maintenance, queryFn: () => api.get<ApiMaintenanceTask[]>('/maintenance') });
}
export function useAddMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<ApiMaintenanceTask>('/maintenance', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.maintenance }),
  });
}
export function useCompleteMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ApiMaintenanceTask>(`/maintenance/${id}/complete`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.maintenance }),
  });
}
