import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/apiClient', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

vi.mock('@mesaops/lib/simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/simulation')>();
  return { ...actual, startSimulation: vi.fn() };
});

vi.mock('../ManagementDashboard', () => ({
  default: () => <div>Management dashboard mock</div>,
}));

vi.mock('../RoleDashboard', () => ({
  default: () => <div>Role dashboard mock</div>,
}));

vi.mock('../RoleSwitcher', () => ({
  RoleSwitcher: () => null,
}));

import { api } from '@shared/lib/apiClient';
import App from '../../App';

const get = api.get as ReturnType<typeof vi.fn>;
const post = api.post as ReturnType<typeof vi.fn>;
const fetchMock = vi.fn();
let mesaOpsAssigned = false;

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('MesaOps authenticated session boundary', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/mesaops');
    mesaOpsAssigned = false;
    get.mockReset();
    post.mockReset();
    get.mockImplementation(async (path: string) => {
      if (path === '/me') {
        return {
          user: {
            userId: 'user-1',
            email: 'owner@acme.test',
            name: 'Asha Rao',
            role: 'Managing Director',
            services: mesaOpsAssigned
              ? [{ id: 'mesaops', name: 'MesaOps', description: '', status: 'active', sortOrder: 10 }]
              : [],
          },
        };
      }
      if (path === '/mesaops/v1/me/permissions') return { isAdmin: true, screens: [] };
      throw new Error(`Unexpected GET ${path}`);
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/health') {
        const body = { status: 'ok', auth: 'dev', google: false };
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: vi.fn().mockResolvedValue(body),
          text: vi.fn().mockResolvedValue(JSON.stringify(body)),
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails closed instead of rendering mock ERP data when MesaOps is denied', async () => {
    const expectedDenialNoise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithQuery(<App />);

    const heading = await screen.findByRole('heading', { name: 'MesaPlant is not assigned' });
    expect(heading).toBeTruthy();
    expect(screen.getByText(/MesaPlant is not active for this organization/)).toBeTruthy();
    const back = screen.getByRole('link', { name: 'Return to sign in' });
    expect(back.getAttribute('href')).toBe('/login');
    expect(document.querySelector('#applet-root')).toBeNull();
    expect(screen.queryByText('Management dashboard mock')).toBeNull();
    expect(post).not.toHaveBeenCalledWith('/data', expect.anything());
    await waitFor(() => expect(get).toHaveBeenCalledWith('/me'));
    expect(get).not.toHaveBeenCalledWith('/data');
    expectedDenialNoise.mockRestore();
  });

  it('renders an entitled session without reading or writing a shared data document', async () => {
    mesaOpsAssigned = true;
    renderWithQuery(<App />);

    expect(await screen.findByText('Management dashboard mock')).toBeTruthy();
    expect(document.querySelector('#applet-root')).toBeTruthy();
    expect(get).not.toHaveBeenCalledWith('/data');
    expect(post).not.toHaveBeenCalledWith('/data', expect.anything());
  });
});
