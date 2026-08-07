import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useIsNarrow } from '../../hooks/useIsNarrow';
import BottomSheet from './BottomSheet';

export type OverlayVariant = 'center' | 'drawer-right';

export interface ResponsiveOverlayProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Desktop presentation when not narrow. Default: center */
  variant?: OverlayVariant;
  /** Wider panel on desktop / more padding on sheet */
  wide?: boolean;
  /** Extra class for the desktop panel */
  panelClassName?: string;
  /** When false, skip the built-in title row (caller supplies chrome). Default true if title set. */
  showHeader?: boolean;
}

/**
 * Narrow → BottomSheet. Desktop → centered modal or right drawer matching existing ERP patterns.
 */
export default function ResponsiveOverlay({
  open,
  onClose,
  title,
  children,
  variant = 'center',
  wide,
  panelClassName = '',
  showHeader,
}: ResponsiveOverlayProps) {
  const isNarrow = useIsNarrow();
  const header = showHeader ?? title != null;

  if (!open) return null;

  if (isNarrow) {
    return (
      <BottomSheet open={open} onClose={onClose} title={header ? title : undefined} wide={wide}>
        {children}
      </BottomSheet>
    );
  }

  if (variant === 'drawer-right') {
    return (
      <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true">
        <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" aria-label="Close" onClick={onClose} />
        <div
          className={[
            'relative z-10 h-full w-full max-w-lg bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden',
            wide ? 'max-w-xl' : '',
            panelClassName,
          ].join(' ')}
        >
          {header && (
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">{title}</h2>
              <button type="button" onClick={onClose} className="p-2.5 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex-1 overflow-hidden min-h-0 flex flex-col">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center p-4 overflow-y-auto bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={[
          'relative my-auto w-full rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700',
          wide ? 'max-w-2xl' : 'max-w-md',
          panelClassName,
        ].join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        {header && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">{title}</h2>
            <button type="button" onClick={onClose} className="p-2.5 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
