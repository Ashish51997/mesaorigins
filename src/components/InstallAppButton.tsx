import { Download, Share, X } from 'lucide-react';
import { usePwaInstall } from '../lib/pwaInstall';

type Props = {
  /** Compact icon-only control for the app header. */
  compact?: boolean;
  className?: string;
};

export default function InstallAppButton({ compact = false, className = '' }: Props) {
  const { canInstall, installed, hint, dismissHint, install } = usePwaInstall();

  if (installed || !canInstall) return null;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => { void install(); }}
        title="Install app"
        aria-label="Install app"
        className={
          compact
            ? 'inline-flex items-center gap-1.5 min-h-9 px-2 py-1 rounded-lg border border-slate-200 bg-white text-sky-600 hover:bg-sky-50 text-[12px] font-medium transition-colors cursor-pointer'
            : 'inline-flex items-center justify-center gap-2 w-full min-h-11 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700 font-medium px-6 py-2.5 text-sm'
        }
      >
        <Download className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        {compact ? <span className="hidden sm:inline">Install</span> : 'Install app'}
      </button>

      {hint && (
        <div className={`absolute z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 text-left ${compact ? 'right-0 top-full' : 'left-0 right-0 top-full'}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12px] font-semibold text-slate-800">
              {hint === 'ios' ? 'Install on iPhone / iPad' : 'Install this app'}
            </p>
            <button type="button" onClick={dismissHint} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {hint === 'ios' ? (
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
              Tap <Share className="inline h-3 w-3 text-sky-600 align-text-bottom" /> Share, then choose
              <span className="font-medium text-slate-700"> Add to Home Screen</span>.
            </p>
          ) : (
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
              Open your browser menu and choose <span className="font-medium text-slate-700">Install app</span> or
              <span className="font-medium text-slate-700"> Add to Home screen</span>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
