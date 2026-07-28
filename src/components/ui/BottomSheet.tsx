import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Slightly taller / wider content pad for dense forms */
  wide?: boolean | undefined;
  /** Extra class on the panel */
  className?: string;
}

/**
 * Mobile-first bottom sheet. Used directly or via ResponsiveOverlay on narrow viewports.
 */
export default function BottomSheet({ open, onClose, title, children, wide, className = '' }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Dismiss"
        onClick={onClose}
      />
      <div
        className={[
          'relative z-10 flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white dark:bg-slate-900 shadow-xl border-t border-slate-200 dark:border-slate-700',
          'pb-[env(safe-area-inset-bottom)]',
          className,
        ].join(' ')}
      >
        <div className="flex shrink-0 flex-col items-center pt-2 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden />
        </div>
        {(title != null && title !== '') && (
          <div className="flex items-center justify-between gap-3 px-4 pb-2 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto ${wide ? 'px-5 py-4' : 'px-4 py-3'}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
