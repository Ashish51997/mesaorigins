import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/apiClient', () => ({
  ApiError: class ApiError extends Error { status = 0; code = ''; },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));
import { api } from '../../lib/apiClient';
import { RMStockBoard, ReceiveMaterial, IssueLot } from '../store/StoreScreens';
import type { StoreData } from '../store/StoreScreens';

const get = api.get as ReturnType<typeof vi.fn>;
const post = api.post as ReturnType<typeof vi.fn>;
const stub = { onOpen: () => {}, onTrace: () => {} } as StoreData;

function renderUI(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
beforeEach(() => { get.mockReset(); post.mockReset(); });

const stock = { rawMaterials: [{ itemName: 'RPVC resin', unit: 'kg', onHand: 1000 }], finishedGoods: [{ itemName: 'RPVC roll', unit: 'kg', onHand: 44 }] };
const machine = { id: 'm1', code: 'M07', line: 'PVC', family: 'PVC', status: 'running' };

describe('Store — RM stock board (API)', () => {
  it('shows ledger-derived on-hand for RM and FG', async () => {
    get.mockResolvedValue(stock);
    renderUI(<RMStockBoard {...stub} />);
    expect(await screen.findByText('RPVC resin')).toBeTruthy();
    expect(screen.getByText(/1000 kg/)).toBeTruthy();
    expect(screen.getByText('RPVC roll')).toBeTruthy();
  });
});

describe('Store — receive (API)', () => {
  it('receives raw material via the API', async () => {
    get.mockResolvedValue(stock);
    post.mockResolvedValue({});
    renderUI(<ReceiveMaterial {...stub} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. RPVC resin'), { target: { value: 'CaCO3 filler' } });
    fireEvent.change(screen.getByPlaceholderText('1000'), { target: { value: '500' } });
    fireEvent.click(screen.getByText(/Receive into store/i));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/inventory/receive', expect.objectContaining({ itemName: 'CaCO3 filler', quantity: 500 })));
  });
});

describe('Store — issue (API)', () => {
  it('issues RM to a machine via the API', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/inventory/stock') return Promise.resolve(stock);
      if (path === '/machines') return Promise.resolve([machine]);
      return Promise.resolve([]);
    });
    post.mockResolvedValue({});
    renderUI(<IssueLot {...stub} />);
    fireEvent.change(await screen.findByPlaceholderText('Max 1000'), { target: { value: '200' } });
    fireEvent.click(screen.getByText(/Issue to machine/i));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/inventory/issue', expect.objectContaining({ itemName: 'RPVC resin', quantity: 200, machineId: 'm1' })));
  });
});
