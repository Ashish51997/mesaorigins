import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { canonicalHash } from '../lib/canonical';

const MAX_CLOCK_SKEW_SECONDS = 300;
const HANDOFF_AUDIENCE = 'mesaerp->mesaops:operational-order:v1';

function signingKey(): Buffer | null {
  const encoded = (process.env.MESAORIGINS_ERP_OPS_HANDOFF_HMAC_KEY || '').trim();
  if (!encoded) return null;
  try {
    const key = Buffer.from(encoded, 'base64');
    return key.length >= 32 ? key : null;
  } catch {
    return null;
  }
}

function message(organizationId: string, timestamp: string, body: unknown): string {
  return `${HANDOFF_AUDIENCE}\n${organizationId}\n${timestamp}\n${canonicalHash(body)}`;
}

export function signMesaErpToOpsHandoff(
  organizationId: string,
  body: unknown,
  timestamp = Math.floor(Date.now() / 1000).toString(),
): Record<string, string> {
  const key = signingKey();
  if (!key) throw new Error('MESAORIGINS_ERP_OPS_HANDOFF_HMAC_KEY must be base64 and decode to at least 32 bytes.');
  const signature = createHmac('sha256', key).update(message(organizationId, timestamp, body)).digest('hex');
  return {
    'x-mesaorigins-source-service': 'mesaerp',
    'x-mesaorigins-timestamp': timestamp,
    'x-mesaorigins-signature': signature,
  };
}

/** A normal employee session is insufficient to assert a MesaERP source. */
export const requireMesaErpHandoffSignature: RequestHandler = (req, res, next) => {
  const key = signingKey();
  if (!key) {
    res.status(503).json({ error: { code: 'internal_handoff_unavailable', message: 'The ERP-to-plant handoff credential is not configured.' } });
    return;
  }
  const source = (req.header('x-mesaorigins-source-service') || '').trim().toLowerCase();
  const timestamp = (req.header('x-mesaorigins-timestamp') || '').trim();
  const suppliedHex = (req.header('x-mesaorigins-signature') || '').trim().toLowerCase();
  const seconds = Number(timestamp);
  if (source !== 'mesaerp' || !Number.isSafeInteger(seconds) || Math.abs(Math.floor(Date.now() / 1000) - seconds) > MAX_CLOCK_SKEW_SECONDS || !/^[a-f0-9]{64}$/.test(suppliedHex)) {
    res.status(401).json({ error: { code: 'invalid_handoff_signature', message: 'The internal handoff signature is missing, expired, or invalid.' } });
    return;
  }
  const organizationId = req.user?.organizationId || '';
  const expected = createHmac('sha256', key).update(message(organizationId, timestamp, req.body)).digest();
  const supplied = Buffer.from(suppliedHex, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    res.status(401).json({ error: { code: 'invalid_handoff_signature', message: 'The internal handoff signature is missing, expired, or invalid.' } });
    return;
  }
  next();
};
