import { auth as firebaseAuth } from '../firebase';
import { getDevUser, getSessionToken } from './apiIdentity';

const BASE = '/api';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};

  // Password-mode HMAC session (preferred when present).
  const session = getSessionToken();
  if (session) {
    headers.Authorization = `Bearer ${session}`;
  } else {
    // Firebase ID token when a federated session is active.
    const fbUser = firebaseAuth.currentUser;
    if (fbUser) {
      try {
        headers.Authorization = `Bearer ${await fbUser.getIdToken()}`;
      } catch {
        /* fall through to dev identity */
      }
    }
  }

  // Phase-1 / local demo: x-dev-user (employee code or email).
  const dev = getDevUser();
  if (dev) headers['x-dev-user'] = dev;

  if (body !== undefined) headers['Content-Type'] = 'application/json';

  // `body` is spread in only when there is one: under exactOptionalPropertyTypes
  // RequestInit.body does not accept an explicit undefined.
  const res = await fetch(BASE + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = (data && data.error) || {};
    throw new ApiError(res.status, err.code || 'error', err.message || res.statusText, err.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
