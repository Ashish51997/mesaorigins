import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RolesAccess } from '../admin/AdminScreens';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  postIdempotent: vi.fn(),
}));

vi.mock('@shared/lib/apiClient', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    get: mocks.get,
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    postIdempotent: mocks.postIdempotent,
  },
}));

const employee = {
  id: 'membership-1', employeeCode: 'EMP-001', department: 'Production', role: 'Planner', roleId: 'role-1', shift: 'D', status: 'active',
  user: { name: 'Plant Planner', email: 'planner@example.test' },
};
const role = { id: 'role-1', name: 'Planner', screens: ['orders_to_plan', 'plan_board'], isAdmin: false, isSystem: false, _count: { memberships: 1 } };

function renderScreen(assignments: unknown[] = []) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/mesaops/v1/roles') return Promise.resolve([role]);
    if (path === '/mesaops/v1/employees') return Promise.resolve([employee]);
    if (path === '/mesaops/v1/role-assignments') return Promise.resolve(assignments);
    if (path === '/mesaops/v1/screens') return Promise.resolve({ screens: [] });
    return Promise.resolve([]);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><RolesAccess /></QueryClientProvider>);
}

describe('MesaOps plant access administration', () => {
  it('creates an explicit plant assignment through the fixed MesaOps endpoint', async () => {
    mocks.get.mockReset();
    mocks.postIdempotent.mockReset().mockResolvedValue({ id: 'assignment-1' });
    renderScreen();

    const open = await screen.findByRole('button', { name: 'Assign plant access' });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(open);
    fireEvent.change(screen.getByLabelText('Plant code'), { target: { value: 'plant-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign access' }));

    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaops/v1/role-assignments',
      expect.objectContaining({ membershipId: 'membership-1', roleId: 'role-1', plantCode: 'PLANT-A' }),
      expect.stringMatching(/^mesaops-plant-assignment:/),
    ));
  });

  it('revokes a versioned assignment with a recorded reason', async () => {
    const assignment = {
      id: 'assignment-1', organizationId: 'org-1', membershipId: 'membership-1', roleId: 'role-1', serviceId: 'mesaops', legalEntityId: null,
      plantCode: 'PLANT-A', warehouseId: null, validFrom: null, validTo: null, status: 'active', revokedAt: null, revocationReason: null,
      rowVersion: 4, membership: { user: employee.user }, role: { id: 'role-1', name: 'Planner', isSystem: false },
    };
    mocks.get.mockReset();
    mocks.postIdempotent.mockReset().mockResolvedValue({ ...assignment, status: 'revoked', rowVersion: 5 });
    renderScreen([assignment]);

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    fireEvent.change(screen.getByLabelText('Plant access revocation reason'), { target: { value: 'Transferred to another plant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));

    await waitFor(() => expect(mocks.postIdempotent).toHaveBeenCalledWith(
      '/mesaops/v1/role-assignments/assignment-1/revoke',
      { expectedVersion: 4, reason: 'Transferred to another plant' },
      expect.stringMatching(/^mesaops-plant-revoke:/),
    ));
  });
});
