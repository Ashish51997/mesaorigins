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
            ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-slate-200 bg-white text-indigo-600 hover:bg-indigo-50 text-[11px] font-bold transition-colors cursor-pointer'
            : 'inline-flex items-center justify-center gap-2 w-full rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-6 py-3 text-sm shadow-sm'
        }
      >
        <Download className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        {compact ? <span className="hidden sm:inline">Install</span> : 'Install app'}
      </button>

      {hint && (
        <div className={`absolute z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-lg ${compact ? 'right-0 top-full' : 'left-0 right-0 top-full'}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12px] font-bold text-slate-800">
              {hint === 'ios' ? 'Install on iPhone / iPad' : 'Install this app'}
            </p>
            <button type="button" onClick={dismissHint} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {hint === 'ios' ? (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Tap <Share className="inline h-3 w-3 text-indigo-600 align-text-bottom" /> Share, then choose
              <span className="font-semibold text-slate-700"> Add to Home Screen</span>.
            </p>
          ) : (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Open your browser menu and choose <span className="font-semibold text-slate-700">Install app</span> or
              <span className="font-semibold text-slate-700"> Add to Home screen</span>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
