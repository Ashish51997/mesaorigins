import type {
  ErpBatchCost,
  ErpCustomer,
  ErpCustomerCreate,
  ErpManufacturingVoucher,
  ErpManufacturingVoucherCreate,
  ErpProductionDemand,
  ErpProductionDemandCreate,
  ErpPurchaseMatchCase,
  ErpSalesDocument,
  ErpSalesDocumentCreate,
  ErpSalesDocumentType,
  ErpSourceToPayDocument,
  ErpSourceToPayDocumentCreate,
  ErpSourceToPayDocumentType,
} from '@mesaerp/lib/queries/mesaerp';

export type MesaErpView =
  | 'overview'
  | 'source-to-pay'
  | 'purchase-match'
  | 'commercial'
  | 'inventory-mrp'
  | 'manufacturing'
  | 'voucher-desk'
  | 'finance-controls'
  | 'tax-compliance'
  | 'handoffs'
  | 'roles-access';

export type RecordState = 'draft' | 'pending' | 'submitted' | 'approved' | 'posted' | 'reversed' | 'blocked' | 'review';

export interface Vendor {
  id: string;
  code?: string;
  name: string;
  tradeName?: string;
  supplies: string;
  paymentTerms: string;
  gstinState: 'verified' | 'review';
  gstin?: string;
  lifecycleStatus?: VendorLifecycleStatus;
  complianceStatus?: string;
  rowVersion?: number;
}

export type VendorLifecycleStatus = 'invited' | 'onboarding' | 'under_review' | 'approved' | 'conditionally_approved' | 'suspended' | 'blocked';

export interface VendorCreateInput {
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

export interface PurchaseRecord {
  id: string;
  vendorId: string;
  description: string;
  orderedQty: number;
  receivedQty: number;
  invoicedQty: number;
  orderRate: number;
  invoiceRate: number;
  uom: string;
  stage: 'requisition' | 'rfq' | 'purchase-order' | 'receipt' | 'invoice' | 'payment';
  matchState: 'matched' | 'exception' | 'review' | 'approved-exception';
  neededBy: string;
}

export interface StockItem {
  id: string;
  sku: string;
  name: string;
  uom: string;
  onHand: number;
  allocated: number;
  safetyStock: number;
  replenishment: 'buy' | 'make';
  location: string;
}

export type ManufacturingVoucherType =
  | 'Material issue'
  | 'Production receipt'
  | 'Scrap / recovery'
  | 'Job-work movement'
  | 'Stock journal';

export interface ManufacturingVoucher {
  id: string;
  type: ManufacturingVoucherType;
  reference: string;
  item: string;
  quantity: number;
  uom: string;
  warehouse: string;
  state: RecordState;
  createdAt: string;
}

export type FinanceVoucherType =
  | 'Sales'
  | 'Purchase'
  | 'Receipt'
  | 'Payment'
  | 'Contra'
  | 'Journal'
  | 'Credit note'
  | 'Debit note'
  | 'Stock journal'
  | 'Manufacturing journal'
  | 'Opening';

export interface LedgerLine {
  account: string;
  debit: string;
  credit: string;
}

export interface FinanceVoucher {
  id: string;
  number: string;
  type: FinanceVoucherType;
  date: string;
  party: string;
  reference: string;
  narration: string;
  lines: LedgerLine[];
  state: RecordState;
  version?: number;
  currencyCode?: string;
  createdAt?: string;
}

export interface LedgerAccountOption {
  id: string;
  code: string;
  name: string;
  allowPosting: boolean;
}

export interface TaxDocument {
  id: string;
  kind: 'GST invoice' | 'E-invoice' | 'E-way bill' | 'TDS';
  documentNumber: string;
  applicability: 'required' | 'not-required' | 'ruleset-review';
  externalReference?: string;
  state: 'ready' | 'pending' | 'blocked' | 'not-applicable';
  ruleset: string;
}

export interface HandoffRecord {
  id: string;
  sourceService: 'MesaLeads' | 'MesaOps' | 'External';
  sourceReference: string;
  destination: string;
  destinationReference?: string;
  summary: string;
  state: 'linked' | 'stale' | 'conflict' | 'unlinked';
  sourceHash: string;
  reviewed: boolean;
}

export type PermissionKey = `mesaerp.${string}`;

export const PERMISSIONS = [
  'mesaerp.legal_entity.manage',
  'mesaerp.vendor.read',
  'mesaerp.vendor.manage',
  'mesaerp.vendor.bank.verify',
  'mesaerp.sourcing.manage',
  'mesaerp.procurement.manage',
  'mesaerp.purchase.match',
  'mesaerp.sales.manage',
  'mesaerp.inventory.manage',
  'mesaerp.manufacturing.manage',
  'mesaerp.voucher.read',
  'mesaerp.voucher.create',
  'mesaerp.voucher.edit',
  'mesaerp.voucher.submit',
  'mesaerp.voucher.approve',
  'mesaerp.voucher.post',
  'mesaerp.voucher.reverse',
  'mesaerp.account.manage',
  'mesaerp.banking.manage',
  'mesaerp.tax.manage',
  'mesaerp.asset.manage',
  'mesaerp.budget.manage',
  'mesaerp.reports.read',
  'mesaerp.period.manage',
  'mesaerp.intercompany.manage',
  'mesaerp.consolidation.manage',
  'mesaerp.mrp.manage',
  'mesaerp.handoff.manage',
  'mesaerp.access.manage',
  'mesaerp.period.reopen',
] as const satisfies readonly PermissionKey[];

export interface PermissionDefinition {
  key: PermissionKey;
  label: string;
  description: string;
  riskLevel: string;
}

export interface EnterpriseRole {
  id: string;
  name: string;
  scope: string;
  grants: PermissionKey[];
  version?: number;
  isSystem?: boolean;
}

export interface EnterpriseRoleAssignment {
  id: string;
  roleId: string;
  roleName: string;
  membershipId: string;
  employeeCode: string;
  memberName: string;
  status: string;
  rowVersion?: number;
}

export interface MesaErpWorkspace {
  vendors: Vendor[];
  purchases: PurchaseRecord[];
  stock: StockItem[];
  manufacturingVouchers: ManufacturingVoucher[];
  financeVouchers: FinanceVoucher[];
  taxDocuments: TaxDocument[];
  handoffs: HandoffRecord[];
  roles: EnterpriseRole[];
}

export type MesaErpMutation =
  | { type: 'vendor.created'; input: VendorCreateInput }
  | { type: 'purchase.created'; record: PurchaseRecord }
  | { type: 'purchase.match-decided'; id: string; decision: PurchaseRecord['matchState'] }
  | { type: 'inventory.supply-requested'; stockItemId: string; purchaseId: string }
  | { type: 'manufacturing-voucher.created'; voucher: ManufacturingVoucher }
  | { type: 'finance-voucher.saved'; voucher: FinanceVoucher }
  | { type: 'tax-reference.recorded'; id: string; externalReference: string }
  | { type: 'handoff.snapshot-created'; id: string; destinationReference: string }
  | { type: 'handoff.reviewed'; id: string }
  | { type: 'role.permission-changed'; roleId: string; permission: PermissionKey; granted: boolean };

export interface MesaErpAppProps {
  initialView?: MesaErpView;
  initialWorkspace?: MesaErpWorkspace;
  workspace?: MesaErpWorkspace;
  mode?: 'demo' | 'live';
  workspaceLabel?: string;
  currencyCode?: string;
  legalEntities?: Array<{ id: string; label: string; currency?: string }>;
  selectedLegalEntityId?: string;
  onSelectLegalEntity?: (id: string) => void;
  accounts?: LedgerAccountOption[];
  permissions?: PermissionDefinition[];
  roleAssignments?: EnterpriseRoleAssignment[];
  sourceToPayDocuments?: ErpSourceToPayDocument[];
  purchaseMatches?: ErpPurchaseMatchCase[];
  customers?: ErpCustomer[];
  salesOrders?: ErpSalesDocument[];
  salesInvoices?: ErpSalesDocument[];
  productionDemands?: ErpProductionDemand[];
  persistedManufacturingVouchers?: ErpManufacturingVoucher[];
  batchCosts?: ErpBatchCost[];
  sourceToPayLoading?: boolean;
  purchaseMatchesLoading?: boolean;
  commercialLoading?: boolean;
  manufacturingLoading?: boolean;
  loadWarnings?: string[];
  onExit?: () => void;
  onMutation?: (mutation: MesaErpMutation) => void | Promise<void>;
  onCreateVendor?: (input: VendorCreateInput) => void | Promise<void>;
  onTransitionVendor?: (vendor: Vendor, to: VendorLifecycleStatus, reason: string) => void | Promise<void>;
  onCreateSourceToPayDocument?: (documentType: ErpSourceToPayDocumentType, input: ErpSourceToPayDocumentCreate, requestKey: string) => void | Promise<void>;
  onTransitionSourceToPayDocument?: (document: ErpSourceToPayDocument, action: 'submit' | 'approve', requestKey: string) => void | Promise<void>;
  onCreatePurchaseMatch?: (input: { purchaseOrderId: string; goodsReceiptId: string; supplierInvoiceId: string }, requestKey: string) => void | Promise<void>;
  onApprovePurchaseMatch?: (match: ErpPurchaseMatchCase, reason: string, requestKey: string) => void | Promise<void>;
  onCreateCustomer?: (input: ErpCustomerCreate, requestKey: string) => void | Promise<void>;
  onCreateSalesDocument?: (documentType: ErpSalesDocumentType, input: ErpSalesDocumentCreate, requestKey: string) => void | Promise<void>;
  onTransitionSalesDocument?: (document: ErpSalesDocument, action: 'submit' | 'approve', requestKey: string) => void | Promise<void>;
  onCreateProductionDemand?: (input: ErpProductionDemandCreate, requestKey: string) => void | Promise<void>;
  onTransitionProductionDemand?: (demand: ErpProductionDemand, action: 'approve' | 'release', requestKey: string) => void | Promise<void>;
  onCreatePersistedManufacturingVoucher?: (input: ErpManufacturingVoucherCreate, requestKey: string) => void | Promise<void>;
  onTransitionPersistedManufacturingVoucher?: (voucher: ErpManufacturingVoucher, action: 'submit' | 'approve' | 'post', requestKey: string) => void | Promise<void>;
  onSaveFinanceVoucher?: (voucher: FinanceVoucher) => void | Promise<void>;
  onTransitionFinanceVoucher?: (voucher: FinanceVoucher, action: 'submit' | 'approve' | 'post') => void | Promise<void>;
  onReverseFinanceVoucher?: (voucher: FinanceVoucher, voucherDate: string, reason: string, requestKey: string) => void | Promise<void>;
  onReplaceRolePermissions?: (role: EnterpriseRole, grants: PermissionKey[]) => void | Promise<void>;
  onCreateRoleAssignment?: (role: EnterpriseRole, membershipId: string) => void | Promise<void>;
  onRevokeRoleAssignment?: (assignment: EnterpriseRoleAssignment, reason: string) => void | Promise<void>;
  onCreateRole?: (name: string, grants: PermissionKey[], requestKey: string) => void | Promise<void>;
}

export function createDemoWorkspace(): MesaErpWorkspace {
  return {
    vendors: [
      { id: 'VEN-001', name: 'Demo Steel Supplies', supplies: 'CR coils and sheet', paymentTerms: '30 days', gstinState: 'verified' },
      { id: 'VEN-002', name: 'Demo Polymer Compounds', supplies: 'Polymer granules and masterbatch', paymentTerms: '45 days', gstinState: 'verified' },
      { id: 'VEN-003', name: 'Demo Industrial Services', supplies: 'Machine maintenance', paymentTerms: 'Against milestone', gstinState: 'review' },
    ],
    purchases: [
      { id: 'PO-DEMO-1042', vendorId: 'VEN-002', description: 'Polymer grade PX-12', orderedQty: 2400, receivedQty: 2400, invoicedQty: 2400, orderRate: 118, invoiceRate: 118, uom: 'kg', stage: 'invoice', matchState: 'matched', neededBy: '2026-08-12' },
      { id: 'PO-DEMO-1043', vendorId: 'VEN-001', description: 'CR sheet 1.2 mm', orderedQty: 1200, receivedQty: 1150, invoicedQty: 1200, orderRate: 74, invoiceRate: 74, uom: 'kg', stage: 'invoice', matchState: 'exception', neededBy: '2026-08-14' },
      { id: 'PR-DEMO-0198', vendorId: 'VEN-003', description: 'Extruder preventive maintenance', orderedQty: 1, receivedQty: 0, invoicedQty: 0, orderRate: 36000, invoiceRate: 0, uom: 'job', stage: 'requisition', matchState: 'review', neededBy: '2026-08-21' },
    ],
    stock: [
      { id: 'STK-001', sku: 'RM-PX12', name: 'Polymer grade PX-12', uom: 'kg', onHand: 820, allocated: 610, safetyStock: 400, replenishment: 'buy', location: 'RM-A-04' },
      { id: 'STK-002', sku: 'RM-MB-BLU', name: 'Blue masterbatch', uom: 'kg', onHand: 92, allocated: 38, safetyStock: 60, replenishment: 'buy', location: 'RM-B-02' },
      { id: 'STK-003', sku: 'FG-PNL-24', name: 'Moulded panel 24', uom: 'pcs', onHand: 380, allocated: 340, safetyStock: 120, replenishment: 'make', location: 'FG-02' },
      { id: 'STK-004', sku: 'PKG-CTN-24', name: 'Panel carton 24', uom: 'pcs', onHand: 760, allocated: 240, safetyStock: 300, replenishment: 'buy', location: 'PKG-01' },
    ],
    manufacturingVouchers: [
      { id: 'MV-DEMO-0084', type: 'Material issue', reference: 'WO-DEMO-116', item: 'Polymer grade PX-12', quantity: 420, uom: 'kg', warehouse: 'RM store', state: 'posted', createdAt: '2026-08-14' },
      { id: 'MV-DEMO-0085', type: 'Production receipt', reference: 'WO-DEMO-115', item: 'Moulded panel 24', quantity: 300, uom: 'pcs', warehouse: 'FG store', state: 'approved', createdAt: '2026-08-14' },
      { id: 'MV-DEMO-0086', type: 'Scrap / recovery', reference: 'WO-DEMO-115', item: 'Polymer regrind', quantity: 18, uom: 'kg', warehouse: 'Recovery bay', state: 'draft', createdAt: '2026-08-14' },
    ],
    financeVouchers: [
      {
        id: 'FV-DEMO-0031', number: 'PUR-DEMO-0031', type: 'Purchase', date: '2026-08-14', party: 'Demo Polymer Compounds', reference: 'PO-DEMO-1042', narration: 'Invoice captured after three-way match', state: 'approved',
        lines: [{ account: 'Raw material purchases', debit: '283200', credit: '0' }, { account: 'Trade payables', debit: '0', credit: '283200' }],
      },
      {
        id: 'FV-DEMO-0032', number: 'JRN-DEMO-0032', type: 'Journal', date: '2026-08-14', party: 'Internal allocation', reference: 'WO-DEMO-115', narration: 'Production overhead allocation draft', state: 'draft',
        lines: [{ account: 'Work in progress', debit: '18000', credit: '0' }, { account: 'Production overhead absorbed', debit: '0', credit: '18000' }],
      },
    ],
    taxDocuments: [
      { id: 'TAX-001', kind: 'GST invoice', documentNumber: 'INV-DEMO-208', applicability: 'required', state: 'ready', ruleset: 'India GST · effective-dated profile' },
      { id: 'TAX-002', kind: 'E-invoice', documentNumber: 'INV-DEMO-208', applicability: 'ruleset-review', state: 'pending', ruleset: 'India e-invoice · organization profile' },
      { id: 'TAX-003', kind: 'E-way bill', documentNumber: 'DISP-DEMO-087', applicability: 'required', state: 'blocked', ruleset: 'India e-way bill · movement profile' },
      { id: 'TAX-004', kind: 'TDS', documentNumber: 'BILL-DEMO-044', applicability: 'ruleset-review', state: 'pending', ruleset: 'India TDS · vendor/category profile' },
    ],
    handoffs: [
      { id: 'HO-001', sourceService: 'MesaLeads', sourceReference: 'QUOTE-DEMO-071', destination: 'Sales order', destinationReference: 'SO-DEMO-041', summary: 'Approved commercial snapshot for moulded panels', state: 'linked', sourceHash: 'sha256:2b1…89d', reviewed: true },
      { id: 'HO-002', sourceService: 'MesaOps', sourceReference: 'BATCH-DEMO-115', destination: 'Costing document', destinationReference: 'COST-DEMO-115', summary: 'Batch completion snapshot changed after destination creation', state: 'stale', sourceHash: 'sha256:7a0…41c', reviewed: false },
      { id: 'HO-003', sourceService: 'External', sourceReference: 'CSV-DEMO-018', destination: 'Purchase invoice', summary: 'Finance can create a local record without another MesaOrigins service', state: 'unlinked', sourceHash: 'sha256:9dd…05a', reviewed: false },
    ],
    roles: [
      { id: 'ROLE-FIN', name: 'Finance controller', scope: 'Finance', grants: ['mesaerp.voucher.create', 'mesaerp.voucher.post', 'mesaerp.banking.manage'] },
      { id: 'ROLE-BUY', name: 'Purchase manager', scope: 'Procurement', grants: ['mesaerp.procurement.manage', 'mesaerp.purchase.match'] },
      { id: 'ROLE-PLAN', name: 'Production planner', scope: 'Plant', grants: ['mesaerp.manufacturing.manage'] },
      { id: 'ROLE-STORE', name: 'Store operator', scope: 'Warehouse', grants: [] },
      { id: 'ROLE-TAX', name: 'Tax specialist', scope: 'Finance', grants: ['mesaerp.voucher.create', 'mesaerp.tax.manage'] },
    ],
  };
}
