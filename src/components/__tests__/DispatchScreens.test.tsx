import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/apiClient', () => ({
  ApiError: class ApiError extends Error { status = 0; code = ''; },
  api: { get: vi.fn(), post: vi.fn(), postIdempotent: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));
import { api } from '../../lib/apiClient';
import { ReadyToDispatch, DispatchHistory } from '../dispatch/DispatchScreens';
import type { DispatchData } from '../dispatch/DispatchScreens';

const get = api.get as ReturnType<typeof vi.fn>;
const postIdempotent = api.postIdempotent as ReturnType<typeof vi.fn>;
const stub = { onOpen: () => {}, onTrace: () => {} } as DispatchData;

function renderUI(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
beforeEach(() => { get.mockReset(); postIdempotent.mockReset(); });

const readyOrder = { id: 'o1', operationalOrderId: 'o1', soNumber: 'SO-2026-102', product: 'SPVC Sheathing', quantity: '12000', orderedQuantity: '12000', dispatchableQuantity: '12000', uom: 'kg', rowVersion: 2, plantCode: 'PRIMARY', deliveryDate: '2026-08-15', priority: 'medium', status: 'packed', customer: { name: 'Sterling', deliveryAddress: 'Peenya' } };

describe('Dispatch — ready board (API)', () => {
  it('lists a produced order and dispatches it via the API', async () => {
    get.mockResolvedValue([readyOrder]);
    postIdempotent.mockResolvedValue({ invoiceNumber: 'INV-2026-800' });
    renderUI(<ReadyToDispatch {...stub} />);
    fireEvent.click(await screen.findByText('Dispatch'));
    fireEvent.change(await screen.findByPlaceholderText('KA-01-AB-1234'), { target: { value: 'KA-09-XY-1111' } });
    fireEvent.click(screen.getByText(/Record gate pass & dispatch/i));
    await waitFor(() => expect(postIdempotent).toHaveBeenCalledWith('/dispatches', expect.objectContaining({ operationalOrderId: 'o1', quantity: '12000', expectedOrderVersion: 2, vehicleNumber: 'KA-09-XY-1111' }), expect.stringMatching(/^dispatch:/)));
  });
});

describe('Dispatch — history (API)', () => {
  it('lists dispatch records with their dispatch reference', async () => {
    get.mockResolvedValue([
      { id: 'd1', invoiceNumber: 'INV-2026-800', vehicleNumber: 'KA-09-XY-1111', salesOrder: { soNumber: 'SO-2026-102', product: 'x', customer: { name: 'Sterling' } } },
    ]);
    renderUI(<DispatchHistory {...stub} />);
    expect(await screen.findByText('SO-2026-102')).toBeTruthy();
    expect(screen.getByText('INV-2026-800')).toBeTruthy();
  });
});
