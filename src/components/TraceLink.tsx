/**
 * TraceLink.tsx — renders a row identifier (lot / roll / order / pallet / invoice /
 * machine) as a clickable link that opens its detail in the Batch Passport via onTrace.
 * Falls back to plain text when no onTrace is provided. stopPropagation so it works
 * inside rows that have their own click handler.
 */

import type { ReactElement } from 'react';

export function TraceLink({ id, onTrace, className = '' }: { id: string; onTrace?: (q: string) => void; className?: string }): ReactElement {
  if (!onTrace || !id) return <span className={className}>{id}</span>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onTrace(id); }}
      className={`${className} hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline underline-offset-2 cursor-pointer transition-colors`}
      title={`Trace ${id}`}
    >
      {id}
    </button>
  );
}
