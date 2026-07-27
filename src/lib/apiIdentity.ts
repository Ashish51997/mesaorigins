/**
 * The dev identity the API client sends as `x-dev-user` while Firebase auth is
 * deferred. App sets it to the current role's directory email so the server
 * resolves the matching membership (org + role). Phase 2 replaces this header
 * with a Firebase ID token.
 */
let devUser = '';

export function setDevUser(emailOrCode: string): void {
  devUser = emailOrCode || '';
}

export function getDevUser(): string {
  return devUser;
}
