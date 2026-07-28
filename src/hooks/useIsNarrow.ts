import { useEffect, useState } from 'react';

function matchesNarrow(breakpointPx: number): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(`(max-width: ${breakpointPx}px)`).matches;
}

/** True when viewport is below the `md` Tailwind breakpoint (768px). */
export function useIsNarrow(breakpointPx = 767): boolean {
  const [narrow, setNarrow] = useState(() => matchesNarrow(breakpointPx));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [breakpointPx]);

  return narrow;
}
