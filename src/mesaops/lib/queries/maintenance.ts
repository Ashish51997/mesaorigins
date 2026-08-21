import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/lib/apiClient';
import { mesaOpsPath } from '@mesaops/lib/apiBase';

export interface ApiMachine {
  id: string; code: string; line: string; family: string; logbookFormat: string; status: string;
}
export interface ApiMaintenanceTask {
  id: string; machineId: string; taskName: string; type: string; frequency: string;
  dueDate: string; status: string; cost: number;
  machine: { code: string; line: string; status: string };
}

const keys = { machines: ['machines'] as const, maintenance: ['maintenance'] as const };

export function useMachines() {
  return useQuery({ queryKey: keys.machines, queryFn: () => api.get<ApiMachine[]>(mesaOpsPath('/machines')) });
}
export function useCreateMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<ApiMachine>(mesaOpsPath('/machines'), body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.machines }),
  });
}
export function useMaintenanceTasks() {
  return useQuery({ queryKey: keys.maintenance, queryFn: () => api.get<ApiMaintenanceTask[]>(mesaOpsPath('/maintenance')) });
}
export function useAddMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<ApiMaintenanceTask>(mesaOpsPath('/maintenance'), body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.maintenance }),
  });
}
export function useCompleteMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ApiMaintenanceTask>(mesaOpsPath(`/maintenance/${id}/complete`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.maintenance }),
  });
}
