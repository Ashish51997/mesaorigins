import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../apiClient';
import type { ErpRfqLine, ErpSupplierQuotationLine, ErpVendorDocumentCreate } from './mesaerp';

export interface SupplierPortalWorkspace {
  user: { id: string; name: string; email: string; permissions: string[] };
  vendor: {
    id: string; vendorCode: string; legalName: string; tradeName: string; gstin: string;
    addresses: unknown; contacts: unknown; paymentTerms: string; currency: string;
    lifecycleStatus: string; complianceStatus: string;
  };
  documents: Array<{ id: string; documentType: string; documentNumber: string; expiresOn?: string; status: string; storageRef: string; rowVersion: number }>;
  rfqInvitations: Array<{
    id: string; status: string;
    rfq: { id: string; rfqNumber: string; title: string; description: string; currency: string; responseDueAt: string; status: string; lines: ErpRfqLine[]; quotations: Array<{ id: string; quotationNumber: string; status: string; grandTotal: string; currency: string; lines: ErpSupplierQuotationLine[] }> };
  }>;
  purchaseOrders: Array<{ id: string; documentNumber: string; documentDate: string; dueDate?: string; status: string; currency: string; grandTotal: string; lines: Array<{ id: string; description: string; quantity: string; uom: string; promisedOn?: string }> }>;
  acknowledgements: Array<{ id: string; purchaseOrderId: string; status: string; responseNote: string; respondedAt: string }>;
  asns: Array<{ id: string; purchaseOrderId: string; asnNumber: string; status: string; expectedArrivalOn: string; carrier: string; trackingReference: string }>;
  supplierInvoices: Array<{ id: string; documentNumber: string; documentDate: string; dueDate?: string; status: string; currency: string; grandTotal: string; rowVersion: number }>;
  invoiceEvidence: Array<{ id: string; supplierInvoiceId: string; evidenceType: string; externalReference: string; storageRef: string; createdAt: string }>;
  changeCases: Array<{ id: string; changeType: string; proposedValues: Record<string, unknown>; status: string; decisionReason: string; rowVersion: number; createdAt: string }>;
  disputes: Array<{ id: string; subject: string; description: string; status: string; requestedDebitAmount: string; vendorResponse: string; resolution: string; rowVersion: number; createdAt: string }>;
  paymentStatus: Array<{ id: string; proposalNumber: string; supplierInvoiceId: string; status: string; amount: string; currency: string; proposedPaymentOn: string; approvedAt?: string; paymentVoucher?: { status: string } }>;
  controls: { otherVendorsVisible: false; employeeApisVisible: false; financeJournalsVisible: false; binaryUploadAdapter: false };
}

interface SupplierQuotationInput {
  quotationNumber: string; currency: string; validUntil: string; promisedOn?: string;
  commercialResponse: Record<string, unknown>; technicalResponse: Record<string, unknown>;
  lines: Array<{ rfqLineId: string; quantity: string; unitRate: string; taxRate: string; taxAmount?: string; promisedOn?: string; technicalResponse: Record<string, unknown> }>;
}

const BASE = '/api/supplier-portal/v1';

export async function supplierPortalRequest<T>(method: string, path: string, body?: unknown, requestKey?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (requestKey) headers['Idempotency-Key'] = requestKey;
  const response = await fetch(`${BASE}${path}`, { method, credentials: 'include', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = data?.error ?? {};
    throw new ApiError(response.status, error.code || 'supplier_portal_error', error.message || response.statusText, error.details);
  }
  return data as T;
}

const workspaceKey = ['supplier-portal', 'workspace'] as const;

export function useSupplierPortalWorkspace(enabled = true) {
  return useQuery({ queryKey: workspaceKey, enabled, retry: false, queryFn: () => supplierPortalRequest<SupplierPortalWorkspace>('GET', '/workspace') });
}

export function useSupplierPortalActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: workspaceKey });
  return {
    acceptInvite: useMutation({ mutationFn: (token: string) => supplierPortalRequest('POST', '/auth/accept', { token }), onSuccess: refresh }),
    logout: useMutation({ mutationFn: () => supplierPortalRequest('POST', '/auth/logout', {}), onSuccess: () => queryClient.removeQueries({ queryKey: workspaceKey }) }),
    requestChange: useMutation({ mutationFn: ({ input, requestKey }: { input: { changeType: 'profile' | 'legal' | 'gstin' | 'bank'; proposedValues: Record<string, unknown> }; requestKey: string }) => supplierPortalRequest('POST', '/profile-change-cases', input, requestKey), onSuccess: refresh }),
    addDocument: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpVendorDocumentCreate; requestKey: string }) => supplierPortalRequest('POST', '/documents', input, requestKey), onSuccess: refresh }),
    submitQuotation: useMutation({ mutationFn: ({ rfqId, input, requestKey }: { rfqId: string; input: SupplierQuotationInput; requestKey: string }) => supplierPortalRequest('POST', `/rfqs/${rfqId}/quotations`, input, requestKey), onSuccess: refresh }),
    acknowledgePo: useMutation({ mutationFn: ({ purchaseOrderId, input, requestKey }: { purchaseOrderId: string; input: { status: 'accepted' | 'change_requested'; responseNote: string; proposedChanges: Record<string, unknown> }; requestKey: string }) => supplierPortalRequest('POST', `/purchase-orders/${purchaseOrderId}/acknowledgements`, input, requestKey), onSuccess: refresh }),
    createAsn: useMutation({ mutationFn: ({ input, requestKey }: { input: { purchaseOrderId: string; asnNumber: string; dispatchedOn: string; expectedArrivalOn: string; carrier: string; vehicleNumber: string; trackingReference: string; lines: Array<{ sourceLineId: string; quantity: string }> }; requestKey: string }) => supplierPortalRequest('POST', '/asns', input, requestKey), onSuccess: refresh }),
    addInvoiceEvidence: useMutation({ mutationFn: ({ supplierInvoiceId, input, requestKey }: { supplierInvoiceId: string; input: { evidenceType: 'invoice' | 'e_invoice' | 'supporting'; storageRef: string; checksum: string; externalReference: string; metadata: Record<string, unknown> }; requestKey: string }) => supplierPortalRequest('POST', `/supplier-invoices/${supplierInvoiceId}/evidence`, input, requestKey), onSuccess: refresh }),
    respondToDispute: useMutation({ mutationFn: ({ disputeId, expectedRowVersion, response, requestKey }: { disputeId: string; expectedRowVersion: number; response: string; requestKey: string }) => supplierPortalRequest('POST', `/disputes/${disputeId}/responses`, { expectedRowVersion, response }, requestKey), onSuccess: refresh }),
  };
}
