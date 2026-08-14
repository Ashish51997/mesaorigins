import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  useApproveErpPurchaseMatch,
  useCreateErpCustomer,
  useCreateErpEntity,
  useCreateErpManufacturingVoucher,
  useCreateErpProductionDemand,
  useCreateErpPurchaseMatch,
  useCreateErpRole,
  useCreateErpSalesDocument,
  useCreateErpSourceToPayDocument,
  useErpBatchCosts,
  useErpCustomers,
  useErpManufacturingVouchers,
  useErpProductionDemands,
  useErpSalesDocuments,
  useErpSupplierManagement,
  useErpSupplierWorkspace,
  useErpSourceToPayDocuments,
  useReverseErpVoucher,
  useTransitionErpSourceToPayDocument,
  type ErpSourceToPayDocumentType,
} from '../../lib/queries/mesaerp';
import {
  useAcceptErpOpsReturn,
  useErpOpsReturnInbox,
  useReceiveErpOpsReturn,
  useRejectErpOpsReturn,
  useRetryErpOpsReturn,
} from '../../lib/queries/mesaerpHandoffs';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  postIdempotent: vi.fn(),
}));

vi.mock('../../lib/apiClient', () => ({
  api: {
    get: mocks.get,
    postIdempotent: mocks.postIdempotent,
    patchIdempotent: vi.fn(),
    putIdempotent: vi.fn(),
  },
}));

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function ReadProbe({ type }: { type: ErpSourceToPayDocumentType }) {
  const query = useErpSourceToPayDocuments('company-1', type);
  return <p>{query.isSuccess ? 'ready' : 'loading'}</p>;
}

function MutationProbe() {
  const createDocument = useCreateErpSourceToPayDocument('company-1');
  const transitionDocument = useTransitionErpSourceToPayDocument('company-1');
  const createMatch = useCreateErpPurchaseMatch('company-1');
  const approveMatch = useApproveErpPurchaseMatch('company-1');
  return <div>
    <button type="button" onClick={() => createDocument.mutate({
      documentType: 'goods_receipt',
      requestKey: 'grn-form-intent-001',
      input: { documentDate: '2026-08-14', vendorId: 'vendor-1', lines: [{ description: 'Resin', quantity: '8.000000', uom: 'KG', unitPrice: '100.000000' }] },
    })}>create document</button>
    <button type="button" onClick={() => transitionDocument.mutate({ documentType: 'goods_receipt', documentId: 'grn-1', action: 'approve', expectedRowVersion: 1, requestKey: 'grn-approve-intent-001' })}>approve document</button>
    <button type="button" onClick={() => createMatch.mutate({ purchaseOrderId: 'po-1', goodsReceiptId: 'grn-1', supplierInvoiceId: 'invoice-1', requestKey: 'match-form-intent-001' })}>create match</button>
    <button type="button" onClick={() => approveMatch.mutate({ matchCaseId: 'match-1', expectedRowVersion: 0, reason: 'Checked against receipt evidence', requestKey: 'match-approve-intent-001' })}>approve match</button>
  </div>;
}

function FoundationMutationProbe() {
  const createEntity = useCreateErpEntity();
  const createRole = useCreateErpRole('company-1');
  const reverseVoucher = useReverseErpVoucher('company-1');
  return <div>
    <button type="button" onClick={() => createEntity.mutate({ input: { code: 'NOVA', name: 'Nova Components', countryCode: 'IN', baseCurrency: 'INR', fiscalYearStartMonth: 4 }, requestKey: 'entity-form-intent-001' })}>create entity</button>
    <button type="button" onClick={() => createRole.mutate({ input: { name: 'Purchase checker', grants: ['mesaerp.purchase.match'] }, requestKey: 'role-form-intent-001' })}>create role</button>
    <button type="button" onClick={() => reverseVoucher.mutate({ voucherId: 'voucher-1', expectedVersion: 6, voucherDate: '2026-08-15', reason: 'Correction approved after ledger review', requestKey: 'reversal-form-intent-001' })}>reverse voucher</button>
  </div>;
}

function CommercialManufacturingReadProbe() {
  useErpCustomers('company-1');
  useErpSalesDocuments('company-1', 'sales_order');
  useErpSalesDocuments('company-1', 'sales_invoice');
  useErpProductionDemands('company-1');
  useErpManufacturingVouchers('company-1');
  useErpBatchCosts('company-1');
  return <p>commercial reads</p>;
}

function CommercialManufacturingMutationProbe() {
  const createCustomer = useCreateErpCustomer('company-1');
  const createSales = useCreateErpSalesDocument('company-1');
  const createDemand = useCreateErpProductionDemand('company-1');
  const createManufacturing = useCreateErpManufacturingVoucher('company-1');
  return <div>
    <button type="button" onClick={() => createCustomer.mutate({ input: { customerCode: 'CUS-9', legalName: 'Buyer Nine', currency: 'INR', creditLimit: '125000.00' }, requestKey: 'customer-intent-001' })}>create customer</button>
    <button type="button" onClick={() => createSales.mutate({ documentType: 'sales_order', input: { documentDate: '2026-08-14', customerId: 'customer-9', lines: [{ itemId: 'FG-9', description: 'Finished good', quantity: '12.500000', uom: 'EA', unitPrice: '100.125000' }] }, requestKey: 'sales-intent-001' })}>create sales</button>
    <button type="button" onClick={() => createDemand.mutate({ input: { demandDate: '2026-08-14', demandType: 'trial', itemId: 'FG-9', quantity: '4.250000', uom: 'EA' }, requestKey: 'demand-intent-001' })}>create demand</button>
    <button type="button" onClick={() => createManufacturing.mutate({ input: { voucherType: 'completion', businessDate: '2026-08-14', batchNumber: 'LOT-9', outputLines: [{ itemId: 'FG-9', description: 'Finished good', quantity: '4.250000', uom: 'EA' }] }, requestKey: 'manufacturing-intent-001' })}>create manufacturing</button>
  </div>;
}

function SupplierReadProbe() {
  const query = useErpSupplierWorkspace('company-1');
  return <p>{query.isSuccess ? 'supplier ready' : 'supplier loading'}</p>;
}

function SupplierMutationProbe() {
  const actions = useErpSupplierManagement('company-1');
  return <div>
    <button type="button" onClick={() => actions.createRfq.mutate({
      input: {
        rfqNumber: 'RFQ-001',
        title: 'Polymer supply',
        description: 'Technical and commercial response required',
        currency: 'INR',
        responseDueAt: '2026-08-20T12:00:00.000Z',
        commercialTerms: {},
        technicalTerms: {},
        invitedVendorIds: ['vendor-1'],
        lines: [{ description: 'Resin grade A', quantity: '125.500000', uom: 'KG', technicalSpecification: {} }],
      },
      requestKey: 'rfq-form-intent-001',
    })}>create rfq</button>
    <button type="button" onClick={() => actions.invitePortalUser.mutate({
      vendorId: 'vendor-1',
      input: { email: 'supplier@example.test', name: 'Supplier User', expiresInHours: 48, permissions: ['supplier.rfq.respond'] },
      requestKey: 'portal-invite-intent-001',
    })}>invite supplier</button>
    <button type="button" onClick={() => actions.createPaymentProposal.mutate({
      input: {
        vendorId: 'vendor-1', supplierInvoiceId: 'invoice-1', proposalNumber: 'PAY-001',
        amount: '125000.25', currency: 'INR', proposedPaymentOn: '2026-08-22',
        payableAccountId: 'payable-1', settlementAccountId: 'bank-1', narration: 'Approved invoice proposal',
      },
      requestKey: 'payment-proposal-intent-001',
    })}>create payment proposal</button>
  </div>;
}

function HandoffReturnProbe() {
  useErpOpsReturnInbox('company-1');
  const receive = useReceiveErpOpsReturn('company-1');
  const accept = useAcceptErpOpsReturn('company-1');
  const retry = useRetryErpOpsReturn('company-1');
  const reject = useRejectErpOpsReturn('company-1');
  return <div>
    <button type="button" onClick={() => receive.mutate({ event: { eventId: 'event-1', eventType: 'mesaops.production-actuals.submitted.v1', schemaVersion: 1, aggregateType: 'OperationalOrder', aggregateId: 'order-1', payloadHash: 'a'.repeat(64), occurredAt: '2026-08-14T12:00:00.000Z', state: 'available' }, requestKey: 'receive-intent-001' })}>receive return</button>
    <button type="button" onClick={() => accept.mutate({ inboxId: 'inbox-1', expectedRowVersion: 2, costRates: [{ kind: 'labor', reference: 'GRADE-A', rate: '250.125000' }], notes: 'Mapped and checked', requestKey: 'accept-intent-001' })}>accept return</button>
    <button type="button" onClick={() => retry.mutate({ inboxId: 'inbox-1', expectedRowVersion: 3, reason: 'Item mapping corrected', requestKey: 'retry-intent-001' })}>retry return</button>
    <button type="button" onClick={() => reject.mutate({ inboxId: 'inbox-2', expectedRowVersion: 1, reason: 'Duplicate dispatch evidence', requestKey: 'reject-intent-001' })}>reject return</button>
  </div>;
}

describe('MesaERP source-to-pay query contracts', () => {
  it.each([
    ['purchase_requisition', 'purchase-requisitions'],
    ['purchase_order', 'purchase-orders'],
    ['goods_receipt', 'goods-receipts'],
    ['supplier_invoice', 'supplier-invoices'],
  ] as const)('loads %s from its typed company resource', async (type, path) => {
    mocks.get.mockReset().mockResolvedValue([]);
    renderWithClient(<ReadProbe type={type} />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(`/mesaerp/v1/entities/company-1/${path}`));
  });

  it('preserves caller-owned idempotency keys across document and match mutations', async () => {
    mocks.postIdempotent.mockReset().mockResolvedValue({});
    renderWithClient(<MutationProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'create document' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaerp/v1/entities/company-1/goods-receipts',
      expect.objectContaining({ documentDate: '2026-08-14', lines: [expect.objectContaining({ quantity: '8.000000', unitPrice: '100.000000' })] }),
      'grn-form-intent-001',
    ));

    fireEvent.click(screen.getByRole('button', { name: 'approve document' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaerp/v1/entities/company-1/goods-receipts/grn-1/approve',
      { expectedRowVersion: 1 },
      'grn-approve-intent-001',
    ));

    fireEvent.click(screen.getByRole('button', { name: 'create match' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaerp/v1/entities/company-1/purchase-matches',
      { purchaseOrderId: 'po-1', goodsReceiptId: 'grn-1', supplierInvoiceId: 'invoice-1' },
      'match-form-intent-001',
    ));

    fireEvent.click(screen.getByRole('button', { name: 'approve match' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaerp/v1/entities/company-1/purchase-matches/match-1/approve',
      { expectedRowVersion: 0, reason: 'Checked against receipt evidence' },
      'match-approve-intent-001',
    ));
  });

  it('persists company and role creation with their form-intent keys', async () => {
    mocks.postIdempotent.mockReset().mockResolvedValue({});
    renderWithClient(<FoundationMutationProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'create entity' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaerp/v1/entities',
      { code: 'NOVA', name: 'Nova Components', countryCode: 'IN', baseCurrency: 'INR', fiscalYearStartMonth: 4 },
      'entity-form-intent-001',
    ));

    fireEvent.click(screen.getByRole('button', { name: 'create role' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaerp/v1/entities/company-1/access/roles',
      { name: 'Purchase checker', grants: ['mesaerp.purchase.match'] },
      'role-form-intent-001',
    ));

    fireEvent.click(screen.getByRole('button', { name: 'reverse voucher' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaerp/v1/entities/company-1/vouchers/voucher-1/reversals',
      { expectedVersion: 6, voucherDate: '2026-08-15', reason: 'Correction approved after ledger review' },
      'reversal-form-intent-001',
    ));
  });

  it('loads all commercial and manufacturing registers from company-scoped resources', async () => {
    mocks.get.mockReset().mockResolvedValue([]);
    renderWithClient(<CommercialManufacturingReadProbe />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(6));
    for (const path of ['customers', 'sales-orders', 'sales-invoices', 'production-demands', 'manufacturing-vouchers', 'batch-costs']) {
      expect(mocks.get).toHaveBeenCalledWith(`/mesaerp/v1/entities/company-1/${path}`);
    }
  });

  it('preserves exact decimals and caller-owned keys for commercial and manufacturing creates', async () => {
    mocks.postIdempotent.mockReset().mockResolvedValue({});
    renderWithClient(<CommercialManufacturingMutationProbe />);
    fireEvent.click(screen.getByRole('button', { name: 'create customer' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith('/mesaerp/v1/entities/company-1/customers', expect.objectContaining({ creditLimit: '125000.00' }), 'customer-intent-001'));
    fireEvent.click(screen.getByRole('button', { name: 'create sales' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith('/mesaerp/v1/entities/company-1/sales-orders', expect.objectContaining({ lines: [expect.objectContaining({ quantity: '12.500000', unitPrice: '100.125000' })] }), 'sales-intent-001'));
    fireEvent.click(screen.getByRole('button', { name: 'create demand' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith('/mesaerp/v1/entities/company-1/production-demands', expect.objectContaining({ quantity: '4.250000' }), 'demand-intent-001'));
    fireEvent.click(screen.getByRole('button', { name: 'create manufacturing' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith('/mesaerp/v1/entities/company-1/manufacturing-vouchers', expect.objectContaining({ outputLines: [expect.objectContaining({ quantity: '4.250000' })] }), 'manufacturing-intent-001'));
  });

  it('loads the employee supplier administration projection from its company boundary', async () => {
    mocks.get.mockReset().mockResolvedValue({ vendors: [], rfqs: [] });
    renderWithClient(<SupplierReadProbe />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/mesaerp/v1/entities/company-1/supplier-workspace'));
  });

  it('keeps supplier workflow decimals and caller-owned intent keys exact', async () => {
    mocks.postIdempotent.mockReset().mockResolvedValue({});
    renderWithClient(<SupplierMutationProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'create rfq' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaerp/v1/entities/company-1/rfqs',
      expect.objectContaining({ lines: [expect.objectContaining({ quantity: '125.500000' })] }),
      'rfq-form-intent-001',
    ));

    fireEvent.click(screen.getByRole('button', { name: 'invite supplier' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaerp/v1/entities/company-1/vendors/vendor-1/portal-invitations',
      expect.objectContaining({ permissions: ['supplier.rfq.respond'] }),
      'portal-invite-intent-001',
    ));

    fireEvent.click(screen.getByRole('button', { name: 'create payment proposal' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaerp/v1/entities/company-1/payment-proposals',
      expect.objectContaining({ amount: '125000.25' }),
      'payment-proposal-intent-001',
    ));
  });

  it('loads and controls the company-owned MesaOps return inbox with exact evidence contracts', async () => {
    mocks.get.mockReset().mockResolvedValue({ inbox: [], available: [] });
    mocks.postIdempotent.mockReset().mockResolvedValue({});
    renderWithClient(<HandoffReturnProbe />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/mesaerp/v1/entities/company-1/handoff-inbox'));

    fireEvent.click(screen.getByRole('button', { name: 'receive return' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaerp/v1/entities/company-1/handoff-inbox/events/event-1/receive',
      { expectedPayloadHash: 'a'.repeat(64), expectedEventType: 'mesaops.production-actuals.submitted.v1', expectedSchemaVersion: 1 },
      'receive-intent-001',
    ));
    fireEvent.click(screen.getByRole('button', { name: 'accept return' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaerp/v1/entities/company-1/handoff-inbox/inbox-1/accept',
      { expectedRowVersion: 2, costRates: [{ kind: 'labor', reference: 'GRADE-A', rate: '250.125000' }], notes: 'Mapped and checked' },
      'accept-intent-001',
    ));
    fireEvent.click(screen.getByRole('button', { name: 'retry return' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith('/mesaerp/v1/entities/company-1/handoff-inbox/inbox-1/retry', { expectedRowVersion: 3, reason: 'Item mapping corrected' }, 'retry-intent-001'));
    fireEvent.click(screen.getByRole('button', { name: 'reject return' }));
    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith('/mesaerp/v1/entities/company-1/handoff-inbox/inbox-2/reject', { expectedRowVersion: 1, reason: 'Duplicate dispatch evidence' }, 'reject-intent-001'));
  });
});
