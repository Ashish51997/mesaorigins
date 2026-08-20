import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOrganizationId, setOrganizationId } from '../../lib/apiIdentity';
import LandingPage from '../LandingPage';

const fetchMock = vi.fn();
const onEnterService = vi.fn();

const organizationUser = {
  userId: 'user-1',
  email: 'owner@acme.test',
  name: 'Asha Rao',
  membershipId: 'membership-1',
  employeeCode: 'EMP-001',
  organizationId: 'org-acme',
  organizationName: 'Acme Plastics',
  role: 'Owner',
  isAdmin: true,
  screens: ['screen:dashboard'],
};

const mesaOps = {
  id: 'mesaops',
  name: 'MesaOps',
  description: 'Manufacturing operations workspace.',
  status: 'active',
  sortOrder: 10,
};

const mesaLeads = {
  id: 'mesaleads',
  name: 'MesaLeads',
  description: 'Lead qualification and quotation workspace.',
  status: 'active',
  sortOrder: 20,
};

const mesaErp = {
  id: 'mesaerp',
  name: 'MesaERP',
  description: 'Manufacturing business ERP and finance workspace.',
  status: 'active',
  sortOrder: 30,
};

const multiOrganizations = [
  {
    organizationId: 'org-acme',
    organizationName: 'Acme Plastics',
    organizationSlug: 'acme-plastics',
    membershipId: 'membership-1',
    employeeCode: 'EMP-001',
    role: 'Owner',
    isAdmin: true,
    screens: ['screen:dashboard'],
    services: [mesaOps],
  },
  {
    organizationId: 'org-northstar',
    organizationName: 'Northstar Manufacturing',
    organizationSlug: 'northstar-manufacturing',
    membershipId: 'membership-2',
    employeeCode: 'EMP-014',
    role: 'Sales Executive',
    isAdmin: false,
    screens: ['screen:enquiry_desk'],
    services: [mesaOps, mesaLeads],
  },
];

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 401) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function authResponse(services: typeof mesaOps[], organizations?: unknown[]) {
  return jsonResponse({
    user: {
      ...organizationUser,
      services,
      ...(organizations ? { organizations } : {}),
    },
  });
}

function mockSignedOutLanding(loginResponse?: ReturnType<typeof jsonResponse>) {
  fetchMock.mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === '/api/auth/session-context') {
      return jsonResponse({ user: null });
    }
    if (url === '/api/auth/login' && loginResponse) return loginResponse;
    throw new Error(`Unexpected fetch ${url}`);
  });
}

function openOrganizationLogin() {
  render(<LandingPage onEnterService={onEnterService} />);
  fireEvent.click(screen.getByRole('button', { name: 'Organization login' }));
}

function submitOrganizationLogin() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' owner@acme.test ' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('MesaOrigins landing page', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    onEnterService.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.clear();
    window.sessionStorage.clear();
    setOrganizationId('');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers separate entry points for administrators and organizations', () => {
    mockSignedOutLanding();
    render(<LandingPage onEnterService={onEnterService} />);

    const adminLogin = screen.getByRole('link', { name: 'Admin login' });
    expect(adminLogin.getAttribute('href')).toBe('/admin');
    expect(screen.getByRole('button', { name: 'Organization login' })).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('keeps a fresh DEV_AUTH visit on the two-login entry screen', async () => {
    mockSignedOutLanding();
    render(<LandingPage onEnterService={onEnterService} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/session-context', {
      credentials: 'include',
      headers: undefined,
    }));
    expect(screen.getByRole('link', { name: 'Admin login' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Organization login' })).toBeTruthy();
    expect(onEnterService).not.toHaveBeenCalled();
  });

  it('submits organization credentials through the existing auth endpoint', async () => {
    mockSignedOutLanding(authResponse([mesaOps]));
    openOrganizationLogin();
    submitOrganizationLogin();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: 'owner@acme.test', password: 'correct-horse' }),
    }));
  });

  it('enters the only active service immediately after sign-in', async () => {
    mockSignedOutLanding(authResponse([mesaLeads]));
    openOrganizationLogin();
    submitOrganizationLogin();

    await waitFor(() => expect(onEnterService).toHaveBeenCalledWith({
      uid: 'emp-user-1',
      email: 'owner@acme.test',
      displayName: 'Asha Rao',
      role: 'Owner',
      isFirebase: false,
    }, 'mesaleads'));
    expect(screen.queryByRole('heading', { name: 'Choose a service' })).toBeNull();
  });

  it.each([
    ['MesaOps', 'mesaops'],
    ['MesaLeads', 'mesaleads'],
    ['MesaERP', 'mesaerp'],
  ])('lets a multi-service organization enter %s', async (serviceName, serviceId) => {
    mockSignedOutLanding(authResponse([mesaOps, mesaLeads, mesaErp]));
    openOrganizationLogin();
    submitOrganizationLogin();

    expect(await screen.findByRole('heading', { name: 'Choose a service' })).toBeTruthy();
    expect(screen.getByText('Acme Plastics')).toBeTruthy();
    expect(onEnterService).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: `Open ${serviceName}` }));

    expect(onEnterService).toHaveBeenCalledWith({
      uid: 'emp-user-1',
      email: 'owner@acme.test',
      displayName: 'Asha Rao',
      role: 'Owner',
      isFirebase: false,
    }, serviceId);
  });

  it('shows a clear message when the organization has no active services', async () => {
    mockSignedOutLanding(authResponse([]));
    openOrganizationLogin();
    submitOrganizationLogin();

    const message = await screen.findByRole('alert');
    expect(message.textContent).toContain('No services are available');
    expect(onEnterService).not.toHaveBeenCalled();
  });

  it('keeps the organization on the login form when authentication fails', async () => {
    mockSignedOutLanding(jsonResponse({
      error: { code: 'invalid_credentials', message: 'Invalid email or password.' },
    }, false));
    openOrganizationLogin();
    submitOrganizationLogin();

    expect((await screen.findByRole('alert')).textContent).toContain('Invalid email or password.');
    expect(onEnterService).not.toHaveBeenCalled();
  });

  it('restores a valid cookie session and shows its service choices without another login', async () => {
    expect(window.localStorage.getItem('erp_session')).toBeNull();
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/auth/session-context') return authResponse([mesaOps, mesaLeads]);
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<LandingPage onEnterService={onEnterService} />);

    expect(await screen.findByRole('heading', { name: 'Choose a service' })).toBeTruthy();
    expect(screen.getByText('Acme Plastics')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Organization login' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session-context', {
      credentials: 'include',
      headers: undefined,
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/me')).toBe(false);
    expect(onEnterService).not.toHaveBeenCalled();
  });

  it('asks a multi-organization user to choose an organization before its services', async () => {
    mockSignedOutLanding(authResponse([mesaOps], multiOrganizations));
    openOrganizationLogin();
    submitOrganizationLogin();

    expect(await screen.findByRole('heading', { name: 'Choose an organization' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Choose a service' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open Northstar Manufacturing' }));

    expect(await screen.findByRole('heading', { name: 'Choose a service' })).toBeTruthy();
    expect(getOrganizationId()).toBe('org-northstar');
    expect(window.sessionStorage.getItem('mesaorigins_organization')).toBe('org-northstar');
    expect(onEnterService).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open MesaLeads' }));
    expect(onEnterService).toHaveBeenCalledWith({
      uid: 'emp-user-1',
      email: 'owner@acme.test',
      displayName: 'Asha Rao',
      role: 'Sales Executive',
      isFirebase: false,
    }, 'mesaleads');
  });

  it('restores a cookie session into the organization chooser before routing its single service', async () => {
    expect(window.localStorage.getItem('erp_session')).toBeNull();
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/auth/session-context') return authResponse([mesaOps], multiOrganizations);
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<LandingPage onEnterService={onEnterService} />);

    expect(await screen.findByRole('heading', { name: 'Choose an organization' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Acme Plastics' }));

    expect(getOrganizationId()).toBe('org-acme');
    expect(onEnterService).toHaveBeenCalledWith({
      uid: 'emp-user-1',
      email: 'owner@acme.test',
      displayName: 'Asha Rao',
      role: 'Owner',
      isFirebase: false,
    }, 'mesaops');
  });
});
