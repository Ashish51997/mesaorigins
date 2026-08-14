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
  /** Query-string parameters and their generated-client contract. */
  query?: Record<string, {
    description: string;
    required?: boolean;
    schema?: Record<string, unknown>;
  }>;
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
  { name: 'Dispatch', description: 'Shipping produced orders: dispatch record, document reference and the finished-goods stock movement.' },
  { name: 'Inventory', description: 'Ledger-derived stock balances plus raw-material receive and issue.' },
  { name: 'CAPA', description: 'Customer complaints against dispatched batches and the corrective/preventive actions that close them out.' },
  { name: 'Formulations', description: 'Coded raw-material recipes (BOM) with revisions.' },
  { name: 'Maintenance', description: 'Machine registry and the preventive maintenance schedule.' },
  { name: 'Dashboard', description: 'Aggregated KPIs for the per-role home screens.' },
  { name: 'Administration', description: 'Employees, roles and per-employee screen access.' },
  { name: 'Onboarding', description: 'Create a new organization and its first owner account.' },
  { name: 'MesaLeads', description: 'Configurable customer questionnaires, lead qualification, pipeline and follow-up.' },
  { name: 'MesaERP', description: 'Independent multi-company manufacturing ERP, procurement, accounting, costing and statutory control.' },
  { name: 'Supplier Portal', description: 'Vendor-scoped sourcing, order collaboration, compliance evidence, disputes and payment-status visibility. Supplier sessions never enter employee or journal APIs.' },
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
  membershipStatus: { type: 'string', enum: ['active', 'on_leave', 'inactive'] },
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
  membershipStatus: { type: 'string', enum: ['active', 'on_leave', 'inactive'] },
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

const SOURCE_TO_PAY_DOCUMENT = obj({
  id: str,
  organizationId: str,
  legalEntityId: str,
  financialYearId: str,
  documentType: {
    type: 'string',
    enum: ['purchase_requisition', 'purchase_order', 'goods_receipt', 'supplier_invoice'],
  },
  documentNumber: str,
  documentDate: { type: 'string', format: 'date' },
  dueDate: { type: ['string', 'null'], format: 'date' },
  status: { type: 'string', enum: ['draft', 'submitted', 'approved', 'posted', 'cancelled', 'closed'] },
  approvalState: str,
  vendorId: { type: ['string', 'null'] },
  partySnapshot: { type: 'object' },
  currency: str,
  exchangeRate: str,
  subtotal: str,
  discountTotal: str,
  taxTotal: str,
  roundingAmount: str,
  grandTotal: str,
  baseCurrencyTotal: str,
  taxSummary: { type: 'object' },
  terms: { type: 'array' },
  shipping: { type: 'object' },
  originType: str,
  originMetadata: { type: 'object' },
  rowVersion: int,
  createdBy: str,
  approvedBy: { type: ['string', 'null'] },
  submittedAt: { type: ['string', 'null'], format: 'date-time' },
  approvedAt: { type: ['string', 'null'], format: 'date-time' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
  lines: arr(obj({
    id: str,
    lineNumber: int,
    itemId: { type: ['string', 'null'] },
    description: str,
    hsnSacCode: str,
    quantity: str,
    uom: str,
    unitPrice: str,
    discountAmount: str,
    taxableAmount: str,
    taxRate: str,
    taxAmount: str,
    lineTotal: str,
    warehouseCode: str,
    batchNumber: str,
    promisedOn: { type: ['string', 'null'], format: 'date' },
    sourceLineId: { type: ['string', 'null'] },
    dimensions: { type: 'object' },
  })),
  links: arr(obj({
    id: str,
    fromDocumentId: str,
    toDocumentId: str,
    relationship: str,
    snapshotHash: str,
  })),
});

const PURCHASE_MATCH_CASE = obj({
  id: str,
  organizationId: str,
  legalEntityId: str,
  vendorId: str,
  supplierInvoiceId: str,
  purchaseOrderId: str,
  goodsReceiptId: str,
  status: { type: 'string', enum: ['pending', 'matched', 'variance', 'disputed', 'approved'] },
  quantityVariance: str,
  priceVariance: str,
  taxVariance: str,
  totalVariance: str,
  details: { type: 'array', items: { type: 'object' } },
  makerMembershipId: str,
  checkerMembershipId: { type: ['string', 'null'] },
  rowVersion: int,
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
});

const SOURCE_TO_PAY_IDEMPOTENCY_HEADER = {
  'Idempotency-Key': 'Required. Send a stable 8-128 character key using letters, digits, dot, underscore, colon or hyphen. Replaying the same key and payload returns the original result; reusing it with a different payload is rejected.',
};

const SOURCE_TO_PAY_ENTITLEMENT_ERRORS: DocumentedError[] = [
  { status: 403, code: 'service_not_enabled', when: 'MesaERP is not active for the caller organization.' },
  { status: 403, code: 'service_not_entitled', when: 'The source-to-pay router cannot find an active MesaERP entitlement in the resolved identity.' },
];

interface SourceToPayResourceDoc {
  path: string;
  singular: string;
  plural: string;
  operationName: string;
  permission: 'mesaerp.sourcing.manage' | 'mesaerp.procurement.manage';
  creationRule: string;
}

const SOURCE_TO_PAY_RESOURCES: SourceToPayResourceDoc[] = [
  {
    path: 'purchase-requisitions',
    singular: 'purchase requisition',
    plural: 'purchase requisitions',
    operationName: 'PurchaseRequisition',
    permission: 'mesaerp.sourcing.manage',
    creationRule: 'May start independently without a vendor; it does not depend on MesaLeads, MesaOps or another source-to-pay document.',
  },
  {
    path: 'purchase-orders',
    singular: 'purchase order',
    plural: 'purchase orders',
    operationName: 'PurchaseOrder',
    permission: 'mesaerp.procurement.manage',
    creationRule: 'May start independently or snapshot an approved purchase requisition. The selected vendor must be approved or conditionally approved.',
  },
  {
    path: 'goods-receipts',
    singular: 'goods receipt',
    plural: 'goods receipts',
    operationName: 'GoodsReceipt',
    permission: 'mesaerp.procurement.manage',
    creationRule: 'May start independently or snapshot an approved purchase order; a company vendor is required in either flow.',
  },
  {
    path: 'supplier-invoices',
    singular: 'supplier invoice',
    plural: 'supplier invoices',
    operationName: 'SupplierInvoice',
    permission: 'mesaerp.procurement.manage',
    creationRule: 'May start independently or snapshot an approved purchase order or goods receipt; a company vendor is required in either flow.',
  },
];

const SOURCE_TO_PAY_ROUTE_DOCS: Record<string, RouteDoc> = {};

for (const resource of SOURCE_TO_PAY_RESOURCES) {
  const collectionPath = `/api/mesaerp/v1/entities/:legalEntityId/${resource.path}`;
  const itemPath = `${collectionPath}/:documentId`;
  const permissionError: DocumentedError = {
    status: 403,
    code: 'forbidden',
    when: `The caller does not hold the explicit \`${resource.permission}\` grant for this legal company; administrator status alone does not bypass the company grant.`,
  };
  const notFound: DocumentedError = {
    status: 404,
    code: 'document_not_found',
    when: `The ${resource.singular} does not exist in this tenant and legal company.`,
  };

  SOURCE_TO_PAY_ROUTE_DOCS[`GET ${collectionPath}`] = {
    tag: 'MesaERP',
    operationId: `listMesaErp${resource.operationName}s`,
    summary: `List ${resource.plural}`,
    description: `Returns at most 250 tenant- and legal-company-scoped ${resource.plural}, newest business date first. Every caller requires the exact \`${resource.permission}\` company grant; missing grants fail closed without an administrator bypass.`,
    params: { legalEntityId: 'Legal company id inside the authenticated organization.' },
    responseDescription: `The company ${resource.plural}, including ordered decimal-string lines and immutable source links.`,
    responseSchema: arr(SOURCE_TO_PAY_DOCUMENT),
    errors: [permissionError, ...SOURCE_TO_PAY_ENTITLEMENT_ERRORS, { status: 404, code: 'legal_entity_not_found', when: 'The legal company is outside the authenticated tenant.' }],
  };

  SOURCE_TO_PAY_ROUTE_DOCS[`POST ${collectionPath}`] = {
    tag: 'MesaERP',
    operationId: `createMesaErp${resource.operationName}`,
    summary: `Create a ${resource.singular} draft`,
    description: `${resource.creationRule} The server recalculates line and document totals from validated decimal strings, stores immutable party/source snapshots, writes audit and outbox evidence, and scopes idempotency to this operation. Every caller requires the exact \`${resource.permission}\` company grant, without an administrator bypass.`,
    status: 201,
    params: { legalEntityId: 'Legal company id inside the authenticated organization.' },
    headers: SOURCE_TO_PAY_IDEMPOTENCY_HEADER,
    responseDescription: `The created draft ${resource.singular} with server-calculated totals and rowVersion 0.`,
    responseSchema: SOURCE_TO_PAY_DOCUMENT,
    errors: [
      permissionError,
      ...SOURCE_TO_PAY_ENTITLEMENT_ERRORS,
      { status: 400, code: 'idempotency_key_required', when: 'Idempotency-Key is absent, malformed or outside the allowed 8-128 character range.' },
      { status: 404, code: 'legal_entity_not_found', when: 'The legal company is outside the authenticated tenant.' },
      { status: 404, code: 'vendor_not_found', when: 'The selected vendor is outside this legal company.' },
      { status: 404, code: 'source_document_not_found', when: 'The optional source document is outside this legal company.' },
      { status: 409, code: 'idempotency_conflict', when: 'The same idempotency key was already committed with a different request payload.' },
      { status: 409, code: 'financial_year_missing', when: 'No configured financial year covers the document date.' },
      { status: 409, code: 'financial_year_locked', when: 'The document date falls in a locked financial year.' },
      { status: 409, code: 'document_number_exists', when: 'The document number already exists for this type and financial year.' },
      { status: 409, code: 'source_document_not_approved', when: 'An optional source document has not completed approval.' },
      { status: 409, code: 'vendor_blocked', when: 'The selected vendor is blocked.' },
      { status: 409, code: 'vendor_not_approved', when: 'A purchase order vendor is not approved or conditionally approved.' },
      { status: 422, code: 'amount_out_of_range', when: 'A server-calculated line or document amount exceeds the supported non-negative decimal(18,2) range.' },
      { status: 422, code: 'discount_exceeds_line_value', when: 'A line discount exceeds quantity multiplied by unit price.' },
      { status: 422, code: 'tax_amount_mismatch', when: 'A supplied line taxAmount does not equal the server calculation from taxable amount and tax rate.' },
      { status: 422, code: 'invalid_source_document', when: 'The optional source document type cannot source this document type.' },
      { status: 422, code: 'source_document_required', when: 'A line supplies sourceLineId without a sourceDocumentId.' },
      { status: 422, code: 'source_line_mismatch', when: 'A sourceLineId does not belong to the selected source document.' },
      { status: 422, code: 'vendor_source_mismatch', when: 'The supplied vendor conflicts with the approved source snapshot.' },
      { status: 422, code: 'vendor_required', when: 'A purchase order, goods receipt or supplier invoice has no company vendor.' },
      { status: 422, code: 'item_not_found', when: 'At least one item is not active in this legal company.' },
    ],
  };

  SOURCE_TO_PAY_ROUTE_DOCS[`GET ${itemPath}`] = {
    tag: 'MesaERP',
    operationId: `getMesaErp${resource.operationName}`,
    summary: `Get one ${resource.singular}`,
    description: `Reads one tenant-, legal-company- and document-type-scoped record. Every caller requires the exact \`${resource.permission}\` company grant, without an administrator bypass.`,
    params: {
      legalEntityId: 'Legal company id inside the authenticated organization.',
      documentId: `${resource.singular[0].toUpperCase()}${resource.singular.slice(1)} id.`,
    },
    responseDescription: `The ${resource.singular} with decimal-string totals, ordered lines, source links and optimistic row version.`,
    responseSchema: SOURCE_TO_PAY_DOCUMENT,
    errors: [permissionError, ...SOURCE_TO_PAY_ENTITLEMENT_ERRORS, notFound],
  };

  SOURCE_TO_PAY_ROUTE_DOCS[`POST ${itemPath}/submit`] = {
    tag: 'MesaERP',
    operationId: `submitMesaErp${resource.operationName}`,
    summary: `Submit a ${resource.singular} for approval`,
    description: `Moves only a draft to submitted. The body must carry the currently loaded expectedRowVersion; the compare-and-swap increments it atomically. Idempotent replay is scoped to this document and transition. Every caller requires the exact \`${resource.permission}\` company grant, without an administrator bypass.`,
    params: {
      legalEntityId: 'Legal company id inside the authenticated organization.',
      documentId: `${resource.singular[0].toUpperCase()}${resource.singular.slice(1)} id.`,
    },
    headers: SOURCE_TO_PAY_IDEMPOTENCY_HEADER,
    responseDescription: `The submitted ${resource.singular} with pending approval evidence and incremented row version.`,
    responseSchema: SOURCE_TO_PAY_DOCUMENT,
    errors: [
      permissionError,
      ...SOURCE_TO_PAY_ENTITLEMENT_ERRORS,
      { status: 400, code: 'idempotency_key_required', when: 'Idempotency-Key is absent, malformed or outside the allowed 8-128 character range.' },
      notFound,
      { status: 409, code: 'idempotency_conflict', when: 'The same idempotency key was already committed with a different expected version or request payload.' },
      { status: 409, code: 'document_not_submittable', when: 'The document is not in draft status.' },
      { status: 409, code: 'version_conflict', when: 'expectedRowVersion is stale or the document changed during the atomic transition.' },
    ],
  };

  SOURCE_TO_PAY_ROUTE_DOCS[`POST ${itemPath}/approve`] = {
    tag: 'MesaERP',
    operationId: `approveMesaErp${resource.operationName}`,
    summary: `Approve a submitted ${resource.singular}`,
    description: `Moves only a submitted record to approved. Maker-checker is mandatory: the membership that created the document cannot approve it. The body must carry expectedRowVersion, and Idempotency-Key makes replay safe without relaxing the compare-and-swap. Every caller requires the exact \`${resource.permission}\` company grant, without an administrator bypass.`,
    params: {
      legalEntityId: 'Legal company id inside the authenticated organization.',
      documentId: `${resource.singular[0].toUpperCase()}${resource.singular.slice(1)} id.`,
    },
    headers: SOURCE_TO_PAY_IDEMPOTENCY_HEADER,
    responseDescription: `The approved ${resource.singular} with immutable checker evidence and incremented row version.`,
    responseSchema: SOURCE_TO_PAY_DOCUMENT,
    errors: [
      permissionError,
      ...SOURCE_TO_PAY_ENTITLEMENT_ERRORS,
      { status: 400, code: 'idempotency_key_required', when: 'Idempotency-Key is absent, malformed or outside the allowed 8-128 character range.' },
      notFound,
      { status: 409, code: 'idempotency_conflict', when: 'The same idempotency key was already committed with a different expected version or request payload.' },
      { status: 409, code: 'maker_checker_required', when: 'The document maker attempts to approve the same document.' },
      { status: 409, code: 'document_not_approvable', when: 'The document is not in submitted status.' },
      { status: 409, code: 'version_conflict', when: 'expectedRowVersion is stale or the document changed during the atomic transition.' },
    ],
  };
}

Object.assign(SOURCE_TO_PAY_ROUTE_DOCS, {
  'GET /api/mesaerp/v1/entities/:legalEntityId/purchase-matches': {
    tag: 'MesaERP',
    operationId: 'listMesaErpPurchaseMatches',
    summary: 'List three-way purchase match cases',
    description: 'Returns at most 250 tenant- and legal-company-scoped PO/GRN/supplier-invoice match cases. Every caller requires the exact `mesaerp.purchase.match` company grant, without an administrator bypass.',
    params: { legalEntityId: 'Legal company id inside the authenticated organization.' },
    responseDescription: 'Purchase match cases with decimal-string variances, evidence details, checker state and optimistic row versions.',
    responseSchema: arr(PURCHASE_MATCH_CASE),
    errors: [
      { status: 403, code: 'forbidden', when: 'The caller does not hold the explicit `mesaerp.purchase.match` grant for this legal company; administrator status alone does not bypass the company grant.' },
      ...SOURCE_TO_PAY_ENTITLEMENT_ERRORS,
      { status: 404, code: 'legal_entity_not_found', when: 'The legal company is outside the authenticated tenant.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/purchase-matches': {
    tag: 'MesaERP',
    operationId: 'createMesaErpPurchaseMatch',
    summary: 'Evaluate a three-way purchase match',
    description: 'Compares exactly one approved purchase order, one approved goods receipt and one submitted or approved supplier invoice for the same vendor. Decimal quantity, rate, tax and total variances plus structural line mismatches are stored as auditable evidence; exact-zero cases become matched and all others become variance. Every caller requires the exact `mesaerp.purchase.match` company grant, without an administrator bypass.',
    status: 201,
    params: { legalEntityId: 'Legal company id inside the authenticated organization.' },
    headers: SOURCE_TO_PAY_IDEMPOTENCY_HEADER,
    responseDescription: 'The persisted matched or variance case with line-level comparison evidence.',
    responseSchema: PURCHASE_MATCH_CASE,
    errors: [
      { status: 403, code: 'forbidden', when: 'The caller does not hold the explicit `mesaerp.purchase.match` grant for this legal company; administrator status alone does not bypass the company grant.' },
      ...SOURCE_TO_PAY_ENTITLEMENT_ERRORS,
      { status: 400, code: 'idempotency_key_required', when: 'Idempotency-Key is absent, malformed or outside the allowed 8-128 character range.' },
      { status: 404, code: 'match_document_not_found', when: 'At least one selected document is outside this legal company.' },
      { status: 409, code: 'idempotency_conflict', when: 'The same idempotency key was already committed with a different document trio.' },
      { status: 409, code: 'match_documents_not_ready', when: 'The PO or GRN is not approved, or the supplier invoice is neither submitted nor approved.' },
      { status: 409, code: 'match_case_exists', when: 'The supplier invoice already has a match case.' },
      { status: 422, code: 'match_document_type_invalid', when: 'The ids do not identify exactly one purchase order, goods receipt and supplier invoice.' },
      { status: 422, code: 'match_document_lineage_invalid', when: 'The goods receipt and supplier invoice do not carry source links to the selected purchase order or receipt.' },
      { status: 422, code: 'match_vendor_mismatch', when: 'The three documents do not carry the same company vendor.' },
    ],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/purchase-matches/:matchCaseId': {
    tag: 'MesaERP',
    operationId: 'getMesaErpPurchaseMatch',
    summary: 'Get one three-way purchase match case',
    description: 'Reads one tenant- and legal-company-scoped match case. Every caller requires the exact `mesaerp.purchase.match` company grant, without an administrator bypass.',
    params: { legalEntityId: 'Legal company id inside the authenticated organization.', matchCaseId: 'Purchase match case id.' },
    responseDescription: 'The match case with decimal-string variances, comparison details and checker state.',
    responseSchema: PURCHASE_MATCH_CASE,
    errors: [
      { status: 403, code: 'forbidden', when: 'The caller does not hold the explicit `mesaerp.purchase.match` grant for this legal company; administrator status alone does not bypass the company grant.' },
      ...SOURCE_TO_PAY_ENTITLEMENT_ERRORS,
      { status: 404, code: 'match_case_not_found', when: 'The match case does not exist in this tenant and legal company.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/purchase-matches/:matchCaseId/approve': {
    tag: 'MesaERP',
    operationId: 'approveMesaErpPurchaseMatchVariance',
    summary: 'Approve a three-way match variance',
    description: 'Approves only a variance or disputed case. A separate checker from the match evaluator must provide a five-to-1000 character reason and the current expectedRowVersion; the compare-and-swap, audit trail and replay-safe Idempotency-Key preserve the decision evidence. Every caller requires the exact `mesaerp.purchase.match` company grant, without an administrator bypass.',
    params: { legalEntityId: 'Legal company id inside the authenticated organization.', matchCaseId: 'Purchase match case id.' },
    headers: SOURCE_TO_PAY_IDEMPOTENCY_HEADER,
    responseDescription: 'The approved variance case with checker identity, reason evidence and incremented row version.',
    responseSchema: PURCHASE_MATCH_CASE,
    errors: [
      { status: 403, code: 'forbidden', when: 'The caller does not hold the explicit `mesaerp.purchase.match` grant for this legal company; administrator status alone does not bypass the company grant.' },
      ...SOURCE_TO_PAY_ENTITLEMENT_ERRORS,
      { status: 400, code: 'idempotency_key_required', when: 'Idempotency-Key is absent, malformed or outside the allowed 8-128 character range.' },
      { status: 404, code: 'match_case_not_found', when: 'The match case does not exist in this tenant and legal company.' },
      { status: 409, code: 'idempotency_conflict', when: 'The same idempotency key was already committed with a different expected version or reason.' },
      { status: 409, code: 'maker_checker_required', when: 'The match evaluator attempts to approve the same variance case.' },
      { status: 409, code: 'match_not_approvable', when: 'The match case is not in variance or disputed status.' },
      { status: 409, code: 'version_conflict', when: 'expectedRowVersion is stale or the match changed during the atomic approval.' },
    ],
  },
} satisfies Record<string, RouteDoc>);

const ERP_WRITE_HEADERS = {
  'Idempotency-Key': 'Required stable 8-128 character write key. Replaying the same operation and body returns its committed response; a different body with that key is rejected.',
};
const ERP_COMPANY_PARAM = { legalEntityId: 'Legal company id inside the authenticated organization.' };
const ERP_EXACT_PERMISSION = (permission: string): DocumentedError => ({
  status: 403,
  code: 'forbidden',
  when: `The caller lacks the exact ${permission} grant for this legal company; legacy administrator status never bypasses it.`,
});
const ERP_WRITE_ERRORS: DocumentedError[] = [
  { status: 400, code: 'idempotency_key_required', when: 'Idempotency-Key is absent or malformed.' },
  { status: 409, code: 'idempotency_conflict', when: 'The same operation key was already committed with a different body.' },
  { status: 409, code: 'version_conflict', when: 'expectedRowVersion is stale or the record changed during compare-and-swap.' },
  { status: 422, code: 'amount_out_of_range', when: 'A server-calculated amount exceeds the supported Decimal range.' },
];

const ERP_CUSTOMER = obj({
  id: str, organizationId: str, legalEntityId: str, customerCode: str, legalName: str, tradeName: str,
  pan: str, gstin: str, addresses: arr({ type: 'object' }), contacts: arr({ type: 'object' }),
  paymentTerms: str, currency: str, creditLimit: str, creditDays: int,
  status: { type: 'string', enum: ['active', 'on_hold', 'blocked'] }, rowVersion: int,
  originMetadata: { type: 'object' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
});
const ERP_SALES_DOCUMENT = obj({
  id: str, organizationId: str, legalEntityId: str, financialYearId: str,
  documentType: { type: 'string', enum: ['sales_order', 'sales_invoice'] }, documentNumber: str,
  documentDate: { type: 'string', format: 'date' }, dueDate: { type: ['string', 'null'], format: 'date' },
  status: { type: 'string', enum: ['draft', 'submitted', 'approved'] }, approvalState: str,
  customerId: str, partySnapshot: { type: 'object' }, currency: str, exchangeRate: str,
  subtotal: str, discountTotal: str, taxTotal: str, roundingAmount: str, grandTotal: str, baseCurrencyTotal: str,
  taxSummary: { type: 'object' }, terms: arr(str), shipping: { type: 'object' }, originType: str,
  originMetadata: { type: 'object' }, sourceSnapshotHash: str, rowVersion: int, createdBy: str,
  approvedBy: { type: ['string', 'null'] }, submittedAt: { type: ['string', 'null'], format: 'date-time' },
  approvedAt: { type: ['string', 'null'], format: 'date-time' },
  lines: arr(obj({
    id: str, lineNumber: int, itemId: str, description: str, hsnSacCode: str, quantity: str, uom: str,
    unitPrice: str, discountAmount: str, taxableAmount: str, taxRate: str, taxAmount: str, lineTotal: str,
    warehouseCode: str, batchNumber: str, sourceLineId: { type: ['string', 'null'] }, dimensions: { type: 'object' },
  })),
  links: arr(obj({ id: str, fromDocumentId: str, toDocumentId: str, relationship: str, snapshotHash: str })),
});
const ERP_PRODUCTION_DEMAND = obj({
  id: str, organizationId: str, legalEntityId: str, financialYearId: str, demandNumber: str, demandType: str,
  itemId: str, quantity: str, uom: str, requiredOn: { type: ['string', 'null'], format: 'date' },
  status: { type: 'string', enum: ['draft', 'approved', 'released', 'partially_completed', 'completed', 'cancelled'] },
  bomSnapshot: { type: 'object' }, materialRequirements: arr({ type: 'object' }), suggestions: arr({ type: 'object' }),
  originType: str, originMetadata: { type: 'object' }, sourceSnapshotHash: str, rowVersion: int,
  makerMembershipId: str, approvedBy: { type: ['string', 'null'] }, releasedAt: { type: ['string', 'null'], format: 'date-time' },
});
const ERP_BATCH_COST = obj({
  id: str, organizationId: str, legalEntityId: str, financialYearId: str,
  productionDemandId: { type: ['string', 'null'] }, manufacturingVoucherId: str, batchNumber: str,
  materialCost: str, laborCost: str, machineCost: str, overheadCost: str, subcontractCost: str,
  recoveryCredits: str, actualCost: str, outputQuantity: str, unitCost: str, costingMethod: str,
  calculationSnapshot: { type: 'object' }, status: { type: 'string', enum: ['approved'] },
  sourceSnapshotHash: str, approvedAt: { type: ['string', 'null'], format: 'date-time' }, approvedBy: str,
});
const ERP_MANUFACTURING_VOUCHER = obj({
  id: str, organizationId: str, legalEntityId: str, financialYearId: str,
  productionDemandId: { type: ['string', 'null'] }, voucherNumber: str, voucherType: str,
  businessDate: { type: 'string', format: 'date' }, status: { type: 'string', enum: ['draft', 'submitted', 'approved', 'posted'] },
  batchNumber: str, materialLines: arr({ type: 'object' }), outputLines: arr({ type: 'object' }),
  laborLines: arr({ type: 'object' }), resourceLines: arr({ type: 'object' }), overheadLines: arr({ type: 'object' }),
  subcontractLines: arr({ type: 'object' }), recoveryCredits: arr({ type: 'object' }), qaDisposition: { type: 'object' },
  materialValue: str, conversionValue: str, recoveryValue: str, actualCost: str, originType: str,
  originMetadata: { type: 'object' }, sourceSnapshotHash: str, rowVersion: int, makerMembershipId: str,
  approvedBy: { type: ['string', 'null'] }, postedBy: { type: ['string', 'null'] }, batchCost: { oneOf: [ERP_BATCH_COST, { type: 'null' }] },
});
const ERP_ITEM = obj({
  id: str, organizationId: str, legalEntityId: str, itemCode: str, name: str, itemType: str,
  category: str, baseUom: str, uomConversions: arr(obj({ uom: str, factorToBase: str })), hsnSacCode: str,
  gstRate: str, valuationMethod: { type: 'string', enum: ['moving_average', 'fifo'] },
  batchTracked: { type: 'boolean' }, serialTracked: { type: 'boolean' }, expiryTracked: { type: 'boolean' },
  inventoryAccount: str, consumptionAccount: str, salesAccount: str, purchaseAccount: str,
  active: { type: 'boolean' }, attributes: { type: 'object' }, rowVersion: int,
  createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
});
const ERP_WAREHOUSE = obj({
  id: str, organizationId: str, legalEntityId: str, code: str, name: str, kind: str,
  plantCode: str, branchCode: str, address: { type: 'object' }, allowNegative: { type: 'boolean' },
  active: { type: 'boolean' }, rowVersion: int, createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
});
const ERP_STOCK_BALANCE = obj({
  legalEntityId: str, itemId: str, itemCode: str, itemName: str, warehouseId: str, warehouseCode: str,
  batchNumber: str, serialNumber: str, expiryDate: { type: ['string', 'null'], format: 'date' },
  uom: str, quantity: str, value: str, unitCost: str,
});
const ERP_STOCK_LEDGER = obj({
  id: str, legalEntityId: str, itemId: str, itemCode: str, itemName: str, warehouseId: str,
  warehouseCode: str, movementType: str, businessDate: { type: 'string', format: 'date' },
  quantity: str, uom: str, unitCost: str, value: str, valuationMethod: str, valuationLayer: { type: 'object' },
  batchNumber: str, serialNumber: str, expiryDate: { type: ['string', 'null'], format: 'date' },
  sourceDocumentId: { type: ['string', 'null'] }, voucherId: { type: ['string', 'null'] },
  occurredAt: { type: 'string', format: 'date-time' },
});
const ERP_POSTING_LINK = obj({
  id: str, organizationId: str, legalEntityId: str, sourceType: str, sourceId: str, voucherId: str,
  voucherStatus: str, voucherRowVersion: int, mappingSnapshot: { type: 'object' }, sourceSnapshotHash: str,
  createdAt: { type: 'string', format: 'date-time' },
});
const ERP_INVENTORY_COUNT = obj({
  id: str, legalEntityId: str, warehouseId: str, countNumber: str,
  businessDate: { type: 'string', format: 'date' }, status: str, lines: arr({ type: 'object' }),
  sourceSnapshotHash: str, voucherId: { type: ['string', 'null'] }, rowVersion: int,
  createdAt: { type: 'string', format: 'date-time' }, posting: { oneOf: [ERP_POSTING_LINK, { type: 'null' }] },
});

const COMMERCIAL_MANUFACTURING_ROUTE_DOCS: Record<string, RouteDoc> = {
  'GET /api/mesaerp/v1/entities/:legalEntityId/customers': {
    tag: 'MesaERP', operationId: 'listMesaErpCustomers', summary: 'List company customers',
    description: 'Lists up to 500 company customers and their current credit-control state. This native MesaERP flow has no MesaOps dependency.',
    params: ERP_COMPANY_PARAM, responseDescription: 'Company-scoped customer masters with decimal-string credit limits.', responseSchema: arr(ERP_CUSTOMER),
    errors: [ERP_EXACT_PERMISSION('mesaerp.sales.manage'), { status: 404, code: 'legal_entity_not_found', when: 'The legal company is outside this tenant.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/customers': {
    tag: 'MesaERP', operationId: 'createMesaErpCustomer', summary: 'Create a customer master', status: 201,
    description: 'Creates an independently usable customer with tax identity, addresses, payment terms and explicit credit controls; audit and outbox evidence commit atomically.',
    params: ERP_COMPANY_PARAM, headers: ERP_WRITE_HEADERS, responseDescription: 'The created company customer at rowVersion 0.', responseSchema: ERP_CUSTOMER,
    errors: [ERP_EXACT_PERMISSION('mesaerp.sales.manage'), ...ERP_WRITE_ERRORS, { status: 409, code: 'customer_code_exists', when: 'The customer code already exists in this company.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/customers/:customerId': {
    tag: 'MesaERP', operationId: 'getMesaErpCustomer', summary: 'Get one company customer',
    params: { ...ERP_COMPANY_PARAM, customerId: 'Company customer id.' }, responseDescription: 'The tenant- and company-scoped customer.', responseSchema: ERP_CUSTOMER,
    errors: [ERP_EXACT_PERMISSION('mesaerp.sales.manage'), { status: 404, code: 'customer_not_found', when: 'The customer is outside this company.' }],
  },
  'PATCH /api/mesaerp/v1/entities/:legalEntityId/customers/:customerId': {
    tag: 'MesaERP', operationId: 'updateMesaErpCustomer', summary: 'Update customer and credit controls',
    description: 'Uses expectedRowVersion compare-and-swap. A hold or block affects new sales documents without rewriting existing evidence.',
    params: { ...ERP_COMPANY_PARAM, customerId: 'Company customer id.' }, headers: ERP_WRITE_HEADERS,
    responseDescription: 'The updated customer and incremented row version.', responseSchema: ERP_CUSTOMER,
    errors: [ERP_EXACT_PERMISSION('mesaerp.sales.manage'), ...ERP_WRITE_ERRORS, { status: 404, code: 'customer_not_found', when: 'The customer is outside this company.' }],
  },
};

for (const resource of [
  { path: 'sales-orders', type: 'sales order', operation: 'SalesOrder' },
  { path: 'sales-invoices', type: 'sales invoice', operation: 'SalesInvoice' },
]) {
  const collection = `/api/mesaerp/v1/entities/:legalEntityId/${resource.path}`;
  const item = `${collection}/:documentId`;
  COMMERCIAL_MANUFACTURING_ROUTE_DOCS[`GET ${collection}`] = {
    tag: 'MesaERP', operationId: `listMesaErp${resource.operation}s`, summary: `List ${resource.type}s`,
    description: `Lists company ${resource.type}s with immutable customer/source snapshots. MesaERP remains usable when MesaOps is disabled or unavailable.`,
    params: ERP_COMPANY_PARAM, responseDescription: `Company ${resource.type}s with ordered decimal-string lines.`, responseSchema: arr(ERP_SALES_DOCUMENT),
    errors: [ERP_EXACT_PERMISSION('mesaerp.sales.manage'), { status: 404, code: 'legal_entity_not_found', when: 'The legal company is outside this tenant.' }],
  };
  COMMERCIAL_MANUFACTURING_ROUTE_DOCS[`POST ${collection}`] = {
    tag: 'MesaERP', operationId: `createMesaErp${resource.operation}`, summary: `Create a ${resource.type} draft`, status: 201,
    description: resource.path === 'sales-invoices'
      ? 'Creates a standalone invoice or snapshots an approved sales order. The server recalculates tax and totals; no plant service is called.'
      : 'Creates a native sales order draft. Optional MesaLeads evidence remains a snapshot; approval never waits for MesaOps.',
    params: ERP_COMPANY_PARAM, headers: ERP_WRITE_HEADERS, responseDescription: `The ${resource.type} draft with server-calculated totals.`, responseSchema: ERP_SALES_DOCUMENT,
    errors: [
      ERP_EXACT_PERMISSION('mesaerp.sales.manage'), ...ERP_WRITE_ERRORS,
      { status: 404, code: 'customer_not_found', when: 'The customer is outside this company.' },
      { status: 404, code: 'source_sales_order_not_found', when: 'The optional source order is outside this company.' },
      { status: 409, code: 'customer_not_active', when: 'The customer is on hold or blocked.' },
      { status: 409, code: 'source_sales_order_not_approved', when: 'An invoice source order is not approved.' },
      { status: 422, code: 'tax_amount_mismatch', when: 'A supplied tax amount differs from the server calculation.' },
      { status: 422, code: 'source_line_value_mismatch', when: 'A linked invoice line changes item/UOM or exceeds its approved order quantity.' },
    ],
  };
  COMMERCIAL_MANUFACTURING_ROUTE_DOCS[`GET ${item}`] = {
    tag: 'MesaERP', operationId: `getMesaErp${resource.operation}`, summary: `Get one ${resource.type}`,
    params: { ...ERP_COMPANY_PARAM, documentId: `${resource.type} id.` }, responseDescription: `The tenant- and company-scoped ${resource.type}.`, responseSchema: ERP_SALES_DOCUMENT,
    errors: [ERP_EXACT_PERMISSION('mesaerp.sales.manage'), { status: 404, code: 'sales_document_not_found', when: `The ${resource.type} is outside this company.` }],
  };
  for (const action of ['submit', 'approve']) {
    COMMERCIAL_MANUFACTURING_ROUTE_DOCS[`POST ${item}/${action}`] = {
      tag: 'MesaERP', operationId: `${action}MesaErp${resource.operation}`, summary: `${action === 'submit' ? 'Submit' : 'Approve'} a ${resource.type}`,
      description: action === 'approve'
        ? `A separate checker approves the submitted ${resource.type}. Approval commits locally and never depends on MesaOps.`
        : `Moves only a draft ${resource.type} to submitted using expectedRowVersion compare-and-swap.`,
      params: { ...ERP_COMPANY_PARAM, documentId: `${resource.type} id.` }, headers: ERP_WRITE_HEADERS,
      responseDescription: `The ${action === 'submit' ? 'submitted' : 'approved'} ${resource.type} with incremented row version.`, responseSchema: ERP_SALES_DOCUMENT,
      errors: [
        ERP_EXACT_PERMISSION('mesaerp.sales.manage'), ...ERP_WRITE_ERRORS,
        { status: 404, code: 'sales_document_not_found', when: `The ${resource.type} is outside this company.` },
        { status: 409, code: 'maker_checker_required', when: `The ${resource.type} maker attempts approval.` },
        { status: 409, code: 'sales_document_not_transitionable', when: `The ${resource.type} is not in the expected prior state.` },
      ],
    };
  }
}

Object.assign(COMMERCIAL_MANUFACTURING_ROUTE_DOCS, {
  'GET /api/mesaerp/v1/entities/:legalEntityId/production-demands': {
    tag: 'MesaERP', operationId: 'listMesaErpProductionDemands', summary: 'List business production demands',
    description: 'Lists sales-linked and independently started internal, forecast, replenishment, trial, rework and import demand.',
    params: ERP_COMPANY_PARAM, responseDescription: 'Company production demands with their own lifecycle and source snapshot hash.', responseSchema: arr(ERP_PRODUCTION_DEMAND),
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage')],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/production-demands': {
    tag: 'MesaERP', operationId: 'createMesaErpProductionDemand', summary: 'Create a production demand draft', status: 201,
    description: 'Starts independently or snapshots one approved sales-order line. MesaERP owns quantity, MRP evidence and approval; it never assigns a machine, shift or operator.',
    params: ERP_COMPANY_PARAM, headers: ERP_WRITE_HEADERS, responseDescription: 'The production demand draft with maker evidence.', responseSchema: ERP_PRODUCTION_DEMAND,
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage'), ...ERP_WRITE_ERRORS,
      { status: 404, code: 'item_not_found', when: 'The production item is outside this company or inactive.' },
      { status: 404, code: 'source_sales_order_not_found', when: 'The optional source order is outside this company.' },
      { status: 409, code: 'source_sales_order_not_approved', when: 'The optional source order is not approved.' },
      { status: 422, code: 'source_line_value_mismatch', when: 'The demand item/UOM changes or quantity exceeds its approved source line.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/production-demands/:demandId': {
    tag: 'MesaERP', operationId: 'getMesaErpProductionDemand', summary: 'Get one production demand',
    params: { ...ERP_COMPANY_PARAM, demandId: 'Production demand id.' }, responseDescription: 'The company production demand.', responseSchema: ERP_PRODUCTION_DEMAND,
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage'), { status: 404, code: 'production_demand_not_found', when: 'The demand is outside this company.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/production-demands/:demandId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpProductionDemand', summary: 'Approve a production demand',
    description: 'A checker other than the maker approves the local demand using expectedRowVersion. No MesaOps call occurs.',
    params: { ...ERP_COMPANY_PARAM, demandId: 'Production demand id.' }, headers: ERP_WRITE_HEADERS,
    responseDescription: 'The approved demand with checker evidence.', responseSchema: ERP_PRODUCTION_DEMAND,
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage'), ...ERP_WRITE_ERRORS,
      { status: 404, code: 'production_demand_not_found', when: 'The demand is outside this company.' },
      { status: 409, code: 'maker_checker_required', when: 'The demand maker attempts approval.' },
      { status: 409, code: 'production_demand_not_transitionable', when: 'The demand is not a draft.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/production-demands/:demandId/release': {
    tag: 'MesaERP', operationId: 'releaseMesaErpProductionDemand', summary: 'Release a production-demand snapshot',
    description: 'Commits the approved-to-released CAS and an immutable `mesaerp.production-demand.released.v1` outbox proposal atomically. The payload is already compatible with the signed MesaOps inbox adapter, but this request makes no live MesaOps call and succeeds while MesaOps is unavailable.',
    params: { ...ERP_COMPANY_PARAM, demandId: 'Production demand id.' }, headers: ERP_WRITE_HEADERS,
    responseDescription: 'The released local demand with its immutable source snapshot hash.', responseSchema: ERP_PRODUCTION_DEMAND,
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage'), ...ERP_WRITE_ERRORS,
      { status: 404, code: 'production_demand_not_found', when: 'The demand is outside this company.' },
      { status: 409, code: 'production_demand_not_transitionable', when: 'The demand is not approved.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/manufacturing-vouchers': {
    tag: 'MesaERP', operationId: 'listMesaErpManufacturingVouchers', summary: 'List manufacturing vouchers',
    description: 'Lists issue, return, manufacturing, completion and rework vouchers. These are MesaERP business/accounting records, not MesaOps machine tasks.',
    params: ERP_COMPANY_PARAM, responseDescription: 'Manufacturing vouchers with decimal-string calculated values and optional approved batch cost.', responseSchema: arr(ERP_MANUFACTURING_VOUCHER),
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage')],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/manufacturing-vouchers': {
    tag: 'MesaERP', operationId: 'createMesaErpManufacturingVoucher', summary: 'Create a manufacturing voucher draft', status: 201,
    description: 'Creates a standalone ERP manufacturing voucher or links one to a released local demand. The server recalculates every material, labor, machine, overhead, subcontract and recovery amount.',
    params: ERP_COMPANY_PARAM, headers: ERP_WRITE_HEADERS, responseDescription: 'The draft voucher with explainable server-calculated values.', responseSchema: ERP_MANUFACTURING_VOUCHER,
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage'), ...ERP_WRITE_ERRORS,
      { status: 404, code: 'production_demand_not_found', when: 'The optional demand is outside this company.' },
      { status: 409, code: 'production_demand_not_released', when: 'The optional demand is not released or partially completed.' },
      { status: 422, code: 'line_amount_mismatch', when: 'A supplied amount differs from quantity multiplied by rate.' },
      { status: 422, code: 'negative_actual_cost', when: 'Recovery would make this voucher cost negative.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/manufacturing-vouchers/:voucherId': {
    tag: 'MesaERP', operationId: 'getMesaErpManufacturingVoucher', summary: 'Get one manufacturing voucher',
    params: { ...ERP_COMPANY_PARAM, voucherId: 'Manufacturing voucher id.' }, responseDescription: 'The company manufacturing voucher and optional approved batch cost.', responseSchema: ERP_MANUFACTURING_VOUCHER,
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage'), { status: 404, code: 'manufacturing_voucher_not_found', when: 'The voucher is outside this company.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/manufacturing-vouchers/:voucherId/submit': {
    tag: 'MesaERP', operationId: 'submitMesaErpManufacturingVoucher', summary: 'Submit a manufacturing voucher',
    description: 'Freezes the reviewed costing inputs and moves only a draft to submitted using expectedRowVersion.',
    params: { ...ERP_COMPANY_PARAM, voucherId: 'Manufacturing voucher id.' }, headers: ERP_WRITE_HEADERS,
    responseDescription: 'The submitted voucher and incremented row version.', responseSchema: ERP_MANUFACTURING_VOUCHER,
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage'), ...ERP_WRITE_ERRORS, { status: 409, code: 'manufacturing_voucher_not_transitionable', when: 'The voucher is not a draft.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/manufacturing-vouchers/:voucherId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpManufacturingVoucher', summary: 'Approve a manufacturing voucher',
    description: 'A separate checker approves the submitted costing evidence and atomically creates an immutable manufacturing-journal draft with stock/WIP/FG mapping. The standard voucher lifecycle must then be completed.',
    params: { ...ERP_COMPANY_PARAM, voucherId: 'Manufacturing voucher id.' }, headers: ERP_WRITE_HEADERS,
    responseDescription: 'The approved voucher with checker evidence.', responseSchema: ERP_MANUFACTURING_VOUCHER,
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage'), ...ERP_WRITE_ERRORS,
      { status: 409, code: 'maker_checker_required', when: 'The voucher maker attempts approval.' },
      { status: 409, code: 'manufacturing_material_valuation_mismatch', when: 'Entered material value differs from the locked valued-inventory issue.' },
      { status: 409, code: 'manufacturing_voucher_not_transitionable', when: 'The voucher is not submitted.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/manufacturing-vouchers/:voucherId/post': {
    tag: 'MesaERP', operationId: 'postMesaErpManufacturingVoucher', summary: 'Post a manufacturing voucher and final batch cost',
    description: 'Completes the source only after its linked manufacturing-journal has passed the standard submit, separate approve and post lifecycle. Accounting posting atomically writes material/WIP/output valuation evidence exactly once; completion then freezes batch cost and advances only the local ERP demand.',
    params: { ...ERP_COMPANY_PARAM, voucherId: 'Manufacturing voucher id.' }, headers: ERP_WRITE_HEADERS,
    responseDescription: 'The posted voucher with immutable batch cost when the voucher completes output.', responseSchema: ERP_MANUFACTURING_VOUCHER,
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage'), ...ERP_WRITE_ERRORS,
      { status: 409, code: 'qa_disposition_blocks_completion', when: 'QA is pending, held, rejected or marked for rework.' },
      { status: 409, code: 'accounting_voucher_not_posted', when: 'The linked accounting voucher has not completed its maker-checker lifecycle.' },
      { status: 409, code: 'production_over_completion', when: 'Cumulative finished output exceeds the released demand.' },
      { status: 422, code: 'negative_batch_cost', when: 'Returns or recoveries make the final batch cost negative.' },
      { status: 422, code: 'finished_output_required', when: 'No positive finished-good output is present.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/batch-costs': {
    tag: 'MesaERP', operationId: 'listMesaErpBatchCosts', summary: 'List immutable actual batch costs',
    params: ERP_COMPANY_PARAM, responseDescription: 'Approved batch costs with explainable component totals, output quantity and unit cost.', responseSchema: arr(ERP_BATCH_COST),
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage')],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/batch-costs/:batchCostId': {
    tag: 'MesaERP', operationId: 'getMesaErpBatchCost', summary: 'Get one immutable actual batch cost',
    params: { ...ERP_COMPANY_PARAM, batchCostId: 'Approved batch-cost id.' }, responseDescription: 'The company batch cost and immutable calculation snapshot.', responseSchema: ERP_BATCH_COST,
    errors: [ERP_EXACT_PERMISSION('mesaerp.manufacturing.manage'), { status: 404, code: 'batch_cost_not_found', when: 'The batch cost is outside this company.' }],
  },
} satisfies Record<string, RouteDoc>);

const VALUED_INVENTORY_ERRORS: DocumentedError[] = [
  ERP_EXACT_PERMISSION('mesaerp.inventory.manage'),
  { status: 409, code: 'negative_stock_prevented', when: 'The requested issue exceeds the locked valued balance or FIFO layers.' },
  { status: 409, code: 'backdated_inventory_posting', when: 'The transaction would rewrite later immutable valuation history.' },
  { status: 409, code: 'inventory_valuation_changed', when: 'The value changed after the source posting draft was generated.' },
  { status: 422, code: 'inventory_mapping_missing', when: 'An item, warehouse, trace field or posting-account mapping is missing.' },
];

const VALUED_INVENTORY_ROUTE_DOCS: Record<string, RouteDoc> = {
  'GET /api/mesaerp/v1/entities/:legalEntityId/items': {
    tag: 'MesaERP', operationId: 'listMesaErpItems', summary: 'List valued-inventory item masters',
    description: 'Returns company items with Decimal-string GST and UOM conversion data, trace policy and explicit account mappings.',
    params: ERP_COMPANY_PARAM, responseDescription: 'Company item masters.', responseSchema: arr(ERP_ITEM),
    errors: [ERP_EXACT_PERMISSION('mesaerp.inventory.manage')],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/items': {
    tag: 'MesaERP', operationId: 'createMesaErpItem', summary: 'Create an item master', status: 201,
    description: 'Creates a replay-safe item. Moving weighted average is the default; FIFO is selectable only before its first stock transaction.',
    params: ERP_COMPANY_PARAM, headers: ERP_WRITE_HEADERS, responseDescription: 'The created item at rowVersion 0.', responseSchema: ERP_ITEM,
    errors: [ERP_EXACT_PERMISSION('mesaerp.inventory.manage'), ...ERP_WRITE_ERRORS, { status: 409, code: 'item_code_exists', when: 'The item code already exists in this company.' }, { status: 422, code: 'posting_mapping_missing', when: 'An item ledger mapping is unknown or inactive.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/items/:itemId': {
    tag: 'MesaERP', operationId: 'getMesaErpItem', summary: 'Get one item master',
    params: { ...ERP_COMPANY_PARAM, itemId: 'Company item id.' }, responseDescription: 'The company item master.', responseSchema: ERP_ITEM,
    errors: [ERP_EXACT_PERMISSION('mesaerp.inventory.manage'), { status: 404, code: 'item_not_found', when: 'The item is outside this company.' }],
  },
  'PATCH /api/mesaerp/v1/entities/:legalEntityId/items/:itemId': {
    tag: 'MesaERP', operationId: 'updateMesaErpItem', summary: 'Update an item master',
    description: 'Uses expectedRowVersion. Item type, base UOM, valuation method and batch/serial/expiry policies become immutable after the first movement.',
    params: { ...ERP_COMPANY_PARAM, itemId: 'Company item id.' }, headers: ERP_WRITE_HEADERS,
    responseDescription: 'The updated item and incremented row version.', responseSchema: ERP_ITEM,
    errors: [ERP_EXACT_PERMISSION('mesaerp.inventory.manage'), ...ERP_WRITE_ERRORS, { status: 404, code: 'item_not_found', when: 'The item is outside this company.' }, { status: 409, code: 'item_stock_policy_locked', when: 'A stock-policy field is changed after the first transaction.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/warehouses': {
    tag: 'MesaERP', operationId: 'listMesaErpWarehouses', summary: 'List company warehouses',
    params: ERP_COMPANY_PARAM, responseDescription: 'Warehouses, plants, godowns and subcontract locations. Negative stock is always disabled.', responseSchema: arr(ERP_WAREHOUSE),
    errors: [ERP_EXACT_PERMISSION('mesaerp.inventory.manage')],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/warehouses': {
    tag: 'MesaERP', operationId: 'createMesaErpWarehouse', summary: 'Create a warehouse', status: 201,
    params: ERP_COMPANY_PARAM, headers: ERP_WRITE_HEADERS, responseDescription: 'The created warehouse at rowVersion 0.', responseSchema: ERP_WAREHOUSE,
    errors: [ERP_EXACT_PERMISSION('mesaerp.inventory.manage'), ...ERP_WRITE_ERRORS, { status: 409, code: 'warehouse_code_exists', when: 'The warehouse code already exists in this company.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/warehouses/:warehouseId': {
    tag: 'MesaERP', operationId: 'getMesaErpWarehouse', summary: 'Get one warehouse',
    params: { ...ERP_COMPANY_PARAM, warehouseId: 'Company warehouse id.' }, responseDescription: 'The company warehouse.', responseSchema: ERP_WAREHOUSE,
    errors: [ERP_EXACT_PERMISSION('mesaerp.inventory.manage'), { status: 404, code: 'warehouse_not_found', when: 'The warehouse is outside this company.' }],
  },
  'PATCH /api/mesaerp/v1/entities/:legalEntityId/warehouses/:warehouseId': {
    tag: 'MesaERP', operationId: 'updateMesaErpWarehouse', summary: 'Update a warehouse',
    params: { ...ERP_COMPANY_PARAM, warehouseId: 'Company warehouse id.' }, headers: ERP_WRITE_HEADERS,
    responseDescription: 'The updated warehouse and incremented row version.', responseSchema: ERP_WAREHOUSE,
    errors: [ERP_EXACT_PERMISSION('mesaerp.inventory.manage'), ...ERP_WRITE_ERRORS, { status: 404, code: 'warehouse_not_found', when: 'The warehouse is outside this company.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/stock-balances': {
    tag: 'MesaERP', operationId: 'listMesaErpStockBalances', summary: 'Read valued stock balances',
    description: 'Derives quantity and value from immutable movements by company, item, warehouse and trace identity. Optional itemId and warehouseId query filters are supported.',
    params: ERP_COMPANY_PARAM, responseDescription: 'Decimal-string stock quantities, values and effective unit costs.', responseSchema: arr(ERP_STOCK_BALANCE),
    errors: [ERP_EXACT_PERMISSION('mesaerp.inventory.manage')],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/stock-ledger': {
    tag: 'MesaERP', operationId: 'listMesaErpStockLedger', summary: 'Read the immutable stock ledger',
    description: 'Returns up to 1000 posted movements with their moving-average or FIFO valuation evidence and voucher provenance.',
    params: ERP_COMPANY_PARAM, responseDescription: 'Immutable valued stock movements.', responseSchema: arr(ERP_STOCK_LEDGER),
    errors: [ERP_EXACT_PERMISSION('mesaerp.inventory.manage')],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/stock-adjustments': {
    tag: 'MesaERP', operationId: 'createMesaErpStockAdjustment', summary: 'Create a controlled stock-adjustment posting', status: 201,
    description: 'Freezes a balanced stock-journal draft and valuation plan. Stock changes only after the existing voucher submit, separate approve and post lifecycle completes.',
    params: ERP_COMPANY_PARAM, headers: ERP_WRITE_HEADERS, responseDescription: 'The source posting link and accounting voucher draft.', responseSchema: ERP_POSTING_LINK,
    errors: [...VALUED_INVENTORY_ERRORS, ...ERP_WRITE_ERRORS, { status: 422, code: 'receipt_unit_cost_required', when: 'A positive adjustment omits unit cost.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/stock-transfers': {
    tag: 'MesaERP', operationId: 'createMesaErpStockTransfer', summary: 'Create a valued warehouse transfer', status: 201,
    description: 'Creates one immutable issue/receipt plan and a balanced stock-journal draft. The issue valuation is reused at the destination exactly once.',
    params: ERP_COMPANY_PARAM, headers: ERP_WRITE_HEADERS, responseDescription: 'The transfer posting link and voucher draft.', responseSchema: ERP_POSTING_LINK,
    errors: [...VALUED_INVENTORY_ERRORS, ...ERP_WRITE_ERRORS],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/physical-counts': {
    tag: 'MesaERP', operationId: 'createMesaErpPhysicalCount', summary: 'Record a physical count', status: 201,
    description: 'Retains immutable counted-versus-book evidence. A variance produces a controlled stock-journal draft; a zero variance is reconciled without a posting.',
    params: ERP_COMPANY_PARAM, headers: ERP_WRITE_HEADERS, responseDescription: 'The immutable count snapshot and optional adjustment posting.', responseSchema: ERP_INVENTORY_COUNT,
    errors: [...VALUED_INVENTORY_ERRORS, ...ERP_WRITE_ERRORS, { status: 422, code: 'count_receipt_cost_required', when: 'A positive count variance omits receipt unit cost.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/physical-counts/:countId': {
    tag: 'MesaERP', operationId: 'getMesaErpPhysicalCount', summary: 'Get physical-count evidence',
    params: { ...ERP_COMPANY_PARAM, countId: 'Physical-count id.' }, responseDescription: 'The count snapshot and current linked voucher state.', responseSchema: ERP_INVENTORY_COUNT,
    errors: [ERP_EXACT_PERMISSION('mesaerp.inventory.manage'), { status: 404, code: 'inventory_count_not_found', when: 'The count is outside this company.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/posting-links/:sourceType/:sourceId': {
    tag: 'MesaERP', operationId: 'getMesaErpSourcePosting', summary: 'Get a source-to-voucher posting mapping',
    description: 'Returns the immutable source hash, account mapping, inventory plan and current voucher lifecycle state for a GRN, supplier invoice, sales invoice, manufacturing voucher, adjustment, transfer or count.',
    params: { ...ERP_COMPANY_PARAM, sourceType: 'Source aggregate type.', sourceId: 'Source aggregate id.' }, responseDescription: 'The immutable posting link.', responseSchema: ERP_POSTING_LINK,
    errors: [ERP_EXACT_PERMISSION('mesaerp.inventory.manage'), { status: 404, code: 'source_posting_not_found', when: 'The source posting is outside this company or does not exist.' }],
  },
};

const MRP_PARAMS = { legalEntityId: 'Legal company id inside the authenticated organization.' };
const MRP_HEADERS = { 'Idempotency-Key': 'Required stable key for replay-safe planning mutation (8-128 safe characters).' };
const MRP_PERMISSION = ERP_EXACT_PERMISSION('mesaerp.mrp.manage');
const MRP_WRITE_ERRORS: DocumentedError[] = [
  MRP_PERMISSION,
  { status: 400, code: 'idempotency_key_required', when: 'The Idempotency-Key header is absent or malformed.' },
  { status: 409, code: 'idempotency_conflict', when: 'The same key was already committed with a different request.' },
  { status: 409, code: 'version_conflict', when: 'The expected row version is stale or a concurrent action won.' },
];
const PLANNING_POLICY = { type: 'object', description: 'Company item planning policy with Decimal strings and an optimistic rowVersion.' };
const PLANNING_BOM = { type: 'object', description: 'Planning BOM and ordered immutable revision snapshots with Decimal strings.' };
const DEMAND_FORECAST = { type: 'object', description: 'Company demand forecast with maker-checker evidence and Decimal-string quantity.' };
const STOCK_RESERVATION = { type: 'object', description: 'Trace-aware stock reservation with source hash and optimistic rowVersion.' };
const MRP_RUN = { type: 'object', description: 'Immutable MRP input/result snapshots, time-phased requirements and actionable suggestions.' };
const MRP_SUGGESTION = { type: 'object', description: 'MRP make, purchase or transfer suggestion with maker-checker lifecycle and released draft resource link.' };
const TRANSFER_PROPOSAL = { type: 'object', description: 'Draft warehouse transfer proposal released from an approved MRP suggestion.' };

const MRP_ROUTE_DOCS: Record<string, RouteDoc> = {
  'GET /api/mesaerp/v1/entities/:legalEntityId/items/:itemId/planning-policy': {
    tag: 'MesaERP', operationId: 'getMesaErpItemPlanningPolicy', summary: 'Read an item planning policy',
    params: { ...MRP_PARAMS, itemId: 'Inventory item id.' }, responseDescription: 'The item lead-time, stock, lot-sizing and make/buy/transfer policy.', responseSchema: PLANNING_POLICY,
    errors: [MRP_PERMISSION, { status: 404, code: 'inventory_item_not_found', when: 'The item is outside this company or inactive.' }],
  },
  'PATCH /api/mesaerp/v1/entities/:legalEntityId/items/:itemId/planning-policy': {
    tag: 'MesaERP', operationId: 'updateMesaErpItemPlanningPolicy', summary: 'Update an item planning policy',
    description: 'Uses Decimal strings and expectedRowVersion. Planning and transfer warehouses plus any preferred vendor must be active, approved and in the same company.',
    params: { ...MRP_PARAMS, itemId: 'Inventory item id.' }, headers: MRP_HEADERS,
    responseDescription: 'The updated policy and incremented row version.', responseSchema: PLANNING_POLICY, errors: MRP_WRITE_ERRORS,
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/planning-boms': {
    tag: 'MesaERP', operationId: 'listMesaErpPlanningBoms', summary: 'List planning BOMs and revisions', params: MRP_PARAMS,
    responseDescription: 'Company planning BOMs with ordered revisions.', responseSchema: arr(PLANNING_BOM), errors: [MRP_PERMISSION],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/planning-boms': {
    tag: 'MesaERP', operationId: 'createMesaErpPlanningBom', summary: 'Create a planning BOM and first draft revision', status: 201,
    description: 'Supports discrete BOMs and formula BOMs. Components use item base UOMs and cannot directly self-reference.', params: MRP_PARAMS, headers: MRP_HEADERS,
    responseDescription: 'The new BOM with its draft revision.', responseSchema: PLANNING_BOM,
    errors: [...MRP_WRITE_ERRORS, { status: 409, code: 'active_bom_exists', when: 'The item already has an active planning BOM.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/planning-boms/:bomId': {
    tag: 'MesaERP', operationId: 'getMesaErpPlanningBom', summary: 'Read one planning BOM',
    params: { ...MRP_PARAMS, bomId: 'Planning BOM id.' }, responseDescription: 'The BOM and immutable revision history.', responseSchema: PLANNING_BOM,
    errors: [MRP_PERMISSION, { status: 404, code: 'planning_bom_not_found', when: 'The BOM is outside this company.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/planning-boms/:bomId/revisions': {
    tag: 'MesaERP', operationId: 'createMesaErpPlanningBomRevision', summary: 'Create a new draft BOM revision', status: 201,
    params: { ...MRP_PARAMS, bomId: 'Planning BOM id.' }, headers: MRP_HEADERS, responseDescription: 'The next numbered draft revision.', responseSchema: PLANNING_BOM,
    errors: MRP_WRITE_ERRORS,
  },
  'PATCH /api/mesaerp/v1/entities/:legalEntityId/planning-boms/:bomId/revisions/:revisionId': {
    tag: 'MesaERP', operationId: 'updateMesaErpPlanningBomRevision', summary: 'Edit a draft BOM revision',
    description: 'Draft-only optimistic update. Submitting freezes components, dates, yield, formula parameters and quantities.',
    params: { ...MRP_PARAMS, bomId: 'Planning BOM id.', revisionId: 'Draft revision id.' }, headers: MRP_HEADERS,
    responseDescription: 'The updated draft revision.', responseSchema: PLANNING_BOM,
    errors: [...MRP_WRITE_ERRORS, { status: 409, code: 'bom_revision_immutable', when: 'The revision is already submitted or approved.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/planning-boms/:bomId/revisions/:revisionId/submit': {
    tag: 'MesaERP', operationId: 'submitMesaErpPlanningBomRevision', summary: 'Submit a BOM revision',
    params: { ...MRP_PARAMS, bomId: 'Planning BOM id.', revisionId: 'Draft revision id.' }, headers: MRP_HEADERS,
    responseDescription: 'The immutable submitted revision.', responseSchema: PLANNING_BOM, errors: MRP_WRITE_ERRORS,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/planning-boms/:bomId/revisions/:revisionId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpPlanningBomRevision', summary: 'Checker-approve a BOM revision',
    description: 'Serializes approvals per BOM, rejects cycles and overlapping effective periods, and freezes a SHA-256 source snapshot.',
    params: { ...MRP_PARAMS, bomId: 'Planning BOM id.', revisionId: 'Submitted revision id.' }, headers: MRP_HEADERS,
    responseDescription: 'The approved immutable revision.', responseSchema: PLANNING_BOM,
    errors: [...MRP_WRITE_ERRORS, { status: 409, code: 'maker_checker_required', when: 'The revision maker attempts approval.' }, { status: 409, code: 'bom_cycle_detected', when: 'The revision would create a multi-level BOM cycle.' }, { status: 409, code: 'bom_effective_period_overlap', when: 'Another approved revision overlaps this effective period.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/demand-forecasts': {
    tag: 'MesaERP', operationId: 'listMesaErpDemandForecasts', summary: 'List demand forecasts', params: MRP_PARAMS,
    responseDescription: 'Company forecasts ordered by business date.', responseSchema: arr(DEMAND_FORECAST), errors: [MRP_PERMISSION],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/demand-forecasts': {
    tag: 'MesaERP', operationId: 'createMesaErpDemandForecast', summary: 'Create a demand forecast', status: 201,
    params: MRP_PARAMS, headers: MRP_HEADERS, responseDescription: 'The draft forecast.', responseSchema: DEMAND_FORECAST, errors: MRP_WRITE_ERRORS,
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/demand-forecasts/:forecastId': {
    tag: 'MesaERP', operationId: 'getMesaErpDemandForecast', summary: 'Read one demand forecast', params: { ...MRP_PARAMS, forecastId: 'Forecast id.' },
    responseDescription: 'The company forecast.', responseSchema: DEMAND_FORECAST, errors: [MRP_PERMISSION],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/demand-forecasts/:forecastId/submit': {
    tag: 'MesaERP', operationId: 'submitMesaErpDemandForecast', summary: 'Submit a demand forecast', params: { ...MRP_PARAMS, forecastId: 'Forecast id.' }, headers: MRP_HEADERS,
    responseDescription: 'The submitted forecast.', responseSchema: DEMAND_FORECAST, errors: MRP_WRITE_ERRORS,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/demand-forecasts/:forecastId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpDemandForecast', summary: 'Checker-approve a demand forecast', params: { ...MRP_PARAMS, forecastId: 'Forecast id.' }, headers: MRP_HEADERS,
    responseDescription: 'The approved immutable forecast.', responseSchema: DEMAND_FORECAST,
    errors: [...MRP_WRITE_ERRORS, { status: 409, code: 'maker_checker_required', when: 'The forecast maker attempts approval.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/stock-reservations': {
    tag: 'MesaERP', operationId: 'listMesaErpStockReservations', summary: 'List stock reservations', params: MRP_PARAMS,
    responseDescription: 'Company stock reservations and trace identities.', responseSchema: arr(STOCK_RESERVATION), errors: [MRP_PERMISSION],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/stock-reservations': {
    tag: 'MesaERP', operationId: 'createMesaErpStockReservation', summary: 'Reserve available traced stock', status: 201,
    description: 'Serializes stock and source-demand allocation. Batch/serial/expiry policy, source quantity and current free stock are validated before the immutable reservation is created.',
    params: MRP_PARAMS, headers: MRP_HEADERS, responseDescription: 'The active reservation.', responseSchema: STOCK_RESERVATION,
    errors: [...MRP_WRITE_ERRORS, { status: 409, code: 'insufficient_available_stock', when: 'The traced free quantity is too small.' }, { status: 409, code: 'reservation_source_quantity_exceeded', when: 'Reservations would exceed the linked order line or demand.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/stock-reservations/:reservationId': {
    tag: 'MesaERP', operationId: 'getMesaErpStockReservation', summary: 'Read one stock reservation', params: { ...MRP_PARAMS, reservationId: 'Reservation id.' },
    responseDescription: 'The company reservation.', responseSchema: STOCK_RESERVATION, errors: [MRP_PERMISSION],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/stock-reservations/:reservationId/release': {
    tag: 'MesaERP', operationId: 'releaseMesaErpStockReservation', summary: 'Release an active stock reservation', params: { ...MRP_PARAMS, reservationId: 'Reservation id.' }, headers: MRP_HEADERS,
    responseDescription: 'The released immutable reservation.', responseSchema: STOCK_RESERVATION, errors: MRP_WRITE_ERRORS,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/stock-reservations/:reservationId/cancel': {
    tag: 'MesaERP', operationId: 'cancelMesaErpStockReservation', summary: 'Cancel an active stock reservation', params: { ...MRP_PARAMS, reservationId: 'Reservation id.' }, headers: MRP_HEADERS,
    responseDescription: 'The cancelled immutable reservation.', responseSchema: STOCK_RESERVATION, errors: MRP_WRITE_ERRORS,
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/atp': {
    tag: 'MesaERP', operationId: 'getMesaErpAvailableToPromise', summary: 'Calculate item and warehouse ATP',
    description: 'Query parameters itemId and warehouseId are required; asOfDate and requiredOn are ISO business dates. Returns current free stock plus approved open purchase and released production supply without mutating inventory.',
    params: MRP_PARAMS,
    query: {
      itemId: { description: 'Inventory item id.', required: true, schema: { type: 'string' } },
      warehouseId: { description: 'Warehouse id.', required: true, schema: { type: 'string' } },
      asOfDate: { description: 'Optional stock cut-off business date.', schema: { type: 'string', format: 'date' } },
      requiredOn: { description: 'Optional supply horizon business date; defaults to asOfDate.', schema: { type: 'string', format: 'date' } },
    },
    responseDescription: 'Decimal-string current and projected available-to-promise quantities.', responseSchema: { type: 'object' }, errors: [MRP_PERMISSION],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/mrp-runs': {
    tag: 'MesaERP', operationId: 'listMesaErpMrpRuns', summary: 'List immutable MRP runs', params: MRP_PARAMS,
    responseDescription: 'Recent MRP runs with requirements and suggestions.', responseSchema: arr(MRP_RUN), errors: [MRP_PERMISSION],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/mrp-runs': {
    tag: 'MesaERP', operationId: 'calculateMesaErpMrpRun', summary: 'Calculate a source-hashed MRP run', status: 201,
    description: 'Snapshots approved demand, additive forecasts, deduplicated linked production demand, valued on-hand stock, active reservations, approved PO/open production supply, planning policies and approved effective BOMs. Netting is chronological and multi-level explosion runs to convergence.',
    params: MRP_PARAMS, headers: MRP_HEADERS, responseDescription: 'The immutable run, requirements and draft suggestions.', responseSchema: MRP_RUN,
    errors: [...MRP_WRITE_ERRORS, { status: 409, code: 'planning_sources_changed', when: 'An input changed during calculation.' }, { status: 409, code: 'approved_bom_missing', when: 'A make item has no approved effective BOM.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/mrp-runs/:runId': {
    tag: 'MesaERP', operationId: 'getMesaErpMrpRun', summary: 'Read one immutable MRP run', params: { ...MRP_PARAMS, runId: 'MRP run id.' },
    responseDescription: 'The source/result snapshots, requirements and suggestions.', responseSchema: MRP_RUN, errors: [MRP_PERMISSION],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/mrp-runs/:runId/suggestions': {
    tag: 'MesaERP', operationId: 'listMesaErpMrpSuggestions', summary: 'List suggestions from an MRP run', params: { ...MRP_PARAMS, runId: 'MRP run id.' },
    responseDescription: 'Make, purchase and transfer suggestions.', responseSchema: arr(MRP_SUGGESTION), errors: [MRP_PERMISSION],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/mrp-suggestions/:suggestionId/submit': {
    tag: 'MesaERP', operationId: 'submitMesaErpMrpSuggestion', summary: 'Submit an MRP suggestion', params: { ...MRP_PARAMS, suggestionId: 'MRP suggestion id.' }, headers: MRP_HEADERS,
    responseDescription: 'The submitted suggestion.', responseSchema: MRP_SUGGESTION,
    errors: [...MRP_WRITE_ERRORS, { status: 409, code: 'mrp_run_stale', when: 'A source input changed after the run.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/mrp-suggestions/:suggestionId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpMrpSuggestion', summary: 'Checker-approve an MRP suggestion', params: { ...MRP_PARAMS, suggestionId: 'MRP suggestion id.' }, headers: MRP_HEADERS,
    responseDescription: 'The approved suggestion.', responseSchema: MRP_SUGGESTION,
    errors: [...MRP_WRITE_ERRORS, { status: 409, code: 'maker_checker_required', when: 'The suggestion maker attempts approval.' }, { status: 409, code: 'mrp_run_stale', when: 'A source input changed after the run.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/mrp-suggestions/:suggestionId/release': {
    tag: 'MesaERP', operationId: 'releaseMesaErpMrpSuggestion', summary: 'Release an approved suggestion to a local draft',
    description: 'Make creates an ERP production demand only; purchase creates a draft purchase requisition; transfer creates a draft transfer proposal. No machine, shift, operator or MesaOps lifecycle is touched.',
    params: { ...MRP_PARAMS, suggestionId: 'MRP suggestion id.' }, headers: MRP_HEADERS,
    responseDescription: 'The released suggestion with the created resource type and id.', responseSchema: MRP_SUGGESTION,
    errors: [...MRP_WRITE_ERRORS, { status: 409, code: 'mrp_run_stale', when: 'A source input changed after the run.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/transfer-proposals': {
    tag: 'MesaERP', operationId: 'listMesaErpTransferProposals', summary: 'List MRP transfer proposals', params: MRP_PARAMS,
    responseDescription: 'Draft transfer proposals that remain independent from stock-transfer posting.', responseSchema: arr(TRANSFER_PROPOSAL), errors: [MRP_PERMISSION],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/transfer-proposals/:proposalId': {
    tag: 'MesaERP', operationId: 'getMesaErpTransferProposal', summary: 'Read one MRP transfer proposal', params: { ...MRP_PARAMS, proposalId: 'Transfer proposal id.' },
    responseDescription: 'The company transfer proposal.', responseSchema: TRANSFER_PROPOSAL, errors: [MRP_PERMISSION],
  },
};

const INDIA_COMPLIANCE_PROFILE = obj({
  id: str, organizationId: str, legalEntityId: str, jurisdiction: str, artifactKind: str,
  version: str, effectiveFrom: { type: 'string', format: 'date' }, effectiveTo: { type: ['string', 'null'], format: 'date' },
  status: { type: 'string', enum: ['draft', 'approved', 'retired'] }, rules: { type: 'object' },
  sourceReference: str, sourceEvidence: { type: 'object' }, sourceChecksum: str, rowVersion: int,
  createdBy: str, approvedBy: { type: ['string', 'null'] }, approvedAt: { type: ['string', 'null'], format: 'date-time' },
  createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
});
const INDIA_TAX_DOCUMENT = obj({
  id: str, organizationId: str, legalEntityId: str, financialYearId: str, sourceDocumentId: { type: ['string', 'null'] },
  documentKind: { type: 'string', enum: ['outbound_e_invoice', 'inbound_e_invoice', 'e_way_bill', 'gstr2b'] },
  provider: str, providerReference: str, status: str, supplierGstin: str, recipientGstin: str,
  documentType: str, documentNumber: str, documentDate: { type: ['string', 'null'], format: 'date' },
  irn: str, acknowledgementNumber: str, acknowledgementAt: { type: ['string', 'null'], format: 'date-time' },
  signedPayload: { type: 'object' }, submittedPayload: { type: 'object' }, qrData: str,
  transporter: { type: 'object' }, vehicle: { type: 'object' }, validUntil: { type: ['string', 'null'], format: 'date-time' },
  cancellation: { type: 'object' }, reconciliation: { type: 'object' },
  itcStatus: { type: 'string', enum: ['pending', 'eligible', 'blocked', 'mismatched', 'reversed', 'claimed'] },
  ruleProfileVersion: str, evidenceHash: str, rowVersion: int, makerMembershipId: str,
  approvedBy: { type: ['string', 'null'] }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
});
const INDIA_TAX_PARAMS = { legalEntityId: 'India legal company id inside the authenticated organization.' };
const INDIA_TAX_WRITE_HEADERS = { 'Idempotency-Key': 'Required stable key for replay-safe statutory mutation (8-128 safe characters).' };
const INDIA_TAX_PERMISSION = ERP_EXACT_PERMISSION('mesaerp.tax.manage');
const INDIA_TAX_BASE_ERRORS: DocumentedError[] = [
  INDIA_TAX_PERMISSION,
  { status: 404, code: 'legal_entity_not_found', when: 'The legal company is outside the authenticated tenant.' },
  { status: 409, code: 'india_compliance_not_applicable', when: 'The legal company country is not India.' },
];
const INDIA_TAX_WRITE_ERRORS: DocumentedError[] = [
  ...INDIA_TAX_BASE_ERRORS,
  { status: 400, code: 'idempotency_key_required', when: 'The Idempotency-Key header is absent or malformed.' },
  { status: 409, code: 'idempotency_conflict', when: 'The key was already committed with a different request.' },
  { status: 409, code: 'version_conflict', when: 'expectedRowVersion is stale or a compare-and-swap lost a race.' },
];
const INDIA_EXTERNAL_EVIDENCE_ACCEPT_ERRORS: DocumentedError[] = [
  { status: 503, code: 'external_evidence_verifier_unavailable', when: 'The dedicated deployment-owned verifier HMAC key is absent or invalid.' },
  { status: 422, code: 'external_evidence_signature_invalid', when: 'The verifier attestation does not match the tenant, company, evidence kind, source record and retained payload.' },
];
const INDIA_EXTERNAL_EVIDENCE_REVERIFY_ERRORS: DocumentedError[] = [
  ...INDIA_EXTERNAL_EVIDENCE_ACCEPT_ERRORS,
  { status: 409, code: 'external_evidence_verification_missing', when: 'The stored compliance record has no signed verifier envelope.' },
  { status: 409, code: 'external_evidence_envelope_mismatch', when: 'The stored envelope no longer matches its company, source identity or immutable retained payload.' },
];
const INDIA_PROVIDER_ERRORS: DocumentedError[] = [
  { status: 503, code: 'compliance_provider_unavailable', when: 'No authorised provider adapter is configured.' },
  { status: 504, code: 'compliance_provider_timeout', when: 'The configured adapter did not complete the response within its strict deadline.' },
  { status: 502, code: 'compliance_provider_transport_error', when: 'The configured HTTPS adapter could not be reached.' },
  { status: 502, code: 'compliance_provider_rejected', when: 'The adapter rejected the upstream operation.' },
  { status: 502, code: 'compliance_provider_response_too_large', when: 'The adapter response exceeded the one-megabyte limit.' },
  { status: 502, code: 'compliance_provider_response_invalid', when: 'The adapter response envelope or operation payload failed strict schema validation.' },
  { status: 502, code: 'compliance_provider_response_unbound', when: 'The response operation, request id or request hash does not match this write.' },
  { status: 502, code: 'compliance_provider_attestation_key_unknown', when: 'The adapter used an unexpected HMAC key id.' },
  { status: 502, code: 'compliance_provider_attestation_invalid', when: 'The response HMAC bound to the operation and request could not be verified.' },
];

const INDIA_COMPLIANCE_ROUTE_DOCS: Record<string, RouteDoc> = {
  'GET /api/mesaerp/v1/entities/:legalEntityId/compliance-rule-profiles': {
    tag: 'MesaERP', operationId: 'listMesaErpIndiaComplianceRuleProfiles', summary: 'List effective-dated India compliance rules',
    description: 'Lists company rules as retained, source-hashed versions. Applicability thresholds and exemptions live in approved profiles rather than workflow code.',
    params: INDIA_TAX_PARAMS, responseDescription: 'Versioned company rule profiles.', responseSchema: arr(INDIA_COMPLIANCE_PROFILE), errors: INDIA_TAX_BASE_ERRORS,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/compliance-rule-profiles': {
    tag: 'MesaERP', operationId: 'createMesaErpIndiaComplianceRuleProfile', summary: 'Create a compliance rule draft', status: 201,
    description: 'Stores an effective-dated rule snapshot, official source reference and canonical SHA-256 evidence checksum as a maker-owned draft.',
    params: INDIA_TAX_PARAMS, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The immutable-source rule draft.', responseSchema: INDIA_COMPLIANCE_PROFILE,
    errors: [...INDIA_TAX_WRITE_ERRORS, { status: 409, code: 'rule_profile_version_exists', when: 'The artifact kind and version already exist.' }, { status: 422, code: 'source_checksum_mismatch', when: 'Source evidence does not match its SHA-256 checksum.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/compliance-rule-profiles/:profileId': {
    tag: 'MesaERP', operationId: 'getMesaErpIndiaComplianceRuleProfile', summary: 'Get a compliance rule version',
    params: { ...INDIA_TAX_PARAMS, profileId: 'Compliance rule profile id.' }, responseDescription: 'The retained rule profile and source evidence.', responseSchema: INDIA_COMPLIANCE_PROFILE,
    errors: [...INDIA_TAX_BASE_ERRORS, { status: 404, code: 'compliance_rule_profile_not_found', when: 'The profile is outside this company.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/compliance-rule-profiles/:profileId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpIndiaComplianceRuleProfile', summary: 'Approve a compliance rule version',
    description: 'Requires a checker other than the maker, expectedRowVersion, and a non-overlapping effective range.',
    params: { ...INDIA_TAX_PARAMS, profileId: 'Compliance rule profile id.' }, headers: INDIA_TAX_WRITE_HEADERS,
    responseDescription: 'The approved rule profile with checker evidence.', responseSchema: INDIA_COMPLIANCE_PROFILE,
    errors: [...INDIA_TAX_WRITE_ERRORS, { status: 409, code: 'maker_checker_required', when: 'The profile maker attempts approval.' }, { status: 409, code: 'rule_profile_effective_dates_overlap', when: 'An approved version overlaps this date range.' }, { status: 409, code: 'rule_profile_not_approvable', when: 'The profile is no longer a draft.' }],
  },
};

for (const resource of [
  { path: 'e-invoices/outbound', kind: 'outbound e-invoice', operation: 'OutboundEInvoice' },
  { path: 'e-way-bills', kind: 'e-way bill', operation: 'EWayBill' },
  { path: 'e-invoices/inbound', kind: 'inbound supplier e-invoice', operation: 'InboundEInvoice' },
  { path: 'gstr2b', kind: 'GSTR-2B evidence set', operation: 'Gstr2b' },
]) {
  const base = `/api/mesaerp/v1/entities/:legalEntityId/${resource.path}`;
  INDIA_COMPLIANCE_ROUTE_DOCS[`GET ${base}`] = {
    tag: 'MesaERP', operationId: `listMesaErpIndia${resource.operation}s`, summary: `List ${resource.kind} records`,
    description: 'Returns at most 250 company-scoped statutory records with immutable identity/evidence and optimistic row versions.',
    params: INDIA_TAX_PARAMS, responseDescription: `Company ${resource.kind} records.`, responseSchema: arr(INDIA_TAX_DOCUMENT), errors: INDIA_TAX_BASE_ERRORS,
  };
  INDIA_COMPLIANCE_ROUTE_DOCS[`GET ${base}/:documentId`] = {
    tag: 'MesaERP', operationId: `getMesaErpIndia${resource.operation}`, summary: `Get one ${resource.kind}`,
    params: { ...INDIA_TAX_PARAMS, documentId: `${resource.kind} id.` }, responseDescription: `The retained ${resource.kind} record.`, responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_BASE_ERRORS, { status: 404, code: 'tax_document_not_found', when: 'The statutory record is outside this company or of another kind.' }],
  };
}

Object.assign(INDIA_COMPLIANCE_ROUTE_DOCS, {
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-invoices/outbound': {
    tag: 'MesaERP', operationId: 'createMesaErpIndiaOutboundEInvoice', summary: 'Create an outbound e-invoice payload draft', status: 201,
    description: 'Snapshots one approved MesaERP sales invoice, validates the company/customer GSTINs, evaluates the active rule profile, and prevents duplicate document identities. No provider is called.',
    params: INDIA_TAX_PARAMS, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The source-hashed e-invoice draft.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, { status: 404, code: 'sales_invoice_not_found', when: 'The source sales invoice is outside this company.' }, { status: 409, code: 'sales_invoice_not_approved', when: 'The source invoice is not approved.' }, { status: 409, code: 'compliance_rule_profile_missing', when: 'No approved rule version covers the invoice date.' }, { status: 409, code: 'artifact_not_applicable', when: 'The approved profile says this artifact is not applicable.' }, { status: 409, code: 'outbound_e_invoice_identity_exists', when: 'The company GSTIN/document identity already exists.' }, { status: 422, code: 'recipient_gstin_mismatch', when: 'The requested recipient differs from the approved customer snapshot.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-invoices/outbound/:documentId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpIndiaOutboundEInvoice', summary: 'Approve an outbound e-invoice payload',
    description: 'A checker other than the draft maker approves the immutable provider payload locally.',
    params: { ...INDIA_TAX_PARAMS, documentId: 'Outbound e-invoice id.' }, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The approved payload.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, { status: 409, code: 'maker_checker_required', when: 'The payload maker attempts approval.' }, { status: 409, code: 'compliance_document_not_transitionable', when: 'The record is not a draft.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-invoices/outbound/:documentId/submit': {
    tag: 'MesaERP', operationId: 'submitMesaErpIndiaOutboundEInvoice', summary: 'Submit an approved e-invoice through the configured adapter',
    description: 'Calls only the injected authorised provider adapter with the same upstream idempotency key; validates its acknowledgement and commits IRN, signed payload, QR evidence, audit and outbox atomically.',
    params: { ...INDIA_TAX_PARAMS, documentId: 'Outbound e-invoice id.' }, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The acknowledged e-invoice.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_PROVIDER_ERRORS, { status: 409, code: 'compliance_document_not_transitionable', when: 'The payload is not approved.' }, { status: 409, code: 'irn_exists', when: 'The returned IRN already belongs to another company document.' }, { status: 502, code: 'provider_response_invalid', when: 'The adapter returns malformed acknowledgement evidence.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-invoices/outbound/:documentId/import-acknowledgement': {
    tag: 'MesaERP', operationId: 'importMesaErpIndiaOutboundEInvoiceAcknowledgement', summary: 'Import externally verified e-invoice acknowledgement evidence',
    description: 'Fallback for an already-approved payload. The deployment-owned verifier must HMAC-attest the exact tenant, company, evidence kind, tax-document id and retained acknowledgement payload. This attestation is not a government or provider signature.',
    params: { ...INDIA_TAX_PARAMS, documentId: 'Outbound e-invoice id.' }, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The acknowledged e-invoice with externally verified evidence.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_EXTERNAL_EVIDENCE_ACCEPT_ERRORS, { status: 409, code: 'irn_exists', when: 'The imported IRN already belongs to another company document.' }, { status: 422, code: 'signed_payload_hash_mismatch', when: 'The imported evidence differs from its SHA-256 checksum.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-invoices/outbound/:documentId/cancel': {
    tag: 'MesaERP', operationId: 'cancelMesaErpIndiaOutboundEInvoice', summary: 'Cancel an acknowledged e-invoice through the adapter',
    description: 'Submits the IRN and controlled cancellation reason through the provider adapter and appends immutable cancellation evidence.',
    params: { ...INDIA_TAX_PARAMS, documentId: 'Outbound e-invoice id.' }, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The cancelled e-invoice.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_PROVIDER_ERRORS, { status: 409, code: 'maker_checker_required', when: 'The original document maker attempts statutory cancellation.' }, { status: 409, code: 'compliance_document_not_transitionable', when: 'The e-invoice is not acknowledged.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-way-bills': {
    tag: 'MesaERP', operationId: 'createMesaErpIndiaEWayBill', summary: 'Create an e-way-bill payload draft', status: 201,
    description: 'Snapshots an approved invoice or delivery challan, transporter, distance and vehicle data under the active rule profile. No provider is called.',
    params: INDIA_TAX_PARAMS, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The source-hashed e-way-bill draft.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, { status: 404, code: 'movement_document_not_found', when: 'The source movement document is outside this company.' }, { status: 409, code: 'movement_document_not_approved', when: 'The source document is not approved.' }, { status: 409, code: 'compliance_rule_profile_missing', when: 'No approved e-way rule covers the business date.' }, { status: 409, code: 'artifact_not_applicable', when: 'The profile says an e-way bill is not applicable.' }, { status: 409, code: 'e_way_bill_source_exists', when: 'An active or pending e-way bill already exists for the source.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-way-bills/external-evidence': {
    tag: 'MesaERP', operationId: 'createMesaErpIndiaExternalEWayBillEvidence', summary: 'Record externally verified e-way-bill evidence', status: 201,
    description: 'Stores evidence only after a deployment-owned verifier HMAC-attests the exact tenant, company, movement source and retained payload. It remains pending until a separate company checker re-verifies the stored envelope and unexpired validity window. This is not a government or provider signature.',
    params: INDIA_TAX_PARAMS, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The external evidence case awaiting verification.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_EXTERNAL_EVIDENCE_ACCEPT_ERRORS, { status: 409, code: 'e_way_bill_number_exists', when: 'The e-way-bill number already exists.' }, { status: 422, code: 'signed_payload_hash_mismatch', when: 'External evidence differs from its SHA-256 checksum.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-way-bills/:documentId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpIndiaEWayBill', summary: 'Approve an e-way-bill payload',
    description: 'A checker other than the draft maker approves the payload before provider generation.',
    params: { ...INDIA_TAX_PARAMS, documentId: 'E-way-bill id.' }, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The approved e-way-bill payload.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, { status: 409, code: 'maker_checker_required', when: 'The maker attempts approval.' }, { status: 409, code: 'compliance_document_not_transitionable', when: 'The record is not a draft.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-way-bills/:documentId/generate': {
    tag: 'MesaERP', operationId: 'generateMesaErpIndiaEWayBill', summary: 'Generate an approved e-way bill through the adapter',
    description: 'Uses the configured provider adapter and commits the returned number, signed evidence and validity window only after response validation.',
    params: { ...INDIA_TAX_PARAMS, documentId: 'E-way-bill id.' }, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The active e-way bill.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_PROVIDER_ERRORS, { status: 409, code: 'e_way_bill_number_exists', when: 'The provider number already belongs to another record.' }, { status: 502, code: 'provider_response_invalid', when: 'The adapter returns malformed number or validity evidence.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-way-bills/:documentId/verify-external': {
    tag: 'MesaERP', operationId: 'verifyMesaErpIndiaExternalEWayBill', summary: 'Activate externally verified e-way-bill evidence',
    description: 'A checker other than the evidence maker activates an unexpired external reference only after the stored deployment-verifier HMAC envelope is re-verified against the immutable retained payload. No government/provider network call is implied.',
    params: { ...INDIA_TAX_PARAMS, documentId: 'External e-way-bill evidence id.' }, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The active externally issued e-way bill.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_EXTERNAL_EVIDENCE_REVERIFY_ERRORS, { status: 409, code: 'maker_checker_required', when: 'The evidence maker attempts verification.' }, { status: 409, code: 'external_e_way_bill_expired', when: 'The recorded external evidence is already expired.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-way-bills/:documentId/update-vehicle': {
    tag: 'MesaERP', operationId: 'updateMesaErpIndiaEWayBillVehicle', summary: 'Update e-way-bill vehicle details through the adapter',
    description: 'Sends the active number, controlled reason and vehicle snapshot through the provider; appends immutable response evidence.',
    params: { ...INDIA_TAX_PARAMS, documentId: 'Active e-way-bill id.' }, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The active e-way bill with updated vehicle evidence.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_PROVIDER_ERRORS, { status: 409, code: 'e_way_bill_expired', when: 'The bill is no longer valid for a vehicle update.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-way-bills/:documentId/extend': {
    tag: 'MesaERP', operationId: 'extendMesaErpIndiaEWayBill', summary: 'Extend e-way-bill validity through the adapter',
    description: 'Passes the remaining distance, reason, transit location and vehicle snapshot to the provider; legal timing windows remain adapter/provider validated.',
    params: { ...INDIA_TAX_PARAMS, documentId: 'Active e-way-bill id.' }, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The active e-way bill with a later validity timestamp.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_PROVIDER_ERRORS, { status: 502, code: 'provider_response_invalid', when: 'The provider did not return a later validity timestamp.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-way-bills/:documentId/cancel': {
    tag: 'MesaERP', operationId: 'cancelMesaErpIndiaEWayBill', summary: 'Cancel an active e-way bill through the adapter',
    description: 'Sends the active number and controlled reason through the provider and appends immutable cancellation evidence.',
    params: { ...INDIA_TAX_PARAMS, documentId: 'Active e-way-bill id.' }, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The cancelled e-way bill.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_PROVIDER_ERRORS, { status: 409, code: 'maker_checker_required', when: 'The original document maker attempts statutory cancellation.' }, { status: 409, code: 'compliance_document_not_transitionable', when: 'The e-way bill is not active.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-invoices/inbound': {
    tag: 'MesaERP', operationId: 'receiveMesaErpIndiaInboundEInvoice', summary: 'Receive externally verified supplier e-invoice evidence', status: 201,
    description: 'Accepts provider-export, JSON-upload or supplier-portal evidence only with a deployment-owned HMAC attestation bound to the tenant, company, evidence kind, supplier-document identity and retained payload. The attestation is not a government/provider signature. The service also validates checksums and company GSTIN, prevents duplicate identities and optionally links a supplier invoice snapshot.',
    params: INDIA_TAX_PARAMS, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The received inbound e-invoice at pending ITC.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_EXTERNAL_EVIDENCE_ACCEPT_ERRORS, { status: 409, code: 'irn_exists', when: 'The IRN already exists in this company.' }, { status: 409, code: 'supplier_invoice_identity_exists', when: 'The supplier GSTIN/document identity already exists in the financial year.' }, { status: 422, code: 'signed_payload_hash_mismatch', when: 'Signed evidence differs from its SHA-256 checksum.' }, { status: 422, code: 'supplier_invoice_total_mismatch', when: 'The linked supplier invoice total differs.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/gstr2b': {
    tag: 'MesaERP', operationId: 'uploadMesaErpIndiaGstr2b', summary: 'Upload an externally verified GSTR-2B evidence set', status: 201,
    description: 'Stores one return-period evidence set only after checksum validation and a deployment-owned HMAC attestation bound to the tenant, company, period identity and retained payload. The attestation is not a government/provider signature, and this operation does not submit a return or claim credit.',
    params: INDIA_TAX_PARAMS, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The imported GSTR-2B evidence register.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_EXTERNAL_EVIDENCE_ACCEPT_ERRORS, { status: 409, code: 'gstr2b_period_exists', when: 'This recipient GSTIN/return period was already uploaded.' }, { status: 422, code: 'signed_payload_hash_mismatch', when: 'Source evidence differs from its SHA-256 checksum.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-invoices/inbound/:documentId/reconcile-gstr2b': {
    tag: 'MesaERP', operationId: 'reconcileMesaErpIndiaInboundEInvoiceGstr2b', summary: 'Reconcile a supplier e-invoice to GSTR-2B',
    description: 'Re-verifies both stored deployment-verifier envelopes, then matches supplier GSTIN, document identity, optional IRN and Decimal-string totals. It stores eligible, mismatched, blocked, reversed or pending evidence without claiming ITC.',
    params: { ...INDIA_TAX_PARAMS, documentId: 'Inbound supplier e-invoice id.' }, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The reconciled inbound record and ITC state.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_EXTERNAL_EVIDENCE_REVERIFY_ERRORS, { status: 404, code: 'gstr2b_not_found', when: 'The selected GSTR-2B evidence is outside this company.' }, { status: 422, code: 'gstr2b_recipient_mismatch', when: 'The recipient GSTINs differ.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/e-invoices/inbound/:documentId/itc': {
    tag: 'MesaERP', operationId: 'decideMesaErpIndiaInboundEInvoiceItc', summary: 'Record a controlled ITC decision',
    description: 'A checker other than the evidence maker may block or reverse ITC. Marking eligible reconciled ITC claimed additionally re-verifies the stored inbound and selected GSTR-2B deployment-verifier envelopes. This records state only; it does not file a GST return.',
    params: { ...INDIA_TAX_PARAMS, documentId: 'Inbound supplier e-invoice id.' }, headers: INDIA_TAX_WRITE_HEADERS, responseDescription: 'The inbound record with appended ITC decision evidence.', responseSchema: INDIA_TAX_DOCUMENT,
    errors: [...INDIA_TAX_WRITE_ERRORS, ...INDIA_EXTERNAL_EVIDENCE_REVERIFY_ERRORS, { status: 409, code: 'externally_verified_gstr2b_required', when: 'The eligible reconciliation no longer identifies an imported, externally verified GSTR-2B evidence record.' }, { status: 409, code: 'maker_checker_required', when: 'The receipt maker attempts the ITC decision.' }, { status: 409, code: 'itc_not_claimable', when: 'ITC is not currently eligible.' }, { status: 409, code: 'itc_not_reversible', when: 'ITC is neither eligible nor claimed.' }],
  },
} satisfies Record<string, RouteDoc>);

const SUPPLIER_IDEMPOTENCY = { 'Idempotency-Key': 'Required stable 8-128 character key. Retain one key per form intent until success or reset.' };
const SUPPLIER_RESPONSE = { type: 'object', additionalProperties: true };
const SUPPLIER_PORTAL_SESSION_ERRORS: DocumentedError[] = [
  { status: 401, code: 'supplier_unauthenticated', when: 'The httpOnly supplier session cookie is absent.' },
  { status: 401, code: 'supplier_session_invalid', when: 'The supplier session is unknown, revoked or expired.' },
  { status: 403, code: 'supplier_access_denied', when: 'The supplier user or vendor is suspended, revoked or blocked.' },
  { status: 403, code: 'service_not_entitled', when: 'MesaERP is not active for the supplier organization.' },
];
const SUPPLIER_WRITE_ERRORS: DocumentedError[] = [
  ...SUPPLIER_PORTAL_SESSION_ERRORS,
  { status: 400, code: 'idempotency_key_required', when: 'Idempotency-Key is absent or malformed.' },
  { status: 409, code: 'idempotency_conflict', when: 'The key was already committed with another payload.' },
  { status: 429, code: 'rate_limited', when: 'The public supplier endpoint request budget is exhausted.' },
];

const SUPPLIER_PORTAL_ROUTE_DOCS: Record<string, RouteDoc> = {
  'POST /api/supplier-portal/v1/auth/accept': {
    tag: 'Supplier Portal', operationId: 'acceptSupplierPortalInvite', summary: 'Accept a one-time supplier invitation', public: true, status: 201,
    description: 'Hashes the submitted one-time token, consumes the matching unexpired invitation, activates that supplier user and sets a 12-hour httpOnly SameSite=Strict supplier cookie. The raw invite and session tokens are never persisted or returned in the JSON response.',
    responseDescription: 'Vendor-scoped supplier identity and session expiry.', responseSchema: SUPPLIER_RESPONSE,
    errors: [
      { status: 403, code: 'service_not_entitled', when: 'MesaERP is not active for the supplier organization.' },
      { status: 404, code: 'supplier_invite_not_found', when: 'The token digest does not identify an invitation.' },
      { status: 410, code: 'supplier_invite_expired', when: 'The invitation expired.' },
      { status: 410, code: 'supplier_invite_used', when: 'The one-time invitation was already accepted.' },
      { status: 410, code: 'supplier_invite_revoked', when: 'The invitation was revoked.' },
      { status: 429, code: 'rate_limited', when: 'The public supplier endpoint request budget is exhausted.' },
    ],
  },
  'POST /api/supplier-portal/v1/auth/logout': {
    tag: 'Supplier Portal', operationId: 'logoutSupplierPortal', summary: 'Revoke the current supplier session', public: true,
    description: 'Revokes only the current supplier session and clears its isolated cookie; employee sessions are untouched.',
    responseDescription: 'Logout acknowledgement.', responseSchema: ACK, errors: SUPPLIER_PORTAL_SESSION_ERRORS,
  },
  'GET /api/supplier-portal/v1/me': {
    tag: 'Supplier Portal', operationId: 'getSupplierPortalIdentity', summary: 'Get the current supplier identity', public: true,
    description: 'Returns only this portal user, its own vendor profile and explicit supplier permissions. No employee, other-vendor or journal data is reachable.',
    responseDescription: 'Vendor-scoped supplier identity.', responseSchema: SUPPLIER_RESPONSE, errors: SUPPLIER_PORTAL_SESSION_ERRORS,
  },
  'GET /api/supplier-portal/v1/workspace': {
    tag: 'Supplier Portal', operationId: 'getSupplierPortalWorkspace', summary: 'Get the vendor-scoped supplier workspace', public: true,
    description: 'Projects this vendor’s profile, documents, issued RFQs, approved purchase orders, acknowledgements, ASNs, supplier invoices, evidence, change cases, disputes and payment status. Voucher lines, account ids, employee APIs and all other vendors are excluded.',
    responseDescription: 'Supplier collaboration workspace.', responseSchema: SUPPLIER_RESPONSE, errors: SUPPLIER_PORTAL_SESSION_ERRORS,
  },
  'POST /api/supplier-portal/v1/profile-change-cases': {
    tag: 'Supplier Portal', operationId: 'requestSupplierProfileChange', summary: 'Request a controlled vendor-profile change', public: true, status: 201,
    description: 'Creates an internal approval case rather than changing payable master data. Full plaintext bank account numbers are rejected; approved bank cases still require the encrypted internal bank maker-checker flow.',
    headers: SUPPLIER_IDEMPOTENCY, responseDescription: 'Pending vendor change case.', responseSchema: SUPPLIER_RESPONSE, errors: [...SUPPLIER_WRITE_ERRORS, { status: 422, code: 'plaintext_bank_data_forbidden', when: 'A bank proposal contains an unmasked account number.' }],
  },
  'POST /api/supplier-portal/v1/documents': {
    tag: 'Supplier Portal', operationId: 'registerSupplierComplianceDocument', summary: 'Register supplier compliance evidence', public: true, status: 201,
    description: 'Registers an object-storage reference and SHA-256 checksum for internal review. Binary transfer remains the responsibility of the configured storage adapter.',
    headers: SUPPLIER_IDEMPOTENCY, responseDescription: 'Pending vendor-document evidence.', responseSchema: SUPPLIER_RESPONSE, errors: SUPPLIER_WRITE_ERRORS,
  },
  'POST /api/supplier-portal/v1/rfqs/:rfqId/quotations': {
    tag: 'Supplier Portal', operationId: 'submitSupplierQuotation', summary: 'Respond to an invited RFQ', public: true, status: 201,
    description: 'Requires an issued, unexpired invitation owned by this vendor. Every RFQ line must appear exactly once; commercial totals and tax are recalculated with Decimal and stored with technical responses.',
    params: { rfqId: 'RFQ id from this vendor invitation.' }, headers: SUPPLIER_IDEMPOTENCY, responseDescription: 'Submitted supplier quotation with decimal-string totals.', responseSchema: SUPPLIER_RESPONSE,
    errors: [...SUPPLIER_WRITE_ERRORS, { status: 404, code: 'rfq_invitation_not_found', when: 'The vendor has no issued invitation for this RFQ.' }, { status: 410, code: 'rfq_response_closed', when: 'The RFQ response deadline passed.' }, { status: 422, code: 'rfq_lines_incomplete', when: 'A line is missing, repeated or foreign.' }, { status: 422, code: 'tax_amount_mismatch', when: 'A supplied tax amount differs from the Decimal calculation.' }],
  },
  'POST /api/supplier-portal/v1/purchase-orders/:purchaseOrderId/acknowledgements': {
    tag: 'Supplier Portal', operationId: 'acknowledgeSupplierPurchaseOrder', summary: 'Accept or request a purchase-order change', public: true, status: 201,
    description: 'Responds only to an approved purchase order owned by this vendor. A change request records proposed differences without mutating the internal PO.',
    params: { purchaseOrderId: 'Approved purchase-order id owned by this vendor.' }, headers: SUPPLIER_IDEMPOTENCY, responseDescription: 'Supplier PO acknowledgement.', responseSchema: SUPPLIER_RESPONSE,
    errors: [...SUPPLIER_WRITE_ERRORS, { status: 404, code: 'purchase_order_not_found', when: 'The approved PO is not owned by this vendor.' }, { status: 409, code: 'purchase_order_already_acknowledged', when: 'The PO already has a supplier response.' }],
  },
  'POST /api/supplier-portal/v1/asns': {
    tag: 'Supplier Portal', operationId: 'createSupplierAsn', summary: 'Submit an advance shipment notice', public: true, status: 201,
    description: 'Locks the approved purchase-order aggregate, optionally checks its row version, creates a vendor-scoped ASN, and rejects cumulative notified quantities above the ordered quantity even under concurrent submissions.',
    headers: SUPPLIER_IDEMPOTENCY, responseDescription: 'Submitted ASN.', responseSchema: SUPPLIER_RESPONSE,
    errors: [...SUPPLIER_WRITE_ERRORS, { status: 404, code: 'purchase_order_not_found', when: 'The approved PO is not owned by this vendor.' }, { status: 409, code: 'asn_aggregate_invalid', when: 'Retained ASN quantity evidence cannot be safely aggregated.' }, { status: 422, code: 'asn_line_invalid', when: 'An ASN line is foreign to the PO.' }, { status: 422, code: 'asn_line_duplicate', when: 'The request repeats one PO line.' }, { status: 422, code: 'asn_quantity_exceeds_po', when: 'Cumulative ASN quantity exceeds the PO line.' }],
  },
  'POST /api/supplier-portal/v1/supplier-invoices/:supplierInvoiceId/evidence': {
    tag: 'Supplier Portal', operationId: 'registerSupplierInvoiceEvidence', summary: 'Register invoice or e-invoice evidence', public: true, status: 201,
    description: 'Registers an object-storage reference, checksum and external evidence reference against this vendor’s supplier invoice. It does not create accounting journals.',
    params: { supplierInvoiceId: 'Supplier-invoice id owned by this vendor.' }, headers: SUPPLIER_IDEMPOTENCY, responseDescription: 'Registered invoice evidence.', responseSchema: SUPPLIER_RESPONSE,
    errors: [...SUPPLIER_WRITE_ERRORS, { status: 404, code: 'supplier_invoice_not_found', when: 'The invoice is not owned by this vendor.' }],
  },
  'POST /api/supplier-portal/v1/disputes/:disputeId/responses': {
    tag: 'Supplier Portal', operationId: 'respondToSupplierDispute', summary: 'Respond to a vendor dispute or debit-note case', public: true,
    description: 'Appends the vendor response only to an open case belonging to this vendor. Internal resolution remains maker-checker controlled.',
    params: { disputeId: 'Open dispute id owned by this vendor.' }, headers: SUPPLIER_IDEMPOTENCY, responseDescription: 'Dispute with recorded vendor response.', responseSchema: SUPPLIER_RESPONSE,
    errors: [...SUPPLIER_WRITE_ERRORS, { status: 404, code: 'dispute_not_found', when: 'The case is not owned by this vendor.' }, { status: 409, code: 'version_conflict', when: 'The case changed.' }, { status: 409, code: 'dispute_not_open', when: 'The case no longer accepts a supplier response.' }],
  },
};

const SUPPLIER_INTERNAL_ROUTE_DOCS: Record<string, RouteDoc> = {
  'GET /api/mesaerp/v1/entities/:legalEntityId/supplier-workspace': {
    tag: 'MesaERP', operationId: 'getMesaErpSupplierWorkspace', summary: 'Get the internal sourcing and supplier workspace',
    description: 'Returns tenant/company-scoped vendors, RFQs and side-by-side quotations, agreements, POs, acknowledgements, ASNs, compliance expiry, change cases, disputes, payment proposals and raw evidence-derived performance counts. No invented composite score is returned.',
    params: { legalEntityId: 'Legal company id.' }, responseDescription: 'Internal supplier workspace.', responseSchema: SUPPLIER_RESPONSE,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/rfqs': {
    tag: 'MesaERP', operationId: 'createMesaErpRfq', summary: 'Create an RFQ and vendor shortlist', status: 201,
    description: 'Creates a draft RFQ with Decimal quantities, technical specifications and a company-vendor shortlist. Blocked and suspended vendors are rejected.',
    params: { legalEntityId: 'Legal company id.' }, headers: SUPPLIER_IDEMPOTENCY, responseDescription: 'Draft RFQ with lines and shortlist.', responseSchema: SUPPLIER_RESPONSE,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/rfqs/:rfqId/issue': {
    tag: 'MesaERP', operationId: 'issueMesaErpRfq', summary: 'Issue an RFQ to shortlisted vendors',
    description: 'Maker-checker transition: the RFQ creator cannot issue it. The issue snapshots the shortlist and opens only the supplier invitations.',
    params: { legalEntityId: 'Legal company id.', rfqId: 'Draft RFQ id.' }, headers: SUPPLIER_IDEMPOTENCY, responseDescription: 'Issued RFQ.', responseSchema: SUPPLIER_RESPONSE,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/rfqs/:rfqId/select': {
    tag: 'MesaERP', operationId: 'selectMesaErpSupplierQuotation', summary: 'Select a quotation from the comparison',
    description: 'Awards one submitted quotation and rejects the alternatives. The RFQ maker cannot select; an optional rate agreement is created in draft for another checker to activate.',
    params: { legalEntityId: 'Legal company id.', rfqId: 'Issued RFQ id.' }, headers: SUPPLIER_IDEMPOTENCY, responseDescription: 'Awarded RFQ and optional draft agreement.', responseSchema: SUPPLIER_RESPONSE,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/rate-agreements/:agreementId/activate': {
    tag: 'MesaERP', operationId: 'activateMesaErpRateAgreement', summary: 'Activate a selected rate agreement',
    description: 'A separate checker activates the immutable commercial snapshot for its effective dates.', params: { legalEntityId: 'Legal company id.', agreementId: 'Draft rate-agreement id.' }, headers: SUPPLIER_IDEMPOTENCY,
    responseDescription: 'Active rate agreement.', responseSchema: SUPPLIER_RESPONSE,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vendors/:vendorId/portal-invitations': {
    tag: 'MesaERP', operationId: 'inviteMesaErpSupplierPortalUser', summary: 'Create a one-time supplier portal invitation', status: 201,
    description: 'Stores only a SHA-256 token digest. The raw token and relative invite path are returned on the first successful call only; an idempotent replay never returns the secret again. No email is sent.',
    params: { legalEntityId: 'Legal company id.', vendorId: 'Company vendor id.' }, headers: SUPPLIER_IDEMPOTENCY, responseDescription: 'One-time invitation result.', responseSchema: SUPPLIER_RESPONSE,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vendors/:vendorId/documents': {
    tag: 'MesaERP', operationId: 'registerMesaErpVendorDocument', summary: 'Register internal vendor compliance evidence', status: 201,
    description: 'Registers a storage reference and checksum for review and expiry tracking.', params: { legalEntityId: 'Legal company id.', vendorId: 'Company vendor id.' }, headers: SUPPLIER_IDEMPOTENCY,
    responseDescription: 'Pending vendor document.', responseSchema: SUPPLIER_RESPONSE,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vendors/:vendorId/documents/:documentId/review': {
    tag: 'MesaERP', operationId: 'reviewMesaErpVendorDocument', summary: 'Verify or reject vendor compliance evidence',
    description: 'Versioned review with maker-checker enforcement for an internally submitted document.', params: { legalEntityId: 'Legal company id.', vendorId: 'Company vendor id.', documentId: 'Vendor-document id.' }, headers: SUPPLIER_IDEMPOTENCY,
    responseDescription: 'Reviewed vendor document.', responseSchema: SUPPLIER_RESPONSE,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vendor-change-cases/:caseId/decide': {
    tag: 'MesaERP', operationId: 'decideMesaErpVendorChange', summary: 'Decide a sensitive supplier master-data change',
    description: 'Requires the bank-verifier permission as a conservative checker gate. Profile/legal/GSTIN values apply only after approval. Bank approval never changes a verified payable bank account; the encrypted internal bank workflow remains mandatory.',
    params: { legalEntityId: 'Legal company id.', caseId: 'Pending supplier change-case id.' }, headers: SUPPLIER_IDEMPOTENCY, responseDescription: 'Decided change case.', responseSchema: SUPPLIER_RESPONSE,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/disputes': {
    tag: 'MesaERP', operationId: 'createMesaErpVendorDispute', summary: 'Open a vendor dispute or debit-note case', status: 201,
    description: 'Creates an auditable case optionally linked to a supplier invoice and three-way match. It does not post a debit-note journal.', params: { legalEntityId: 'Legal company id.' }, headers: SUPPLIER_IDEMPOTENCY,
    responseDescription: 'Open vendor dispute.', responseSchema: SUPPLIER_RESPONSE,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/disputes/:disputeId/resolve': {
    tag: 'MesaERP', operationId: 'resolveMesaErpVendorDispute', summary: 'Resolve a vendor dispute',
    description: 'Versioned maker-checker decision; an employee who opened the case cannot resolve it.', params: { legalEntityId: 'Legal company id.', disputeId: 'Open dispute id.' }, headers: SUPPLIER_IDEMPOTENCY,
    responseDescription: 'Resolved or rejected dispute.', responseSchema: SUPPLIER_RESPONSE,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/payment-proposals': {
    tag: 'MesaERP', operationId: 'createMesaErpVendorPaymentProposal', summary: 'Create a supplier payment proposal', status: 201,
    description: 'Validates an approved supplier invoice, remaining amount, liability payable account and asset settlement account. It does not create a voucher or initiate a bank payment.', params: { legalEntityId: 'Legal company id.' }, headers: SUPPLIER_IDEMPOTENCY,
    responseDescription: 'Draft payment proposal.', responseSchema: SUPPLIER_RESPONSE,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/payment-proposals/:proposalId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpVendorPaymentProposal', summary: 'Approve a payment proposal into a draft voucher',
    description: 'A separate checker creates one linked balanced draft payment voucher. The voucher still requires normal submit, approve and post; this action never initiates a bank payment.', params: { legalEntityId: 'Legal company id.', proposalId: 'Draft payment-proposal id.' }, headers: SUPPLIER_IDEMPOTENCY,
    responseDescription: 'Approved proposal and linked draft voucher.', responseSchema: SUPPLIER_RESPONSE,
  },
};

const FINANCE_CONTROL_ROUTE_DOCS: Record<string, RouteDoc> = {};
const FINANCE_PARAMS = { legalEntityId: 'Legal company id inside the authenticated organization.' };
const FINANCE_WRITE_HEADERS = { 'Idempotency-Key': 'Required stable key for replay-safe finance mutation (8-128 safe characters).' };
const FINANCE_RESPONSE = { type: 'object', description: 'Company-scoped finance-control response with Decimal values serialized as strings.' };
const financeDoc = (operationId: string, summary: string, options: Partial<RouteDoc> = {}): RouteDoc => ({
  tag: 'MesaERP', operationId, summary, params: FINANCE_PARAMS, responseDescription: summary, responseSchema: FINANCE_RESPONSE, ...options,
});
const financeWrite = (operationId: string, summary: string, permission: string, options: Partial<RouteDoc> = {}): RouteDoc => financeDoc(operationId, summary, {
  headers: FINANCE_WRITE_HEADERS,
  errors: [ERP_EXACT_PERMISSION(permission), { status: 400, code: 'idempotency_key_required', when: 'Idempotency-Key is absent or malformed.' }, { status: 409, code: 'idempotency_conflict', when: 'The key was committed with a different request.' }, { status: 409, code: 'version_conflict', when: 'The expected row version is stale.' }],
  ...options,
});
Object.assign(FINANCE_CONTROL_ROUTE_DOCS, {
  'GET /api/mesaerp/v1/entities/:legalEntityId/accounts/tree': financeDoc('getMesaErpAccountTree', 'Read the company chart-of-accounts tree', { errors: [ERP_EXACT_PERMISSION('mesaerp.account.manage')] }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/accounts': financeWrite('createMesaErpAccount', 'Create a company ledger account', 'mesaerp.account.manage', { status: 201 }),
  'PATCH /api/mesaerp/v1/entities/:legalEntityId/accounts/:accountId': financeWrite('updateMesaErpAccount', 'Update a versioned ledger account', 'mesaerp.account.manage', { params: { ...FINANCE_PARAMS, accountId: 'Ledger account id.' } }),
  'GET /api/mesaerp/v1/entities/:legalEntityId/accounting-periods': financeDoc('listMesaErpAccountingPeriods', 'List company accounting periods', { errors: [ERP_EXACT_PERMISSION('mesaerp.reports.read')] }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/accounting-periods/:periodId/soft-close': financeWrite('softCloseMesaErpAccountingPeriod', 'Soft-close an open accounting period', 'mesaerp.period.manage', { params: { ...FINANCE_PARAMS, periodId: 'Accounting period id.' } }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/accounting-periods/:periodId/lock': financeWrite('lockMesaErpAccountingPeriod', 'Lock a soft-closed accounting period', 'mesaerp.period.manage', { params: { ...FINANCE_PARAMS, periodId: 'Accounting period id.' } }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/accounting-periods/:periodId/reopen': financeWrite('reopenMesaErpAccountingPeriod', 'Reopen a closed accounting period with retained reason', 'mesaerp.period.reopen', { params: { ...FINANCE_PARAMS, periodId: 'Accounting period id.' } }),
  'GET /api/mesaerp/v1/entities/:legalEntityId/bank-reconciliations': financeDoc('listMesaErpBankReconciliations', 'List bank reconciliation cases', { errors: [ERP_EXACT_PERMISSION('mesaerp.banking.manage')] }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/bank-reconciliations': financeWrite('importMesaErpBankStatement', 'Import a source-hashed bank statement', 'mesaerp.banking.manage', { status: 201, description: 'Imports evidence only. This endpoint cannot initiate or transmit a bank payment.' }),
  'GET /api/mesaerp/v1/entities/:legalEntityId/bank-reconciliations/:reconciliationId': financeDoc('getMesaErpBankReconciliation', 'Read line-level reconciliation evidence', { params: { ...FINANCE_PARAMS, reconciliationId: 'Bank reconciliation id.' }, errors: [ERP_EXACT_PERMISSION('mesaerp.banking.manage')] }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/bank-reconciliations/:reconciliationId/lines/:lineId/action': financeWrite('actOnMesaErpBankStatementLine', 'Match, unmatch or explain a bank statement line', 'mesaerp.banking.manage', { params: { ...FINANCE_PARAMS, reconciliationId: 'Bank reconciliation id.', lineId: 'Immutable imported statement line id.' } }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/bank-reconciliations/:reconciliationId/complete': financeWrite('completeMesaErpBankReconciliation', 'Checker-complete a fully resolved bank reconciliation', 'mesaerp.banking.manage', { params: { ...FINANCE_PARAMS, reconciliationId: 'Bank reconciliation id.' }, errors: [ERP_EXACT_PERMISSION('mesaerp.banking.manage'), { status: 409, code: 'maker_checker_required', when: 'The statement importer attempts completion.' }, { status: 409, code: 'reconciliation_unresolved_lines', when: 'At least one line remains unmatched.' }] }),
  'GET /api/mesaerp/v1/entities/:legalEntityId/assets': financeDoc('listMesaErpAssets', 'List company fixed assets', { errors: [ERP_EXACT_PERMISSION('mesaerp.asset.manage')] }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/assets': financeWrite('acquireMesaErpAsset', 'Record a fixed-asset acquisition', 'mesaerp.asset.manage', { status: 201 }),
  'GET /api/mesaerp/v1/entities/:legalEntityId/assets/:assetId': financeDoc('getMesaErpAsset', 'Read an asset and its immutable event history', { params: { ...FINANCE_PARAMS, assetId: 'Fixed asset id.' }, errors: [ERP_EXACT_PERMISSION('mesaerp.asset.manage')] }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/assets/:assetId/capitalize': financeWrite('proposeMesaErpAssetCapitalization', 'Create a linked capitalization voucher draft', 'mesaerp.asset.manage', { params: { ...FINANCE_PARAMS, assetId: 'Fixed asset id.' } }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/assets/:assetId/transfer': financeWrite('transferMesaErpAsset', 'Transfer an active asset with retained evidence', 'mesaerp.asset.manage', { params: { ...FINANCE_PARAMS, assetId: 'Fixed asset id.' } }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/assets/:assetId/depreciation-proposals': financeWrite('proposeMesaErpAssetDepreciation', 'Calculate SLM or WDV depreciation and create a linked draft', 'mesaerp.asset.manage', { params: { ...FINANCE_PARAMS, assetId: 'Fixed asset id.' } }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/assets/:assetId/impairment-proposals': financeWrite('proposeMesaErpAssetImpairment', 'Create a linked impairment voucher draft', 'mesaerp.asset.manage', { params: { ...FINANCE_PARAMS, assetId: 'Fixed asset id.' } }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/assets/:assetId/disposal-proposals': financeWrite('proposeMesaErpAssetDisposal', 'Create a balanced linked disposal voucher draft', 'mesaerp.asset.manage', { params: { ...FINANCE_PARAMS, assetId: 'Fixed asset id.' } }),
  'GET /api/mesaerp/v1/entities/:legalEntityId/budgets': financeDoc('listMesaErpBudgets', 'List company budgets', { errors: [ERP_EXACT_PERMISSION('mesaerp.budget.manage')] }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/budgets': financeWrite('createMesaErpBudget', 'Create an account and dimension budget', 'mesaerp.budget.manage', { status: 201 }),
  'GET /api/mesaerp/v1/entities/:legalEntityId/budgets/:budgetId': financeDoc('getMesaErpBudget', 'Read a company budget', { params: { ...FINANCE_PARAMS, budgetId: 'Budget id.' }, errors: [ERP_EXACT_PERMISSION('mesaerp.budget.manage')] }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/budgets/:budgetId/submit': financeWrite('submitMesaErpBudget', 'Submit a draft budget', 'mesaerp.budget.manage', { params: { ...FINANCE_PARAMS, budgetId: 'Budget id.' } }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/budgets/:budgetId/approve': financeWrite('approveMesaErpBudget', 'Checker-approve a submitted budget', 'mesaerp.budget.manage', { params: { ...FINANCE_PARAMS, budgetId: 'Budget id.' }, errors: [ERP_EXACT_PERMISSION('mesaerp.budget.manage'), { status: 409, code: 'maker_checker_required', when: 'The budget maker attempts approval.' }] }),
  'GET /api/mesaerp/v1/entities/:legalEntityId/budgets/:budgetId/variance': financeDoc('getMesaErpBudgetVariance', 'Compare approved budget lines with posted actuals', { params: { ...FINANCE_PARAMS, budgetId: 'Budget id.' }, errors: [ERP_EXACT_PERMISSION('mesaerp.reports.read')] }),
  'GET /api/mesaerp/v1/entities/:legalEntityId/intercompany-pairs': financeDoc('listMesaErpIntercompanyPairs', 'List linked intercompany draft pairs', { errors: [ERP_EXACT_PERMISSION('mesaerp.intercompany.manage')] }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/intercompany-pairs': financeWrite('createMesaErpIntercompanyPair', 'Create independently balanced draft vouchers in two companies', 'mesaerp.intercompany.manage', { status: 201, description: 'The actor needs explicit permission in both companies. Each voucher retains its own approval and posting lifecycle.' }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/consolidation/report': financeDoc('runMesaErpConsolidationReport', 'Translate supplied company balances with explicit eliminations only', { description: 'Read-only calculation despite POST: caller-supplied effective rates are evidence in the response and no rate is persisted or inferred.', errors: [ERP_EXACT_PERMISSION('mesaerp.consolidation.manage'), { status: 422, code: 'consolidation_fx_rate_invalid', when: 'A selected company lacks a source-backed effective rate.' }] }),
  'POST /api/mesaerp/v1/entities/:legalEntityId/consolidation/elimination-vouchers': financeWrite('createMesaErpConsolidationElimination', 'Create an explicit consolidation-elimination voucher draft', 'mesaerp.consolidation.manage', { status: 201, description: 'Creates a sealed draft through the dedicated consolidation permission. It still requires independent voucher submit, approval and posting.' }),
});
for (const report of ['day-book','general-ledger','trial-balance','profit-and-loss','balance-sheet','cash-bank-book','cash-flow','bill-ageing','dimensions','budget-variance']) {
  const operation = report.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('');
  FINANCE_CONTROL_ROUTE_DOCS[`GET /api/mesaerp/v1/entities/:legalEntityId/reports/${report}`] = financeDoc(`getMesaErp${operation}Report`, `Read the source-backed ${report.replaceAll('-', ' ')} report`, { description: 'Derived from posted and reversed vouchers; no dashboard metrics or balances are fabricated.', errors: [ERP_EXACT_PERMISSION('mesaerp.reports.read')] });
}

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
  'POST /api/auth/admin-login': {
    tag: 'Onboarding',
    operationId: 'platformAdminPasswordLogin',
    summary: 'Platform administrator sign-in',
    description: 'Verifies the email and password, then requires the identity to be explicitly listed in ONBOARDING_ALLOWED_EMAILS and to hold at least one active admin membership. The Auth.js database Session and httpOnly cookie are created only after both authentication and platform authorization succeed.',
    responseDescription: 'The authorized platform administrator context; session cookie is set.',
    public: true,
    responseSchema: obj({
      user: AUTHENTICATED_USER,
    }),
    errors: [
      { status: 400, code: 'invalid_body', when: 'Email or password is missing or outside the accepted bounds.' },
      { status: 401, code: 'invalid_credentials', when: 'Email or password is wrong, or the user has no passwordHash.' },
      { status: 403, code: 'platform_admin_required', when: 'Credentials are valid but the identity is not allowlisted or has no active admin membership. No session is created.' },
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
  'GET /api/operational-orders': {
    tag: 'Planning',
    operationId: 'listOperationalOrders',
    summary: 'List MesaOps operational orders',
    description: 'Lists local, internal, forecast, replenishment, trial, rework, import and optional MesaERP-linked demand without requiring another service.',
    responseDescription: 'MesaOps-owned operational orders with decimal quantities serialized as strings.',
    responseSchema: arr({ type: 'object' }),
  },
  'POST /api/operational-orders': {
    tag: 'Planning',
    operationId: 'createOperationalOrder',
    summary: 'Create standalone MesaOps demand',
    description: 'Creates a local operational order. Machine, shift and operator selection happens later on a production plan.',
    status: 201,
    headers: { 'Idempotency-Key': 'Required stable key (8-128 safe characters) for replay-safe creation.' },
    responseDescription: 'The new operational order.',
    responseSchema: { type: 'object' },
    errors: [
      { status: 400, code: 'idempotency_key_required', when: 'The required idempotency header is absent or malformed.' },
      { status: 409, code: 'order_number_exists', when: 'The order number already exists in this organization.' },
    ],
  },
  'POST /api/operational-orders/handoffs/mesaerp': {
    tag: 'Planning',
    operationId: 'acceptMesaErpOperationalOrderSnapshot',
    summary: 'Accept an optional MesaERP demand snapshot',
    description: 'Internal service route. Requires a short-lived HMAC signature in addition to the employee/session context, verifies the immutable snapshot hash, deduplicates the event, and creates a MesaOps-owned draft without sharing lifecycle status.',
    headers: {
      'x-mesadesk-source-service': 'Must be `mesaerp`.',
      'x-mesadesk-timestamp': 'Unix timestamp within the five-minute replay window.',
      'x-mesadesk-signature': 'Hex HMAC-SHA256 over the tenant, timestamp and canonical payload hash.',
    },
    status: 201,
    responseDescription: 'Accepted, replayed or conflicted handoff result and its local operational order when available.',
    responseSchema: { type: 'object' },
    errors: [
      { status: 401, code: 'invalid_handoff_signature', when: 'The internal service signature is missing, expired or invalid.' },
      { status: 409, code: 'handoff_conflict', when: 'The source changed, event identity was reused, or the destination number already exists.' },
      { status: 422, code: 'source_hash_mismatch', when: 'The supplied hash does not match the canonical snapshot payload.' },
    ],
  },
  'GET /api/operational-orders/handoffs/mesaerp': {
    tag: 'Planning',
    operationId: 'listMesaErpOperationalOrderHandoffs',
    summary: 'List durable MesaERP production-demand proposals',
    description: 'Reads immutable release events directly from the tenant-scoped MesaERP outbox. The caller sees only permitted plants and receives independent linked, conflict or unlinked source state without a live cross-service call.',
    responseDescription: 'Up to 250 verified MesaERP handoff proposals with immutable hashes and inbox state.',
    responseSchema: arr(obj({
      eventId: str, correlationId: str, sourceId: str, sourceSnapshotHash: str,
      snapshot: { type: ['object', 'null'] }, state: { type: 'string', enum: ['unlinked', 'linked', 'conflict'] },
      reason: str, occurredAt: { type: 'string', format: 'date-time' },
    })),
    errors: [
      { status: 403, code: 'forbidden', when: 'The caller lacks the orders-to-plan screen permission or the proposal belongs to another plant scope.' },
    ],
  },
  'POST /api/operational-orders/handoffs/mesaerp/:eventId/accept': {
    tag: 'Planning',
    operationId: 'acceptMesaErpOperationalOrderFromOutbox',
    summary: 'Accept a verified MesaERP outbox proposal',
    description: 'Loads the payload from the durable outbox rather than trusting browser-supplied source assertions. The expected source hash provides optimistic version protection; event and inbox identities make retries idempotent.',
    params: { eventId: 'Immutable MesaERP release-event id.' },
    headers: { 'Idempotency-Key': 'Required stable 8-128 character key. The event id remains the durable cross-service deduplication identity.' },
    status: 201,
    responseDescription: 'The accepted, replayed or conflicted handoff result and local MesaOps operational order.',
    responseSchema: { type: 'object' },
    errors: [
      { status: 400, code: 'idempotency_key_required', when: 'Idempotency-Key is absent or malformed.' },
      { status: 403, code: 'forbidden', when: 'The caller lacks operational-order creation permission or the proposal is outside the permitted plant scope.' },
      { status: 404, code: 'handoff_event_not_found', when: 'The release event is absent from this tenant outbox.' },
      { status: 409, code: 'handoff_source_changed', when: 'expectedSourceSnapshotHash no longer matches the stored immutable proposal.' },
      { status: 409, code: 'handoff_event_integrity_failure', when: 'The stored payload hash does not match its durable outbox evidence.' },
      { status: 409, code: 'handoff_event_identity_mismatch', when: 'The payload wrapper does not match the outbox event, correlation or source identity.' },
      { status: 409, code: 'handoff_conflict', when: 'The event was reused with different source evidence or conflicts with an existing destination.' },
      { status: 422, code: 'validation_error', when: 'expectedSourceSnapshotHash is not a lowercase SHA-256 hash.' },
    ],
  },
  'GET /api/planning/orders': {
    tag: 'Planning',
    operationId: 'listOrdersToPlan',
    summary: 'List orders awaiting planning',
    description: 'MesaOps operational orders in `ready_to_plan` or `partially_planned`, regardless of whether demand started locally or arrived as an optional snapshot.',
    responseDescription: 'The planning queue.',
    responseSchema: arr({ type: 'object' }),
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
    responseSchema: arr({ type: 'object' }),
  },
  'POST /api/plans': {
    tag: 'Planning',
    operationId: 'createPlan',
    summary: 'Schedule an order onto a machine and shift',
    description: 'Allocates part or all of an operational order to a machine and shift, captures an immutable execution snapshot, and seeds a draft logbook. One machine can hold only one plan per shift per day.',
    status: 201,
    headers: { 'Idempotency-Key': 'Required stable key (8-128 safe characters) for replay-safe creation.' },
    responseDescription: 'The scheduled plan.',
    responseSchema: { type: 'object' },
    errors: [
      NOT_FOUND('order'),
      { status: 400, code: 'idempotency_key_required', when: 'The required idempotency header is absent or malformed.' },
      { status: 409, code: 'version_conflict', when: 'The expected operational-order version is stale.' },
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
    headers: { 'Idempotency-Key': 'Required stable key (8-128 safe characters) for replay-safe update.' },
    responseDescription: 'The updated plan.',
    responseSchema: { type: 'object' },
    errors: [
      NOT_FOUND('plan'),
      { status: 409, code: 'version_conflict', when: 'The expected plan version is stale.' },
      { status: 409, code: 'plan_locked', when: 'The plan is not scheduled or its logbook is submitted.' },
      { status: 409, code: 'already_started', when: 'The schedule start time has passed.' },
      { status: 409, code: 'double_booked', when: 'That machine, shift and day are already booked.' },
    ],
  },
  'POST /api/plans/:id/release': {
    tag: 'Planning',
    operationId: 'releasePlan',
    summary: 'Release a plan back to the queue',
    description: 'Deletes the plan and its draft logbook, then recalculates the MesaOps operational order as ready, partially planned or planned.',
    params: { id: 'Production plan id.' },
    headers: { 'Idempotency-Key': 'Required stable key (8-128 safe characters) for replay-safe release.' },
    responseDescription: 'Confirmation that the plan was released.',
    responseSchema: ACK,
    errors: [
      NOT_FOUND('plan'),
      { status: 409, code: 'version_conflict', when: 'The expected plan version is stale.' },
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
    description: 'Orders with a positive quantity bounded by submitted production, packed-lot evidence, QA pass and prior dispatches.',
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
    description: 'Row-locks the operational order, rechecks the explicit quantity against completed + packed + QA-released evidence, applies the most-specific effective approved country/plant/movement profile, and books the gate pass and finished-goods OUT movement atomically. Production fails closed when no profile exists. Statutory references are accepted only in HMAC-verified MesaERP/external evidence.',
    status: 201,
    headers: { 'Idempotency-Key': 'Required stable key (8-128 safe characters) for replay-safe dispatch.' },
    responseDescription: 'The dispatch record, including its document reference (legacy field name `invoiceNumber`).',
    responseModel: 'DispatchRecord', responseIncludes: ['salesOrder'],
    errors: [
      NOT_FOUND('order'),
      { status: 400, code: 'idempotency_key_required', when: 'The required idempotency header is absent or malformed.' },
      { status: 409, code: 'version_conflict', when: 'The expected operational-order version is stale.' },
      { status: 409, code: 'already_dispatched', when: 'The order has already shipped.' },
      { status: 409, code: 'quantity_not_released', when: 'The quantity exceeds completed, packed, QA-released and undispatched evidence.' },
      { status: 409, code: 'statutory_rule_profile_missing', when: 'Production has no approved profile for the country, plant, movement and business date.' },
      { status: 409, code: 'statutory_artifact_required', when: 'The active server-side legal profile requires verified evidence.' },
      { status: 409, code: 'statutory_profile_stale', when: 'The verified evidence was issued under a different profile version.' },
      { status: 409, code: 'invoice_reference_required', when: 'The active profile requires a verified invoice reference.' },
      { status: 409, code: 'eway_bill_reference_required', when: 'The active profile requires a verified e-way-bill reference.' },
      { status: 409, code: 'eway_bill_validity_required', when: 'The active profile requires a verified e-way-bill validity timestamp.' },
      { status: 409, code: 'eway_bill_evidence_expired', when: 'The verified e-way-bill evidence expired before physical dispatch.' },
      { status: 422, code: 'statutory_evidence_hash_mismatch', when: 'The supplied artifact differs from its declared SHA-256 hash.' },
      { status: 422, code: 'unverified_statutory_evidence', when: 'The statutory artifact is not signed by an approved verifier.' },
      { status: 503, code: 'statutory_verifier_unavailable', when: 'The deployment-owned evidence HMAC credential is missing.' },
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

  // ── MesaERP ──────────────────────────────────────────────────────────────
  'GET /api/mesaops/role-assignments': {
    tag: 'Administration',
    operationId: 'listMesaOpsRoleAssignments',
    summary: 'List MesaOps role and plant assignments',
    description: 'Returns only assignments whose server-owned service id is `mesaops`. An active assignment with no company, plant or warehouse scope grants all plants. Production has no implicit fallback: zero MesaOps assignment history denies every plant. The additive migration records eligible legacy access explicitly against a permissionless scope role; local/test compatibility requires an explicit environment opt-in.',
    responseDescription: 'MesaOps assignments in the caller’s organization.',
    responseModel: 'RoleAssignment', responseIsArray: true, responseIncludes: ['membership', 'role'],
  },
  'POST /api/mesaops/role-assignments': {
    tag: 'Administration',
    operationId: 'createMesaOpsRoleAssignment',
    summary: 'Assign a MesaOps role and plant scope',
    description: 'The service id is fixed to `mesaops` and company/warehouse scope fields are not accepted. MesaERP roles are rejected.',
    status: 201,
    headers: { 'Idempotency-Key': 'Stable key for safely retrying this exact assignment request.' },
    responseDescription: 'The created MesaOps role assignment.',
    responseModel: 'RoleAssignment', responseIncludes: ['membership', 'role'],
    errors: [
      { status: 400, code: 'idempotency_key_required', when: 'The Idempotency-Key header is absent or malformed.' },
      { status: 409, code: 'idempotency_conflict', when: 'The key was already used with different assignment input.' },
      { status: 409, code: 'assignment_exists', when: 'The same employee, role and plant scope already has an active assignment.' },
      { status: 409, code: 'mesaerp_role_forbidden', when: 'The referenced role belongs to MesaERP.' },
      { status: 422, code: 'bad_membership', when: 'The employee is missing, inactive or belongs to another organization.' },
      { status: 422, code: 'bad_role', when: 'The role is missing or belongs to another organization.' },
      { status: 422, code: 'invalid_validity_window', when: 'validTo precedes validFrom.' },
    ],
  },
  'POST /api/mesaops/role-assignments/:id/revoke': {
    tag: 'Administration',
    operationId: 'revokeMesaOpsRoleAssignment',
    summary: 'Revoke a MesaOps role assignment',
    description: 'Locks and version-checks an active MesaOps assignment. A MesaERP assignment id is deliberately indistinguishable from an unknown id on this route.',
    params: { id: 'MesaOps role-assignment id.' },
    headers: { 'Idempotency-Key': 'Stable key for safely retrying this exact revoke request.' },
    responseDescription: 'The revoked MesaOps role assignment.',
    responseModel: 'RoleAssignment', responseIncludes: ['membership', 'role'],
    errors: [
      NOT_FOUND('MesaOps role assignment'),
      { status: 400, code: 'idempotency_key_required', when: 'The Idempotency-Key header is absent or malformed.' },
      { status: 409, code: 'idempotency_conflict', when: 'The key was already used with different revoke input.' },
      { status: 409, code: 'already_revoked', when: 'The assignment is no longer active.' },
      { status: 409, code: 'version_conflict', when: 'The expected row version is stale.' },
    ],
  },
  'GET /api/mesaops/admin/statutory-rule-profiles': {
    tag: 'Administration',
    operationId: 'listMesaOpsStatutoryRuleProfiles',
    summary: 'List MesaOps statutory applicability versions',
    description: 'Lists tenant-owned draft and approved country/plant/movement profiles. Dispatch selects only an effective approved version and never reads Organization.settings for applicability.',
    responseDescription: 'MesaOps statutory rule profiles in this organization.',
    responseModel: 'MesaOpsStatutoryRuleProfile', responseIsArray: true,
  },
  'GET /api/mesaops/admin/statutory-rule-profiles/:id': {
    tag: 'Administration',
    operationId: 'getMesaOpsStatutoryRuleProfile',
    summary: 'Get one MesaOps statutory applicability version',
    params: { id: 'MesaOps statutory rule profile id.' },
    responseDescription: 'The tenant-scoped statutory rule version.',
    responseModel: 'MesaOpsStatutoryRuleProfile',
    errors: [{ status: 404, code: 'statutory_rule_profile_not_found', when: 'The profile does not exist in this organization.' }],
  },
  'POST /api/mesaops/admin/statutory-rule-profiles': {
    tag: 'Administration',
    operationId: 'createMesaOpsStatutoryRuleProfile',
    summary: 'Create a MesaOps statutory rule draft',
    description: 'Creates an evidence-hashed draft. A profile with no required artifacts must carry an explicit reviewed exemption reason; absence of a profile is never an exemption in production.',
    status: 201,
    headers: { 'Idempotency-Key': 'Stable key for safely retrying this exact statutory rule draft.' },
    responseDescription: 'The immutable-content draft statutory profile.',
    responseModel: 'MesaOpsStatutoryRuleProfile',
    errors: [
      { status: 400, code: 'idempotency_key_required', when: 'The Idempotency-Key header is absent or malformed.' },
      { status: 409, code: 'idempotency_conflict', when: 'The key was already used with different profile content.' },
      { status: 409, code: 'statutory_rule_profile_version_exists', when: 'The version already exists in this organization.' },
      { status: 422, code: 'source_checksum_mismatch', when: 'The source evidence differs from its declared SHA-256 checksum.' },
    ],
  },
  'POST /api/mesaops/admin/statutory-rule-profiles/:id/approve': {
    tag: 'Administration',
    operationId: 'approveMesaOpsStatutoryRuleProfile',
    summary: 'Approve and freeze a MesaOps statutory rule version',
    description: 'Uses row-version compare-and-swap and a different checker membership. Approved content cannot be changed or deleted; changes require a new version.',
    params: { id: 'MesaOps statutory rule profile id.' },
    headers: { 'Idempotency-Key': 'Stable key for safely retrying this exact approval.' },
    responseDescription: 'The approved immutable statutory profile.',
    responseModel: 'MesaOpsStatutoryRuleProfile',
    errors: [
      { status: 400, code: 'idempotency_key_required', when: 'The Idempotency-Key header is absent or malformed.' },
      { status: 404, code: 'statutory_rule_profile_not_found', when: 'The profile does not exist in this organization.' },
      { status: 409, code: 'idempotency_conflict', when: 'The key was already used with different approval input.' },
      { status: 409, code: 'maker_checker_required', when: 'The draft maker attempts to approve the same version.' },
      { status: 409, code: 'version_conflict', when: 'The expected row version is stale.' },
      { status: 409, code: 'statutory_rule_profile_effective_start_exists', when: 'An approved exact-scope profile already starts on that date.' },
      { status: 409, code: 'statutory_rule_profile_not_transitionable', when: 'The profile is not a draft.' },
    ],
  },
  ...SOURCE_TO_PAY_ROUTE_DOCS,
  ...COMMERCIAL_MANUFACTURING_ROUTE_DOCS,
  ...VALUED_INVENTORY_ROUTE_DOCS,
  ...MRP_ROUTE_DOCS,
  ...INDIA_COMPLIANCE_ROUTE_DOCS,
  ...FINANCE_CONTROL_ROUTE_DOCS,
  ...SUPPLIER_PORTAL_ROUTE_DOCS,
  ...SUPPLIER_INTERNAL_ROUTE_DOCS,
  'GET /api/mesaerp/v1/entities': {
    tag: 'MesaERP',
    operationId: 'listMesaErpEntities',
    summary: 'List accessible legal companies',
    description: 'Company-scoped MesaERP access is explicit and default-deny. Organization tenancy remains the outer isolation boundary.',
    responseDescription: 'Active legal entities available to the caller.',
    responseSchema: arr(obj({
      id: str, organizationId: str, code: str, name: str, countryCode: str,
      baseCurrency: str, fiscalYearStartMonth: int, version: int,
      createdAt: { type: 'string', format: 'date-time' },
    })),
    errors: [{ status: 403, code: 'service_not_enabled', when: 'MesaERP is not independently entitled for the organization.' }],
  },
  'POST /api/mesaerp/v1/entities': {
    tag: 'MesaERP',
    operationId: 'createMesaErpEntity',
    summary: 'Create a legal company',
    description: 'Creates the company, its current fiscal year, monthly periods and a minimal manufacturing chart of accounts atomically.',
    status: 201,
    headers: { 'Idempotency-Key': 'Required stable key (8-128 safe characters).' },
    responseDescription: 'The created legal entity.',
    responseSchema: { type: 'object' },
    errors: [
      { status: 400, code: 'idempotency_key_required', when: 'The required idempotency header is absent or malformed.' },
      { status: 409, code: 'legal_entity_code_exists', when: 'The company code already exists in the group tenant.' },
    ],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/accounts': {
    tag: 'MesaERP', operationId: 'listMesaErpAccounts', summary: 'List active posting accounts',
    params: { legalEntityId: 'Legal entity id.' }, responseDescription: 'The company chart of accounts available to voucher entry.',
    responseSchema: arr({ type: 'object' }),
    errors: [{ status: 404, code: 'legal_entity_not_found', when: 'The legal company is outside the tenant.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/vouchers': {
    tag: 'MesaERP', operationId: 'listMesaErpVouchers', summary: 'List recent accounting vouchers',
    description: 'Returns up to 250 company-scoped vouchers with ordered decimal-string lines and maker-checker status.',
    params: { legalEntityId: 'Legal entity id.' }, responseDescription: 'Recent company vouchers.',
    responseSchema: arr({ type: 'object' }),
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vouchers': {
    tag: 'MesaERP',
    operationId: 'createMesaErpVoucher',
    summary: 'Create a balanced voucher draft',
    description: 'Accepts decimal strings only. Every line is one-sided and total debit must equal total credit before a draft is stored.',
    status: 201,
    params: { legalEntityId: 'Legal entity id.' },
    headers: { 'Idempotency-Key': 'Required stable key for replay-safe creation.' },
    responseDescription: 'The balanced draft voucher.',
    responseSchema: { type: 'object' },
    errors: [
      { status: 404, code: 'legal_entity_not_found', when: 'The company is not in the caller organization.' },
      { status: 409, code: 'period_closed', when: 'The business date belongs to a non-open period.' },
      { status: 422, code: 'ledger_account_missing', when: 'One or more posting accounts are unknown or inactive.' },
      { status: 422, code: 'unbalanced_voucher', when: 'Debit and credit do not balance.' },
    ],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/vouchers/:voucherId': {
    tag: 'MesaERP',
    operationId: 'getMesaErpVoucher',
    summary: 'Get one accounting voucher',
    params: { legalEntityId: 'Legal entity id.', voucherId: 'Voucher id.' },
    responseDescription: 'The company-scoped voucher with decimal strings and ordered lines.',
    responseSchema: { type: 'object' },
    errors: [{ status: 404, code: 'voucher_not_found', when: 'The voucher is outside the company scope or does not exist.' }],
  },
  'PATCH /api/mesaerp/v1/entities/:legalEntityId/vouchers/:voucherId': {
    tag: 'MesaERP',
    operationId: 'updateMesaErpVoucher',
    summary: 'Edit a voucher draft',
    params: { legalEntityId: 'Legal entity id.', voucherId: 'Voucher id.' },
    headers: { 'Idempotency-Key': 'Required stable key for this edit request.' },
    responseDescription: 'The updated voucher with an incremented row version.',
    responseSchema: { type: 'object' },
    errors: [
      { status: 409, code: 'version_conflict', when: 'The expected row version is stale.' },
      { status: 409, code: 'posted_immutable', when: 'The voucher is already posted or reversed.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vouchers/:voucherId/submit': {
    tag: 'MesaERP',
    operationId: 'submitMesaErpVoucher',
    summary: 'Submit a voucher for independent approval',
    description: 'Validates the balanced draft and moves it into the maker-checker approval queue. Submitted vouchers cannot be edited.',
    params: { legalEntityId: 'Legal entity id.', voucherId: 'Voucher id.' },
    headers: { 'Idempotency-Key': 'Required stable key for replay-safe submission.' },
    responseDescription: 'The submitted voucher with an incremented row version.',
    responseSchema: { type: 'object' },
    errors: [
      { status: 409, code: 'voucher_not_submittable', when: 'The voucher is not a draft.' },
      { status: 409, code: 'version_conflict', when: 'The expected row version is stale.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vouchers/:voucherId/approve': {
    tag: 'MesaERP',
    operationId: 'approveMesaErpVoucher',
    summary: 'Approve a submitted voucher',
    description: 'Enforces maker-checker separation: the membership that created the voucher cannot approve it.',
    params: { legalEntityId: 'Legal entity id.', voucherId: 'Voucher id.' },
    headers: { 'Idempotency-Key': 'Required stable key for replay-safe approval.' },
    responseDescription: 'The approved voucher with immutable approval evidence.',
    responseSchema: { type: 'object' },
    errors: [
      { status: 409, code: 'maker_checker_required', when: 'The voucher maker attempts to approve the voucher.' },
      { status: 409, code: 'voucher_not_approvable', when: 'The voucher is not submitted.' },
      { status: 409, code: 'version_conflict', when: 'The expected row version is stale.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vouchers/:voucherId/post': {
    tag: 'MesaERP',
    operationId: 'postMesaErpVoucher',
    summary: 'Post a balanced voucher immutably',
    description: 'Posts only an approved voucher, allocates a concurrency-safe company/fiscal-year number, freezes a hashable journal snapshot and emits a durable outbox event.',
    params: { legalEntityId: 'Legal entity id.', voucherId: 'Voucher id.' },
    headers: { 'Idempotency-Key': 'Required stable key for replay-safe posting.' },
    responseDescription: 'The posted voucher and immutable journal projection.',
    responseSchema: { type: 'object' },
    errors: [
      { status: 409, code: 'voucher_not_postable', when: 'The voucher has not completed maker-checker approval.' },
      { status: 409, code: 'version_conflict', when: 'The voucher changed during posting.' },
      { status: 409, code: 'period_closed', when: 'The accounting period is not open.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vouchers/:voucherId/reversals': {
    tag: 'MesaERP',
    operationId: 'createMesaErpVoucherReversal',
    summary: 'Create a controlled reversal draft',
    description: 'Copies a posted voucher into a new draft with every debit and credit swapped. The reversal must complete its own submit, independent approval and post lifecycle; only posting it marks the original voucher reversed. The original journal is never edited.',
    status: 201,
    params: { legalEntityId: 'Legal entity id.', voucherId: 'Posted voucher id to reverse.' },
    headers: { 'Idempotency-Key': 'Required stable key for replay-safe reversal creation.' },
    responseDescription: 'The balanced reversal draft linked to the original voucher.',
    responseSchema: { type: 'object' },
    errors: [
      { status: 409, code: 'voucher_not_reversible', when: 'The original voucher is not posted or was already reversed.' },
      { status: 409, code: 'reversal_exists', when: 'A reversal draft already exists for the original voucher.' },
      { status: 409, code: 'version_conflict', when: 'The expected original voucher version is stale.' },
      { status: 409, code: 'period_closed', when: 'The chosen reversal date belongs to a non-open accounting period.' },
    ],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/vouchers/:voucherId/journal-entry': {
    tag: 'MesaERP',
    operationId: 'getMesaErpJournalEntry',
    summary: 'Read a posted journal projection',
    params: { legalEntityId: 'Legal entity id.', voucherId: 'Voucher id.' },
    responseDescription: 'The immutable posted journal and its snapshot hash.',
    responseSchema: { type: 'object' },
    errors: [{ status: 409, code: 'voucher_not_posted', when: 'The voucher is still a draft.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/vendors': {
    tag: 'MesaERP', operationId: 'listMesaErpVendors', summary: 'List company vendors',
    description: 'Returns only vendors inside the caller organization and legal company, including masked bank-account states.',
    params: { legalEntityId: 'Legal entity id.' }, responseDescription: 'The vendor register.',
    responseSchema: arr({ type: 'object' }),
    errors: [{ status: 404, code: 'legal_entity_not_found', when: 'The legal company is outside the tenant.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vendors': {
    tag: 'MesaERP', operationId: 'createMesaErpVendor', summary: 'Invite a vendor',
    description: 'Creates a company-scoped vendor at the invited lifecycle state with idempotency and audit evidence.',
    params: { legalEntityId: 'Legal entity id.' }, headers: { 'Idempotency-Key': 'Required stable key for replay-safe creation.' },
    status: 201, responseDescription: 'The invited vendor.', responseSchema: { type: 'object' },
    errors: [{ status: 409, code: 'idempotency_conflict', when: 'The key was reused with a different vendor payload.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vendors/:vendorId/lifecycle': {
    tag: 'MesaERP', operationId: 'transitionMesaErpVendor', summary: 'Move a vendor through controlled onboarding',
    description: 'Enforces the invited-to-approved lifecycle, optimistic row versions and a separate checker for approval, suspension and blocking decisions.',
    params: { legalEntityId: 'Legal entity id.', vendorId: 'Vendor id.' }, headers: { 'Idempotency-Key': 'Required stable transition key.' },
    responseDescription: 'The updated vendor and lifecycle version.', responseSchema: { type: 'object' },
    errors: [
      { status: 409, code: 'maker_checker_violation', when: 'The maker attempts a controlled decision.' },
      { status: 409, code: 'invalid_vendor_transition', when: 'The requested lifecycle move is not allowed.' },
      { status: 409, code: 'version_conflict', when: 'The expected vendor row version is stale.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vendors/:vendorId/bank-accounts': {
    tag: 'MesaERP', operationId: 'addMesaErpVendorBank', summary: 'Submit a vendor bank account',
    description: 'Encrypts the account number using the deployment key, returns only a masked value and creates a pending verification case.',
    params: { legalEntityId: 'Legal entity id.', vendorId: 'Vendor id.' }, headers: { 'Idempotency-Key': 'Required stable bank-change key.' },
    status: 201, responseDescription: 'The masked pending bank account.', responseSchema: { type: 'object' },
    errors: [
      { status: 409, code: 'vendor_blocked', when: 'The vendor is blocked.' },
      { status: 503, code: 'bank_encryption_not_configured', when: 'The deployment secret is unavailable or invalid.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vendors/:vendorId/bank-accounts/:bankAccountId/verify': {
    tag: 'MesaERP', operationId: 'verifyMesaErpVendorBank', summary: 'Verify or reject a vendor bank account',
    description: 'Requires a different actor from the bank-detail maker and records the verification reference, decision reason and row version.',
    params: { legalEntityId: 'Legal entity id.', vendorId: 'Vendor id.', bankAccountId: 'Vendor bank account id.' },
    headers: { 'Idempotency-Key': 'Required stable verification key.' }, responseDescription: 'The decided masked bank account.', responseSchema: { type: 'object' },
    errors: [
      { status: 409, code: 'maker_checker_violation', when: 'The bank-detail maker attempts verification.' },
      { status: 409, code: 'bank_already_decided', when: 'The account has already been verified or rejected.' },
    ],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/access/permissions': {
    tag: 'MesaERP', operationId: 'listMesaErpPermissions', summary: 'List the exact MesaERP permission catalogue',
    params: { legalEntityId: 'Legal entity id.' }, responseDescription: 'Namespaced permissions and risk levels.',
    responseSchema: arr({ type: 'object' }),
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/access/roles': {
    tag: 'MesaERP', operationId: 'listMesaErpRoles', summary: 'List configurable MesaERP roles',
    params: { legalEntityId: 'Legal entity id.' }, responseDescription: 'Tenant roles with exact grants and optimistic versions.',
    responseSchema: arr({ type: 'object' }),
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/access/roles': {
    tag: 'MesaERP', operationId: 'createMesaErpRole', summary: 'Create a company-scoped MesaERP role',
    description: 'Creates a non-system role for one legal company from exact namespaced MesaERP allow grants. Missing permissions remain denied by default.',
    params: { legalEntityId: 'Legal entity id.' },
    headers: { 'Idempotency-Key': 'Required stable key for replay-safe role creation.' },
    status: 201,
    responseDescription: 'The created company role with its exact grants and initial version.',
    responseSchema: { type: 'object' },
    errors: [
      { status: 400, code: 'idempotency_key_required', when: 'The required idempotency header is absent or malformed.' },
      { status: 404, code: 'legal_entity_not_found', when: 'The legal company is outside the authenticated tenant.' },
      { status: 409, code: 'idempotency_conflict', when: 'The same key was already committed with a different role payload.' },
      { status: 409, code: 'role_name_exists', when: 'The organization already contains a role with this name.' },
      { status: 422, code: 'unknown_erp_permission', when: 'A requested grant is outside the exact MesaERP permission catalogue.' },
    ],
  },
  'PUT /api/mesaerp/v1/entities/:legalEntityId/access/roles/:roleId/permissions': {
    tag: 'MesaERP', operationId: 'replaceMesaErpRolePermissions', summary: 'Replace a role’s MesaERP grants',
    description: 'Full replacement from the namespaced permission catalogue. Missing permissions remain denied by default.',
    params: { legalEntityId: 'Legal entity id.', roleId: 'Tenant role id.' }, headers: { 'Idempotency-Key': 'Required stable permission-change key.' },
    responseDescription: 'The role with its new exact grants and incremented version.', responseSchema: { type: 'object' },
    errors: [
      { status: 409, code: 'version_conflict', when: 'The role version is stale.' },
      { status: 422, code: 'unknown_erp_permission', when: 'A requested grant is outside the MesaERP catalogue.' },
    ],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/access/role-assignments': {
    tag: 'MesaERP', operationId: 'listMesaErpRoleAssignments', summary: 'List company role assignments',
    description: 'Shows company-specific and organization-wide MesaERP assignments with their effective exact grants.',
    params: { legalEntityId: 'Legal entity id.' }, responseDescription: 'Company role assignments and row versions.',
    responseSchema: arr({ type: 'object' }),
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/access/role-assignments': {
    tag: 'MesaERP', operationId: 'assignMesaErpRole', summary: 'Assign a company-scoped MesaERP role',
    description: 'The role must belong to the tenant and contain at least one explicit MesaERP allow grant.',
    params: { legalEntityId: 'Legal entity id.' }, headers: { 'Idempotency-Key': 'Required stable assignment key.' },
    status: 201, responseDescription: 'The active company role assignment.', responseSchema: { type: 'object' },
    errors: [
      { status: 409, code: 'role_already_assigned', when: 'The same company assignment is already active.' },
      { status: 422, code: 'role_has_no_erp_permissions', when: 'The selected role has no explicit MesaERP grants.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/access/role-assignments/:assignmentId/revoke': {
    tag: 'MesaERP', operationId: 'revokeMesaErpRole', summary: 'Revoke a company-scoped MesaERP role',
    description: 'Uses an integer row version and retains the revoker, timestamp and reason as audit evidence.',
    params: { legalEntityId: 'Legal entity id.', assignmentId: 'Role assignment id.' }, headers: { 'Idempotency-Key': 'Required stable revocation key.' },
    responseDescription: 'The revoked role assignment.', responseSchema: { type: 'object' },
    errors: [
      { status: 409, code: 'role_assignment_inactive', when: 'The assignment is already inactive.' },
      { status: 409, code: 'version_conflict', when: 'The expected assignment version is stale.' },
    ],
  },

  // ── MesaOps → MesaERP return handoffs + India TDS evidence ──────────────
  'GET /api/mesaerp/v1/entities/:legalEntityId/handoff-mappings': {
    tag: 'MesaERP', operationId: 'listMesaErpHandoffMappings', summary: 'List MesaOps-to-ERP master mappings',
    description: 'Lists explicit item, UOM, warehouse and customer mappings for one company. No source value is inferred.',
    params: { legalEntityId: 'Target ERP legal entity id.' }, responseDescription: 'The company mapping register.',
    responseModel: 'ErpHandoffMapping', responseIsArray: true,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/handoff-mappings': {
    tag: 'MesaERP', operationId: 'createMesaErpHandoffMapping', summary: 'Propose a validated handoff mapping', status: 201,
    description: 'Creates an inactive draft binding from one normalized MesaOps source value to a same-company ERP master or explicit ERP UOM. A different checker must approve it before it can be used.',
    params: { legalEntityId: 'Target ERP legal entity id.' }, headers: { 'Idempotency-Key': 'Required stable mapping-creation key.' },
    responseDescription: 'The validated mapping.', responseModel: 'ErpHandoffMapping',
    errors: [
      { status: 409, code: 'handoff_mapping_exists', when: 'The source value already has a company mapping.' },
      { status: 422, code: 'handoff_mapping_target_invalid', when: 'The target master is missing, inactive or outside the company.' },
    ],
  },
  'PATCH /api/mesaerp/v1/entities/:legalEntityId/handoff-mappings/:mappingId': {
    tag: 'MesaERP', operationId: 'updateMesaErpHandoffMapping', summary: 'Propose a mapping update or deactivation',
    description: 'Moves the mapping to an inactive draft proposal. Existing target changes and deactivation requests take effect only after separate checker approval.',
    params: { legalEntityId: 'Target ERP legal entity id.', mappingId: 'Handoff mapping id.' }, headers: { 'Idempotency-Key': 'Required stable mapping-update key.' },
    responseDescription: 'The mapping with an incremented row version.', responseModel: 'ErpHandoffMapping',
    errors: [
      { status: 404, code: 'handoff_mapping_not_found', when: 'The mapping does not exist in this company.' },
      { status: 409, code: 'version_conflict', when: 'The expected mapping row version is stale.' },
      { status: 409, code: 'handoff_mapping_proposal_pending', when: 'Another maker owns the current unapproved proposal.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/handoff-mappings/:mappingId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpHandoffMapping', summary: 'Approve a handoff mapping proposal',
    description: 'Revalidates the proposal hash and target, then applies its requested active state. The proposal maker cannot approve it.',
    params: { legalEntityId: 'Target ERP legal entity id.', mappingId: 'Handoff mapping id.' }, headers: { 'Idempotency-Key': 'Required stable mapping-approval key.' },
    responseDescription: 'The approved mapping with an incremented row version.', responseModel: 'ErpHandoffMapping',
    errors: [
      { status: 404, code: 'handoff_mapping_not_found', when: 'The mapping does not exist in this company.' },
      { status: 409, code: 'maker_checker_required', when: 'The proposal maker attempts to approve the same mapping.' },
      { status: 409, code: 'handoff_mapping_evidence_changed', when: 'The reviewed proposal no longer matches its evidence hash.' },
      { status: 409, code: 'version_conflict', when: 'The expected mapping row version is stale.' },
    ],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/handoff-event-routes': {
    tag: 'MesaERP', operationId: 'listMesaErpHandoffEventRoutes', summary: 'List standalone-event company routing decisions',
    description: 'Lists routing evidence only for this company. Unrouted tenant-wide MesaOps events are never exposed by this endpoint or the inbox.',
    params: { legalEntityId: 'Target ERP legal entity id.' }, responseDescription: 'Draft and approved event-routing decisions.',
    responseModel: 'ErpHandoffEventRoute', responseIsArray: true,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/handoff-event-routes': {
    tag: 'MesaERP', operationId: 'createMesaErpHandoffEventRoute', summary: 'Propose a company for a standalone MesaOps event', status: 201,
    description: 'Binds the exact event id and SHA-256 payload hash to a target company as a draft decision. The source must be an unrouted event from the same tenant.',
    params: { legalEntityId: 'Proposed target ERP legal entity id.' }, headers: { 'Idempotency-Key': 'Required stable routing-proposal key.' },
    responseDescription: 'The immutable draft routing evidence.', responseModel: 'ErpHandoffEventRoute',
    errors: [
      { status: 404, code: 'unrouted_handoff_event_not_found', when: 'The exact tenant-owned standalone event does not exist.' },
      { status: 409, code: 'handoff_payload_changed', when: 'The supplied reviewed hash differs from durable outbox evidence.' },
      { status: 409, code: 'handoff_event_already_routed', when: 'The event already has a routing decision.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/handoff-event-routes/:routeId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpHandoffEventRoute', summary: 'Approve a standalone-event company route',
    description: 'Maker-checker approval is required before the null-company event becomes visible in this company inbox.',
    params: { legalEntityId: 'Target ERP legal entity id.', routeId: 'Event-routing decision id.' }, headers: { 'Idempotency-Key': 'Required stable approval key.' },
    responseDescription: 'The approved immutable routing decision.', responseModel: 'ErpHandoffEventRoute',
    errors: [
      { status: 409, code: 'maker_checker_required', when: 'The routing maker attempts to approve the same decision.' },
      { status: 409, code: 'version_conflict', when: 'The expected route row version is stale.' },
      { status: 409, code: 'handoff_route_source_changed', when: 'The exact source event or payload hash no longer matches.' },
    ],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/handoff-inbox': {
    tag: 'MesaERP', operationId: 'listMesaErpHandoffInbox', summary: 'List received and eligible MesaOps events',
    description: 'Returns company-owned events plus standalone events with an approved company route. Null-company events without that decision cannot leak into discovery.',
    params: { legalEntityId: 'Target ERP legal entity id.' }, responseDescription: 'Inbox rows and eligible durable outbox events.',
    responseSchema: obj({ inbox: arr({ type: 'object' }), available: arr({ type: 'object' }) }),
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/handoff-inbox/:inboxId': {
    tag: 'MesaERP', operationId: 'getMesaErpHandoffInboxEvent', summary: 'Get one company handoff event',
    params: { legalEntityId: 'Target ERP legal entity id.', inboxId: 'ERP inbox event id.' }, responseDescription: 'The immutable source payload and local resolution state.',
    responseModel: 'ErpHandoffInboxEvent', errors: [{ status: 404, code: 'handoff_event_not_found', when: 'The event is not in this company inbox.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/handoff-inbox/events/:eventId/receive': {
    tag: 'MesaERP', operationId: 'receiveMesaErpHandoffEvent', summary: 'Receive one durable MesaOps event', status: 201,
    description: 'Re-reads the authoritative outbox row, verifies event type, schema version, wrapper identity, source snapshot hash and payload hash, then records a deduplicated company receipt.',
    params: { legalEntityId: 'Target ERP legal entity id.', eventId: 'Durable MesaOps outbox event id.' }, headers: { 'Idempotency-Key': 'Required stable receive key.' },
    responseDescription: 'The received or conflict inbox event.', responseModel: 'ErpHandoffInboxEvent',
    errors: [
      { status: 404, code: 'handoff_event_not_found', when: 'The event is neither company-owned nor explicitly routed here.' },
      { status: 409, code: 'handoff_event_contract_mismatch', when: 'The event type or schema version differs from the reviewed contract.' },
      { status: 409, code: 'handoff_payload_hash_mismatch', when: 'Durable event bytes fail their SHA-256 integrity check.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/handoff-inbox/:inboxId/accept': {
    tag: 'MesaERP', operationId: 'acceptMesaErpHandoffEvent', summary: 'Validate and accept a plant event',
    description: 'Creates only local drafts/evidence after explicit mappings validate. Production actuals create manufacturing drafts; QA refreshes still-draft disposition; dispatch links immutable delivery evidence to the existing sales-invoice posting path so stock and COGS cannot be issued twice.',
    params: { legalEntityId: 'Target ERP legal entity id.', inboxId: 'ERP inbox event id.' }, headers: { 'Idempotency-Key': 'Required stable acceptance key.' },
    responseDescription: 'The accepted event, or a retry-state event with explicit validation diagnostics.', responseModel: 'ErpHandoffInboxEvent',
    errors: [
      { status: 409, code: 'version_conflict', when: 'The expected inbox row version is stale.' },
      { status: 409, code: 'handoff_event_not_acceptible', when: 'The event is not in received state.' },
      { status: 422, code: 'handoff_mapping_missing', when: 'A required item, UOM, warehouse or customer mapping is absent.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/handoff-inbox/:inboxId/reject': {
    tag: 'MesaERP', operationId: 'rejectMesaErpHandoffEvent', summary: 'Reject a handoff exception',
    params: { legalEntityId: 'Target ERP legal entity id.', inboxId: 'ERP inbox event id.' }, headers: { 'Idempotency-Key': 'Required stable rejection key.' },
    responseDescription: 'The immutably rejected inbox row.', responseModel: 'ErpHandoffInboxEvent',
    errors: [{ status: 409, code: 'version_conflict', when: 'The expected inbox row version is stale.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/handoff-inbox/:inboxId/retry': {
    tag: 'MesaERP', operationId: 'retryMesaErpHandoffEvent', summary: 'Return a handoff exception to review',
    description: 'Moves a retry/conflict row back to received after its mappings or source conflict were resolved; acceptance remains a separate explicit action.',
    params: { legalEntityId: 'Target ERP legal entity id.', inboxId: 'ERP inbox event id.' }, headers: { 'Idempotency-Key': 'Required stable retry key.' },
    responseDescription: 'The received inbox row with an incremented version.', responseModel: 'ErpHandoffInboxEvent',
    errors: [{ status: 409, code: 'handoff_state_invalid', when: 'The current state cannot be retried.' }],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/tds/sections': {
    tag: 'MesaERP', operationId: 'listMesaErpTdsSections', summary: 'List company TDS sections and rates',
    params: { legalEntityId: 'ERP legal entity id.' }, responseDescription: 'TDS sections with effective-dated rate evidence.',
    responseSchema: arr({ type: 'object' }),
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/tds/sections': {
    tag: 'MesaERP', operationId: 'createMesaErpTdsSection', summary: 'Create a TDS section draft', status: 201,
    description: 'Stores the configured section and cited source evidence with an immutable SHA-256 hash; MesaERP does not infer legal rates.',
    params: { legalEntityId: 'ERP legal entity id.' }, headers: { 'Idempotency-Key': 'Required stable section-creation key.' },
    responseDescription: 'The TDS section draft.', responseModel: 'ErpTdsSection',
    errors: [{ status: 409, code: 'tds_section_exists', when: 'The section code already exists in the company.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/tds/sections/:sectionId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpTdsSection', summary: 'Approve a TDS section',
    description: 'Requires a checker different from the maker and verifies the stored evidence hash.',
    params: { legalEntityId: 'ERP legal entity id.', sectionId: 'TDS section id.' }, headers: { 'Idempotency-Key': 'Required stable approval key.' },
    responseDescription: 'The approved immutable section evidence.', responseModel: 'ErpTdsSection',
    errors: [
      { status: 409, code: 'maker_checker_required', when: 'The section maker attempts approval.' },
      { status: 409, code: 'version_conflict', when: 'The expected section row version is stale.' },
    ],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/tds/sections/:sectionId/rates': {
    tag: 'MesaERP', operationId: 'listMesaErpTdsRates', summary: 'List effective-dated rates for a TDS section',
    params: { legalEntityId: 'ERP legal entity id.', sectionId: 'TDS section id.' }, responseDescription: 'Rates with decimal strings, thresholds and source hashes.',
    responseModel: 'ErpTdsRate', responseIsArray: true,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/tds/sections/:sectionId/rates': {
    tag: 'MesaERP', operationId: 'createMesaErpTdsRate', summary: 'Create an effective-dated TDS rate draft', status: 201,
    params: { legalEntityId: 'ERP legal entity id.', sectionId: 'Approved TDS section id.' }, headers: { 'Idempotency-Key': 'Required stable rate-creation key.' },
    responseDescription: 'The rate draft with decimal-string values.', responseModel: 'ErpTdsRate',
    errors: [{ status: 409, code: 'tds_section_not_approved', when: 'The parent section is not approved.' }],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/tds/rates/:rateId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpTdsRate', summary: 'Approve a non-overlapping TDS rate',
    description: 'Enforces maker-checker and a database-level exclusion constraint so approved effective periods cannot overlap under concurrency.',
    params: { legalEntityId: 'ERP legal entity id.', rateId: 'TDS rate id.' }, headers: { 'Idempotency-Key': 'Required stable approval key.' },
    responseDescription: 'The approved rate evidence.', responseModel: 'ErpTdsRate',
    errors: [
      { status: 409, code: 'tds_rate_effective_overlap', when: 'Another approved rate overlaps this period.' },
      { status: 409, code: 'maker_checker_required', when: 'The rate maker attempts approval.' },
    ],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/vendors/:vendorId/tds-classifications': {
    tag: 'MesaERP', operationId: 'listMesaErpVendorTdsClassifications', summary: 'List a vendor’s TDS classifications',
    params: { legalEntityId: 'ERP legal entity id.', vendorId: 'Company vendor id.' }, responseDescription: 'Effective classification, PAN and certificate evidence.',
    responseModel: 'ErpVendorTdsClassification', responseIsArray: true,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/vendors/:vendorId/tds-classifications': {
    tag: 'MesaERP', operationId: 'createMesaErpVendorTdsClassification', summary: 'Create a vendor TDS classification draft', status: 201,
    params: { legalEntityId: 'ERP legal entity id.', vendorId: 'Company vendor id.' }, headers: { 'Idempotency-Key': 'Required stable classification key.' },
    responseDescription: 'The vendor classification draft.', responseModel: 'ErpVendorTdsClassification',
    errors: [
      { status: 404, code: 'vendor_not_found', when: 'The vendor is outside this company.' },
      { status: 422, code: 'tds_section_not_approved', when: 'The selected section is not approved.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/tds/vendor-classifications/:classificationId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpVendorTdsClassification', summary: 'Approve a non-overlapping vendor classification',
    description: 'Requires maker-checker and prevents overlapping approved classifications for the same vendor and section.',
    params: { legalEntityId: 'ERP legal entity id.', classificationId: 'Vendor classification id.' }, headers: { 'Idempotency-Key': 'Required stable approval key.' },
    responseDescription: 'The approved vendor classification evidence.', responseModel: 'ErpVendorTdsClassification',
    errors: [
      { status: 409, code: 'tds_classification_effective_overlap', when: 'An approved classification already covers part of this period.' },
      { status: 409, code: 'maker_checker_required', when: 'The classification maker attempts approval.' },
    ],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/tds/deductions': {
    tag: 'MesaERP', operationId: 'listMesaErpTdsDeductions', summary: 'List company TDS deduction evidence',
    params: { legalEntityId: 'ERP legal entity id.' }, responseDescription: 'Draft, submitted and approved deductions with Decimal strings.',
    responseModel: 'ErpTdsDeduction', responseIsArray: true,
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/tds/deductions': {
    tag: 'MesaERP', operationId: 'createMesaErpTdsDeduction', summary: 'Create a provisional TDS deduction calculation', status: 201,
    description: 'The gross basis is explicitly user-entered and reviewed, not inferred from invoice taxable value. Draft basis reserves payable capacity; the final aggregate threshold calculation is serialized and recomputed at submission.',
    params: { legalEntityId: 'ERP legal entity id.' }, headers: { 'Idempotency-Key': 'Required stable deduction-creation key.' },
    responseDescription: 'The provisional deduction evidence.', responseModel: 'ErpTdsDeduction',
    errors: [
      { status: 422, code: 'tds_payable_voucher_invalid', when: 'The payable is not a posted purchase or journal voucher.' },
      { status: 422, code: 'tds_payable_basis_exhausted', when: 'Cumulative draft, submitted and approved basis would exceed the payable value.' },
      { status: 422, code: 'tds_classification_missing_or_ambiguous', when: 'Exactly one approved classification does not cover the date.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/tds/deductions/:deductionId/submit': {
    tag: 'MesaERP', operationId: 'submitMesaErpTdsDeduction', summary: 'Finalize and submit TDS calculation evidence',
    description: 'Serializes by payable and vendor-section-year, revalidates sources, recomputes prior aggregate basis from submitted/approved evidence, and freezes the final calculation hash.',
    params: { legalEntityId: 'ERP legal entity id.', deductionId: 'TDS deduction id.' }, headers: { 'Idempotency-Key': 'Required stable submission key.' },
    responseDescription: 'The submitted immutable final calculation evidence.', responseModel: 'ErpTdsDeduction',
    errors: [
      { status: 409, code: 'tds_payable_basis_exhausted', when: 'The reviewed basis is no longer available.' },
      { status: 409, code: 'tds_master_evidence_changed', when: 'The effective classification or rate no longer covers the date.' },
      { status: 409, code: 'version_conflict', when: 'The expected deduction row version is stale.' },
    ],
  },
  'POST /api/mesaerp/v1/entities/:legalEntityId/tds/deductions/:deductionId/approve': {
    tag: 'MesaERP', operationId: 'approveMesaErpTdsDeduction', summary: 'Approve final TDS deduction evidence',
    description: 'A different checker verifies the frozen calculation hash, posted source vouchers and approved master evidence. This does not file a return or initiate payment.',
    params: { legalEntityId: 'ERP legal entity id.', deductionId: 'TDS deduction id.' }, headers: { 'Idempotency-Key': 'Required stable approval key.' },
    responseDescription: 'The approved immutable deduction evidence.', responseModel: 'ErpTdsDeduction',
    errors: [
      { status: 409, code: 'maker_checker_required', when: 'The deduction maker attempts approval.' },
      { status: 409, code: 'tds_source_voucher_changed', when: 'A linked voucher is no longer posted.' },
    ],
  },
  'GET /api/mesaerp/v1/entities/:legalEntityId/reports/tds-deductions': {
    tag: 'MesaERP', operationId: 'reportMesaErpTdsDeductions', summary: 'Report source-backed TDS evidence',
    description: 'Returns company deductions and totals by section. Filing is explicitly not supported.',
    params: { legalEntityId: 'ERP legal entity id.' }, responseDescription: 'Filtered rows, Decimal-string section totals and filingStatus not_supported.',
    responseSchema: obj({ legalEntityId: str, filters: { type: 'object' }, rows: arr({ type: 'object' }), totalsBySection: arr({ type: 'object' }), rowCount: int, filingStatus: { type: 'string', enum: ['not_supported'] } }),
  },
};
