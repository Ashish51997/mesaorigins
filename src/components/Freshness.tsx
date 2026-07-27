/** Freshness.tsx — live "updated Ns ago" chip; amber + "showing saved data" when stale/offline. */
import { useState, useEffect } from 'react';
import { formatAgo } from '../lib/simulation';

export function Freshness({ updatedAt }: { updatedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const { label, stale } = formatAgo(updatedAt);
  return <span className={`text-[10px] font-semibold ${stale ? 'text-amber-600' : 'text-slate-400'}`}>{label}</span>;
}
