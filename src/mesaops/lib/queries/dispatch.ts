import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/lib/apiClient';
import { mesaOpsPath } from '@mesaops/lib/apiBase';

export interface ApiReadyOrder {
  id: string; operationalOrderId: string; soNumber: string; product: string; quantity: string; orderedQuantity: string;
  dispatchableQuantity: string; uom: string; rowVersion: number; plantCode: string; deliveryDate: string;
  priority: string; status: string; customer: { name: string; deliveryAddress: string };
}
export interface ApiDispatch {
  id: string; invoiceNumber: string; salesOrderId: string; vehicleNumber: string; transporter: string;
  driverName: string; dispatchDate: string; deliveryAddress: string; etaDate: string; status: string;
  salesOrder: { soNumber: string; product: string; customer: { name: string } };
}

const keys = { ready: ['dispatch', 'ready'] as const, dispatches: ['dispatches'] as const };

export function useReadyOrders() {
  return useQuery({ queryKey: keys.ready, queryFn: () => api.get<ApiReadyOrder[]>(mesaOpsPath('/dispatch/ready')) });
}
export function useDispatches() {
  return useQuery({ queryKey: keys.dispatches, queryFn: () => api.get<ApiDispatch[]>(mesaOpsPath('/dispatches')) });
}
export function useCreateDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.postIdempotent<ApiDispatch>(mesaOpsPath('/dispatches'), body, `dispatch:${crypto.randomUUID()}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.ready });
      qc.invalidateQueries({ queryKey: keys.dispatches });
      qc.invalidateQueries({ queryKey: ['orders'] }); // order → dispatched
    },
  });
}
