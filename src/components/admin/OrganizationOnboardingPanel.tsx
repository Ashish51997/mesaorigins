import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Boxes, Building2, CheckCircle2, Mail, MapPin, Phone, RefreshCw, Search, Users } from 'lucide-react';
import { api, ApiError } from '../../lib/apiClient';

export type ServiceCatalogItem = {
  id: string;
  name: string;
  description: string;
  status: string;
  sortOrder: number;
};

type OrganizationService = ServiceCatalogItem & {
  assignmentStatus: string;
};

type BootstrapForm = {
  organizationName: string;
  organizationSlug: string;
  adminName: string;
  adminEmail: string;
  password: string;
  serviceIds: string[];
};

export type CreatedOrganization = {
  organization: { id: string; name: string; slug: string; services: ServiceCatalogItem[] };
  owner: { name: string; email: string; employeeCode: string; role: string };
};

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  subscriptionStatus: string;
  createdAt: string;
  mesaLeadsProfile?: {
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
  } | null;
  services: OrganizationService[];
  contacts: Array<{
    membershipId: string;
    name: string;
    email: string;
    role: string;
    employeeCode: string;
    status: string;
  }>;
};

const EMPTY_FORM: BootstrapForm = {
  organizationName: '',
  organizationSlug: '',
  adminName: '',
  adminEmail: '',
  password: '',
  serviceIds: ['mesaops'],
};

const inputClass = 'mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 sm:text-sm';

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function OrganizationOnboardingPanel({ onCreated }: { onCreated?: (created: CreatedOrganization) => void }) {
  const [form, setForm] = useState<BootstrapForm>(EMPTY_FORM);
  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedOrganization | null>(null);

  const valid = useMemo(() => (
    form.organizationName.trim().length >= 2 &&
    form.organizationSlug.trim().length >= 2 &&
    /^[a-z0-9-]+$/.test(form.organizationSlug.trim()) &&
    form.adminName.trim().length >= 2 &&
    /.+@.+/.test(form.adminEmail) &&
    form.password.length >= 12 &&
    form.serviceIds.length > 0
  ), [form]);

  useEffect(() => {
    let cancelled = false;
    const loadCatalog = async () => {
      try {
        const response = await api.get<{ services: ServiceCatalogItem[] }>('/onboarding/services');
        if (cancelled) return;
        setServiceCatalog(response.services);
        setForm((current) => {
          const availableIds = new Set(response.services.map((service) => service.id));
          const serviceIds = current.serviceIds.filter((id) => availableIds.has(id));
          if (serviceIds.length > 0 || response.services.length === 0) return { ...current, serviceIds };
          const defaultService = response.services.find((service) => service.id === 'mesaops') ?? response.services[0];
          return { ...current, serviceIds: defaultService ? [defaultService.id] : [] };
        });
        setCatalogError('');
      } catch (loadError) {
        if (!cancelled) setCatalogError(messageFor(loadError, 'Could not load the service catalog.'));
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    };
    void loadCatalog();
    return () => { cancelled = true; };
  }, []);

  const patch = (next: Partial<BootstrapForm>) => {
    setForm((current) => ({ ...current, ...next }));
    setError('');
    setCreated(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    setCreated(null);
    try {
      const result = await api.post<CreatedOrganization>('/onboarding/bootstrap', {
        organizationName: form.organizationName.trim(),
        organizationSlug: form.organizationSlug.trim(),
        adminName: form.adminName.trim(),
        adminEmail: form.adminEmail.trim(),
        password: form.password,
        serviceIds: form.serviceIds,
      });
      setCreated(result);
      setForm(EMPTY_FORM);
      setSlugTouched(false);
      onCreated?.(result);
    } catch (submitError) {
      setError(messageFor(submitError, 'Could not create organization.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
          <Building2 className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900">Create client organization</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">Provision a tenant, its built-in roles and its first owner account.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-[13px] font-semibold text-slate-700">Organization name</span>
          <input
            value={form.organizationName}
            onChange={(event) => {
              const organizationName = event.target.value;
              patch({
                organizationName,
                ...(!slugTouched ? { organizationSlug: slugify(organizationName) } : {}),
              });
            }}
            required
            placeholder="e.g. Acme Plastics"
            className={inputClass}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[13px] font-semibold text-slate-700">Organization slug</span>
          <input
            aria-label="Organization slug"
            value={form.organizationSlug}
            onChange={(event) => {
              setSlugTouched(true);
              patch({ organizationSlug: slugify(event.target.value) });
            }}
            required
            placeholder="acme-plastics"
            className={inputClass}
          />
          <span className="mt-1 block text-[11px] text-slate-400">Lowercase letters, numbers and hyphens only.</span>
        </label>
        <label className="block">
          <span className="text-[13px] font-semibold text-slate-700">First owner name</span>
          <input value={form.adminName} onChange={(event) => patch({ adminName: event.target.value })} required placeholder="e.g. Priya Sharma" className={inputClass} />
        </label>
        <label className="block">
          <span className="text-[13px] font-semibold text-slate-700">Owner email</span>
          <input type="email" value={form.adminEmail} onChange={(event) => patch({ adminEmail: event.target.value })} required placeholder="owner@company.com" className={inputClass} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[13px] font-semibold text-slate-700">Temporary password</span>
          <input type="password" value={form.password} onChange={(event) => patch({ password: event.target.value })} required minLength={12} maxLength={128} placeholder="At least 12 characters" className={inputClass} />
        </label>
        <fieldset className="sm:col-span-2">
          <legend className="text-[13px] font-semibold text-slate-700">Services</legend>
          <p className="mt-1 text-[11px] text-slate-400">Choose one or more MesaOrigins services for this organization.</p>
          {catalogLoading ? (
            <div className="mt-2 rounded-lg bg-slate-50 px-3 py-4 text-xs text-slate-500">Loading services…</div>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {serviceCatalog.map((service) => {
                const selected = form.serviceIds.includes(service.id);
                return (
                  <label key={service.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${selected ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => patch({
                        serviceIds: selected
                          ? form.serviceIds.filter((id) => id !== service.id)
                          : [...form.serviceIds, service.id],
                      })}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-xs font-bold text-slate-800">
                        {service.name}
                        {service.status !== 'active' && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] uppercase text-amber-700">{service.status}</span>}
                      </span>
                      <span className="mt-1 block text-[11px] leading-4 text-slate-500">{service.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {!catalogLoading && serviceCatalog.length === 0 && !catalogError && (
            <p className="mt-2 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-xs text-slate-500">No services are available.</p>
          )}
          {form.serviceIds.length === 0 && serviceCatalog.length > 0 && (
            <p className="mt-2 text-xs font-medium text-rose-600">Select at least one service.</p>
          )}
        </fieldset>
      </div>

      {catalogError && <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">{catalogError}</div>}
      {error && <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">{error}</div>}
      {created && (
        <div role="status" aria-live="polite" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-4 w-4" /> Organization created</div>
          <p className="mt-1 text-xs leading-5">{created.organization.name} is ready with {created.owner.name} as its first owner and {created.organization.services.length} assigned {created.organization.services.length === 1 ? 'service' : 'services'}.</p>
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <button type="submit" disabled={!valid || saving || catalogLoading || Boolean(catalogError)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-sky-600 px-5 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40">
          <Building2 className="h-4 w-4" /> {saving ? 'Creating…' : 'Create organization'}
        </button>
      </div>
    </form>
  );
}

export function OrganizationsDirectory({
  refreshKey = 0,
  onServicesChanged,
}: {
  refreshKey?: number;
  onServicesChanged?: (organization: OrganizationSummary) => void;
}) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogItem[]>([]);
  const [savingOrganizationId, setSavingOrganizationId] = useState<string | null>(null);
  const [serviceErrors, setServiceErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const loadOrganizations = async () => {
    setLoading(true);
    try {
      await api.get<{ allowed: boolean }>('/onboarding/access');
      const [organizationResponse, serviceResponse] = await Promise.all([
        api.get<{ organizations: OrganizationSummary[] }>('/onboarding/organizations'),
        api.get<{ services: ServiceCatalogItem[] }>('/onboarding/services'),
      ]);
      setOrganizations(organizationResponse.organizations);
      setServiceCatalog(serviceResponse.services);
      setError('');
    } catch (loadError) {
      setError(messageFor(loadError, 'Could not load organizations.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOrganizations();
  }, [refreshKey]);

  const toggleService = async (organization: OrganizationSummary, serviceId: string) => {
    if (savingOrganizationId) return;
    const assigned = organization.services.some((service) => service.id === serviceId);
    if (assigned && organization.services.length === 1) {
      setServiceErrors((current) => ({ ...current, [organization.id]: 'At least one service is required.' }));
      return;
    }
    const serviceIds = assigned
      ? organization.services.filter((service) => service.id !== serviceId).map((service) => service.id)
      : [...organization.services.map((service) => service.id), serviceId];
    setSavingOrganizationId(organization.id);
    setServiceErrors((current) => ({ ...current, [organization.id]: '' }));
    try {
      const response = await api.put<{ organizationId: string; services: OrganizationService[] }>(
        `/onboarding/organizations/${organization.id}/services`,
        { serviceIds },
      );
      const updated = { ...organization, services: response.services };
      setOrganizations((current) => current.map((item) => item.id === organization.id ? updated : item));
      onServicesChanged?.(updated);
    } catch (updateError) {
      setServiceErrors((current) => ({
        ...current,
        [organization.id]: messageFor(updateError, 'Could not update organization services.'),
      }));
    } finally {
      setSavingOrganizationId(null);
    }
  };

  const visibleOrganizations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return organizations;
    return organizations.filter((organization) => (
      organization.name.toLowerCase().includes(normalized) ||
      organization.slug.toLowerCase().includes(normalized) ||
      organization.mesaLeadsProfile?.legalName.toLowerCase().includes(normalized) ||
      organization.mesaLeadsProfile?.brandName.toLowerCase().includes(normalized) ||
      organization.mesaLeadsProfile?.capabilities.some((capability) => capability.toLowerCase().includes(normalized)) ||
      organization.services.some((service) => service.name.toLowerCase().includes(normalized)) ||
      organization.contacts.some((contact) => contact.name.toLowerCase().includes(normalized) || contact.email.toLowerCase().includes(normalized))
    ));
  }, [organizations, query]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">Organizations</h2>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{organizations.length}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">All organizations onboarded through MesaOrigins.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1 sm:w-64">
            <span className="sr-only">Search organizations</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search organizations" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-sky-600 focus:ring-2 focus:ring-sky-100" />
          </label>
          <button onClick={() => void loadOrganizations()} disabled={loading} aria-label="Refresh organizations" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-sky-300 hover:text-sky-700 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {error && <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">{error}</div>}
        {loading && organizations.length === 0 ? (
          <div className="rounded-lg bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">Loading organizations…</div>
        ) : visibleOrganizations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
            {query.trim() ? 'No organizations match your search.' : 'No organizations have been onboarded yet.'}
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {visibleOrganizations.map((organization) => (
              <article key={organization.id} aria-label={organization.name} className="rounded-xl border border-slate-200 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#102A65] text-white">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate font-bold text-slate-900">{organization.name}</h3>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{organization.slug}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase ${organization.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{organization.status}</span>
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3">
                  <div>
                    <dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Plan</dt>
                    <dd className="mt-1 truncate text-xs font-semibold capitalize text-slate-700">{organization.plan}</dd>
                  </div>
                  <div>
                    <dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Subscription</dt>
                    <dd className="mt-1 truncate text-xs font-semibold capitalize text-slate-700">{organization.subscriptionStatus}</dd>
                  </div>
                  <div>
                    <dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Onboarded</dt>
                    <dd className="mt-1 truncate text-xs font-semibold text-slate-700">{new Date(organization.createdAt).toLocaleDateString()}</dd>
                  </div>
                </dl>

                {organization.mesaLeadsProfile && (
                  <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">MesaLeads profile</p>
                        <p className="mt-1 text-xs font-bold text-slate-800">
                          {organization.mesaLeadsProfile.brandName || organization.mesaLeadsProfile.legalName}
                        </p>
                        {organization.mesaLeadsProfile.summary && (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-600">{organization.mesaLeadsProfile.summary}</p>
                        )}
                      </div>
                      <span className="shrink-0 rounded-md border border-blue-200 bg-white px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-blue-700">Customer-facing</span>
                    </div>
                    <div className="mt-2 grid gap-1 text-[10px] text-slate-600 sm:grid-cols-2">
                      {(organization.mesaLeadsProfile.contact.name || organization.mesaLeadsProfile.contact.title) && (
                        <p className="truncate"><Users className="mr-1 inline h-3 w-3 text-blue-600" />{[organization.mesaLeadsProfile.contact.name, organization.mesaLeadsProfile.contact.title].filter(Boolean).join(' · ')}</p>
                      )}
                      {organization.mesaLeadsProfile.emails[0] && (
                        <p className="truncate"><Mail className="mr-1 inline h-3 w-3 text-blue-600" />{organization.mesaLeadsProfile.emails[0]}</p>
                      )}
                      {organization.mesaLeadsProfile.phones[0] && (
                        <p className="truncate"><Phone className="mr-1 inline h-3 w-3 text-blue-600" />{organization.mesaLeadsProfile.phones[0]}</p>
                      )}
                      {(organization.mesaLeadsProfile.address.city || organization.mesaLeadsProfile.address.state) && (
                        <p className="truncate"><MapPin className="mr-1 inline h-3 w-3 text-blue-600" />{[organization.mesaLeadsProfile.address.city, organization.mesaLeadsProfile.address.state].filter(Boolean).join(', ')}</p>
                      )}
                    </div>
                    {organization.mesaLeadsProfile.capabilities.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {organization.mesaLeadsProfile.capabilities.slice(0, 4).map((capability) => (
                          <span key={capability} className="rounded bg-white px-1.5 py-1 text-[9px] font-semibold text-slate-600 ring-1 ring-blue-100">{capability}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Service access</p>
                    <span className="text-[10px] font-semibold text-slate-400">{organization.services.length} assigned</span>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {serviceCatalog.map((service) => {
                      const assigned = organization.services.some((item) => item.id === service.id);
                      const isLastAssigned = assigned && organization.services.length === 1;
                      const saving = savingOrganizationId === organization.id;
                      return (
                        <button
                          key={service.id}
                          type="button"
                          aria-pressed={assigned}
                          aria-label={`${assigned ? 'Remove' : 'Add'} ${service.name} ${assigned ? 'from' : 'to'} ${organization.name}`}
                          disabled={saving || isLastAssigned}
                          title={isLastAssigned ? 'Every organization needs at least one service' : undefined}
                          onClick={() => void toggleService(organization, service.id)}
                          className={`flex min-h-14 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed ${assigned ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-500 hover:border-sky-200 hover:bg-sky-50/50'} ${isLastAssigned ? 'disabled:opacity-70' : 'disabled:opacity-50'}`}
                        >
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${assigned ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                            {assigned ? <CheckCircle2 className="h-4 w-4" /> : <Boxes className="h-4 w-4" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-bold">{service.name}</span>
                            <span className="mt-0.5 block text-[10px] font-medium">{assigned ? (saving ? 'Saving…' : 'Assigned') : 'Not assigned'}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {serviceErrors[organization.id] && (
                    <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{serviceErrors[organization.id]}</p>
                  )}
                </div>

                <div className="mt-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Owners and administrators</p>
                  <div className="mt-2 space-y-2">
                    {organization.contacts.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">No owner or administrator contact.</p>
                    ) : organization.contacts.map((contact) => (
                      <div key={contact.membershipId} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[10px] font-bold text-sky-700 ring-1 ring-slate-200">
                          {contact.name.split(/\s+/).map((part) => part[0] ?? '').slice(0, 2).join('').toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-slate-800">{contact.name}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-slate-500"><Mail className="h-3 w-3 shrink-0" /> {contact.email}</p>
                        </div>
                        <span className="shrink-0 text-[10px] font-semibold text-slate-400">{contact.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
