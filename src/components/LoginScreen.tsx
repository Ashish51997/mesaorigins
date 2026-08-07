/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type FormEvent } from 'react';
import {
  Flame, ArrowRight, LayoutDashboard, Briefcase, CalendarDays,
  Gauge, ShieldCheck, Boxes, Truck, Wrench, KeyRound, Crown, Users2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ROLES, RoleName } from '../lib/roles';
import { useDirectory, type ApiDirectoryEntry } from '../lib/queries/admin';
import Logo from './Logo';
import InstallAppButton from './InstallAppButton';

interface LoginScreenProps {
  onLogin: (user: { uid: string; email: string; displayName: string; role: string; isFirebase: boolean }) => void;
}

const ROLE_ICON: Record<string, typeof Flame> = {
  Owner: Crown,
  Administrator: KeyRound,
  'Managing Director': LayoutDashboard,
  'Sales Executive': Briefcase,
  'Production Planner': CalendarDays,
  Operator: Gauge,
  'Quality Inspector': ShieldCheck,
  'Store Manager': Boxes,
  'Dispatch Executive': Truck,
  'Maintenance Head': Wrench,
};
const iconFor = (role: string) => ROLE_ICON[role] ?? Users2;

const inputCls =
  'mt-1 w-full min-h-11 rounded-lg border border-slate-200 px-3 py-2.5 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600';

async function startGoogleSignIn(): Promise<void> {
  const csrfRes = await fetch('/auth/csrf', { credentials: 'include' });
  const csrfJson = (await csrfRes.json()) as { csrfToken?: string };
  const csrfToken = csrfJson.csrfToken;
  if (!csrfToken) throw new Error('Could not start Google sign-in (CSRF).');

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/auth/signin/google';
  const csrf = document.createElement('input');
  csrf.type = 'hidden';
  csrf.name = 'csrfToken';
  csrf.value = csrfToken;
  form.appendChild(csrf);
  const cb = document.createElement('input');
  cb.type = 'hidden';
  cb.name = 'callbackUrl';
  cb.value = '/';
  form.appendChild(cb);
  document.body.appendChild(form);
  form.submit();
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const modeQ = useQuery({
    queryKey: ['auth-mode'],
    queryFn: async () => {
      const r = await fetch('/api/health');
      const j = await r.json() as { auth?: string; google?: boolean };
      if (j.auth === 'authjs') return { mode: 'authjs' as const, google: Boolean(j.google) };
      return { mode: 'dev' as const, google: Boolean(j.google) };
    },
    staleTime: 60_000,
  });
  const mode = modeQ.data?.mode;
  const googleOk = modeQ.data?.google ?? false;
  const authjsOnly = mode === 'authjs';

  const dirQ = useDirectory(!authjsOnly);
  const dir = (dirQ.data ?? []).slice().sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));

  const [email, setEmail] = useState('deepak.bansal@masspolymer.in');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signInAs = (e: ApiDirectoryEntry) =>
    onLogin({ uid: `emp-${e.id}`, email: e.email, displayName: e.name, role: e.role, isFirebase: false });
  const signInRole = (role: RoleName, demoUser: string) =>
    onLogin({ uid: `demo-${role}`, email: `${demoUser.toLowerCase().replace(/[^a-z]+/g, '.')}@masspolymer.in`, displayName: demoUser, role, isFirebase: false });

  const byRole = dir.reduce<Record<string, ApiDirectoryEntry[]>>((acc, e) => { (acc[e.role] ??= []).push(e); return acc; }, {});

  const submitPassword = async (ev: FormEvent) => {
    ev.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message || 'Sign-in failed');
      onLogin({
        uid: `emp-${data.user.userId}`,
        email: data.user.email,
        displayName: data.user.name,
        role: data.user.role,
        isFirebase: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    setError('');
    setBusy(true);
    try {
      await startGoogleSignIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
      setBusy(false);
    }
  };

  const EmpTile = ({ e }: { e: ApiDirectoryEntry }) => {
    const Icon = iconFor(e.role);
    return (
      <button
        onClick={() => signInAs(e)}
        className="group text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-sky-600 transition-colors flex items-center gap-3 min-h-11"
      >
        <div className="h-11 w-11 rounded-lg flex items-center justify-center bg-sky-50 text-sky-600 shrink-0"><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-slate-900 text-[15px] leading-tight truncate">{e.name}</div>
          <div className="text-[12px] text-slate-500 truncate">{e.role} · {e.employeeCode}</div>
        </div>
        <ArrowRight className="h-4 w-4 text-sky-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </button>
    );
  };

  const RoleTile = ({ role, user }: { role: RoleName; user: string }) => {
    const Icon = iconFor(role);
    return (
      <button onClick={() => signInRole(role, user)} className="group text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-sky-600 transition-colors flex items-center gap-3 min-h-11">
        <div className="h-11 w-11 rounded-lg flex items-center justify-center bg-sky-50 text-sky-600 shrink-0"><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><div className="font-bold text-slate-900 text-[15px] truncate">{role}</div><div className="text-[12px] text-slate-500 truncate">{user}</div></div>
        <ArrowRight className="h-4 w-4 text-sky-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </button>
    );
  };

  const passwordForm = (
    <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 max-w-md mx-auto w-full">
      <p className="font-bold text-slate-900 text-lg mb-1">Sign in</p>
      <p className="text-sm text-slate-500 mb-6">Use your People directory email and password.</p>
      {googleOk && (
        <button
          type="button"
          onClick={onGoogle}
          disabled={busy}
          className="w-full mb-4 min-h-11 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 font-medium px-6 py-2.5 text-sm"
        >
          Continue with Google
        </button>
      )}
      {googleOk && (
        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
          <div className="relative flex justify-center text-[11px] uppercase tracking-wide"><span className="bg-white px-2 text-slate-400">or</span></div>
        </div>
      )}
      <form onSubmit={submitPassword} className="space-y-4">
        <label className="block">
          <span className="text-[13px] font-medium text-slate-600">Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[13px] font-medium text-slate-600">Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className={inputCls} />
        </label>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <button type="submit" disabled={busy} className="w-full min-h-11 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-medium px-6 py-2.5 text-sm">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="mt-4">
        <InstallAppButton />
      </div>
      <p className="mt-4 text-[12px] text-slate-400 text-center">Example: deepak.bansal@masspolymer.in — seed password from SEED_USER_PASSWORD</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 sm:p-10 text-slate-700 font-sans" id="login-screen-root">
      <div className="w-full max-w-4xl">
        <div className="flex items-center justify-between gap-2 sm:gap-3 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <Logo className="h-9 w-9 shrink-0" />
            <div className="min-w-0">
              <h1 className="font-extrabold text-slate-900 text-base leading-none truncate">MesaDesk</h1>
              <p className="text-[11px] sm:text-xs text-slate-500 font-light mt-0.5 truncate">One Platform. Every Operation.</p>
            </div>
          </div>
          <InstallAppButton compact />
        </div>

        {modeQ.isLoading ? (
          <div className="text-center text-sm text-slate-400 py-16">Loading…</div>
        ) : authjsOnly ? (
          passwordForm
        ) : dirQ.isLoading ? (
          <div className="text-center text-sm text-slate-400 py-16">Loading your team…</div>
        ) : dir.length > 0 ? (
          <>
            <p className="text-sm font-medium text-slate-600 mb-4">Sign in as your account — your role &amp; access are resolved from the server.</p>
            <div className="space-y-6">
              {Object.keys(byRole).sort().map((role) => (
                <div key={role}>
                  <div className="flex items-baseline gap-2 mb-2">
                    <h2 className="font-semibold text-slate-800 text-[13px]">{role}</h2>
                    <span className="text-[12px] text-slate-400">{byRole[role].length} {byRole[role].length === 1 ? 'person' : 'people'}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {byRole[role].map((e) => <div key={e.id} className="contents"><EmpTile e={e} /></div>)}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-600 mb-4">Choose a role to sign in.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {ROLES.map((r) => <div key={r.role} className="contents"><RoleTile role={r.role} user={r.user} /></div>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
