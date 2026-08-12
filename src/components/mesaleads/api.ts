import { ApiError, api } from '../../lib/apiClient';
import { getDevUser, getOrganizationId } from '../../lib/apiIdentity';
import type {
  CustomerRequestPortal,
  LeadForm,
  LeadFormLink,
  LeadFulfillment,
  LeadQuestion,
  LeadQuote,
  LeadSummary,
  MesaLead,
  PublicLeadJourney,
} from './types';

export type LeadFormWrite = {
  name: string;
  description?: string;
  privacyNotice?: string;
  questions: LeadQuestion[];
};

export type LeadWrite = Partial<Omit<MesaLead, 'id' | 'reference' | 'leadNumber' | 'createdAt' | 'updatedAt' | 'activities' | 'submissions'>> & { linkExpiresAt?: string };
export type LeadCreateResult = { lead: MesaLead; link: LeadFormLink };

function normalizeLead(input: MesaLead | (Partial<MesaLead> & { id: string })): MesaLead {
  const reference = input.reference || input.leadNumber || input.id;
  return {
    ...input,
    reference,
    leadNumber: reference,
    source: input.source ?? 'direct',
    stage: input.stage ?? 'new',
    priority: input.priority ?? 'medium',
    contactName: input.contactName ?? '',
    phone: input.phone ?? '',
    email: input.email ?? '',
    companyName: input.companyName ?? '',
    product: input.product ?? '',
    scope: input.scope ?? 'machine_only',
    version: input.version ?? 0,
    createdAt: input.createdAt ?? input.updatedAt ?? new Date(0).toISOString(),
    updatedAt: input.updatedAt ?? input.createdAt ?? new Date(0).toISOString(),
    activities: input.activities?.map((activity) => ({
      ...activity,
      message: activity.message ?? activity.title,
      body: activity.body ?? activity.note,
    })),
    submissions: input.submissions?.map((submission) => ({
      ...submission,
      formSnapshot: submission.formSnapshot ?? submission.questionSnapshot,
    })),
  } as MesaLead;
}

export async function getMesaSummary(): Promise<LeadSummary> {
  return api.get<LeadSummary>('/mesaleads/summary');
}

export async function getMesaLeads(): Promise<MesaLead[]> {
  const result = await api.get<MesaLead[] | { leads: MesaLead[] }>('/mesaleads/leads');
  return (Array.isArray(result) ? result : result.leads).map(normalizeLead);
}

export async function getMesaLead(id: string): Promise<MesaLead> {
  const result = await api.get<MesaLead | { lead: MesaLead }>(`/mesaleads/leads/${id}`);
  return normalizeLead('lead' in result ? result.lead : result);
}

export async function fetchLeadAttachment(id: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const devUser = getDevUser();
  if (devUser) headers['x-dev-user'] = devUser;
  const organizationId = getOrganizationId();
  if (organizationId) headers['x-org'] = organizationId;
  const response = await fetch(`/api/mesaleads/attachments/${encodeURIComponent(id)}`, {
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    let body: { error?: { code?: string; message?: string; details?: unknown } } | null = null;
    try { body = await response.json() as typeof body; } catch { /* binary/error proxy response */ }
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'attachment_error',
      body?.error?.message ?? 'Could not download this attachment.',
      body?.error?.details,
    );
  }
  return response.blob();
}

export async function createMesaLead(input: LeadWrite): Promise<LeadCreateResult> {
  const result = await api.post<{ lead: MesaLead; link: LeadFormLink }>('/mesaleads/leads', input);
  return { lead: normalizeLead(result.lead), link: result.link };
}

export async function updateMesaLead(id: string, input: LeadWrite): Promise<MesaLead> {
  const result = await api.put<MesaLead | { lead: MesaLead }>(`/mesaleads/leads/${id}`, input);
  return normalizeLead('lead' in result ? result.lead : result);
}

export async function addLeadActivity(id: string, input: { type: string; message: string; dueAt?: string }): Promise<unknown> {
  return api.post(`/mesaleads/leads/${id}/activities`, {
    type: input.type,
    title: input.message,
    note: '',
    ...(input.dueAt ? { nextFollowUpAt: input.dueAt } : {}),
  });
}

export async function addCustomerPortalUpdate(id: string, input: { title: string; note?: string; nextUpdateAt?: string }): Promise<unknown> {
  return api.post(`/mesaleads/leads/${id}/activities`, {
    type: 'customer_update',
    title: input.title,
    note: input.note ?? '',
    ...(input.nextUpdateAt ? { nextUpdateAt: input.nextUpdateAt } : {}),
  });
}

export async function getLeadForms(): Promise<LeadForm[]> {
  const result = await api.get<LeadForm[] | { forms: LeadForm[] }>('/mesaleads/forms');
  return Array.isArray(result) ? result : result.forms;
}

export async function getLeadForm(id: string): Promise<LeadForm> {
  const result = await api.get<LeadForm | { form: LeadForm }>(`/mesaleads/forms/${id}`);
  return 'form' in result ? result.form : result;
}

export async function saveLeadForm(input: LeadFormWrite, id?: string): Promise<LeadForm> {
  const result = id
    ? await api.put<LeadForm | { form: LeadForm }>(`/mesaleads/forms/${id}`, input)
    : await api.post<LeadForm | { form: LeadForm }>('/mesaleads/forms', input);
  return 'form' in result ? result.form : result;
}

export async function publishLeadForm(id: string): Promise<{ form: LeadForm; link?: LeadFormLink }> {
  const result = await api.post<LeadForm | { form: LeadForm; link?: LeadFormLink }>(`/mesaleads/forms/${id}/publish`);
  return 'form' in result ? result : { form: result };
}

export async function cloneLeadForm(id: string): Promise<LeadForm> {
  const result = await api.post<LeadForm | { form: LeadForm }>(`/mesaleads/forms/${id}/clone`);
  return 'form' in result ? result.form : result;
}

export async function archiveLeadForm(id: string): Promise<LeadForm> {
  const result = await api.post<LeadForm | { form: LeadForm }>(`/mesaleads/forms/${id}/archive`);
  return 'form' in result ? result.form : result;
}

export async function createLeadFormLink(formId: string, input: { kind: 'generic' | 'invitation'; leadId?: string }): Promise<LeadFormLink> {
  const result = await api.post<LeadFormLink | { link: LeadFormLink }>(`/mesaleads/forms/${formId}/links`, input);
  return 'link' in result ? result.link : result;
}

export type QuoteWrite = {
  idempotencyKey: string;
  title: string;
  currency: string;
  validUntil?: string;
  summary?: string;
  organizationRemarks?: string;
  terms: Array<{ label: string; value: string }>;
  lineItems: Array<{
    description: string;
    specification?: string;
    hsnSacCode?: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    discountAmount?: string;
    taxRate?: string;
  }>;
  send?: boolean;
};

export async function getPublicLeadForm(token: string): Promise<PublicLeadJourney> {
  return api.get<PublicLeadJourney>(`/public/mesaleads/forms/${encodeURIComponent(token)}`);
}

export async function submitPublicLeadForm(token: string, body: unknown): Promise<{
  reference: string;
  leadId: string;
  submissionId: string;
  status: 'submitted';
  portalToken?: string;
  portalPath: string;
  journeyPath: string;
  portal: CustomerRequestPortal;
}> {
  return api.post(`/public/mesaleads/forms/${encodeURIComponent(token)}`, body);
}

export async function getPublicLeadPortal(token: string): Promise<{ mode: 'portal'; portal: CustomerRequestPortal }> {
  return api.get(`/public/mesaleads/portal/${encodeURIComponent(token)}`);
}

export async function decidePublicQuote(token: string, quoteId: string, input: {
  decision: 'approve' | 'request_revision';
  remark: string;
  idempotencyKey: string;
  quoteRowVersion: number;
  acceptanceConfirmed: boolean;
  signerName: string;
  signerEmail: string;
  challengeId: string;
  verificationCode: string;
}): Promise<{ mode: 'portal'; portal: CustomerRequestPortal }> {
  return api.post(`/public/mesaleads/portal/${encodeURIComponent(token)}/quotes/${encodeURIComponent(quoteId)}/decision`, input);
}

export async function createPublicDecisionChallenge(token: string, input: { email: string }): Promise<{
  accepted: true;
  challengeId: string;
  expiresAt: string;
  devVerificationCode?: string;
}> {
  return api.post(`/public/mesaleads/portal/${encodeURIComponent(token)}/decision-challenges`, input);
}

export async function createLeadQuote(leadId: string, input: QuoteWrite): Promise<LeadQuote> {
  return api.post(`/mesaleads/leads/${encodeURIComponent(leadId)}/quotes`, input);
}

export async function updateLeadQuote(leadId: string, quoteId: string, input: Partial<Omit<QuoteWrite, 'idempotencyKey'>> & { rowVersion: number }): Promise<LeadQuote> {
  return api.patch(`/mesaleads/leads/${encodeURIComponent(leadId)}/quotes/${encodeURIComponent(quoteId)}`, input);
}

export async function sendLeadQuote(leadId: string, quoteId: string, input: { rowVersion: number; idempotencyKey: string }): Promise<LeadQuote> {
  return api.post(`/mesaleads/leads/${encodeURIComponent(leadId)}/quotes/${encodeURIComponent(quoteId)}/send`, input);
}

export async function reviseLeadQuote(leadId: string, quoteId: string, input: { rowVersion: number; idempotencyKey: string }): Promise<LeadQuote> {
  return api.post(`/mesaleads/leads/${encodeURIComponent(leadId)}/quotes/${encodeURIComponent(quoteId)}/revise`, input);
}

export async function createLeadFulfillment(leadId: string, input: {
  idempotencyKey: string;
  status?: LeadFulfillment['status'];
  customerSummary?: string;
  estimatedCompletionDate?: string;
}): Promise<LeadFulfillment> {
  return api.post(`/mesaleads/leads/${encodeURIComponent(leadId)}/fulfillment`, input);
}

export async function updateLeadFulfillment(leadId: string, input: {
  rowVersion: number;
  status?: LeadFulfillment['status'];
  customerSummary?: string;
  estimatedCompletionDate?: string;
}): Promise<LeadFulfillment> {
  return api.patch(`/mesaleads/leads/${encodeURIComponent(leadId)}/fulfillment`, input);
}

export async function updateFulfillmentMilestone(leadId: string, milestoneId: string, input: {
  rowVersion: number;
  status?: LeadFulfillment['milestones'][number]['status'];
  name?: string;
  targetDate?: string;
  customerNote?: string;
  sortOrder?: number;
}): Promise<LeadFulfillment> {
  return api.patch(`/mesaleads/leads/${encodeURIComponent(leadId)}/fulfillment/milestones/${encodeURIComponent(milestoneId)}`, input);
}
