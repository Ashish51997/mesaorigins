/**
 * Human prose for the OpenAPI document, keyed by `METHOD /express/path`.
 *
 * Everything structural — paths, methods, request bodies, auth and the required
 * permission — is read off the live router stack, so it cannot drift. Only the
 * wording and the response shape live here. `openapi.test.ts` fails the build
 * when a mounted route has no entry, which is what keeps this file honest.
 */

export interface DocumentedError {
  status: number;
  /** The `error.code` in the response envelope. */
  code: string;
  /** The condition that produces it, phrased for an integrator. */
  when: string;
}

export interface RouteDoc {
  tag: string;
  operationId: string;
  summary: string;
  description?: string;
  /** Status the handler returns on success. Defaults to 200. */
  status?: number;
  responseDescription: string;

  // ── Response shape: either a Prisma model or a hand-written schema ────────
  /** Prisma model the response is built from; its component schema is generated from the datamodel. */
  responseModel?: string;
  responseIsArray?: boolean;
  /** Restrict to these model fields when the service uses a `select`. */
  responseFields?: string[];
  /** Relations the service `include`s on top of the model's own columns. */
  responseIncludes?: string[];
  responseNullable?: boolean;
  /** Schema for computed responses that are not a Prisma model. */
  responseSchema?: Record<string, unknown>;

  /** Description per `:param` in the path. */
  params?: Record<string, string>;
  /** Optional request headers specific to this operation. */
  headers?: Record<string, string>;
  /** Domain failures beyond the standard auth/validation set. */
  errors?: DocumentedError[];
  /** Route is reachable without an identity. */
  public?: boolean;
  deprecated?: boolean;
}

export const TAGS: { name: string; description: string }[] = [
  { name: 'Health', description: 'Liveness and the caller’s own identity.' },
  { name: 'Sales', description: 'Customers, inquiries, quotations and sales orders — the head of the value chain.' },
  { name: 'Planning', description: 'Scheduling confirmed orders onto a machine, shift and date.' },
  { name: 'Manufacturing', description: 'Shift logbooks and the templates that shape them. A logbook may only be opened against a scheduled plan.' },
  { name: 'Quality', description: 'Roll inspection. A pass books finished-goods stock, which is what makes a roll dispatchable.' },
  { name: 'Dispatch', description: 'Shipping produced orders: dispatch record, invoice and the finished-goods stock movement.' },
  { name: 'Inventory', description: 'Ledger-derived stock balances plus raw-material receive and issue.' },
  { name: 'CAPA', description: 'Customer complaints against dispatched batches and the corrective/preventive actions that close them out.' },
  { name: 'Formulations', description: 'Coded raw-material recipes (BOM) with revisions.' },
  { name: 'Maintenance', description: 'Machine registry and the preventive maintenance schedule.' },
  { name: 'Dashboard', description: 'Aggregated KPIs for the per-role home screens.' },
  { name: 'Administration', description: 'Employees, roles and per-employee screen access.' },
  { name: 'Onboarding', description: 'Create a new organization and its first owner account.' },
  { name: 'MesaLeads', description: 'Configurable customer questionnaires, lead qualification, pipeline and follow-up.' },
  { name: 'Legacy', description: 'The data.json blob store still backing domains not yet migrated to Postgres. Being retired domain by domain.' },
];

const NOT_FOUND = (what: string): DocumentedError => ({ status: 404, code: 'not_found', when: `No ${what} with that id exists in your organization.` });

const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const int = { type: 'integer' } as const;
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties });
const arr = (items: unknown) => ({ type: 'array', items });

const ACK = obj({ ok: { type: 'boolean' } });
const SERVICE_SUMMARY = obj({
  id: str,
  name: str,
  description: str,
  status: { type: 'string', enum: ['active', 'paused', 'stopped'] },
  sortOrder: int,
});
const ORGANIZATION_ACCESS = obj({
  organizationId: str,
  organizationName: str,
  organizationSlug: str,
  membershipId: str,
  employeeCode: str,
  role: str,
  isAdmin: { type: 'boolean' },
  screens: arr(str),
  services: arr(SERVICE_SUMMARY),
});
const AUTHENTICATED_USER = obj({
  userId: str,
  email: { type: 'string', format: 'email' },
  name: str,
  organizationId: str,
  organizationName: str,
  organizationSlug: str,
  membershipId: str,
  employeeCode: str,
  role: str,
  isAdmin: { type: 'boolean' },
  screens: arr(str),
  services: arr(SERVICE_SUMMARY),
  organizations: arr(ORGANIZATION_ACCESS),
});
const LEAD_QUESTION = obj({
  id: str, key: str, type: str, label: str, helpText: str, placeholder: str,
  required: { type: 'boolean' }, options: arr(str), validation: { type: 'object' },
  visibilityRule: { type: ['object', 'null'] }, sortOrder: int,
});
const PUBLIC_LEAD_QUESTION = obj({
  key: str, type: str, label: str, helpText: str, placeholder: str,
  required: { type: 'boolean' }, options: arr(str), validation: { type: 'object' },
  visibilityRule: { type: ['object', 'null'] }, sortOrder: int,
});
const LEAD_FORM_LINK_SUMMARY = obj({
  id: str, kind: str, status: str, leadId: { type: ['string', 'null'] },
  expiresAt: { type: ['string', 'null'], format: 'date-time' },
  openedAt: { type: ['string', 'null'], format: 'date-time' },
  usedAt: { type: ['string', 'null'], format: 'date-time' },
  createdAt: { type: 'string', format: 'date-time' },
});
const LEAD_FORM = obj({
  id: str, familyKey: str, name: str, description: str, privacyNotice: str, status: str,
  revision: int, publishedAt: { type: ['string', 'null'], format: 'date-time' },
  questions: arr(LEAD_QUESTION), links: arr(LEAD_FORM_LINK_SUMMARY), _count: obj({ submissions: int }),
});
const PUBLIC_LEAD_FORM = obj({
  id: str, name: str, description: str, privacyNotice: str, revision: int,
  questions: arr(PUBLIC_LEAD_QUESTION),
});
const MESA_LEAD = obj({
  id: str, reference: str, source: str, priority: str, stage: str, contactName: str, phone: str,
  email: str, companyName: str, companyAddress: str, gstNumber: str, product: str,
  requirement: str, scope: str, ownerMembershipId: { type: ['string', 'null'] },
  machineRecommendation: str, clampTonnage: { type: ['number', 'null'] },
  shotCapacity: { type: ['number', 'null'] }, moldStatus: str, moldSupplier: str,
  moldQuoteAmount: { type: ['number', 'null'] }, quotationAmount: { type: ['number', 'null'] },
  quotationStatus: str, nextFollowUpAt: { type: ['string', 'null'], format: 'date-time' },
  followUpNote: str, lostReason: str, orderReference: str,
  consentedAt: { type: ['string', 'null'], format: 'date-time' }, version: int,
  formId: { type: ['string', 'null'] },
  form: { type: ['object', 'null'], properties: { id: str, name: str, revision: int, status: str } },
  submissions: arr({ type: 'object' }), activities: arr({ type: 'object' }), attachments: arr({ type: 'object' }),
  createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
});
const MESALEADS_PROFILE = obj({
  legalName: str, brandName: str, summary: str, website: str,
  emails: arr(str), phones: arr(str),
  contact: obj({ name: str, title: str }),
  address: obj({ line1: str, line2: str, city: str, state: str, postalCode: str, country: str }),
  capabilities: arr(str), branding: obj({ logoUrl: str, primaryColor: str }),
});
const PUBLIC_QUOTE = obj({
  quoteActionId: str, versionNumber: int, status: str, title: str, currency: str,
  validUntil: { type: ['string', 'null'], format: 'date-time' }, summary: str,
  customerMessage: str, subtotal: str, discountTotal: str, taxTotal: str, grandTotal: str,
  quoteRowVersion: int, sentAt: { type: ['string', 'null'], format: 'date-time' },
  decidedAt: { type: ['string', 'null'], format: 'date-time' }, customerRemark: str,
  terms: arr(obj({ label: str, value: str })),
  lineItems: arr(obj({
    description: str, specification: str, hsnSacCode: str, quantity: str, unit: str,
    unitPrice: str, discountAmount: str, taxRate: str, taxableAmount: str, taxAmount: str, total: str,
  })),
});
const PUBLIC_PORTAL = obj({
  organization: obj({ name: str, profile: MESALEADS_PROFILE }),
  lead: obj({ reference: str, product: str, status: str }),
  review: obj({ status: { type: 'string', enum: ['pending', 'in_review', 'quoted', 'revision_requested', 'approved', 'closed'] }, message: str, updatedAt: { type: 'string', format: 'date-time' } }),
  decision: obj({ decisionAllowed: { type: 'boolean' }, verificationRequired: { type: 'boolean' }, challengePath: str, unavailableMessage: str }),
  quotes: arr(PUBLIC_QUOTE),
  fulfillment: { type: ['object', 'null'], description: 'Customer-safe status, dates and milestone projection.' },
  timeline: arr(obj({ sequence: int, type: str, title: str, message: str, occurredAt: { type: 'string', format: 'date-time' }, nextUpdateAt: { type: ['string', 'null'], format: 'date-time' } })),
});
const QUOTE_RESPONSE = { type: 'object', description: 'Protected quotation DTO with decimal amounts serialized as strings and ordered line items.' };
const FULFILLMENT_RESPONSE = { type: 'object', description: 'Protected fulfillment DTO with ordered milestones and optimistic row versions.' };

export const ROUTE_DOCS: Record<string, RouteDoc> = {
  // ── Health ────────────────────────────────────────────────────────────────
  'GET /api/health': {
    tag: 'Health',
    operationId: 'getHealth',
    summary: 'Liveness probe',
    description: 'Unauthenticated. Returns as soon as the process is serving; it does not check the database.',
    responseDescription: 'The service is up.',
    responseSchema: obj({
      status: { type: 'string', enum: ['ok'] },
      time: { type: 'string', format: 'date-time' },
      auth: { type: 'string', enum: ['dev', 'authjs'], description: 'dev = x-dev-user picker; authjs = Google OAuth + per-user password (Postgres sessions)' },
      google: { type: 'boolean', description: 'True when AUTH_GOOGLE_ID/SECRET are configured' },
    }),
    public: true,
  },
  'GET /api/me': {
    tag: 'Health',
    operationId: 'getCurrentUser',
    summary: 'The caller’s identity',
    description: 'Resolves the membership behind the current credential. Send x-org with an owned organization id or slug to select that tenant; foreign and inactive memberships fail closed.',
    responseDescription: 'The selected membership plus every non-inactive organization membership and its currently usable services.',
    responseSchema: obj({
      user: AUTHENTICATED_USER,
    }),
    errors: [
      { status: 403, code: 'organization_not_available', when: 'x-org does not identify a non-inactive membership owned by the signed-in user.' },
    ],
  },
  'GET /api/auth/session-context': {
    tag: 'Health',
    operationId: 'getSessionContext',
    summary: 'Restore a cookie session for the landing page',
    description: 'Resolves only a real Auth.js database-session cookie and never the DEV_AUTH fallback identity. With no cookie it returns `{ "user": null }`, allowing a fresh local visit to remain on the two-login entry screen. Send x-org with an owned organization id or slug to restore that tenant.',
    responseDescription: 'The authenticated organization context, or a null user when no session cookie is present.',
    public: true,
    headers: {
      'x-org': 'Optionally restore one owned, non-inactive organization membership by id or slug.',
    },
    responseSchema: obj({
      user: { oneOf: [AUTHENTICATED_USER, { type: 'null' }] },
    }),
    errors: [
      { status: 401, code: 'invalid_token', when: 'The supplied session cookie is unknown or expired; the cookie is cleared.' },
      { status: 403, code: 'no_membership', when: 'The session user has no non-inactive organization membership.' },
      { status: 403, code: 'organization_not_available', when: 'x-org does not identify a non-inactive membership owned by the session user.' },
    ],
  },
  'POST /api/auth/login': {
    tag: 'Health',
    operationId: 'passwordLogin',
    summary: 'Email + password sign-in',
    description: 'Verifies User.passwordHash, creates an Auth.js Session row, and sets the httpOnly session cookie. The response keeps the selected membership fields at user level for backward compatibility and includes all selectable organization contexts. Services include only active assignments backed by an active global service; suspended organizations receive no services. Google OAuth uses /auth/signin/google instead.',
    responseDescription: 'The selected membership, every organization context and their usable services; session cookie is set.',
    public: true,
    headers: {
      'x-org': 'Optionally select one owned, non-inactive organization membership by id or slug after the credentials are verified.',
    },
    responseSchema: obj({
      user: AUTHENTICATED_USER,
    }),
    errors: [
      { status: 401, code: 'invalid_credentials', when: 'Email or password is wrong, or the user has no passwordHash.' },
      { status: 403, code: 'no_membership', when: 'The email is not an active organization member.' },
      { status: 403, code: 'organization_not_available', when: 'x-org does not identify a non-inactive membership owned by the authenticated user.' },
      { status: 429, code: 'rate_limited', when: 'The IP, account, or IP-account attempt budget is exhausted.' },
      { status: 503, code: 'auth_not_configured', when: 'AUTH_SECRET is missing.' },
    ],
  },
  'POST /api/auth/logout': {
    tag: 'Health',
    operationId: 'passwordLogout',
    summary: 'Clear session cookie',
    description: 'Deletes the Session row for the cookie (if any) and clears the Auth.js session cookie.',
    responseDescription: 'Signed out.',
    public: true,
    responseSchema: ACK,
  },
  'GET /api/onboarding/access': {
    tag: 'Onboarding',
    operationId: 'getOnboardingAccess',
    summary: 'Check onboarding access',
    description: 'Protected route for internal admins only. Confirms the current signed-in user is allowed to onboard a new organization.',
    responseDescription: 'The caller may use the onboarding route.',
    responseSchema: obj({ allowed: { type: 'boolean' }, allowedEmails: arr(str) }),
    errors: [
      { status: 403, code: 'forbidden', when: 'The current user is not on the onboarding allowlist or is not an admin.' },
      { status: 503, code: 'auth_not_configured', when: 'AUTH_SECRET is missing.' },
    ],
  },
  'GET /api/onboarding/organizations': {
    tag: 'Onboarding',
    operationId: 'listOnboardingOrganizations',
    summary: 'List all organizations',
    description: 'Protected route for the product owner. Returns all organizations with owner and administrator contact details.',
    responseDescription: 'All organizations and their admin contacts.',
    responseSchema: obj({
      organizations: arr(obj({
        id: str,
        name: str,
        slug: str,
        status: str,
        plan: str,
        subscriptionStatus: str,
        mesaLeadsProfile: { oneOf: [MESALEADS_PROFILE, { type: 'null' }] },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        services: arr(obj({
          id: str, name: str, description: str, status: str, sortOrder: int, assignmentStatus: str,
        })),
        contacts: arr(obj({
          membershipId: str,
          userId: str,
          name: str,
          email: { type: 'string', format: 'email' },
          role: str,
          employeeCode: str,
          status: str,
        })),
      })),
    }),
    errors: [
      { status: 403, code: 'forbidden', when: 'The current user is not the product owner or is not an admin.' },
      { status: 503, code: 'auth_not_configured', when: 'AUTH_SECRET is missing.' },
    ],
  },
  'GET /api/onboarding/services': {
    tag: 'Onboarding',
    operationId: 'listMesaDeskServices',
    summary: 'List the service catalog',
    description: 'Returns every MesaDesk service that can be assigned to an organization.',
    responseDescription: 'The global MesaDesk service catalog.',
    responseSchema: obj({ services: arr(SERVICE_SUMMARY) }),
    errors: [
      { status: 403, code: 'forbidden', when: 'The current user is not the product owner or is not an admin.' },
      { status: 503, code: 'auth_not_configured', when: 'AUTH_SECRET is missing.' },
    ],
  },
  'PUT /api/onboarding/services/:id/status': {
    tag: 'Onboarding',
    operationId: 'setMesaDeskServiceStatus',
    summary: 'Set a global service status',
    description: 'Protected product-owner control that starts, pauses or stops a MesaDesk service for every organization.',
    responseDescription: 'The updated global service catalog entry.',
    responseSchema: SERVICE_SUMMARY,
    params: { id: 'MesaDesk service id.' },
    errors: [
      { status: 403, code: 'forbidden', when: 'The current user is not the product owner or is not an admin.' },
      { status: 404, code: 'not_found', when: 'The service does not exist.' },
      { status: 503, code: 'auth_not_configured', when: 'AUTH_SECRET is missing.' },
    ],
  },
  'POST /api/onboarding/bootstrap': {
    tag: 'Onboarding',
    operationId: 'bootstrapOrganization',
    summary: 'Create organization and first owner',
    description: 'Protected route for internal admins only. Creates an Organization, seeds built-in tenant roles, and creates the first owner account with a password.',
    responseDescription: 'The created organization and first owner details.',
    status: 201,
    responseSchema: obj({
      organization: obj({ id: str, name: str, slug: str, services: arr(SERVICE_SUMMARY) }),
      owner: obj({
        userId: str, email: { type: 'string', format: 'email' }, name: str,
        membershipId: str, employeeCode: str,
        organizationId: str, organizationName: str,
        role: str,
      }),
    }),
    errors: [
      { status: 403, code: 'forbidden', when: 'The current user is not on the onboarding allowlist or is not an admin.' },
      { status: 409, code: 'org_taken', when: 'The requested organization slug is already in use.' },
      { status: 409, code: 'owner_email_exists', when: 'The first-owner email already belongs to a global account and must use a verified invitation flow.' },
      { status: 503, code: 'auth_not_configured', when: 'AUTH_SECRET is missing.' },
    ],
  },
  'PUT /api/onboarding/organizations/:id/services': {
    tag: 'Onboarding',
    operationId: 'setOrganizationServices',
    summary: 'Replace organization service access',
    description: 'Assigns one or more MesaDesk services to an organization, replacing its previous service set.',
    responseDescription: 'The organization id and its updated service assignments.',
    responseSchema: obj({
      organizationId: str,
      services: arr(obj({
        id: str, name: str, description: str, status: str, sortOrder: int, assignmentStatus: str,
      })),
    }),
    params: { id: 'Organization id.' },
    errors: [
      { status: 403, code: 'forbidden', when: 'The current user is not the product owner or is not an admin.' },
      { status: 404, code: 'not_found', when: 'The organization does not exist.' },
      { status: 422, code: 'invalid_service', when: 'One or more service ids are not in the catalog.' },
      { status: 503, code: 'auth_not_configured', when: 'AUTH_SECRET is missing.' },
    ],
  },

  // ── MesaLeads ────────────────────────────────────────────────────────────
  'GET /api/public/mesaleads/forms/:token': {
    tag: 'MesaLeads', operationId: 'getPublicMesaLeadsForm', summary: 'Open a customer questionnaire',
    description: 'Resolves a high-entropy bearer token, checks the organization service entitlement, and reads the published form inside that organization’s RLS scope. Invitations expose only question-keyed prefill values present on that form revision.',
    public: true, params: { token: 'Opaque questionnaire bearer token.' },
    responseDescription: 'Organization branding, the published questions and optional invitation prefill.',
    responseSchema: obj({
      organization: obj({ id: str, name: str, slug: str }),
      form: PUBLIC_LEAD_FORM,
      prefill: { type: 'object', additionalProperties: true },
      link: obj({ kind: str, expiresAt: { type: ['string', 'null'], format: 'date-time' } }),
    }),
    errors: [
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active for the organization.' },
      { status: 404, code: 'not_found', when: 'The token is unknown or its organization is unavailable.' },
      { status: 410, code: 'link_expired', when: 'The link expired.' },
      { status: 410, code: 'link_revoked', when: 'The link was revoked.' },
      { status: 410, code: 'link_submitted', when: 'A one-use invitation was already submitted.' },
      { status: 410, code: 'form_unavailable', when: 'The linked form is no longer published.' },
      { status: 429, code: 'rate_limited', when: 'The client IP exceeded the public request limit for this method.' },
    ],
  },
  'POST /api/public/mesaleads/forms/:token': {
    tag: 'MesaLeads', operationId: 'submitPublicMesaLeadsForm', summary: 'Submit a customer questionnaire',
    description: 'Validates a required client submission key, visible and required typed answers, consent and upload magic bytes. Repeating the same key safely replays the first result; a new generic key creates a lead, while invitation links remain one-use.',
    public: true, status: 201, params: { token: 'Opaque questionnaire bearer token.' },
    responseDescription: 'Submission and lead references.',
    responseSchema: obj({ reference: str, leadId: str, submissionId: str, status: { type: 'string', enum: ['submitted'] } }),
    errors: [
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active for the organization.' },
      { status: 404, code: 'not_found', when: 'The token is unknown.' },
      { status: 410, code: 'link_expired', when: 'The link expired.' },
      { status: 410, code: 'link_revoked', when: 'The link was revoked.' },
      { status: 410, code: 'link_submitted', when: 'A one-use invitation was already submitted.' },
      { status: 422, code: 'invalid_answers', when: 'Required, visible or typed answers are invalid.' },
      { status: 422, code: 'invalid_upload', when: 'An upload exceeds 5 MB or its declared type does not match its content.' },
      { status: 429, code: 'rate_limited', when: 'The client IP exceeded the public request limit for this method.' },
    ],
  },
  'GET /api/public/mesaleads/portal/:token': {
    tag: 'MesaLeads', operationId: 'getPublicMesaLeadsPortal', summary: 'Open a customer journey portal',
    description: 'Resolves a per-lead opaque bearer token (or a consumed invitation), rechecks MesaLeads entitlement and returns an explicit customer-safe projection. Internal contacts, notes, tenancy keys, idempotency keys and acceptance identity are never returned.',
    public: true, params: { token: 'Opaque customer journey bearer token.' },
    responseDescription: 'Customer-safe journey snapshot.', responseSchema: obj({ mode: { type: 'string', enum: ['portal'] }, portal: PUBLIC_PORTAL }),
    errors: [
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' },
      { status: 404, code: 'not_found', when: 'The token is unknown or is not a customer portal token.' },
      { status: 410, code: 'link_expired', when: 'The portal expired.' },
      { status: 410, code: 'link_revoked', when: 'The portal was revoked.' },
      { status: 429, code: 'rate_limited', when: 'The client IP exceeded the public request limit.' },
    ],
  },
  'POST /api/public/mesaleads/portal/:token/decision-challenges': {
    tag: 'MesaLeads', operationId: 'createMesaLeadsDecisionChallenge', summary: 'Start step-up verification for a quote decision',
    description: 'Matches the submitted address without disclosing it and creates a ten-minute, five-attempt, single-use verification challenge. Production availability requires a configured secret and delivery adapter.',
    public: true, status: 202, params: { token: 'Opaque customer journey bearer token.' },
    responseDescription: 'Generic accepted response; development mode may include devVerificationCode.',
    responseSchema: obj({ accepted: { type: 'boolean' }, challengeId: str, expiresAt: { type: 'string', format: 'date-time' }, devVerificationCode: str }),
    errors: [
      { status: 404, code: 'not_found', when: 'The portal token is unknown.' },
      { status: 503, code: 'decision_verification_unavailable', when: 'Step-up verification is not configured.' },
    ],
  },
  'POST /api/public/mesaleads/portal/:token/quotes/:quoteId/decision': {
    tag: 'MesaLeads', operationId: 'decideMesaLeadsQuote', summary: 'Approve or request revision of the current quote',
    description: 'Consumes a valid step-up challenge in the same transaction as the decision. Approval requires explicit acceptance evidence and fails after the validity date. Revision requires a non-empty remark. Replays are request-hash checked.',
    public: true, params: { token: 'Opaque customer journey bearer token.', quoteId: 'Opaque quote action id from the portal.' },
    responseDescription: 'Updated customer-safe journey snapshot.', responseSchema: obj({ mode: { type: 'string', enum: ['portal'] }, portal: PUBLIC_PORTAL }),
    errors: [
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is disabled during the decision.' },
      { status: 404, code: 'not_found', when: 'The portal or quote is unavailable.' },
      { status: 409, code: 'quote_expired', when: 'Approval is attempted after validUntil.' },
      { status: 409, code: 'quote_not_actionable', when: 'The quote is no longer the current sent version.' },
      { status: 409, code: 'version_conflict', when: 'The quote changed since it was shown.' },
      { status: 409, code: 'verification_invalid', when: 'The challenge expired, was used, or exceeded its attempt limit.' },
      { status: 409, code: 'idempotency_conflict', when: 'The key was reused with a different action or body.' },
    ],
  },
  'GET /api/mesaleads/summary': {
    tag: 'MesaLeads', operationId: 'getMesaLeadsSummary', summary: 'Lead dashboard summary',
    responseDescription: 'KPIs, pipeline buckets, overdue attention items and recent leads.',
    responseSchema: obj({
      kpis: obj({ totalLeads: int, openLeads: int, openPipelineValue: num, wonLeads: int, lostLeads: int, overdueFollowUps: int, questionnaireCompletionRate: num }),
      byStage: arr(obj({ stage: str, count: int, value: num })),
      attention: arr(MESA_LEAD), recentLeads: arr(MESA_LEAD),
    }),
    errors: [{ status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active for the caller’s organization.' }],
  },
  'GET /api/mesaleads/attachments/:id': {
    tag: 'MesaLeads', operationId: 'downloadMesaLeadAttachment', summary: 'Download a private lead attachment',
    description: 'Tenant-scoped binary download. The response is restricted to JPG, PNG or PDF, uses a generated storage name internally, forces attachment disposition and sets nosniff/no-store headers.',
    params: { id: 'LeadAttachment id.' }, responseDescription: 'Private attachment bytes.',
    errors: [
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' },
      NOT_FOUND('lead attachment'),
      { status: 409, code: 'attachment_unavailable', when: 'Stored metadata is not an allowed download type.' },
    ],
  },
  'GET /api/mesaleads/leads': {
    tag: 'MesaLeads', operationId: 'listMesaLeads', summary: 'List leads', responseDescription: 'All tenant leads, newest activity first.',
    responseSchema: arr(MESA_LEAD), errors: [{ status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' }],
  },
  'GET /api/mesaleads/leads/:id': {
    tag: 'MesaLeads', operationId: 'getMesaLead', summary: 'Get a lead workspace', params: { id: 'MesaLead id.' },
    responseDescription: 'Lead with submissions, activity and attachment metadata.', responseSchema: MESA_LEAD,
    errors: [NOT_FOUND('MesaLead'), { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' }],
  },
  'POST /api/mesaleads/leads': {
    tag: 'MesaLeads', operationId: 'createMesaLead', summary: 'Create a lead and its customer journey', status: 201,
    description: 'Requires a published questionnaire formId. Creates the lead, freezes the selected form revision into a lead-specific invitation, advances the lead to questionnaire_sent and appends timeline evidence in one transaction. The raw bearer token is returned only once; the same URL becomes the customer portal after submission.',
    responseDescription: 'Created lead and one-time-returned opaque customer link.',
    responseSchema: obj({ lead: MESA_LEAD, link: obj({ id: str, token: str, publicPath: str, kind: { type: 'string', enum: ['invitation'] }, status: { type: 'string', enum: ['active'] }, leadId: str, expiresAt: { type: ['string', 'null'], format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' } }) }),
    errors: [
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' },
      { status: 422, code: 'invalid_owner', when: 'The owner is not an active member of this organization.' },
      { status: 422, code: 'invalid_form', when: 'The selected questionnaire does not exist in this organization.' },
      { status: 422, code: 'invalid_expiry', when: 'A custom link expiry is not in the future.' },
      { status: 409, code: 'form_not_published', when: 'The selected questionnaire is not published.' },
    ],
  },
  'PUT /api/mesaleads/leads/:id': {
    tag: 'MesaLeads', operationId: 'updateMesaLead', summary: 'Update a lead', params: { id: 'MesaLead id.' },
    responseDescription: 'Updated lead; a stage change is recorded in its activity timeline.', responseSchema: MESA_LEAD,
    errors: [
      NOT_FOUND('MesaLead'),
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' },
      { status: 409, code: 'version_conflict', when: 'The submitted version is stale.' },
      { status: 409, code: 'terminal_stage', when: 'A won/lost lead is being reopened.' },
      { status: 422, code: 'lost_reason_required', when: 'The lead is moved to lost without a reason.' },
    ],
  },
  'POST /api/mesaleads/leads/:id/activities': {
    tag: 'MesaLeads', operationId: 'addMesaLeadActivity', summary: 'Log lead activity', status: 201, params: { id: 'MesaLead id.' },
    description: 'Internal activity types may update nextFollowUpAt. The explicit customer_update type accepts nextUpdateAt instead, stores it in allowlisted metadata without changing the internal sales schedule, and is projected to the customer timeline.',
    responseDescription: 'Created internal or explicitly customer-visible activity.', responseModel: 'LeadActivity',
    errors: [NOT_FOUND('MesaLead'), { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' }],
  },
  'POST /api/mesaleads/leads/:id/quotes': {
    tag: 'MesaLeads', operationId: 'createMesaLeadQuote', summary: 'Create a quotation version', status: 201,
    params: { id: 'MesaLead id.' }, description: 'Creates the next monotonic quote version and computes all line/tax totals server-side. With send=true it atomically sends the version and supersedes the prior actionable sent quote.',
    responseDescription: 'Created draft or sent quotation.', responseSchema: QUOTE_RESPONSE,
    errors: [NOT_FOUND('MesaLead'), { status: 409, code: 'idempotency_conflict', when: 'The key was reused for another request.' }, { status: 422, code: 'invalid_discount', when: 'A discount exceeds its line value.' }],
  },
  'PATCH /api/mesaleads/leads/:id/quotes/:quoteId': {
    tag: 'MesaLeads', operationId: 'updateMesaLeadQuote', summary: 'Edit a draft quotation',
    params: { id: 'MesaLead id.', quoteId: 'LeadQuote id.' }, description: 'Optimistic-concurrency update. Sent versions and their line items are immutable.',
    responseDescription: 'Updated draft.', responseSchema: QUOTE_RESPONSE,
    errors: [{ status: 404, code: 'not_found', when: 'The lead or quote does not exist.' }, { status: 409, code: 'quote_immutable', when: 'The quote was sent.' }, { status: 409, code: 'version_conflict', when: 'rowVersion is stale.' }],
  },
  'POST /api/mesaleads/leads/:id/quotes/:quoteId/send': {
    tag: 'MesaLeads', operationId: 'sendMesaLeadQuote', summary: 'Send a draft quotation',
    params: { id: 'MesaLead id.', quoteId: 'LeadQuote id.' }, description: 'Makes commercial content immutable, supersedes a prior actionable sent quote, updates the lead, and appends audit/timeline evidence atomically.',
    responseDescription: 'Sent quotation.', responseSchema: QUOTE_RESPONSE,
    errors: [{ status: 404, code: 'not_found', when: 'The lead or quote does not exist.' }, { status: 409, code: 'quote_immutable', when: 'The quote is not draft.' }, { status: 409, code: 'version_conflict', when: 'rowVersion is stale.' }],
  },
  'POST /api/mesaleads/leads/:id/quotes/:quoteId/revise': {
    tag: 'MesaLeads', operationId: 'reviseMesaLeadQuote', summary: 'Clone a sent quote into the next draft version', status: 201,
    params: { id: 'MesaLead id.', quoteId: 'Source LeadQuote id.' }, description: 'Preserves the sent evidence and creates the next monotonic editable version.',
    responseDescription: 'New draft revision.', responseSchema: QUOTE_RESPONSE,
    errors: [{ status: 404, code: 'not_found', when: 'The lead or quote does not exist.' }, { status: 409, code: 'quote_not_revisable', when: 'The source is not sent or revision requested.' }, { status: 409, code: 'version_conflict', when: 'rowVersion is stale.' }],
  },
  'POST /api/mesaleads/leads/:id/fulfillment': {
    tag: 'MesaLeads', operationId: 'createMesaLeadFulfillment', summary: 'Start customer-visible fulfillment', status: 201,
    params: { id: 'MesaLead id.' }, description: 'Allowed only after quote approval and creates the standard industry milestone set.',
    responseDescription: 'Fulfillment and milestones.', responseSchema: FULFILLMENT_RESPONSE,
    errors: [NOT_FOUND('MesaLead'), { status: 409, code: 'quotation_not_approved', when: 'No quote was approved.' }, { status: 409, code: 'fulfillment_exists', when: 'Fulfillment already exists.' }],
  },
  'PATCH /api/mesaleads/leads/:id/fulfillment': {
    tag: 'MesaLeads', operationId: 'updateMesaLeadFulfillment', summary: 'Update fulfillment status', params: { id: 'MesaLead id.' },
    responseDescription: 'Updated fulfillment and milestones.', responseSchema: FULFILLMENT_RESPONSE,
    errors: [{ status: 404, code: 'not_found', when: 'Fulfillment does not exist.' }, { status: 409, code: 'version_conflict', when: 'rowVersion is stale.' }],
  },
  'POST /api/mesaleads/leads/:id/fulfillment/milestones': {
    tag: 'MesaLeads', operationId: 'createMesaLeadMilestone', summary: 'Add a fulfillment milestone', status: 201, params: { id: 'MesaLead id.' },
    responseDescription: 'Created milestone.', responseSchema: { type: 'object' }, errors: [{ status: 404, code: 'not_found', when: 'Fulfillment does not exist.' }],
  },
  'PATCH /api/mesaleads/leads/:id/fulfillment/milestones/:milestoneId': {
    tag: 'MesaLeads', operationId: 'updateMesaLeadMilestone', summary: 'Update a fulfillment milestone', params: { id: 'MesaLead id.', milestoneId: 'LeadMilestone id.' },
    responseDescription: 'Updated milestone.', responseSchema: { type: 'object' },
    errors: [{ status: 404, code: 'not_found', when: 'The milestone does not exist.' }, { status: 409, code: 'version_conflict', when: 'rowVersion is stale.' }],
  },
  'GET /api/mesaleads/forms': {
    tag: 'MesaLeads', operationId: 'listMesaLeadForms', summary: 'List questionnaire forms',
    responseDescription: 'Forms with ordered questions and link metadata (never token hashes).', responseSchema: arr(LEAD_FORM),
    errors: [{ status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' }],
  },
  'GET /api/mesaleads/forms/:id': {
    tag: 'MesaLeads', operationId: 'getMesaLeadForm', summary: 'Get a questionnaire form', params: { id: 'LeadForm id.' },
    responseDescription: 'Form, ordered questions and safe link metadata.', responseSchema: LEAD_FORM,
    errors: [NOT_FOUND('LeadForm'), { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' }],
  },
  'POST /api/mesaleads/forms': {
    tag: 'MesaLeads', operationId: 'createMesaLeadForm', summary: 'Create a questionnaire draft', status: 201,
    responseDescription: 'Created draft with stable question keys.', responseSchema: LEAD_FORM,
    errors: [
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' },
      { status: 422, code: 'invalid_visibility_rule', when: 'Conditional logic references an unknown or later question.' },
    ],
  },
  'PUT /api/mesaleads/forms/:id': {
    tag: 'MesaLeads', operationId: 'updateMesaLeadForm', summary: 'Update a questionnaire draft', params: { id: 'LeadForm id.' },
    responseDescription: 'Updated draft with replaced questions when supplied.', responseSchema: LEAD_FORM,
    errors: [
      NOT_FOUND('LeadForm'),
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' },
      { status: 409, code: 'form_immutable', when: 'The form was published or archived.' },
    ],
  },
  'POST /api/mesaleads/forms/:id/publish': {
    tag: 'MesaLeads', operationId: 'publishMesaLeadForm', summary: 'Publish a questionnaire', params: { id: 'LeadForm id.' },
    responseDescription: 'Immutable published form and a newly-created reusable generic customer link.',
    responseSchema: obj({ form: LEAD_FORM, link: obj({ id: str, token: str, publicPath: str, kind: str, status: str, expiresAt: { type: ['string', 'null'] } }) }),
    errors: [
      NOT_FOUND('LeadForm'),
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' },
      { status: 409, code: 'already_published', when: 'The form is not a draft.' },
      { status: 422, code: 'empty_form', when: 'The form has no answerable questions.' },
    ],
  },
  'POST /api/mesaleads/forms/:id/clone': {
    tag: 'MesaLeads', operationId: 'cloneMesaLeadFormRevision', summary: 'Create the next editable form revision', status: 201,
    params: { id: 'Source LeadForm id.' },
    description: 'Copies the questions and configuration into a new draft in the same form family. Published forms and their links remain immutable.',
    responseDescription: 'The next numbered draft revision.', responseSchema: LEAD_FORM,
    errors: [NOT_FOUND('LeadForm'), { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' }],
  },
  'POST /api/mesaleads/forms/:id/archive': {
    tag: 'MesaLeads', operationId: 'archiveMesaLeadForm', summary: 'Archive a questionnaire form',
    params: { id: 'LeadForm id.' },
    description: 'Archives the form and revokes every active public link in the same transaction.',
    responseDescription: 'The archived form.', responseSchema: LEAD_FORM,
    errors: [
      NOT_FOUND('LeadForm'),
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' },
      { status: 409, code: 'already_archived', when: 'The form was already archived.' },
    ],
  },
  'POST /api/mesaleads/forms/:id/links': {
    tag: 'MesaLeads', operationId: 'createMesaLeadFormLink', summary: 'Create a customer form link', status: 201, params: { id: 'LeadForm id.' },
    description: 'Creates either a reusable generic link (30-day default expiry) or a one-use invitation tied to a lead (14-day default expiry). Invitations append a timeline event and move new/discovery leads to questionnaire_sent. The raw bearer token is returned only in this response.',
    responseDescription: 'Opaque token and public SPA path.',
    responseSchema: obj({ id: str, token: str, publicPath: str, kind: str, status: str, leadId: { type: ['string', 'null'] }, expiresAt: { type: ['string', 'null'] } }),
    errors: [
      NOT_FOUND('LeadForm'),
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' },
      { status: 409, code: 'form_not_published', when: 'The form is not published.' },
      { status: 409, code: 'journey_link_exists', when: 'The lead already has an active or submitted customer journey link.' },
      { status: 422, code: 'invalid_lead', when: 'The invitation lead is outside this organization.' },
      { status: 422, code: 'invalid_expiry', when: 'Expiry is not in the future.' },
    ],
  },
  'POST /api/mesaleads/form-links/:id/revoke': {
    tag: 'MesaLeads', operationId: 'revokeMesaLeadFormLink', summary: 'Revoke a customer questionnaire link',
    params: { id: 'LeadFormLink id.' },
    description: 'Immediately invalidates one generic or invitation bearer token. The organization id is always taken from the authenticated tenant.',
    responseDescription: 'Safe metadata for the revoked link.',
    responseSchema: obj({ id: str, kind: str, status: str, leadId: { type: ['string', 'null'] }, expiresAt: { type: ['string', 'null'] }, openedAt: { type: ['string', 'null'] }, usedAt: { type: ['string', 'null'] } }),
    errors: [
      { status: 403, code: 'service_not_enabled', when: 'MesaLeads is not active.' },
      { status: 404, code: 'not_found', when: 'The link does not belong to this organization.' },
      { status: 409, code: 'link_not_revocable', when: 'The link is not active or submitted.' },
    ],
  },

  // ── Sales ─────────────────────────────────────────────────────────────────
  'GET /api/members': {
    tag: 'Sales',
    operationId: 'listMembers',
    summary: 'List organization members',
    responseDescription: 'Members of the caller’s organization.',
    responseModel: 'Membership', responseIsArray: true, responseIncludes: ['user'],
  },
  'GET /api/customers': {
    tag: 'Sales',
    operationId: 'listCustomers',
    summary: 'List customers',
    responseDescription: 'All customers in the caller’s organization.',
    responseModel: 'Customer', responseIsArray: true,
  },
  'POST /api/customers': {
    tag: 'Sales',
    operationId: 'createCustomer',
    summary: 'Create a customer',
    description: 'GST numbers are unique per organization when supplied.',
    status: 201,
    responseDescription: 'The created customer.',
    responseModel: 'Customer',
    errors: [{ status: 409, code: 'gst_taken', when: 'Another customer already holds that GST number.' }],
  },
  'GET /api/inquiries': {
    tag: 'Sales',
    operationId: 'listInquiries',
    summary: 'List inquiries',
    responseDescription: 'All inquiries with their customer.',
    responseModel: 'Inquiry', responseIsArray: true, responseIncludes: ['customer'],
  },
  'POST /api/inquiries': {
    tag: 'Sales',
    operationId: 'createInquiry',
    summary: 'Raise an inquiry',
    status: 201,
    responseDescription: 'The created inquiry.',
    responseModel: 'Inquiry',
    errors: [{ status: 422, code: 'bad_customer', when: 'The referenced customer does not exist.' }],
  },
  'POST /api/inquiries/:id/quote': {
    tag: 'Sales',
    operationId: 'quoteInquiry',
    summary: 'Quote an inquiry',
    description: 'Prices an inquiry and moves it to `quoted`, making it eligible to become an order.',
    params: { id: 'Inquiry id.' },
    responseDescription: 'The quoted inquiry.',
    responseModel: 'Inquiry',
    errors: [NOT_FOUND('inquiry'), { status: 409, code: 'already_ordered', when: 'The inquiry has already been converted to an order.' }],
  },
  'GET /api/orders': {
    tag: 'Sales',
    operationId: 'listOrders',
    summary: 'List sales orders',
    responseDescription: 'All sales orders with their customer and inquiry.',
    responseModel: 'SalesOrder', responseIsArray: true, responseIncludes: ['customer', 'inquiry'],
  },
  'POST /api/orders': {
    tag: 'Sales',
    operationId: 'confirmOrder',
    summary: 'Confirm a quoted inquiry as an order',
    description: 'Mints the `SO-` number server-side and guards against a second order for the same inquiry.',
    status: 201,
    responseDescription: 'The confirmed sales order.',
    responseModel: 'SalesOrder',
    errors: [
      NOT_FOUND('inquiry'),
      { status: 409, code: 'not_quotable', when: 'The inquiry has not been quoted yet.' },
      { status: 409, code: 'already_ordered', when: 'The inquiry already has a sales order.' },
    ],
  },
  'POST /api/orders/:id/cancel': {
    tag: 'Sales',
    operationId: 'cancelOrder',
    summary: 'Cancel a pending order',
    params: { id: 'Sales order id.' },
    responseDescription: 'The cancelled order.',
    responseModel: 'SalesOrder',
    errors: [NOT_FOUND('order'), { status: 409, code: 'not_cancellable', when: 'The order has already moved past `pending`.' }],
  },

  // ── Maintenance ───────────────────────────────────────────────────────────
  'GET /api/machines': {
    tag: 'Maintenance',
    operationId: 'listMachines',
    summary: 'List machines',
    description: 'Reference data, readable by any signed-in member.',
    responseDescription: 'The machine registry.',
    responseModel: 'Machine', responseIsArray: true,
  },
  'POST /api/machines': {
    tag: 'Maintenance',
    operationId: 'createMachine',
    summary: 'Register a machine',
    status: 201,
    responseDescription: 'The created machine.',
    responseModel: 'Machine',
    errors: [{ status: 409, code: 'code_taken', when: 'A machine with that code already exists in this organization.' }],
  },
  'GET /api/maintenance': {
    tag: 'Maintenance',
    operationId: 'listMaintenanceTasks',
    summary: 'List maintenance tasks',
    responseDescription: 'The preventive maintenance schedule.',
    responseModel: 'MaintenanceTask', responseIsArray: true,
  },
  'POST /api/maintenance': {
    tag: 'Maintenance',
    operationId: 'createMaintenanceTask',
    summary: 'Schedule a maintenance task',
    status: 201,
    responseDescription: 'The scheduled task.',
    responseModel: 'MaintenanceTask',
    errors: [{ status: 422, code: 'bad_machine', when: 'The referenced machine does not exist.' }],
  },
  'POST /api/maintenance/:id/complete': {
    tag: 'Maintenance',
    operationId: 'completeMaintenanceTask',
    summary: 'Mark a maintenance task complete',
    params: { id: 'Maintenance task id.' },
    responseDescription: 'The completed task.',
    responseModel: 'MaintenanceTask',
    errors: [NOT_FOUND('maintenance task')],
  },

  // ── Planning ──────────────────────────────────────────────────────────────
  'GET /api/planning/orders': {
    tag: 'Planning',
    operationId: 'listOrdersToPlan',
    summary: 'List orders awaiting planning',
    description: 'Confirmed orders still in `pending`, soonest delivery date first.',
    responseDescription: 'The planning queue.',
    responseModel: 'SalesOrder', responseIsArray: true, responseIncludes: ['customer'],
  },
  'GET /api/planning/operators': {
    tag: 'Planning',
    operationId: 'listOperators',
    summary: 'List assignable operators',
    responseDescription: 'Active operators in the caller’s organization.',
    responseModel: 'Membership', responseIsArray: true, responseIncludes: ['user'],
  },
  'GET /api/plans': {
    tag: 'Planning',
    operationId: 'listPlans',
    summary: 'List production plans',
    responseDescription: 'Production plans with machine, order and customer.',
    responseModel: 'ProductionPlan', responseIsArray: true, responseIncludes: ['machine', 'salesOrder'],
  },
  'POST /api/plans': {
    tag: 'Planning',
    operationId: 'createPlan',
    summary: 'Schedule an order onto a machine and shift',
    description: 'Moves the order to `planned`, records the Machine Identification & Shift Header, and seeds a draft logbook. One machine can hold only one plan per shift per day.',
    status: 201,
    responseDescription: 'The scheduled plan.',
    responseModel: 'ProductionPlan', responseIncludes: ['machine', 'salesOrder', 'logbook'],
    errors: [
      NOT_FOUND('order'),
      { status: 409, code: 'not_plannable', when: 'The order is not awaiting planning.' },
      { status: 409, code: 'double_booked', when: 'That machine, shift and day are already booked.' },
      { status: 422, code: 'bad_machine', when: 'The referenced machine does not exist.' },
    ],
  },
  'PATCH /api/plans/:id': {
    tag: 'Planning',
    operationId: 'updatePlan',
    summary: 'Edit a scheduled plan until start time',
    description: 'Allowed only while the plan is `scheduled`, its start time is still in the future, and the linked logbook is not submitted. Syncs the draft logbook header.',
    params: { id: 'Production plan id.' },
    responseDescription: 'The updated plan.',
    responseModel: 'ProductionPlan', responseIncludes: ['machine', 'salesOrder', 'logbook'],
    errors: [
      NOT_FOUND('plan'),
      { status: 409, code: 'plan_locked', when: 'The plan is not scheduled or its logbook is submitted.' },
      { status: 409, code: 'already_started', when: 'The schedule start time has passed.' },
      { status: 409, code: 'double_booked', when: 'That machine, shift and day are already booked.' },
    ],
  },
  'POST /api/plans/:id/release': {
    tag: 'Planning',
    operationId: 'releasePlan',
    summary: 'Release a plan back to the queue',
    description: 'Deletes the plan (and its draft logbook) and returns its order to `pending`.',
    params: { id: 'Production plan id.' },
    responseDescription: 'Confirmation that the plan was released.',
    responseSchema: ACK,
    errors: [
      NOT_FOUND('plan'),
      { status: 409, code: 'plan_locked', when: 'The logbook is already submitted.' },
    ],
  },

  // ── Manufacturing ─────────────────────────────────────────────────────────
  'GET /api/logbook/templates': {
    tag: 'Manufacturing',
    operationId: 'listLogbookTemplates',
    summary: 'List logbook templates',
    description: 'Reference data, readable by any signed-in member.',
    responseDescription: 'Templates that shape the operator sheet.',
    responseModel: 'LogbookTemplate', responseIsArray: true,
  },
  'GET /api/logbook/plans': {
    tag: 'Manufacturing',
    operationId: 'listPlansToLog',
    summary: 'List plans ready to log',
    responseDescription: 'Plans an operator can open a logbook against.',
    responseModel: 'ProductionPlan', responseIsArray: true, responseIncludes: ['machine', 'salesOrder', 'logbook'],
  },
  'GET /api/logbook/formulas': {
    tag: 'Manufacturing',
    operationId: 'listActiveFormulas',
    summary: 'List active formulations',
    description: 'Fills the Formula No field on the operator sheet.',
    responseDescription: 'Active formulations, identity fields only.',
    responseModel: 'Formulation', responseIsArray: true, responseFields: ['id', 'code', 'rev', 'product'],
  },
  'GET /api/logbook/tasks': {
    tag: 'Manufacturing',
    operationId: 'listMachineTasks',
    summary: 'List machine tasks',
    description: 'Scheduled and running plans grouped by machine, for the Machine Tasks screen.',
    responseDescription: 'One entry per machine that has work on it.',
    responseSchema: arr(obj({ machine: str, line: str, tasks: arr({ $ref: '#/components/schemas/ProductionPlan' }) })),
  },
  'GET /api/logbook/resolve': {
    tag: 'Manufacturing',
    operationId: 'resolveMachineLogbook',
    summary: 'Resolve machine QR to active plan',
    description: 'Given a machine code from a floor QR scan (`?machine=M08`), returns the best active plan to open (prefers draft / not-started over submitted).',
    responseDescription: 'Machine identity plus planId when an active shift exists.',
    responseSchema: obj({
      reason: str,
      machine: obj({ id: str, code: str, line: str }),
      planId: { type: 'string', nullable: true },
      logStatus: { type: 'string', nullable: true },
    }),
    errors: [NOT_FOUND('machine')],
  },
  'GET /api/logbook/machine-hub': {
    tag: 'Manufacturing',
    operationId: 'getMachineLogbookHub',
    summary: 'Get the operator machine hub',
    description: 'Given a machine code (`?machine=M08`), returns its registry status, active plans, recent logbooks and maintenance work for the floor operator view.',
    responseDescription: 'The machine workspace and its current operating context.',
    responseSchema: obj({
      machine: obj({
        id: str, code: str, line: str, family: str, logbookFormat: str, status: str,
        statusReason: str, currentProduct: str, currentFormula: str, currentLot: str,
      }),
      started: { type: 'boolean' },
      activePlan: { type: ['object', 'null'] },
      activePlans: arr({ type: 'object' }),
      logbooks: arr({ type: 'object' }),
      maintenance: arr({ type: 'object' }),
    }),
    errors: [
      { status: 400, code: 'bad_request', when: 'The machine query parameter is missing.' },
      NOT_FOUND('machine'),
    ],
  },
  'POST /api/logbook/templates': {
    tag: 'Manufacturing',
    operationId: 'createLogbookTemplate',
    summary: 'Create a logbook template',
    status: 201,
    responseDescription: 'The created template.',
    responseModel: 'LogbookTemplate',
  },
  'PATCH /api/logbook/templates/:id': {
    tag: 'Manufacturing',
    operationId: 'updateLogbookTemplate',
    summary: 'Update a logbook template',
    params: { id: 'Template id.' },
    responseDescription: 'The updated template.',
    responseModel: 'LogbookTemplate',
    errors: [NOT_FOUND('template')],
  },
  'DELETE /api/logbook/templates/:id': {
    tag: 'Manufacturing',
    operationId: 'deleteLogbookTemplate',
    summary: 'Delete a logbook template',
    params: { id: 'Template id.' },
    responseDescription: 'Confirmation that the template was deleted.',
    responseSchema: ACK,
    errors: [NOT_FOUND('template'), { status: 409, code: 'in_use', when: 'Logbooks or plans still reference the template.' }],
  },
  'GET /api/logbook/ledger': {
    tag: 'Manufacturing',
    operationId: 'listLogbookLedger',
    summary: 'Submitted logbook ledger',
    description: 'Read-only history of submitted logbooks with a production summary and chart series. Optional `from` / `to` query params (YYYY-MM-DD) filter by log date.',
    responseDescription: 'Summary strip, chart series, and thin ledger rows.',
    responseSchema: obj({
      summary: obj({
        submitted: int,
        producedKg: { type: 'number' },
        consumedKg: { type: 'number' },
        wasteKg: { type: 'number' },
        rolls: { type: 'number' },
        machines: int,
        shifts: arr(str),
        yieldPct: { type: 'number' },
      }),
      charts: obj({
        byDay: arr(obj({ date: str, producedKg: { type: 'number' }, consumedKg: { type: 'number' }, wasteKg: { type: 'number' }, count: int })),
        byMachine: arr(obj({ label: str, producedKg: { type: 'number' }, count: int })),
      }),
      rows: arr(obj({
        id: str, machineId: str, date: str, isoDate: str, shift: str, productName: str, formulaNo: str,
        totalRollsProduced: str, totalRollKgs: str, totalConsumedKg: str, rejectionKg: str,
        operatorSignature: str, supervisor: str, soNumber: str, productionPlanId: str,
      })),
    }),
  },
  'GET /api/logbooks/plan/:planId': {
    tag: 'Manufacturing',
    operationId: 'getLogbookForPlan',
    summary: 'Get the logbook for a plan',
    description: 'Returns `null` until a logbook has been opened for the plan.',
    params: { planId: 'Production plan id.' },
    responseDescription: 'The plan’s logbook, or null.',
    responseModel: 'MachineLogbook', responseNullable: true,
  },
  'POST /api/logbooks': {
    tag: 'Manufacturing',
    operationId: 'openLogbook',
    summary: 'Open a logbook for a plan',
    description: 'Get-or-create: calling it twice for the same plan returns the existing draft rather than a duplicate.',
    status: 201,
    responseDescription: 'The draft logbook.',
    responseModel: 'MachineLogbook',
    errors: [
      NOT_FOUND('production plan'),
      { status: 409, code: 'not_schedulable', when: 'The plan is not active.' },
      { status: 422, code: 'no_template', when: 'No logbook template is configured.' },
    ],
  },
  'PATCH /api/logbooks/:id': {
    tag: 'Manufacturing',
    operationId: 'updateLogbook',
    summary: 'Save logbook edits',
    params: { id: 'Logbook id.' },
    responseDescription: 'The updated logbook.',
    responseModel: 'MachineLogbook',
    errors: [NOT_FOUND('logbook'), { status: 409, code: 'locked', when: 'The logbook is submitted and no longer editable.' }],
  },
  'POST /api/logbooks/:id/submit': {
    tag: 'Manufacturing',
    operationId: 'submitLogbook',
    summary: 'Submit and lock a logbook',
    description: 'Locks the sheet and releases its packed rolls into the quality inspection queue.',
    params: { id: 'Logbook id.' },
    responseDescription: 'The submitted logbook.',
    responseModel: 'MachineLogbook',
    errors: [
      NOT_FOUND('logbook'),
      { status: 409, code: 'already_submitted', when: 'The logbook has already been submitted.' },
      { status: 422, code: 'no_signoff', when: 'The operator has not signed the sheet.' },
    ],
  },

  // ── Quality ───────────────────────────────────────────────────────────────
  'GET /api/quality/queue': {
    tag: 'Quality',
    operationId: 'listInspectionQueue',
    summary: 'List rolls awaiting inspection',
    description: 'Packed rolls from submitted logbooks that have not been inspected yet.',
    responseDescription: 'The inspection queue.',
    responseSchema: arr(obj({ lotNumber: str, colour: str, code: str, machineId: str, date: str, product: str })),
  },
  'GET /api/quality/inspections': {
    tag: 'Quality',
    operationId: 'listInspections',
    summary: 'List inspection history',
    responseDescription: 'Past inspections, newest first.',
    responseModel: 'QualityInspection', responseIsArray: true,
  },
  'POST /api/quality/inspections': {
    tag: 'Quality',
    operationId: 'createInspection',
    summary: 'Record a QA decision',
    description: 'A `pass` books the roll as finished-goods stock in the same transaction, which is what makes it dispatchable.',
    status: 201,
    responseDescription: 'The recorded inspection.',
    responseModel: 'QualityInspection',
    errors: [
      { status: 409, code: 'already_inspected', when: 'That lot has already been inspected.' },
      { status: 422, code: 'unknown_lot', when: 'That lot is not a packed roll awaiting inspection.' },
    ],
  },

  // ── Dispatch ──────────────────────────────────────────────────────────────
  'GET /api/dispatch/ready': {
    tag: 'Dispatch',
    operationId: 'listReadyOrders',
    summary: 'List orders ready to ship',
    description: 'Orders whose production logbook is submitted and that have not shipped yet.',
    responseDescription: 'Dispatch-ready orders.',
    responseModel: 'SalesOrder', responseIsArray: true, responseIncludes: ['customer'],
  },
  'GET /api/dispatches': {
    tag: 'Dispatch',
    operationId: 'listDispatches',
    summary: 'List dispatch history',
    responseDescription: 'Dispatch records, newest first.',
    responseModel: 'DispatchRecord', responseIsArray: true, responseIncludes: ['salesOrder'],
  },
  'POST /api/dispatches': {
    tag: 'Dispatch',
    operationId: 'createDispatch',
    summary: 'Dispatch an order',
    description: 'One transaction: mints the invoice number, creates the dispatch record, moves the order to `dispatched` and books the finished-goods OUT movement.',
    status: 201,
    responseDescription: 'The dispatch record, including its invoice number.',
    responseModel: 'DispatchRecord', responseIncludes: ['salesOrder'],
    errors: [
      NOT_FOUND('order'),
      { status: 409, code: 'already_dispatched', when: 'The order has already shipped.' },
      { status: 409, code: 'not_ready', when: 'The order’s production logbook has not been submitted.' },
    ],
  },

  // ── Inventory ─────────────────────────────────────────────────────────────
  'GET /api/inventory/stock': {
    tag: 'Inventory',
    operationId: 'listStock',
    summary: 'Get on-hand stock',
    description: 'Balances derived from the ledger (in − out), split into raw materials and finished goods.',
    responseDescription: 'On-hand balances per material and unit.',
    responseSchema: (() => {
      const row = obj({ itemName: str, unit: str, onHand: num });
      return obj({ rawMaterials: arr(row), finishedGoods: arr(row) });
    })(),
  },
  'GET /api/inventory/transactions': {
    tag: 'Inventory',
    operationId: 'listInventoryTransactions',
    summary: 'List the stock ledger',
    responseDescription: 'Inventory movements.',
    responseModel: 'InventoryTransaction', responseIsArray: true,
  },
  'POST /api/inventory/receive': {
    tag: 'Inventory',
    operationId: 'receiveMaterial',
    summary: 'Receive raw material',
    status: 201,
    responseDescription: 'The booked IN movement.',
    responseModel: 'InventoryTransaction',
  },
  'POST /api/inventory/issue': {
    tag: 'Inventory',
    operationId: 'issueMaterial',
    summary: 'Issue raw material to a machine',
    description: 'Refuses to drive a balance negative.',
    status: 201,
    responseDescription: 'The booked OUT movement.',
    responseModel: 'InventoryTransaction',
    errors: [
      { status: 409, code: 'insufficient_stock', when: 'The issued quantity exceeds what is on hand.' },
      { status: 422, code: 'bad_machine', when: 'The referenced machine does not exist.' },
    ],
  },

  // ── CAPA ──────────────────────────────────────────────────────────────────
  'GET /api/complaints/batches': {
    tag: 'CAPA',
    operationId: 'listComplaintBatches',
    summary: 'List dispatched batches',
    description: 'The batches a complaint can be raised against.',
    responseDescription: 'Dispatched batches with their order and customer.',
    responseModel: 'DispatchRecord', responseIsArray: true, responseIncludes: ['salesOrder'],
  },
  'GET /api/complaints': {
    tag: 'CAPA',
    operationId: 'listComplaints',
    summary: 'List complaints',
    responseDescription: 'Complaints, each with its customer and linked CAPA.',
    responseModel: 'Complaint', responseIsArray: true, responseIncludes: ['customer', 'capa'],
  },
  'POST /api/complaints': {
    tag: 'CAPA',
    operationId: 'createComplaint',
    summary: 'Log a complaint',
    description: 'Auto-opens a linked CAPA whose due date follows the severity SLA: 3 days for high, 7 for medium, 14 for low.',
    status: 201,
    responseDescription: 'The complaint together with its auto-created CAPA.',
    responseModel: 'Complaint', responseIncludes: ['capa'],
    errors: [{ status: 422, code: 'not_dispatched', when: 'The order has not been dispatched, so there is no batch to complain about.' }],
  },
  'POST /api/complaints/:id/resolve': {
    tag: 'CAPA',
    operationId: 'resolveComplaint',
    summary: 'Resolve a complaint',
    description: 'Only permitted once the linked CAPA is closed.',
    params: { id: 'Complaint id.' },
    responseDescription: 'The resolved complaint.',
    responseModel: 'Complaint',
    errors: [
      NOT_FOUND('complaint'),
      { status: 409, code: 'already_resolved', when: 'The complaint is already resolved.' },
      { status: 409, code: 'capa_open', when: 'The linked CAPA is still open.' },
    ],
  },
  'GET /api/capas': {
    tag: 'CAPA',
    operationId: 'listCapas',
    summary: 'List CAPA tickets',
    responseDescription: 'CAPA tickets, newest first.',
    responseModel: 'CAPARecord', responseIsArray: true,
  },
  'PATCH /api/capas/:id': {
    tag: 'CAPA',
    operationId: 'updateCapa',
    summary: 'Update a CAPA',
    description: 'Any edit moves the ticket to `in_progress`.',
    params: { id: 'CAPA id.' },
    responseDescription: 'The updated CAPA.',
    responseModel: 'CAPARecord',
    errors: [NOT_FOUND('CAPA'), { status: 409, code: 'closed', when: 'The CAPA is closed and no longer editable.' }],
  },
  'POST /api/capas/:id/close': {
    tag: 'CAPA',
    operationId: 'closeCapa',
    summary: 'Close a CAPA',
    description: 'Root cause, corrective action and preventive action must all be filled in first.',
    params: { id: 'CAPA id.' },
    responseDescription: 'The closed CAPA.',
    responseModel: 'CAPARecord',
    errors: [
      NOT_FOUND('CAPA'),
      { status: 409, code: 'already_closed', when: 'The CAPA is already closed.' },
      { status: 422, code: 'incomplete', when: 'Root cause, corrective action or preventive action is still blank.' },
    ],
  },

  // ── Formulations ──────────────────────────────────────────────────────────
  'GET /api/formulations': {
    tag: 'Formulations',
    operationId: 'listFormulations',
    summary: 'List formulations',
    responseDescription: 'Formulations with their components.',
    responseModel: 'Formulation', responseIsArray: true,
  },
  'POST /api/formulations': {
    tag: 'Formulations',
    operationId: 'createFormulation',
    summary: 'Create a formulation',
    status: 201,
    responseDescription: 'The created formulation.',
    responseModel: 'Formulation',
  },
  'PATCH /api/formulations/:id': {
    tag: 'Formulations',
    operationId: 'updateFormulation',
    summary: 'Update a formulation',
    params: { id: 'Formulation id.' },
    responseDescription: 'The updated formulation.',
    responseModel: 'Formulation',
    errors: [NOT_FOUND('formulation'), { status: 409, code: 'locked', when: 'The revision is locked and cannot be edited.' }],
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────
  'GET /api/summary': {
    tag: 'Dashboard',
    operationId: 'getDashboardSummary',
    summary: 'Get dashboard KPIs',
    description: 'Aggregates across the value chain for the per-role home screens. All counts are tenant-scoped.',
    responseDescription: 'KPI aggregates.',
    responseSchema: obj({
      orders: obj({ pending: int, planned: int, dispatched: int }),
      inquiriesOpen: int,
      plans: obj({ scheduled: int, running: int }),
      logbooksSubmitted: int,
      complaintsOpen: int,
      capasOpen: int,
      customers: int,
      maintenanceOpen: int,
      stock: obj({ rawMaterialKg: int, finishedGoodsKg: int }),
    }),
  },
  'GET /api/management/overview': {
    tag: 'Dashboard',
    operationId: 'getManagementOverview',
    summary: 'Managing Director plant overview',
    description: 'Live production, scrap, on-time delivery, complaints, QA/dispatch queues and alerts for the MD management dashboard. No financial figures. Requires screen:management_dashboard.',
    responseDescription: 'Management overview payload.',
    responseSchema: obj({
      context: obj({ shift: { type: 'string', enum: ['D', 'N'] }, asOf: str }),
      kpis: obj({
        productionKg: obj({ value: num, trendPct: { type: ['number', 'null'] }, vs: str }),
        scrapRatePct: obj({ value: num, trendPct: { type: ['number', 'null'] }, vs: str }),
        onTimeDeliveryPct: obj({ value: num, trendPct: { type: ['number', 'null'] }, vs: str }),
        complaints: obj({ open: int, high: int, medium: int, low: int }),
      }),
      productionSeries: arr(obj({ date: str, productionKg: num, scrapKg: num })),
      feedbackOpen: arr(obj({ rank: int, title: str, occurrences: int, openCount: int })),
      queues: obj({
        qa: obj({ waitingRolls: int, alerts: arr(str), actions: arr(str) }),
        dispatch: obj({ vehicles: int, alerts: arr(str), actions: arr(str) }),
      }),
      alerts: arr(obj({
        id: str,
        severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
        message: str,
        href: str,
      })),
    }),
  },

  // ── Administration ────────────────────────────────────────────────────────
  'GET /api/me/permissions': {
    tag: 'Administration',
    operationId: 'getMyPermissions',
    summary: 'Get the caller’s effective access',
    description: 'Role screens ± per-employee grants. The client gates its menu on this; the server enforces the same policy independently.',
    responseDescription: 'The caller’s admin flag and screen list.',
    responseSchema: obj({ isAdmin: { type: 'boolean' }, screens: arr(str) }),
  },
  'GET /api/directory': {
    tag: 'Administration',
    operationId: 'listDirectory',
    summary: 'List the member directory',
    description: 'Backs the login picker and role switcher, so it is readable by any authenticated member.',
    responseDescription: 'The member roster.',
    responseSchema: arr(obj({ id: str, name: str, email: str, role: str, employeeCode: str, department: str })),
  },
  'GET /api/screens': {
    tag: 'Administration',
    operationId: 'listScreens',
    summary: 'List the screen catalog',
    description: 'Every feature key that can be granted, for the roles editor.',
    responseDescription: 'The catalog of screen keys.',
    responseSchema: obj({ screens: arr(str) }),
  },
  'GET /api/employees': {
    tag: 'Administration',
    operationId: 'listEmployees',
    summary: 'List employees',
    responseDescription: 'Employees in the caller’s organization.',
    responseModel: 'Membership', responseIsArray: true, responseIncludes: ['user'],
  },
  'POST /api/employees': {
    tag: 'Administration',
    operationId: 'createEmployee',
    summary: 'Add an employee',
    status: 201,
    responseDescription: 'The created employee membership.',
    responseModel: 'Membership', responseIncludes: ['user'],
    errors: [
      { status: 409, code: 'already_member', when: 'That person is already an employee of this organization.' },
      { status: 422, code: 'bad_role', when: 'The referenced role does not exist in this organization.' },
    ],
  },
  'PATCH /api/employees/:id': {
    tag: 'Administration',
    operationId: 'updateEmployee',
    summary: 'Update an employee',
    params: { id: 'Membership id.' },
    responseDescription: 'The updated employee.',
    responseModel: 'Membership', responseIncludes: ['user'],
    errors: [NOT_FOUND('employee'), { status: 422, code: 'bad_role', when: 'The referenced role does not exist in this organization.' }],
  },
  'POST /api/employees/:id/password': {
    tag: 'Administration',
    operationId: 'setEmployeePassword',
    summary: 'Set an employee’s login password',
    description: 'Stores a bcrypt hash on the linked User when that identity belongs only to the caller’s organization. Shared global identities must manage credentials at platform scope.',
    params: { id: 'Membership id.' },
    responseDescription: 'Password updated.',
    responseSchema: ACK,
    errors: [
      NOT_FOUND('employee'),
      { status: 409, code: 'shared_identity_password', when: 'The linked global identity belongs to more than one organization.' },
    ],
  },
  'GET /api/roles': {
    tag: 'Administration',
    operationId: 'listRoles',
    summary: 'List roles',
    responseDescription: 'Built-in and custom roles, each with a count of the employees on it.',
    responseModel: 'Role', responseIsArray: true, responseIncludes: ['_count'],
  },
  'POST /api/roles': {
    tag: 'Administration',
    operationId: 'createRole',
    summary: 'Create a custom role',
    status: 201,
    responseDescription: 'The created role.',
    responseModel: 'Role',
    errors: [{ status: 409, code: 'name_taken', when: 'A role with that name already exists.' }],
  },
  'PATCH /api/roles/:id': {
    tag: 'Administration',
    operationId: 'updateRole',
    summary: 'Update a role',
    params: { id: 'Role id.' },
    responseDescription: 'The updated role.',
    responseModel: 'Role',
    errors: [
      NOT_FOUND('role'),
      { status: 409, code: 'system_role', when: 'Built-in roles cannot be renamed.' },
      { status: 409, code: 'name_taken', when: 'A role with that name already exists.' },
    ],
  },
  'DELETE /api/roles/:id': {
    tag: 'Administration',
    operationId: 'deleteRole',
    summary: 'Delete a custom role',
    params: { id: 'Role id.' },
    responseDescription: 'Confirmation that the role was deleted.',
    responseSchema: ACK,
    errors: [
      NOT_FOUND('role'),
      { status: 409, code: 'system_role', when: 'Built-in roles cannot be deleted.' },
      { status: 409, code: 'role_in_use', when: 'Employees are still assigned to the role.' },
    ],
  },
  'GET /api/employees/:id/grants': {
    tag: 'Administration',
    operationId: 'listEmployeeGrants',
    summary: 'List an employee’s screen overrides',
    params: { id: 'Membership id.' },
    responseDescription: 'Per-employee grants layered over the role.',
    responseModel: 'EmployeeGrant', responseIsArray: true,
    errors: [NOT_FOUND('employee')],
  },
  'PUT /api/employees/:id/grants': {
    tag: 'Administration',
    operationId: 'setEmployeeGrants',
    summary: 'Replace an employee’s screen overrides',
    description: 'Full replacement — grants not present in the body are removed.',
    params: { id: 'Membership id.' },
    responseDescription: 'The stored grants.',
    responseModel: 'EmployeeGrant', responseIsArray: true,
    errors: [NOT_FOUND('employee')],
  },

  // ── Legacy ────────────────────────────────────────────────────────────────
  'GET /api/data': {
    tag: 'Legacy',
    operationId: 'getLegacyBlob',
    summary: 'Read the legacy blob store',
    description: 'Returns the shared transitional data.json document for a signed-in organization with an active MesaOps entitlement. The blob is not tenant-partitioned; keep it only for screens not yet migrated to Postgres and do not build against it.',
    responseDescription: 'The blob store, keyed by domain.',
    responseSchema: { type: 'object', additionalProperties: true },
    errors: [{ status: 403, code: 'service_not_enabled', when: 'MesaOps is not active for the caller\'s organization.' }],
    deprecated: true,
  },
  'POST /api/data': {
    tag: 'Legacy',
    operationId: 'writeLegacyBlob',
    summary: 'Shallow-merge into the legacy blob store',
    description: 'For a signed-in organization with active MesaOps, merges the posted keys over the shared transitional document. It is not tenant-partitioned, and last writer wins with no locking — the clobbering hazard that migrating each domain to a real resource removes.',
    responseDescription: 'Write acknowledgement.',
    responseSchema: obj({ success: { type: 'boolean' } }),
    errors: [{ status: 403, code: 'service_not_enabled', when: 'MesaOps is not active for the caller\'s organization.' }],
    deprecated: true,
  },
};
