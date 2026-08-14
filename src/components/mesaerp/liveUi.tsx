import { useRef, useState, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { createErpIdempotencyKey } from '../../lib/queries/mesaerp';

export const liveInput = 'min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
export const livePrimary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300';
export const liveSecondary = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300';

export function humanize(value: string) {
  return value.replace(/[-_.]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function decimalParts(value: string) {
  const trimmed = value.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return null;
  return { negative: match[1] === '-', integer: match[2], fraction: match[3] ?? '' };
}

export function isPositiveDecimalString(value: string) {
  const parts = decimalParts(value);
  return Boolean(parts && !parts.negative && /[1-9]/.test(`${parts.integer}${parts.fraction}`));
}

export function sumDecimalStrings(values: string[]) {
  const parsed = values.map(decimalParts);
  if (parsed.some((value) => value === null)) return '—';
  const parts = parsed as NonNullable<ReturnType<typeof decimalParts>>[];
  const scale = Math.max(0, ...parts.map((value) => value.fraction.length));
  const total = parts.reduce((sum, value) => {
    const digits = `${value.integer}${value.fraction.padEnd(scale, '0')}`;
    const signed = BigInt(digits || '0') * (value.negative ? -1n : 1n);
    return sum + signed;
  }, 0n);
  const negative = total < 0n;
  const absolute = (negative ? -total : total).toString().padStart(scale + 1, '0');
  const integer = scale ? absolute.slice(0, -scale) : absolute;
  const fraction = scale ? absolute.slice(-scale).replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

export function formatDecimalString(value: string) {
  const parts = decimalParts(value);
  if (!parts) return value || '—';
  const grouped = parts.integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${parts.negative ? '-' : ''}${grouped}${parts.fraction ? `.${parts.fraction}` : ''}`;
}

export function absoluteDecimalString(value: string) {
  const parts = decimalParts(value);
  if (!parts) return value;
  return `${parts.integer}${parts.fraction ? `.${parts.fraction}` : ''}`;
}

export function LivePanel({ title, eyebrow, action, children, className = '' }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`overflow-hidden rounded-xl border border-slate-200 bg-white ${className}`}><div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5"><div>{eyebrow && <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">{eyebrow}</p>}<h2 className="mt-0.5 text-base font-extrabold text-slate-900">{title}</h2></div>{action}</div>{children}</section>;
}

export function LivePill({ state }: { state: string }) {
  const normalized = state.toLowerCase();
  const tone = ['approved', 'posted', 'active', 'linked', 'matched', 'claimed', 'completed', 'open'].includes(normalized)
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : ['blocked', 'conflict', 'cancelled', 'rejected', 'locked'].includes(normalized)
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-amber-200 bg-amber-50 text-amber-700';
  return <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 text-[10px] font-extrabold uppercase tracking-wide ${tone}`}>{humanize(state)}</span>;
}

export function LiveNotice({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'amber' | 'rose' | 'emerald' }) {
  const classes = { blue: 'border-blue-200 bg-blue-50 text-blue-900', amber: 'border-amber-200 bg-amber-50 text-amber-900', rose: 'border-rose-200 bg-rose-50 text-rose-900', emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900' };
  return <div className={`rounded-xl border px-4 py-3 text-sm leading-6 ${classes[tone]}`}>{children}</div>;
}

export function LiveFeedback({ message, error }: { message: string; error: string }) {
  if (!message && !error) return null;
  return <div aria-live="polite" className="space-y-2">{message && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800"><CheckCircle2 className="h-4 w-4" />{message}</div>}{error && <LiveNotice tone="rose">{error}</LiveNotice>}</div>;
}

export function LiveTabs<T extends string>({ value, items, onChange }: { value: T; items: Array<{ id: T; label: string }>; onChange: (value: T) => void }) {
  return <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1" role="tablist">{items.map((item) => <button key={item.id} type="button" role="tab" aria-selected={value === item.id} onClick={() => onChange(item.id)} className={`min-h-9 shrink-0 rounded-lg px-3 text-xs font-extrabold ${value === item.id ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{item.label}</button>)}</div>;
}

export function useLiveMutationRunner() {
  const pendingKeys = useRef(new Map<string, string>());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const keyFor = (intent: string) => {
    const existing = pendingKeys.current.get(intent) ?? createErpIdempotencyKey(intent);
    pendingKeys.current.set(intent, existing);
    return existing;
  };
  const run = async (intent: string, operation: () => Promise<unknown>, success: string) => {
    setMessage(''); setError('');
    try {
      await operation();
      pendingKeys.current.delete(intent);
      setMessage(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The operation could not be saved.');
      return false;
    }
  };
  return { keyFor, run, message, error, clear: () => { setMessage(''); setError(''); } };
}
