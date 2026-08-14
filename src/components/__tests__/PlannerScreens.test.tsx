import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/apiClient', () => ({
  ApiError: class ApiError extends Error { status = 0; code = ''; },
  api: { get: vi.fn(), post: vi.fn(), postIdempotent: vi.fn(), patch: vi.fn(), patchIdempotent: vi.fn(), del: vi.fn() },
}));
import { api } from '../../lib/apiClient';
import { OrdersToPlan, PlanBoardScreen, Formulations } from '../planner/PlannerScreens';
import type { PlannerData } from '../planner/PlannerScreens';

const get = api.get as ReturnType<typeof vi.fn>;
const post = api.post as ReturnType<typeof vi.fn>;
const postIdempotent = api.postIdempotent as ReturnType<typeof vi.fn>;
const patchIdempotent = api.patchIdempotent as ReturnType<typeof vi.fn>;

const stub = {
  onOpen: () => {}, onTrace: () => {},
} satisfies PlannerData;

function renderUI(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
beforeEach(() => { get.mockReset(); post.mockReset(); postIdempotent.mockReset(); patchIdempotent.mockReset(); });

const orderRow = {
  id: 'oo1', orderNumber: 'OP-2026-102', legacySalesOrderId: 'o1', sourceType: 'mesaerp', sourceReference: 'ERP-SO-204', sourceLinkState: 'linked',
  productName: 'SPVC Sheathing', quantity: '12000', remainingQuantity: '5000', uom: 'kg', dueDate: '2026-08-15', priority: 'medium', status: 'partially_planned', customerName: 'Sterling',
  rowVersion: 3,
};
const machine = { id: 'm1', code: 'M07', line: 'PVC profile', family: 'PVC', status: 'running' };

describe('Planner — orders to plan (API)', () => {
  it('creates an independent MesaOps operational order before machine planning', async () => {
    get.mockImplementation((path: string) => path === '/planning/orders' ? Promise.resolve([]) : Promise.resolve([]));
    postIdempotent.mockResolvedValue({ id: 'oo-local-1', orderNumber: 'OP-LOCAL-001' });

    renderUI(<OrdersToPlan {...stub} />);
    fireEvent.click(await screen.findByRole('button', { name: /New operational order/i }));
    fireEvent.change(screen.getByLabelText('Order number'), { target: { value: 'OP-LOCAL-001' } });
    fireEvent.change(screen.getByLabelText('Order source'), { target: { value: 'trial' } });
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Trial polymer profile' } });
    fireEvent.change(screen.getByLabelText('Order quantity'), { target: { value: '125.5' } });
    fireEvent.change(screen.getByLabelText('Order UOM'), { target: { value: 'kg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create independent demand' }));

    await waitFor(() => expect(postIdempotent).toHaveBeenCalledWith(
      '/operational-orders',
      expect.objectContaining({ orderNumber: 'OP-LOCAL-001', sourceType: 'trial', productName: 'Trial polymer profile', quantity: '125.5', uom: 'kg' }),
      expect.stringMatching(/^operational-order:/),
    ));
  });

  it('lists an operational order and schedules a valid quantity split with required MesaOps fields', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/planning/orders') return Promise.resolve([orderRow]);
      if (path === '/machines') return Promise.resolve([machine]);
      if (path === '/planning/operators') return Promise.resolve([{ id: 'op1', employeeCode: 'EMP-007', role: 'Operator', user: { name: 'Nandlal' } }]);
      if (path === '/directory') return Promise.resolve([{ id: 'sup1', name: 'Supervisor One', email: 'supervisor@example.test', role: 'Supervisor', employeeCode: 'EMP-002', department: 'Production' }]);
      if (path === '/logbook/formulas') return Promise.resolve([{ id: 'f1', code: 'RF03', rev: 2, product: 'SPVC Sheathing' }]);
      if (path === '/logbook/templates') return Promise.resolve([{ id: 'tp1', docNo: 'QR/MFG/013', layout: 'coil', productName: 'SPVC Sheathing' }]);
      return Promise.resolve([]);
    });
    postIdempotent.mockResolvedValue({ machine: { code: 'M07' } });

    renderUI(<OrdersToPlan {...stub} />);
    expect(await screen.findByText('OP-2026-102')).toBeTruthy();
    expect(screen.getByText('MesaERP')).toBeTruthy();
    expect(screen.getByText('linked')).toBeTruthy();
    expect(screen.getByText('5,000 / 12,000 kg')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Plan$/i }));
    await screen.findByRole('option', { name: 'Supervisor One' });
    await screen.findByRole('option', { name: 'RF03 · Rev 2' });

    fireEvent.change(screen.getByLabelText(/Planned quantity/i), { target: { value: '6000' } });
    fireEvent.change(screen.getByLabelText(/Shift supervisor/i), { target: { value: 'Supervisor One' } });
    fireEvent.change(screen.getByLabelText(/^Operator/i), { target: { value: 'Nandlal' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. DRW-042'), { target: { value: 'DRW-042' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. MLD-12'), { target: { value: 'MLD-12' } });
    fireEvent.change(screen.getByLabelText(/Formula No/i), { target: { value: 'RF03 · Rev 2' } });
    const scheduleButton = screen.getByRole('button', { name: /Schedule on M07/i }) as HTMLButtonElement;
    expect(scheduleButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Planned quantity/i), { target: { value: '4000' } });
    expect(scheduleButton.disabled).toBe(false);
    fireEvent.click(scheduleButton);
    await waitFor(() => expect(postIdempotent).toHaveBeenCalledWith('/plans', expect.objectContaining({
      operationalOrderId: 'oo1', salesOrderId: 'o1', plannedQuantity: '4000', machineId: 'm1', shift: 'D', operatorName: 'Nandlal',
      expectedOrderVersion: 3,
      scheduledStartDate: '2026-08-15T08:00:00', scheduledEndDate: '2026-08-15T20:00:00',
      supervisor: 'Supervisor One', drawingNo: 'DRW-042', formulaNo: 'RF03 · Rev 2', moldNo: 'MLD-12', productName: 'SPVC Sheathing',
    }), expect.stringMatching(/^production-plan:/)));
  });

  it('still renders the legacy sales-order-shaped response', async () => {
    get.mockImplementation((path: string) => path === '/planning/orders'
      ? Promise.resolve([{ id: 'legacy-o1', soNumber: 'SO-LEGACY-01', product: 'Legacy product', quantity: 20, deliveryDate: '2026-08-20', priority: 'low', status: 'pending', customer: { name: 'Legacy customer' } }])
      : Promise.resolve([]));

    renderUI(<OrdersToPlan {...stub} />);
    expect(await screen.findByText('SO-LEGACY-01')).toBeTruthy();
    expect(screen.getByText('Local customer')).toBeTruthy();
    expect(screen.getByText('Independent')).toBeTruthy();
  });
});

describe('Planner — plan board (API)', () => {
  it('lists production plans and releases one', async () => {
    get.mockResolvedValue([{
      id: 'p1', version: 4, operationalOrderId: 'oo2', salesOrderId: null, machineId: 'm1', plannedQuantity: '2500', shift: 'D', operatorName: '', scheduledStartDate: '2026-08-20T08:00:00', scheduledEndDate: '', status: 'scheduled',
      supervisor: 'Supervisor One', drawingNo: 'DRW-101', formulaNo: 'RF04 · Rev 1', moldNo: 'MLD-20', productName: 'LD Beads',
      machine: { code: 'M04', line: 'x' }, operationalOrder: { id: 'oo2', orderNumber: 'OP-2026-101', sourceType: 'forecast', sourceReference: '', customerName: '', productName: 'LD Beads', quantity: '8000', uom: 'kg', dueDate: '2026-08-01', priority: 'medium', status: 'planned', sourceLinkState: 'independent' },
    }]);
    postIdempotent.mockResolvedValue({ ok: true });

    renderUI(<PlanBoardScreen {...stub} />);
    expect(await screen.findByText('OP-2026-101')).toBeTruthy();
    expect(screen.getByText('M04')).toBeTruthy();
    expect(screen.getByText('Forecast')).toBeTruthy();
    expect(screen.getByText('Independent')).toBeTruthy();
    expect(screen.getByText('2,500 kg')).toBeTruthy();
    fireEvent.click(screen.getByText('Release'));
    await waitFor(() => expect(postIdempotent).toHaveBeenCalledWith('/plans/p1/release', { expectedVersion: 4 }, expect.stringMatching(/^production-plan-release:/)));
  });
});

const formulas = [
  { id: 'f1', code: 'RF03', rev: 1, product: 'RPVC White', active: false, locked: true, lockReason: 'Locked by CAPA-012', capaId: 'CAPA-012', components: [{ name: 'RPVC resin', pct: 78, lotId: 'L1' }] },
  { id: 'f2', code: 'RF03', rev: 2, product: 'RPVC White', active: true, locked: false, lockReason: '', capaId: null, components: [{ name: 'RPVC resin', pct: 80, lotId: 'L1' }, { name: 'CaCO3', pct: 20, lotId: 'L2' }] },
];

describe('Planner — formulations (API)', () => {
  it('lists formulations with revisions and lock state', async () => {
    get.mockResolvedValue(formulas);
    renderUI(<Formulations {...stub} />);
    expect(await screen.findByText('RF03 · Rev 2')).toBeTruthy();
    expect(screen.getByText('RF03 · Rev 1')).toBeTruthy();
  });

  it('adds a formulation via the API', async () => {
    get.mockResolvedValue(formulas);
    post.mockResolvedValue({ code: 'RF04', rev: 1 });
    renderUI(<Formulations {...stub} />);
    fireEvent.click(await screen.findByText('Add formulation')); // header → open modal
    fireEvent.change(screen.getByPlaceholderText('e.g. RF04'), { target: { value: 'RF04' } });
    fireEvent.change(screen.getByPlaceholderText('Component'), { target: { value: 'PVC resin' } });
    fireEvent.change(screen.getByPlaceholderText('%'), { target: { value: '100' } });
    const adds = screen.getAllByText('Add formulation'); // [header, modal submit]
    fireEvent.click(adds[adds.length - 1]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/formulations', expect.objectContaining({
      code: 'RF04', components: [expect.objectContaining({ name: 'PVC resin', pct: 100 })],
    })));
  });
});
