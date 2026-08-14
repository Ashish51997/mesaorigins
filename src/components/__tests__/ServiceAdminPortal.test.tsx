import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../lib/apiClient', () => ({
  ApiError: class ApiError extends Error { status = 0; code = ''; },
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

import { api } from '../../lib/apiClient';
import ServiceAdminPortal from '../admin/ServiceAdminPortal';

const get = api.get as ReturnType<typeof vi.fn>;
const post = api.post as ReturnType<typeof vi.fn>;
const put = api.put as ReturnType<typeof vi.fn>;
const serviceCatalog = [
  {
    id: 'mesaops',
    name: 'MesaOps',
    description: 'Manufacturing operations workspace.',
    status: 'active',
    sortOrder: 10,
  },
  {
    id: 'mesaleads',
    name: 'MesaLeads',
    description: 'Lead management service placeholder.',
    status: 'preview',
    sortOrder: 20,
  },
  {
    id: 'mesaerp',
    name: 'MesaERP',
    description: 'Manufacturing business ERP, accounting and procurement.',
    status: 'active',
    sortOrder: 30,
  },
];
const createdOrganization = {
  organization: {
    id: 'org-acme',
    name: 'Acme Plastics',
    slug: 'acme-plastics',
    services: serviceCatalog,
  },
  owner: { name: 'Priya Sharma', email: 'priya@acme.test', employeeCode: 'EMP-001', role: 'Owner' },
};
const onboardedOrganizations = [{
  id: 'org-northstar',
  name: 'Northstar Manufacturing',
  slug: 'northstar-manufacturing',
  status: 'active',
  plan: 'starter',
  subscriptionStatus: 'trialing',
  createdAt: '2026-08-12T00:00:00.000Z',
  mesaLeadsProfile: {
    legalName: 'Northstar Manufacturing Private Limited',
    brandName: 'Northstar Manufacturing',
    summary: 'Turnkey plastics machinery and customer project delivery.',
    website: '',
    emails: ['sales@northstar.test'],
    phones: ['+91 90000 00000'],
    contact: { name: 'Nina Shah', title: 'Technical Director' },
    address: { line1: '1 Industrial Estate', line2: '', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001', country: 'India' },
    capabilities: ['Injection moulding', 'Mould sourcing'],
    branding: { logoUrl: '', primaryColor: '#12385B' },
  },
  services: [{ ...serviceCatalog[0], assignmentStatus: 'active' }],
  contacts: [{
    membershipId: 'mem-owner',
    name: 'Nina Shah',
    email: 'nina@northstar.test',
    role: 'Owner',
    employeeCode: 'EMP-001',
    status: 'active',
  }],
}];

describe('MesaDesk service admin portal', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    get.mockReset();
    post.mockReset();
    put.mockReset();
    get.mockImplementation(async (path: string) => {
      if (path === '/onboarding/access') return { allowed: true };
      if (path === '/onboarding/organizations') return { organizations: onboardedOrganizations };
      if (path === '/onboarding/services') return { services: serviceCatalog };
      throw new Error(`Unexpected GET ${path}`);
    });
    post.mockResolvedValue(createdOrganization);
    put.mockImplementation(async (path: string, body: { status?: string }) => {
      if (path.startsWith('/onboarding/services/')) {
        const id = path.split('/')[3];
        return { ...serviceCatalog.find((service) => service.id === id), status: body.status };
      }
      return {
        organizationId: 'org-northstar',
        services: serviceCatalog.map((service) => ({ ...service, assignmentStatus: 'active' })),
      };
    });
  });

  it('guards the service console with the temporary admin credentials', () => {
    render(<ServiceAdminPortal />);

    fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open control center' }));

    expect(screen.getByRole('alert').textContent).toContain('incorrect');
    expect(screen.queryByText('Good to see you, Admin')).toBeNull();
  });

  it('shows MesaOps, MesaLeads and MesaERP after a successful sign in', () => {
    render(<ServiceAdminPortal />);

    fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open control center' }));

    expect(screen.getByText('Good to see you, Admin')).toBeTruthy();
    const mesaOpsCard = screen.getByRole('heading', { name: 'MesaOps' }).closest('article');
    const mesaLeadsCard = screen.getByRole('heading', { name: 'MesaLeads' }).closest('article');
    const mesaErpCard = screen.getByRole('heading', { name: 'MesaERP' }).closest('article');
    expect(mesaOpsCard).toBeTruthy();
    expect(mesaLeadsCard).toBeTruthy();
    expect(mesaErpCard).toBeTruthy();
    expect(within(mesaOpsCard!).getByRole('link', { name: 'Open service' }).getAttribute('href')).toBe('/mesaops');
    expect(within(mesaLeadsCard!).getByRole('link', { name: 'Open service' }).getAttribute('href')).toBe('/mesaleads');
    expect(within(mesaErpCard!).getByRole('link', { name: 'Open service' }).getAttribute('href')).toBe('/mesaerp');
  });

  it('updates the live backend and persists a successful service control action', async () => {
    window.sessionStorage.setItem('mesadesk_admin_session', 'active');
    render(<ServiceAdminPortal />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop MesaOps' }));

    await waitFor(() => expect(put).toHaveBeenCalledWith(
      '/onboarding/services/mesaops/status',
      { status: 'stopped' },
    ));
    expect(await screen.findByText('MesaOps stopped')).toBeTruthy();
    await waitFor(() => expect(window.localStorage.getItem('mesadesk_service_states')).toContain('"mesaops":"stopped"'));
  });

  it('keeps the previous service status when the control plane rejects the change', async () => {
    window.sessionStorage.setItem('mesadesk_admin_session', 'active');
    put.mockRejectedValueOnce(new Error('Control plane unavailable'));
    render(<ServiceAdminPortal />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop MesaOps' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Its previous status was kept');
    expect((screen.getByRole('button', { name: 'Stop MesaOps' }) as HTMLButtonElement).disabled).toBe(false);
    expect(window.localStorage.getItem('mesadesk_service_states')).toContain('"mesaops":"running"');
  });

  it('keeps organization onboarding inside the admin console', async () => {
    window.sessionStorage.setItem('mesadesk_admin_session', 'active');
    render(<ServiceAdminPortal />);

    expect(screen.getByRole('heading', { name: 'Organization onboarding' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Acme Plastics' } });
    expect((screen.getByLabelText('Organization slug') as HTMLInputElement).value).toBe('acme-plastics');
    fireEvent.change(screen.getByLabelText('First owner name'), { target: { value: 'Priya Sharma' } });
    fireEvent.change(screen.getByLabelText('Owner email'), { target: { value: 'priya@acme.test' } });
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'temporary-123' } });
    const mesaLeads = await screen.findByRole('checkbox', { name: /MesaLeads/ });
    fireEvent.click(mesaLeads);
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/onboarding/bootstrap', {
      organizationName: 'Acme Plastics',
      organizationSlug: 'acme-plastics',
      adminName: 'Priya Sharma',
      adminEmail: 'priya@acme.test',
      password: 'temporary-123',
      serviceIds: ['mesaops', 'mesaleads'],
    }));
    expect(await screen.findByText('Acme Plastics onboarded')).toBeTruthy();
  });

  it('keeps all onboarded organizations in a dedicated searchable section', async () => {
    window.sessionStorage.setItem('mesadesk_admin_session', 'active');
    render(<ServiceAdminPortal />);

    expect(screen.getByRole('link', { name: 'Organizations' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Northstar Manufacturing' })).toBeTruthy();
    expect(screen.getByText('nina@northstar.test')).toBeTruthy();
    expect(screen.getByText('Customer-facing')).toBeTruthy();
    expect(screen.getByText('Injection moulding')).toBeTruthy();
    expect(screen.getByText('sales@northstar.test')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search organizations'), { target: { value: 'no match' } });
    expect(screen.getByText('No organizations match your search.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Northstar Manufacturing' })).toBeNull();
  });

  it('assigns multiple services to an organization as one replacement set', async () => {
    window.sessionStorage.setItem('mesadesk_admin_session', 'active');
    render(<ServiceAdminPortal />);

    const organization = await screen.findByRole('article', { name: 'Northstar Manufacturing' });
    fireEvent.click(within(organization).getByRole('button', { name: 'Add MesaLeads to Northstar Manufacturing' }));

    await waitFor(() => expect(put).toHaveBeenCalledWith(
      '/onboarding/organizations/org-northstar/services',
      { serviceIds: ['mesaops', 'mesaleads'] },
    ));
    const assigned = within(organization).getByRole('button', { name: 'Remove MesaLeads from Northstar Manufacturing' });
    expect(assigned.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps at least one service assigned to every organization', async () => {
    window.sessionStorage.setItem('mesadesk_admin_session', 'active');
    render(<ServiceAdminPortal />);

    const organization = await screen.findByRole('article', { name: 'Northstar Manufacturing' });
    const onlyService = within(organization).getByRole('button', { name: 'Remove MesaOps from Northstar Manufacturing' });
    expect((onlyService as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(onlyService);
    expect(put).not.toHaveBeenCalled();
  });
});
