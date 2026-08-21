import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiveHandoffInbox } from './LiveHandoffInbox';

vi.mock('@mesaerp/lib/queries/mesaerpHandoffs', () => ({
  useErpHandoffInbox: () => ({
    data: undefined,
    isLoading: false,
    isError: true,
    error: new Error('403 · MesaOps service is not entitled.'),
    refetch: vi.fn(),
  }),
  useAcceptErpHandoff: () => ({ mutateAsync: vi.fn() }),
  useErpOpsReturnInbox: () => ({
    data: { inbox: [], available: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useReceiveErpOpsReturn: () => ({ mutateAsync: vi.fn() }),
  useAcceptErpOpsReturn: () => ({ mutateAsync: vi.fn() }),
  useRejectErpOpsReturn: () => ({ mutateAsync: vi.fn() }),
  useRetryErpOpsReturn: () => ({ mutateAsync: vi.fn() }),
}));

describe('LiveHandoffInbox independence', () => {
  it('keeps the ERP-owned return queue visible when the MesaOps destination endpoint is denied', () => {
    render(<LiveHandoffInbox entityId="company-1" />);

    expect(screen.getByRole('heading', { name: 'MesaOps handoff inbox unavailable' })).toBeTruthy();
    expect(screen.getByText('403 · MesaOps service is not entitled.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'MesaOps → MesaERP execution / QA / dispatch inbox' })).toBeTruthy();
    expect(screen.getByText(/No MesaOps return evidence has been received/i)).toBeTruthy();
    expect(screen.getByText(/Each direction loads and fails independently/i)).toBeTruthy();
  });
});
