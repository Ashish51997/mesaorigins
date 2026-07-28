/**
 * AppHeader.tsx — the strip that never changes, on every screen.
 *
 * Whoever is logged in, whatever screen they are on, four things are always
 * within reach: who they are and which shift, the Trace box, the language
 * pills, and how fresh the data is. The Trace box is the reason this is
 * persistent rather than a dashboard widget — somebody holding a roll with a
 * customer on the phone should never have to navigate to look it up.
 */

import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { Search, ScanLine } from 'lucide-react';
import { setLang, type Lang } from '../../lib/i18n';
import { FreshnessBadge } from './primitives';

const LANGS: Lang[] = ['EN', 'KN', 'HI'];

/* -------------------------------------------------------- TraceSearchBox */

/**
 * Accepts any identifier in the plant — SO-, INQ-, C-, a lot number like
 * 190726·D·M08·B01, a roll number, a pallet id — and opens the Batch Passport.
 * Deliberately unvalidated on submit: the passport itself explains what it
 * could not find, which teaches the formats better than a rejected input does.
 */
export function TraceSearchBox({ onTrace, className = '' }: {
  onTrace: (query: string) => void;
  className?: string | undefined;
}): ReactElement {
  const [value, setValue] = useState('');

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const clean = value.trim();
    if (!clean) return;
    onTrace(clean);
    setValue('');
  };

  return (
    <form onSubmit={submit} className={`relative ${className}`} role="search">
      <label htmlFor="trace-box" className="sr-only">
        Trace a lot, roll, pallet, order or complaint number
      </label>
      <Search
        className="w-4 h-4 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
        aria-hidden="true"
      />
      <input
        id="trace-box"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Trace a lot, roll, order…"
        autoComplete="off"
        spellCheck={false}
        className="w-full h-11 pl-9 pr-11 rounded-full border border-slate-200 bg-white text-[15px] font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-600 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30"
      />
      <button
        type="submit"
        title="Open the batch passport"
        aria-label="Open the batch passport"
        className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-full text-slate-600 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
      >
        <ScanLine className="w-4.5 h-4.5" aria-hidden="true" />
      </button>
    </form>
  );
}

/* -------------------------------------------------------------- AppHeader */

export function AppHeader({
  userName, role, shift, lang, updatedAt, onTrace, left, right,
}: {
  userName: string;
  role: string;
  shift: string;
  lang: Lang;
  /** Drives the "updated 2 min ago" / amber stale marker. */
  updatedAt: number;
  onTrace: (query: string) => void;
  /** Shell chrome supplied by App (menu toggle, breadcrumb). */
  left?: ReactNode | undefined;
  /** Shell chrome supplied by App (theme switch, sign out). */
  right?: ReactNode | undefined;
}): ReactElement {
  return (
    <header className="bg-white border border-slate-200 shadow-sm shrink-0 m-2 sm:m-3 rounded-2xl">
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5">
        {left}

        {/* Who is on shift — the first thing to confirm you are in the right account. */}
        <div className="hidden md:flex flex-col leading-tight min-w-0 shrink-0">
          <span className="font-display text-[16px] font-bold text-slate-900 truncate">
            {userName} · Shift {shift}
          </span>
          <span className="text-[13px] text-slate-600 truncate">{role}</span>
        </div>

        {/* Trace — the widest thing in the header, on purpose. */}
        <TraceSearchBox onTrace={onTrace} className="flex-1 min-w-[140px] max-w-xl" />

        <div className="hidden lg:block shrink-0">
          <FreshnessBadge updatedAt={updatedAt} />
        </div>

        {/* Language pills — 48 px targets, the plant runs in three languages. */}
        <div
          className="hidden sm:flex items-center rounded-full border border-slate-200 overflow-hidden shrink-0"
          role="group"
          aria-label="Language"
        >
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`min-w-[48px] h-11 px-3 text-[14px] font-bold transition
                ${lang === l ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {l}
            </button>
          ))}
        </div>

        {right}
      </div>

      {/* Narrow screens: name and freshness move to their own row rather than vanish. */}
      <div className="flex md:hidden items-center justify-between gap-2 px-3 pb-2 -mt-0.5">
        <span className="text-[14px] font-semibold text-slate-900 truncate">
          {userName} · Shift {shift} · {role}
        </span>
        <FreshnessBadge updatedAt={updatedAt} />
      </div>
    </header>
  );
}
