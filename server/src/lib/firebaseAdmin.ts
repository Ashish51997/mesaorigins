import fs from 'fs';
import admin from 'firebase-admin';

/**
 * Firebase Admin singleton for verifying ID tokens (Phase 2 auth).
 *
 * Credentials (first match wins):
 * 1. FIREBASE_SERVICE_ACCOUNT — path to a JSON file, or the JSON string itself
 * 2. GOOGLE_APPLICATION_CREDENTIALS — standard Google ADC path
 * 3. FIREBASE_PROJECT_ID alone — only works with ADC / metadata server
 */

let initialized = false;

function parseServiceAccount(): admin.ServiceAccount | null {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  try {
    if (raw.startsWith('{')) return JSON.parse(raw) as admin.ServiceAccount;
    if (fs.existsSync(raw)) return JSON.parse(fs.readFileSync(raw, 'utf-8')) as admin.ServiceAccount;
  } catch (err) {
    console.error('[firebase-admin] Failed to parse FIREBASE_SERVICE_ACCOUNT:', err);
  }
  return null;
}

export function initFirebaseAdmin(): boolean {
  if (initialized) return true;
  if (admin.apps.length) { initialized = true; return true; }

  const sa = parseServiceAccount();
  const projectId = process.env.FIREBASE_PROJECT_ID || sa?.projectId;
  try {
    if (sa) {
      admin.initializeApp({ credential: admin.credential.cert(sa), projectId: projectId || undefined });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS || projectId) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: projectId || undefined,
      });
    } else {
      return false;
    }
    initialized = true;
    return true;
  } catch (err) {
    console.error('[firebase-admin] initializeApp failed:', err);
    return false;
  }
}

export function firebaseAdminReady(): boolean {
  return initFirebaseAdmin();
}

export async function verifyIdToken(token: string): Promise<admin.auth.DecodedIdToken> {
  if (!initFirebaseAdmin()) {
    throw Object.assign(new Error('Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT.'), { code: 'auth_not_configured' });
  }
  return admin.auth().verifyIdToken(token);
}
