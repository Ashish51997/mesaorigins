/**
 * The dev identity the API client sends as `x-dev-user` while Firebase auth is
 * deferred. App sets it to the current role's directory email so the server
 * resolves the matching membership (org + role).
 *
 * Password-mode sessions use `erp_api_token` (Bearer) instead.
 */
let devUser = '';

const TOKEN_KEY = 'erp_api_token';

export function setDevUser(emailOrCode: string): void {
  devUser = emailOrCode || '';
}

export function getDevUser(): string {
  return devUser;
}

export function setSessionToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getSessionToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}
