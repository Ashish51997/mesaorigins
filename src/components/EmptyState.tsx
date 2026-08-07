/**
 * EmptyState.tsx — reusable teaching empty state. Never a blank panel: every
 * empty state says what the list is and what fills it, with an optional action.
 */

import type { ReactNode } from 'react';

export function EmptyState({ icon, title, hint, action }: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      {icon && <div className="mb-3 text-slate-300 dark:text-slate-600">{icon}</div>}
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400 max-w-sm">{hint}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 h-11 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
