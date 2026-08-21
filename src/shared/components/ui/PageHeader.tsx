import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** When set, shows a touch-friendly back control. */
  onBack?: () => void;
  /** Accessible / visible back label. Defaults to "Back". */
  backLabel?: string;
  /** Right-side actions (More, Save, status chips, etc.). */
  actions?: ReactNode;
  /** Stick to top while scrolling. Default true. */
  sticky?: boolean;
  className?: string;
}

/**
 * Shared in-content page header for drill-down screens.
 * Flat MesaOrigins chrome: 24px page title, ≥44px back control.
 */
export default function PageHeader({
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  actions,
  sticky = true,
  className = '',
}: PageHeaderProps) {
  return (
    <header
      className={[
        sticky ? 'sticky top-0 z-10' : '',
        '-mx-4 lg:-mx-6 px-4 lg:px-6 py-2 mb-3',
        'flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm',
        'dark:border-slate-700 dark:bg-slate-900/95',
        className,
      ].filter(Boolean).join(' ')}
      data-testid="page-header"
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-sky-600 hover:bg-white hover:text-sky-700 dark:border-slate-700 dark:hover:bg-slate-800 sm:px-3"
          aria-label={backLabel}
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden text-sm font-medium sm:inline">{backLabel}</span>
        </button>
      )}

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg sm:text-xl font-bold text-slate-900 dark:text-white leading-tight">
          {title}
        </h2>
        {subtitle ? (
          <p className="truncate text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
        ) : null}
      </div>

      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
