import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOrganizationId, setOrganizationId } from '@shared/lib/apiIdentity';
import LandingPage from './LandingPage';

const fetchMock = vi.fn();
const onEnterWorkspace = vi.fn();

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
  name: 'MesaPlant',
  description: 'Plan machines and shifts, execute, QA, move operational stock, and dispatch.',
  status: 'active',
  sortOrder: 10,
};

const mesaLeads = {
  id: 'mesaleads',
  name: 'MesaSell',
  description: 'Win the order — enquiry, technical review, quotation, and customer decision.',
  status: 'active',
  sortOrder: 20,
};

const mesaErp = {
  id: 'mesaerp',
  name: 'MesaBook',
  description: 'Run the business books — procurement, valued inventory, costing, finance, and tax.',
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
  render(<LandingPage onEnterWorkspace={onEnterWorkspace} />);
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
    onEnterWorkspace.mockReset();
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
    render(<LandingPage onEnterWorkspace={onEnterWorkspace} />);

    const adminLogin = screen.getByRole('link', { name: 'Admin login' });
    expect(adminLogin.getAttribute('href')).toBe('/admin');
    expect(screen.getByRole('button', { name: 'Organization login' })).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('keeps a fresh DEV_AUTH visit on the two-login entry screen', async () => {
    mockSignedOutLanding();
    render(<LandingPage onEnterWorkspace={onEnterWorkspace} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/session-context', {
      credentials: 'include',
      headers: undefined,
    }));
    expect(screen.getByRole('link', { name: 'Admin login' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Organization login' })).toBeTruthy();
    expect(onEnterWorkspace).not.toHaveBeenCalled();
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

  it('routes owners with MesaPlant to Command immediately after sign-in', async () => {
    mockSignedOutLanding(authResponse([mesaOps]));
    openOrganizationLogin();
    submitOrganizationLogin();

    await waitFor(() => expect(onEnterWorkspace).toHaveBeenCalledWith({
      uid: 'emp-user-1',
      email: 'owner@acme.test',
      displayName: 'Asha Rao',
      role: 'Owner',
      isFirebase: false,
    }, '/command'));
    expect(screen.queryByRole('heading', { name: 'Choose a product' })).toBeNull();
  });

  it('enters the only active commercial module immediately after sign-in', async () => {
    mockSignedOutLanding(authResponse([mesaLeads]));
    openOrganizationLogin();
    submitOrganizationLogin();

    await waitFor(() => expect(onEnterWorkspace).toHaveBeenCalledWith({
      uid: 'emp-user-1',
      email: 'owner@acme.test',
      displayName: 'Asha Rao',
      role: 'Owner',
      isFirebase: false,
    }, '/mesaleads'));
    expect(screen.queryByRole('heading', { name: 'Choose a product' })).toBeNull();
  });

  it.each([
    ['MesaSell', '/mesaleads'],
    ['MesaBook', '/mesaerp'],
  ])('lets a multi-module owner choose %s from the grouped picker', async (serviceName, destination) => {
    mockSignedOutLanding(authResponse([mesaLeads, mesaErp]));
    openOrganizationLogin();
    submitOrganizationLogin();

    expect(await screen.findByRole('heading', { name: 'Choose a product' })).toBeTruthy();
    expect(screen.getByText('Acme Plastics')).toBeTruthy();
    expect(onEnterWorkspace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: `Open ${serviceName}` }));

    expect(onEnterWorkspace).toHaveBeenCalledWith({
      uid: 'emp-user-1',
      email: 'owner@acme.test',
      displayName: 'Asha Rao',
      role: 'Owner',
      isFirebase: false,
    }, destination);
  });

  it('routes owners with every module straight to Command without a picker', async () => {
    mockSignedOutLanding(authResponse([mesaOps, mesaLeads, mesaErp]));
    openOrganizationLogin();
    submitOrganizationLogin();

    await waitFor(() => expect(onEnterWorkspace).toHaveBeenCalledWith({
      uid: 'emp-user-1',
      email: 'owner@acme.test',
      displayName: 'Asha Rao',
      role: 'Owner',
      isFirebase: false,
    }, '/command'));
    expect(screen.queryByRole('heading', { name: 'Choose a product' })).toBeNull();
  });

  it('shows a clear message when the organization has no active services', async () => {
    mockSignedOutLanding(authResponse([]));
    openOrganizationLogin();
    submitOrganizationLogin();

    const message = await screen.findByRole('alert');
    expect(message.textContent).toContain('No services are available');
    expect(onEnterWorkspace).not.toHaveBeenCalled();
  });

  it('keeps the organization on the login form when authentication fails', async () => {
    mockSignedOutLanding(jsonResponse({
      error: { code: 'invalid_credentials', message: 'Invalid email or password.' },
    }, false));
    openOrganizationLogin();
    submitOrganizationLogin();

    expect((await screen.findByRole('alert')).textContent).toContain('Invalid email or password.');
    expect(onEnterWorkspace).not.toHaveBeenCalled();
  });

  it('restores a valid cookie session into Command for an owner with MesaPlant', async () => {
    expect(window.localStorage.getItem('erp_session')).toBeNull();
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/auth/session-context') return authResponse([mesaOps, mesaLeads]);
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<LandingPage onEnterWorkspace={onEnterWorkspace} />);

    await waitFor(() => expect(onEnterWorkspace).toHaveBeenCalledWith({
      uid: 'emp-user-1',
      email: 'owner@acme.test',
      displayName: 'Asha Rao',
      role: 'Owner',
      isFirebase: false,
    }, '/command'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session-context', {
      credentials: 'include',
      headers: undefined,
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/me')).toBe(false);
  });

  it('asks a multi-organization user to choose an organization before routing by role', async () => {
    mockSignedOutLanding(authResponse([mesaOps], multiOrganizations));
    openOrganizationLogin();
    submitOrganizationLogin();

    expect(await screen.findByRole('heading', { name: 'Choose an organization' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Choose a product' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open Northstar Manufacturing' }));

    await waitFor(() => expect(onEnterWorkspace).toHaveBeenCalledWith({
      uid: 'emp-user-1',
      email: 'owner@acme.test',
      displayName: 'Asha Rao',
      role: 'Sales Executive',
      isFirebase: false,
    }, '/mesaleads'));
    expect(getOrganizationId()).toBe('org-northstar');
    expect(window.sessionStorage.getItem('mesaorigins_organization')).toBe('org-northstar');
  });

  it('restores a cookie session into the organization chooser before role-based routing', async () => {
    expect(window.localStorage.getItem('erp_session')).toBeNull();
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/auth/session-context') return authResponse([mesaOps], multiOrganizations);
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<LandingPage onEnterWorkspace={onEnterWorkspace} />);

    expect(await screen.findByRole('heading', { name: 'Choose an organization' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Acme Plastics' }));

    expect(getOrganizationId()).toBe('org-acme');
    expect(onEnterWorkspace).toHaveBeenCalledWith({
      uid: 'emp-user-1',
      email: 'owner@acme.test',
      displayName: 'Asha Rao',
      role: 'Owner',
      isFirebase: false,
    }, '/command');
  });
});
