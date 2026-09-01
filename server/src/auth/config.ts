/**
 * Auth.js (Express) config — Google OAuth + Prisma database sessions.
 * Password login is handled separately (Credentials cannot use DB sessions);
 * it writes the same Session rows and cookie — see platform/auth/router.ts.
 */
import type { ExpressAuthConfig } from '@auth/express';
import Google from '@auth/express/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { basePrisma } from '../db';

// Finance and plant-control sessions are deliberately short lived. Users can
// sign in again without losing draft work, while a copied cookie has a much
// smaller useful window than the former seven-day default.
const SESSION_MAX_AGE_SEC = 60 * 60 * 12; // 12 hours

export function useSecureCookies(): boolean {
  const url = process.env.AUTH_URL || process.env.APP_URL || '';
  return url.startsWith('https://') || process.env.NODE_ENV === 'production';
}

export function sessionCookieName(): string {
  return useSecureCookies() ? '__Secure-authjs.session-token' : 'authjs.session-token';
}

function googleConfigured(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

export function authSecretConfigured(): boolean {
  return Boolean((process.env.AUTH_SECRET || '').length >= 32);
}

export const authConfig: ExpressAuthConfig = {
  adapter: PrismaAdapter(basePrisma),
  providers: [
    ...(googleConfigured()
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID!,
            clientSecret: process.env.AUTH_GOOGLE_SECRET!,
          }),
        ]
      : []),
  ],
  session: {
    strategy: 'database',
    maxAge: SESSION_MAX_AGE_SEC,
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== 'google') return true;
      const email = (user.email || '').trim().toLowerCase();
      if (!email) return false;
      const existing = await basePrisma.user.findUnique({ where: { email } });
      if (!existing) return false;
      const membership = await basePrisma.membership.findFirst({
        where: { userId: existing.id, status: { not: 'inactive' } },
      });
      return Boolean(membership);
    },
    async session({ session, user }) {
      if (session.user) {
        (session.user as { id?: string }).id = user.id;
        if (user.email) session.user.email = user.email;
        if (user.name) session.user.name = user.name;
      }
      return session;
    },
  },
  trustHost: true,
  // Link Google to an existing directory User with the same verified email.
  allowDangerousEmailAccountLinking: true,
} as ExpressAuthConfig;

export { SESSION_MAX_AGE_SEC };
