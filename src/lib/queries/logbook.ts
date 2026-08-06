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
  ledger: ['logbook', 'ledger'] as const,
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
    id: string; shift: string; scheduledStartDate: string; operatorName?: string;
    salesOrder: { soNumber: string; product: string } | null;
    logbook: { id: string; status: string } | null;
    logbookTemplate: { id: string; productName: string; layout: string; docNo: string } | null;
  }>;
}
export function useLogbookTasks() {
  return useQuery({ queryKey: ['logbook', 'tasks'], queryFn: () => api.get<ApiMachineTaskGroup[]>('/logbook/tasks') });
}

export interface ApiResolveMachineLogbook {
  reason: 'ok' | 'no_active_plan';
  machine: { id: string; code: string; line: string };
  planId: string | null;
  logStatus: string | null;
}

export function useResolveMachineLogbook(machineCode: string | null | undefined) {
  const code = (machineCode ?? '').trim().toUpperCase();
  return useQuery({
    queryKey: ['logbook', 'resolve', code],
    enabled: code.length > 0,
    queryFn: () => api.get<ApiResolveMachineLogbook>(`/logbook/resolve?machine=${encodeURIComponent(code)}`),
    retry: false,
  });
}

export interface ApiMachineHub {
  machine: {
    id: string; code: string; line: string; family: string; logbookFormat: string;
    status: string; statusReason: string | null;
    currentProduct: string | null; currentFormula: string | null; currentLot: string | null;
  };
  started: boolean;
  activePlan: {
    id: string; shift: string; status: string; operatorName: string; scheduledStartDate: string;
    salesOrder: { soNumber: string; product: string } | null;
    logbook: { id: string; status: string; updatedAt: string } | null;
    logbookTemplate: { id: string; docNo: string; productName: string; layout: string } | null;
  } | null;
  activePlans: Array<{
    id: string; shift: string; status: string; operatorName: string; scheduledStartDate: string;
    salesOrder: { soNumber: string; product: string } | null;
    logbook: { id: string; status: string; updatedAt: string } | null;
    logbookTemplate: { id: string; docNo: string; productName: string; layout: string } | null;
  }>;
  logbooks: Array<{
    id: string; status: string; date: string; shift: string; productName: string; formulaNo: string;
    totalRollKgs: string; totalRollsProduced: string; operatorSignature: string; updatedAt: string;
    productionPlanId: string; soNumber: string | null; planStatus: string | null;
  }>;
  maintenance: Array<{
    id: string; taskName: string; type: string; frequency: string; dueDate: string; status: string; cost: number;
  }>;
}

export function useMachineHub(machineCode: string | null | undefined) {
  const code = (machineCode ?? '').trim().toUpperCase();
  return useQuery({
    queryKey: ['logbook', 'machine-hub', code],
    enabled: code.length > 0,
    queryFn: () => api.get<ApiMachineHub>(`/logbook/machine-hub?machine=${encodeURIComponent(code)}`),
    retry: false,
  });
}

export interface ApiLogbookLedgerRow {
  id: string;
  machineId: string;
  date: string;
  isoDate: string;
  shift: string;
  productName: string;
  formulaNo: string;
  totalRollsProduced: string;
  totalRollKgs: string;
  totalConsumedKg: string;
  rejectionKg: string;
  operatorSignature: string;
  supervisor: string;
  soNumber: string;
  productionPlanId: string;
  updatedAt: string;
  producedKg: number;
  consumedKg: number;
  wasteKg: number;
}

export interface ApiLogbookLedger {
  summary: {
    submitted: number;
    producedKg: number;
    consumedKg: number;
    wasteKg: number;
    rolls: number;
    machines: number;
    shifts: string[];
    yieldPct: number;
    from: string | null;
    to: string | null;
  };
  charts: {
    byDay: Array<{ date: string; producedKg: number; consumedKg: number; wasteKg: number; count: number }>;
    byMachine: Array<{ label: string; producedKg: number; count: number }>;
  };
  rows: ApiLogbookLedgerRow[];
}

export function useLogbookLedger(range?: { from?: string; to?: string }) {
  const from = range?.from || undefined;
  const to = range?.to || undefined;
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const q = qs.toString();
  return useQuery({
    queryKey: [...keys.ledger, from ?? '', to ?? ''],
    queryFn: () => api.get<ApiLogbookLedger>(`/logbook/ledger${q ? `?${q}` : ''}`),
  });
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.plans });
      qc.invalidateQueries({ queryKey: keys.ledger });
      qc.invalidateQueries({ queryKey: ['logbook', 'tasks'] });
    },
  });
}
