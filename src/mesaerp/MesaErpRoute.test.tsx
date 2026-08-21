import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MesaErpRoute from './MesaErpRoute';

const mocks = vi.hoisted(() => ({
  entities: {} as Record<string, unknown>,
  accounts: {} as Record<string, unknown>,
  vendors: {} as Record<string, unknown>,
  vouchers: {} as Record<string, unknown>,
  roles: {} as Record<string, unknown>,
  permissions: {} as Record<string, unknown>,
  assignments: {} as Record<string, unknown>,
  requisitions: {} as Record<string, unknown>,
  purchaseOrders: {} as Record<string, unknown>,
  goodsReceipts: {} as Record<string, unknown>,
  supplierInvoices: {} as Record<string, unknown>,
  purchaseMatches: {} as Record<string, unknown>,
  customers: {} as Record<string, unknown>,
  salesOrders: {} as Record<string, unknown>,
  salesInvoices: {} as Record<string, unknown>,
  productionDemands: {} as Record<string, unknown>,
  manufacturingVouchers: {} as Record<string, unknown>,
  batchCosts: {} as Record<string, unknown>,
  supplierWorkspace: {} as Record<string, unknown>,
  createEntity: vi.fn(),
  createVendor: vi.fn(),
  transitionVendor: vi.fn(),
  createVoucher: vi.fn(),
  submitVoucher: vi.fn(),
  approveVoucher: vi.fn(),
  postVoucher: vi.fn(),
  reverseVoucher: vi.fn(),
  replacePermissions: vi.fn(),
  createAssignment: vi.fn(),
  revokeAssignment: vi.fn(),
  createRole: vi.fn(),
  createSourceDocument: vi.fn(),
  transitionSourceDocument: vi.fn(),
  createPurchaseMatch: vi.fn(),
  approvePurchaseMatch: vi.fn(),
  createCustomer: vi.fn(),
  createSalesDocument: vi.fn(),
  transitionSalesDocument: vi.fn(),
  createProductionDemand: vi.fn(),
  transitionProductionDemand: vi.fn(),
  createManufacturingVoucher: vi.fn(),
  transitionManufacturingVoucher: vi.fn(),
}));

vi.mock('@mesaerp/lib/queries/mesaerp', () => ({
  createErpIdempotencyKey: (scope: string) => `${scope}:test-intent-key`,
  useErpEntities: () => mocks.entities,
  useCreateErpEntity: () => ({ mutateAsync: mocks.createEntity }),
  useErpAccounts: () => mocks.accounts,
  useErpVendors: () => mocks.vendors,
  useErpVouchers: () => mocks.vouchers,
  useErpRoles: () => mocks.roles,
  useErpPermissions: () => mocks.permissions,
  useErpRoleAssignments: () => mocks.assignments,
  useErpSourceToPayDocuments: (_entityId: string, type: string) => (
    type === 'purchase_requisition' ? mocks.requisitions
      : type === 'purchase_order' ? mocks.purchaseOrders
        : type === 'goods_receipt' ? mocks.goodsReceipts
          : mocks.supplierInvoices
  ),
  useErpPurchaseMatches: () => mocks.purchaseMatches,
  useErpCustomers: () => mocks.customers,
  useErpSalesDocuments: (_entityId: string, type: string) => type === 'sales_order' ? mocks.salesOrders : mocks.salesInvoices,
  useErpProductionDemands: () => mocks.productionDemands,
  useErpManufacturingVouchers: () => mocks.manufacturingVouchers,
  useErpBatchCosts: () => mocks.batchCosts,
  useErpSupplierWorkspace: () => mocks.supplierWorkspace,
  useErpSupplierManagement: () => {
    const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
    return {
      createRfq: mutation,
      issueRfq: mutation,
      selectQuotation: mutation,
      activateAgreement: mutation,
      invitePortalUser: mutation,
      addDocument: mutation,
      reviewDocument: mutation,
      decideChange: mutation,
      createDispute: mutation,
      resolveDispute: mutation,
      createPaymentProposal: mutation,
      approvePaymentProposal: mutation,
    };
  },
  useCreateErpVendor: () => ({ mutateAsync: mocks.createVendor }),
  useTransitionErpVendor: () => ({ mutateAsync: mocks.transitionVendor }),
  useCreateErpVoucher: () => ({ mutateAsync: mocks.createVoucher }),
  useTransitionErpVoucher: (_entityId: string, action: string) => ({
    mutateAsync: action === 'submit' ? mocks.submitVoucher : action === 'approve' ? mocks.approveVoucher : mocks.postVoucher,
  }),
  useReverseErpVoucher: () => ({ mutateAsync: mocks.reverseVoucher }),
  useReplaceErpRolePermissions: () => ({ mutateAsync: mocks.replacePermissions }),
  useCreateErpRoleAssignment: () => ({ mutateAsync: mocks.createAssignment }),
  useRevokeErpRoleAssignment: () => ({ mutateAsync: mocks.revokeAssignment }),
  useCreateErpRole: () => ({ mutateAsync: mocks.createRole }),
  useCreateErpSourceToPayDocument: () => ({ mutateAsync: mocks.createSourceDocument }),
  useTransitionErpSourceToPayDocument: () => ({ mutateAsync: mocks.transitionSourceDocument }),
  useCreateErpPurchaseMatch: () => ({ mutateAsync: mocks.createPurchaseMatch }),
  useApproveErpPurchaseMatch: () => ({ mutateAsync: mocks.approvePurchaseMatch }),
  useCreateErpCustomer: () => ({ mutateAsync: mocks.createCustomer }),
  useCreateErpSalesDocument: () => ({ mutateAsync: mocks.createSalesDocument }),
  useTransitionErpSalesDocument: () => ({ mutateAsync: mocks.transitionSalesDocument }),
  useCreateErpProductionDemand: () => ({ mutateAsync: mocks.createProductionDemand }),
  useTransitionErpProductionDemand: () => ({ mutateAsync: mocks.transitionProductionDemand }),
  useCreateErpManufacturingVoucher: () => ({ mutateAsync: mocks.createManufacturingVoucher }),
  useTransitionErpManufacturingVoucher: () => ({ mutateAsync: mocks.transitionManufacturingVoucher }),
}));

const query = (data: unknown) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });

const sourceDocument = (
  documentType: 'purchase_requisition' | 'purchase_order' | 'goods_receipt' | 'supplier_invoice',
  status: 'draft' | 'submitted' | 'approved',
  id: string,
  documentNumber: string,
  sourceLineId?: string,
) => ({
  id,
  organizationId: 'org-1',
  legalEntityId: 'entity-1',
  financialYearId: 'fy-1',
  documentType,
  documentNumber,
  documentDate: '2026-08-14',
  status,
  approvalState: status === 'approved' ? 'approved' : status === 'submitted' ? 'pending' : 'draft',
  ...(documentType === 'purchase_requisition' ? {} : { vendorId: 'vendor-1' }),
  partySnapshot: {},
  currency: 'INR',
  exchangeRate: '1',
  subtotal: '1000',
  discountTotal: '0',
  taxTotal: '180',
  roundingAmount: '0',
  grandTotal: '1180',
  baseCurrencyTotal: '1180',
  taxSummary: {},
  terms: [],
  shipping: {},
  originType: 'manual',
  originMetadata: {},
  rowVersion: status === 'draft' ? 0 : status === 'submitted' ? 1 : 2,
  createdBy: 'member-maker',
  createdAt: '2026-08-14T08:00:00.000Z',
  updatedAt: '2026-08-14T08:00:00.000Z',
  lines: [{
    id: `${id}-line-1`,
    lineNumber: 1,
    description: 'Polymer resin',
    hsnSacCode: '3901',
    quantity: '10',
    uom: 'KG',
    unitPrice: '100',
    discountAmount: '0',
    taxableAmount: '1000',
    taxRate: '18',
    taxAmount: '180',
    lineTotal: '1180',
    warehouseCode: documentType === 'goods_receipt' ? 'RM-01' : '',
    batchNumber: documentType === 'goods_receipt' ? 'LOT-1' : '',
    ...(sourceLineId ? { sourceLineId } : {}),
    dimensions: {},
  }],
  links: [],
});

beforeEach(() => {
  mocks.entities = query([{ id: 'entity-1', organizationId: 'org-1', code: 'ACME', name: 'Acme Components', countryCode: 'IN', baseCurrency: 'INR', fiscalYearStartMonth: 4, version: 1 }]);
  mocks.accounts = query([
    { id: 'account-wip', legalEntityId: 'entity-1', code: '1300', name: 'Work in progress', accountType: 'asset', currency: 'INR', allowPosting: true },
    { id: 'account-overhead', legalEntityId: 'entity-1', code: '5100', name: 'Production overhead', accountType: 'expense', currency: 'INR', allowPosting: true },
  ]);
  mocks.vendors = query([{ id: 'vendor-1', legalEntityId: 'entity-1', vendorCode: 'VEN-001', legalName: 'Reliable Resins', tradeName: '', pan: '', gstin: '', msmeNumber: '', paymentTerms: '30 days', currency: 'INR', creditDays: 30, lifecycleStatus: 'approved', complianceStatus: 'verified', rowVersion: 3, categories: ['Polymer'] }]);
  mocks.vouchers = query([{ id: 'voucher-1', legalEntityId: 'entity-1', voucherType: 'journal', voucherDate: '2026-08-14', currencyCode: 'INR', reference: 'WO-102', narration: 'Production allocation', lines: [{ ledgerAccountId: 'account-wip', debit: '2500', credit: '0', narration: '', dimensions: {} }, { ledgerAccountId: 'account-overhead', debit: '0', credit: '2500', narration: '', dimensions: {} }], status: 'draft', version: 2, createdAt: '2026-08-14T08:00:00.000Z' }]);
  mocks.roles = query([{ id: 'role-finance', name: 'Finance controller', version: 7, isSystem: false, permissions: [{ key: 'mesaerp.voucher.read', effect: 'allow', riskLevel: 'standard' }] }]);
  mocks.permissions = query([
    { id: 'permission-read', key: 'mesaerp.voucher.read', label: 'Read vouchers', description: 'View company vouchers.', riskLevel: 'standard' },
    { id: 'permission-post', key: 'mesaerp.voucher.post', label: 'Post vouchers', description: 'Post an approved voucher.', riskLevel: 'high' },
  ]);
  mocks.assignments = query([{ id: 'assignment-1', legalEntityId: 'entity-1', membership: { id: 'member-1', employeeCode: 'E-001', name: 'Finance User', email: 'finance@example.test' }, role: { id: 'role-finance', name: 'Finance controller' }, permissions: [{ key: 'mesaerp.voucher.read', effect: 'allow' }], status: 'active', rowVersion: 0 }]);
  const pr = sourceDocument('purchase_requisition', 'draft', 'pr-1', 'ACME-PRQ-000001');
  const po = sourceDocument('purchase_order', 'approved', 'po-1', 'ACME-PO-000001', 'pr-1-line-1');
  const grn = sourceDocument('goods_receipt', 'approved', 'grn-1', 'ACME-GRN-000001', 'po-1-line-1');
  const invoice = sourceDocument('supplier_invoice', 'submitted', 'invoice-1', 'SUP-INV-481', 'grn-1-line-1');
  mocks.requisitions = query([pr]);
  mocks.purchaseOrders = query([po]);
  mocks.goodsReceipts = query([grn]);
  mocks.supplierInvoices = query([invoice]);
  mocks.purchaseMatches = query([{ id: 'match-1', organizationId: 'org-1', legalEntityId: 'entity-1', vendorId: 'vendor-1', supplierInvoiceId: 'invoice-1', purchaseOrderId: 'po-1', goodsReceiptId: 'grn-1', status: 'variance', quantityVariance: '1', priceVariance: '45', taxVariance: '48.6', totalVariance: '3.6', details: [{ purchaseOrderLineId: 'po-1-line-1', orderedQuantity: '10', receivedQuantity: '8', invoicedQuantity: '9' }], makerMembershipId: 'member-maker', rowVersion: 0, createdAt: '2026-08-14T08:00:00.000Z', updatedAt: '2026-08-14T08:00:00.000Z' }]);
  mocks.customers = query([{ id: 'customer-1', organizationId: 'org-1', legalEntityId: 'entity-1', customerCode: 'CUS-001', legalName: 'Precision Buyer', tradeName: '', pan: '', gstin: '', addresses: [], contacts: [], paymentTerms: '30 days', currency: 'INR', creditLimit: '500000.00', creditDays: 30, status: 'active', rowVersion: 1, originMetadata: {}, createdAt: '2026-08-14T08:00:00.000Z', updatedAt: '2026-08-14T08:00:00.000Z' }]);
  const salesOrder = { id: 'sales-order-1', organizationId: 'org-1', legalEntityId: 'entity-1', financialYearId: 'fy-1', documentType: 'sales_order', documentNumber: 'SO-0001', documentDate: '2026-08-14', status: 'approved', approvalState: 'approved', customerId: 'customer-1', partySnapshot: {}, currency: 'INR', exchangeRate: '1', subtotal: '1000.00', discountTotal: '0.00', taxTotal: '180.00', roundingAmount: '0.00', grandTotal: '1180.00', baseCurrencyTotal: '1180.00', taxSummary: {}, terms: [], shipping: {}, originType: 'manual', originMetadata: {}, sourceSnapshotHash: 'hash-so', rowVersion: 2, createdBy: 'member-maker', createdAt: '2026-08-14T08:00:00.000Z', updatedAt: '2026-08-14T08:00:00.000Z', lines: [{ id: 'sales-order-line-1', lineNumber: 1, itemId: 'FG-100', description: 'Moulded component', hsnSacCode: '3926', quantity: '10.000000', uom: 'EA', unitPrice: '100.000000', discountAmount: '0.00', taxableAmount: '1000.00', taxRate: '18.0000', taxAmount: '180.00', lineTotal: '1180.00', warehouseCode: '', batchNumber: '', dimensions: {} }], links: [] };
  mocks.salesOrders = query([salesOrder]);
  mocks.salesInvoices = query([]);
  mocks.productionDemands = query([{ id: 'demand-1', organizationId: 'org-1', legalEntityId: 'entity-1', financialYearId: 'fy-1', demandNumber: 'DEM-0001', demandType: 'forecast', itemId: 'FG-100', quantity: '20.000000', uom: 'EA', status: 'draft', bomSnapshot: {}, materialRequirements: [], suggestions: [], originType: 'manual', originMetadata: {}, sourceSnapshotHash: 'hash-demand', rowVersion: 0, makerMembershipId: 'member-maker', createdAt: '2026-08-14T08:00:00.000Z', updatedAt: '2026-08-14T08:00:00.000Z' }]);
  mocks.manufacturingVouchers = query([{ id: 'manufacturing-voucher-1', organizationId: 'org-1', legalEntityId: 'entity-1', financialYearId: 'fy-1', voucherNumber: 'MV-0001', voucherType: 'manufacturing', businessDate: '2026-08-14', status: 'draft', batchNumber: 'BATCH-1', materialLines: [], outputLines: [], laborLines: [], resourceLines: [], overheadLines: [], subcontractLines: [], recoveryCredits: [], qaDisposition: { status: 'pending' }, materialValue: '0.00', conversionValue: '0.00', recoveryValue: '0.00', actualCost: '0.00', originType: 'manual', originMetadata: {}, sourceSnapshotHash: 'hash-mv', rowVersion: 0, makerMembershipId: 'member-maker', createdAt: '2026-08-14T08:00:00.000Z', updatedAt: '2026-08-14T08:00:00.000Z' }]);
  mocks.batchCosts = query([]);
  mocks.supplierWorkspace = { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() };
  mocks.createEntity.mockReset().mockResolvedValue({});
  mocks.createVendor.mockReset().mockResolvedValue({});
  mocks.transitionVendor.mockReset().mockResolvedValue({});
  mocks.createVoucher.mockReset().mockResolvedValue({});
  mocks.submitVoucher.mockReset().mockResolvedValue({});
  mocks.approveVoucher.mockReset().mockResolvedValue({});
  mocks.postVoucher.mockReset().mockResolvedValue({});
  mocks.reverseVoucher.mockReset().mockResolvedValue({});
  mocks.replacePermissions.mockReset().mockResolvedValue({});
  mocks.createAssignment.mockReset().mockResolvedValue({});
  mocks.revokeAssignment.mockReset().mockResolvedValue({});
  mocks.createRole.mockReset().mockResolvedValue({});
  mocks.createSourceDocument.mockReset().mockResolvedValue({});
  mocks.transitionSourceDocument.mockReset().mockResolvedValue({});
  mocks.createPurchaseMatch.mockReset().mockResolvedValue({});
  mocks.approvePurchaseMatch.mockReset().mockResolvedValue({});
  mocks.createCustomer.mockReset().mockResolvedValue({});
  mocks.createSalesDocument.mockReset().mockResolvedValue({});
  mocks.transitionSalesDocument.mockReset().mockResolvedValue({});
  mocks.createProductionDemand.mockReset().mockResolvedValue({});
  mocks.transitionProductionDemand.mockReset().mockResolvedValue({});
  mocks.createManufacturingVoucher.mockReset().mockResolvedValue({});
  mocks.transitionManufacturingVoucher.mockReset().mockResolvedValue({});
});

describe('MesaErpRoute', () => {
  it('maps live company data without audience-visible demo workspace copy', () => {
    render(<MesaErpRoute />);

    expect(screen.getByText('ACME · Acme Components')).toBeTruthy();
    expect(screen.getByText('Live company data')).toBeTruthy();
    expect(screen.queryByText(/Demo workspace/i)).toBeNull();
    expect(screen.queryByText(/Demo Manufacturing/i)).toBeNull();
    expect(screen.getByText(/MesaERP operates independently/i)).toBeTruthy();
  });

  it.each([
    ['accounts', 'Posting accounts'],
    ['vendors', 'Vendor master'],
    ['vouchers', 'Voucher register'],
    ['roles', 'Enterprise roles'],
    ['permissions', 'Permission catalogue'],
    ['assignments', 'Role assignments'],
  ] as const)('keeps manufacturing usable while %s load independently', (queryName, label) => {
    mocks[queryName] = { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() };

    render(<MesaErpRoute initialView="manufacturing" />);

    expect(screen.queryByRole('heading', { name: 'Loading MesaERP' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Manufacturing vouchers' })).toBeTruthy();
    expect(screen.getByText('DEM-0001')).toBeTruthy();
    expect(screen.getByText(`${label}: loading independently.`)).toBeTruthy();
  });

  it('keeps access management visible when its role query fails', () => {
    mocks.roles = { data: undefined, isLoading: false, isError: true, error: new Error('Role access forbidden'), refetch: vi.fn() };

    render(<MesaErpRoute initialView="roles-access" />);

    expect(screen.getByRole('heading', { name: 'Administration · Roles & access' })).toBeTruthy();
    expect(screen.getByText('Enterprise roles: Role access forbidden')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Loading MesaERP' })).toBeNull();
  });

  it('creates the first legal company from an empty accessible-company state', async () => {
    mocks.entities = query([]);
    render(<MesaErpRoute />);

    expect(screen.getByRole('heading', { name: 'Create the first legal company' })).toBeTruthy();
    expect(screen.queryByText(/Demo Manufacturing/i)).toBeNull();
    fireEvent.change(screen.getByLabelText('Company code'), { target: { value: 'nova' } });
    fireEvent.change(screen.getByLabelText('Legal company name'), { target: { value: 'Nova Components Private Limited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create legal company' }));
    await waitFor(() => expect(mocks.createEntity).toHaveBeenCalledWith({
      input: {
        code: 'NOVA',
        name: 'Nova Components Private Limited',
        countryCode: 'IN',
        baseCurrency: 'INR',
        fiscalYearStartMonth: 4,
      },
      requestKey: 'legal-entity-create:test-intent-key',
    }));
  });

  it('persists an independent production demand with exact quantity strings', async () => {
    render(<MesaErpRoute initialView="manufacturing" />);

    expect(screen.getByText('DEM-0001')).toBeTruthy();
    expect(screen.getByText('MV-0001')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New demand' }));
    const dialog = screen.getByRole('dialog', { name: 'New production demand' });
    fireEvent.change(within(dialog).getByLabelText('Demand item ID'), { target: { value: 'FG-TRIAL' } });
    fireEvent.change(within(dialog).getByLabelText('Demand quantity'), { target: { value: '12.500000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create demand draft' }));

    await waitFor(() => expect(mocks.createProductionDemand).toHaveBeenCalledWith({
      input: expect.objectContaining({ demandType: 'internal', itemId: 'FG-TRIAL', quantity: '12.500000', uom: 'EA', originType: 'manual' }),
      requestKey: 'production-demand-create:test-intent-key',
    }));
  });

  it('creates a persisted sales order from the independent commercial workspace', async () => {
    render(<MesaErpRoute initialView="commercial" />);

    expect(screen.getAllByText('Precision Buyer').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'New sales document' }));
    const dialog = screen.getByRole('dialog', { name: 'New sales order' });
    fireEvent.change(within(dialog).getByLabelText('Sales line description'), { target: { value: 'Trial component' } });
    fireEvent.change(within(dialog).getByLabelText('Sales line item ID'), { target: { value: 'FG-TRIAL' } });
    fireEvent.change(within(dialog).getByLabelText('Sales line quantity'), { target: { value: '25.750000' } });
    fireEvent.change(within(dialog).getByLabelText('Sales line unit rate'), { target: { value: '142.125000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create order draft' }));

    await waitFor(() => expect(mocks.createSalesDocument).toHaveBeenCalledWith({
      documentType: 'sales_order',
      input: expect.objectContaining({ customerId: 'customer-1', currency: 'INR', lines: [expect.objectContaining({ itemId: 'FG-TRIAL', quantity: '25.750000', unitPrice: '142.125000' })] }),
      requestKey: 'sales-document-create:test-intent-key',
    }));
  });

  it('persists vendor creation through the company API hook', async () => {
    render(<MesaErpRoute initialView="source-to-pay" />);

    fireEvent.click(screen.getByRole('button', { name: 'New vendor' }));
    const dialog = screen.getByRole('dialog', { name: 'New vendor' });
    fireEvent.change(within(dialog).getByLabelText(/Vendor code/i), { target: { value: 'ven-208' } });
    fireEvent.change(within(dialog).getByLabelText(/Legal name/i), { target: { value: 'Northstar Alloys' } });
    fireEvent.change(within(dialog).getByLabelText('Categories'), { target: { value: 'Steel, Job work' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create vendor' }));

    await waitFor(() => expect(mocks.createVendor).toHaveBeenCalledWith(expect.objectContaining({
      vendorCode: 'VEN-208',
      legalName: 'Northstar Alloys',
      categories: ['Steel', 'Job work'],
      currency: 'INR',
      creditDays: 0,
    })));
  });

  it('uses the versioned vendor lifecycle transition hook', async () => {
    render(<MesaErpRoute initialView="source-to-pay" />);

    fireEvent.click(screen.getByRole('button', { name: 'Update status' }));
    const dialog = screen.getByRole('dialog', { name: 'Update Reliable Resins' });
    fireEvent.change(within(dialog).getByLabelText('Next vendor status'), { target: { value: 'blocked' } });
    fireEvent.change(within(dialog).getByLabelText('Vendor status reason'), { target: { value: 'Compliance evidence expired' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update vendor status' }));

    await waitFor(() => expect(mocks.transitionVendor).toHaveBeenCalledWith({
      vendorId: 'vendor-1',
      to: 'blocked',
      reason: 'Compliance evidence expired',
      expectedRowVersion: 3,
    }));
  });

  it('persists independent and source-linked purchase documents with exact decimal strings', async () => {
    render(<MesaErpRoute initialView="source-to-pay" />);

    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    let dialog = screen.getByRole('dialog', { name: 'New purchase requisition' });
    fireEvent.change(within(dialog).getByLabelText('Description 1'), { target: { value: 'Machine lubricant' } });
    fireEvent.change(within(dialog).getByLabelText('Quantity 1'), { target: { value: '12.500000' } });
    fireEvent.change(within(dialog).getByLabelText('UOM 1'), { target: { value: 'LTR' } });
    fireEvent.change(within(dialog).getByLabelText('Unit rate 1'), { target: { value: '450.125000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create PR draft' }));

    await waitFor(() => expect(mocks.createSourceDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentType: 'purchase_requisition',
      requestKey: 'source-document-create:test-intent-key',
      input: expect.objectContaining({
        currency: 'INR',
        exchangeRate: '1',
        lines: [expect.objectContaining({ quantity: '12.500000', unitPrice: '450.125000', uom: 'LTR' })],
      }),
    })));
    expect(mocks.createSourceDocument.mock.calls[0][0].input.vendorId).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    dialog = screen.getByRole('dialog', { name: 'New purchase requisition' });
    fireEvent.change(within(dialog).getByLabelText('Document type'), { target: { value: 'goods_receipt' } });
    fireEvent.change(within(dialog).getByLabelText('Approved source document'), { target: { value: 'po-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create GRN draft' }));

    await waitFor(() => expect(mocks.createSourceDocument).toHaveBeenLastCalledWith(expect.objectContaining({
      documentType: 'goods_receipt',
      requestKey: 'source-document-create:test-intent-key',
      input: expect.objectContaining({
        sourceDocumentId: 'po-1',
        vendorId: 'vendor-1',
        lines: [expect.objectContaining({ sourceLineId: 'po-1-line-1', quantity: '10', unitPrice: '100' })],
      }),
    })));
  });

  it('preserves form values and its idempotency key across an ambiguous create retry', async () => {
    mocks.createSourceDocument.mockRejectedValueOnce(new Error('Network response was not confirmed')).mockResolvedValueOnce({});
    render(<MesaErpRoute initialView="source-to-pay" />);

    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    const dialog = screen.getByRole('dialog', { name: 'New purchase requisition' });
    fireEvent.change(within(dialog).getByLabelText('Description 1'), { target: { value: 'Retry-safe resin request' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create PR draft' }));
    await within(dialog).findByText('Network response was not confirmed');
    expect((within(dialog).getByLabelText('Description 1') as HTMLInputElement).value).toBe('Retry-safe resin request');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create PR draft' }));
    await waitFor(() => expect(mocks.createSourceDocument).toHaveBeenCalledTimes(2));
    expect(mocks.createSourceDocument.mock.calls[0][0].requestKey).toBe('source-document-create:test-intent-key');
    expect(mocks.createSourceDocument.mock.calls[1][0].requestKey).toBe('source-document-create:test-intent-key');
  });

  it('submits a draft purchase document with its current row version', async () => {
    render(<MesaErpRoute initialView="source-to-pay" />);

    fireEvent.click(screen.getAllByText('ACME-PRQ-000001')[0]);
    const dialog = screen.getByRole('dialog', { name: 'ACME-PRQ-000001' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for approval' }));

    await waitFor(() => expect(mocks.transitionSourceDocument).toHaveBeenCalledWith({
      documentType: 'purchase_requisition',
      documentId: 'pr-1',
      action: 'submit',
      expectedRowVersion: 0,
      requestKey: 'source-document-submit:test-intent-key',
    }));
  });

  it('keeps procurement usable when the independent sourcing query is forbidden', () => {
    mocks.requisitions = { data: undefined, isLoading: false, isError: true, error: new Error('Missing explicit MesaERP permission: mesaerp.sourcing.manage.'), refetch: vi.fn() };
    render(<MesaErpRoute initialView="source-to-pay" />);

    expect(screen.getAllByText('ACME-PO-000001').length).toBeGreaterThan(0);
    expect(screen.getByText(/Purchase requisitions: Missing explicit MesaERP permission/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New document' })).toBeTruthy();
  });

  it('evaluates and separately approves a persisted three-way variance', async () => {
    render(<MesaErpRoute initialView="purchase-match" />);

    fireEvent.click(screen.getByRole('button', { name: 'Evaluate match' }));
    let dialog = screen.getByRole('dialog', { name: 'Evaluate three-way match' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Evaluate match' }));
    await waitFor(() => expect(mocks.createPurchaseMatch).toHaveBeenCalledWith({
      purchaseOrderId: 'po-1',
      goodsReceiptId: 'grn-1',
      supplierInvoiceId: 'invoice-1',
      requestKey: 'purchase-match-create:test-intent-key',
    }));

    fireEvent.click(screen.getAllByText('SUP-INV-481')[0]);
    dialog = screen.getByRole('dialog', { name: 'match-1' });
    fireEvent.change(within(dialog).getByLabelText('Variance approval reason'), { target: { value: 'Receipt evidence supports the variance' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve variance' }));
    await waitFor(() => expect(mocks.approvePurchaseMatch).toHaveBeenCalledWith({
      matchCaseId: 'match-1',
      expectedRowVersion: 0,
      reason: 'Receipt evidence supports the variance',
      requestKey: 'purchase-match-approve:test-intent-key',
    }));
  });

  it('shows an exact persisted match without an exception approval action', () => {
    const variance = (mocks.purchaseMatches.data as Array<Record<string, unknown>>)[0];
    mocks.purchaseMatches = query([{ ...variance, status: 'matched', quantityVariance: '0', priceVariance: '0', taxVariance: '0', totalVariance: '0' }]);
    render(<MesaErpRoute initialView="purchase-match" />);

    fireEvent.click(screen.getAllByText('SUP-INV-481')[0]);
    const dialog = screen.getByRole('dialog', { name: 'match-1' });
    expect(within(dialog).getByText(/Exact match recorded/i)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Approve variance' })).toBeNull();
  });

  it('creates a balanced API voucher and advances a draft with its current version', async () => {
    render(<MesaErpRoute initialView="voucher-desk" />);

    fireEvent.change(screen.getByLabelText('Party / counterparty'), { target: { value: 'Internal production' } });
    fireEvent.change(screen.getByLabelText('Debit 1'), { target: { value: '1250.50' } });
    fireEvent.change(screen.getByLabelText('Credit 2'), { target: { value: '1250.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save balanced draft' }));

    await waitFor(() => expect(mocks.createVoucher).toHaveBeenCalledWith(expect.objectContaining({
      voucherType: 'journal',
      currencyCode: 'INR',
      narration: 'Internal production',
      lines: [
        expect.objectContaining({ ledgerAccountId: 'account-wip', debit: '1250.50', credit: '0' }),
        expect.objectContaining({ ledgerAccountId: 'account-overhead', debit: '0', credit: '1250.50' }),
      ],
    })));

    fireEvent.click(screen.getByRole('button', { name: 'Submit voucher' }));
    await waitFor(() => expect(mocks.submitVoucher).toHaveBeenCalledWith({ voucherId: 'voucher-1', expectedVersion: 2 }));
  });

  it('creates a reversal draft for a posted voucher with one stable form intent key', async () => {
    const voucher = (mocks.vouchers.data as Array<Record<string, unknown>>)[0];
    mocks.vouchers = query([{ ...voucher, status: 'posted', version: 6, voucherNumber: 'JRN-2026-0042' }]);
    render(<MesaErpRoute initialView="voucher-desk" />);

    fireEvent.click(screen.getByRole('button', { name: 'Create reversal draft' }));
    const dialog = screen.getByRole('dialog', { name: 'Create reversal draft' });
    fireEvent.change(within(dialog).getByLabelText('Reversal voucher date'), { target: { value: '2026-08-15' } });
    fireEvent.change(within(dialog).getByLabelText('Voucher reversal reason'), { target: { value: 'Correction approved after ledger review' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create reversal draft' }));

    await waitFor(() => expect(mocks.reverseVoucher).toHaveBeenCalledWith({
      voucherId: 'voucher-1',
      expectedVersion: 6,
      voucherDate: '2026-08-15',
      reason: 'Correction approved after ledger review',
      requestKey: 'voucher-reversal:test-intent-key',
    }));
  });

  it('replaces the complete exact MesaERP grant set', async () => {
    render(<MesaErpRoute initialView="roles-access" />);

    expect(screen.getByText('Finance User')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Post vouchers for Finance controller' }));

    await waitFor(() => expect(mocks.replacePermissions).toHaveBeenCalledWith({
      roleId: 'role-finance',
      expectedRoleVersion: 7,
      grants: ['mesaerp.voucher.post', 'mesaerp.voucher.read'],
    }));
  });

  it('creates and revokes company-scoped role assignments', async () => {
    render(<MesaErpRoute initialView="roles-access" />);

    fireEvent.click(screen.getByRole('button', { name: 'Assign person' }));
    let dialog = screen.getByRole('dialog', { name: 'Assign Finance controller' });
    fireEvent.change(within(dialog).getByLabelText('Organization membership ID'), { target: { value: 'member-208' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign role' }));
    await waitFor(() => expect(mocks.createAssignment).toHaveBeenCalledWith({ roleId: 'role-finance', membershipId: 'member-208' }));

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    dialog = screen.getByRole('dialog', { name: 'Revoke Finance controller' });
    fireEvent.change(within(dialog).getByLabelText('Role revocation reason'), { target: { value: 'Team responsibilities changed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke assignment' }));
    await waitFor(() => expect(mocks.revokeAssignment).toHaveBeenCalledWith({ assignmentId: 'assignment-1', rowVersion: 0, reason: 'Team responsibilities changed' }));
  });

  it('creates a company-scoped role with exact initial grants', async () => {
    render(<MesaErpRoute initialView="roles-access" />);

    fireEvent.click(screen.getByRole('button', { name: 'New role' }));
    const dialog = screen.getByRole('dialog', { name: 'Create MesaERP role' });
    fireEvent.change(within(dialog).getByLabelText('Role name'), { target: { value: 'Purchase checker' } });
    fireEvent.click(within(dialog).getByText('Post vouchers'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create role' }));

    await waitFor(() => expect(mocks.createRole).toHaveBeenCalledWith({
      input: { name: 'Purchase checker', grants: ['mesaerp.voucher.post'] },
      requestKey: 'role-create:test-intent-key',
    }));
  });
});
