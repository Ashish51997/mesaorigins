import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SupplierPortalRoute from './SupplierPortalRoute';

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  acceptInvite: vi.fn(),
  logout: vi.fn(),
  requestChange: vi.fn(),
}));

const mutation = (mutateAsync = vi.fn()) => ({ mutateAsync, isPending: false });

vi.mock('@mesaerp/lib/queries/supplierPortal', () => ({
  useSupplierPortalWorkspace: mocks.workspace,
  useSupplierPortalActions: () => ({
    acceptInvite: mutation(mocks.acceptInvite),
    logout: mutation(mocks.logout),
    requestChange: mutation(mocks.requestChange),
    addDocument: mutation(),
    submitQuotation: mutation(),
    acknowledgePo: mutation(),
    createAsn: mutation(),
    addInvoiceEvidence: mutation(),
    respondToDispute: mutation(),
  }),
}));

const workspace = {
  user: { id: 'supplier-user-1', name: 'Asha Supplier', email: 'asha@example.test', permissions: ['supplier.payment.read'] },
  vendor: {
    id: 'vendor-1', vendorCode: 'V-001', legalName: 'Safe Polymer Supplies', tradeName: '', gstin: '',
    addresses: [], contacts: [], paymentTerms: 'NET30', currency: 'INR', lifecycleStatus: 'active', complianceStatus: 'verified',
  },
  documents: [],
  rfqInvitations: [],
  purchaseOrders: [],
  acknowledgements: [],
  asns: [],
  supplierInvoices: [],
  invoiceEvidence: [],
  changeCases: [],
  disputes: [],
  paymentStatus: [{
    id: 'proposal-1', proposalNumber: 'PAY-001', supplierInvoiceId: 'invoice-1', status: 'approved',
    amount: '125000.25', currency: 'INR', proposedPaymentOn: '2026-08-22', paymentVoucher: { status: 'draft' },
  }],
  controls: { otherVendorsVisible: false, employeeApisVisible: false, financeJournalsVisible: false, binaryUploadAdapter: false },
};

describe('SupplierPortalRoute', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/supplier-portal');
    mocks.acceptInvite.mockReset();
    mocks.logout.mockReset();
    mocks.requestChange.mockReset();
    mocks.workspace.mockReset().mockReturnValue({
      data: workspace,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it('renders a vendor-scoped workspace without employee or journal access', () => {
    render(<SupplierPortalRoute />);

    expect(screen.getByText(/V-001/)).toBeTruthy();
    expect(screen.getByText(/without access to other suppliers, employees or finance journals/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Payment status' }));
    expect(screen.getByText(/never exposes ledgers, voucher lines, bank details or bank-initiation controls/i)).toBeTruthy();
    expect(screen.getByText(/Internal payment document: Draft/i)).toBeTruthy();
  });

  it('shows the one-time supplier invitation gate when no supplier session exists', () => {
    mocks.workspace.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Supplier session required'),
      refetch: vi.fn(),
    });

    render(<SupplierPortalRoute />);

    expect(screen.getByRole('heading', { name: 'One vendor. One secure workspace.' })).toBeTruthy();
    expect(screen.getByText(/Supplier access is separate from every employee login/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept invitation' })).toBeTruthy();
  });

  it('reads the invite from the URL fragment and immediately removes it from browser history', async () => {
    const token = 'supplier-one-time-token-with-adequate-length';
    window.history.replaceState({}, '', `/supplier-portal#invite=${encodeURIComponent(token)}`);
    mocks.workspace.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Supplier session required'),
      refetch: vi.fn(),
    });

    render(<SupplierPortalRoute />);

    expect((screen.getByLabelText('Supplier invitation token') as HTMLTextAreaElement).value).toBe(token);
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(window.location.pathname).toBe('/supplier-portal');
  });

  it('renders a failed supplier mutation without leaking an unhandled rejection', async () => {
    mocks.requestChange.mockRejectedValue(new Error('Approval service unavailable'));
    render(<SupplierPortalRoute />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Profile & documents' })[0]);
    fireEvent.change(screen.getByLabelText('Proposed value'), { target: { value: 'Updated trade name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit approval case' }));

    await waitFor(() => expect(screen.getByText('Approval service unavailable')).toBeTruthy());
    expect(mocks.requestChange).toHaveBeenCalledTimes(1);
  });
});
