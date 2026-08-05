import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

vi.mock('../../lib/apiClient', () => ({
  ApiError: class ApiError extends Error { status = 0; code = ''; },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

vi.mock('../../lib/machineQr', async () => {
  const actual = await vi.importActual<typeof import('../../lib/machineQr')>('../../lib/machineQr');
  return {
    ...actual,
    renderMachineQrPng: vi.fn(async () => 'data:image/png;base64,AAA'),
    downloadMachineQr: vi.fn(async () => undefined),
  };
});

import { api } from '../../lib/apiClient';
import { downloadMachineQr } from '../../lib/machineQr';
import { MachinesBoard } from '../maintenance/MaintenanceScreens';

const get = api.get as ReturnType<typeof vi.fn>;

function renderBoard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <MachinesBoard onOpen={() => {}} onTrace={() => {}} user="Maint" />
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((path: string) => {
    if (path === '/machines') {
      return Promise.resolve([
        { id: 'm1', code: 'M08', line: 'PVC line', family: 'PVC', logbookFormat: 'QR/MFG/013', status: 'running' },
      ]);
    }
    return Promise.resolve([]);
  });
  (downloadMachineQr as ReturnType<typeof vi.fn>).mockClear();
});

describe('MachinesBoard QR actions', () => {
  it('shows View and Download actions and opens the QR panel', async () => {
    renderBoard();
    expect(await screen.findByText('M08')).toBeTruthy();
    expect(screen.getByText('View')).toBeTruthy();
    expect(screen.getByText('Download')).toBeTruthy();

    fireEvent.click(screen.getByText('View'));
    expect(await screen.findByTestId('machine-qr-panel')).toBeTruthy();
    fireEvent.click(screen.getByText(/Download QR/i));
    await waitFor(() => expect(downloadMachineQr).toHaveBeenCalledWith('M08'));
  });
});
