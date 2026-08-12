export type LeadStage =
  | 'new'
  | 'discovery'
  | 'questionnaire_sent'
  | 'requirements_received'
  | 'technical_review'
  | 'mold_sourcing'
  | 'quotation'
  | 'follow_up'
  | 'won'
  | 'lost';

export type QuestionType =
  | 'section'
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'single_select'
  | 'multi_select'
  | 'yes_no'
  | 'file';

export type VisibilityRule = {
  questionKey: string;
  operator: 'equals' | 'not_equals' | 'contains';
  value: unknown;
};

export type LeadQuestion = {
  id?: string;
  key: string;
  type: QuestionType;
  label: string;
  helpText: string;
  placeholder: string;
  required: boolean;
  options: string[];
  validation?: Record<string, unknown>;
  visibilityRule?: VisibilityRule | null;
  sortOrder: number;
};

export type LeadFormLink = {
  id?: string;
  token?: string;
  kind: 'generic' | 'invitation';
  publicPath?: string;
  status?: 'active' | 'submitted' | 'revoked';
  leadId?: string | null;
  expiresAt?: string | null;
  active?: boolean;
  openedAt?: string | null;
  usedAt?: string | null;
  createdAt?: string;
};

export type LeadForm = {
  id: string;
  name: string;
  slug?: string;
  description: string;
  privacyNotice?: string;
  status: 'draft' | 'published' | 'archived';
  revision: number;
  questions: LeadQuestion[];
  links?: LeadFormLink[];
  publishedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: { leads?: number; submissions?: number };
};

export type LeadActivity = {
  id: string;
  type: string;
  title?: string;
  note?: string;
  message?: string;
  body?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  occurredAt?: string;
};

export type LeadSubmission = {
  id: string;
  answers: Record<string, unknown> | Array<{
    questionKey: string;
    label?: string;
    value: unknown;
  }>;
  formSnapshot?: { questions?: LeadQuestion[] } | LeadQuestion[];
  questionSnapshot?: LeadQuestion[];
  submittedAt?: string;
  createdAt?: string;
  attachments?: LeadAttachment[];
};

export type LeadAttachment = {
  id: string;
  questionKey: string;
  fileName?: string;
  originalName?: string;
  mimeType: string;
  size?: number;
  sizeBytes?: number;
};

export type MesaLead = {
  id: string;
  reference: string;
  leadNumber: string;
  source: string;
  stage: LeadStage;
  priority: 'low' | 'medium' | 'high';
  contactName: string;
  phone: string;
  email: string;
  companyName: string;
  companyAddress?: string;
  gstNumber?: string;
  product: string;
  requirement?: string;
  requirementsSummary?: string;
  scope: 'machine_only' | 'machine_mold' | 'mold_only' | 'unknown';
  ownerMembershipId?: string | null;
  score?: number;
  machineRecommendation?: string;
  clampTonnage?: number | null;
  shotCapacity?: number | null;
  moldStatus?: string;
  moldSupplier?: string;
  moldQuoteAmount?: number | null;
  quotationAmount?: number | null;
  quotationStatus?: string;
  nextFollowUpAt?: string | null;
  followUpNote?: string;
  lostReason?: string;
  orderReference?: string;
  version: number;
  formId?: string | null;
  form?: Pick<LeadForm, 'id' | 'name' | 'revision'> | null;
  submissions?: LeadSubmission[];
  activities?: LeadActivity[];
  attachments?: LeadAttachment[];
  quotes?: LeadQuote[];
  fulfillment?: LeadFulfillment | null;
  createdAt: string;
  updatedAt: string;
};

export type LeadSummary = {
  kpis?: {
    totalLeads?: number;
    openLeads?: number;
    openPipelineValue?: number;
    wonLeads?: number;
    lostLeads?: number;
    questionnaireCompletionRate?: number;
    total?: number;
    open?: number;
    new?: number;
    awaitingResponse?: number;
    overdueFollowUps?: number;
    pipelineValue?: number;
    won?: number;
    wonValue?: number;
    winRate?: number;
  };
  byStage?: Array<{ stage: LeadStage; count: number; value?: number }> | Record<string, number>;
  attention?: Array<Partial<MesaLead> & { id: string; reason?: string }>;
  recentLeads?: Array<Partial<MesaLead> & { id: string }>;
};

export type PublicLeadForm = {
  mode: 'form';
  organization: { id?: string; name: string; slug?: string };
  form: LeadForm;
  prefill?: Record<string, string | number | boolean | string[]>;
  link: { kind: 'generic' | 'invitation'; expiresAt?: string | null };
};

export type QuoteStatus = 'draft' | 'sent' | 'revision_requested' | 'approved' | 'superseded' | 'withdrawn' | 'expired';

export type QuoteLineItem = {
  id: string;
  sortOrder: number;
  description: string;
  specification: string;
  hsnSacCode: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
  taxableAmount: string;
  taxAmount: string;
  total: string;
};

export type QuoteTerm = { id?: string; label: string; value: string; sortOrder?: number };

export type LeadQuote = {
  id: string;
  leadId: string;
  versionNumber: number;
  status: QuoteStatus;
  title: string;
  currency: string;
  summary: string;
  organizationRemarks: string;
  customerRemark: string;
  lineItems: QuoteLineItem[];
  terms: QuoteTerm[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  validUntil?: string | null;
  rowVersion: number;
  sentAt?: string | null;
  decidedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type FulfillmentStatus = 'not_started' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
export type MilestoneStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export type FulfillmentMilestone = {
  id: string;
  name: string;
  status: MilestoneStatus;
  sortOrder: number;
  targetDate?: string | null;
  completedAt?: string | null;
  customerNote: string;
  rowVersion: number;
  updatedAt?: string;
};

export type LeadFulfillment = {
  id: string;
  status: FulfillmentStatus;
  customerSummary: string;
  estimatedCompletionDate?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  rowVersion: number;
  milestones: FulfillmentMilestone[];
  updatedAt?: string;
};

export type PublicQuoteLineItem = Omit<QuoteLineItem, 'id' | 'sortOrder'>;

export type PublicLeadQuote = {
  quoteActionId: string;
  versionNumber: number;
  status: Exclude<QuoteStatus, 'draft'>;
  title: string;
  currency: string;
  validUntil?: string | null;
  summary: string;
  customerMessage: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  quoteRowVersion: number;
  sentAt?: string | null;
  decidedAt?: string | null;
  customerRemark: string;
  terms: Array<{ label: string; value: string }>;
  lineItems: PublicQuoteLineItem[];
};

export type PublicFulfillment = {
  status: FulfillmentStatus;
  customerSummary: string;
  estimatedCompletionDate?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  milestones: Array<{
    publicId: string;
    name: string;
    sortOrder: number;
    status: MilestoneStatus;
    targetDate?: string | null;
    completedAt?: string | null;
    customerNote: string;
    updatedAt?: string | null;
  }>;
};

export type PortalOrganizationProfile = {
  legalName: string;
  brandName: string;
  summary: string;
  website: string;
  emails: string[];
  phones: string[];
  contact: { name: string; title: string };
  address: { line1: string; line2: string; city: string; state: string; postalCode: string; country: string };
  capabilities: string[];
  branding: { logoUrl: string; primaryColor: string };
};

export type CustomerRequestPortal = {
  organization: { name: string; profile: PortalOrganizationProfile };
  lead: {
    reference: string;
    product: string;
    status: string;
  };
  review: {
    status: 'pending' | 'in_review' | 'quoted' | 'revision_requested' | 'approved' | 'closed';
    message: string;
    updatedAt?: string | null;
  };
  decision: {
    decisionAllowed: boolean;
    verificationRequired: true;
    challengePath: string;
    unavailableMessage: string;
  };
  quotes: PublicLeadQuote[];
  fulfillment: PublicFulfillment | null;
  timeline: Array<{ type: string; title: string; message: string; occurredAt: string; nextUpdateAt?: string | null }>;
};

export type PublicLeadPortal = {
  mode: 'portal';
  portal: CustomerRequestPortal;
};

export type PublicLeadJourney = PublicLeadForm | PublicLeadPortal;
