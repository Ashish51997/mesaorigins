import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@shared/lib/apiClient', () => ({
  ApiError: class ApiError extends Error { status = 0; code = ''; },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));
import { api } from '@shared/lib/apiClient';
import { RollInspectionQueue, Holds } from '../quality/QualityScreens';
import type { QualityData } from '../quality/QualityScreens';

const get = api.get as ReturnType<typeof vi.fn>;
const post = api.post as ReturnType<typeof vi.fn>;
const stub = { onOpen: () => {}, onTrace: () => {} } as QualityData;

function renderUI(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
beforeEach(() => { get.mockReset(); post.mockReset(); });

const queueItem = { lotNumber: 'LOT-190726-D-M08-B01', colour: 'Black', code: 'C1', machineId: 'M08', date: '2026-07-26', product: 'RPVC roll' };

describe('Quality — roll inspection queue (API)', () => {
  it('lists packed rolls and passes one via the API', async () => {
    get.mockResolvedValue([queueItem]);
    post.mockResolvedValue({ id: 'qi1', decision: 'pass' });
    renderUI(<RollInspectionQueue {...stub} />);
    fireEvent.click(await screen.findByText('Inspect'));
    fireEvent.click(await screen.findByText('PASS'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/mesaops/v1/quality/inspections', expect.objectContaining({ lotNumber: queueItem.lotNumber, decision: 'pass' })));
  });
});

describe('Quality — holds (API)', () => {
  it('shows only held inspections', async () => {
    get.mockResolvedValue([
      { id: 'a', lotNumber: 'LOT-1', decision: 'hold', remarks: 'dim drift', inspectedBy: 'nitesh@x', weight: 8 },
      { id: 'b', lotNumber: 'LOT-2', decision: 'pass', remarks: '', inspectedBy: 'nitesh@x', weight: 8 },
    ]);
    renderUI(<Holds {...stub} />);
    expect(await screen.findByText('LOT-1')).toBeTruthy();
    expect(screen.queryByText('LOT-2')).toBeNull();
  });
});
