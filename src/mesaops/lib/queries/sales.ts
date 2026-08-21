import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/lib/apiClient';
import { mesaOpsPath } from '@mesaops/lib/apiBase';

// Loose API shapes (supersets of the client types; the server adds organizationId,
// version, timestamps and an 'ordered' inquiry status, so we keep status as string).
export interface ApiCustomer {
  id: string; name: string; gstNumber: string; contactPerson: string; phone: string;
  email: string; billingAddress: string; deliveryAddress: string; paymentTerms: string; status: string;
}
export interface ApiInquiry {
  id: string; inquiryNumber: string; customerId: string; product: string; drawingRef: string;
  quantity: number; expectedDeliveryDate: string; remarks: string; status: string;
  attachment?: string | null; quotationPrice?: number | null;
}
export interface ApiOrder {
  id: string; soNumber: string; inquiryId: string; customerId: string; product: string;
  quantity: number; deliveryDate: string; priority: string; specialInstructions: string; status: string;
}
export interface ApiMember {
  id: string; employeeCode: string; role: string; department: string; shift: string; line: string;
  status: string; user: { email: string; name: string };
}

const keys = {
  customers: ['customers'] as const,
  inquiries: ['inquiries'] as const,
  orders: ['orders'] as const,
  members: ['members'] as const,
};

/* ---- customers ---- */
export function useCustomers() {
  return useQuery({ queryKey: keys.customers, queryFn: () => api.get<ApiCustomer[]>(mesaOpsPath('/customers')) });
}
export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ApiCustomer>) => api.post<ApiCustomer>(mesaOpsPath('/customers'), body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.customers }),
  });
}

/* ---- inquiries ---- */
export function useInquiries() {
  return useQuery({ queryKey: keys.inquiries, queryFn: () => api.get<ApiInquiry[]>(mesaOpsPath('/inquiries')) });
}
export function useCreateInquiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<ApiInquiry>(mesaOpsPath('/inquiries'), body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.inquiries }),
  });
}
export function useQuoteInquiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, quotationPrice }: { id: string; quotationPrice: number }) =>
      api.post<ApiInquiry>(mesaOpsPath(`/inquiries/${id}/quote`), { quotationPrice }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.inquiries }),
  });
}

/* ---- orders ---- */
export function useOrders() {
  return useQuery({ queryKey: keys.orders, queryFn: () => api.get<ApiOrder[]>(mesaOpsPath('/orders')) });
}
export function useConfirmOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { inquiryId: string; priority?: string }) => api.post<ApiOrder>(mesaOpsPath('/orders'), body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.orders });
      qc.invalidateQueries({ queryKey: keys.inquiries });
    },
  });
}
export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean }>(mesaOpsPath(`/orders/${id}/cancel`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.orders });
      qc.invalidateQueries({ queryKey: keys.inquiries });
    },
  });
}

/* ---- directory ---- */
export function useMembers() {
  return useQuery({ queryKey: keys.members, queryFn: () => api.get<ApiMember[]>(mesaOpsPath('/members')) });
}
