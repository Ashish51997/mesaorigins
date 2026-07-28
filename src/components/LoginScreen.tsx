/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type FormEvent } from 'react';
import {
  Flame, ArrowRight, Sun, Moon, LayoutDashboard, Briefcase, CalendarDays,
  Gauge, ShieldCheck, Boxes, Truck, Wrench, KeyRound, Crown, Users2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ROLES, RoleName } from '../lib/roles';
import { useDirectory, type ApiDirectoryEntry } from '../lib/queries/admin';
import { setSessionToken } from '../lib/apiIdentity';
import Logo from './Logo';

interface LoginScreenProps {
  onLogin: (user: { uid: string; email: string; displayName: string; role: string; isFirebase: boolean }) => void;
  theme?: 'dark' | 'light';
  onSetTheme?: (t: 'dark' | 'light') => void;
}

const ROLE_ICON: Record<string, typeof Flame> = {
  'Owner': Crown,
  'Administrator': KeyRound,
  'Managing Director': LayoutDashboard,
  'Sales Executive': Briefcase,
  'Production Planner': CalendarDays,
  'Operator': Gauge,
  'Quality Inspector': ShieldCheck,
  'Store Manager': Boxes,
  'Dispatch Executive': Truck,
  'Maintenance Head': Wrench,
};
const iconFor = (role: string) => ROLE_ICON[role] ?? Users2;

export default function LoginScreen({ onLogin, theme = 'light', onSetTheme }: LoginScreenProps) {
  const modeQ = useQuery({
    queryKey: ['auth-mode'],
    queryFn: async () => {
      const r = await fetch('/api/health');
      const j = await r.json() as { auth?: string };
      if (j.auth === 'password') return 'password' as const;
      if (j.auth === 'firebase') return 'firebase' as const;
      return 'dev' as const;
    },
    staleTime: 60_000,
  });
  const mode = modeQ.data;
  const passwordOnly = mode === 'password';
  const firebaseOnly = mode === 'firebase';

  const dirQ = useDirectory(!passwordOnly && !firebaseOnly);
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
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data?.error?.message || 'Sign-in failed');
      }
      setSessionToken(data.token);
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

  const EmpTile = ({ e }: { e: ApiDirectoryEntry }) => {
    const Icon = iconFor(e.role);
    return (
      <button
        onClick={() => signInAs(e)}
        className="group text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-indigo-400 hover:shadow-md transition-all flex items-center gap-3"
      >
        <div className="h-11 w-11 rounded-xl flex items-center justify-center bg-indigo-50 text-indigo-600 shrink-0"><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-slate-900 text-[15px] leading-tight truncate">{e.name}</div>
          <div className="text-[12px] text-slate-500 truncate">{e.role} · {e.employeeCode}</div>
        </div>
        <ArrowRight className="h-4 w-4 text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </button>
    );
  };

  const RoleTile = ({ role, user }: { role: RoleName; user: string }) => {
    const Icon = iconFor(role);
    return (
      <button onClick={() => signInRole(role, user)} className="group text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-indigo-400 hover:shadow-md transition-all flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl flex items-center justify-center bg-indigo-50 text-indigo-600 shrink-0"><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><div className="font-display font-bold text-slate-900 text-[15px] truncate">{role}</div><div className="text-[12px] text-slate-500 truncate">{user}</div></div>
        <ArrowRight className="h-4 w-4 text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center p-4 sm:p-10 text-slate-700" id="login-screen-root">
      <div className="w-full max-w-4xl">
        <div className="flex items-center justify-between gap-2 sm:gap-3 mb-6">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Logo className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl shadow-sm shrink-0" />
            <div className="min-w-0">
              <h1 className="font-display font-extrabold text-slate-900 text-lg sm:text-xl leading-none truncate">Mass Polimer ERP</h1>
              <p className="text-[12px] text-slate-500 mt-0.5 truncate">Bengaluru extrusion plant</p>
            </div>
          </div>
          {onSetTheme && (
            <div className="flex items-center gap-0.5 p-0.5 rounded-full border border-slate-200 bg-slate-50 shrink-0" role="group" aria-label="Theme">
              <button onClick={() => onSetTheme('light')} aria-pressed={theme === 'light'} title="Light theme" className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-[12px] font-bold transition-all cursor-pointer ${theme === 'light' ? 'bg-white text-indigo-600 shadow-sm border border-slate-200' : 'text-slate-400 hover:text-slate-600'}`}><Sun className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Light</span></button>
              <button onClick={() => onSetTheme('dark')} aria-pressed={theme === 'dark'} title="Dark theme" className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-[12px] font-bold transition-all cursor-pointer ${theme === 'dark' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><Moon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Dark</span></button>
            </div>
          )}
        </div>

        {modeQ.isLoading ? (
          <div className="text-center text-sm text-slate-400 py-16">Loading…</div>
        ) : passwordOnly ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm max-w-md mx-auto">
            <p className="font-display font-bold text-slate-900 text-lg mb-1">Sign in</p>
            <p className="text-sm text-slate-500 mb-6">
              Use your People directory email and the shared password.
            </p>
            <form onSubmit={submitPassword} className="space-y-4">
              <label className="block">
                <span className="text-[12px] font-semibold text-slate-600">Email</span>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[12px] font-semibold text-slate-600">Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold px-6 py-3 text-sm shadow-sm"
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <p className="mt-4 text-[11px] text-slate-400 text-center">
              Example: deepak.bansal@masspolymer.in (Administrator)
            </p>
          </div>
        ) : firebaseOnly ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <p className="font-display font-bold text-slate-900 text-lg mb-2">Sign in unavailable</p>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              This deployment expects password login. Set <code className="text-xs bg-slate-100 px-1 rounded">LOGIN_PASSWORD</code> on the server, or switch to local directory mode.
            </p>
          </div>
        ) : dirQ.isLoading ? (
          <div className="text-center text-sm text-slate-400 py-16">Loading your team…</div>
        ) : dir.length > 0 ? (
          <>
            <p className="text-sm font-semibold text-slate-600 mb-4">Sign in as your account — your role &amp; access are resolved from the server.</p>
            <div className="space-y-6">
              {Object.keys(byRole).sort().map((role) => (
                <div key={role}>
                  <div className="flex items-baseline gap-2 mb-2">
                    <h2 className="font-display font-bold text-slate-800 text-sm uppercase tracking-wide">{role}</h2>
                    <span className="text-[11px] text-slate-400">{byRole[role].length} {byRole[role].length === 1 ? 'person' : 'people'}</span>
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
            <p className="text-sm font-semibold text-slate-600 mb-4">Choose a role to sign in.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {ROLES.map((r) => <div key={r.role} className="contents"><RoleTile role={r.role} user={r.user} /></div>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
