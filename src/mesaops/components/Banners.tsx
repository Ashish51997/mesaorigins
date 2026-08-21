/**
 * Banners.tsx — the persistent offline banner and the practice-mode banner.
 * Both sit directly below the header so they overlay every screen.
 */

import { WifiOff, FlaskConical } from 'lucide-react';
import { useOnline } from '@mesaops/lib/simulation';
import { usePractice } from '@shared/lib/offline';

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="bg-slate-600 text-white text-[12px] font-semibold px-4 py-2 flex items-center gap-2 no-print">
      <WifiOff className="w-4 h-4 shrink-0" />
      No network — your entries are saved on this tablet and will send automatically.
    </div>
  );
}

export function PracticeBanner() {
  const practice = usePractice();
  if (!practice) return null;
  return (
    <div className="bg-amber-400 text-amber-950 text-[12px] font-bold px-4 py-2 flex items-center gap-2 no-print">
      <FlaskConical className="w-4 h-4 shrink-0" />
      PRACTICE MODE — this is training data. Nothing you enter here is saved.
    </div>
  );
}
