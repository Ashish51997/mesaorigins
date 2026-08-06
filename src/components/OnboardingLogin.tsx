import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';

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
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700"><ShieldCheck className="h-3.5 w-3.5" /> Internal onboarding access</div>
        <h1 className="mt-4 text-2xl font-extrabold text-slate-900">Sign in to onboarding</h1>
        <p className="mt-1 text-sm text-slate-500">Enter your product owner User ID and password to view organizations and create new ones.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-[12px] font-semibold text-slate-600">User ID</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="your@email.com" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </label>
          <label className="block">
            <span className="text-[12px] font-semibold text-slate-600">Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Enter password" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </label>
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold px-6 py-3 text-sm shadow-sm">
            {busy ? 'Signing in…' : 'Open onboarding console'}
          </button>
        </form>
      </div>
    </div>
  );
}
