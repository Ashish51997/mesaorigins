import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/lib/apiClient';
import { mesaOpsPath } from '@mesaops/lib/apiBase';

// A dispatched batch a complaint can be raised against (server: DispatchRecord
// joined to its order). invoiceNumber is the batch reference on the complaint.
export interface ApiBatch {
  id: string; invoiceNumber: string; salesOrderId: string; dispatchDate: string;
  salesOrder: { soNumber: string; product: string; customerId: string; customer: { name: string } };
}
export interface ApiCapa {
  id: string; complaintId: string | null; rootCause: string; correctiveAction: string;
  preventiveAction: string; responsiblePerson: string; dueDate: string; status: string; closedDate: string | null;
}
// A complaint with its customer name and merged CAPA (Complaint.capaId is a plain id).
export interface ApiComplaint {
  id: string; complaintNumber: string; customerId: string; batchNumber: string; product: string;
  description: string; photoUrl: string | null; severity: string; status: string; date: string;
  capaId: string | null; customer: { name: string }; capa: ApiCapa | null;
}

const keys = {
  batches: ['complaint-batches'] as const,
  complaints: ['complaints'] as const,
};

export function useComplaintBatches() {
  return useQuery({ queryKey: keys.batches, queryFn: () => api.get<ApiBatch[]>(mesaOpsPath('/complaints/batches')) });
}
export function useComplaints() {
  return useQuery({ queryKey: keys.complaints, queryFn: () => api.get<ApiComplaint[]>(mesaOpsPath('/complaints')) });
}

export function useLogComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { salesOrderId: string; severity: string; description: string; photoUrl?: string }) =>
      api.post<ApiComplaint>(mesaOpsPath('/complaints'), body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.complaints }),
  });
}
export function useResolveComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ApiComplaint>(mesaOpsPath(`/complaints/${id}/resolve`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.complaints }),
  });
}

// CAPA mutations feed the complaints list (each complaint embeds its CAPA), so
// invalidating 'complaints' refreshes the merged view.
export function useUpdateCapa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<ApiCapa, 'rootCause' | 'correctiveAction' | 'preventiveAction' | 'responsiblePerson' | 'dueDate'>> }) =>
      api.patch<ApiCapa>(mesaOpsPath(`/capas/${id}`), patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.complaints }),
  });
}
export function useCloseCapa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ApiCapa>(mesaOpsPath(`/capas/${id}/close`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.complaints }),
  });
}
