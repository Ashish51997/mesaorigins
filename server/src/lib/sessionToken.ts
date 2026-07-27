import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'mdp1.';
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

export type SessionClaims = {
  sub: string; // userId
  email: string;
  mid: string; // membershipId
  exp: number; // unix seconds
};

function secret(): string {
  return process.env.SESSION_SECRET || process.env.LOGIN_PASSWORD || '';
}

export function passwordAuthEnabled(): boolean {
  return Boolean((process.env.LOGIN_PASSWORD || '').length);
}

export function passwordsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signSession(
  claims: Omit<SessionClaims, 'exp'> & { exp?: number },
  ttlSec = DEFAULT_TTL_SEC,
): string {
  const s = secret();
  if (!s) throw new Error('SESSION_SECRET or LOGIN_PASSWORD required to sign sessions');
  const full: SessionClaims = {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    mid: claims.mid,
    exp: claims.exp ?? Math.floor(Date.now() / 1000) + ttlSec,
  };
  const payload = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = createHmac('sha256', s).update(payload).digest('base64url');
  return `${PREFIX}${payload}.${sig}`;
}

export function isSessionToken(token: string): boolean {
  return token.startsWith(PREFIX);
}

export function verifySession(token: string): SessionClaims | null {
  const s = secret();
  if (!s || !token.startsWith(PREFIX)) return null;
  const raw = token.slice(PREFIX.length);
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = createHmac('sha256', s).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
  } catch {
    return null;
  }
  if (!claims?.sub || !claims?.email || !claims?.mid || !claims?.exp) return null;
  if (claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}
