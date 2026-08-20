import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import Logo from './Logo';

const inputCls =
  'mt-1 w-full min-h-11 rounded-lg border border-slate-200 px-3 py-2.5 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600';

export default function OnboardingLogin({ onLogin }: { onLogin: (session: { uid: string; email: string; displayName: string; role: string; isFirebase: boolean }) => void | Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message || 'Sign-in failed');
      await onLogin({
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

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-6">
          <Logo className="h-9 w-9 shrink-0" />
          <div className="min-w-0">
            <h1 className="font-extrabold text-slate-900 text-base leading-none">MesaOrigins</h1>
            <p className="text-[11px] sm:text-xs text-slate-500 font-light mt-0.5">One Platform. Every Operation.</p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md bg-sky-50 px-3 py-1 text-[12px] font-medium text-sky-700">
          <ShieldCheck className="h-3.5 w-3.5" /> Internal onboarding access
        </div>
        <h2 className="mt-4 text-2xl font-bold text-slate-900">Sign in to onboarding</h2>
        <p className="mt-1 text-sm text-slate-500">Enter your product owner User ID and password to view organizations and create new ones.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-[13px] font-medium text-slate-600">User ID</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="your@email.com" className={inputCls} />
          </label>
          <label className="block">
            <span className="text-[13px] font-medium text-slate-600">Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Enter password" className={inputCls} />
          </label>
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <button type="submit" disabled={busy} className="w-full min-h-11 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-medium px-6 py-2.5 text-sm">
            {busy ? 'Signing in…' : 'Open onboarding console'}
          </button>
        </form>
      </div>
    </div>
  );
}
