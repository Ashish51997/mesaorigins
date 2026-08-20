const LOCAL_DEFAULT_PLATFORM_ADMIN = 'aroul303@gmail.com';

/**
 * Identity allowlist for the cross-tenant MesaOrigins control plane.
 *
 * Production intentionally has no source-code fallback: the deployment must
 * mount ONBOARDING_ALLOWED_EMAILS from its secret store. The seeded fallback
 * exists only for isolated local development.
 */
export function allowedPlatformAdminEmails(): string[] {
  const configured = (process.env.ONBOARDING_ALLOWED_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length > 0) return [...new Set(configured)];
  return process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH === '1'
    ? [LOCAL_DEFAULT_PLATFORM_ADMIN]
    : [];
}

/** Platform access needs both an allowlisted identity and an active admin role. */
export function canAccessPlatformAdmin(email: string | undefined, hasAdminMembership: boolean): boolean {
  if (!email || !hasAdminMembership) return false;
  return allowedPlatformAdminEmails().includes(email.trim().toLowerCase());
}
