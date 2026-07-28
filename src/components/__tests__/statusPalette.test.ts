/**
 * statusPalette.test.ts — locks the operational palette to the style guide.
 *
 * The three status tones are the one part of the dashboard where a colour
 * change is a safety change: an operator reads them at a metre, and a tone that
 * quietly loses contrast is a hold nobody notices. These tests read the real
 * stylesheet rather than a copy of the values, so drift in index.css fails here.
 *
 * B.2 of the guide bans white-on-amber and green-as-text. Measured, white fails
 * on all three bases and every base fails as text, so the rule is enforced
 * across all three tones rather than the two named.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

/* ------------------------------------------------------------ contrast */

function luminance(hex: string): number {
  const parts = hex.replace('#', '').match(/../g);
  if (!parts) throw new Error(`bad hex: ${hex}`);
  const [r, g, b] = parts.map((h) => {
    const v = parseInt(h, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull a custom property's value out of the stylesheet. */
function token(name: string): string {
  const hit = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(css);
  expect(hit, `--${name} missing from index.css`).toBeTruthy();
  return (hit?.[1] ?? '').toLowerCase();
}

/** The values locked in the style guide, sampled from the chips. */
const LOCKED = {
  pass: { base: '#55b685', soft: '#d9f9e6', text: '#1f7a4d' },
  hold: { base: '#e9a23b', soft: '#fcf3cc', text: '#88451d' },
  fail: { base: '#dd524c', soft: '#f9e3e2', text: '#9b2c28' },
} as const;

const WHITE = '#ffffff';
const APP_BG = '#f5f7fa';
const INK = '#0b0b0f';

describe('The locked status palette', () => {
  it('matches the style guide exactly, to the hex', () => {
    for (const [tone, roles] of Object.entries(LOCKED)) {
      for (const [role, hex] of Object.entries(roles)) {
        expect(token(`${tone}-${role}`), `${tone}/${role}`).toBe(hex);
      }
    }
  });
});

describe('Every pairing the dashboard actually renders', () => {
  it('passes AA for the text token on its own soft ground', () => {
    for (const [tone, r] of Object.entries(LOCKED)) {
      expect(contrast(r.text, r.soft), `${tone} text on soft`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('passes AA for the text token on white and on the app background', () => {
    for (const [tone, r] of Object.entries(LOCKED)) {
      expect(contrast(r.text, WHITE), `${tone} text on white`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(r.text, APP_BG), `${tone} text on app bg`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('passes AA for plant ink on a base fill — what status bands use', () => {
    for (const [tone, r] of Object.entries(LOCKED)) {
      expect(contrast(INK, r.base), `ink on ${tone} base`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('B.2 — the combinations that must never ship', () => {
  it('confirms white on a base is unusable on all three, not only amber', () => {
    // This is the measurement that justifies banning white outright.
    for (const [tone, r] of Object.entries(LOCKED)) {
      expect(contrast(WHITE, r.base), `white on ${tone} base`).toBeLessThan(4.5);
    }
  });

  it('confirms a base used as text fails on all three, not only green', () => {
    for (const [tone, r] of Object.entries(LOCKED)) {
      expect(contrast(r.base, WHITE), `${tone} base as text`).toBeLessThan(4.5);
    }
  });

  it('never puts white on a base fill in the stylesheet', () => {
    const solids = /\.tone-(green|amber|red)-solid\s*\{[^}]*\}/g;
    const found = css.match(solids) ?? [];
    expect(found).toHaveLength(3);
    for (const rule of found) {
      expect(rule, `white foreground in: ${rule}`).not.toMatch(/color:\s*(#fff|#ffffff|white)/i);
      expect(rule, `solid must take plant ink: ${rule}`).toMatch(/color:\s*var\(--text-primary\)/);
    }
  });

  it('never uses a base token as a foreground colour anywhere', () => {
    // `color: var(--*-base)` would be exactly the banned "green as text".
    // The lookbehind keeps `border-color:` — a legitimate use of the base — from
    // matching, since it ends in the same six characters.
    expect(css).not.toMatch(/(?<![\w-])color:\s*var\(--(pass|hold|fail)-base\)/);
  });

  it('builds each chip from soft ground, text token and base outline', () => {
    for (const [cls, tone] of [['green', 'pass'], ['amber', 'hold'], ['red', 'fail']] as const) {
      const rule = new RegExp(`\\.tone-${cls}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? '';
      expect(rule).toMatch(new RegExp(`color:\\s*var\\(--${tone}-text\\)`));
      expect(rule).toMatch(new RegExp(`background:\\s*var\\(--${tone}-soft\\)`));
      expect(rule).toMatch(new RegExp(`border-color:\\s*var\\(--${tone}-base\\)`));
    }
  });
});
