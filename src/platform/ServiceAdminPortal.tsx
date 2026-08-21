import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowUpRight,
  Boxes,
  Building2,
  CheckCircle2,
  CirclePause,
  CloudCog,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Play,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Square,
  Users,
} from 'lucide-react';
import { api } from '@shared/lib/apiClient';
import { setDevUser, setOrganizationId } from '@shared/lib/apiIdentity';
import Logo from '@shared/components/Logo';
import OrganizationOnboardingPanel, {
  OrganizationsDirectory,
  type CreatedOrganization,
  type OrganizationSummary,
} from './OrganizationOnboardingPanel';

type ServiceStatus = 'running' | 'paused' | 'stopped';
type ServiceCatalogStatus = 'active' | 'paused' | 'stopped';
type ServiceId = 'mesaops' | 'mesaleads' | 'mesaerp';
type ServiceStates = Record<ServiceId, ServiceStatus>;

type ServiceDefinition = {
  id: ServiceId;
  name: string;
  description: string;
  category: string;
  version: string;
  href?: string;
  icon: typeof Boxes;
};

type ActivityEntry = {
  id: number;
  message: string;
  detail: string;
  time: string;
};

const ADMIN_SESSION_KEY = 'mesaorigins_admin_session';
const SERVICE_STATE_KEY = 'mesaorigins_service_states';
const DEFAULT_SERVICE_STATES: ServiceStates = { mesaops: 'running', mesaleads: 'running', mesaerp: 'running' };
const ADMIN_ONBOARDING_IDENTITY = 'aroul303@gmail.com';

type AdminAuthMode = 'production' | 'dev';
type AdminAuthState = 'checking' | 'signedOut' | 'authenticated';

const SERVICES: ServiceDefinition[] = [
  {
    id: 'mesaops',
    name: 'MesaOps',
    description: 'Manufacturing operations, planning, quality, inventory and dispatch workspace.',
    category: 'Operations',
    version: 'Production',
    href: '/mesaops',
    icon: Boxes,
  },
  {
    id: 'mesaleads',
    name: 'MesaLeads',
    description: 'Configurable customer questionnaires, lead qualification, technical review, quotations and follow-up.',
    category: 'Sales',
    version: 'Beta',
    href: '/mesaleads',
    icon: CloudCog,
  },
  {
    id: 'mesaerp',
    name: 'MesaERP',
    description: 'Manufacturing ERP for vendors, procurement, valued inventory, costing, finance and statutory control.',
    category: 'Business ERP',
    version: 'V1',
    href: '/mesaerp',
    icon: Building2,
  },
];

const STATUS_META: Record<ServiceStatus, { label: string; className: string; dot: string }> = {
  running: { label: 'Operational', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  paused: { label: 'Paused', className: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  stopped: { label: 'Stopped', className: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
};

function readServiceStates(): ServiceStates {
  try {
    const saved = window.localStorage.getItem(SERVICE_STATE_KEY);
    if (!saved) return DEFAULT_SERVICE_STATES;
    const parsed = JSON.parse(saved) as Partial<ServiceStates>;
    return {
      mesaops: parsed.mesaops ?? DEFAULT_SERVICE_STATES.mesaops,
      mesaleads: parsed.mesaleads ?? DEFAULT_SERVICE_STATES.mesaleads,
      mesaerp: parsed.mesaerp ?? DEFAULT_SERVICE_STATES.mesaerp,
    };
  } catch {
    return DEFAULT_SERVICE_STATES;
  }
}

function toDisplayStatus(status: string): ServiceStatus {
  if (status === 'active') return 'running';
  if (status === 'paused') return 'paused';
  return 'stopped';
}

function toCatalogStatus(status: ServiceStatus): ServiceCatalogStatus {
  return status === 'running' ? 'active' : status;
}

function MetricCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">{icon}</div>
      </div>
    </div>
  );
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

function AdminLogin({
  mode,
  onLogin,
}: {
  mode: AdminAuthMode;
  onLogin: (identifier: string, password: string) => Promise<void>;
}) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onLogin(identifier.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 p-4 font-sans sm:p-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl items-center sm:min-h-[calc(100vh-4rem)]">
        <div className="grid w-full overflow-hidden rounded-xl border border-slate-200 bg-white md:grid-cols-2">
          <section className="relative hidden min-h-[570px] overflow-hidden bg-[#102A65] p-10 text-white md:flex md:flex-col">
            <div className="absolute -right-28 -top-28 h-72 w-72 rounded-full border border-white/10" />
            <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full border border-white/10" />
            <div className="relative flex items-center gap-3">
              <Logo className="h-10 w-10" />
              <div>
                <p className="text-lg font-extrabold leading-none">MesaOrigins</p>
                <p className="mt-1 text-xs text-blue-200">Parent service platform</p>
              </div>
            </div>
            <div className="relative my-auto max-w-md">
              <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-blue-50">
                <ShieldCheck className="h-4 w-4" /> Secure administration
              </div>
              <h1 className="text-4xl font-extrabold leading-tight tracking-tight !text-white">Every MesaOrigins service, one control center.</h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-blue-100">Monitor availability, control service state and open each workspace without switching consoles.</p>
            </div>
            <div className="relative grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.07] p-4">
                <p className="text-2xl font-bold">03</p>
                <p className="mt-1 text-xs text-blue-200">Service families</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.07] p-4">
                <p className="text-2xl font-bold">01</p>
                <p className="mt-1 text-xs text-blue-200">Control center</p>
              </div>
            </div>
          </section>

          <section className="flex min-h-[570px] items-center p-6 sm:p-10 lg:p-12">
            <div className="mx-auto w-full max-w-sm">
              <div className="mb-8 flex items-center gap-3 md:hidden">
                <Logo className="h-10 w-10" />
                <div>
                  <p className="font-extrabold leading-none text-slate-900">MesaOrigins</p>
                  <p className="mt-1 text-xs text-slate-500">Service administration</p>
                </div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <h2 className="mt-5 text-2xl font-extrabold tracking-tight text-slate-900">Admin sign in</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {mode === 'production'
                  ? 'Use your MesaOrigins administrator email and password to open the service console.'
                  : 'Use the isolated local-development administrator credentials.'}
              </p>
              <form className="mt-7 space-y-4" onSubmit={submit}>
                <label className="block">
                  <span className="text-[13px] font-semibold text-slate-700">{mode === 'production' ? 'Email address' : 'User ID'}</span>
                  <input
                    type={mode === 'production' ? 'email' : 'text'}
                    value={identifier}
                    onChange={(event) => { setIdentifier(event.target.value); setError(''); }}
                    autoComplete="username"
                    autoFocus
                    required
                    placeholder={mode === 'production' ? 'admin@yourcompany.com' : 'Enter user ID'}
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-base text-slate-900 outline-none transition focus:border-sky-600 focus:ring-2 focus:ring-sky-100 sm:text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-[13px] font-semibold text-slate-700">Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => { setPassword(event.target.value); setError(''); }}
                    autoComplete="current-password"
                    required
                    placeholder="Enter password"
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-base text-slate-900 outline-none transition focus:border-sky-600 focus:ring-2 focus:ring-sky-100 sm:text-sm"
                  />
                </label>
                {error && (
                  <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">{error}</div>
                )}
                <button type="submit" disabled={busy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
                  {busy ? 'Signing in…' : 'Open control center'} {!busy && <ArrowUpRight className="h-4 w-4" />}
                </button>
              </form>
              <div className="mt-6 flex items-center gap-2 border-t border-slate-100 pt-5 text-xs text-slate-400">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                {mode === 'production' ? 'Protected by server-verified administrator access' : 'Temporary local administrator access'}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default function ServiceAdminPortal() {
  const [authState, setAuthState] = useState<AdminAuthState>('checking');
  const [authMode, setAuthMode] = useState<AdminAuthMode>('production');
  const [serviceStates, setServiceStates] = useState<ServiceStates>(readServiceStates);
  const [restarting, setRestarting] = useState<ServiceId | null>(null);
  const [changingService, setChangingService] = useState<ServiceId | null>(null);
  const [serviceControlError, setServiceControlError] = useState('');
  const [organizationRefreshKey, setOrganizationRefreshKey] = useState(0);
  const [activities, setActivities] = useState<ActivityEntry[]>([
    { id: 1, message: 'Control center ready', detail: 'Service registry loaded', time: 'Just now' },
  ]);
  const authenticated = authState === 'authenticated';

  useEffect(() => {
    let cancelled = false;

    const restoreAdminSession = async () => {
      // An organization selector or development identity from another MesaOrigins
      // workspace must never influence the platform-admin authorization check.
      setOrganizationId('');
      setDevUser('');

      let mode: AdminAuthMode = 'production';
      try {
        const healthResponse = await fetch('/api/health', { credentials: 'include' });
        const health = await responseJson(healthResponse) as { auth?: unknown } | null;
        if (healthResponse.ok && health?.auth === 'dev') mode = 'dev';
      } catch {
        // Fail closed into production authentication when the mode cannot be
        // discovered. The protected access endpoint remains authoritative.
      }

      if (cancelled) return;
      setAuthMode(mode);

      if (mode === 'dev') {
        if (window.sessionStorage.getItem(ADMIN_SESSION_KEY) !== 'active') {
          setAuthState('signedOut');
          return;
        }
        // Session cookies take precedence over x-dev-user in the API. Clear a
        // stale organization session before restoring the isolated dev admin.
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
        setDevUser(ADMIN_ONBOARDING_IDENTITY);
      } else {
        window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
      }

      try {
        const access = await api.get<{ allowed: boolean }>('/onboarding/access');
        if (!access.allowed) throw new Error('Platform administrator access is required.');
        if (!cancelled) setAuthState('authenticated');
      } catch {
        if (mode === 'dev') {
          window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
          setDevUser('');
        }
        if (!cancelled) setAuthState('signedOut');
      }
    };

    void restoreAdminSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    document.title = authenticated ? 'Service Control Center · MesaOrigins' : 'Admin Sign In · MesaOrigins';
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [authenticated]);

  useEffect(() => {
    window.localStorage.setItem(SERVICE_STATE_KEY, JSON.stringify(serviceStates));
  }, [serviceStates]);

  useEffect(() => {
    if (!authenticated) return undefined;
    let cancelled = false;

    void api.get<{ services: Array<{ id: string; status: string }> }>('/onboarding/services')
      .then(({ services }) => {
        if (cancelled) return;
        setServiceStates((current) => {
          const next = { ...current };
          for (const service of services) {
            if (service.id === 'mesaops' || service.id === 'mesaleads' || service.id === 'mesaerp') {
              next[service.id] = toDisplayStatus(service.status);
            }
          }
          return next;
        });
        setServiceControlError('');
      })
      .catch(() => {
        if (!cancelled) setServiceControlError('Could not load live service status. Try refreshing the control center.');
      });

    return () => { cancelled = true; };
  }, [authenticated]);

  const runningCount = useMemo(
    () => Object.values(serviceStates).filter((status) => status === 'running').length,
    [serviceStates],
  );

  const addActivity = (message: string, detail: string) => {
    setActivities((current) => [
      { id: Date.now(), message, detail, time: 'Just now' },
      ...current.map((item) => item.time === 'Just now' ? { ...item, time: 'Earlier' } : item),
    ].slice(0, 6));
  };

  const writeServiceStatus = async (id: ServiceId, nextStatus: ServiceStatus) => {
    await api.put(`/onboarding/services/${id}/status`, { status: toCatalogStatus(nextStatus) });
    setServiceStates((current) => ({ ...current, [id]: nextStatus }));
  };

  const updateService = async (id: ServiceId, nextStatus: ServiceStatus) => {
    if (changingService || restarting) return;
    const service = SERVICES.find((item) => item.id === id)!;
    setChangingService(id);
    setServiceControlError('');
    try {
      await writeServiceStatus(id, nextStatus);
      addActivity(`${service.name} ${nextStatus}`, 'Live service status changed by admin');
    } catch {
      setServiceControlError(`Could not change ${service.name}. Its previous status was kept.`);
      addActivity(`${service.name} change failed`, 'The control plane rejected the request');
    } finally {
      setChangingService(null);
    }
  };

  const restartService = async (id: ServiceId) => {
    if (restarting || changingService) return;
    const service = SERVICES.find((item) => item.id === id)!;
    setRestarting(id);
    setServiceControlError('');
    addActivity(`${service.name} restart initiated`, 'Service cycle requested by admin');
    try {
      await writeServiceStatus(id, 'stopped');
      await writeServiceStatus(id, 'running');
      addActivity(`${service.name} operational`, 'Restart completed on the control plane');
    } catch {
      setServiceControlError(`Could not complete the ${service.name} restart. Check its live status before retrying.`);
      addActivity(`${service.name} restart failed`, 'The control plane did not complete the service cycle');
    } finally {
      setRestarting(null);
    }
  };

  const login = async (identifier: string, password: string) => {
    setOrganizationId('');

    if (authMode === 'dev') {
      if (identifier !== 'admin' || password !== 'admin') {
        throw new Error('User ID or password is incorrect.');
      }
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
      setDevUser(ADMIN_ONBOARDING_IDENTITY);
      try {
        const access = await api.get<{ allowed: boolean }>('/onboarding/access');
        if (!access.allowed) throw new Error('Platform administrator access is required.');
        window.sessionStorage.setItem(ADMIN_SESSION_KEY, 'active');
        setAuthState('authenticated');
        return;
      } catch (err) {
        setDevUser('');
        window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
        throw err;
      }
    }

    setDevUser('');
    const response = await fetch('/api/auth/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: identifier.toLowerCase(), password }),
    });
    const payload = await responseJson(response);
    if (!response.ok) {
      throw new Error(responseErrorMessage(payload, 'Sign-in failed. Please check your email and password.'));
    }

    try {
      const access = await api.get<{ allowed: boolean }>('/onboarding/access');
      if (!access.allowed) throw new Error('Platform administrator access is required.');
      setAuthState('authenticated');
    } catch (err) {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
      throw err;
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
      setOrganizationId('');
      setDevUser('');
      setAuthState('signedOut');
    }
  };

  const organizationCreated = (created: CreatedOrganization) => {
    setOrganizationRefreshKey((current) => current + 1);
    addActivity(`${created.organization.name} onboarded`, `${created.owner.name} added as the first owner`);
  };

  const organizationServicesChanged = (organization: OrganizationSummary) => {
    addActivity(
      `${organization.name} service access updated`,
      organization.services.map((service) => service.name).join(', '),
    );
  };

  if (authState === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 font-sans">
        <div role="status" className="flex items-center gap-3 text-sm font-semibold text-slate-600">
          <RefreshCw className="h-5 w-5 animate-spin text-sky-600" /> Verifying administrator session…
        </div>
      </main>
    );
  }

  if (!authenticated) return <AdminLogin mode={authMode} onLogin={login} />;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-700">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
          <Logo className="h-9 w-9 shrink-0" />
          <div>
            <p className="font-extrabold leading-none text-slate-900">MesaOrigins</p>
            <p className="mt-1 text-[11px] font-medium text-slate-400">ADMIN CONSOLE</p>
          </div>
        </div>
        <nav aria-label="Admin navigation" className="flex-1 space-y-1 p-3">
          <a href="#overview" className="flex min-h-10 items-center gap-3 rounded-lg bg-sky-50 px-3 text-sm font-semibold text-sky-700">
            <LayoutDashboard className="h-4 w-4" /> Overview
          </a>
          <a href="#services" className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
            <Server className="h-4 w-4" /> Services
            <span className="ml-auto rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{SERVICES.length}</span>
          </a>
          <a href="#onboarding" className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
            <Building2 className="h-4 w-4" /> Onboarding
          </a>
          <a href="#organizations" className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
            <Users className="h-4 w-4" /> Organizations
          </a>
          <a href="#activity" className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
            <Activity className="h-4 w-4" /> Activity
          </a>
        </nav>
        <div className="border-t border-slate-200 p-3">
          <div className="mb-3 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Platform online
            </div>
            <p className="mt-1 text-[11px] text-slate-400">MesaOrigins control plane</p>
          </div>
          <button onClick={logout} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-700">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <Logo className="h-8 w-8" />
            <div>
              <p className="text-sm font-extrabold leading-none text-slate-900">MesaOrigins</p>
              <p className="mt-1 text-[10px] font-medium text-slate-400">ADMIN CONSOLE</p>
            </div>
          </div>
          <div className="hidden lg:block">
            <p className="text-sm font-semibold text-slate-800">Service control center</p>
            <p className="text-xs text-slate-400">Parent platform · MesaOrigins</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 sm:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> System healthy
            </div>
            <button onClick={logout} aria-label="Sign out" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 lg:hidden">
              <LogOut className="h-4 w-4" />
            </button>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#102A65] text-xs font-bold text-white">AD</div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
          <section id="overview" className="flex flex-col justify-between gap-4 scroll-mt-20 sm:flex-row sm:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-sky-700">
                <ShieldCheck className="h-3.5 w-3.5" /> Admin workspace
              </div>
              <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">Good to see you, Admin</h1>
              <p className="mt-1.5 max-w-2xl text-sm text-slate-500">Monitor and control every service registered under the MesaOrigins platform.</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
              <Activity className="h-4 w-4 text-emerald-600" /> Updated just now
            </div>
          </section>

          <section aria-label="Service summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={<Server className="h-5 w-5" />} label="All services" value={String(SERVICES.length)} detail="Registered with MesaOrigins" />
            <MetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="Operational" value={String(runningCount)} detail="Available right now" />
            <MetricCard icon={<CirclePause className="h-5 w-5" />} label="Not running" value={String(SERVICES.length - runningCount)} detail="Paused or stopped" />
            <MetricCard icon={<ShieldCheck className="h-5 w-5" />} label="Control plane" value="Online" detail="Admin session active" />
          </section>

          <section id="services" className="scroll-mt-20">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Services</h2>
                <p className="mt-0.5 text-xs text-slate-500">Global platform controls. Start, stop, restart or open a registered workspace.</p>
              </div>
              <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">{SERVICES.length} total</span>
            </div>
            {serviceControlError && (
              <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
                {serviceControlError}
              </div>
            )}
            <div className="grid gap-4 xl:grid-cols-2">
              {SERVICES.map((service) => {
                const status = serviceStates[service.id];
                const meta = STATUS_META[status];
                const Icon = service.icon;
                const isRestarting = restarting === service.id;
                const isChanging = changingService === service.id;
                const isBusy = isRestarting || isChanging;
                return (
                  <article key={service.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#102A65] text-white">
                            <Icon className="h-6 w-6" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-lg font-extrabold text-slate-900">{service.name}</h3>
                              <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700">{service.category}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-400">{service.version}</p>
                          </div>
                        </div>
                        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold ${meta.className}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /> {isRestarting ? 'Restarting' : meta.label}
                        </span>
                      </div>
                      <p className="mt-5 min-h-10 text-sm leading-5 text-slate-500">{service.description}</p>
                      <dl className="mt-5 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Service ID</dt>
                          <dd className="mt-1 font-mono text-xs font-semibold text-slate-700">{service.id}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Environment</dt>
                          <dd className="mt-1 text-xs font-semibold text-slate-700">{service.version}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => updateService(service.id, 'running')}
                          disabled={status === 'running' || isBusy}
                          aria-label={`Start ${service.name}`}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Play className="h-3.5 w-3.5" /> Start
                        </button>
                        <button
                          onClick={() => updateService(service.id, 'stopped')}
                          disabled={status === 'stopped' || isBusy}
                          aria-label={`Stop ${service.name}`}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-rose-300 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Square className="h-3.5 w-3.5" /> Stop
                        </button>
                        <button
                          onClick={() => restartService(service.id)}
                          disabled={Boolean(restarting || changingService)}
                          aria-label={`Restart ${service.name}`}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${isRestarting ? 'animate-spin' : ''}`} /> Restart
                        </button>
                      </div>
                      {service.href ? (
                        <a href={service.href} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3.5 text-xs font-bold text-white transition hover:bg-sky-700">
                          Open service <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3.5 text-xs font-semibold text-slate-400">
                          <Settings2 className="h-3.5 w-3.5" /> Setup pending
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section id="onboarding" className="scroll-mt-20">
            <div className="mb-3">
              <h2 className="text-lg font-bold text-slate-900">Organization onboarding</h2>
              <p className="mt-0.5 text-xs text-slate-500">Create a customer workspace and its first owner without leaving the admin console.</p>
            </div>
            <OrganizationOnboardingPanel onCreated={organizationCreated} />
          </section>

          <section id="organizations" className="scroll-mt-20">
            <OrganizationsDirectory refreshKey={organizationRefreshKey} onServicesChanged={organizationServicesChanged} />
          </section>

          <section id="activity" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Recent activity</h2>
                <p className="mt-0.5 text-xs text-slate-500">Actions from this admin session</p>
              </div>
              <Activity className="h-5 w-5 text-slate-400" />
            </div>
            <div className="divide-y divide-slate-100">
              {activities.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                    <Activity className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">{item.message}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{item.detail}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-400">{item.time}</span>
                </div>
              ))}
            </div>
          </section>

          <footer className="flex flex-col gap-1 border-t border-slate-200 pt-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <span>© 2026 MesaOrigins · Service Control Center</span>
            <span>Signed in as admin</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
