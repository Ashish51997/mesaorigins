import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Factory,
  FileCheck2,
  GitBranch,
  LayoutDashboard,
  Link2,
  LockKeyhole,
  Menu,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingCart,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import Logo from '../Logo';
import { LiveCommercialControl, LiveManufacturingControl } from './LiveCommercialManufacturing';
import { LiveFinanceControls } from './LiveFinanceControls';
import { LiveHandoffInbox } from './LiveHandoffInbox';
import { LiveIndiaCompliance } from './LiveIndiaCompliance';
import { LivePurchaseMatch, LivePurchaseRegister } from './LiveSourceToPay';
import { LiveSupplierManagement } from './LiveSupplierManagement';
import { LiveInventoryPlanning } from './LiveInventoryPlanning';
import { absoluteDecimalString, formatDecimalString, isPositiveDecimalString, sumDecimalStrings } from './liveUi';
import type {
  ErpCustomerCreate,
  ErpManufacturingVoucher as ErpPersistedManufacturingVoucher,
  ErpManufacturingVoucherCreate,
  ErpProductionDemand,
  ErpProductionDemandCreate,
  ErpPurchaseMatchCase,
  ErpSalesDocument,
  ErpSalesDocumentCreate,
  ErpSalesDocumentType,
  ErpSourceToPayDocument,
  ErpSourceToPayDocumentCreate,
  ErpSourceToPayDocumentType,
} from '../../lib/queries/mesaerp';
import { createErpIdempotencyKey } from '../../lib/queries/mesaerp';
import {
  PERMISSIONS,
  createDemoWorkspace,
  type EnterpriseRole,
  type EnterpriseRoleAssignment,
  type FinanceVoucher,
  type FinanceVoucherType,
  type HandoffRecord,
  type LedgerAccountOption,
  type ManufacturingVoucher,
  type ManufacturingVoucherType,
  type MesaErpAppProps,
  type MesaErpMutation,
  type MesaErpView,
  type MesaErpWorkspace,
  type PermissionDefinition,
  type PermissionKey,
  type PurchaseRecord,
  type StockItem,
  type TaxDocument,
  type Vendor,
  type VendorCreateInput,
  type VendorLifecycleStatus,
} from './model';

const VENDOR_TRANSITIONS: Record<VendorLifecycleStatus, VendorLifecycleStatus[]> = {
  invited: ['onboarding', 'blocked'],
  onboarding: ['under_review', 'blocked'],
  under_review: ['approved', 'conditionally_approved', 'blocked'],
  approved: ['suspended', 'blocked'],
  conditionally_approved: ['approved', 'suspended', 'blocked'],
  suspended: ['under_review', 'blocked'],
  blocked: ['under_review'],
};

const inputClass = 'min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
const primaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300';
const secondaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300';

type IconType = typeof LayoutDashboard;

const NAV_GROUPS: Array<{ label: string; items: Array<{ id: MesaErpView; label: string; icon: IconType }> }> = [
  { label: 'Workspace', items: [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }] },
  { label: 'Source to pay', items: [
    { id: 'source-to-pay', label: 'Vendors & purchasing', icon: ShoppingCart },
    { id: 'purchase-match', label: 'Purchase matching', icon: ClipboardCheck },
  ] },
  { label: 'Commercial', items: [{ id: 'commercial', label: 'Customers & sales', icon: FileCheck2 }] },
  { label: 'Planning & costing', items: [
    { id: 'inventory-mrp', label: 'Inventory & MRP', icon: Boxes },
    { id: 'manufacturing', label: 'Manufacturing vouchers', icon: Factory },
  ] },
  { label: 'Finance', items: [
    { id: 'voucher-desk', label: 'Voucher desk', icon: WalletCards },
    { id: 'finance-controls', label: 'Finance controls', icon: Building2 },
    { id: 'tax-compliance', label: 'Tax & statutory', icon: FileCheck2 },
  ] },
  { label: 'Control', items: [
    { id: 'handoffs', label: 'Handoff inbox', icon: GitBranch },
    { id: 'roles-access', label: 'Roles & access', icon: ShieldCheck },
  ] },
];

const VIEW_COPY: Record<MesaErpView, { title: string; subtitle: string }> = {
  overview: { title: 'Manufacturing ERP overview', subtitle: 'One workspace for material, production, finance and statutory control.' },
  'source-to-pay': { title: 'Vendors & source to pay', subtitle: 'Move demand from requisition through payment with an explicit approval trail.' },
  'purchase-match': { title: 'Purchase matching', subtitle: 'Compare purchase order, goods receipt and supplier invoice at line level.' },
  commercial: { title: 'Customers & sales', subtitle: 'Own customer, sales-order and sales-invoice truth with optional upstream snapshots.' },
  'inventory-mrp': { title: 'Inventory & MRP', subtitle: 'See available stock, safety policy and the next replenishment action.' },
  manufacturing: { title: 'Manufacturing vouchers', subtitle: 'Record valued material, output and recovery evidence with plant references.' },
  'voucher-desk': { title: 'Finance voucher desk', subtitle: 'Fast accounting entry with visible balance, approval and posting controls.' },
  'finance-controls': { title: 'Finance controls', subtitle: 'Operate accounts, periods, banking, assets, budgets, reports and group accounting by explicit grant.' },
  'tax-compliance': { title: 'Tax & statutory control', subtitle: 'Apply effective-dated rules and gate dispatch only when the applicable law requires it.' },
  handoffs: { title: 'Handoff inbox', subtitle: 'Accept optional snapshots without sharing lifecycle state across services.' },
  'roles-access': { title: 'Administration · Roles & access', subtitle: 'Grant sensitive actions explicitly; everything else remains denied.' },
};

function money(value: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value || 0);
}

function number(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value || 0);
}

function label(value: string): string {
  return value.replace(/[-_.]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stateTone(state: string): string {
  if (['approved', 'posted', 'ready', 'matched', 'linked', 'verified'].includes(state)) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (['blocked', 'conflict', 'exception'].includes(state)) return 'border-rose-200 bg-rose-50 text-rose-700';
  if (['pending', 'review', 'stale', 'ruleset-review', 'approved-exception'].includes(state)) return 'border-amber-200 bg-amber-50 text-amber-700';
  if (['draft', 'unlinked'].includes(state)) return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function StatePill({ state }: { state: string }) {
  return <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 text-[10px] font-extrabold uppercase tracking-wide ${stateTone(state)}`}>{label(state)}</span>;
}

function Panel({ title, eyebrow, action, children, className = '' }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white ${className}`}>
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div>
          {eyebrow && <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">{eyebrow}</p>}
          <h2 className="mt-0.5 text-base font-extrabold text-slate-900">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function DerivedCard({ icon, label: cardLabel, value, detail, tone = 'blue' }: { icon: ReactNode; label: string; value: number; detail: string; tone?: 'blue' | 'amber' | 'rose' | 'emerald' }) {
  const tones = { blue: 'bg-blue-50 text-blue-700', amber: 'bg-amber-50 text-amber-700', rose: 'bg-rose-50 text-rose-700', emerald: 'bg-emerald-50 text-emerald-700' };
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">{cardLabel}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{value}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</div>
      </div>
    </article>
  );
}

function Notice({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'amber' | 'emerald' | 'rose' }) {
  const tones = {
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
  };
  return <div className={`rounded-xl border px-4 py-3 text-sm leading-6 ${tones[tone]}`}>{children}</div>;
}

function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

function Overview({ workspace, onNavigate, mode, sourceToPayDocuments = [], purchaseMatches = [] }: { workspace: MesaErpWorkspace; onNavigate: (view: MesaErpView) => void; mode: 'demo' | 'live'; sourceToPayDocuments?: ErpSourceToPayDocument[]; purchaseMatches?: ErpPurchaseMatchCase[] }) {
  const openPurchases = workspace.purchases.filter((item) => item.stage !== 'payment').length;
  const matchExceptions = workspace.purchases.filter((item) => ['exception', 'review'].includes(item.matchState)).length;
  const shortages = workspace.stock.filter((item) => item.onHand - item.allocated < item.safetyStock);
  const unposted = workspace.financeVouchers.filter((item) => item.state !== 'posted').length;
  const statutoryBlocks = workspace.taxDocuments.filter((item) => item.applicability === 'required' && item.state === 'blocked');
  const handoffReviews = workspace.handoffs.filter((item) => !item.reviewed);

  if (mode === 'live') {
    const drafts = workspace.financeVouchers.filter((item) => item.state === 'draft');
    const approvals = workspace.financeVouchers.filter((item) => ['submitted', 'approved'].includes(item.state));
    const posted = workspace.financeVouchers.filter((item) => item.state === 'posted');
    const purchaseActions = sourceToPayDocuments.filter((item) => ['draft', 'submitted'].includes(item.status));
    const matchReviews = purchaseMatches.filter((item) => ['variance', 'disputed'].includes(item.status));
    return (
      <div className="space-y-5">
        <Notice>
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><div><strong>MesaERP operates independently.</strong> Purchasing, commercial, valued inventory, manufacturing, finance and India compliance persist through their own company-scoped APIs. Optional MesaOps handoffs use snapshots and remain owned by the destination service.</div></div>
        </Notice>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DerivedCard icon={<ShoppingCart className="h-5 w-5" />} label="Purchase documents" value={sourceToPayDocuments.length} detail="Persisted requisitions, orders, receipts and invoices" />
          <DerivedCard icon={<ClipboardCheck className="h-5 w-5" />} label="Match reviews" value={matchReviews.length} detail="Persisted variance cases needing a separate checker" tone={matchReviews.length ? 'amber' : 'emerald'} />
          <DerivedCard icon={<WalletCards className="h-5 w-5" />} label="Voucher actions" value={drafts.length + approvals.length} detail="Draft or approval-stage finance records" tone={drafts.length + approvals.length ? 'blue' : 'emerald'} />
          <DerivedCard icon={<CheckCircle2 className="h-5 w-5" />} label="Posted vouchers" value={posted.length} detail="Immutable company ledger postings returned by the API" tone="emerald" />
        </div>
        <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
          <Panel title="Company action queue" eyebrow="Live persisted records">
            <div className="divide-y divide-slate-100">
              {purchaseActions.slice(0, 5).map((document) => <button key={document.id} type="button" onClick={() => onNavigate('source-to-pay')} className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:px-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><ShoppingCart className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block font-mono text-xs font-bold text-slate-900">{document.documentNumber}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{label(document.documentType)} · {document.lines[0]?.description || 'No line description'}</span></span><StatePill state={document.status} /><ChevronRight className="h-4 w-4 text-slate-400" /></button>)}
              {matchReviews.slice(0, 3).map((match) => <button key={match.id} type="button" onClick={() => onNavigate('purchase-match')} className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:px-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><ClipboardCheck className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block font-mono text-xs font-bold text-slate-900">{match.id}</span><span className="mt-0.5 block text-xs text-slate-500">Total variance {match.totalVariance}</span></span><StatePill state={match.status} /><ChevronRight className="h-4 w-4 text-slate-400" /></button>)}
              {[...drafts, ...approvals].slice(0, 8).map((voucher) => <button key={voucher.id} type="button" onClick={() => onNavigate('voucher-desk')} className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:px-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><WalletCards className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-900">{voucher.number}</span><span className="mt-0.5 block text-xs text-slate-500">{voucher.type} · {voucher.reference || 'No external reference'}</span></span><StatePill state={voucher.state} /><ChevronRight className="h-4 w-4 text-slate-400" /></button>)}
              {!purchaseActions.length && !matchReviews.length && !drafts.length && !approvals.length && <div className="p-8 text-center text-sm text-slate-500">No draft, submitted or variance-stage records are currently loaded.</div>}
            </div>
          </Panel>
          <Panel title="Operational truth" eyebrow="Current foundation">
            <div className="space-y-4 p-4 sm:p-5">{[
              ['Independent service', 'MesaERP entitlement and company access do not depend on MesaLeads or MesaOps.'],
              ['Balanced ledger', 'Voucher drafts require equal, non-zero debit and credit totals.'],
              ['Maker-checker', 'Submission, approval and posting remain separate versioned actions.'],
              ['Explicit access', 'Missing mesaerp.* grants remain denied by default.'],
            ].map(([heading, copy], index) => <div key={heading} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-xs font-black text-blue-700">{index + 1}</span><div><p className="text-sm font-bold text-slate-900">{heading}</p><p className="mt-0.5 text-xs leading-5 text-slate-500">{copy}</p></div></div>)}</div>
          </Panel>
        </div>
        <p className="text-xs text-slate-400">Counts above are calculated only from records returned for the selected legal entity; no targets or performance claims are inferred.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Notice>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
          <div><strong>MesaERP operates independently.</strong> Start in procurement, inventory, manufacturing, finance or tax. MesaLeads and MesaOps handoffs are optional snapshots, never runtime dependencies.</div>
        </div>
      </Notice>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DerivedCard icon={<ShoppingCart className="h-5 w-5" />} label="Open purchase records" value={openPurchases} detail="Derived from active requisitions, orders and invoices" />
        <DerivedCard icon={<ClipboardCheck className="h-5 w-5" />} label="Match reviews" value={matchExceptions} detail="Quantity, rate or workflow items needing a decision" tone={matchExceptions ? 'amber' : 'emerald'} />
        <DerivedCard icon={<Boxes className="h-5 w-5" />} label="Supply actions" value={shortages.length} detail="Projected available is below the configured safety stock" tone={shortages.length ? 'rose' : 'emerald'} />
        <DerivedCard icon={<WalletCards className="h-5 w-5" />} label="Unposted vouchers" value={unposted} detail="Draft or approved finance records still outside the ledger" tone={unposted ? 'blue' : 'emerald'} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <Panel title="Action queue" eyebrow="Record-derived">
          <div className="divide-y divide-slate-100">
            {statutoryBlocks.map((document) => (
              <button key={document.id} type="button" onClick={() => onNavigate('tax-compliance')} className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:px-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-700"><AlertTriangle className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-900">Resolve required {document.kind.toLowerCase()}</span><span className="mt-0.5 block text-xs text-slate-500">{document.documentNumber} · rule profile marks this artifact as applicable</span></span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
            ))}
            {shortages.map((item) => (
              <button key={item.id} type="button" onClick={() => onNavigate('inventory-mrp')} className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:px-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Boxes className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-900">Plan {item.name}</span><span className="mt-0.5 block text-xs text-slate-500">Available {number(item.onHand - item.allocated)} {item.uom}; policy floor {number(item.safetyStock)} {item.uom}</span></span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
            ))}
            {handoffReviews.map((handoff) => (
              <button key={handoff.id} type="button" onClick={() => onNavigate('handoffs')} className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:px-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><GitBranch className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-900">Review {handoff.sourceService} snapshot</span><span className="mt-0.5 block text-xs text-slate-500">{handoff.sourceReference} · {label(handoff.state)}</span></span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Operational truth" eyebrow="Control model">
          <div className="space-y-4 p-4 sm:p-5">
            {[
              ['Independent starts', 'Every service flow owns its own identifier, status and approvals.'],
              ['Balanced ledger', 'Finance vouchers cannot be saved unless debit equals credit.'],
              ['Applicable legal gate', 'Only a required statutory artifact can hold dispatch.'],
              ['Explicit access', 'Sensitive actions are denied until a role receives a grant.'],
            ].map(([heading, copy], index) => (
              <div key={heading} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-xs font-black text-blue-700">{index + 1}</span>
                <div><p className="text-sm font-bold text-slate-900">{heading}</p><p className="mt-0.5 text-xs leading-5 text-slate-500">{copy}</p></div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <p className="text-xs text-slate-400">Counts above are calculated from the explicit demo workspace records; no targets or performance claims are inferred.</p>
    </div>
  );
}

function SourceToPay({ workspace, mode, currencyCode, legalEntityId, sourceToPayDocuments = [], sourceToPayLoading = false, onCreate, onCreateDocument, onTransitionDocument, onCreateVendor, onTransitionVendor }: { workspace: MesaErpWorkspace; mode: 'demo' | 'live'; currencyCode: string; legalEntityId?: string; sourceToPayDocuments?: ErpSourceToPayDocument[]; sourceToPayLoading?: boolean; onCreate?: (record: PurchaseRecord) => void; onCreateDocument?: (documentType: ErpSourceToPayDocumentType, input: ErpSourceToPayDocumentCreate, requestKey: string) => Promise<void>; onTransitionDocument?: (document: ErpSourceToPayDocument, action: 'submit' | 'approve', requestKey: string) => Promise<void>; onCreateVendor?: (input: VendorCreateInput) => void | Promise<void>; onTransitionVendor?: (vendor: Vendor, to: VendorLifecycleStatus, reason: string) => void | Promise<void> }) {
  const [search, setSearch] = useState('');
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [lifecycleVendor, setLifecycleVendor] = useState<Vendor | null>(null);
  const vendorById = useMemo(() => Object.fromEntries(workspace.vendors.map((vendor) => [vendor.id, vendor])), [workspace.vendors]);
  const records = workspace.purchases.filter((record) => `${record.id} ${record.description} ${vendorById[record.vendorId]?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-5">
      <div data-testid="source-to-pay-layout" className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div data-testid="purchase-register-column" className="min-w-0">
        {mode === 'live' && onCreateDocument && onTransitionDocument ? <LivePurchaseRegister documents={sourceToPayDocuments} vendors={workspace.vendors} currencyCode={currencyCode} loading={sourceToPayLoading} onCreate={onCreateDocument} onTransition={onTransitionDocument} /> : <Panel title="Purchase register" eyebrow="Source to pay" action={<div className="flex flex-wrap gap-2">{onCreate && <button type="button" onClick={() => setPurchaseDialogOpen(true)} className={secondaryButton}><Plus className="h-4 w-4" /> New requisition</button>}{onCreateVendor && <button type="button" onClick={() => setVendorDialogOpen(true)} className={primaryButton}><Plus className="h-4 w-4" /> New vendor</button>}</div>}>
          <div className="border-b border-slate-100 p-4 sm:px-5"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className={`${inputClass} pl-9`} placeholder="Search reference, item or vendor" aria-label="Search purchase records" /></div></div>
          <TableWrap>
            <table className="min-w-[850px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Reference</th><th className="px-4 py-3">Vendor / requirement</th><th className="px-4 py-3">Quantity</th><th className="px-4 py-3">Needed by</th><th className="px-4 py-3">Stage</th><th className="px-5 py-3 text-right">Value</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((record) => <tr key={record.id} className="hover:bg-slate-50"><td className="px-5 py-4 font-mono text-xs font-bold text-blue-700">{record.id}</td><td className="px-4 py-4"><p className="font-bold text-slate-900">{record.description}</p><p className="mt-1 text-xs text-slate-500">{vendorById[record.vendorId]?.name}</p></td><td className="px-4 py-4 text-slate-700">{number(record.orderedQty)} {record.uom}</td><td className="px-4 py-4 text-slate-600">{record.neededBy}</td><td className="px-4 py-4"><StatePill state={record.stage} /></td><td className="px-5 py-4 text-right font-bold text-slate-900">{money(record.orderedQty * record.orderRate)}</td></tr>)}
                {!records.length && <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-500">No purchase record matches this search.</td></tr>}
              </tbody>
            </table>
          </TableWrap>
        </Panel>}
        </div>

        <Panel className="min-w-0" title="Vendor master" eyebrow="Canonical master" action={onCreateVendor && <button type="button" onClick={() => setVendorDialogOpen(true)} className={`${secondaryButton} shrink-0`}><Plus className="h-4 w-4" /> New vendor</button>}>
          <div className="divide-y divide-slate-100">
            {workspace.vendors.map((vendor) => <div key={vendor.id} className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-extrabold text-slate-900">{vendor.name}</p><p className="mt-1 text-xs text-slate-500">{vendor.code || vendor.id} · {vendor.supplies}</p></div><StatePill state={vendor.lifecycleStatus || vendor.gstinState} /></div>{vendor.gstin && <p className="mt-2 font-mono text-[10px] text-slate-500">GSTIN {vendor.gstin}</p>}<div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-slate-500">Terms: <span className="font-bold text-slate-700">{vendor.paymentTerms || 'Not set'}</span></p>{onTransitionVendor && vendor.lifecycleStatus && <button type="button" onClick={() => setLifecycleVendor(vendor)} className="text-xs font-extrabold text-blue-700 hover:text-blue-900">Update status</button>}</div></div>)}
            {!workspace.vendors.length && <div className="p-8 text-center text-sm text-slate-500">No vendors are registered for this legal entity.</div>}
          </div>
        </Panel>
      </div>

      <Panel title="Flow ownership" eyebrow={mode === 'live' ? 'Persisted now · future scope marked' : 'Independent lifecycle'}>
        <div className="grid gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6 sm:p-5">
          {[['Requisition', true], ['RFQ', true], ['Purchase order', true], ['Goods receipt', true], ['Supplier invoice', true], ['Payment proposal', true]].map(([stage, available], index) => <div key={String(stage)} className="relative rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-black text-blue-700">0{index + 1}</p>{mode === 'live' && <span className={`text-[9px] font-extrabold uppercase tracking-wide ${available ? 'text-emerald-700' : 'text-slate-400'}`}>{available ? 'Live' : 'Future'}</span>}</div><p className="mt-2 text-xs font-bold text-slate-800">{stage}</p>{index < 5 && <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-slate-300 lg:block" />}</div>)}
        </div>
        {mode === 'live' && <p className="px-5 pb-4 text-xs leading-5 text-slate-500">RFQ competition and controlled payment proposals are persisted. Proposal approval creates only a linked draft voucher; posting and bank execution remain separate controls.</p>}
      </Panel>

      {mode === 'live' && legalEntityId && <LiveSupplierManagement entityId={legalEntityId} />}

      {purchaseDialogOpen && onCreate && <PurchaseDialog vendors={workspace.vendors} nextIndex={workspace.purchases.length + 1} onClose={() => setPurchaseDialogOpen(false)} onCreate={(record) => { onCreate(record); setPurchaseDialogOpen(false); }} />}
      {vendorDialogOpen && onCreateVendor && <VendorDialog onClose={() => setVendorDialogOpen(false)} onCreate={onCreateVendor} />}
      {lifecycleVendor && onTransitionVendor && <VendorLifecycleDialog vendor={lifecycleVendor} onClose={() => setLifecycleVendor(null)} onTransition={onTransitionVendor} />}
    </div>
  );
}

function VendorLifecycleDialog({ vendor, onClose, onTransition }: { vendor: Vendor; onClose: () => void; onTransition: (vendor: Vendor, to: VendorLifecycleStatus, reason: string) => void | Promise<void> }) {
  const options = vendor.lifecycleStatus ? VENDOR_TRANSITIONS[vendor.lifecycleStatus] : [];
  const [to, setTo] = useState<VendorLifecycleStatus>(options[0] ?? 'under_review');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requiresReason = ['conditionally_approved', 'suspended', 'blocked'].includes(to);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!to || (requiresReason && reason.trim().length < 5) || saving) return;
    setSaving(true); setError('');
    try { await onTransition(vendor, to, reason.trim()); onClose(); }
    catch (transitionError) { setError(transitionError instanceof Error ? transitionError.message : 'Vendor status could not be updated.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="vendor-lifecycle-title">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-lg rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Maker-checker lifecycle</p><h2 id="vendor-lifecycle-title" className="text-lg font-extrabold text-slate-900">Update {vendor.name}</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close vendor status"><X className="h-5 w-5" /></button></div>
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-2 text-xs text-slate-500"><span>Current</span><StatePill state={vendor.lifecycleStatus || 'review'} /><ArrowRight className="h-4 w-4" /><span>Next controlled state</span></div>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Next status</span><select aria-label="Next vendor status" className={inputClass} value={to} onChange={(event) => setTo(event.target.value as VendorLifecycleStatus)}>{options.map((option) => <option key={option} value={option}>{label(option)}</option>)}</select></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Decision reason {requiresReason ? '*' : '(optional)'}</span><textarea aria-label="Vendor status reason" required={requiresReason} minLength={requiresReason ? 5 : undefined} className={`${inputClass} min-h-20 resize-y`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Record evidence or the reason for this transition" /></label>
          {error && <Notice tone="rose">{error}</Notice>}
          <Notice><strong>Server-controlled.</strong> Approval, conditional approval, suspension and blocking decisions require a checker distinct from the vendor maker and previous lifecycle actor.</Notice>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4"><button type="button" onClick={onClose} className={secondaryButton}>Cancel</button><button type="submit" disabled={!options.length || (requiresReason && reason.trim().length < 5) || saving} className={primaryButton}>{saving ? 'Updating…' : 'Update vendor status'}</button></div>
      </form>
    </div>
  );
}

function FoundationPending({ moduleName, scope }: { moduleName: string; scope: string }) {
  return (
    <div className="space-y-5">
      <Notice tone="amber"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><strong>The {moduleName} module is not connected to a persisted API yet.</strong> This view remains in the end-to-end delivery scope, but it does not present local-only changes as live company records.</div></div></Notice>
      <Panel title={`${moduleName} delivery boundary`} eyebrow="API foundation pending">
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-extrabold uppercase tracking-wide text-blue-700">Required next contract</p><p className="mt-2 text-sm leading-6 text-slate-600">{scope}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Independence guarantee</p><p className="mt-2 text-sm leading-6 text-slate-600">Company, vendor, voucher and access-control flows continue to operate without this module. MesaLeads and MesaOps remain optional snapshot sources.</p></div>
        </div>
      </Panel>
    </div>
  );
}

function VendorDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (input: VendorCreateInput) => void | Promise<void> }) {
  const [form, setForm] = useState({ vendorCode: '', legalName: '', tradeName: '', pan: '', gstin: '', categories: '', paymentTerms: '', currency: 'INR', creditDays: '0' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.vendorCode.trim() || !form.legalName.trim() || saving) return;
    setSaving(true); setError('');
    try {
      await onCreate({
        vendorCode: form.vendorCode.trim().toUpperCase(), legalName: form.legalName.trim(), tradeName: form.tradeName.trim(), pan: form.pan.trim().toUpperCase(), gstin: form.gstin.trim().toUpperCase(),
        categories: form.categories.split(',').map((value) => value.trim()).filter(Boolean), paymentTerms: form.paymentTerms.trim(), currency: form.currency.trim().toUpperCase(), creditDays: Number(form.creditDays) || 0,
      });
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Vendor could not be created.');
    } finally {
      setSaving(false);
    }
  };
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="new-vendor-title">
      <form onSubmit={(event) => void submit(event)} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Canonical master</p><h2 id="new-vendor-title" className="text-lg font-extrabold text-slate-900">New vendor</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close vendor"><X className="h-5 w-5" /></button></div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Vendor code *</span><input required className={`${inputClass} uppercase`} value={form.vendorCode} onChange={(event) => set('vendorCode', event.target.value)} placeholder="VEN-001" /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Legal name *</span><input required className={inputClass} value={form.legalName} onChange={(event) => set('legalName', event.target.value)} /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Trade name</span><input className={inputClass} value={form.tradeName} onChange={(event) => set('tradeName', event.target.value)} /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Categories</span><input className={inputClass} value={form.categories} onChange={(event) => set('categories', event.target.value)} placeholder="Raw material, Services" /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">PAN</span><input className={`${inputClass} uppercase`} value={form.pan} onChange={(event) => set('pan', event.target.value)} /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">GSTIN</span><input className={`${inputClass} uppercase`} value={form.gstin} onChange={(event) => set('gstin', event.target.value)} /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Payment terms</span><input className={inputClass} value={form.paymentTerms} onChange={(event) => set('paymentTerms', event.target.value)} placeholder="30 days" /></label>
          <div className="grid grid-cols-2 gap-3"><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Currency</span><input className={`${inputClass} uppercase`} maxLength={3} value={form.currency} onChange={(event) => set('currency', event.target.value)} /></label><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Credit days</span><input className={inputClass} min="0" type="number" value={form.creditDays} onChange={(event) => set('creditDays', event.target.value)} /></label></div>
          {error && <div className="sm:col-span-2"><Notice tone="rose">{error}</Notice></div>}
          <div className="sm:col-span-2"><Notice><strong>Independent master.</strong> Vendor onboarding starts here and does not depend on MesaLeads or MesaOps.</Notice></div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4"><button type="button" onClick={onClose} className={secondaryButton}>Cancel</button><button type="submit" disabled={saving} className={primaryButton}>{saving ? 'Creating…' : 'Create vendor'}</button></div>
      </form>
    </div>
  );
}

function PurchaseDialog({ vendors, nextIndex, onClose, onCreate }: { vendors: MesaErpWorkspace['vendors']; nextIndex: number; onClose: () => void; onCreate: (record: PurchaseRecord) => void }) {
  const [form, setForm] = useState({ vendorId: vendors[0]?.id ?? '', description: '', quantity: '1', rate: '0', uom: 'kg', neededBy: '2026-08-21' });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const quantity = Number(form.quantity);
    const rate = Number(form.rate);
    if (!form.vendorId || !form.description.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0) return;
    onCreate({ id: `PR-DEMO-${String(200 + nextIndex).padStart(4, '0')}`, vendorId: form.vendorId, description: form.description.trim(), orderedQty: quantity, receivedQty: 0, invoicedQty: 0, orderRate: rate, invoiceRate: 0, uom: form.uom.trim() || 'unit', stage: 'requisition', matchState: 'review', neededBy: form.neededBy });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="new-requisition-title">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Independent start</p><h2 id="new-requisition-title" className="text-lg font-extrabold text-slate-900">New purchase requisition</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close requisition"><X className="h-5 w-5" /></button></div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-bold text-slate-700">Vendor</span><select className={inputClass} value={form.vendorId} onChange={(event) => setForm({ ...form, vendorId: event.target.value })}>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
          <label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-bold text-slate-700">Requirement</span><input required className={inputClass} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Material, service or asset" /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Quantity</span><input required min="0.01" step="0.01" type="number" className={inputClass} value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Unit</span><input required className={inputClass} value={form.uom} onChange={(event) => setForm({ ...form, uom: event.target.value })} /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Expected rate</span><input min="0" step="0.01" type="number" className={inputClass} value={form.rate} onChange={(event) => setForm({ ...form, rate: event.target.value })} /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Needed by</span><input required type="date" className={inputClass} value={form.neededBy} onChange={(event) => setForm({ ...form, neededBy: event.target.value })} /></label>
          <Notice><strong>No sales dependency.</strong> This requisition gets its own approval lifecycle even if MesaLeads and MesaOps are unavailable.</Notice>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4"><button type="button" onClick={onClose} className={secondaryButton}>Cancel</button><button type="submit" className={primaryButton}><Plus className="h-4 w-4" /> Create requisition</button></div>
      </form>
    </div>
  );
}

function PurchaseMatch({ workspace, onDecision }: { workspace: MesaErpWorkspace; onDecision: (id: string, decision: PurchaseRecord['matchState']) => void }) {
  const vendorById = Object.fromEntries(workspace.vendors.map((vendor) => [vendor.id, vendor]));
  return (
    <div className="space-y-5">
      <Notice><strong>Three sources, one controlled decision.</strong> Matching compares the approved order, recorded receipt and supplier invoice. A variance is never silently overwritten.</Notice>
      <Panel title="PO · GRN · invoice comparison" eyebrow="Three-way match">
        <TableWrap>
          <table className="min-w-[1050px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Purchase</th><th className="px-4 py-3">PO</th><th className="px-4 py-3">GRN</th><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Rate check</th><th className="px-4 py-3">Status</th><th className="px-5 py-3 text-right">Decision</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {workspace.purchases.filter((record) => record.stage !== 'requisition').map((record) => {
                const quantityVariance = record.invoicedQty - record.receivedQty;
                const rateVariance = record.invoiceRate - record.orderRate;
                return <tr key={record.id} className="align-top hover:bg-slate-50"><td className="px-5 py-4"><p className="font-mono text-xs font-bold text-blue-700">{record.id}</p><p className="mt-1 font-bold text-slate-900">{record.description}</p><p className="mt-1 text-xs text-slate-500">{vendorById[record.vendorId]?.name}</p></td><td className="px-4 py-4"><p className="font-bold text-slate-900">{number(record.orderedQty)} {record.uom}</p><p className="mt-1 text-xs text-slate-500">{money(record.orderRate)} / {record.uom}</p></td><td className="px-4 py-4"><p className="font-bold text-slate-900">{number(record.receivedQty)} {record.uom}</p><p className={`mt-1 text-xs font-bold ${record.receivedQty === record.orderedQty ? 'text-emerald-700' : 'text-rose-700'}`}>{record.receivedQty === record.orderedQty ? 'Quantity agrees' : `${number(record.receivedQty - record.orderedQty)} vs PO`}</p></td><td className="px-4 py-4"><p className="font-bold text-slate-900">{number(record.invoicedQty)} {record.uom}</p><p className={`mt-1 text-xs font-bold ${quantityVariance === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{quantityVariance === 0 ? 'Quantity agrees' : `${number(quantityVariance)} vs GRN`}</p></td><td className="px-4 py-4"><p className="font-bold text-slate-900">{money(record.invoiceRate)}</p><p className={`mt-1 text-xs font-bold ${rateVariance === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{rateVariance === 0 ? 'Rate agrees' : `${money(rateVariance)} variance`}</p></td><td className="px-4 py-4"><StatePill state={record.matchState} /></td><td className="px-5 py-4"><div className="flex justify-end gap-2">{record.matchState === 'exception' && <><button type="button" onClick={() => onDecision(record.id, 'review')} className={secondaryButton}>Send to review</button><button type="button" onClick={() => onDecision(record.id, 'approved-exception')} className={primaryButton}>Approve exception</button></>}{record.matchState === 'review' && <button type="button" onClick={() => onDecision(record.id, 'approved-exception')} className={primaryButton}>Approve review</button>}{['matched', 'approved-exception'].includes(record.matchState) && <span className="inline-flex min-h-10 items-center gap-2 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Decision recorded</span>}</div></td></tr>;
              })}
            </tbody>
          </table>
        </TableWrap>
      </Panel>
      <Notice tone="amber"><strong>MesaOps is optional.</strong> When it is absent, MesaERP can record a lightweight goods receipt with quantity, warehouse, lot and evidence before matching the invoice.</Notice>
    </div>
  );
}

function InventoryMrp({ workspace, onBuy, onMake }: { workspace: MesaErpWorkspace; onBuy: (item: StockItem) => void; onMake: () => void }) {
  return (
    <div className="space-y-5">
      <Panel title="Stock position and supply policy" eyebrow="Inventory & MRP">
        <TableWrap>
          <table className="min-w-[920px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Item</th><th className="px-4 py-3 text-right">On hand</th><th className="px-4 py-3 text-right">Allocated</th><th className="px-4 py-3 text-right">Available</th><th className="px-4 py-3 text-right">Safety stock</th><th className="px-4 py-3">Policy</th><th className="px-5 py-3 text-right">Action</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {workspace.stock.map((item) => {
                const available = item.onHand - item.allocated;
                const short = available < item.safetyStock;
                return <tr key={item.id} className="hover:bg-slate-50"><td className="px-5 py-4"><p className="font-bold text-slate-900">{item.name}</p><p className="mt-1 text-xs text-slate-500">{item.sku} · {item.location}</p></td><td className="px-4 py-4 text-right text-slate-700">{number(item.onHand)} {item.uom}</td><td className="px-4 py-4 text-right text-slate-700">{number(item.allocated)} {item.uom}</td><td className={`px-4 py-4 text-right font-extrabold ${short ? 'text-rose-700' : 'text-emerald-700'}`}>{number(available)} {item.uom}</td><td className="px-4 py-4 text-right text-slate-700">{number(item.safetyStock)} {item.uom}</td><td className="px-4 py-4"><StatePill state={item.replenishment} /></td><td className="px-5 py-4 text-right">{short ? <button type="button" onClick={() => item.replenishment === 'buy' ? onBuy(item) : onMake()} className={primaryButton}>{item.replenishment === 'buy' ? 'Create requisition' : 'Plan production'}</button> : <span className="inline-flex min-h-10 items-center gap-2 text-xs font-bold text-emerald-700"><Check className="h-4 w-4" /> Within policy</span>}</td></tr>;
              })}
            </tbody>
          </table>
        </TableWrap>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="MRP inputs" eyebrow="Rules, not guesses"><div className="space-y-3 p-4 sm:p-5">{['On-hand and allocated stock by warehouse', 'Open purchase and production supply', 'BOM demand and independent forecasts', 'Safety stock, lead time and lot policy'].map((item) => <div key={item} className="flex items-center gap-3 text-sm text-slate-700"><CheckCircle2 className="h-4 w-4 shrink-0 text-blue-700" />{item}</div>)}</div></Panel>
        <Panel title="Independent planning" eyebrow="No upstream wait"><div className="p-4 sm:p-5"><p className="text-sm leading-6 text-slate-600">Forecast, replenishment, rework and trial demand can each start a local material or production plan. A sales order link can add context, but it is not required.</p><button type="button" onClick={onMake} className={`${secondaryButton} mt-4`}>Open manufacturing vouchers <ArrowRight className="h-4 w-4" /></button></div></Panel>
      </div>
    </div>
  );
}

function Manufacturing({ workspace, onCreate }: { workspace: MesaErpWorkspace; onCreate: (voucher: ManufacturingVoucher) => void }) {
  const [type, setType] = useState<ManufacturingVoucherType>('Material issue');
  const [reference, setReference] = useState('');
  const [item, setItem] = useState(workspace.stock[0]?.name ?? '');
  const [quantity, setQuantity] = useState('1');
  const [warehouse, setWarehouse] = useState('RM store');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const qty = Number(quantity);
    if (!reference.trim() || !item.trim() || !Number.isFinite(qty) || qty <= 0) return;
    onCreate({ id: `MV-DEMO-${String(87 + workspace.manufacturingVouchers.length).padStart(4, '0')}`, type, reference: reference.trim(), item: item.trim(), quantity: qty, uom: workspace.stock.find((stock) => stock.name === item)?.uom ?? 'unit', warehouse: warehouse.trim(), state: 'draft', createdAt: '2026-08-14' });
    setReference(''); setQuantity('1');
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <Panel title="Record plant movement" eyebrow="Manufacturing voucher">
        <form onSubmit={submit} className="space-y-4 p-4 sm:p-5">
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Voucher type</span><select value={type} onChange={(event) => setType(event.target.value as ManufacturingVoucherType)} className={inputClass}>{(['Material issue', 'Production receipt', 'Scrap / recovery', 'Job-work movement', 'Stock journal'] as ManufacturingVoucherType[]).map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Work order / reason reference</span><input required className={inputClass} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="WO, trial, rework or plan" /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Item</span><select value={item} onChange={(event) => setItem(event.target.value)} className={inputClass}>{workspace.stock.map((stock) => <option key={stock.id}>{stock.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3"><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Quantity</span><input required min="0.01" step="0.01" type="number" className={inputClass} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Warehouse</span><input required className={inputClass} value={warehouse} onChange={(event) => setWarehouse(event.target.value)} /></label></div>
          <button type="submit" className={`${primaryButton} w-full`}><Plus className="h-4 w-4" /> Save plant draft</button>
          <p className="text-xs leading-5 text-slate-500">Drafts retain their own audit trail. A linked MesaOps batch is optional context, not ownership.</p>
        </form>
      </Panel>
      <Panel title="Movement register" eyebrow="Material and output truth">
        <TableWrap><table className="min-w-[760px] w-full text-left text-sm"><thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Voucher</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Quantity</th><th className="px-4 py-3">Warehouse</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{workspace.manufacturingVouchers.map((voucher) => <tr key={voucher.id} className="hover:bg-slate-50"><td className="px-5 py-4"><p className="font-mono text-xs font-bold text-blue-700">{voucher.id}</p><p className="mt-1 text-xs text-slate-500">{voucher.type}</p></td><td className="px-4 py-4 font-bold text-slate-900">{voucher.reference}</td><td className="px-4 py-4 text-slate-700">{voucher.item}</td><td className="px-4 py-4 font-bold text-slate-900">{number(voucher.quantity)} {voucher.uom}</td><td className="px-4 py-4 text-slate-600">{voucher.warehouse}</td><td className="px-5 py-4"><StatePill state={voucher.state} /></td></tr>)}</tbody></table></TableWrap>
      </Panel>
    </div>
  );
}

const VOUCHER_TYPES: Array<{ type: FinanceVoucherType; key: string }> = [
  { type: 'Contra', key: 'F4' }, { type: 'Payment', key: 'F5' }, { type: 'Receipt', key: 'F6' }, { type: 'Journal', key: 'F7' },
  { type: 'Sales', key: 'F8' }, { type: 'Purchase', key: 'F9' }, { type: 'Credit note', key: '⌥F6' }, { type: 'Debit note', key: '⌥F5' },
  { type: 'Stock journal', key: 'F10' }, { type: 'Manufacturing journal', key: 'F11' }, { type: 'Opening', key: 'F12' },
];

function VoucherReversalDialog({
  voucher,
  onClose,
  onReverse,
}: {
  voucher: FinanceVoucher;
  onClose: () => void;
  onReverse: (voucher: FinanceVoucher, voucherDate: string, reason: string, requestKey: string) => void | Promise<void>;
}) {
  const [requestKey] = useState(() => createErpIdempotencyKey('voucher-reversal'));
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || reason.trim().length < 5) return;
    setSaving(true); setError('');
    try {
      await onReverse(voucher, voucherDate, reason.trim(), requestKey);
      onClose();
    } catch (reverseError) {
      setError(reverseError instanceof Error ? reverseError.message : 'The reversal draft could not be created.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="voucher-reversal-title">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-xl rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Posted voucher control</p><h2 id="voucher-reversal-title" className="text-lg font-extrabold text-slate-900">Create reversal draft</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close voucher reversal"><X className="h-5 w-5" /></button></div>
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="font-mono text-xs font-bold text-blue-700">{voucher.number}</p><p className="mt-1 text-sm font-extrabold text-slate-900">{voucher.type} · {voucher.party}</p><p className="mt-1 text-xs text-slate-500">Posted version {voucher.version ?? 0}</p></div>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Reversal voucher date *</span><input required aria-label="Reversal voucher date" type="date" className={inputClass} value={voucherDate} onChange={(event) => setVoucherDate(event.target.value)} /></label>
          <label><span className="mb-1.5 block text-xs font-bold text-slate-700">Reason *</span><textarea required minLength={5} aria-label="Voucher reversal reason" className={`${inputClass} min-h-24 resize-y`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why the posted entry must be reversed" /></label>
          {error && <Notice tone="rose">{error}</Notice>}
          <Notice tone="amber"><strong>This creates a swapped draft.</strong> The original stays posted until the reversal follows the normal submit, approve and post lifecycle. Only that final posting marks the original reversed.</Notice>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-4"><button type="button" onClick={onClose} className={secondaryButton}>Cancel</button><button type="submit" disabled={saving || reason.trim().length < 5} className={primaryButton}>{saving ? 'Creating…' : 'Create reversal draft'}</button></div>
      </form>
    </div>
  );
}

function VoucherDesk({ workspace, accounts, currencyCode, mode, onSave, onTransition, onReverse }: { workspace: MesaErpWorkspace; accounts?: LedgerAccountOption[]; currencyCode: string; mode: 'demo' | 'live'; onSave: (voucher: FinanceVoucher) => void | Promise<void>; onTransition?: (voucher: FinanceVoucher, action: 'submit' | 'approve' | 'post') => void | Promise<void>; onReverse?: (voucher: FinanceVoucher, voucherDate: string, reason: string, requestKey: string) => void | Promise<void> }) {
  const [type, setType] = useState<FinanceVoucherType>('Journal');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [party, setParty] = useState('');
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState(() => [{ account: accounts?.[0]?.id ?? 'Work in progress', debit: '0', credit: '0' }, { account: accounts?.[1]?.id ?? 'Production overhead absorbed', debit: '0', credit: '0' }]);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState('');
  const [reversingVoucher, setReversingVoucher] = useState<FinanceVoucher | null>(null);
  const [formError, setFormError] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkError, setBulkError] = useState('');
  const debit = sumDecimalStrings(lines.map((line) => line.debit));
  const credit = sumDecimalStrings(lines.map((line) => line.credit));
  const hasEntry = lines.some((line) => isPositiveDecimalString(line.debit) || isPositiveDecimalString(line.credit));
  const balanced = isPositiveDecimalString(debit) && debit === credit;
  const validLines = lines.every((line) => line.account && isNonNegativeVoucherDecimal(line.debit) && isNonNegativeVoucherDecimal(line.credit) && (isPositiveDecimalString(line.debit) !== isPositiveDecimalString(line.credit)));
  const setLine = (index: number, key: 'account' | 'debit' | 'credit', value: string) => setLines((current) => current.map((line, itemIndex) => itemIndex === index ? { ...line, [key]: value } : line));
  const applyBulkRows = () => {
    const parsed = parseVoucherBulkRows(bulkText, accounts);
    if ('error' in parsed) { setBulkError(parsed.error); return; }
    setLines(parsed.lines); setBulkError(''); setBulkText(''); setBulkOpen(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!balanced || !validLines || !party.trim() || saving) return;
    const sequence = String(workspace.financeVouchers.length + 1).padStart(4, '0');
    const voucher: FinanceVoucher = { id: mode === 'demo' ? `FV-DEMO-${sequence}` : `draft-${sequence}`, number: mode === 'demo' ? `${type.slice(0, 3).toUpperCase()}-DEMO-${sequence}` : 'Unnumbered draft', type, date, party: party.trim(), reference: reference.trim(), narration: narration.trim(), state: 'draft', currencyCode, lines: lines.map((line) => ({ account: line.account.trim(), debit: line.debit, credit: line.credit })) };
    setSaving(true); setFormError('');
    try {
      await onSave(voucher);
      setParty(''); setReference(''); setNarration('');
      setLines([{ account: accounts?.[0]?.id ?? '', debit: '0', credit: '0' }, { account: accounts?.[1]?.id ?? '', debit: '0', credit: '0' }]);
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : 'Voucher could not be saved.');
    } finally {
      setSaving(false);
    }
  };
  const transition = async (voucher: FinanceVoucher, action: 'submit' | 'approve' | 'post') => {
    if (!onTransition || transitioning) return;
    setTransitioning(voucher.id); setFormError('');
    try { await onTransition(voucher, action); }
    catch (transitionError) { setFormError(transitionError instanceof Error ? transitionError.message : `Voucher could not be ${action}ted.`); }
    finally { setTransitioning(''); }
  };
  return (
    <div className="space-y-5">
      <Notice><strong>Familiar speed, modern control.</strong> Choose a voucher type, then use visible balance checks, approvals and role-based posting. Draft entry remains available even when other services are offline.</Notice>
      {formError && <Notice tone="rose">{formError}</Notice>}
      <div data-testid="voucher-desk-layout" className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel className="min-w-0" title={`${type} voucher`} eyebrow="Accounting workbench" action={<div className={`inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg px-3 text-xs font-extrabold ${balanced ? 'bg-emerald-50 text-emerald-700' : hasEntry ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{balanced ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : hasEntry ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <WalletCards className="h-4 w-4 shrink-0" />}{balanced ? 'Balanced' : hasEntry ? `Difference ${currencyCode} ${formatDecimalString(absoluteDecimalString(sumDecimalStrings([debit, `-${credit}`])))}` : 'Enter debit and credit'}</div>}>
          <div className="grid min-w-0 border-b border-slate-100 lg:grid-cols-[145px_minmax(0,1fr)]">
            <div className="min-w-0 border-b border-slate-100 bg-slate-50 p-3 lg:border-b-0 lg:border-r"><p className="mb-2 px-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Voucher types</p><div className="grid min-w-0 grid-cols-2 gap-1 lg:grid-cols-1">{VOUCHER_TYPES.map((item) => <button key={item.type} type="button" onClick={() => setType(item.type)} className={`flex min-h-9 min-w-0 items-center justify-between overflow-hidden rounded-lg px-2.5 text-left text-xs font-bold ${type === item.type ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-white'}`}><span className="min-w-0 truncate">{item.type}</span><kbd className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[9px] ${type === item.type ? 'bg-white/15 text-white' : 'bg-slate-200 text-slate-500'}`}>{item.key}</kbd></button>)}</div></div>
            <form id="finance-voucher-form" onSubmit={(event) => void submit(event)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.currentTarget.requestSubmit(); } }} className="min-w-0 p-4 sm:p-5">
              <div className="grid gap-4 sm:grid-cols-3"><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Voucher date</span><input type="date" className={inputClass} value={date} onChange={(event) => setDate(event.target.value)} /></label><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Party / counterparty</span><input required className={inputClass} value={party} onChange={(event) => setParty(event.target.value)} placeholder="Select or enter party" /></label><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Reference</span><input className={inputClass} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Invoice, PO or batch" /></label></div>
              <div data-testid="voucher-ledger-scroll" className="mt-5 max-w-full overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[650px] w-full text-sm"><thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3 text-left">Ledger account</th><th className="w-40 px-3 py-3 text-right">Debit</th><th className="w-40 px-3 py-3 text-right">Credit</th></tr></thead><tbody className="divide-y divide-slate-100">{lines.map((line, index) => <tr key={index}><td className="p-2">{accounts ? <LedgerCombobox index={index} accounts={accounts} value={line.account} onChange={(value) => setLine(index, 'account', value)} /> : <input aria-label={`Ledger account ${index + 1}`} className={inputClass} value={line.account} onChange={(event) => setLine(index, 'account', event.target.value)} placeholder="Ledger account" required />}</td><td className="p-2"><input aria-label={`Debit ${index + 1}`} className={`${inputClass} text-right font-mono`} inputMode="decimal" value={line.debit} onChange={(event) => setLine(index, 'debit', event.target.value)} /></td><td className="p-2"><input aria-label={`Credit ${index + 1}`} className={`${inputClass} text-right font-mono`} inputMode="decimal" value={line.credit} onChange={(event) => setLine(index, 'credit', event.target.value)} /></td></tr>)}</tbody><tfoot className="border-t border-slate-200 bg-slate-50 font-extrabold text-slate-900"><tr><td className="px-4 py-3">Current total</td><td className="px-4 py-3 text-right font-mono">{currencyCode} {formatDecimalString(debit)}</td><td className="px-4 py-3 text-right font-mono">{currencyCode} {formatDecimalString(credit)}</td></tr></tfoot></table></div>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setLines((current) => [...current, { account: '', debit: '0', credit: '0' }])} className={secondaryButton}><Plus className="h-4 w-4" /> Add ledger line</button><button type="button" onClick={() => { setBulkOpen((current) => !current); setBulkError(''); }} className={secondaryButton}><ClipboardCheck className="h-4 w-4" /> Paste ledger rows</button></div>
              {bulkOpen && <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3"><label><span className="mb-1.5 block text-xs font-bold text-blue-900">Bulk ledger rows</span><textarea aria-label="Bulk ledger rows" className={`${inputClass} min-h-28 resize-y font-mono text-xs`} value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder={'Account code or name\tDebit\tCredit\n1300\t1250.50\t0\n2100\t0\t1250.50'} /></label><p className="mt-2 text-xs leading-5 text-blue-800">Paste one tab-separated account, debit and credit row per line. Live mode resolves only active posting ledgers; invalid or ambiguous rows are rejected before replacement.</p>{bulkError && <p role="alert" className="mt-2 text-xs font-bold text-rose-700">{bulkError}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={applyBulkRows} disabled={!bulkText.trim()} className={primaryButton}>Apply pasted rows</button><button type="button" onClick={() => { setBulkOpen(false); setBulkText(''); setBulkError(''); }} className={secondaryButton}>Cancel paste</button></div></div>}
              <label className="mt-4 block"><span className="mb-1.5 block text-xs font-bold text-slate-700">Narration</span><textarea className={`${inputClass} min-h-20 resize-y`} value={narration} onChange={(event) => setNarration(event.target.value)} placeholder="Explain the business event and supporting reference" /></label>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-md text-xs leading-5 text-slate-500"><LockKeyhole className="mr-1 inline h-3.5 w-3.5 text-blue-700" /> Saving creates a draft. Press <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">Ctrl/Cmd + Enter</kbd> to save. Posting requires <strong>mesaerp.voucher.post</strong> and immutable approval evidence.</p><button type="submit" disabled={!balanced || !validLines || !party.trim() || saving} className={primaryButton}>{saving ? 'Saving…' : 'Save balanced draft'}</button></div>
            </form>
          </div>
        </Panel>
        <Panel className="min-w-0" title="Recent vouchers" eyebrow="Workspace register">
          <div className="divide-y divide-slate-100">{workspace.financeVouchers.map((voucher) => { const nextAction = voucher.state === 'draft' ? 'submit' : voucher.state === 'submitted' ? 'approve' : voucher.state === 'approved' ? 'post' : null; return <div key={voucher.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs font-bold text-blue-700">{voucher.number}</p><p className="mt-1 text-sm font-extrabold text-slate-900">{voucher.party}</p></div><StatePill state={voucher.state} /></div><div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>{voucher.type} · {voucher.date}</span><span className="font-bold text-slate-800">{voucher.currencyCode || currencyCode} {formatDecimalString(sumDecimalStrings(voucher.lines.map((line) => line.debit)))}</span></div>{nextAction && onTransition && <button type="button" disabled={transitioning === voucher.id} onClick={() => void transition(voucher, nextAction)} className={`${nextAction === 'post' ? primaryButton : secondaryButton} mt-3 w-full`}>{transitioning === voucher.id ? 'Working…' : `${label(nextAction)} voucher`}</button>}{voucher.state === 'posted' && onReverse && <button type="button" onClick={() => setReversingVoucher(voucher)} className={`${secondaryButton} mt-3 w-full`}><RotateCcw className="h-4 w-4" /> Create reversal draft</button>}</div>; })}{!workspace.financeVouchers.length && <div className="p-8 text-center text-sm text-slate-500">No vouchers have been recorded for this legal entity.</div>}</div>
        </Panel>
      </div>
      {reversingVoucher && onReverse && <VoucherReversalDialog voucher={reversingVoucher} onClose={() => setReversingVoucher(null)} onReverse={onReverse} />}
      <Notice tone="amber"><strong>Current speed scope:</strong> rapid ledger search, bulk paste and keyboard save are live. Saved voucher templates and a global command palette remain deferred.</Notice>
    </div>
  );
}

function isNonNegativeVoucherDecimal(value: string) {
  return /^(?:\d+)(?:\.\d+)?$/.test(value.trim());
}

function resolveBulkLedger(token: string, accounts?: LedgerAccountOption[]) {
  if (!accounts) return { id: token };
  const needle = token.trim().toLowerCase();
  const candidates = accounts.filter((account) => account.allowPosting).filter((account) => (
    account.id.toLowerCase() === needle
    || account.code.toLowerCase() === needle
    || account.name.toLowerCase() === needle
    || `${account.code} · ${account.name}`.toLowerCase() === needle
  ));
  if (candidates.length !== 1) return candidates.length ? { error: `Ledger “${token}” is ambiguous.` } : { error: `Ledger “${token}” is not an active posting account.` };
  return { id: candidates[0].id };
}

export function parseVoucherBulkRows(value: string, accounts?: LedgerAccountOption[]): { lines: Array<{ account: string; debit: string; credit: string }> } | { error: string } {
  const sourceRows = value.split(/\r?\n/).filter((row) => row.trim());
  if (!sourceRows.length) return { error: 'Paste at least one ledger row.' };
  if (sourceRows.length > 100) return { error: 'Paste no more than 100 ledger rows at once.' };
  const parsed: Array<{ account: string; debit: string; credit: string }> = [];
  for (let index = 0; index < sourceRows.length; index += 1) {
    const columns = sourceRows[index].split('\t').map((column) => column.trim());
    if (columns.length !== 3 || !columns[0]) return { error: `Row ${index + 1} must contain account, debit and credit columns separated by tabs.` };
    const debit = columns[1] || '0';
    const credit = columns[2] || '0';
    if (!isNonNegativeVoucherDecimal(debit) || !isNonNegativeVoucherDecimal(credit)) return { error: `Row ${index + 1} contains an invalid non-negative decimal.` };
    if (isPositiveDecimalString(debit) === isPositiveDecimalString(credit)) return { error: `Row ${index + 1} must contain a positive debit or a positive credit, never both.` };
    const account = resolveBulkLedger(columns[0], accounts);
    if ('error' in account) return { error: `Row ${index + 1}: ${account.error}` };
    parsed.push({ account: account.id, debit, credit });
  }
  return { lines: parsed };
}

function LedgerCombobox({ index, accounts, value, onChange }: { index: number; accounts: LedgerAccountOption[]; value: string; onChange: (value: string) => void }) {
  const postingAccounts = useMemo(() => accounts.filter((account) => account.allowPosting), [accounts]);
  const selected = postingAccounts.find((account) => account.id === value);
  const selectedLabel = selected ? `${selected.code} · ${selected.name}` : '';
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  useEffect(() => { setQuery(selectedLabel); }, [selectedLabel]);
  const normalized = query.trim().toLowerCase();
  const matches = postingAccounts.filter((account) => !normalized || account.code.toLowerCase().includes(normalized) || account.name.toLowerCase().includes(normalized)).slice(0, 8);
  const choose = (account: LedgerAccountOption) => { onChange(account.id); setQuery(`${account.code} · ${account.name}`); setOpen(false); };
  return <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}><input required role="combobox" aria-expanded={open} aria-controls={`ledger-options-${index}`} aria-autocomplete="list" aria-label={`Ledger account ${index + 1}`} className={inputClass} value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); onChange(''); setOpen(true); }} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'Enter' && open && matches[0]) { event.preventDefault(); choose(matches[0]); } }} placeholder="Search code or ledger name" autoComplete="off" />{open && <div id={`ledger-options-${index}`} role="listbox" className="absolute z-30 mt-1 max-h-60 w-full min-w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl">{matches.map((account) => <button key={account.id} type="button" role="option" aria-selected={account.id === value} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(account)} className={`block w-full rounded-md px-3 py-2 text-left text-xs ${account.id === value ? 'bg-blue-50 text-blue-900' : 'text-slate-700 hover:bg-slate-50'}`}><span className="font-mono font-bold text-blue-700">{account.code}</span><span className="ml-2 font-bold">{account.name}</span></button>)}{!matches.length && <p className="px-3 py-3 text-xs text-slate-500">No active posting ledger matches this search.</p>}</div>}</div>;
}

function TaxCompliance({ documents, onRecord }: { documents: TaxDocument[]; onRecord: (id: string, reference: string) => void }) {
  const [activeId, setActiveId] = useState('');
  const [reference, setReference] = useState('');
  return (
    <div className="space-y-5">
      <Notice tone="amber"><strong>Rulesets decide applicability.</strong> Thresholds, dates, document classes and jurisdiction logic belong in effective-dated country profiles—not in UI code. A missing artifact blocks dispatch only when the active profile says it is legally required.</Notice>
      <Panel title="India statutory workbench" eyebrow="Effective-dated compliance">
        <TableWrap><table className="min-w-[980px] w-full text-left text-sm"><thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Document</th><th className="px-4 py-3">Business reference</th><th className="px-4 py-3">Applicability</th><th className="px-4 py-3">Ruleset</th><th className="px-4 py-3">External reference</th><th className="px-5 py-3">Control</th></tr></thead><tbody className="divide-y divide-slate-100">{documents.map((document) => <tr key={document.id} className="align-top hover:bg-slate-50"><td className="px-5 py-4"><p className="font-extrabold text-slate-900">{document.kind}</p><div className="mt-2"><StatePill state={document.state} /></div></td><td className="px-4 py-4 font-mono text-xs font-bold text-blue-700">{document.documentNumber}</td><td className="px-4 py-4"><StatePill state={document.applicability} /></td><td className="px-4 py-4 text-xs leading-5 text-slate-600">{document.ruleset}</td><td className="px-4 py-4 font-mono text-xs text-slate-700">{document.externalReference ?? 'Not recorded'}</td><td className="px-5 py-4">{document.state !== 'ready' && document.state !== 'not-applicable' ? <div className="min-w-[240px]">{activeId === document.id ? <div className="flex gap-2"><input aria-label={`External reference for ${document.kind}`} autoFocus className={inputClass} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="IRN / bill / certificate ref" /><button type="button" disabled={!reference.trim()} onClick={() => { onRecord(document.id, reference.trim()); setActiveId(''); setReference(''); }} className={primaryButton}>Record</button></div> : <button type="button" onClick={() => setActiveId(document.id)} className={secondaryButton}>Record external reference</button>}</div> : <span className="inline-flex min-h-10 items-center gap-2 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Evidence ready</span>}</td></tr>)}</tbody></table></TableWrap>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2"><Panel title="May block dispatch" eyebrow="Applicable law"><div className="space-y-2 p-4 sm:p-5"><p className="text-sm leading-6 text-slate-600">A required invoice, e-invoice or movement artifact that is absent or invalid can hold dispatch until corrected.</p><StatePill state="blocked" /></div></Panel><Panel title="Warns without blocking" eyebrow="Operational resilience"><div className="space-y-2 p-4 sm:p-5"><p className="text-sm leading-6 text-slate-600">An unavailable optional service, stale handoff, pending reconciliation or bookkeeping delay remains visible but does not stop the local workflow.</p><StatePill state="review" /></div></Panel></div>
    </div>
  );
}

function HandoffInbox({ handoffs, onSnapshot, onReview }: { handoffs: HandoffRecord[]; onSnapshot: (id: string) => void; onReview: (id: string) => void }) {
  return (
    <div className="space-y-5">
      <Notice><strong>Snapshot, then own the destination.</strong> Correlation IDs and hashes preserve traceability, while each service keeps its own lifecycle. A source failure never rolls back a destination record.</Notice>
      <Panel title="Optional service handoffs" eyebrow="Inbox">
        <div className="divide-y divide-slate-100">
          {handoffs.map((handoff) => <article key={handoff.id} className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[200px_1fr_220px_auto] xl:items-center"><div><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Link2 className="h-4 w-4" /></span><div><p className="text-xs font-extrabold text-slate-900">{handoff.sourceService}</p><p className="font-mono text-[10px] text-slate-500">{handoff.sourceReference}</p></div></div></div><div><p className="text-sm font-bold text-slate-900">{handoff.summary}</p><p className="mt-1 text-xs text-slate-500">Destination: {handoff.destination}{handoff.destinationReference ? ` · ${handoff.destinationReference}` : ''}</p><p className="mt-1 font-mono text-[10px] text-slate-400">{handoff.sourceHash}</p></div><div><StatePill state={handoff.state} /><p className="mt-2 text-xs text-slate-500">{handoff.reviewed ? 'Reviewed' : 'Review pending'}</p></div><div className="flex flex-wrap gap-2 xl:justify-end">{!handoff.destinationReference && <button type="button" onClick={() => onSnapshot(handoff.id)} className={primaryButton}>Create local snapshot</button>}{!handoff.reviewed && <button type="button" onClick={() => onReview(handoff.id)} className={secondaryButton}>Mark reviewed</button>}</div></article>)}
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-4">{['linked', 'stale', 'conflict', 'unlinked'].map((state) => <div key={state} className="rounded-xl border border-slate-200 bg-white p-4"><StatePill state={state} /><p className="mt-3 text-xs leading-5 text-slate-500">{{ linked: 'Snapshot agrees with its source hash.', stale: 'Source changed after destination creation.', conflict: 'Competing changes require a person.', unlinked: 'Valid local record with no source service.' }[state]}</p></div>)}</div>
    </div>
  );
}

function permissionFallback(permission: PermissionKey): PermissionDefinition {
  const suffix = permission.replace(/^mesaerp\./, '');
  return { key: permission, label: label(suffix), description: 'Explicit MesaERP action grant.', riskLevel: ['post', 'approve', 'reopen', 'verify'].some((word) => suffix.includes(word)) ? 'high' : 'standard' };
}

function RolesAccess({ roles, permissions, assignments, onReplace, onCreateAssignment, onRevokeAssignment, onCreateRole }: { roles: EnterpriseRole[]; permissions: PermissionDefinition[]; assignments: EnterpriseRoleAssignment[]; onReplace: (role: EnterpriseRole, grants: PermissionKey[]) => void | Promise<void>; onCreateAssignment?: (role: EnterpriseRole, membershipId: string) => void | Promise<void>; onRevokeAssignment?: (assignment: EnterpriseRoleAssignment, reason: string) => void | Promise<void>; onCreateRole?: (name: string, grants: PermissionKey[], requestKey: string) => void | Promise<void> }) {
  const [activeRoleId, setActiveRoleId] = useState(roles[0]?.id ?? '');
  const [savingPermission, setSavingPermission] = useState('');
  const [error, setError] = useState('');
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [roleCreateOpen, setRoleCreateOpen] = useState(false);
  const [revokeAssignment, setRevokeAssignment] = useState<EnterpriseRoleAssignment | null>(null);
  const role = roles.find((item) => item.id === activeRoleId) ?? roles[0];
  const catalogue = permissions.length ? permissions : PERMISSIONS.map(permissionFallback);
  if (!role) return <div className="space-y-5"><Notice tone="amber"><strong>No MesaERP roles are available for this legal entity.</strong> Access remains denied until an administrator creates and assigns an explicit role.</Notice>{onCreateRole && <button type="button" onClick={() => setRoleCreateOpen(true)} className={primaryButton}><Plus className="h-4 w-4" /> Create first role</button>}{roleCreateOpen && onCreateRole && <RoleCreateDialog permissions={catalogue} onClose={() => setRoleCreateOpen(false)} onCreate={onCreateRole} />}</div>;
  const roleAssignments = assignments.filter((assignment) => assignment.roleId === role.id && assignment.status === 'active');
  const toggle = async (permission: PermissionKey, granted: boolean) => {
    const grants = granted ? [...new Set([...role.grants, permission])].sort() as PermissionKey[] : role.grants.filter((item) => item !== permission);
    setSavingPermission(permission); setError('');
    try { await onReplace(role, grants); }
    catch (replaceError) { setError(replaceError instanceof Error ? replaceError.message : 'Role permissions could not be saved.'); }
    finally { setSavingPermission(''); }
  };
  return (
    <div className="space-y-5">
      <Notice><div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><div><strong>Default deny is the baseline.</strong> A missing grant means the action is forbidden. UI visibility improves clarity; the API must enforce the same organization-scoped permission on every mutation.</div></div></Notice>
      {error && <Notice tone="rose">{error}</Notice>}
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Panel title="Enterprise roles" eyebrow="Company scoped" action={onCreateRole && <button type="button" onClick={() => setRoleCreateOpen(true)} className={secondaryButton}><Plus className="h-4 w-4" /> New role</button>}><div className="p-2">{roles.map((item) => <button key={item.id} type="button" onClick={() => setActiveRoleId(item.id)} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left ${item.id === role.id ? 'bg-blue-50 text-blue-900' : 'text-slate-600 hover:bg-slate-50'}`}><span className={`flex h-9 w-9 items-center justify-center rounded-lg ${item.id === role.id ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-500'}`}><UsersRound className="h-4 w-4" /></span><span><span className="block text-sm font-extrabold">{item.name}</span><span className="mt-0.5 block text-xs opacity-70">{item.scope} · {item.grants.length} explicit grants</span></span></button>)}</div></Panel>
        <Panel title={role.name} eyebrow={`${role.scope} · Explicit permissions`} action={<div className="flex flex-wrap gap-2">{onCreateAssignment && <button type="button" onClick={() => setAssignmentOpen(true)} className={secondaryButton}><UsersRound className="h-4 w-4" /> Assign person</button>}<span className="inline-flex min-h-8 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-extrabold text-white"><LockKeyhole className="h-3.5 w-3.5" /> Default deny</span></div>}>
          <div className="divide-y divide-slate-100">{catalogue.map((definition) => {
            const granted = role.grants.includes(definition.key);
            return <div key={definition.key} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-extrabold text-slate-900">{definition.label}</p><StatePill state={definition.riskLevel} /></div><p className="mt-1 font-mono text-xs text-slate-500">{definition.key}</p><p className="mt-1 text-xs text-slate-400">{definition.description}</p></div><button disabled={Boolean(savingPermission)} type="button" role="switch" aria-checked={granted} aria-label={`${definition.label} for ${role.name}`} onClick={() => void toggle(definition.key, !granted)} className={`relative h-7 w-12 rounded-full transition disabled:opacity-50 ${granted ? 'bg-blue-700' : 'bg-slate-300'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${granted ? 'left-6' : 'left-1'}`} /></button></div>;
          })}</div>
        </Panel>
      </div>
      <Panel title="Assigned people" eyebrow={`${roleAssignments.length} active assignments`}>
        <div className="divide-y divide-slate-100">{roleAssignments.map((assignment) => <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5"><div><p className="text-sm font-extrabold text-slate-900">{assignment.memberName}</p><p className="mt-1 text-xs text-slate-500">{assignment.employeeCode} · {assignment.membershipId}</p></div><div className="flex items-center gap-3"><StatePill state={assignment.status} />{onRevokeAssignment && <button type="button" onClick={() => setRevokeAssignment(assignment)} className="text-xs font-extrabold text-rose-700 hover:text-rose-900">Revoke</button>}</div></div>)}{!roleAssignments.length && <div className="p-6 text-center text-sm text-slate-500">No active assignments use this role in the selected legal entity.</div>}</div>
      </Panel>
      {assignmentOpen && onCreateAssignment && <RoleAssignmentDialog role={role} onClose={() => setAssignmentOpen(false)} onCreate={onCreateAssignment} />}
      {revokeAssignment && onRevokeAssignment && <RoleRevokeDialog assignment={revokeAssignment} onClose={() => setRevokeAssignment(null)} onRevoke={onRevokeAssignment} />}
      {roleCreateOpen && onCreateRole && <RoleCreateDialog permissions={catalogue} onClose={() => setRoleCreateOpen(false)} onCreate={onCreateRole} />}
    </div>
  );
}

function RoleCreateDialog({ permissions, onClose, onCreate }: { permissions: PermissionDefinition[]; onClose: () => void; onCreate: (name: string, grants: PermissionKey[], requestKey: string) => void | Promise<void> }) {
  const [requestKey] = useState(() => createErpIdempotencyKey('role-create'));
  const [name, setName] = useState('');
  const [grants, setGrants] = useState<PermissionKey[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toggle = (permission: PermissionKey) => setGrants((current) => current.includes(permission) ? current.filter((key) => key !== permission) : [...current, permission].sort() as PermissionKey[]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2 || saving) return;
    setSaving(true); setError('');
    try { await onCreate(name.trim(), grants, requestKey); onClose(); }
    catch (createError) { setError(createError instanceof Error ? createError.message : 'The company role could not be created.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="role-create-title"><form onSubmit={(event) => void submit(event)} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Company-scoped default deny</p><h2 id="role-create-title" className="text-lg font-extrabold text-slate-900">Create MesaERP role</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close role creation"><X className="h-5 w-5" /></button></div><div className="space-y-4 p-5"><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Role name *</span><input required minLength={2} aria-label="Role name" className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></label><div><p className="mb-2 text-xs font-bold text-slate-700">Initial explicit grants</p><div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">{permissions.map((permission) => <label key={permission.key} className="flex cursor-pointer items-start gap-3 p-3 hover:bg-slate-50"><input type="checkbox" className="mt-1" checked={grants.includes(permission.key)} onChange={() => toggle(permission.key)} /><span><span className="block text-sm font-bold text-slate-900">{permission.label}</span><span className="mt-0.5 block font-mono text-[10px] text-slate-500">{permission.key}</span></span></label>)}</div></div>{error && <Notice tone="rose">{error}</Notice>}<Notice><strong>Exact grants only.</strong> The role starts with only the selected <code>mesaerp.*</code> permissions. Membership assignment is a separate audited action.</Notice></div><div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white p-4"><button type="button" onClick={onClose} className={secondaryButton}>Cancel</button><button type="submit" disabled={name.trim().length < 2 || saving} className={primaryButton}>{saving ? 'Creating…' : 'Create role'}</button></div></form></div>
  );
}

function RoleAssignmentDialog({ role, onClose, onCreate }: { role: EnterpriseRole; onClose: () => void; onCreate: (role: EnterpriseRole, membershipId: string) => void | Promise<void> }) {
  const [membershipId, setMembershipId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!membershipId.trim() || saving) return;
    setSaving(true); setError('');
    try { await onCreate(role, membershipId.trim()); onClose(); }
    catch (createError) { setError(createError instanceof Error ? createError.message : 'Role assignment could not be created.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="role-assignment-title">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-lg rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Company-scoped access</p><h2 id="role-assignment-title" className="text-lg font-extrabold text-slate-900">Assign {role.name}</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close role assignment"><X className="h-5 w-5" /></button></div>
        <div className="space-y-4 p-5"><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Organization membership ID *</span><input required aria-label="Organization membership ID" className={inputClass} value={membershipId} onChange={(event) => setMembershipId(event.target.value)} placeholder="Membership ID from Admin · People" /></label>{error && <Notice tone="rose">{error}</Notice>}<Notice><strong>Administrator input.</strong> This foundation validates the membership and role on the server. Directory search can be added when a company membership-list endpoint is available.</Notice></div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4"><button type="button" onClick={onClose} className={secondaryButton}>Cancel</button><button type="submit" disabled={!membershipId.trim() || saving} className={primaryButton}>{saving ? 'Assigning…' : 'Assign role'}</button></div>
      </form>
    </div>
  );
}

function RoleRevokeDialog({ assignment, onClose, onRevoke }: { assignment: EnterpriseRoleAssignment; onClose: () => void; onRevoke: (assignment: EnterpriseRoleAssignment, reason: string) => void | Promise<void> }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 5 || saving) return;
    setSaving(true); setError('');
    try { await onRevoke(assignment, reason.trim()); onClose(); }
    catch (revokeError) { setError(revokeError instanceof Error ? revokeError.message : 'Role assignment could not be revoked.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="role-revoke-title">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-lg rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-rose-700">Audited access change</p><h2 id="role-revoke-title" className="text-lg font-extrabold text-slate-900">Revoke {assignment.roleName}</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close role revocation"><X className="h-5 w-5" /></button></div>
        <div className="space-y-4 p-5"><p className="text-sm text-slate-600">Remove this company role from <strong>{assignment.memberName}</strong>. Existing audit evidence remains immutable.</p><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Revocation reason *</span><textarea required minLength={5} aria-label="Role revocation reason" className={`${inputClass} min-h-20 resize-y`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why access is being removed" /></label>{error && <Notice tone="rose">{error}</Notice>}</div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4"><button type="button" onClick={onClose} className={secondaryButton}>Cancel</button><button type="submit" disabled={reason.trim().length < 5 || saving} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-rose-700 px-4 text-sm font-bold text-white hover:bg-rose-800 disabled:bg-slate-300">{saving ? 'Revoking…' : 'Revoke assignment'}</button></div>
      </form>
    </div>
  );
}

function Sidebar({ view, mobileOpen, mode, workspaceLabel, legalEntities, selectedLegalEntityId, onSelectLegalEntity, onNavigate, onClose, onExit }: { view: MesaErpView; mobileOpen: boolean; mode: 'demo' | 'live'; workspaceLabel?: string; legalEntities?: Array<{ id: string; label: string }>; selectedLegalEntityId?: string; onSelectLegalEntity?: (id: string) => void; onNavigate: (view: MesaErpView) => void; onClose: () => void; onExit?: () => void }) {
  return (
    <>
      {mobileOpen && <button type="button" className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" aria-label="Close navigation backdrop" onClick={onClose} />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5"><Logo className="h-9 w-9" /><div><p className="font-extrabold leading-none text-slate-900">MesaERP</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Manufacturing by MesaOrigins</p></div><button type="button" onClick={onClose} className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-slate-100 lg:hidden" aria-label="Close navigation"><X className="h-5 w-5" /></button></div>
        <nav className="flex-1 overflow-y-auto p-3" aria-label="MesaERP navigation">{NAV_GROUPS.map((group) => <div key={group.label} className="mb-4"><p className="mb-1 px-3 text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-400">{group.label}</p>{group.items.map((item) => { const Icon = item.icon; const active = item.id === view; return <button key={item.id} type="button" onClick={() => { onNavigate(item.id); onClose(); }} className={`mb-0.5 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-bold transition ${active ? 'bg-blue-50 text-blue-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`} aria-current={active ? 'page' : undefined}><Icon className={`h-4 w-4 ${active ? 'text-blue-700' : 'text-slate-400'}`} />{item.label}</button>; })}</div>)}</nav>
        <div className="border-t border-slate-200 p-3"><div className="rounded-xl border border-blue-100 bg-blue-50 p-3"><div className="flex items-center gap-2"><Building2 className="h-4 w-4 shrink-0 text-blue-700" /><p className="min-w-0 truncate text-xs font-extrabold text-blue-900">{workspaceLabel || (mode === 'demo' ? 'Demo Manufacturing Co.' : 'MesaERP company')}</p></div>{legalEntities && legalEntities.length > 1 && <select aria-label="Legal entity" className="mt-2 min-h-9 w-full rounded-lg border border-blue-200 bg-white px-2 text-xs font-bold text-blue-900" value={selectedLegalEntityId} onChange={(event) => onSelectLegalEntity?.(event.target.value)}>{legalEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.label}</option>)}</select>}<p className="mt-1.5 text-[10px] leading-4 text-blue-700">{mode === 'demo' ? 'Explicit local demo fallback' : 'Live API workspace · company scoped'}</p></div>{onExit && <button type="button" onClick={onExit} className={`${secondaryButton} mt-2 w-full`}>Back to MesaOrigins</button>}</div>
      </aside>
    </>
  );
}

export default function MesaErpApp({
  initialView = 'overview', initialWorkspace, workspace: controlledWorkspace, mode = 'demo', workspaceLabel, currencyCode = 'INR', legalEntities, selectedLegalEntityId, onSelectLegalEntity,
  accounts, permissions = [], roleAssignments = [], sourceToPayDocuments = [], purchaseMatches = [], customers = [], salesOrders = [], salesInvoices = [], productionDemands = [], persistedManufacturingVouchers = [], batchCosts = [], sourceToPayLoading = false, purchaseMatchesLoading = false, commercialLoading = false, manufacturingLoading = false, loadWarnings = [], onExit, onMutation, onCreateVendor, onTransitionVendor, onCreateSourceToPayDocument, onTransitionSourceToPayDocument, onCreatePurchaseMatch, onApprovePurchaseMatch, onCreateCustomer, onCreateSalesDocument, onTransitionSalesDocument, onCreateProductionDemand, onTransitionProductionDemand, onCreatePersistedManufacturingVoucher, onTransitionPersistedManufacturingVoucher, onSaveFinanceVoucher, onTransitionFinanceVoucher, onReverseFinanceVoucher, onReplaceRolePermissions, onCreateRoleAssignment, onRevokeRoleAssignment, onCreateRole,
}: MesaErpAppProps) {
  const [view, setView] = useState<MesaErpView>(initialView);
  const [mobileNav, setMobileNav] = useState(false);
  const [localWorkspace, setLocalWorkspace] = useState<MesaErpWorkspace>(() => initialWorkspace ?? createDemoWorkspace());
  const workspace = controlledWorkspace ?? localWorkspace;
  const [toast, setToast] = useState('');
  const [adapterError, setAdapterError] = useState('');

  const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The requested change could not be saved.';
  const emit = (mutation: MesaErpMutation, success: string) => {
    setToast(success);
    setAdapterError('');
    try {
      const result = onMutation?.(mutation);
      if (result && typeof result.then === 'function') result.catch((error) => setAdapterError(errorMessage(error)));
    } catch {
      setAdapterError('The requested change could not be saved.');
    }
  };
  const persist = async (action: () => void | Promise<void>, success: string) => {
    setAdapterError('');
    try { await action(); setToast(success); }
    catch (error) { setAdapterError(errorMessage(error)); throw error; }
  };

  const createVendor = async (input: VendorCreateInput) => {
    if (onCreateVendor) return persist(() => onCreateVendor(input), `${input.vendorCode} created in the vendor master.`);
    const record: Vendor = { id: `VEN-DEMO-${localWorkspace.vendors.length + 1}`, code: input.vendorCode, name: input.legalName, tradeName: input.tradeName, supplies: input.categories?.join(', ') || 'Unclassified', paymentTerms: input.paymentTerms || '', gstinState: input.gstin ? 'verified' : 'review', gstin: input.gstin, lifecycleStatus: 'invited', complianceStatus: 'pending', rowVersion: 0 };
    setLocalWorkspace((current) => ({ ...current, vendors: [record, ...current.vendors] }));
    emit({ type: 'vendor.created', input }, `${input.vendorCode} created in the demo vendor master.`);
  };
  const transitionVendor = onTransitionVendor ? async (vendor: Vendor, to: VendorLifecycleStatus, reason: string) => (
    persist(() => onTransitionVendor(vendor, to, reason), `${vendor.code || vendor.name} moved to ${label(to)}.`)
  ) : undefined;
  const createSourceToPayDocument = onCreateSourceToPayDocument ? async (documentType: ErpSourceToPayDocumentType, input: ErpSourceToPayDocumentCreate, requestKey: string) => (
    persist(() => onCreateSourceToPayDocument(documentType, input, requestKey), `${label(documentType)} draft created.`)
  ) : undefined;
  const transitionSourceToPayDocument = onTransitionSourceToPayDocument ? async (document: ErpSourceToPayDocument, action: 'submit' | 'approve', requestKey: string) => (
    persist(() => onTransitionSourceToPayDocument(document, action, requestKey), `${document.documentNumber} ${action === 'submit' ? 'submitted' : 'approved'}.`)
  ) : undefined;
  const createPurchaseMatch = onCreatePurchaseMatch ? async (input: { purchaseOrderId: string; goodsReceiptId: string; supplierInvoiceId: string }, requestKey: string) => (
    persist(() => onCreatePurchaseMatch(input, requestKey), 'Three-way match evaluated and recorded.')
  ) : undefined;
  const approvePurchaseMatch = onApprovePurchaseMatch ? async (match: ErpPurchaseMatchCase, reason: string, requestKey: string) => (
    persist(() => onApprovePurchaseMatch(match, reason, requestKey), `${match.id} variance approved by a separate checker.`)
  ) : undefined;
  const createCustomer = onCreateCustomer ? async (input: ErpCustomerCreate, requestKey: string) => (
    persist(() => onCreateCustomer(input, requestKey), `${input.customerCode} created in the customer master.`)
  ) : undefined;
  const createSalesDocument = onCreateSalesDocument ? async (documentType: ErpSalesDocumentType, input: ErpSalesDocumentCreate, requestKey: string) => (
    persist(() => onCreateSalesDocument(documentType, input, requestKey), `${label(documentType)} draft created.`)
  ) : undefined;
  const transitionSalesDocument = onTransitionSalesDocument ? async (document: ErpSalesDocument, action: 'submit' | 'approve', requestKey: string) => (
    persist(() => onTransitionSalesDocument(document, action, requestKey), `${document.documentNumber} ${action === 'submit' ? 'submitted' : 'approved'}.`)
  ) : undefined;
  const createProductionDemand = onCreateProductionDemand ? async (input: ErpProductionDemandCreate, requestKey: string) => (
    persist(() => onCreateProductionDemand(input, requestKey), `${label(input.demandType)} production demand created.`)
  ) : undefined;
  const transitionProductionDemand = onTransitionProductionDemand ? async (demand: ErpProductionDemand, action: 'approve' | 'release', requestKey: string) => (
    persist(() => onTransitionProductionDemand(demand, action, requestKey), `${demand.demandNumber} ${action === 'approve' ? 'approved' : 'released'}.`)
  ) : undefined;
  const createPersistedManufacturingVoucher = onCreatePersistedManufacturingVoucher ? async (input: ErpManufacturingVoucherCreate, requestKey: string) => (
    persist(() => onCreatePersistedManufacturingVoucher(input, requestKey), 'Manufacturing voucher draft created.')
  ) : undefined;
  const transitionPersistedManufacturingVoucher = onTransitionPersistedManufacturingVoucher ? async (voucher: ErpPersistedManufacturingVoucher, action: 'submit' | 'approve' | 'post', requestKey: string) => (
    persist(() => onTransitionPersistedManufacturingVoucher(voucher, action, requestKey), `${voucher.voucherNumber} ${action === 'submit' ? 'submitted' : `${action}ed`}.`)
  ) : undefined;

  const createPurchase = (record: PurchaseRecord) => {
    setLocalWorkspace((current) => ({ ...current, purchases: [record, ...current.purchases] }));
    emit({ type: 'purchase.created', record }, `${record.id} created as an independent requisition.`);
  };
  const decideMatch = (id: string, decision: PurchaseRecord['matchState']) => {
    setLocalWorkspace((current) => ({ ...current, purchases: current.purchases.map((record) => record.id === id ? { ...record, matchState: decision } : record) }));
    emit({ type: 'purchase.match-decided', id, decision }, `${id} decision recorded.`);
  };
  const requestSupply = (item: StockItem) => {
    const purchaseId = `PR-DEMO-${String(210 + workspace.purchases.length).padStart(4, '0')}`;
    const shortfall = Math.max(item.safetyStock - (item.onHand - item.allocated), 1);
    const record: PurchaseRecord = { id: purchaseId, vendorId: workspace.vendors[0]?.id ?? '', description: item.name, orderedQty: shortfall, receivedQty: 0, invoicedQty: 0, orderRate: 0, invoiceRate: 0, uom: item.uom, stage: 'requisition', matchState: 'review', neededBy: '2026-08-21' };
    setLocalWorkspace((current) => ({ ...current, purchases: [record, ...current.purchases] }));
    emit({ type: 'inventory.supply-requested', stockItemId: item.id, purchaseId }, `${purchaseId} created for ${item.name}.`);
    setView('source-to-pay');
  };
  const createManufacturing = (voucher: ManufacturingVoucher) => {
    setLocalWorkspace((current) => ({ ...current, manufacturingVouchers: [voucher, ...current.manufacturingVouchers] }));
    emit({ type: 'manufacturing-voucher.created', voucher }, `${voucher.id} saved as a plant draft.`);
  };
  const saveFinance = async (voucher: FinanceVoucher) => {
    if (onSaveFinanceVoucher) return persist(() => onSaveFinanceVoucher(voucher), 'Balanced voucher saved as a draft.');
    setLocalWorkspace((current) => ({ ...current, financeVouchers: [voucher, ...current.financeVouchers] }));
    emit({ type: 'finance-voucher.saved', voucher }, `${voucher.number} saved as a balanced draft.`);
  };
  const transitionFinance = async (voucher: FinanceVoucher, action: 'submit' | 'approve' | 'post') => {
    if (onTransitionFinanceVoucher) return persist(() => onTransitionFinanceVoucher(voucher, action), `${voucher.number} ${action === 'submit' ? 'submitted' : `${action}ed`}.`);
    const nextState = action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : 'posted';
    setLocalWorkspace((current) => ({ ...current, financeVouchers: current.financeVouchers.map((item) => item.id === voucher.id ? { ...item, state: nextState, version: (item.version ?? 0) + 1 } : item) }));
    setToast(`${voucher.number} ${action === 'submit' ? 'submitted' : `${action}ed`}.`);
  };
  const reverseFinance = onReverseFinanceVoucher ? async (voucher: FinanceVoucher, voucherDate: string, reason: string, requestKey: string) => (
    persist(() => onReverseFinanceVoucher(voucher, voucherDate, reason, requestKey), `Reversal draft created for ${voucher.number}.`)
  ) : undefined;
  const recordTax = (id: string, externalReference: string) => {
    setLocalWorkspace((current) => ({ ...current, taxDocuments: current.taxDocuments.map((document) => document.id === id ? { ...document, externalReference, state: 'ready' } : document) }));
    emit({ type: 'tax-reference.recorded', id, externalReference }, 'Statutory evidence recorded.');
  };
  const createSnapshot = (id: string) => {
    const destinationReference = `LOCAL-DEMO-${String(workspace.handoffs.length + 1).padStart(3, '0')}`;
    setLocalWorkspace((current) => ({ ...current, handoffs: current.handoffs.map((handoff) => handoff.id === id ? { ...handoff, destinationReference, state: 'linked', reviewed: true } : handoff) }));
    emit({ type: 'handoff.snapshot-created', id, destinationReference }, `${destinationReference} created from an immutable snapshot.`);
  };
  const reviewHandoff = (id: string) => {
    setLocalWorkspace((current) => ({ ...current, handoffs: current.handoffs.map((handoff) => handoff.id === id ? { ...handoff, reviewed: true } : handoff) }));
    emit({ type: 'handoff.reviewed', id }, 'Handoff review recorded.');
  };
  const replacePermissions = async (role: EnterpriseRole, grants: PermissionKey[]) => {
    if (onReplaceRolePermissions) return persist(() => onReplaceRolePermissions(role, grants), `${role.name} permissions replaced.`);
    const before = role.grants;
    setLocalWorkspace((current) => ({ ...current, roles: current.roles.map((item) => item.id === role.id ? { ...item, grants, version: (item.version ?? 0) + 1 } : item) }));
    const changed = grants.find((permission) => !before.includes(permission)) || before.find((permission) => !grants.includes(permission));
    if (changed) emit({ type: 'role.permission-changed', roleId: role.id, permission: changed, granted: grants.includes(changed) }, `${label(changed)} ${grants.includes(changed) ? 'granted' : 'removed'}.`);
  };
  const createRoleAssignment = onCreateRoleAssignment ? async (role: EnterpriseRole, membershipId: string) => (
    persist(() => onCreateRoleAssignment(role, membershipId), `${role.name} assigned for this company.`)
  ) : undefined;
  const revokeRoleAssignment = onRevokeRoleAssignment ? async (assignment: EnterpriseRoleAssignment, reason: string) => (
    persist(() => onRevokeRoleAssignment(assignment, reason), `${assignment.roleName} assignment revoked.`)
  ) : undefined;
  const createEnterpriseRole = onCreateRole ? async (name: string, grants: PermissionKey[], requestKey: string) => (
    persist(() => onCreateRole(name, grants, requestKey), `${name} created with ${grants.length} explicit grants.`)
  ) : undefined;

  const content = {
    overview: <Overview workspace={workspace} onNavigate={setView} mode={mode} sourceToPayDocuments={sourceToPayDocuments} purchaseMatches={purchaseMatches} />,
    'source-to-pay': <SourceToPay workspace={workspace} mode={mode} currencyCode={currencyCode} legalEntityId={selectedLegalEntityId} sourceToPayDocuments={sourceToPayDocuments} sourceToPayLoading={sourceToPayLoading} onCreate={mode === 'demo' ? createPurchase : undefined} onCreateDocument={createSourceToPayDocument} onTransitionDocument={transitionSourceToPayDocument} onCreateVendor={createVendor} onTransitionVendor={transitionVendor} />,
    'purchase-match': mode === 'live' && createPurchaseMatch && approvePurchaseMatch ? <LivePurchaseMatch documents={sourceToPayDocuments} matches={purchaseMatches} loading={purchaseMatchesLoading} onCreate={createPurchaseMatch} onApprove={approvePurchaseMatch} /> : mode === 'live' ? <FoundationPending moduleName="Purchase matching" scope="Persisted PO, GRN and supplier-invoice matching with exact permissions and separate-checker variance approval." /> : <PurchaseMatch workspace={workspace} onDecision={decideMatch} />,
    commercial: mode === 'live' && createCustomer && createSalesDocument && transitionSalesDocument ? <LiveCommercialControl customers={customers} salesOrders={salesOrders} salesInvoices={salesInvoices} currencyCode={currencyCode} loading={commercialLoading} onCreateCustomer={createCustomer} onCreateDocument={createSalesDocument} onTransition={transitionSalesDocument} /> : mode === 'live' ? <FoundationPending moduleName="Customers & sales" scope="Customer masters, sales orders and sales invoices under exact company-scoped permissions." /> : <FoundationPending moduleName="Customers & sales" scope="Use the live MesaERP route to operate persisted customer and sales-document records." />,
    'inventory-mrp': mode === 'live' && selectedLegalEntityId ? <LiveInventoryPlanning entityId={selectedLegalEntityId} accounts={accounts ?? []} vendors={workspace.vendors} /> : <InventoryMrp workspace={workspace} onBuy={requestSupply} onMake={() => setView('manufacturing')} />,
    manufacturing: mode === 'live' && createProductionDemand && transitionProductionDemand && createPersistedManufacturingVoucher && transitionPersistedManufacturingVoucher ? <LiveManufacturingControl salesOrders={salesOrders} demands={productionDemands} vouchers={persistedManufacturingVouchers} batchCosts={batchCosts} loading={manufacturingLoading} onCreateDemand={createProductionDemand} onTransitionDemand={transitionProductionDemand} onCreateVoucher={createPersistedManufacturingVoucher} onTransitionVoucher={transitionPersistedManufacturingVoucher} /> : mode === 'live' ? <FoundationPending moduleName="Manufacturing vouchers" scope="Production demands, valued manufacturing vouchers and immutable actual batch costs." /> : <Manufacturing workspace={workspace} onCreate={createManufacturing} />,
    'voucher-desk': <VoucherDesk workspace={workspace} accounts={accounts} currencyCode={currencyCode} mode={mode} onSave={saveFinance} onTransition={transitionFinance} onReverse={reverseFinance} />,
    'finance-controls': mode === 'live' && selectedLegalEntityId ? <LiveFinanceControls entityId={selectedLegalEntityId} accounts={accounts ?? []} currencyCode={currencyCode} legalEntities={legalEntities ?? []} /> : <FoundationPending moduleName="Finance controls" scope="Use the live MesaERP route for persisted accounts, periods, banking, assets, budgets, reports and group accounting." />,
    'tax-compliance': mode === 'live' && selectedLegalEntityId ? <LiveIndiaCompliance entityId={selectedLegalEntityId} salesInvoices={salesInvoices} supplierInvoices={sourceToPayDocuments.filter((document) => document.documentType === 'supplier_invoice')} /> : <TaxCompliance documents={workspace.taxDocuments} onRecord={recordTax} />,
    handoffs: mode === 'live' && selectedLegalEntityId ? <LiveHandoffInbox entityId={selectedLegalEntityId} /> : <HandoffInbox handoffs={workspace.handoffs} onSnapshot={createSnapshot} onReview={reviewHandoff} />,
    'roles-access': <RolesAccess roles={workspace.roles} permissions={permissions} assignments={roleAssignments} onReplace={replacePermissions} onCreateAssignment={createRoleAssignment} onRevokeAssignment={revokeRoleAssignment} onCreateRole={createEnterpriseRole} />,
  }[view];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Sidebar view={view} mobileOpen={mobileNav} mode={mode} workspaceLabel={workspaceLabel} legalEntities={legalEntities} selectedLegalEntityId={selectedLegalEntityId} onSelectLegalEntity={onSelectLegalEntity} onNavigate={setView} onClose={() => setMobileNav(false)} onExit={onExit} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <button type="button" onClick={() => setMobileNav(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1"><h1 className="truncate text-base font-extrabold text-slate-900 sm:text-lg">{VIEW_COPY[view].title}</h1><p className="hidden truncate text-xs text-slate-500 sm:block">{VIEW_COPY[view].subtitle}</p></div>
          <span className="hidden min-h-8 items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-[10px] font-extrabold uppercase tracking-wide text-slate-500 md:inline-flex">{mode === 'demo' ? 'Demo fallback' : 'Live company data'}</span>
          <button type="button" aria-label="New voucher" onClick={() => setView('voucher-desk')} className={primaryButton}><Plus className="h-4 w-4" /><span className="hidden sm:inline">New voucher</span></button>
        </header>
        <main className="p-4 sm:p-6 lg:p-8">
          {loadWarnings.length > 0 && <div className="mb-5"><Notice tone="amber"><strong>Some company data is still loading or unavailable.</strong><ul className="mt-1 list-disc pl-5">{loadWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p className="mt-1 text-xs">Available MesaERP flows continue independently; restricted actions remain denied by the API.</p></Notice></div>}
          {(toast || adapterError) && <div className="mb-5 space-y-2" aria-live="polite">{toast && <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{toast}</span><button type="button" onClick={() => setToast('')} className="rounded p-1 hover:bg-emerald-100" aria-label="Dismiss notification"><X className="h-4 w-4" /></button></div>}{adapterError && <Notice tone="rose">{adapterError}</Notice>}</div>}
          {content}
        </main>
      </div>
    </div>
  );
}
