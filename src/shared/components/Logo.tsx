/**
 * Logo.tsx — the MesaOrigins brand mark, inlined so it stays crisp at any size.
 * White rounded tile (6px radius) with the blue gateway mark.
 * Size it via className (e.g. "h-9 w-9").
 *
 * Gradient IDs are unique per instance (useId) so fills still resolve when another
 * Logo sits inside a `display: none` sidebar on mobile.
 */

import { useId, type ReactElement } from 'react';

export default function Logo({ className = 'h-9 w-9' }: { className?: string }): ReactElement {
  const uid = useId().replace(/:/g, '');
  const gA = `mo_logo_a_${uid}`;
  const gB = `mo_logo_b_${uid}`;
  const gC = `mo_logo_c_${uid}`;

  return (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} role="img" aria-label="MesaOrigins">
      <rect width="36" height="36" rx="6" fill="white" stroke="#E2E8F0" strokeWidth="1" />
      <path d="M23.5771 6.68959C25.4125 7.64277 31.1904 15.4049 31.1904 15.4049L4.00013 15.4049C4.00013 15.4049 9.77807 7.57469 11.6134 6.68959C13.4488 5.80449 21.7418 5.73641 23.5771 6.68959Z" fill={`url(#${gA})`} />
      <path d="M31.1904 15.4049L31.1904 25.1926C31.1904 27.2954 29.4858 29.0001 27.383 29.0001C25.2802 29.0001 23.5755 27.2954 23.5755 25.1926L23.5755 17.5801C23.5755 17.5801 23.6027 16.1526 23.4395 15.9487C23.1675 15.6089 22.6236 15.4049 22.6236 15.4049L31.1904 15.4049Z" fill={`url(#${gB})`} />
      <path d="M4 15.4049L4 25.1926C4 27.2954 5.70466 29.0001 7.80747 29.0001C9.91028 29.0001 11.6149 27.2954 11.6149 25.1926L11.6149 17.5801C11.6149 17.5801 11.5877 16.1526 11.7509 15.9487C12.0229 15.6089 12.5668 15.4049 12.5668 15.4049L4 15.4049Z" fill={`url(#${gC})`} />
      <defs>
        <linearGradient id={gA} x1="31.1904" y1="10.7024" x2="4.00013" y2="10.7024" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1F74FF" />
          <stop offset="1" stopColor="#0044FF" />
        </linearGradient>
        <linearGradient id={gB} x1="27.383" y1="29.0001" x2="27.383" y2="15.4049" gradientUnits="userSpaceOnUse">
          <stop stopColor="#287CFF" />
          <stop offset="1" stopColor="#0538BD" />
        </linearGradient>
        <linearGradient id={gC} x1="7.80747" y1="29.0001" x2="7.80747" y2="15.4049" gradientUnits="userSpaceOnUse">
          <stop stopColor="#287CFF" />
          <stop offset="1" stopColor="#0538BD" />
        </linearGradient>
      </defs>
    </svg>
  );
}
