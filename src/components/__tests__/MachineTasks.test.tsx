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

describe('MachineTasks QR resolve', () => {
  it('opens the logbook when resolve returns an active plan', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/logbook/tasks') return Promise.resolve([]);
      if (path.startsWith('/logbook/resolve')) {
        return Promise.resolve({
          reason: 'ok',
          machine: { id: 'm1', code: 'M08', line: 'PVC' },
          planId: 'plan-99',
          logStatus: 'draft',
        });
      }
      return Promise.resolve({});
    });
    const onConsumed = vi.fn();
    renderTasks({ initialMachineCode: 'M08', onMachineCodeConsumed: onConsumed });
    expect((await screen.findByTestId('logbook-module')).textContent).toContain('plan:plan-99');
    await waitFor(() => expect(onConsumed).toHaveBeenCalled());
  });

  it('shows no-shift empty state when resolve has no active plan', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/logbook/tasks') return Promise.resolve([]);
      if (path.startsWith('/logbook/resolve')) {
        return Promise.resolve({
          reason: 'no_active_plan',
          machine: { id: 'm1', code: 'M08', line: 'PVC line' },
          planId: null,
          logStatus: null,
        });
      }
      return Promise.resolve({});
    });
    renderTasks({ initialMachineCode: 'M08' });
    expect(await screen.findByTestId('machine-qr-no-plan')).toBeTruthy();
    expect(screen.getByText(/No shift scheduled for M08/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Back to machine tasks/i));
    expect(await screen.findByText(/Machine Tasks/i)).toBeTruthy();
  });

  it('shows access denied when resolve is forbidden', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/logbook/tasks') return Promise.resolve([]);
      if (path.startsWith('/logbook/resolve')) {
        return Promise.reject(new ApiError(403, 'forbidden', 'No access'));
      }
      return Promise.resolve({});
    });
    renderTasks({ initialMachineCode: 'M08' });
    expect(await screen.findByTestId('machine-qr-denied')).toBeTruthy();
    expect(screen.getByText(/No access to log this machine/i)).toBeTruthy();
  });
});
