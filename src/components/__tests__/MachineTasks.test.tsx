import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

vi.mock('../../lib/apiClient', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

vi.mock('../LogbookModule', () => ({
  default: ({ initialPlanId }: { initialPlanId?: string }) => (
    <div data-testid="logbook-module">plan:{initialPlanId}</div>
  ),
}));

import { api, ApiError } from '../../lib/apiClient';
import MachineTasks from '../MachineTasks';

const get = api.get as ReturnType<typeof vi.fn>;

function hubPayload(overrides: Record<string, unknown> = {}) {
  return {
    machine: {
      id: 'm1', code: 'M08', line: 'PVC', family: 'PVC', logbookFormat: 'coil',
      status: 'running', statusReason: null, currentProduct: 'SPVC', currentFormula: 'RF01', currentLot: 'L1',
    },
    started: true,
    activePlan: {
      id: 'plan-99', shift: 'D', status: 'running', operatorName: 'Nandlal',
      scheduledStartDate: '2026-08-06T08:00:00',
      salesOrder: { soNumber: 'SO-1', product: 'SPVC' },
      logbook: { id: 'lb1', status: 'draft', updatedAt: '2026-08-06T09:00:00Z' },
      logbookTemplate: { id: 't1', docNo: 'QR/1', productName: 'SPVC', layout: 'coil' },
    },
    activePlans: [],
    logbooks: [],
    maintenance: [],
    ...overrides,
  };
}

function renderTasks(props: { initialMachineCode?: string | null; onMachineCodeConsumed?: () => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <MachineTasks {...props} />
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((path: string) => {
    if (path === '/logbook/tasks') return Promise.resolve([]);
    return Promise.resolve({});
  });
});

describe('MachineTasks QR → hub', () => {
  it('opens the machine hub when a QR code is provided', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/logbook/tasks') return Promise.resolve([]);
      if (path.startsWith('/logbook/machine-hub')) return Promise.resolve(hubPayload());
      return Promise.resolve({});
    });
    const onConsumed = vi.fn();
    renderTasks({ initialMachineCode: 'M08', onMachineCodeConsumed: onConsumed });
    expect(await screen.findByTestId('machine-hub')).toBeTruthy();
    expect(screen.getAllByText('M08').length).toBeGreaterThan(0);
    expect(screen.getByTestId('machine-hub-log-cta')).toBeTruthy();
    await waitFor(() => expect(onConsumed).toHaveBeenCalled());
  });

  it('opens log entry sheet from the hub CTA', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/logbook/tasks') return Promise.resolve([]);
      if (path.startsWith('/logbook/machine-hub')) return Promise.resolve(hubPayload());
      return Promise.resolve({});
    });
    renderTasks({ initialMachineCode: 'M08' });
    fireEvent.click(await screen.findByTestId('machine-hub-log-cta'));
    expect(await screen.findByTestId('logbook-module')).toBeTruthy();
    expect(screen.getByTestId('logbook-module').textContent).toContain('plan:plan-99');
  });

  it('shows not-found when hub returns 404', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/logbook/tasks') return Promise.resolve([]);
      if (path.startsWith('/logbook/machine-hub')) {
        return Promise.reject(new ApiError(404, 'not_found', 'Machine M08 was not found.'));
      }
      return Promise.resolve({});
    });
    renderTasks({ initialMachineCode: 'M08' });
    expect(await screen.findByTestId('machine-hub-error')).toBeTruthy();
    expect(screen.getByText(/Machine M08 not found/i)).toBeTruthy();
  });

  it('shows access denied when hub is forbidden', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/logbook/tasks') return Promise.resolve([]);
      if (path.startsWith('/logbook/machine-hub')) {
        return Promise.reject(new ApiError(403, 'forbidden', 'No access'));
      }
      return Promise.resolve({});
    });
    renderTasks({ initialMachineCode: 'M08' });
    expect(await screen.findByTestId('machine-hub-error')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /No access/i })).toBeTruthy();
  });
});
