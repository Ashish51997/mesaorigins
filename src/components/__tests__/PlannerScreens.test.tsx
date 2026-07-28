import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/apiClient', () => ({
  ApiError: class ApiError extends Error { status = 0; code = ''; },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));
import { api } from '../../lib/apiClient';
import { OrdersToPlan, PlanBoardScreen, Formulations } from '../planner/PlannerScreens';
import type { PlannerData } from '../planner/PlannerScreens';

const get = api.get as ReturnType<typeof vi.fn>;
const post = api.post as ReturnType<typeof vi.fn>;

const stub = {
  salesOrders: [], setSalesOrders: () => {}, productionPlans: [], setProductionPlans: () => {},
  customers: [], onOpen: () => {}, onTrace: () => {},
} as unknown as PlannerData;

function renderUI(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
beforeEach(() => { get.mockReset(); post.mockReset(); });

const orderRow = { id: 'o1', soNumber: 'SO-2026-102', product: 'SPVC Sheathing', quantity: 12000, deliveryDate: '2026-08-15', priority: 'medium', status: 'pending', customer: { name: 'Sterling' } };
const machine = { id: 'm1', code: 'M07', line: 'PVC profile', family: 'PVC', status: 'running' };

describe('Planner — orders to plan (API)', () => {
  it('lists pending orders and schedules one via the API', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/planning/orders') return Promise.resolve([orderRow]);
      if (path === '/machines') return Promise.resolve([machine]);
      if (path === '/planning/operators') return Promise.resolve([{ id: 'op1', employeeCode: 'EMP-007', role: 'Operator', user: { name: 'Nandlal' } }]);
      return Promise.resolve([]);
    });
    post.mockResolvedValue({ machine: { code: 'M07' } });

    renderUI(<OrdersToPlan {...stub} />);
    expect(await screen.findByText('SO-2026-102')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Plan$/i }));
    // modal opens; wait for machines to load so the schedule button is ready
    fireEvent.click(await screen.findByText(/Schedule on M07/i));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/plans', expect.objectContaining({ salesOrderId: 'o1', machineId: 'm1', shift: 'D' })));
  });
});

describe('Planner — plan board (API)', () => {
  it('lists production plans and releases one', async () => {
    get.mockResolvedValue([{
      id: 'p1', salesOrderId: 'o1', machineId: 'm1', shift: 'D', operatorName: '', scheduledStartDate: '2026-08-20T08:00:00', scheduledEndDate: '', status: 'scheduled',
      machine: { code: 'M04', line: 'x' }, salesOrder: { soNumber: 'SO-2026-101', product: 'LD Beads', deliveryDate: '2026-08-01', customer: { name: 'Apex' } },
    }]);
    post.mockResolvedValue({ ok: true });

    renderUI(<PlanBoardScreen {...stub} />);
    expect(await screen.findByText('SO-2026-101')).toBeTruthy();
    expect(screen.getByText('M04')).toBeTruthy();
    fireEvent.click(screen.getByText('Release'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/plans/p1/release'));
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
