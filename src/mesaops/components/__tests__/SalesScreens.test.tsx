import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The migrated Sales screens talk to the API via src/lib/apiClient. Mock it so
// tests drive the UI without a server.
vi.mock('@shared/lib/apiClient', () => ({
  ApiError: class ApiError extends Error { status = 0; code = ''; },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));
import { api } from '@shared/lib/apiClient';
import { Inquiries, Orders, SalesCustomers, SalesComplaints } from '../sales/SalesScreens';
import type { SalesData } from '../sales/SalesScreens';

const get = api.get as ReturnType<typeof vi.fn>;
const post = api.post as ReturnType<typeof vi.fn>;

const stub = {
  onOpen: () => {}, onTrace: () => {},
} satisfies SalesData;

const customers = [{ id: 'c1', name: 'Acme Pipes', status: 'active', gstNumber: '', contactPerson: '', phone: '', email: '', billingAddress: '', deliveryAddress: '', paymentTerms: '' }];

function renderUI(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe('Sales — customers (API-backed)', () => {
  it('renders the customer list from the API', async () => {
    get.mockResolvedValue(customers);
    renderUI(<SalesCustomers {...stub} />);
    expect(await screen.findByText('Acme Pipes')).toBeTruthy();
    expect(screen.getByText('1 on file')).toBeTruthy();
  });

  it('creates a customer via the API', async () => {
    get.mockResolvedValue([]);
    post.mockResolvedValue({ id: 'c9', name: 'Nova Polymers' });
    renderUI(<SalesCustomers {...stub} />);
    fireEvent.click(await screen.findByText('Add customer')); // header → open modal
    fireEvent.change(screen.getByPlaceholderText('e.g. Sunrise Pipes Pvt Ltd'), { target: { value: 'Nova Polymers' } });
    const adds = screen.getAllByText('Add customer'); // [header, modal submit]
    fireEvent.click(adds[adds.length - 1]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/mesaops/v1/customers', expect.objectContaining({ name: 'Nova Polymers' })));
  });
});

describe('Sales — inquiry (API-backed)', () => {
  it('requires product/qty/customer/date then posts the inquiry', async () => {
    get.mockImplementation((path: string) => (path === '/mesaops/v1/customers' ? Promise.resolve(customers) : Promise.resolve([])));
    post.mockResolvedValue({ inquiryNumber: 'INQ-2026-100' });
    renderUI(<Inquiries {...stub} />);
    fireEvent.click(await screen.findByRole('button', { name: /log inquiry/i }));
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('c1'));
    const save = () => screen.getByRole('button', { name: /save inquiry/i }) as HTMLButtonElement;
    expect(save().disabled).toBe(true); // product empty
    fireEvent.change(screen.getByPlaceholderText('e.g. RPVC pipe 20mm'), { target: { value: 'RPVC pipe 20mm' } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(post).toHaveBeenCalledWith('/mesaops/v1/inquiries', expect.objectContaining({ product: 'RPVC pipe 20mm', quantity: 5000, customerId: 'c1' })));
  });
});

describe('Sales — order (API-backed)', () => {
  it('confirms a quoted inquiry via the API', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/mesaops/v1/customers') return Promise.resolve(customers);
      if (path === '/mesaops/v1/inquiries') return Promise.resolve([{ id: 'i1', inquiryNumber: 'INQ-1', customerId: 'c1', product: 'RPVC 20mm', quantity: 1000, status: 'quotation', expectedDeliveryDate: '2026-08-01', drawingRef: '', remarks: '' }]);
      return Promise.resolve([]); // orders
    });
    post.mockResolvedValue({ soNumber: 'SO-2026-150' });
    renderUI(<Orders {...stub} />);
    fireEvent.click(await screen.findByText('Confirm order'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/mesaops/v1/orders', expect.objectContaining({ inquiryId: 'i1' })));
  });
});

describe('Sales — complaint + CAPA (API-backed)', () => {
  const batches = [{ id: 'd1', invoiceNumber: 'INV-2026-806', salesOrderId: 'so1', dispatchDate: '2026-07-01', salesOrder: { soNumber: 'SO-1', product: 'RPVC roll', customerId: 'c1', customer: { name: 'Acme Pipes' } } }];
  const openCapa = { id: 'k1', complaintId: 'x1', rootCause: '', correctiveAction: '', preventiveAction: '', responsiblePerson: '', dueDate: '2026-07-10', status: 'open', closedDate: null };
  const complaintOpen = { id: 'x1', complaintNumber: 'C-2026-105', customerId: 'c1', batchNumber: 'INV-2026-806', product: 'RPVC roll', description: '', photoUrl: null, severity: 'high', status: 'investigating', date: '2026-07-01', capaId: 'k1', customer: { name: 'Acme Pipes' }, capa: openCapa };

  const wire = (complaint: unknown) => get.mockImplementation((path: string) => {
    if (path === '/mesaops/v1/complaints/batches') return Promise.resolve(batches);
    if (path === '/mesaops/v1/complaints') return Promise.resolve([complaint]);
    return Promise.resolve([]);
  });

  it('logs a complaint against a dispatched batch via the API', async () => {
    get.mockImplementation((path: string) => (path === '/mesaops/v1/complaints/batches' ? Promise.resolve(batches) : Promise.resolve([])));
    post.mockResolvedValue({ complaintNumber: 'C-2026-105', capa: openCapa });
    renderUI(<SalesComplaints {...stub} />);
    fireEvent.click(await screen.findByRole('button', { name: /^log complaint$/i }));
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('so1'));
    fireEvent.click(screen.getByRole('button', { name: /save complaint/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/mesaops/v1/complaints', expect.objectContaining({ salesOrderId: 'so1', severity: 'high' })));
  });

  it('blocks Resolve until the CAPA is closed', async () => {
    wire(complaintOpen);
    renderUI(<SalesComplaints {...stub} />);
    expect(await screen.findByText(/C-2026-105/)).toBeTruthy();
    expect(screen.getAllByText('CAPA open').length).toBeGreaterThan(0);
    expect((screen.getByText('Resolve').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('resolves once the CAPA is closed', async () => {
    wire({ ...complaintOpen, capa: { ...openCapa, status: 'closed', closedDate: '2026-07-05' } });
    post.mockResolvedValue({ complaintNumber: 'C-2026-105', status: 'resolved' });
    renderUI(<SalesComplaints {...stub} />);
    await screen.findByText(/C-2026-105/);
    const resolveBtn = screen.getByText('Resolve').closest('button') as HTMLButtonElement;
    expect(resolveBtn.disabled).toBe(false);
    fireEvent.click(resolveBtn);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/mesaops/v1/complaints/x1/resolve'));
  });
});
