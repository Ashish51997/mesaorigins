import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';

export interface ApiQueueItem {
  lotNumber: string; colour: string; code: string; machineId: string; date: string; product: string;
}
export interface ApiInspection {
  id: string; rollNumber: string; lotNumber: string; decision: string; weight: number;
  finish: string; colour: string; tearingTest: string; remarks: string; inspectedBy: string; date: string;
}

const keys = { queue: ['quality', 'queue'] as const, inspections: ['quality', 'inspections'] as const };

export function useQualityQueue() {
  return useQuery({ queryKey: keys.queue, queryFn: () => api.get<ApiQueueItem[]>('/quality/queue') });
}
export function useQualityInspections() {
  return useQuery({ queryKey: keys.inspections, queryFn: () => api.get<ApiInspection[]>('/quality/inspections') });
}
export function useCreateInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<ApiInspection>('/quality/inspections', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.queue });
      qc.invalidateQueries({ queryKey: keys.inspections });
      qc.invalidateQueries({ queryKey: ['inventory'] }); // a pass books FG stock
    },
  });
}
