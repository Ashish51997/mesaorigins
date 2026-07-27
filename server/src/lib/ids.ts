/**
 * Server-authoritative document numbering. Replaces the client's
 * `PREFIX-${array.length}` scheme, which reused numbers after a cancel and
 * could collide across concurrent creators. Callers compute the next number
 * inside the same transaction as the insert, from the existing max suffix.
 */

// Given all existing numbers for a prefix (e.g. "SO-2026-"), return the next.
export function nextNumber(existing: string[], prefix: string, start = 1): string {
  const re = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);
  let max = start - 1;
  for (const n of existing) {
    const m = n.match(re);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return `${prefix}${max + 1}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
