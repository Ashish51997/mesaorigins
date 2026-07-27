/**
 * i18n.ts — tiny language store for the EN / ಕನ್ನಡ / हिंदी toggle. EN is complete;
 * ~10 labels are stubbed in Kannada + Hindi to prove the pattern, with English
 * kept beside the translation. Any unknown key falls back to English.
 */

import { useSyncExternalStore } from 'react';

export type Lang = 'EN' | 'KN' | 'HI';

let lang: Lang = 'EN';
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
const subscribe = (cb: () => void): (() => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
const snap = () => lang;

export function useLang(): Lang { return useSyncExternalStore(subscribe, snap, snap); }
export function setLang(l: Lang): void { lang = l; emit(); }

const DICT: Record<string, { KN: string; HI: string }> = {
  'My Line': { KN: 'ನನ್ನ ಲೈನ್', HI: 'मेरी लाइन' },
  'Enter Hourly Reading': { KN: 'ಗಂಟೆಯ ರೀಡಿಂಗ್', HI: 'प्रति घंटा रीडिंग' },
  'Raise Breakdown': { KN: 'ಬ್ರೇಕ್‌ಡೌನ್ ದಾಖಲಿಸಿ', HI: 'ब्रेकडाउन दर्ज करें' },
  'My Shift Summary': { KN: 'ನನ್ನ ಶಿಫ್ಟ್ ಸಾರಾಂಶ', HI: 'मेरी शिफ्ट सारांश' },
  'Machine Log Book': { KN: 'ಯಂತ್ರ ಲಾಗ್ ಪುಸ್ತಕ', HI: 'मशीन लॉग बुक' },
  'Hourly reading': { KN: 'ಗಂಟೆಯ ರೀಡಿಂಗ್', HI: 'प्रति घंटा रीडिंग' },
  'Save reading': { KN: 'ರೀಡಿಂಗ್ ಉಳಿಸಿ', HI: 'रीडिंग सहेजें' },
  'Current lot': { KN: 'ಪ್ರಸ್ತುತ ಲಾಟ್', HI: 'वर्तमान लॉट' },
  'Target': { KN: 'ಗುರಿ', HI: 'लक्ष्य' },
  'Produced': { KN: 'ಉತ್ಪಾದನೆ', HI: 'उत्पादित' }
};

export function tr(en: string, l: Lang): string {
  if (l === 'EN') return en;
  const d = DICT[en];
  return d ? `${d[l]} · ${en}` : en;
}

export function useT(): (en: string) => string {
  const l = useLang();
  return (en: string) => tr(en, l);
}
