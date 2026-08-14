import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Building2,
  CheckCircle2,
  CloudCog,
  Factory,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import Logo from './Logo';
import { getOrganizationId, setOrganizationId } from '../lib/apiIdentity';

export type OrganizationSession = {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  isFirebase: false;
};

export type OrganizationService = {
  id: string;
  name: string;
  description: string;
  status: string;
  sortOrder: number;
};

export type OrganizationAccess = {
  userId: string;
  email: string;
  name: string;
  membershipId?: string;
  employeeCode?: string;
  organizationId: string;
  organizationName: string;
  role: string;
  services: OrganizationService[];
};

type OrganizationMembershipAccess = Omit<OrganizationAccess, 'userId' | 'email' | 'name'> &
  Partial<Pick<OrganizationAccess, 'userId' | 'email' | 'name'>>;

type AuthenticatedOrganization = OrganizationAccess & {
  organizations?: OrganizationMembershipAccess[];
};

type LandingPageProps = {
  onEnterService: (session: OrganizationSession, serviceId: string) => void;
};

type View = 'entry' | 'organization-login' | 'organization-picker' | 'service-picker' | 'no-services';

const inputClass = 'mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-100 sm:text-sm';

const serviceIcons: Record<string, typeof Boxes> = {
  mesaops: Boxes,
  mesaleads: CloudCog,
  mesaerp: Building2,
};

function toSession(user: AuthenticatedOrganization): OrganizationSession {
  return {
    uid: `emp-${user.userId}`,
    email: user.email,
    displayName: user.name,
    role: user.role,
    isFirebase: false,
  };
}

export function servicePath(serviceId: string): string | null {
  if (serviceId === 'mesaops') return '/mesaops';
  if (serviceId === 'mesaleads') return '/mesaleads';
  if (serviceId === 'mesaerp') return '/mesaerp';
  return null;
}

export default function LandingPage({ onEnterService }: LandingPageProps) {
  const [view, setView] = useState<View>('entry');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [organization, setOrganization] = useState<AuthenticatedOrganization | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationAccess[]>([]);

  const reset = () => {
    setView('entry');
    setPassword('');
    setError('');
    setOrganization(null);
    setOrganizations([]);
    setOrganizationId('');
  };

  const enterService = (serviceId: string, selectedOrganization = organization) => {
    if (!selectedOrganization || !servicePath(serviceId)) return;
    setOrganizationId(selectedOrganization.organizationId);
    onEnterService(toSession(selectedOrganization), serviceId);
  };

  const openOrganization = (selectedOrganization: OrganizationAccess) => {
    const normalized = { ...selectedOrganization, services: selectedOrganization.services ?? [] };
    setOrganization(normalized);
    setOrganizationId(normalized.organizationId);
    if (normalized.services.length === 1) {
      const onlyService = normalized.services[0];
      if (servicePath(onlyService.id)) {
        enterService(onlyService.id, normalized);
        return;
      }
    }
    setView(normalized.services.length > 1 ? 'service-picker' : 'no-services');
  };

  const openAuthenticatedAccount = (user: AuthenticatedOrganization) => {
    const availableOrganizations = user.organizations?.length
      ? user.organizations.map((item) => ({
          userId: user.userId,
          email: user.email,
          name: user.name,
          ...item,
          services: item.services ?? [],
        }))
      : [{ ...user, services: user.services ?? [] }];
    setOrganizations(availableOrganizations);
    if (availableOrganizations.length > 1) {
      setOrganization(null);
      setView('organization-picker');
      return;
    }
    openOrganization(availableOrganizations[0]);
  };

  useEffect(() => {
    let cancelled = false;

    const fetchSessionContext = (organizationId = '') => fetch('/api/auth/session-context', {
      credentials: 'include',
      headers: organizationId ? { 'x-org': organizationId } : undefined,
    });

    const restoreSession = async () => {
      const selectedOrganizationId = getOrganizationId();
      let response = await fetchSessionContext(selectedOrganizationId);
      if (cancelled) return;

      // A removed organization must not strand an otherwise valid account on
      // the landing page. Clear the stale preference and let the server choose
      // a current membership (or return the organization picker) once.
      if (response.status === 403 && selectedOrganizationId) {
        setOrganizationId('');
        response = await fetchSessionContext();
        if (cancelled) return;
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          window.localStorage.removeItem('erp_session');
          setOrganizationId('');
        }
        return;
      }

      const data = await response.json() as { user: AuthenticatedOrganization | null };
      if (!data.user) {
        window.localStorage.removeItem('erp_session');
        setOrganizationId('');
        return;
      }
      openAuthenticatedAccount(data.user);
    };

    void restoreSession().catch(() => undefined);
    return () => { cancelled = true; };
    // This is a one-time session bootstrap; selection changes are user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await response.json() as { user?: AuthenticatedOrganization; error?: { message?: string } };
      if (!response.ok || !data.user) {
        throw new Error(data.error?.message || 'We could not sign you in. Check your details and try again.');
      }

      openAuthenticatedAccount({ ...data.user, services: data.user.services ?? [] });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'We could not sign you in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 p-4 font-sans text-slate-700 sm:p-8" id="landing-page-root">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl items-center sm:min-h-[calc(100vh-4rem)]">
        <div className="grid w-full overflow-hidden rounded-xl border border-slate-200 bg-white md:grid-cols-2">
          <section className="hidden min-h-[640px] bg-[#102A65] p-10 text-white md:flex md:flex-col lg:p-12">
            <a href="/" aria-label="MesaDesk home" className="flex items-center gap-3 self-start">
              <Logo className="h-10 w-10 shrink-0" />
              <div>
                <p className="text-lg font-extrabold leading-none">MesaDesk</p>
                <p className="mt-1 text-xs text-blue-200">Parent service platform</p>
              </div>
            </a>

            <div className="my-auto max-w-md">
              <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-blue-50">
                <Factory className="h-4 w-4" /> Secure workspace access
              </div>
              <h1 className="text-4xl font-extrabold leading-tight tracking-tight !text-white">One secure entrance to every service.</h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-blue-100">
                Administrators manage the platform. Organization teams sign in once and continue to the services assigned to their workspace.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.07] p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                <p className="mt-3 text-sm font-bold">Assignment-aware</p>
                <p className="mt-1 text-xs leading-5 text-blue-200">Only active services are shown.</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.07] p-4">
                <LockKeyhole className="h-5 w-5 text-blue-200" />
                <p className="mt-3 text-sm font-bold">Smart routing</p>
                <p className="mt-1 text-xs leading-5 text-blue-200">Single-service teams enter directly.</p>
              </div>
            </div>
          </section>

          <section aria-live="polite" className="flex min-h-[640px] items-center p-6 sm:p-10 lg:p-12">
            <div className="mx-auto w-full max-w-sm">
              <div className="mb-8 flex items-center gap-3 md:hidden">
                <Logo className="h-10 w-10" />
                <div>
                  <p className="font-extrabold leading-none text-slate-900">MesaDesk</p>
                  <p className="mt-1 text-xs text-slate-500">One platform. Every operation.</p>
                </div>
              </div>
          {view === 'entry' && (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-blue-700">Welcome</p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">How would you like to sign in?</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Choose the account type that matches the work you need to do.</p>

              <div className="mt-6 space-y-3">
                <a href="/admin" aria-label="Admin login" className="group flex min-h-28 items-center gap-4 rounded-xl border border-slate-200 p-4 transition hover:border-blue-600 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-200">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 group-hover:bg-white group-hover:text-blue-700"><ShieldCheck className="h-6 w-6" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold text-slate-900">Administrator</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">Manage organizations, onboarding and service availability.</span>
                  </span>
                  <ArrowRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-700" />
                </a>

                <button type="button" aria-label="Organization login" onClick={() => { setView('organization-login'); setError(''); }} className="group flex min-h-28 w-full items-center gap-4 rounded-xl border border-slate-200 p-4 text-left transition hover:border-blue-600 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-200">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 group-hover:bg-white"><Building2 className="h-6 w-6" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold text-slate-900">Organization</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">Open your team’s assigned MesaDesk services.</span>
                  </span>
                  <ArrowRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-700" />
                </button>
              </div>
            </>
          )}

          {view === 'organization-login' && (
            <>
              <button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                <ArrowLeft className="h-4 w-4" /> Back to access options
              </button>
              <div className="mt-4 flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Building2 className="h-5 w-5" /></div>
              <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900">Organization sign in</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Use the email and password provided by your organization administrator.</p>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <label className="block">
                  <span className="text-xs font-bold text-slate-700">Email</span>
                  <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="name@organization.com" className={inputClass} />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-slate-700">Password</span>
                  <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required className={inputClass} />
                </label>
                {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800">{error}</div>}
                <button type="submit" disabled={busy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 text-sm font-bold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </>
          )}

          {view === 'service-picker' && organization && (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-blue-700">{organization.organizationName}</p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">Choose a service</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">You have access to multiple services. Choose where you want to work now.</p>
              <div className="mt-6 space-y-3">
                {organization.services.map((service) => {
                  const Icon = serviceIcons[service.id] ?? Boxes;
                  const supported = Boolean(servicePath(service.id));
                  return (
                    <article key={service.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-start gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Icon className="h-5 w-5" /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-extrabold text-slate-900">{service.name}</h3>
                            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Active</span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-slate-500">{service.description}</p>
                        </div>
                      </div>
                      <button type="button" disabled={!supported} onClick={() => enterService(service.id)} className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white transition hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500">
                        {supported ? `Open ${service.name}` : `${service.name} is not configured`}
                        {supported && <ArrowRight className="h-4 w-4" />}
                      </button>
                    </article>
                  );
                })}
              </div>
              <button type="button" onClick={reset} className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Sign in with another account</button>
            </>
          )}

          {view === 'organization-picker' && (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-blue-700">Organization access</p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">Choose an organization</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">This account belongs to more than one organization. Choose the workspace you want to open.</p>
              <div className="mt-6 space-y-3">
                {organizations.map((item) => (
                  <article key={item.membershipId ?? item.organizationId} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Building2 className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-extrabold text-slate-900">{item.organizationName}</h3>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{item.services.length} active {item.services.length === 1 ? 'service' : 'services'} · {item.role}</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => openOrganization(item)} className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white transition hover:bg-blue-800">
                      Open {item.organizationName}<ArrowRight className="h-4 w-4" />
                    </button>
                  </article>
                ))}
              </div>
              <button type="button" onClick={reset} className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Sign in with another account</button>
            </>
          )}

          {view === 'no-services' && organization && (
            <>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><LockKeyhole className="h-5 w-5" /></div>
              <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900">Service access needed</h2>
              <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                No services are available for <strong>{organization.organizationName}</strong>. Ask your MesaDesk administrator to activate at least one service.
              </div>
              <button type="button" onClick={reset} className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /> Back to sign in</button>
            </>
          )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
