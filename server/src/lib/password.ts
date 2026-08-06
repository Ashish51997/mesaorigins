import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Response } from 'express';
import { SESSION_MAX_AGE_SEC, sessionCookieName, useSecureCookies } from '../auth/config';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function newSessionToken(): string {
  return randomUUID();
}

/** Set the Auth.js session cookie so getSession() picks it up. */
export function setSessionCookie(res: Response, sessionToken: string, expires: Date): void {
  const secure = useSecureCookies();
  res.cookie(sessionCookieName(), sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    expires,
    maxAge: SESSION_MAX_AGE_SEC * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  const secure = useSecureCookies();
  res.clearCookie(sessionCookieName(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
  });
}
