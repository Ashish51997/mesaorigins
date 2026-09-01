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
import Logo from '@shared/components/Logo';
import { getOrganizationId, setOrganizationId } from '@shared/lib/apiIdentity';
import { catalogName, productGroupLabel, resolvePostLoginDestination, servicePath } from '@shared/lib/productHome';
import './loginTheme.css';

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
  onEnterWorkspace: (session: OrganizationSession, destination: string) => void;
};

type View = 'entry' | 'organization-login' | 'organization-picker' | 'service-picker' | 'no-services';

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

export { servicePath } from '@shared/lib/productHome';

export default function LandingPage({ onEnterWorkspace }: LandingPageProps) {
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

  const enterWorkspace = (destination: string, selectedOrganization = organization) => {
    if (!selectedOrganization || !destination) return;
    setOrganizationId(selectedOrganization.organizationId);
    onEnterWorkspace(toSession(selectedOrganization), destination);
  };

  const enterService = (serviceId: string, selectedOrganization = organization) => {
    const destination = servicePath(serviceId);
    if (!destination) return;
    enterWorkspace(destination, selectedOrganization);
  };

  const openOrganization = (selectedOrganization: OrganizationAccess) => {
    const normalized = { ...selectedOrganization, services: selectedOrganization.services ?? [] };
    setOrganization(normalized);
    setOrganizationId(normalized.organizationId);
    const destination = resolvePostLoginDestination(normalized.role, normalized.services);
    if (destination) {
      enterWorkspace(destination, normalized);
      return;
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
    <main className="login-shell" id="landing-page-root">
      <div className="login-wrap">
        <div className="login-card">
          <section className="login-hero">
            <a href="/" aria-label="MesaOrigins home" className="flex items-center gap-3 self-start">
              <Logo className="h-10 w-10 shrink-0" />
              <div>
                <p className="text-lg font-extrabold leading-none text-white">MesaOrigins</p>
                <p className="mt-1 text-xs text-white/80">One Platform. Every Operation.</p>
              </div>
            </a>

            <div className="my-auto max-w-md">
              <div className="login-hero-badge">
                <Factory className="h-4 w-4" /> Secure workspace access
              </div>
              <h1>One secure entrance to every service.</h1>
              <p>
                Administrators manage the platform. Organization teams sign in once and continue to the services assigned to their workspace.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="login-hero-stat">
                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                <p className="mt-3">Assignment-aware</p>
                <p>Only active services are shown.</p>
              </div>
              <div className="login-hero-stat">
                <LockKeyhole className="h-5 w-5 text-white/80" />
                <p className="mt-3">Smart routing</p>
                <p>Single-service teams enter directly.</p>
              </div>
            </div>
          </section>

          <section aria-live="polite" className="login-panel">
            <div className="login-panel-inner">
              <div className="login-mobile-brand">
                <Logo className="h-10 w-10" />
                <div>
                  <strong>MesaOrigins</strong>
                  <span>One platform. Every operation.</span>
                </div>
              </div>

              <a href="/" className="login-back">← Back to website</a>

              {view === 'entry' && (
                <>
                  <p className="login-overline mt-5">Welcome</p>
                  <h2 className="login-title">How would you like to sign in?</h2>
                  <p className="login-subtitle">Choose the account type that matches the work you need to do.</p>

                  <div className="mt-6 space-y-3">
                    <a href="/admin" aria-label="Admin login" className="login-option">
                      <span className="login-option-icon"><ShieldCheck className="h-6 w-6" /></span>
                      <span className="min-w-0 flex-1">
                        <strong>Administrator</strong>
                        <span>Manage organizations, onboarding and service availability.</span>
                      </span>
                      <ArrowRight className="h-5 w-5 shrink-0 text-[var(--login-muted)]" />
                    </a>

                    <button type="button" aria-label="Organization login" onClick={() => { setView('organization-login'); setError(''); }} className="login-option">
                      <span className="login-option-icon"><Building2 className="h-6 w-6" /></span>
                      <span className="min-w-0 flex-1">
                        <strong>Organization</strong>
                        <span>Open your team’s assigned MesaOrigins services.</span>
                      </span>
                      <ArrowRight className="h-5 w-5 shrink-0 text-[var(--login-muted)]" />
                    </button>
                  </div>
                </>
              )}

              {view === 'organization-login' && (
                <>
                  <button type="button" onClick={reset} className="login-btn-ghost mt-4">
                    <ArrowLeft className="h-4 w-4" /> Back to access options
                  </button>
                  <div className="login-icon-tile mt-4"><Building2 className="h-5 w-5" /></div>
                  <h2 className="login-title">Organization sign in</h2>
                  <p className="login-subtitle">Use the email and password provided by your organization administrator.</p>
                  <form onSubmit={submit} className="mt-6 space-y-4">
                    <label className="block">
                      <span className="login-label">Email</span>
                      <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="name@organization.com" className="login-input" />
                    </label>
                    <label className="block">
                      <span className="login-label">Password</span>
                      <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required className="login-input" />
                    </label>
                    {error && <div role="alert" className="login-alert-error">{error}</div>}
                    <button type="submit" disabled={busy} className="login-btn-primary">
                      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                      {busy ? 'Signing in…' : 'Sign in'}
                    </button>
                  </form>
                </>
              )}

              {view === 'service-picker' && organization && (
                <>
                  <p className="login-overline">{organization.organizationName}</p>
                  <h2 className="login-title">Choose a product</h2>
                  <p className="login-subtitle">Your account has access to more than one module. Pick where you want to work now.</p>
                  <div className="mt-6 space-y-6">
                    {(['Operations', 'Commercial'] as const).map((group) => {
                      const groupServices = organization.services.filter(
                        (service) => productGroupLabel(service.id) === group && servicePath(service.id),
                      );
                      if (groupServices.length === 0) return null;
                      return (
                        <section key={group}>
                          <h3 className="login-group-label">{group}</h3>
                          <div className="mt-3 space-y-3">
                            {groupServices.map((service) => {
                              const Icon = serviceIcons[service.id] ?? Boxes;
                              const displayName = catalogName(service.id, service.name);
                              return (
                                <article key={service.id} className="login-service-card">
                                  <div className="flex items-start gap-3">
                                    <span className="login-icon-tile"><Icon className="h-5 w-5" /></span>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h4>{displayName}</h4>
                                        <span className="login-badge-active">Active</span>
                                      </div>
                                      <p>{service.description}</p>
                                    </div>
                                  </div>
                                  <button type="button" onClick={() => enterService(service.id)} className="login-btn-primary mt-4">
                                    Open {displayName}
                                    <ArrowRight className="h-4 w-4" />
                                  </button>
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  <button type="button" onClick={reset} className="login-btn-ghost mt-5"><ArrowLeft className="h-4 w-4" /> Sign in with another account</button>
                </>
              )}

              {view === 'organization-picker' && (
                <>
                  <p className="login-overline">Organization access</p>
                  <h2 className="login-title">Choose an organization</h2>
                  <p className="login-subtitle">This account belongs to more than one organization. Choose the workspace you want to open.</p>
                  <div className="mt-6 space-y-3">
                    {organizations.map((item) => (
                      <article key={item.membershipId ?? item.organizationId} className="login-service-card">
                        <div className="flex items-start gap-3">
                          <span className="login-icon-tile"><Building2 className="h-5 w-5" /></span>
                          <div className="min-w-0 flex-1">
                            <h3>{item.organizationName}</h3>
                            <p>{item.services.length} active {item.services.length === 1 ? 'service' : 'services'} · {item.role}</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => openOrganization(item)} className="login-btn-primary mt-4">
                          Open {item.organizationName}<ArrowRight className="h-4 w-4" />
                        </button>
                      </article>
                    ))}
                  </div>
                  <button type="button" onClick={reset} className="login-btn-ghost mt-5"><ArrowLeft className="h-4 w-4" /> Sign in with another account</button>
                </>
              )}

              {view === 'no-services' && organization && (
                <>
                  <div className="login-icon-tile login-icon-tile--warn mt-4"><LockKeyhole className="h-5 w-5" /></div>
                  <h2 className="login-title">Service access needed</h2>
                  <div role="alert" className="login-alert-warn mt-4">
                    No services are available for <strong>{organization.organizationName}</strong>. Ask your MesaOrigins administrator to activate at least one service.
                  </div>
                  <button type="button" onClick={reset} className="login-btn-ghost mt-5"><ArrowLeft className="h-4 w-4" /> Back to sign in</button>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
