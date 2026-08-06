/**
 * Dev identity header for the Phase-1 login picker (`x-dev-user`).
 * Production Auth.js sessions use httpOnly cookies (credentials: 'include').
 */
let devUser = '';

export function setDevUser(emailOrCode: string): void {
  devUser = emailOrCode || '';
}

export function getDevUser(): string {
  return devUser;
}
