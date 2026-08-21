import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/lib/apiClient';

export type ErpComplianceArtifactKind = 'outbound_e_invoice' | 'e_way_bill' | 'inbound_e_invoice';
export type ErpTaxDocumentKind = ErpComplianceArtifactKind | 'gstr2b';

export interface ErpExternalEvidenceVerification {
  verifierReference: string;
  verifiedAt: string;
  signature: string;
}

export interface ErpComplianceRuleProfile {
  id: string;
  legalEntityId: string;
  jurisdiction: string;
  artifactKind: ErpComplianceArtifactKind;
  version: string;
  effectiveFrom: string;
  effectiveTo?: string;
  status: 'draft' | 'approved' | 'retired';
  rules: {
    enabled?: boolean;
    documentTypes?: string[];
    supplyTypes?: string[];
    exemptSupplyTypes?: string[];
    minimumDocumentValue?: string;
    minimumDistanceKm?: number;
    maximumDocumentAgeDays?: number;
    notes?: string;
  };
  sourceReference: string;
  sourceEvidence: Record<string, unknown>;
  sourceChecksum: string;
  rowVersion: number;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ErpTaxDocument {
  id: string;
  legalEntityId: string;
  financialYearId: string;
  sourceDocumentId?: string;
  documentKind: ErpTaxDocumentKind;
  provider: string;
  providerReference: string;
  status: string;
  supplierGstin: string;
  recipientGstin: string;
  documentType: string;
  documentNumber: string;
  documentDate?: string;
  irn: string;
  acknowledgementNumber: string;
  acknowledgementAt?: string;
  signedPayload: Record<string, unknown>;
  submittedPayload: Record<string, unknown>;
  qrData: string;
  transporter: Record<string, unknown>;
  vehicle: Record<string, unknown>;
  validUntil?: string;
  cancellation: Record<string, unknown>;
  reconciliation: Record<string, unknown>;
  itcStatus: 'pending' | 'eligible' | 'blocked' | 'mismatched' | 'reversed' | 'claimed';
  ruleProfileVersion: string;
  evidenceHash: string;
  rowVersion: number;
  makerMembershipId: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ErpComplianceRuleProfileCreate {
  artifactKind: ErpComplianceArtifactKind;
  version: string;
  effectiveFrom: string;
  effectiveTo?: string;
  rules: {
    enabled: boolean;
    documentTypes: string[];
    supplyTypes: string[];
    exemptSupplyTypes: string[];
    minimumDocumentValue: string;
    minimumDistanceKm: number;
    maximumDocumentAgeDays?: number;
    notes: string;
  };
  sourceReference: string;
  sourceEvidence: Record<string, unknown>;
  sourceChecksum: string;
}

export interface ErpOutboundEInvoiceCreate {
  sourceDocumentId: string;
  supplierGstin: string;
  recipientGstin: string;
  documentType: 'INV' | 'CRN' | 'DBN';
  supplyType: 'B2B' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' | 'DEXP';
  placeOfSupply: string;
  reverseCharge: boolean;
  dispatchDetails: Record<string, unknown>;
  shipTo: Record<string, unknown>;
}

export interface ErpEWayBillCreate {
  sourceDocumentId: string;
  supplierGstin: string;
  recipientGstin: string;
  documentType: 'INV' | 'CHL' | 'BIL' | 'BOE' | 'OTH';
  supplyType: 'supply' | 'job_work' | 'transfer' | 'return' | 'other';
  subSupplyType: string;
  transactionType: 'regular' | 'bill_to_ship_to' | 'bill_from_dispatch_from' | 'combination';
  distanceKm: number;
  transporter: {
    transporterId: string;
    transporterName: string;
    fromPlace: string;
    fromStateCode: string;
    fromPincode: string;
    toPlace: string;
    toStateCode: string;
    toPincode: string;
  };
  vehicle: {
    mode: 'road' | 'rail' | 'air' | 'ship' | 'in_transit';
    vehicleNumber: string;
    transporterDocumentNumber: string;
    transporterDocumentDate?: string;
    vehicleType: 'regular' | 'odc';
  };
}

export interface ErpExternalEWayBillCreate {
  sourceDocumentId?: string;
  businessDate: string;
  supplierGstin: string;
  recipientGstin: string;
  documentType: 'INV' | 'CHL' | 'BIL' | 'BOE' | 'OTH';
  documentNumber: string;
  eWayBillNumber: string;
  issuedAt: string;
  validUntil: string;
  transporter: ErpEWayBillCreate['transporter'];
  vehicle: ErpEWayBillCreate['vehicle'];
  evidence: Record<string, unknown>;
  evidenceHash: string;
  externalVerification: ErpExternalEvidenceVerification;
}

export interface ErpInboundEInvoiceCreate {
  sourceDocumentId?: string;
  supplierGstin: string;
  recipientGstin: string;
  documentType: 'INV' | 'CRN' | 'DBN';
  documentNumber: string;
  documentDate: string;
  irn: string;
  acknowledgementNumber: string;
  acknowledgementAt: string;
  signedPayload: Record<string, unknown>;
  signedPayloadHash: string;
  taxableValue: string;
  taxAmount: string;
  totalAmount: string;
  provider: string;
  providerReference: string;
  origin: 'provider' | 'json_upload' | 'supplier_portal';
  externalVerification: ErpExternalEvidenceVerification;
}

export interface ErpGstr2bUpload {
  returnPeriod: string;
  generatedAt: string;
  recipientGstin: string;
  sourceReference: string;
  sourcePayload: Record<string, unknown>;
  sourcePayloadHash: string;
  externalVerification: ErpExternalEvidenceVerification;
  entries: Array<{
    supplierGstin: string;
    documentType: 'INV' | 'CRN' | 'DBN';
    documentNumber: string;
    documentDate: string;
    irn?: string;
    taxableValue: string;
    taxAmount: string;
    totalAmount: string;
    portalItcAvailability: 'available' | 'not_available' | 'reversal';
    reason: string;
  }>;
}

const paths: Record<ErpTaxDocumentKind, string> = {
  outbound_e_invoice: 'e-invoices/outbound',
  e_way_bill: 'e-way-bills',
  inbound_e_invoice: 'e-invoices/inbound',
  gstr2b: 'gstr2b',
};
const root = (entityId: string) => `/mesaerp/v1/entities/${entityId}`;
const keys = {
  all: (entityId: string) => ['mesaerp', entityId, 'india-compliance'] as const,
  profiles: (entityId: string) => [...keys.all(entityId), 'profiles'] as const,
  documents: (entityId: string, kind: ErpTaxDocumentKind) => [...keys.all(entityId), 'documents', kind] as const,
};

export function useErpComplianceRuleProfiles(entityId: string) {
  return useQuery({ queryKey: keys.profiles(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpComplianceRuleProfile[]>(`${root(entityId)}/compliance-rule-profiles`) });
}

export function useErpTaxDocuments(entityId: string, kind: ErpTaxDocumentKind) {
  return useQuery({ queryKey: keys.documents(entityId, kind), enabled: Boolean(entityId), queryFn: () => api.get<ErpTaxDocument[]>(`${root(entityId)}/${paths[kind]}`) });
}

export function useErpComplianceActions(entityId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.all(entityId) });
  const post = <T,>(path: string, body: unknown, requestKey: string) => api.postIdempotent<T>(`${root(entityId)}/${path}`, body, requestKey);
  return {
    createProfile: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpComplianceRuleProfileCreate; requestKey: string }) => post<ErpComplianceRuleProfile>('compliance-rule-profiles', input, requestKey), onSuccess: refresh }),
    approveProfile: useMutation({ mutationFn: ({ profileId, expectedRowVersion, requestKey }: { profileId: string; expectedRowVersion: number; requestKey: string }) => post<ErpComplianceRuleProfile>(`compliance-rule-profiles/${profileId}/approve`, { expectedRowVersion }, requestKey), onSuccess: refresh }),
    createOutbound: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpOutboundEInvoiceCreate; requestKey: string }) => post<ErpTaxDocument>('e-invoices/outbound', input, requestKey), onSuccess: refresh }),
    approveOutbound: useMutation({ mutationFn: ({ documentId, expectedRowVersion, requestKey }: { documentId: string; expectedRowVersion: number; requestKey: string }) => post<ErpTaxDocument>(`e-invoices/outbound/${documentId}/approve`, { expectedRowVersion }, requestKey), onSuccess: refresh }),
    submitOutbound: useMutation({ mutationFn: ({ documentId, expectedRowVersion, requestKey }: { documentId: string; expectedRowVersion: number; requestKey: string }) => post<ErpTaxDocument>(`e-invoices/outbound/${documentId}/submit`, { expectedRowVersion }, requestKey), onSuccess: refresh }),
    importOutboundAcknowledgement: useMutation({ mutationFn: ({ documentId, input, requestKey }: { documentId: string; input: { expectedRowVersion: number; provider: string; providerReference: string; irn: string; acknowledgementNumber: string; acknowledgementAt: string; signedPayload: Record<string, unknown>; signedPayloadHash: string; qrData: string; externalVerification: ErpExternalEvidenceVerification }; requestKey: string }) => post<ErpTaxDocument>(`e-invoices/outbound/${documentId}/import-acknowledgement`, input, requestKey), onSuccess: refresh }),
    cancelOutbound: useMutation({ mutationFn: ({ documentId, expectedRowVersion, reasonCode, reason, requestKey }: { documentId: string; expectedRowVersion: number; reasonCode: '1' | '2' | '3' | '4'; reason: string; requestKey: string }) => post<ErpTaxDocument>(`e-invoices/outbound/${documentId}/cancel`, { expectedRowVersion, reasonCode, reason }, requestKey), onSuccess: refresh }),
    createEWayBill: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpEWayBillCreate; requestKey: string }) => post<ErpTaxDocument>('e-way-bills', input, requestKey), onSuccess: refresh }),
    createExternalEWayBill: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpExternalEWayBillCreate; requestKey: string }) => post<ErpTaxDocument>('e-way-bills/external-evidence', input, requestKey), onSuccess: refresh }),
    approveEWayBill: useMutation({ mutationFn: ({ documentId, expectedRowVersion, requestKey }: { documentId: string; expectedRowVersion: number; requestKey: string }) => post<ErpTaxDocument>(`e-way-bills/${documentId}/approve`, { expectedRowVersion }, requestKey), onSuccess: refresh }),
    generateEWayBill: useMutation({ mutationFn: ({ documentId, expectedRowVersion, requestKey }: { documentId: string; expectedRowVersion: number; requestKey: string }) => post<ErpTaxDocument>(`e-way-bills/${documentId}/generate`, { expectedRowVersion }, requestKey), onSuccess: refresh }),
    verifyExternalEWayBill: useMutation({ mutationFn: ({ documentId, expectedRowVersion, requestKey }: { documentId: string; expectedRowVersion: number; requestKey: string }) => post<ErpTaxDocument>(`e-way-bills/${documentId}/verify-external`, { expectedRowVersion }, requestKey), onSuccess: refresh }),
    updateEWayBillVehicle: useMutation({ mutationFn: ({ documentId, input, requestKey }: { documentId: string; input: { expectedRowVersion: number; vehicle: ErpEWayBillCreate['vehicle']; reasonCode: '1' | '2' | '3' | '4'; reason: string }; requestKey: string }) => post<ErpTaxDocument>(`e-way-bills/${documentId}/update-vehicle`, input, requestKey), onSuccess: refresh }),
    extendEWayBill: useMutation({ mutationFn: ({ documentId, input, requestKey }: { documentId: string; input: { expectedRowVersion: number; remainingDistanceKm: number; reasonCode: '1' | '2' | '4' | '5' | '99'; reason: string; fromPlace: string; fromStateCode: string; fromPincode: string; transitType: 'movement' | 'road' | 'warehouse' | 'other'; vehicle: ErpEWayBillCreate['vehicle'] }; requestKey: string }) => post<ErpTaxDocument>(`e-way-bills/${documentId}/extend`, input, requestKey), onSuccess: refresh }),
    cancelEWayBill: useMutation({ mutationFn: ({ documentId, expectedRowVersion, reasonCode, reason, requestKey }: { documentId: string; expectedRowVersion: number; reasonCode: '1' | '2' | '3' | '4'; reason: string; requestKey: string }) => post<ErpTaxDocument>(`e-way-bills/${documentId}/cancel`, { expectedRowVersion, reasonCode, reason }, requestKey), onSuccess: refresh }),
    createInbound: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpInboundEInvoiceCreate; requestKey: string }) => post<ErpTaxDocument>('e-invoices/inbound', input, requestKey), onSuccess: refresh }),
    uploadGstr2b: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpGstr2bUpload; requestKey: string }) => post<ErpTaxDocument>('gstr2b', input, requestKey), onSuccess: refresh }),
    reconcileInbound: useMutation({ mutationFn: ({ documentId, expectedRowVersion, gstr2bDocumentId, requestKey }: { documentId: string; expectedRowVersion: number; gstr2bDocumentId: string; requestKey: string }) => post<ErpTaxDocument>(`e-invoices/inbound/${documentId}/reconcile-gstr2b`, { expectedRowVersion, gstr2bDocumentId }, requestKey), onSuccess: refresh }),
    decideItc: useMutation({ mutationFn: ({ documentId, expectedRowVersion, status, reason, requestKey }: { documentId: string; expectedRowVersion: number; status: 'blocked' | 'reversed' | 'claimed'; reason: string; requestKey: string }) => post<ErpTaxDocument>(`e-invoices/inbound/${documentId}/itc`, { expectedRowVersion, status, reason }, requestKey), onSuccess: refresh }),
  };
}
