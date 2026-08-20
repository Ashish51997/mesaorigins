/**
 * Dev identity header for the Phase-1 login picker (`x-dev-user`).
 * Production Auth.js sessions use httpOnly cookies (credentials: 'include').
 */
const DEV_USER_KEY = 'mesaorigins_dev_identity';
const ORGANIZATION_KEY = 'mesaorigins_organization';

function readStoredDevUser(): string {
  if (typeof window === 'undefined') return '';
  try { return window.sessionStorage.getItem(DEV_USER_KEY) ?? ''; } catch { return ''; }
}

let devUser = readStoredDevUser();

function readStoredOrganization(): string {
  if (typeof window === 'undefined') return '';
  try { return window.sessionStorage.getItem(ORGANIZATION_KEY) ?? ''; } catch { return ''; }
}

let organizationId = readStoredOrganization();

export function setDevUser(emailOrCode: string): void {
  devUser = emailOrCode || '';
  if (typeof window === 'undefined') return;
  try {
    if (devUser) window.sessionStorage.setItem(DEV_USER_KEY, devUser);
    else window.sessionStorage.removeItem(DEV_USER_KEY);
  } catch { /* session storage can be unavailable in hardened browsers */ }
}

export function getDevUser(): string {
  return devUser;
}

export function setOrganizationId(id: string): void {
  organizationId = id || '';
  if (typeof window === 'undefined') return;
  try {
    if (organizationId) window.sessionStorage.setItem(ORGANIZATION_KEY, organizationId);
    else window.sessionStorage.removeItem(ORGANIZATION_KEY);
  } catch { /* session storage can be unavailable in hardened browsers */ }
}

export function getOrganizationId(): string {
  return organizationId;
}
