import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/lib/apiClient';

export interface ErpLegalEntity {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  countryCode: string;
  baseCurrency: string;
  fiscalYearStartMonth: number;
  version: number;
}

export interface ErpLegalEntityCreate {
  code: string;
  name: string;
  countryCode: string;
  baseCurrency: string;
  fiscalYearStartMonth: number;
}

export interface ErpAccount {
  id: string;
  legalEntityId: string;
  code: string;
  name: string;
  accountType: string;
  currency: string;
  allowPosting: boolean;
}

export interface ErpVendor {
  id: string;
  legalEntityId: string;
  vendorCode: string;
  legalName: string;
  tradeName: string;
  pan: string;
  gstin: string;
  msmeNumber: string;
  paymentTerms: string;
  currency: string;
  creditDays: number;
  lifecycleStatus: ErpVendorLifecycleStatus;
  complianceStatus: string;
  rowVersion: number;
  categories: string[];
}

export type ErpVendorLifecycleStatus =
  | 'invited'
  | 'onboarding'
  | 'under_review'
  | 'approved'
  | 'conditionally_approved'
  | 'suspended'
  | 'blocked';

export interface ErpVoucherLine {
  ledgerAccountId: string;
  debit: string;
  credit: string;
  narration: string;
  dimensions: Record<string, string>;
}

export type ErpVoucherType =
  | 'contra'
  | 'payment'
  | 'receipt'
  | 'journal'
  | 'sales'
  | 'purchase'
  | 'credit_note'
  | 'debit_note'
  | 'stock_journal'
  | 'manufacturing_journal'
  | 'opening';

export interface ErpVoucher {
  id: string;
  legalEntityId: string;
  voucherType: ErpVoucherType;
  voucherDate: string;
  currencyCode: string;
  reference: string;
  narration: string;
  lines: ErpVoucherLine[];
  status: 'draft' | 'submitted' | 'approved' | 'posted' | 'reversed';
  version: number;
  voucherNumber?: string;
  createdAt: string;
  createdBy?: string;
}

export interface ErpPermission {
  id: string;
  key: `mesaerp.${string}`;
  label: string;
  description: string;
  riskLevel: string;
}

export interface ErpRole {
  id: string;
  name: string;
  version: number;
  isSystem: boolean;
  permissions: Array<{ key: string; effect: string; riskLevel: string }>;
}

export interface ErpRoleAssignment {
  id: string;
  legalEntityId: string;
  membership: { id: string; employeeCode: string; name: string; email: string };
  role: { id: string; name: string };
  permissions: Array<{ key: string; effect: string }>;
  status: string;
  validFrom?: string | null;
  validTo?: string | null;
  rowVersion: number;
}

export interface ErpVendorCreate {
  vendorCode: string;
  legalName: string;
  tradeName?: string;
  pan?: string;
  gstin?: string;
  msmeNumber?: string;
  categories?: string[];
  paymentTerms?: string;
  currency?: string;
  creditDays?: number;
}

export interface ErpSupplierPerformance {
  evidenceOnly: true;
  rfqs: { invited: number; responded: number; selected: number };
  purchaseOrders: { approved: number; accepted: number; changeRequested: number };
  receipts: { recorded: number; withPromisedDateEvidence: number; onOrBeforePromisedDate: number; leadTimeEvidenceStatus: 'available' | 'not_available' };
  matches: { total: number; matched: number; varianceOrDisputed: number; quantityVariance: string; priceVariance: string; taxVariance: string; totalVariance: string };
  inspection: { evidenceStatus: 'not_available'; acceptedQuantity: null; rejectedQuantity: null; limitation: string };
  disputes: { total: number; open: number; resolved: number; rejected: number };
  complianceDocuments: { total: number; currentVerified: number; expired: number; upcomingExpiryWithinDays: number; upcomingExpiry: number; pendingReview: number; withoutExpiry: number; asOfDate: string };
}

export interface ErpRfqLine {
  id: string; lineNumber: number; itemId?: string; description: string; quantity: string; uom: string;
  requiredOn?: string; technicalSpecification: Record<string, unknown>;
}

export interface ErpSupplierQuotationLine {
  id: string; rfqLineId: string; lineNumber: number; quantity: string; unitRate: string;
  taxRate: string; taxAmount: string; lineTotal: string; promisedOn?: string;
  technicalResponse: Record<string, unknown>;
}

export interface ErpSupplierQuotation {
  id: string; rfqId: string; invitationId: string; vendorId: string; quotationNumber: string;
  status: string; currency: string; subtotal: string; taxTotal: string; grandTotal: string;
  validUntil: string; promisedOn?: string; rowVersion: number; submittedAt: string;
  vendor: ErpVendor; lines: ErpSupplierQuotationLine[];
}

export interface ErpRfq {
  id: string; legalEntityId: string; rfqNumber: string; title: string; description: string;
  currency: string; responseDueAt: string; status: string; rowVersion: number; createdBy: string;
  issuedBy: string; selectedQuotationId?: string; lines: ErpRfqLine[];
  invitations: Array<{ id: string; vendorId: string; status: string; vendor: ErpVendor }>;
  quotations: ErpSupplierQuotation[];
}

export interface ErpRateAgreement {
  id: string; vendorId: string; agreementNumber: string; status: string; currency: string;
  validFrom: string; validUntil: string; rowVersion: number; createdBy: string; activatedBy: string;
}

export interface ErpSupplierWorkspace {
  vendors: Array<ErpVendor & { performance: ErpSupplierPerformance }>;
  rfqs: ErpRfq[];
  agreements: ErpRateAgreement[];
  purchaseOrders: ErpSourceToPayDocument[];
  acknowledgements: Array<{ id: string; purchaseOrderId: string; vendorId: string; status: string; responseNote: string; proposedChanges: Record<string, unknown>; respondedAt: string }>;
  asns: Array<{ id: string; purchaseOrderId: string; vendorId: string; asnNumber: string; status: string; dispatchedOn: string; expectedArrivalOn: string; carrier: string; trackingReference: string }>;
  documents: Array<{ id: string; vendorId: string; documentType: string; documentNumber: string; expiresOn?: string; status: string; storageRef: string; checksum: string; rowVersion: number }>;
  changes: Array<{ id: string; vendorId: string; changeType: string; proposedValues: Record<string, unknown>; status: string; decisionReason: string; rowVersion: number; createdAt: string }>;
  disputes: Array<{ id: string; vendorId: string; supplierInvoiceId?: string; subject: string; description: string; status: string; requestedDebitAmount: string; vendorResponse: string; resolution: string; rowVersion: number; createdAt: string }>;
  proposals: Array<{ id: string; vendorId: string; supplierInvoiceId: string; proposalNumber: string; status: string; amount: string; currency: string; proposedPaymentOn: string; paymentVoucherId?: string; rowVersion: number }>;
  invoices: ErpSourceToPayDocument[];
  evidence: Array<{ id: string; vendorId: string; supplierInvoiceId: string; evidenceType: string; storageRef: string; checksum: string; externalReference: string; createdAt: string }>;
  controls: { binaryUploadAdapter: boolean; paymentStopsAtDraftVoucher: boolean; bankInitiation: boolean };
}

export interface ErpRfqCreate {
  rfqNumber: string; title: string; description: string; currency: string; responseDueAt: string;
  commercialTerms: Record<string, unknown>; technicalTerms: Record<string, unknown>;
  invitedVendorIds: string[];
  lines: Array<{ itemId?: string; description: string; quantity: string; uom: string; requiredOn?: string; technicalSpecification: Record<string, unknown> }>;
}

export interface ErpPortalInviteCreate {
  email: string; name: string; expiresInHours: number; permissions: string[];
}

export interface ErpVendorDocumentCreate {
  documentType: string; documentNumber: string; issuedOn?: string; expiresOn?: string;
  storageRef: string; checksum: string; metadata: Record<string, unknown>;
}

export interface ErpDisputeCreate {
  vendorId: string; supplierInvoiceId?: string; matchCaseId?: string; subject: string;
  description: string; requestedDebitAmount: string;
}

export interface ErpPaymentProposalCreate {
  vendorId: string; supplierInvoiceId: string; proposalNumber: string; amount: string; currency: string;
  proposedPaymentOn: string; payableAccountId: string; settlementAccountId: string; narration: string;
}

export interface ErpVoucherCreate {
  voucherType: ErpVoucherType;
  voucherDate: string;
  currencyCode: string;
  reference: string;
  narration: string;
  lines: ErpVoucherLine[];
}

export interface ErpRoleAssignmentCreate {
  membershipId: string;
  roleId: string;
  validFrom?: string;
  validTo?: string;
}

export interface ErpRoleCreate {
  name: string;
  grants: string[];
}

export type ErpSourceToPayDocumentType =
  | 'purchase_requisition'
  | 'purchase_order'
  | 'goods_receipt'
  | 'supplier_invoice';

export interface ErpSourceToPayLineInput {
  itemId?: string;
  description: string;
  hsnSacCode?: string;
  quantity: string;
  uom: string;
  unitPrice?: string;
  discountAmount?: string;
  taxRate?: string;
  taxAmount?: string;
  warehouseCode?: string;
  batchNumber?: string;
  promisedOn?: string;
  sourceLineId?: string;
  dimensions?: Record<string, unknown>;
}

export interface ErpSourceToPayDocumentCreate {
  documentNumber?: string;
  documentDate: string;
  dueDate?: string;
  vendorId?: string;
  sourceDocumentId?: string;
  currency?: string;
  exchangeRate?: string;
  terms?: string[];
  shipping?: Record<string, unknown>;
  originType?: 'manual' | 'import' | 'api' | 'handoff';
  originMetadata?: Record<string, unknown>;
  lines: ErpSourceToPayLineInput[];
}

export interface ErpSourceToPayDocumentLine {
  id: string;
  lineNumber: number;
  itemId?: string;
  description: string;
  hsnSacCode: string;
  quantity: string;
  uom: string;
  unitPrice: string;
  discountAmount: string;
  taxableAmount: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
  warehouseCode: string;
  batchNumber: string;
  promisedOn?: string;
  sourceLineId?: string;
  dimensions: Record<string, unknown>;
}

export interface ErpSourceToPayDocument {
  id: string;
  organizationId: string;
  legalEntityId: string;
  financialYearId: string;
  documentType: ErpSourceToPayDocumentType;
  documentNumber: string;
  documentDate: string;
  dueDate?: string;
  status: 'draft' | 'submitted' | 'approved' | 'posted' | 'cancelled' | 'closed';
  approvalState: string;
  vendorId?: string;
  partySnapshot: Record<string, unknown>;
  currency: string;
  exchangeRate: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  roundingAmount: string;
  grandTotal: string;
  baseCurrencyTotal: string;
  taxSummary: Record<string, unknown>;
  terms: unknown;
  shipping: Record<string, unknown>;
  originType: string;
  originMetadata: Record<string, unknown>;
  rowVersion: number;
  createdBy: string;
  approvedBy?: string;
  submittedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  lines: ErpSourceToPayDocumentLine[];
  links: Array<{
    id: string;
    fromDocumentId: string;
    toDocumentId: string;
    relationship: string;
    snapshotHash: string;
  }>;
}

export interface ErpPurchaseMatchCase {
  id: string;
  organizationId: string;
  legalEntityId: string;
  vendorId: string;
  supplierInvoiceId: string;
  purchaseOrderId: string;
  goodsReceiptId: string;
  status: 'pending' | 'matched' | 'variance' | 'disputed' | 'approved';
  quantityVariance: string;
  priceVariance: string;
  taxVariance: string;
  totalVariance: string;
  details: Array<Record<string, unknown>>;
  makerMembershipId: string;
  checkerMembershipId?: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ErpCustomer {
  id: string;
  organizationId: string;
  legalEntityId: string;
  customerCode: string;
  legalName: string;
  tradeName: string;
  pan: string;
  gstin: string;
  addresses: unknown;
  contacts: unknown;
  paymentTerms: string;
  currency: string;
  creditLimit: string;
  creditDays: number;
  status: 'active' | 'on_hold' | 'blocked';
  rowVersion: number;
  originMetadata: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ErpCustomerCreate {
  customerCode: string;
  legalName: string;
  tradeName?: string;
  pan?: string;
  gstin?: string;
  addresses?: Array<Record<string, unknown>>;
  contacts?: Array<Record<string, unknown>>;
  paymentTerms?: string;
  currency?: string;
  creditLimit?: string;
  creditDays?: number;
  status?: 'active' | 'on_hold' | 'blocked';
  originMetadata?: Record<string, unknown>;
}

export type ErpSalesDocumentType = 'sales_order' | 'sales_invoice';

export interface ErpSalesDocumentLineInput {
  itemId: string;
  description: string;
  hsnSacCode?: string;
  quantity: string;
  uom: string;
  unitPrice: string;
  discountAmount?: string;
  taxRate?: string;
  taxAmount?: string;
  warehouseCode?: string;
  batchNumber?: string;
  promisedOn?: string;
  sourceLineId?: string;
  dimensions?: Record<string, unknown>;
}

export interface ErpSalesDocumentCreate {
  documentNumber?: string;
  documentDate: string;
  dueDate?: string;
  customerId: string;
  sourceSalesOrderId?: string;
  currency?: string;
  exchangeRate?: string;
  terms?: string[];
  shipping?: Record<string, unknown>;
  originType?: 'manual' | 'import' | 'api' | 'mesaleads_snapshot';
  originMetadata?: Record<string, unknown>;
  lines: ErpSalesDocumentLineInput[];
}

export interface ErpSalesDocument {
  id: string;
  organizationId: string;
  legalEntityId: string;
  financialYearId: string;
  documentType: ErpSalesDocumentType;
  documentNumber: string;
  documentDate: string;
  dueDate?: string;
  status: 'draft' | 'submitted' | 'approved';
  approvalState: string;
  customerId: string;
  partySnapshot: unknown;
  currency: string;
  exchangeRate: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  roundingAmount: string;
  grandTotal: string;
  baseCurrencyTotal: string;
  taxSummary: unknown;
  terms: unknown;
  shipping: unknown;
  originType: string;
  originMetadata: unknown;
  sourceSnapshotHash: string;
  rowVersion: number;
  createdBy: string;
  approvedBy?: string;
  submittedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  lines: Array<ErpSalesDocumentLineInput & {
    id: string;
    lineNumber: number;
    taxableAmount: string;
    taxAmount: string;
    lineTotal: string;
    hsnSacCode: string;
    discountAmount: string;
    warehouseCode: string;
    batchNumber: string;
    dimensions: Record<string, unknown>;
  }>;
  links: Array<{ id: string; fromDocumentId: string; toDocumentId: string; relationship: string; snapshotHash: string }>;
}

export type ErpProductionDemandType = 'sales_order' | 'internal' | 'forecast' | 'replenishment' | 'trial' | 'rework' | 'import';

export interface ErpProductionDemandCreate {
  demandNumber?: string;
  demandDate: string;
  demandType: ErpProductionDemandType;
  itemId: string;
  quantity: string;
  uom: string;
  requiredOn?: string;
  plantCode?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  bomSnapshot?: Record<string, unknown>;
  materialRequirements?: Array<Record<string, unknown>>;
  suggestions?: Array<Record<string, unknown>>;
  sourceSalesOrderId?: string;
  sourceLineId?: string;
  originType?: 'manual' | 'api' | 'import' | 'sales_order_snapshot';
  originMetadata?: Record<string, unknown>;
}

export interface ErpProductionDemand {
  id: string;
  organizationId: string;
  legalEntityId: string;
  financialYearId: string;
  demandNumber: string;
  demandType: string;
  itemId: string;
  quantity: string;
  uom: string;
  requiredOn?: string;
  status: 'draft' | 'approved' | 'released' | 'partially_completed' | 'completed' | 'cancelled';
  bomSnapshot: unknown;
  materialRequirements: unknown;
  suggestions: unknown;
  originType: string;
  originMetadata: unknown;
  sourceSnapshotHash: string;
  rowVersion: number;
  makerMembershipId: string;
  approvedBy?: string;
  releasedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ErpManufacturingValuedLineInput {
  itemId?: string;
  description: string;
  quantity: string;
  uom?: string;
  rate: string;
  amount?: string;
  warehouseCode?: string;
  batchNumber?: string;
  dimensions?: Record<string, unknown>;
}

export interface ErpManufacturingOutputLineInput {
  itemId: string;
  description: string;
  quantity: string;
  uom: string;
  warehouseCode?: string;
  batchNumber?: string;
  outputType?: 'finished_good' | 'by_product' | 'scrap';
  dimensions?: Record<string, unknown>;
}

export interface ErpManufacturingVoucherCreate {
  voucherNumber?: string;
  voucherType?: 'issue' | 'return' | 'manufacturing' | 'completion' | 'rework';
  businessDate: string;
  productionDemandId?: string;
  batchNumber: string;
  materialLines?: ErpManufacturingValuedLineInput[];
  outputLines?: ErpManufacturingOutputLineInput[];
  laborLines?: ErpManufacturingValuedLineInput[];
  resourceLines?: ErpManufacturingValuedLineInput[];
  overheadLines?: ErpManufacturingValuedLineInput[];
  subcontractLines?: ErpManufacturingValuedLineInput[];
  recoveryCredits?: ErpManufacturingValuedLineInput[];
  qaDisposition?: { status: 'pending' | 'accepted' | 'hold' | 'rejected' | 'rework' | 'not_applicable'; reference?: string; notes?: string };
  originType?: 'manual' | 'api' | 'import' | 'mesaops_snapshot';
  originMetadata?: Record<string, unknown>;
}

export interface ErpBatchCost {
  id: string;
  organizationId: string;
  legalEntityId: string;
  financialYearId: string;
  productionDemandId?: string;
  manufacturingVoucherId: string;
  batchNumber: string;
  materialCost: string;
  laborCost: string;
  machineCost: string;
  overheadCost: string;
  subcontractCost: string;
  recoveryCredits: string;
  actualCost: string;
  outputQuantity: string;
  unitCost: string;
  costingMethod: string;
  calculationSnapshot: unknown;
  status: 'approved';
  sourceSnapshotHash: string;
  approvedAt?: string;
  approvedBy: string;
  createdAt: string;
}

export interface ErpManufacturingVoucher {
  id: string;
  organizationId: string;
  legalEntityId: string;
  financialYearId: string;
  productionDemandId?: string;
  voucherNumber: string;
  voucherType: string;
  businessDate: string;
  status: 'draft' | 'submitted' | 'approved' | 'posted';
  batchNumber: string;
  materialLines: unknown;
  outputLines: unknown;
  laborLines: unknown;
  resourceLines: unknown;
  overheadLines: unknown;
  subcontractLines: unknown;
  recoveryCredits: unknown;
  qaDisposition: unknown;
  materialValue: string;
  conversionValue: string;
  recoveryValue: string;
  actualCost: string;
  originType: string;
  originMetadata: unknown;
  sourceSnapshotHash: string;
  rowVersion: number;
  makerMembershipId: string;
  approvedBy?: string;
  postedBy?: string;
  approvedAt?: string;
  postedAt?: string;
  createdAt: string;
  updatedAt: string;
  batchCost?: ErpBatchCost;
}

const erpKeys = {
  entities: ['mesaerp', 'entities'] as const,
  accounts: (entityId: string) => ['mesaerp', entityId, 'accounts'] as const,
  vendors: (entityId: string) => ['mesaerp', entityId, 'vendors'] as const,
  vouchers: (entityId: string) => ['mesaerp', entityId, 'vouchers'] as const,
  roles: (entityId: string) => ['mesaerp', entityId, 'roles'] as const,
  permissions: (entityId: string) => ['mesaerp', entityId, 'permissions'] as const,
  assignments: (entityId: string) => ['mesaerp', entityId, 'role-assignments'] as const,
  sourceToPay: (entityId: string) => ['mesaerp', entityId, 'source-to-pay'] as const,
  sourceToPayDocuments: (entityId: string, documentType: ErpSourceToPayDocumentType) => (
    ['mesaerp', entityId, 'source-to-pay', documentType] as const
  ),
  purchaseMatches: (entityId: string) => ['mesaerp', entityId, 'purchase-matches'] as const,
  commercial: (entityId: string) => ['mesaerp', entityId, 'commercial'] as const,
  customers: (entityId: string) => ['mesaerp', entityId, 'commercial', 'customers'] as const,
  salesDocuments: (entityId: string, type: ErpSalesDocumentType) => ['mesaerp', entityId, 'commercial', type] as const,
  manufacturing: (entityId: string) => ['mesaerp', entityId, 'manufacturing'] as const,
  productionDemands: (entityId: string) => ['mesaerp', entityId, 'manufacturing', 'production-demands'] as const,
  manufacturingVouchers: (entityId: string) => ['mesaerp', entityId, 'manufacturing', 'vouchers'] as const,
  batchCosts: (entityId: string) => ['mesaerp', entityId, 'manufacturing', 'batch-costs'] as const,
  supplierWorkspace: (entityId: string) => ['mesaerp', entityId, 'supplier-workspace'] as const,
};

const SOURCE_TO_PAY_PATHS: Record<ErpSourceToPayDocumentType, string> = {
  purchase_requisition: 'purchase-requisitions',
  purchase_order: 'purchase-orders',
  goods_receipt: 'goods-receipts',
  supplier_invoice: 'supplier-invoices',
};

const idempotencyKey = (scope: string) => `${scope}:${crypto.randomUUID()}`;
export const createErpIdempotencyKey = idempotencyKey;

export function useErpEntities() {
  return useQuery({ queryKey: erpKeys.entities, queryFn: () => api.get<ErpLegalEntity[]>('/mesaerp/v1/entities') });
}

export function useCreateErpEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, requestKey }: { input: ErpLegalEntityCreate; requestKey: string }) => api.postIdempotent<ErpLegalEntity>(
      '/mesaerp/v1/entities',
      input,
      requestKey,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.entities }),
  });
}

export function useErpAccounts(entityId: string) {
  return useQuery({ queryKey: erpKeys.accounts(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpAccount[]>(`/mesaerp/v1/entities/${entityId}/accounts`) });
}

export function useErpVendors(entityId: string) {
  return useQuery({ queryKey: erpKeys.vendors(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpVendor[]>(`/mesaerp/v1/entities/${entityId}/vendors`) });
}

export function useErpVouchers(entityId: string) {
  return useQuery({ queryKey: erpKeys.vouchers(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpVoucher[]>(`/mesaerp/v1/entities/${entityId}/vouchers`) });
}

export function useErpRoles(entityId: string) {
  return useQuery({ queryKey: erpKeys.roles(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpRole[]>(`/mesaerp/v1/entities/${entityId}/access/roles`) });
}

export function useErpPermissions(entityId: string) {
  return useQuery({ queryKey: erpKeys.permissions(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpPermission[]>(`/mesaerp/v1/entities/${entityId}/access/permissions`) });
}

export function useErpRoleAssignments(entityId: string) {
  return useQuery({ queryKey: erpKeys.assignments(entityId), enabled: Boolean(entityId), queryFn: () => api.get<ErpRoleAssignment[]>(`/mesaerp/v1/entities/${entityId}/access/role-assignments`) });
}

export function useErpSourceToPayDocuments(entityId: string, documentType: ErpSourceToPayDocumentType) {
  const path = SOURCE_TO_PAY_PATHS[documentType];
  return useQuery({
    queryKey: erpKeys.sourceToPayDocuments(entityId, documentType),
    enabled: Boolean(entityId),
    queryFn: () => api.get<ErpSourceToPayDocument[]>(`/mesaerp/v1/entities/${entityId}/${path}`),
  });
}

export function useErpPurchaseMatches(entityId: string) {
  return useQuery({
    queryKey: erpKeys.purchaseMatches(entityId),
    enabled: Boolean(entityId),
    queryFn: () => api.get<ErpPurchaseMatchCase[]>(`/mesaerp/v1/entities/${entityId}/purchase-matches`),
  });
}

export function useCreateErpSourceToPayDocument(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentType, input, requestKey }: {
      documentType: ErpSourceToPayDocumentType;
      input: ErpSourceToPayDocumentCreate;
      requestKey: string;
    }) => api.postIdempotent<ErpSourceToPayDocument>(
      `/mesaerp/v1/entities/${entityId}/${SOURCE_TO_PAY_PATHS[documentType]}`,
      input,
      requestKey,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.sourceToPay(entityId) }),
  });
}

export function useTransitionErpSourceToPayDocument(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentType, documentId, action, expectedRowVersion, requestKey }: {
      documentType: ErpSourceToPayDocumentType;
      documentId: string;
      action: 'submit' | 'approve';
      expectedRowVersion: number;
      requestKey: string;
    }) => api.postIdempotent<ErpSourceToPayDocument>(
      `/mesaerp/v1/entities/${entityId}/${SOURCE_TO_PAY_PATHS[documentType]}/${documentId}/${action}`,
      { expectedRowVersion },
      requestKey,
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: erpKeys.sourceToPay(entityId) });
      queryClient.invalidateQueries({ queryKey: erpKeys.purchaseMatches(entityId) });
    },
  });
}

export function useCreateErpPurchaseMatch(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { purchaseOrderId: string; goodsReceiptId: string; supplierInvoiceId: string; requestKey: string }) => (
      api.postIdempotent<ErpPurchaseMatchCase>(
        `/mesaerp/v1/entities/${entityId}/purchase-matches`,
        {
          purchaseOrderId: input.purchaseOrderId,
          goodsReceiptId: input.goodsReceiptId,
          supplierInvoiceId: input.supplierInvoiceId,
        },
        input.requestKey,
      )
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.purchaseMatches(entityId) }),
  });
}

export function useApproveErpPurchaseMatch(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ matchCaseId, expectedRowVersion, reason, requestKey }: {
      matchCaseId: string;
      expectedRowVersion: number;
      reason: string;
      requestKey: string;
    }) => api.postIdempotent<ErpPurchaseMatchCase>(
      `/mesaerp/v1/entities/${entityId}/purchase-matches/${matchCaseId}/approve`,
      { expectedRowVersion, reason },
      requestKey,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.purchaseMatches(entityId) }),
  });
}

export function useErpCustomers(entityId: string) {
  return useQuery({
    queryKey: erpKeys.customers(entityId),
    enabled: Boolean(entityId),
    queryFn: () => api.get<ErpCustomer[]>(`/mesaerp/v1/entities/${entityId}/customers`),
  });
}

export function useErpSalesDocuments(entityId: string, documentType: ErpSalesDocumentType) {
  const path = documentType === 'sales_order' ? 'sales-orders' : 'sales-invoices';
  return useQuery({
    queryKey: erpKeys.salesDocuments(entityId, documentType),
    enabled: Boolean(entityId),
    queryFn: () => api.get<ErpSalesDocument[]>(`/mesaerp/v1/entities/${entityId}/${path}`),
  });
}

export function useCreateErpCustomer(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, requestKey }: { input: ErpCustomerCreate; requestKey: string }) => api.postIdempotent<ErpCustomer>(
      `/mesaerp/v1/entities/${entityId}/customers`,
      input,
      requestKey,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.customers(entityId) }),
  });
}

export function useCreateErpSalesDocument(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentType, input, requestKey }: {
      documentType: ErpSalesDocumentType;
      input: ErpSalesDocumentCreate;
      requestKey: string;
    }) => api.postIdempotent<ErpSalesDocument>(
      `/mesaerp/v1/entities/${entityId}/${documentType === 'sales_order' ? 'sales-orders' : 'sales-invoices'}`,
      input,
      requestKey,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.commercial(entityId) }),
  });
}

export function useTransitionErpSalesDocument(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentType, documentId, action, expectedRowVersion, requestKey }: {
      documentType: ErpSalesDocumentType;
      documentId: string;
      action: 'submit' | 'approve';
      expectedRowVersion: number;
      requestKey: string;
    }) => api.postIdempotent<ErpSalesDocument>(
      `/mesaerp/v1/entities/${entityId}/${documentType === 'sales_order' ? 'sales-orders' : 'sales-invoices'}/${documentId}/${action}`,
      { expectedRowVersion },
      requestKey,
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: erpKeys.commercial(entityId) });
      queryClient.invalidateQueries({ queryKey: erpKeys.productionDemands(entityId) });
    },
  });
}

export function useErpProductionDemands(entityId: string) {
  return useQuery({
    queryKey: erpKeys.productionDemands(entityId),
    enabled: Boolean(entityId),
    queryFn: () => api.get<ErpProductionDemand[]>(`/mesaerp/v1/entities/${entityId}/production-demands`),
  });
}

export function useCreateErpProductionDemand(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, requestKey }: { input: ErpProductionDemandCreate; requestKey: string }) => api.postIdempotent<ErpProductionDemand>(
      `/mesaerp/v1/entities/${entityId}/production-demands`,
      input,
      requestKey,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.productionDemands(entityId) }),
  });
}

export function useTransitionErpProductionDemand(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ demandId, action, expectedRowVersion, requestKey }: {
      demandId: string;
      action: 'approve' | 'release';
      expectedRowVersion: number;
      requestKey: string;
    }) => api.postIdempotent<ErpProductionDemand>(
      `/mesaerp/v1/entities/${entityId}/production-demands/${demandId}/${action}`,
      { expectedRowVersion },
      requestKey,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.productionDemands(entityId) }),
  });
}

export function useErpManufacturingVouchers(entityId: string) {
  return useQuery({
    queryKey: erpKeys.manufacturingVouchers(entityId),
    enabled: Boolean(entityId),
    queryFn: () => api.get<ErpManufacturingVoucher[]>(`/mesaerp/v1/entities/${entityId}/manufacturing-vouchers`),
  });
}

export function useCreateErpManufacturingVoucher(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, requestKey }: { input: ErpManufacturingVoucherCreate; requestKey: string }) => api.postIdempotent<ErpManufacturingVoucher>(
      `/mesaerp/v1/entities/${entityId}/manufacturing-vouchers`,
      input,
      requestKey,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.manufacturing(entityId) }),
  });
}

export function useTransitionErpManufacturingVoucher(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ voucherId, action, expectedRowVersion, requestKey }: {
      voucherId: string;
      action: 'submit' | 'approve' | 'post';
      expectedRowVersion: number;
      requestKey: string;
    }) => api.postIdempotent<ErpManufacturingVoucher>(
      `/mesaerp/v1/entities/${entityId}/manufacturing-vouchers/${voucherId}/${action}`,
      { expectedRowVersion },
      requestKey,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.manufacturing(entityId) }),
  });
}

export function useErpBatchCosts(entityId: string) {
  return useQuery({
    queryKey: erpKeys.batchCosts(entityId),
    enabled: Boolean(entityId),
    queryFn: () => api.get<ErpBatchCost[]>(`/mesaerp/v1/entities/${entityId}/batch-costs`),
  });
}

export function useCreateErpVendor(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ErpVendorCreate) => api.postIdempotent<ErpVendor>(`/mesaerp/v1/entities/${entityId}/vendors`, input, idempotencyKey('vendor-create')),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.vendors(entityId) }),
  });
}

export function useTransitionErpVendor(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ vendorId, to, reason, expectedRowVersion }: { vendorId: string; to: ErpVendorLifecycleStatus; reason: string; expectedRowVersion: number }) => (
      api.postIdempotent<ErpVendor>(
        `/mesaerp/v1/entities/${entityId}/vendors/${vendorId}/lifecycle`,
        { to, reason, expectedRowVersion },
        idempotencyKey('vendor-lifecycle'),
      )
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.vendors(entityId) }),
  });
}

export function useCreateErpVoucher(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ErpVoucherCreate) => api.postIdempotent<ErpVoucher>(`/mesaerp/v1/entities/${entityId}/vouchers`, input, idempotencyKey('voucher-create')),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.vouchers(entityId) }),
  });
}

export function useTransitionErpVoucher(entityId: string, action: 'submit' | 'approve' | 'post') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ voucherId, expectedVersion }: { voucherId: string; expectedVersion: number }) => (
      api.postIdempotent<ErpVoucher | { voucher: ErpVoucher }>(
        `/mesaerp/v1/entities/${entityId}/vouchers/${voucherId}/${action}`,
        { expectedVersion },
        idempotencyKey(`voucher-${action}`),
      )
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.vouchers(entityId) }),
  });
}

export function useReverseErpVoucher(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ voucherId, expectedVersion, voucherDate, reason, requestKey }: {
      voucherId: string;
      expectedVersion: number;
      voucherDate: string;
      reason: string;
      requestKey: string;
    }) => api.postIdempotent<ErpVoucher>(
      `/mesaerp/v1/entities/${entityId}/vouchers/${voucherId}/reversals`,
      { expectedVersion, voucherDate, reason },
      requestKey,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.vouchers(entityId) }),
  });
}

export function useReplaceErpRolePermissions(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, expectedRoleVersion, grants }: { roleId: string; expectedRoleVersion: number; grants: string[] }) => (
      api.putIdempotent<ErpRole>(
        `/mesaerp/v1/entities/${entityId}/access/roles/${roleId}/permissions`,
        { expectedRoleVersion, grants },
        idempotencyKey('role-permissions'),
      )
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: erpKeys.roles(entityId) });
      queryClient.invalidateQueries({ queryKey: erpKeys.permissions(entityId) });
      queryClient.invalidateQueries({ queryKey: erpKeys.assignments(entityId) });
    },
  });
}

export function useCreateErpRole(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, requestKey }: { input: ErpRoleCreate; requestKey: string }) => api.postIdempotent<ErpRole>(
      `/mesaerp/v1/entities/${entityId}/access/roles`,
      input,
      requestKey,
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: erpKeys.roles(entityId) });
      queryClient.invalidateQueries({ queryKey: erpKeys.assignments(entityId) });
    },
  });
}

export function useCreateErpRoleAssignment(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ErpRoleAssignmentCreate) => api.postIdempotent<ErpRoleAssignment>(
      `/mesaerp/v1/entities/${entityId}/access/role-assignments`,
      input,
      idempotencyKey('role-assignment-create'),
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.assignments(entityId) }),
  });
}

export function useRevokeErpRoleAssignment(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, rowVersion, reason }: { assignmentId: string; rowVersion: number; reason: string }) => api.postIdempotent<ErpRoleAssignment>(
      `/mesaerp/v1/entities/${entityId}/access/role-assignments/${assignmentId}/revoke`,
      { rowVersion, reason },
      idempotencyKey('role-assignment-revoke'),
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpKeys.assignments(entityId) }),
  });
}

export function useErpSupplierWorkspace(entityId: string) {
  return useQuery({
    queryKey: erpKeys.supplierWorkspace(entityId),
    enabled: Boolean(entityId),
    queryFn: () => api.get<ErpSupplierWorkspace>(`/mesaerp/v1/entities/${entityId}/supplier-workspace`),
  });
}

export function useErpSupplierManagement(entityId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: erpKeys.supplierWorkspace(entityId) });
  const refreshVendors = () => {
    refresh();
    queryClient.invalidateQueries({ queryKey: erpKeys.vendors(entityId) });
  };
  return {
    createRfq: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpRfqCreate; requestKey: string }) => api.postIdempotent<ErpRfq>(`/mesaerp/v1/entities/${entityId}/rfqs`, input, requestKey), onSuccess: refresh }),
    issueRfq: useMutation({ mutationFn: ({ rfqId, expectedRowVersion, note, requestKey }: { rfqId: string; expectedRowVersion: number; note: string; requestKey: string }) => api.postIdempotent<ErpRfq>(`/mesaerp/v1/entities/${entityId}/rfqs/${rfqId}/issue`, { expectedRowVersion, note }, requestKey), onSuccess: refresh }),
    selectQuotation: useMutation({ mutationFn: ({ rfqId, quotationId, expectedRowVersion, selectionReason, agreement, requestKey }: { rfqId: string; quotationId: string; expectedRowVersion: number; selectionReason: string; agreement?: { agreementNumber: string; validFrom: string; validUntil: string; terms: Record<string, unknown> }; requestKey: string }) => api.postIdempotent<{ rfq: ErpRfq; agreement?: ErpRateAgreement }>(`/mesaerp/v1/entities/${entityId}/rfqs/${rfqId}/select`, { quotationId, expectedRowVersion, selectionReason, ...(agreement ? { agreement } : {}) }, requestKey), onSuccess: refresh }),
    activateAgreement: useMutation({ mutationFn: ({ agreementId, expectedRowVersion, reason, requestKey }: { agreementId: string; expectedRowVersion: number; reason: string; requestKey: string }) => api.postIdempotent<ErpRateAgreement>(`/mesaerp/v1/entities/${entityId}/rate-agreements/${agreementId}/activate`, { expectedRowVersion, reason }, requestKey), onSuccess: refresh }),
    invitePortalUser: useMutation({ mutationFn: ({ vendorId, input, requestKey }: { vendorId: string; input: ErpPortalInviteCreate; requestKey: string }) => api.postIdempotent<{ id: string; expiresAt: string; token: string | null; invitePath: string | null; replayed: boolean }>(`/mesaerp/v1/entities/${entityId}/vendors/${vendorId}/portal-invitations`, input, requestKey), onSuccess: refresh }),
    addDocument: useMutation({ mutationFn: ({ vendorId, input, requestKey }: { vendorId: string; input: ErpVendorDocumentCreate; requestKey: string }) => api.postIdempotent(`/mesaerp/v1/entities/${entityId}/vendors/${vendorId}/documents`, input, requestKey), onSuccess: refreshVendors }),
    reviewDocument: useMutation({ mutationFn: ({ vendorId, documentId, expectedRowVersion, decision, reason, requestKey }: { vendorId: string; documentId: string; expectedRowVersion: number; decision: 'verified' | 'rejected'; reason: string; requestKey: string }) => api.postIdempotent(`/mesaerp/v1/entities/${entityId}/vendors/${vendorId}/documents/${documentId}/review`, { expectedRowVersion, decision, reason }, requestKey), onSuccess: refreshVendors }),
    decideChange: useMutation({ mutationFn: ({ caseId, expectedRowVersion, decision, reason, requestKey }: { caseId: string; expectedRowVersion: number; decision: 'approved' | 'rejected'; reason: string; requestKey: string }) => api.postIdempotent(`/mesaerp/v1/entities/${entityId}/vendor-change-cases/${caseId}/decide`, { expectedRowVersion, decision, reason }, requestKey), onSuccess: refreshVendors }),
    createDispute: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpDisputeCreate; requestKey: string }) => api.postIdempotent(`/mesaerp/v1/entities/${entityId}/disputes`, input, requestKey), onSuccess: refresh }),
    resolveDispute: useMutation({ mutationFn: ({ disputeId, expectedRowVersion, decision, resolution, requestKey }: { disputeId: string; expectedRowVersion: number; decision: 'resolved' | 'rejected'; resolution: string; requestKey: string }) => api.postIdempotent(`/mesaerp/v1/entities/${entityId}/disputes/${disputeId}/resolve`, { expectedRowVersion, decision, resolution }, requestKey), onSuccess: refresh }),
    createPaymentProposal: useMutation({ mutationFn: ({ input, requestKey }: { input: ErpPaymentProposalCreate; requestKey: string }) => api.postIdempotent(`/mesaerp/v1/entities/${entityId}/payment-proposals`, input, requestKey), onSuccess: refresh }),
    approvePaymentProposal: useMutation({ mutationFn: ({ proposalId, expectedRowVersion, voucherDate, reason, requestKey }: { proposalId: string; expectedRowVersion: number; voucherDate: string; reason: string; requestKey: string }) => api.postIdempotent(`/mesaerp/v1/entities/${entityId}/payment-proposals/${proposalId}/approve`, { expectedRowVersion, voucherDate, reason }, requestKey), onSuccess: () => { refresh(); queryClient.invalidateQueries({ queryKey: erpKeys.vouchers(entityId) }); } }),
  };
}
