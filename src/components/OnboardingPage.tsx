import { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, Mail, ShieldCheck, Users } from 'lucide-react';
import { api, ApiError } from '../lib/apiClient';
import Logo from './Logo';
import OnboardingLogin from './OnboardingLogin';

const inCls =
  'mt-1 w-full min-h-11 rounded-lg border border-slate-200 px-3 py-2.5 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600';

type BootstrapForm = {
  organizationName: string;
  organizationSlug: string;
  adminName: string;
  adminEmail: string;
  password: string;
};

type CreatedState = {
  organization: { id: string; name: string; slug: string };
  owner: { name: string; email: string; employeeCode: string; role: string };
};

type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  subscriptionStatus: string;
  createdAt: string;
  updatedAt: string;
  contacts: Array<{ membershipId: string; userId: string; name: string; email: string; role: string; employeeCode: string; status: string }>;
};

type LoginSession = { uid: string; email: string; displayName: string; role: string; isFirebase: boolean };

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

export default function OnboardingPage({ onLogin }: { onLogin: (session: LoginSession) => void }) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreatedState | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [form, setForm] = useState<BootstrapForm>({
    organizationName: '',
    organizationSlug: '',
    adminName: '',
    adminEmail: '',
    password: '',
  });

  const load = async () => {
    const [access, orgs] = await Promise.all([
      api.get<{ allowed: boolean }>('/onboarding/access'),
      api.get<{ organizations: OrganizationSummary[] }>('/onboarding/organizations'),
    ]);
    setAllowed(Boolean(access.allowed));
    setOrganizations(orgs.organizations);
    setError('');
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch {
        if (!cancelled) {
          setAllowed(false);
          setError('');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleOnboardingLogin = async (session: LoginSession) => {
    onLogin(session);
    setLoading(true);
    try {
      await load();
    } catch (err) {
      setAllowed(false);
      setError(err instanceof ApiError ? err.message : 'You are not allowed to onboard organizations.');
    } finally {
      setLoading(false);
    }
  };

  const valid = useMemo(() => (
    form.organizationName.trim().length >= 2 &&
    form.organizationSlug.trim().length >= 2 &&
    /^[a-z0-9-]+$/.test(form.organizationSlug.trim()) &&
    form.adminName.trim().length >= 2 &&
    /.+@.+/.test(form.adminEmail) &&
    form.password.length >= 8
  ), [form]);

  const set = (patch: Partial<BootstrapForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      const created = await api.post<CreatedState>('/onboarding/bootstrap', {
        organizationName: form.organizationName.trim(),
        organizationSlug: form.organizationSlug.trim(),
        adminName: form.adminName.trim(),
        adminEmail: form.adminEmail.trim(),
        password: form.password,
      });
      setCreated(created);
      setForm({ organizationName: '', organizationSlug: '', adminName: '', adminEmail: '', password: '' });
      const orgs = await api.get<{ organizations: OrganizationSummary[] }>('/onboarding/organizations');
      setOrganizations(orgs.organizations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create organization.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 gap-3 font-sans">
        <Logo className="h-9 w-9" />
        <p className="text-sm text-slate-500">Loading onboarding…</p>
      </div>
    );
  }
  if (!allowed) return <OnboardingLogin onLogin={handleOnboardingLogin} />;

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 font-sans">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Logo className="h-9 w-9 shrink-0" />
            <div className="min-w-0">
              <h1 className="font-extrabold text-slate-900 text-base leading-none">MesaDesk</h1>
              <p className="text-[11px] sm:text-xs text-slate-500 font-light mt-0.5">One Platform. Every Operation.</p>
            </div>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-md bg-sky-50 px-3 py-1 text-[12px] font-medium text-sky-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Product owner console
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Organization onboarding and directory</h2>
            <p className="mt-1 text-sm text-slate-500">Signed in as the product owner. Create client organizations and review existing organization details.</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 text-slate-900 font-semibold text-lg"><Building2 className="h-4 w-4 text-sky-600" /> Create organization</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block sm:col-span-2"><span className="block text-[13px] font-medium text-slate-600 mb-1">Organization name</span><input value={form.organizationName} onChange={(e) => set({ organizationName: e.target.value, organizationSlug: form.organizationSlug.trim() ? form.organizationSlug : slugify(e.target.value) })} className={inCls} placeholder="e.g. Acme Plastics" /></label>
              <label className="block sm:col-span-2"><span className="block text-[13px] font-medium text-slate-600 mb-1">Organization slug</span><input value={form.organizationSlug} onChange={(e) => set({ organizationSlug: slugify(e.target.value) })} className={inCls} placeholder="acme-plastics" /></label>
              <label className="block"><span className="block text-[13px] font-medium text-slate-600 mb-1">First owner name</span><input value={form.adminName} onChange={(e) => set({ adminName: e.target.value })} className={inCls} placeholder="e.g. Priya Sharma" /></label>
              <label className="block"><span className="block text-[13px] font-medium text-slate-600 mb-1">Owner email</span><input type="email" value={form.adminEmail} onChange={(e) => set({ adminEmail: e.target.value })} className={inCls} placeholder="owner@client.com" /></label>
              <label className="block sm:col-span-2"><span className="block text-[13px] font-medium text-slate-600 mb-1">Temporary password</span><input type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} className={inCls} placeholder="At least 8 characters" /></label>
            </div>
            {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <div className="flex justify-end">
              <button onClick={submit} disabled={!valid || saving} className="min-h-11 px-5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-sm font-medium inline-flex items-center gap-1.5">
                <Building2 className="h-4 w-4" /> {saving ? 'Creating…' : 'Create organization'}
              </button>
            </div>
            {created && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Organization created</div>
                <div className="mt-2 text-sm text-emerald-900">{created.organization.name} (`{created.organization.slug}`) with first owner {created.owner.name} ({created.owner.email}).</div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex items-center gap-2 text-slate-900 font-semibold text-lg"><Users className="h-4 w-4 text-sky-600" /> All organizations</div>
            <p className="mt-1 text-sm text-slate-500">Read-only directory of all organizations and their current owner/admin contacts.</p>
            <div className="mt-4 space-y-3 max-h-[70vh] overflow-auto pr-1">
              {organizations.map((org) => (
                <div key={org.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-slate-900">{org.name}</div>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{org.slug}</span>
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{org.status}</span>
                    <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">{org.plan}</span>
                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">{org.subscriptionStatus}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">Created {new Date(org.createdAt).toLocaleString()}</div>
                  <div className="mt-3 space-y-2">
                    {org.contacts.length === 0 ? (
                      <div className="text-sm text-slate-500">No owner/admin contacts found.</div>
                    ) : org.contacts.map((contact) => (
                      <div key={contact.membershipId} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                        <div className="font-medium text-slate-800">{contact.name} <span className="text-slate-400 font-normal">({contact.role})</span></div>
                        <div className="mt-0.5 flex items-center gap-2 text-slate-500"><Mail className="h-3.5 w-3.5" /> {contact.email}</div>
                        <div className="mt-0.5 text-xs text-slate-400">{contact.employeeCode} · {contact.status}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
