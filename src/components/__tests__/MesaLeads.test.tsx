import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/apiClient', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status = 0, code = '', message = '') {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  },
}));

import { api } from '../../lib/apiClient';
import { ApiError } from '../../lib/apiClient';
import CustomerQuestionnaire from '../mesaleads/CustomerQuestionnaire';
import CustomerRequestPortal from '../mesaleads/CustomerRequestPortal';
import FormBuilder from '../mesaleads/FormBuilder';
import MesaLeadsApp from '../mesaleads/MesaLeadsApp';
import QuoteAndFulfillment from '../mesaleads/QuoteAndFulfillment';
import type { CustomerRequestPortal as CustomerRequestPortalData, LeadForm, LeadQuestion, LeadQuote, MesaLead, PublicLeadForm } from '../mesaleads/types';

const get = api.get as ReturnType<typeof vi.fn>;
const post = api.post as ReturnType<typeof vi.fn>;
const patchApi = api.patch as ReturnType<typeof vi.fn>;
const put = api.put as ReturnType<typeof vi.fn>;
const fetchMock = vi.fn();

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}

function question(input: Partial<LeadQuestion> & Pick<LeadQuestion, 'key' | 'type' | 'label' | 'sortOrder'>): LeadQuestion {
  return {
    helpText: '',
    placeholder: '',
    required: false,
    options: [],
    visibilityRule: null,
    ...input,
  };
}

const dashboardLead: MesaLead = {
  id: 'lead-1',
  reference: 'ML-2026-001',
  leadNumber: 'ML-2026-001',
  source: 'indiamart',
  stage: 'questionnaire_sent',
  priority: 'high',
  contactName: 'Anita Rao',
  phone: '+91 90000 00000',
  email: 'anita@acme.test',
  companyName: 'Acme Plastics',
  product: 'Food container lid',
  requirement: 'New molding line',
  scope: 'machine_mold',
  quotationAmount: 1_250_000,
  nextFollowUpAt: '2026-08-01T09:00:00.000Z',
  version: 0,
  createdAt: '2026-08-10T09:00:00.000Z',
  updatedAt: '2026-08-11T09:00:00.000Z',
};

const cachedPrivateForm: LeadForm = {
  id: 'form-private',
  name: 'Confidential Acquisition Questionnaire',
  description: 'Private customer acquisition details.',
  status: 'draft',
  revision: 1,
  questions: [question({
    key: 'private_requirement',
    type: 'long_text',
    label: 'Private requirement',
    sortOrder: 10,
  })],
};

const publicQuestions: LeadQuestion[] = [
  question({
    key: 'requirement_section',
    type: 'section',
    label: 'Machine and mold requirement',
    helpText: 'Tell us what should be included in the solution.',
    sortOrder: 10,
  }),
  question({
    key: 'scope',
    type: 'single_select',
    label: 'What do you need?',
    required: true,
    options: ['machine_only', 'machine_mold'],
    sortOrder: 20,
  }),
  question({
    key: 'mold_details',
    type: 'long_text',
    label: 'Mold details',
    required: true,
    visibilityRule: { questionKey: 'scope', operator: 'equals', value: 'machine_mold' },
    sortOrder: 30,
  }),
];

const publicForm: PublicLeadForm = {
  mode: 'form',
  organization: { id: 'org-1', name: 'Mesa Industries' },
  form: {
    id: 'form-public',
    name: 'IMM Requirement Questionnaire',
    description: 'Help our engineering team qualify your requirement.',
    status: 'published',
    revision: 3,
    questions: publicQuestions,
  },
  link: { kind: 'generic' },
};

const publicQuote = {
  quoteActionId: 'quote-action-v1',
  versionNumber: 1,
  status: 'sent' as const,
  title: 'IMM turnkey solution',
  currency: 'INR',
  validUntil: '2099-09-30',
  summary: 'Machine, mold interface review and commissioning support.',
  customerMessage: 'Please review the commercial scope and delivery terms.',
  subtotal: '1250000.00',
  discountTotal: '0.00',
  taxTotal: '225000.00',
  grandTotal: '1475000.00',
  quoteRowVersion: 3,
  sentAt: '2026-08-12T10:00:00.000Z',
  decidedAt: null,
  customerRemark: '',
  terms: [
    { label: 'Payment', value: '50% with PO and 50% before dispatch.' },
    { label: 'Warranty', value: '12 months from commissioning.' },
  ],
  lineItems: [{
    description: 'Injection molding machine',
    specification: 'Servo hydraulic, 250 tonne clamp force',
    hsnSacCode: '84771000',
    quantity: '1.00',
    unit: 'unit',
    unitPrice: '1250000.00',
    discountAmount: '0.00',
    taxRate: '18.00',
    taxableAmount: '1250000.00',
    taxAmount: '225000.00',
    total: '1475000.00',
  }],
};

function portalData(input: Partial<CustomerRequestPortalData> = {}): CustomerRequestPortalData {
  return {
    organization: {
      name: 'Mesa Industries',
      profile: {
        legalName: 'Mesa Industries Private Limited',
        brandName: 'Mesa Industries',
        summary: 'Turnkey manufacturing systems and commissioning support.',
        website: 'https://mesa.example',
        emails: ['sales@mesa.example'],
        phones: ['+91 90000 00000'],
        contact: { name: 'Technical Sales', title: 'Solutions team' },
        address: { line1: '', line2: '', city: 'Chennai', state: 'Tamil Nadu', postalCode: '', country: 'India' },
        capabilities: ['Machinery', 'Molds', 'Commissioning'],
        branding: { logoUrl: '', primaryColor: '#102A65' },
      },
    },
    lead: { reference: 'ML-2026-002', product: 'Food container lid', status: 'quotation' },
    review: { status: 'quoted', message: 'Your quotation is ready for review.', updatedAt: '2026-08-12T10:00:00.000Z' },
    decision: { decisionAllowed: true, verificationRequired: true, challengePath: '/decision-challenges', unavailableMessage: '' },
    quotes: [publicQuote],
    fulfillment: null,
    timeline: [{ type: 'quotation_sent', title: 'Quotation sent', message: 'Version 1 is ready.', occurredAt: '2026-08-12T10:00:00.000Z' }],
    ...input,
  };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patchApi.mockReset();
  put.mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/mesaleads');
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ ok: true }),
    text: vi.fn().mockResolvedValue('{"ok":true}'),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MesaLeads organization dashboard', () => {
  it('renders source-backed lead KPIs and pipeline data', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/mesaleads/summary') {
        return {
          kpis: {
            total: 12,
            open: 7,
            awaitingResponse: 2,
            overdueFollowUps: 1,
            pipelineValue: 1_250_000,
            winRate: 33,
          },
        };
      }
      if (path === '/mesaleads/leads') return { leads: [dashboardLead] };
      if (path === '/mesaleads/forms') return { forms: [] };
      throw new Error(`Unexpected GET ${path}`);
    });

    renderWithQuery(<MesaLeadsApp />);

    expect(await screen.findByRole('heading', { name: 'Turn requirements into qualified RFQs' })).toBeTruthy();
    expect(await screen.findByText('12 total captured')).toBeTruthy();
    const summary = screen.getByLabelText('Lead summary');
    const openLeads = within(summary).getByText('Open leads').closest('article');
    const quoteValue = within(summary).getByText('Open quote value').closest('article');
    expect(openLeads).not.toBeNull();
    expect(quoteValue).not.toBeNull();
    expect(within(openLeads as HTMLElement).getByText('7')).toBeTruthy();
    expect(within(openLeads as HTMLElement).getByText('12 total captured')).toBeTruthy();
    expect(within(quoteValue as HTMLElement).getByText('₹12,50,000')).toBeTruthy();
    expect(within(quoteValue as HTMLElement).getByText('33% win rate')).toBeTruthy();
    expect(screen.getAllByText('Acme Plastics').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Food container lid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Questionnaire sent').length).toBeGreaterThan(0);
  });

  it('requires a published questionnaire and atomically creates a lead-specific journey URL', async () => {
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    const publishedTemplate: LeadForm = {
      id: 'form-crate-rfq',
      name: 'Crate project requirements',
      description: 'Technical discovery for a crate manufacturing project.',
      status: 'published',
      revision: 4,
      questions: publicQuestions,
    };
    get.mockImplementation(async (path: string) => {
      if (path === '/mesaleads/summary') return { kpis: { total: 0, open: 0 } };
      if (path === '/mesaleads/leads') return { leads: [] };
      if (path === '/mesaleads/forms') return { forms: [publishedTemplate] };
      throw new Error(`Unexpected GET ${path}`);
    });
    post.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      if (path !== '/mesaleads/leads') throw new Error(`Unexpected POST ${path}`);
      expect(body).toEqual(expect.objectContaining({
        contactName: 'Anita Rao',
        companyName: 'Acme Plastics',
        product: 'Industrial crate line',
        formId: 'form-crate-rfq',
      }));
      return {
        lead: { ...dashboardLead, id: 'lead-new', contactName: 'Anita Rao', companyName: 'Acme Plastics', product: 'Industrial crate line', formId: 'form-crate-rfq' },
        link: {
          id: 'link-new',
          token: 'lead-specific-token',
          publicPath: '/mesaleads/q/lead-specific-token',
          kind: 'invitation',
          status: 'active',
          leadId: 'lead-new',
          expiresAt: '2026-09-12T12:00:00.000Z',
          createdAt: '2026-08-12T12:00:00.000Z',
        },
      };
    });

    renderWithQuery(<MesaLeadsApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'New lead' }));

    const createButton = screen.getByRole('button', { name: 'Create lead & journey link' });
    expect((createButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/one private URL for this lead/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Contact name *'), { target: { value: 'Anita Rao' } });
    fireEvent.change(screen.getByLabelText('Company *'), { target: { value: 'Acme Plastics' } });
    fireEvent.change(screen.getByLabelText('Product / broad requirement *'), { target: { value: 'Industrial crate line' } });
    fireEvent.change(screen.getByLabelText(/Questionnaire template/), { target: { value: 'form-crate-rfq' } });
    expect(screen.getByText('Crate project requirements · Revision 4')).toBeTruthy();
    expect(screen.getByText('2 customer questions. Only this published revision will be attached to the lead.')).toBeTruthy();

    fireEvent.click(createButton);

    expect(await screen.findByRole('heading', { name: 'Customer journey link ready' })).toBeTruthy();
    expect(screen.getByText('http://localhost:3000/mesaleads/q/lead-specific-token')).toBeTruthy();
    expect(screen.getByText(/return to this exact same URL for review status, quotations, follow-ups and delivery progress/i)).toBeTruthy();
    expect(screen.getByText(/shown only now/i)).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith('http://localhost:3000/mesaleads/q/lead-specific-token'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('signs out from MesaLeads and clears the locally remembered session', async () => {
    window.localStorage.setItem('erp_session', JSON.stringify({ uid: 'emp-user-1' }));
    window.sessionStorage.setItem('mesadesk_dev_identity', 'owner@acme.test');
    window.sessionStorage.setItem('mesadesk_organization', 'org-acme');
    get.mockImplementation(async (path: string) => {
      if (path === '/mesaleads/summary') {
        return {
          kpis: {
            total: 1,
            open: 1,
            awaitingResponse: 0,
            overdueFollowUps: 0,
            pipelineValue: 0,
            winRate: 0,
          },
        };
      }
      if (path === '/mesaleads/leads') return { leads: [dashboardLead] };
      if (path === '/mesaleads/forms') return { forms: [] };
      throw new Error(`Unexpected GET ${path}`);
    });

    renderWithQuery(<MesaLeadsApp />);
    const navigationNoise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }));
    expect(window.localStorage.getItem('erp_session')).toBeNull();
    expect(window.sessionStorage.getItem('mesadesk_dev_identity')).toBeNull();
    expect(window.sessionStorage.getItem('mesadesk_organization')).toBeNull();
    navigationNoise.mockRestore();
  });

  it('publishes an explicitly customer-visible follow-up without reusing internal notes', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/mesaleads/summary') return { kpis: { total: 1, open: 1 } };
      if (path === '/mesaleads/leads') return { leads: [dashboardLead] };
      if (path === '/mesaleads/forms') return { forms: [] };
      if (path === '/mesaleads/leads/lead-1') return { lead: { ...dashboardLead, activities: [], submissions: [], quotes: [], fulfillment: null } };
      throw new Error(`Unexpected GET ${path}`);
    });
    post.mockResolvedValue({ id: 'activity-customer-1' });

    renderWithQuery(<MesaLeadsApp />);
    const openButtons = await screen.findAllByRole('button', { name: 'Open' });
    fireEvent.click(openButtons[0]);
    expect(await screen.findByText('Customer portal update')).toBeTruthy();
    expect(screen.getByText(/appear immediately on the customer’s shared journey URL/i)).toBeTruthy();
    expect(screen.getByText(/Internal scheduling only/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Update title *'), { target: { value: 'Technical review completed' } });
    fireEvent.change(screen.getByLabelText('Customer-visible details'), { target: { value: 'The machine specification is now confirmed.' } });
    fireEvent.change(screen.getByLabelText('Promise next update by'), { target: { value: '2026-08-20T15:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish to customer' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/mesaleads/leads/lead-1/activities', {
      type: 'customer_update',
      title: 'Technical review completed',
      note: 'The machine specification is now confirmed.',
      nextUpdateAt: new Date('2026-08-20T15:30').toISOString(),
    }));
    expect(await screen.findByText('Customer portal update published.')).toBeTruthy();
  });

  it('clears stale identity and shows a sign-in path when a direct visit has an expired session', async () => {
    window.localStorage.setItem('erp_session', JSON.stringify({ uid: 'emp-user-1' }));
    window.sessionStorage.setItem('mesadesk_dev_identity', 'owner@acme.test');
    window.sessionStorage.setItem('mesadesk_organization', 'org-acme');
    get.mockRejectedValue(new ApiError(401, 'invalid_token', 'Session is invalid or expired.'));

    renderWithQuery(<MesaLeadsApp />);

    expect(await screen.findByRole('heading', { name: 'Session expired' })).toBeTruthy();
    const signIn = screen.getByRole('link', { name: 'Back to sign in' });
    expect(signIn.getAttribute('href')).toBe('/');
    expect(window.localStorage.getItem('erp_session')).toBeNull();
    expect(window.sessionStorage.getItem('mesadesk_dev_identity')).toBeNull();
    expect(window.sessionStorage.getItem('mesadesk_organization')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Turn requirements into qualified RFQs' })).toBeNull();
  });

  it.each([
    {
      label: 'an expired session',
      error: new ApiError(401, 'invalid_token', 'Session is invalid or expired.'),
      heading: 'Session expired',
    },
    {
      label: 'a revoked MesaLeads assignment',
      error: new ApiError(403, 'service_required', 'MesaLeads is not assigned.'),
      heading: 'MesaLeads is not assigned',
    },
  ])('purges cached lead, form and editor PII after $label', async ({ error, heading }) => {
    get.mockImplementation(async (path: string) => {
      if (path === '/mesaleads/summary') return { kpis: { total: 1, open: 1 } };
      if (path === '/mesaleads/leads') return { leads: [dashboardLead] };
      if (path === '/mesaleads/forms') return { forms: [cachedPrivateForm] };
      throw new Error(`Unexpected GET ${path}`);
    });

    const { queryClient } = renderWithQuery(<MesaLeadsApp />);
    expect((await screen.findAllByText('Acme Plastics')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Questionnaires' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit draft' }));
    expect(screen.getByDisplayValue('Confidential Acquisition Questionnaire')).toBeTruthy();

    get.mockRejectedValue(error);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['mesaleads'] });
    });

    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.queryByText('Acme Plastics')).toBeNull();
    expect(screen.queryByText('anita@acme.test')).toBeNull();
    expect(screen.queryByText('Confidential Acquisition Questionnaire')).toBeNull();
    expect(screen.queryByDisplayValue('Confidential Acquisition Questionnaire')).toBeNull();
    await waitFor(() => {
      expect(queryClient.getQueryData(['mesaleads', 'summary'])).toBeUndefined();
      expect(queryClient.getQueryData(['mesaleads', 'leads'])).toBeUndefined();
      expect(queryClient.getQueryData(['mesaleads', 'forms'])).toBeUndefined();
    });
  });
});

describe('MesaLeads customer questionnaire', () => {
  it('enforces required conditional answers and consent before submitting', async () => {
    get.mockResolvedValue(publicForm);
    post.mockResolvedValue({
      reference: 'ML-2026-002',
      leadId: 'lead-2',
      submissionId: 'submission-1',
      status: 'submitted',
      portalToken: 'portal-token-2',
      portalPath: '/mesaleads/q/portal-token-2',
      journeyPath: '/mesaleads/q/portal-token-2',
      portal: portalData({
        review: { status: 'pending', message: 'Pending technical review.', updatedAt: '2026-08-12T10:00:00.000Z' },
        quotes: [],
        timeline: [],
      }),
    });

    renderWithQuery(<CustomerQuestionnaire token="customer-token" />);

    expect(await screen.findByRole('heading', { name: 'IMM Requirement Questionnaire' })).toBeTruthy();
    expect(screen.queryByLabelText('Mold details')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert').textContent).toContain('highlighted questions');
    expect(screen.getByText('This question is required.')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Machine Mold'));
    const moldDetails = screen.getByLabelText(/Mold details/);
    expect(moldDetails).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('This question is required.')).toBeTruthy();

    fireEvent.change(moldDetails, { target: { value: 'Two-cavity hot-runner mold with DFM review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Review and submit' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Submit requirement' }));
    expect(screen.getByRole('alert').textContent).toContain('privacy notice');
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit requirement' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/public/mesaleads/forms/customer-token', {
      submissionKey: expect.any(String),
      respondent: { name: '', email: '', phone: '' },
      answers: {
        scope: 'machine_mold',
        mold_details: 'Two-cavity hot-runner mold with DFM review',
      },
      attachments: [],
      consent: true,
    }));
    expect(await screen.findByRole('heading', { name: 'Requirement submitted' })).toBeTruthy();
    expect(screen.getByText('ML-2026-002')).toBeTruthy();
    expect(screen.getByText('Pending review by Mesa Industries')).toBeTruthy();
    expect(window.location.pathname).toBe('/mesaleads/q/portal-token-2');
  });

  it('uses question-scoped invitation prefill without persisting it in browser storage', async () => {
    get.mockResolvedValue({
      ...publicForm,
      prefill: { scope: 'machine_mold' },
      link: { kind: 'invitation' },
    });

    renderWithQuery(<CustomerQuestionnaire token="invitation-token" />);

    const selectedScope = await screen.findByLabelText('Machine Mold');
    await waitFor(() => expect((selectedScope as HTMLInputElement).checked).toBe(true));
    expect(screen.getByLabelText(/Mold details/)).toBeTruthy();
    expect(window.sessionStorage.getItem('mesaleads-form-draft:invitation-token')).toBeNull();

    fireEvent.change(screen.getByLabelText(/Mold details/), { target: { value: 'Private customer detail' } });
    expect(window.sessionStorage.getItem('mesaleads-form-draft:invitation-token')).toBeNull();
  });

  it('preserves an expired invitation error without falling through to the portal endpoint', async () => {
    get.mockRejectedValueOnce(new ApiError(410, 'link_expired', 'This customer journey link has expired.'));

    renderWithQuery(<CustomerQuestionnaire token="expired-invitation-token" />);

    expect(await screen.findByRole('heading', { name: 'This questionnaire is not available' })).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/public/mesaleads/forms/expired-invitation-token');
    expect(get).not.toHaveBeenCalledWith('/public/mesaleads/portal/expired-invitation-token');
  });
});

describe('MesaLeads customer request portal', () => {
  it('restores a generated portal URL without reopening the questionnaire', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/public/mesaleads/forms/generated-portal-token') {
        throw new ApiError(404, 'not_found', 'Questionnaire link not found.');
      }
      if (path === '/public/mesaleads/portal/generated-portal-token') {
        return { mode: 'portal', portal: portalData() };
      }
      throw new Error(`Unexpected GET ${path}`);
    });

    renderWithQuery(<CustomerQuestionnaire token="generated-portal-token" />);

    expect(await screen.findByRole('heading', { name: 'ML-2026-002' })).toBeTruthy();
    expect(screen.getByText('Your quotation is ready for review.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'IMM Requirement Questionnaire' })).toBeNull();
    expect(get).toHaveBeenCalledWith('/public/mesaleads/portal/generated-portal-token');
  });

  it('shows promised customer follow-up dates on the shared portal timeline', () => {
    render(<CustomerRequestPortal token="customer-portal" initialPortal={portalData({
      timeline: [{
        type: 'customer_update',
        title: 'Technical review completed',
        message: 'The engineering team is preparing the commercial proposal.',
        occurredAt: '2026-08-12T10:00:00.000Z',
        nextUpdateAt: '2026-08-20T10:00:00.000Z',
      }],
    })} />);

    expect(screen.getByText('Technical review completed')).toBeTruthy();
    expect(screen.getByText('Next update by 20 Aug 2026')).toBeTruthy();
  });

  it('shows a customer-safe closed state without presenting an active progress step', () => {
    render(<CustomerRequestPortal token="customer-portal" initialPortal={portalData({
      review: {
        status: 'closed',
        message: 'This request has been closed. Contact the organization if you need more information.',
        updatedAt: '2026-08-20T10:00:00.000Z',
      },
      quotes: [],
    })} />);

    expect(screen.getByText('This request has been closed. Contact the organization if you need more information.')).toBeTruthy();
    expect(screen.queryByText(/Private qualification reason/i)).toBeNull();
    expect(screen.queryByText('Current')).toBeNull();
  });

  it('shows a safe, printable quote and requires verification before approval', async () => {
    const print = vi.fn();
    Object.defineProperty(window, 'print', { configurable: true, writable: true, value: print });
    post.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      if (path === '/public/mesaleads/portal/customer-portal/decision-challenges') {
        expect(body).toEqual({ email: 'buyer@acme.test' });
        return { accepted: true, challengeId: 'challenge-1', expiresAt: '2099-09-01T10:15:00.000Z', devVerificationCode: '482109' };
      }
      if (path === '/public/mesaleads/portal/customer-portal/quotes/quote-action-v1/decision') {
        expect(body).toEqual({
          decision: 'approve',
          remark: '',
          idempotencyKey: expect.any(String),
          quoteRowVersion: 3,
          acceptanceConfirmed: true,
          signerName: 'Anita Rao',
          signerEmail: 'buyer@acme.test',
          challengeId: 'challenge-1',
          verificationCode: '482109',
        });
        return { mode: 'portal', portal: portalData({ review: { status: 'approved', message: 'Quotation approved.', updatedAt: '2026-08-12T11:00:00.000Z' }, quotes: [{ ...publicQuote, status: 'approved' }] }) };
      }
      throw new Error(`Unexpected POST ${path}`);
    });

    render(<CustomerRequestPortal token="customer-portal" initialPortal={portalData()} />);

    expect(screen.getAllByText('INR 1,475,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Servo hydraulic, 250 tonne clamp force')).toBeTruthy();
    expect(screen.queryByText('lead-1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Print / save quotation' }));
    expect(print).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Approve quotation' }));
    fireEvent.change(screen.getByLabelText('Approving person’s name *'), { target: { value: 'Anita Rao' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect((await screen.findByRole('alert')).textContent).toContain('name and email');

    fireEvent.change(screen.getByLabelText('Approving person’s email *'), { target: { value: 'buyer@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect((await screen.findByRole('alert')).textContent).toContain('one-time code');

    fireEvent.change(screen.getByLabelText('Verification email'), { target: { value: 'buyer@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('If the address matches this request, a code has been sent.')).toBeTruthy();
    expect((screen.getByLabelText('Verification code *') as HTMLInputElement).value).toBe('482109');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/public/mesaleads/portal/customer-portal/quotes/quote-action-v1/decision',
      expect.objectContaining({ decision: 'approve', challengeId: 'challenge-1', verificationCode: '482109' }),
    ));
  });

  it('fails closed when online quote decisions are unavailable', () => {
    render(<CustomerRequestPortal token="customer-portal" initialPortal={portalData({
      decision: {
        decisionAllowed: false,
        verificationRequired: true,
        challengePath: '',
        unavailableMessage: 'Contact the sales team to approve or request changes.',
      },
    })} />);

    expect(screen.queryByRole('button', { name: 'Approve quotation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request revision' })).toBeNull();
    expect(screen.getByText('Contact the sales team to approve or request changes.')).toBeTruthy();
  });

  it('requires a revision remark and never offers actions on an expired quote', () => {
    const view = render(<CustomerRequestPortal token="customer-portal" initialPortal={portalData()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request revision' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send revision request' }));
    expect(screen.getByRole('alert').textContent).toContain('what should change');
    expect(post).not.toHaveBeenCalled();

    view.unmount();
    render(<CustomerRequestPortal token="customer-portal" initialPortal={portalData({
      quotes: [{ ...publicQuote, validUntil: '2020-01-01' }],
    })} />);
    expect(screen.queryByRole('button', { name: 'Approve quotation' })).toBeNull();
    expect(screen.getByText(/quotation has expired/i)).toBeTruthy();
  });
});

describe('MesaLeads organization quotation workspace', () => {
  it('creates and explicitly sends a versioned quotation draft', async () => {
    const draft: LeadQuote = {
      id: 'quote-internal-1',
      leadId: dashboardLead.id,
      versionNumber: 1,
      status: 'draft',
      title: 'Technical and commercial quotation',
      currency: 'INR',
      validUntil: '2099-09-30',
      summary: '',
      organizationRemarks: '',
      customerRemark: '',
      subtotal: '1250000.00',
      discountTotal: '0.00',
      taxTotal: '225000.00',
      grandTotal: '1475000.00',
      rowVersion: 0,
      sentAt: null,
      decidedAt: null,
      terms: [],
      lineItems: [],
    };
    post.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      if (path === '/mesaleads/leads/lead-1/quotes') {
        expect(body).toEqual(expect.objectContaining({
          title: 'Technical and commercial quotation',
          currency: 'INR',
          lineItems: [expect.objectContaining({ description: '250T injection molding machine', quantity: '1', unitPrice: '1250000.00' })],
        }));
        return draft;
      }
      if (path === '/mesaleads/leads/lead-1/quotes/quote-internal-1/send') {
        expect(body).toEqual({ rowVersion: 0, idempotencyKey: expect.any(String) });
        return { ...draft, status: 'sent', sentAt: '2026-08-12T11:00:00.000Z', rowVersion: 1 };
      }
      throw new Error(`Unexpected POST ${path}`);
    });
    const changed = vi.fn();

    render(<QuoteAndFulfillment lead={{ ...dashboardLead, quotes: [], fulfillment: null }} onChanged={changed} />);
    fireEvent.change(screen.getByLabelText('Item 1 description'), { target: { value: '250T injection molding machine' } });
    fireEvent.change(screen.getByLabelText('Item 1 unit price'), { target: { value: '1250000.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send quotation' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/mesaleads/leads/lead-1/quotes', expect.any(Object)));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/mesaleads/leads/lead-1/quotes/quote-internal-1/send', expect.any(Object)));
    expect(await screen.findByText('Quotation version 1 sent to the customer portal.')).toBeTruthy();
    expect(changed).toHaveBeenCalled();
  });
});

describe('MesaLeads questionnaire builder', () => {
  const editablePreviewForm: LeadForm = {
    id: 'form-preview',
    name: 'Original qualification form',
    description: 'Original customer introduction.',
    status: 'draft',
    revision: 1,
    questions: [
      question({
        key: 'application',
        type: 'short_text',
        label: 'Application',
        placeholder: 'Describe the application',
        sortOrder: 10,
      }),
      question({
        key: 'conditional_detail',
        type: 'long_text',
        label: 'Conditional detail',
        visibilityRule: { questionKey: 'application', operator: 'equals', value: 'custom' },
        sortOrder: 20,
      }),
    ],
  };

  it('keeps a live customer preview beside the editor on desktop', () => {
    render(<FormBuilder form={editablePreviewForm} onClose={vi.fn()} onSaved={vi.fn()} />);

    const preview = screen.getByRole('complementary', { name: 'Live customer form preview' });
    expect(preview).toBeTruthy();
    expect(preview?.previousElementSibling?.tagName).toBe('FIELDSET');
    expect(preview?.parentElement?.className).toContain('grid');
    expect(preview?.parentElement?.className).toContain('lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]');
    expect(preview?.className).toContain('lg:sticky');

    const previewView = within(preview as HTMLElement);
    expect(previewView.getByRole('heading', { name: 'Original qualification form' })).toBeTruthy();
    expect(previewView.getByText('Original customer introduction.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Questionnaire name'), { target: { value: 'Live crate qualification' } });
    fireEvent.change(screen.getByLabelText('Customer introduction'), { target: { value: 'Tell us about your crate project.' } });

    expect(previewView.getByRole('heading', { name: 'Live crate qualification' })).toBeTruthy();
    expect(previewView.getByText('Tell us about your crate project.')).toBeTruthy();
  });

  it('updates question content and control appearance in the preview as the template changes', () => {
    render(<FormBuilder form={editablePreviewForm} onClose={vi.fn()} onSaved={vi.fn()} />);

    const preview = screen.getByText('Customer preview').closest('aside') as HTMLElement;
    const previewView = within(preview);
    const questionLabel = screen.getAllByLabelText('Question label')[0];
    const questionType = screen.getAllByLabelText('Type')[0];

    fireEvent.change(questionLabel, { target: { value: 'Crate application' } });
    fireEvent.change(screen.getAllByLabelText('Helper text')[0], { target: { value: 'Describe where this crate will be used.' } });
    fireEvent.change(screen.getAllByLabelText('Placeholder')[0], { target: { value: 'For example, cold storage' } });
    fireEvent.click(screen.getAllByLabelText('Required')[0]);

    expect(previewView.getByText('Describe where this crate will be used.')).toBeTruthy();
    const previewTextField = previewView.getByRole('textbox', { name: 'Crate application *' }) as HTMLInputElement;
    expect(previewTextField.disabled).toBe(true);
    expect(previewTextField.placeholder).toBe('For example, cold storage');
    expect(previewView.getByText('Conditional question')).toBeTruthy();

    fireEvent.change(questionType, { target: { value: 'single_select' } });
    expect(previewView.getByText('Option 1')).toBeTruthy();
    expect(previewView.getByText('Option 2')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Options, one per line'), {
      target: { value: 'Material handling\nAutomotive component' },
    });
    expect(previewView.getByText('Material Handling')).toBeTruthy();
    expect(previewView.getByText('Automotive Component')).toBeTruthy();
    expect(previewView.queryByText('Option 1')).toBeNull();
    expect((previewView.getByRole('radio', { name: 'Material Handling' }) as HTMLInputElement).disabled).toBe(true);

    // Conditional questions remain visible to the template author even though
    // their customer-facing visibility depends on a future answer.
    expect(previewView.getByText('Conditional detail')).toBeTruthy();
  });

  it('saves the configured draft before publishing a versioned public form', async () => {
    let draft: LeadForm | undefined;
    post.mockImplementation(async (path: string, body?: { name: string; description: string; questions: LeadQuestion[] }) => {
      if (path === '/mesaleads/forms') {
        draft = {
          id: 'form-1',
          name: body?.name ?? '',
          description: body?.description ?? '',
          status: 'draft',
          revision: 1,
          questions: body?.questions ?? [],
        };
        return { form: draft };
      }
      if (path === '/mesaleads/forms/form-1/publish') {
        return {
          form: { ...draft, status: 'published', revision: 2 },
          link: { kind: 'generic', token: 'published-token', publicPath: '/mesaleads/q/published-token' },
        };
      }
      throw new Error(`Unexpected POST ${path}`);
    });

    const onSaved = vi.fn();
    render(<FormBuilder form={null} onClose={vi.fn()} onSaved={onSaved} />);

    const name = screen.getByLabelText('Questionnaire name');
    fireEvent.change(name, { target: { value: 'Custom IMM Qualification' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/mesaleads/forms', expect.objectContaining({
      name: 'Custom IMM Qualification',
      questions: expect.arrayContaining([
        expect.objectContaining({ key: 'product', type: 'short_text', required: true }),
        expect.objectContaining({ key: 'scope', type: 'single_select', required: true }),
        expect.objectContaining({
          key: 'mold_details',
          visibilityRule: { questionKey: 'scope', operator: 'contains', value: 'mold' },
        }),
      ]),
    })));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/mesaleads/forms/form-1/publish'));
    expect(await screen.findByText('Questionnaire published and ready to share.')).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/mesaleads/q/published-token`)).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(2);
  }, 15_000);
});
