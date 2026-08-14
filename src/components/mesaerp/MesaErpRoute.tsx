import { useState, type FormEvent } from 'react';
import { AlertTriangle, Building2, Loader2, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  createErpIdempotencyKey,
  useApproveErpPurchaseMatch,
  useCreateErpCustomer,
  useCreateErpEntity,
  useCreateErpManufacturingVoucher,
  useCreateErpProductionDemand,
  useCreateErpPurchaseMatch,
  useCreateErpRole,
  useCreateErpSalesDocument,
  useCreateErpSourceToPayDocument,
  useCreateErpVendor,
  useCreateErpVoucher,
  useCreateErpRoleAssignment,
  useErpAccounts,
  useErpBatchCosts,
  useErpCustomers,
  useErpEntities,
  useErpManufacturingVouchers,
  useErpPermissions,
  useErpPurchaseMatches,
  useErpProductionDemands,
  useErpRoleAssignments,
  useErpRoles,
  useErpSourceToPayDocuments,
  useErpSalesDocuments,
  useErpVendors,
  useErpVouchers,
  useReplaceErpRolePermissions,
  useReverseErpVoucher,
  useRevokeErpRoleAssignment,
  useTransitionErpVendor,
  useTransitionErpVoucher,
  useTransitionErpManufacturingVoucher,
  useTransitionErpProductionDemand,
  useTransitionErpSalesDocument,
  useTransitionErpSourceToPayDocument,
  type ErpCustomerCreate,
  type ErpLegalEntity,
  type ErpLegalEntityCreate,
  type ErpManufacturingVoucher,
  type ErpManufacturingVoucherCreate,
  type ErpProductionDemand,
  type ErpProductionDemandCreate,
  type ErpPurchaseMatchCase,
  type ErpRole,
  type ErpRoleAssignment,
  type ErpSalesDocument,
  type ErpSalesDocumentCreate,
  type ErpSalesDocumentType,
  type ErpVendor,
  type ErpSourceToPayDocument,
  type ErpSourceToPayDocumentCreate,
  type ErpSourceToPayDocumentType,
  type ErpVoucher,
  type ErpVoucherCreate,
  type ErpVoucherType,
} from '../../lib/queries/mesaerp';
import Logo from '../Logo';
import MesaErpApp from './MesaErpApp';
import type {
  EnterpriseRole,
  EnterpriseRoleAssignment,
  FinanceVoucher,
  FinanceVoucherType,
  MesaErpView,
  MesaErpWorkspace,
  PermissionDefinition,
  PermissionKey,
  Vendor,
  VendorCreateInput,
} from './model';

const UI_VOUCHER_TYPES: Record<ErpVoucherType, FinanceVoucherType> = {
  contra: 'Contra',
  payment: 'Payment',
  receipt: 'Receipt',
  journal: 'Journal',
  sales: 'Sales',
  purchase: 'Purchase',
  credit_note: 'Credit note',
  debit_note: 'Debit note',
  stock_journal: 'Stock journal',
  manufacturing_journal: 'Manufacturing journal',
  opening: 'Opening',
};

const API_VOUCHER_TYPES = Object.fromEntries(
  Object.entries(UI_VOUCHER_TYPES).map(([apiType, uiType]) => [uiType, apiType]),
) as Record<FinanceVoucherType, ErpVoucherType>;

const emptyWorkspace = (): MesaErpWorkspace => ({
  vendors: [],
  purchases: [],
  stock: [],
  manufacturingVouchers: [],
  financeVouchers: [],
  taxDocuments: [],
  handoffs: [],
  roles: [],
});

function isPermissionKey(value: string): value is PermissionKey {
  return /^mesaerp\.[a-z0-9_.]+$/.test(value);
}

function mapVendor(vendor: ErpVendor): Vendor {
  return {
    id: vendor.id,
    code: vendor.vendorCode,
    name: vendor.legalName,
    tradeName: vendor.tradeName,
    supplies: vendor.categories.join(', ') || 'Unclassified',
    paymentTerms: vendor.paymentTerms,
    gstinState: ['verified', 'compliant'].includes(vendor.complianceStatus) ? 'verified' : 'review',
    gstin: vendor.gstin,
    lifecycleStatus: vendor.lifecycleStatus,
    complianceStatus: vendor.complianceStatus,
    rowVersion: vendor.rowVersion,
  };
}

function mapVoucher(voucher: ErpVoucher, vendors: ErpVendor[]): FinanceVoucher {
  const partyId = voucher.lines.find((line) => line.dimensions?.partyId)?.dimensions.partyId;
  const party = vendors.find((vendor) => vendor.id === partyId)?.legalName ?? 'General ledger';
  return {
    id: voucher.id,
    number: voucher.voucherNumber || 'Unnumbered draft',
    type: UI_VOUCHER_TYPES[voucher.voucherType],
    date: voucher.voucherDate,
    party,
    reference: voucher.reference,
    narration: voucher.narration,
    lines: voucher.lines.map((line) => ({
      account: line.ledgerAccountId,
      debit: line.debit,
      credit: line.credit,
    })),
    state: voucher.status,
    version: voucher.version,
    currencyCode: voucher.currencyCode,
    createdAt: voucher.createdAt,
  };
}

function mapRole(role: ErpRole): EnterpriseRole {
  return {
    id: role.id,
    name: role.name,
    scope: 'Company',
    grants: role.permissions
      .filter((permission) => permission.effect === 'allow' && isPermissionKey(permission.key))
      .map((permission) => permission.key as PermissionKey),
    version: role.version,
    isSystem: role.isSystem,
  };
}

function mapAssignment(assignment: ErpRoleAssignment): EnterpriseRoleAssignment {
  return {
    id: assignment.id,
    roleId: assignment.role.id,
    roleName: assignment.role.name,
    membershipId: assignment.membership.id,
    employeeCode: assignment.membership.employeeCode,
    memberName: assignment.membership.name || assignment.membership.email,
    status: assignment.status,
    rowVersion: assignment.rowVersion,
  };
}

function voucherInput(voucher: FinanceVoucher): ErpVoucherCreate {
  const counterparty = voucher.party.trim();
  const narration = voucher.narration.trim();
  return {
    voucherType: API_VOUCHER_TYPES[voucher.type],
    voucherDate: voucher.date,
    currencyCode: voucher.currencyCode || 'INR',
    reference: voucher.reference.trim(),
    narration: counterparty ? `${counterparty}${narration ? ` · ${narration}` : ''}` : narration,
    lines: voucher.lines.map((line) => ({
      ledgerAccountId: line.account,
      debit: line.debit,
      credit: line.credit,
      narration: '',
      dimensions: {},
    })),
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The MesaERP company workspace could not be loaded.';
}

function LoadingState({ label }: { label: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <Logo className="mx-auto h-12 w-12" />
        <Loader2 className="mx-auto mt-6 h-6 w-6 animate-spin text-blue-700" />
        <h1 className="mt-4 text-lg font-extrabold text-slate-900">Loading MesaERP</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{label}</p>
      </div>
    </main>
  );
}

function RouteState({ title, copy, onRetry, onExit }: { title: string; copy: string; onRetry?: () => void; onExit?: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><AlertTriangle className="h-5 w-5" /></div>
        <h1 className="mt-5 text-xl font-extrabold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {onRetry && <button type="button" onClick={onRetry} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800"><RefreshCw className="h-4 w-4" /> Retry</button>}
          {onExit && <button type="button" onClick={onExit} className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">Back to MesaDesk</button>}
        </div>
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs leading-5 text-blue-900"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" /><span>MesaERP is independently entitled and company scoped. No other MesaDesk service is required to open or operate it.</span></div>
      </section>
    </main>
  );
}

function EmptyCompanyState({ onCreate, onExit }: { onCreate: (input: ErpLegalEntityCreate, requestKey: string) => Promise<void>; onExit?: () => void }) {
  const [requestKey] = useState(() => createErpIdempotencyKey('legal-entity-create'));
  const [form, setForm] = useState<ErpLegalEntityCreate>({ code: '', name: '', countryCode: 'IN', baseCurrency: 'INR', fiscalYearStartMonth: 4 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError('');
    try { await onCreate({ ...form, code: form.code.trim().toUpperCase(), name: form.name.trim() }, requestKey); }
    catch (createError) { setError(createError instanceof Error ? createError.message : 'The legal company could not be created.'); }
    finally { setSaving(false); }
  };
  const inputClass = 'min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4 sm:p-6">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5 sm:p-7"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Building2 className="h-5 w-5" /></div><h1 className="mt-5 text-xl font-extrabold text-slate-900">Create the first legal company</h1><p className="mt-2 text-sm leading-6 text-slate-600">No accessible MesaERP company exists for this membership. An authorized access administrator can create one here; the API still requires the exact <code>mesaerp.legal_entity.manage</code> grant.</p></div>
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-7">
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Company code *</span><input required aria-label="Company code" className={inputClass} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="ACME" /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Legal name *</span><input required aria-label="Legal company name" className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Country code *</span><input required maxLength={2} aria-label="Country code" className={inputClass} value={form.countryCode} onChange={(event) => setForm({ ...form, countryCode: event.target.value.toUpperCase() })} /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Base currency *</span><input required maxLength={3} aria-label="Base currency" className={inputClass} value={form.baseCurrency} onChange={(event) => setForm({ ...form, baseCurrency: event.target.value.toUpperCase() })} /></label>
          <label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-bold text-slate-700">Fiscal year starts *</span><select aria-label="Fiscal year start month" className={inputClass} value={form.fiscalYearStartMonth} onChange={(event) => setForm({ ...form, fiscalYearStartMonth: Number(event.target.value) })}>{['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>
          {error && <div className="sm:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>}
          <div className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs leading-5 text-blue-900"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" /><span>The company, fiscal year, periods and manufacturing chart of accounts are created atomically. No MesaOps company is required.</span></div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-4 sm:px-7">{onExit && <button type="button" onClick={onExit} className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700">Back to MesaDesk</button>}<button type="submit" disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white disabled:bg-slate-300"><Plus className="h-4 w-4" />{saving ? 'Creating…' : 'Create legal company'}</button></div>
      </form>
    </main>
  );
}

export interface MesaErpRouteProps {
  initialView?: MesaErpView;
  onExit?: () => void;
}

export default function MesaErpRoute({ initialView, onExit }: MesaErpRouteProps) {
  const entitiesQ = useErpEntities();
  const createEntity = useCreateErpEntity();
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const entities = entitiesQ.data ?? [];
  const selectedEntity = entities.find((entity) => entity.id === selectedEntityId) ?? entities[0];
  const entityId = selectedEntity?.id ?? '';

  const accountsQ = useErpAccounts(entityId);
  const vendorsQ = useErpVendors(entityId);
  const vouchersQ = useErpVouchers(entityId);
  const rolesQ = useErpRoles(entityId);
  const permissionsQ = useErpPermissions(entityId);
  const assignmentsQ = useErpRoleAssignments(entityId);
  const requisitionsQ = useErpSourceToPayDocuments(entityId, 'purchase_requisition');
  const purchaseOrdersQ = useErpSourceToPayDocuments(entityId, 'purchase_order');
  const goodsReceiptsQ = useErpSourceToPayDocuments(entityId, 'goods_receipt');
  const supplierInvoicesQ = useErpSourceToPayDocuments(entityId, 'supplier_invoice');
  const purchaseMatchesQ = useErpPurchaseMatches(entityId);
  const customersQ = useErpCustomers(entityId);
  const salesOrdersQ = useErpSalesDocuments(entityId, 'sales_order');
  const salesInvoicesQ = useErpSalesDocuments(entityId, 'sales_invoice');
  const productionDemandsQ = useErpProductionDemands(entityId);
  const manufacturingVouchersQ = useErpManufacturingVouchers(entityId);
  const batchCostsQ = useErpBatchCosts(entityId);
  const createVendor = useCreateErpVendor(entityId);
  const transitionVendor = useTransitionErpVendor(entityId);
  const createVoucher = useCreateErpVoucher(entityId);
  const submitVoucher = useTransitionErpVoucher(entityId, 'submit');
  const approveVoucher = useTransitionErpVoucher(entityId, 'approve');
  const postVoucher = useTransitionErpVoucher(entityId, 'post');
  const reverseVoucher = useReverseErpVoucher(entityId);
  const replaceRolePermissions = useReplaceErpRolePermissions(entityId);
  const createRoleAssignment = useCreateErpRoleAssignment(entityId);
  const revokeRoleAssignment = useRevokeErpRoleAssignment(entityId);
  const createRole = useCreateErpRole(entityId);
  const createSourceToPayDocument = useCreateErpSourceToPayDocument(entityId);
  const transitionSourceToPayDocument = useTransitionErpSourceToPayDocument(entityId);
  const createPurchaseMatch = useCreateErpPurchaseMatch(entityId);
  const approvePurchaseMatch = useApproveErpPurchaseMatch(entityId);
  const createCustomer = useCreateErpCustomer(entityId);
  const createSalesDocument = useCreateErpSalesDocument(entityId);
  const transitionSalesDocument = useTransitionErpSalesDocument(entityId);
  const createProductionDemand = useCreateErpProductionDemand(entityId);
  const transitionProductionDemand = useTransitionErpProductionDemand(entityId);
  const createManufacturingVoucher = useCreateErpManufacturingVoucher(entityId);
  const transitionManufacturingVoucher = useTransitionErpManufacturingVoucher(entityId);

  if (entitiesQ.isLoading) return <LoadingState label="Resolving your entitled legal entities and company controls." />;
  if (entitiesQ.isError) return <RouteState title="MesaERP access could not be resolved" copy={message(entitiesQ.error)} onRetry={() => void entitiesQ.refetch()} onExit={onExit} />;
  if (!selectedEntity) return <EmptyCompanyState onCreate={async (input, requestKey) => { await createEntity.mutateAsync({ input, requestKey }); }} onExit={onExit} />;

  const vendors = vendorsQ.data ?? [];
  const workspace: MesaErpWorkspace = {
    ...emptyWorkspace(),
    vendors: vendors.map(mapVendor),
    financeVouchers: (vouchersQ.data ?? []).map((voucher) => mapVoucher(voucher, vendors)),
    roles: (rolesQ.data ?? []).map(mapRole),
  };
  const permissions: PermissionDefinition[] = (permissionsQ.data ?? [])
    .filter((permission) => isPermissionKey(permission.key))
    .map((permission) => ({ key: permission.key, label: permission.label, description: permission.description, riskLevel: permission.riskLevel }));
  const assignments = (assignmentsQ.data ?? []).map(mapAssignment);
  const sourceToPayDocuments = [
    ...(requisitionsQ.data ?? []),
    ...(purchaseOrdersQ.data ?? []),
    ...(goodsReceiptsQ.data ?? []),
    ...(supplierInvoicesQ.data ?? []),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const purchaseMatches = purchaseMatchesQ.data ?? [];
  const warnings = [
    accountsQ.isLoading ? 'Posting accounts: loading independently.' : accountsQ.isError ? `Posting accounts: ${message(accountsQ.error)}` : '',
    vendorsQ.isLoading ? 'Vendor master: loading independently.' : vendorsQ.isError ? `Vendor master: ${message(vendorsQ.error)}` : '',
    vouchersQ.isLoading ? 'Voucher register: loading independently.' : vouchersQ.isError ? `Voucher register: ${message(vouchersQ.error)}` : '',
    rolesQ.isLoading ? 'Enterprise roles: loading independently.' : rolesQ.isError ? `Enterprise roles: ${message(rolesQ.error)}` : '',
    permissionsQ.isLoading ? 'Permission catalogue: loading independently.' : permissionsQ.isError ? `Permission catalogue: ${message(permissionsQ.error)}` : '',
    assignmentsQ.isLoading ? 'Role assignments: loading independently.' : assignmentsQ.isError ? `Role assignments: ${message(assignmentsQ.error)}` : '',
    requisitionsQ.isError ? `Purchase requisitions: ${message(requisitionsQ.error)}` : '',
    purchaseOrdersQ.isError ? `Purchase orders: ${message(purchaseOrdersQ.error)}` : '',
    goodsReceiptsQ.isError ? `Goods receipts: ${message(goodsReceiptsQ.error)}` : '',
    supplierInvoicesQ.isError ? `Supplier invoices: ${message(supplierInvoicesQ.error)}` : '',
    purchaseMatchesQ.isError ? `Purchase matches: ${message(purchaseMatchesQ.error)}` : '',
    customersQ.isError ? `Customer master: ${message(customersQ.error)}` : '',
    salesOrdersQ.isError ? `Sales orders: ${message(salesOrdersQ.error)}` : '',
    salesInvoicesQ.isError ? `Sales invoices: ${message(salesInvoicesQ.error)}` : '',
    productionDemandsQ.isError ? `Production demands: ${message(productionDemandsQ.error)}` : '',
    manufacturingVouchersQ.isError ? `Manufacturing vouchers: ${message(manufacturingVouchersQ.error)}` : '',
    batchCostsQ.isError ? `Batch costs: ${message(batchCostsQ.error)}` : '',
  ].filter(Boolean);

  const transition = async (voucher: FinanceVoucher, action: 'submit' | 'approve' | 'post') => {
    const mutation = action === 'submit' ? submitVoucher : action === 'approve' ? approveVoucher : postVoucher;
    await mutation.mutateAsync({ voucherId: voucher.id, expectedVersion: voucher.version ?? 0 });
  };

  return (
    <MesaErpApp
      key={entityId}
      initialView={initialView}
      mode="live"
      workspace={workspace}
      workspaceLabel={`${selectedEntity.code} · ${selectedEntity.name}`}
      currencyCode={selectedEntity.baseCurrency}
      legalEntities={entities.map((entity: ErpLegalEntity) => ({ id: entity.id, label: `${entity.code} · ${entity.name}`, currency: entity.baseCurrency }))}
      selectedLegalEntityId={entityId}
      onSelectLegalEntity={setSelectedEntityId}
      accounts={(accountsQ.data ?? []).map((account) => ({ id: account.id, code: account.code, name: account.name, allowPosting: account.allowPosting }))}
      permissions={permissions}
      roleAssignments={assignments}
      sourceToPayDocuments={sourceToPayDocuments}
      purchaseMatches={purchaseMatches}
      customers={customersQ.data ?? []}
      salesOrders={salesOrdersQ.data ?? []}
      salesInvoices={salesInvoicesQ.data ?? []}
      productionDemands={productionDemandsQ.data ?? []}
      persistedManufacturingVouchers={manufacturingVouchersQ.data ?? []}
      batchCosts={batchCostsQ.data ?? []}
      sourceToPayLoading={[requisitionsQ, purchaseOrdersQ, goodsReceiptsQ, supplierInvoicesQ].some((query) => query.isLoading)}
      purchaseMatchesLoading={purchaseMatchesQ.isLoading}
      commercialLoading={[customersQ, salesOrdersQ, salesInvoicesQ].some((query) => query.isLoading)}
      manufacturingLoading={[productionDemandsQ, manufacturingVouchersQ, batchCostsQ].some((query) => query.isLoading)}
      loadWarnings={warnings}
      onExit={onExit}
      onCreateVendor={async (input: VendorCreateInput) => { await createVendor.mutateAsync(input); }}
      onTransitionVendor={async (vendor, to, reason) => {
        await transitionVendor.mutateAsync({ vendorId: vendor.id, to, reason, expectedRowVersion: vendor.rowVersion ?? 0 });
      }}
      onCreateSourceToPayDocument={async (documentType: ErpSourceToPayDocumentType, input: ErpSourceToPayDocumentCreate, requestKey: string) => {
        await createSourceToPayDocument.mutateAsync({ documentType, input, requestKey });
      }}
      onTransitionSourceToPayDocument={async (document: ErpSourceToPayDocument, action, requestKey) => {
        await transitionSourceToPayDocument.mutateAsync({
          documentType: document.documentType,
          documentId: document.id,
          action,
          expectedRowVersion: document.rowVersion,
          requestKey,
        });
      }}
      onCreatePurchaseMatch={async (input, requestKey) => {
        await createPurchaseMatch.mutateAsync({ ...input, requestKey });
      }}
      onApprovePurchaseMatch={async (match: ErpPurchaseMatchCase, reason, requestKey) => {
        await approvePurchaseMatch.mutateAsync({
          matchCaseId: match.id,
          expectedRowVersion: match.rowVersion,
          reason,
          requestKey,
        });
      }}
      onCreateCustomer={async (input: ErpCustomerCreate, requestKey: string) => {
        await createCustomer.mutateAsync({ input, requestKey });
      }}
      onCreateSalesDocument={async (documentType: ErpSalesDocumentType, input: ErpSalesDocumentCreate, requestKey: string) => {
        await createSalesDocument.mutateAsync({ documentType, input, requestKey });
      }}
      onTransitionSalesDocument={async (document: ErpSalesDocument, action, requestKey) => {
        await transitionSalesDocument.mutateAsync({ documentType: document.documentType, documentId: document.id, action, expectedRowVersion: document.rowVersion, requestKey });
      }}
      onCreateProductionDemand={async (input: ErpProductionDemandCreate, requestKey: string) => {
        await createProductionDemand.mutateAsync({ input, requestKey });
      }}
      onTransitionProductionDemand={async (demand: ErpProductionDemand, action, requestKey) => {
        await transitionProductionDemand.mutateAsync({ demandId: demand.id, action, expectedRowVersion: demand.rowVersion, requestKey });
      }}
      onCreatePersistedManufacturingVoucher={async (input: ErpManufacturingVoucherCreate, requestKey: string) => {
        await createManufacturingVoucher.mutateAsync({ input, requestKey });
      }}
      onTransitionPersistedManufacturingVoucher={async (voucher: ErpManufacturingVoucher, action, requestKey) => {
        await transitionManufacturingVoucher.mutateAsync({ voucherId: voucher.id, action, expectedRowVersion: voucher.rowVersion, requestKey });
      }}
      onSaveFinanceVoucher={async (voucher) => { await createVoucher.mutateAsync(voucherInput(voucher)); }}
      onTransitionFinanceVoucher={transition}
      onReverseFinanceVoucher={async (voucher, voucherDate, reason, requestKey) => {
        await reverseVoucher.mutateAsync({
          voucherId: voucher.id,
          expectedVersion: voucher.version ?? 0,
          voucherDate,
          reason,
          requestKey,
        });
      }}
      onReplaceRolePermissions={async (role, grants) => {
        await replaceRolePermissions.mutateAsync({ roleId: role.id, expectedRoleVersion: role.version ?? 0, grants });
      }}
      onCreateRoleAssignment={async (role, membershipId) => {
        await createRoleAssignment.mutateAsync({ roleId: role.id, membershipId });
      }}
      onRevokeRoleAssignment={async (assignment, reason) => {
        await revokeRoleAssignment.mutateAsync({ assignmentId: assignment.id, rowVersion: assignment.rowVersion ?? 0, reason });
      }}
      onCreateRole={async (name, grants, requestKey) => {
        await createRole.mutateAsync({ input: { name, grants }, requestKey });
      }}
    />
  );
}

export const mesaErpRouteAdapters = { mapVendor, mapVoucher, mapRole, mapAssignment, voucherInput };
