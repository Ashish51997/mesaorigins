import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
import type { LogbookTemplate, MachineLogbook } from '../../types';

// A scheduled/running plan the operator can log, with its machine, order, and
// existing logbook (if any). Superset of ProductionPlan.
export interface ApiPlanToLog {
  id: string; salesOrderId: string; machineId: string; shift: string; operatorName: string;
  scheduledStartDate: string; scheduledEndDate: string; status: string;
  machine: { code: string; logbookFormat: string };
  salesOrder: { soNumber: string; product: string };
  logbook: { id: string; status: string } | null;
}

// An active formulation to pick as the logbook's Formula No.
export interface ApiLogbookFormula { id: string; code: string; rev: number; product: string; }

const keys = {
  templates: ['logbook', 'templates'] as const,
  plans: ['logbook', 'plans'] as const,
  formulas: ['logbook', 'formulas'] as const,
};

export function useLogbookTemplates() {
  return useQuery({ queryKey: keys.templates, queryFn: () => api.get<LogbookTemplate[]>('/logbook/templates') });
}
export function useLogbookFormulas() {
  return useQuery({ queryKey: keys.formulas, queryFn: () => api.get<ApiLogbookFormula[]>('/logbook/formulas') });
}
export function useLogbookPlans() {
  return useQuery({ queryKey: keys.plans, queryFn: () => api.get<ApiPlanToLog[]>('/logbook/plans') });
}

export interface ApiMachineTaskGroup {
  machine: string; line: string;
  tasks: Array<{
    id: string; shift: string; scheduledStartDate: string;
    salesOrder: { soNumber: string; product: string } | null;
    logbook: { id: string; status: string } | null;
    logbookTemplate: { id: string; productName: string; layout: string; docNo: string } | null;
  }>;
}
export function useLogbookTasks() {
  return useQuery({ queryKey: ['logbook', 'tasks'], queryFn: () => api.get<ApiMachineTaskGroup[]>('/logbook/tasks') });
}
export function useOpenLogbook() {
  return useMutation({ mutationFn: (productionPlanId: string) => api.post<MachineLogbook>('/logbooks', { productionPlanId }) });
}
export function useSaveLogbook() {
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Partial<MachineLogbook> }) => api.patch<MachineLogbook>(`/logbooks/${id}`, patch) });
}
export function useSubmitLogbook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<MachineLogbook>(`/logbooks/${id}/submit`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.plans }),
  });
}
