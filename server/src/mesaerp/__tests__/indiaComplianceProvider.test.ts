import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { canonicalJson, canonicalHash } from '../../lib/canonical';
import {
  createIndiaComplianceProviderFromEnv,
  GenericHttpsIndiaComplianceProvider,
  UnavailableIndiaComplianceProvider,
} from '../indiaComplianceProvider';

const key = Buffer.alloc(32, 23);
const keyId = 'adapter-key-2026-01';
const request = { DocDtls: { No: 'INV-1' }, Value: 1180 };
const requestId = 'provider-submit-001';

function adapterResponse(operation = 'submit_e_invoice', payload: unknown = {
  provider: 'authorised-gsp',
  providerReference: 'provider-reference-1',
  irn: 'a'.repeat(64),
  acknowledgementNumber: 'ACK-1',
  acknowledgementAt: '2026-08-14T10:00:00.000Z',
  signedPayload: { providerSignedInvoice: 'opaque-provider-evidence' },
  qrData: 'opaque-provider-qr-data',
}, overrides: Record<string, unknown> = {}) {
  const unsigned = {
    schema: 'mesadesk.india-compliance.adapter.response.v1',
    operation,
    requestId,
    requestHash: canonicalHash(request),
    payload,
    ...overrides,
  };
  const signature = createHmac('sha256', key).update(canonicalJson({
    ...unsigned,
    attestation: { algorithm: 'hmac-sha256', keyId },
  })).digest('hex');
  return { ...unsigned, attestation: { algorithm: 'hmac-sha256', keyId, signature } };
}

function provider(fetchImpl: typeof fetch) {
  return new GenericHttpsIndiaComplianceProvider({
    baseUrl: 'https://adapter.example.test/india/',
    bearerToken: 'test-bearer-token-long-enough',
    attestationKey: key,
    attestationKeyId: keyId,
    fetchImpl,
  });
}

describe('generic HTTPS India compliance provider', () => {
  it('defaults to unavailable and validates production configuration before use', () => {
    expect(createIndiaComplianceProviderFromEnv({})).toBeInstanceOf(UnavailableIndiaComplianceProvider);
    expect(() => createIndiaComplianceProviderFromEnv({ MESAERP_INDIA_COMPLIANCE_PROVIDER: 'generic_https' }))
      .toThrow(/requires base URL/i);
    expect(() => createIndiaComplianceProviderFromEnv({
      MESAERP_INDIA_COMPLIANCE_PROVIDER: 'generic_https',
      MESAERP_INDIA_COMPLIANCE_BASE_URL: 'http://insecure.example.test',
      MESAERP_INDIA_COMPLIANCE_BEARER_TOKEN: 'test-bearer-token-long-enough',
      MESAERP_INDIA_COMPLIANCE_ATTESTATION_KEY_ID: keyId,
      MESAERP_INDIA_COMPLIANCE_ATTESTATION_HMAC_KEY: key.toString('base64'),
    })).toThrow(/must use HTTPS/i);
    expect(() => createIndiaComplianceProviderFromEnv({
      MESAERP_INDIA_COMPLIANCE_PROVIDER: 'generic_https',
      MESAERP_INDIA_COMPLIANCE_BASE_URL: 'https://adapter.example.test',
      MESAERP_INDIA_COMPLIANCE_BEARER_TOKEN: 'test-bearer-token-long-enough',
      MESAERP_INDIA_COMPLIANCE_ATTESTATION_KEY_ID: keyId,
      MESAERP_INDIA_COMPLIANCE_ATTESTATION_HMAC_KEY: `${key.toString('base64')}!`,
    })).toThrow(/base64 HMAC key/i);
  });

  it('sends authenticated idempotent requests and retains verified adapter attestation separately from provider evidence', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer test-bearer-token-long-enough',
        'idempotency-key': requestId,
        'x-mesadesk-operation': 'submit_e_invoice',
        'x-mesadesk-request-hash': canonicalHash(request),
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        schema: 'mesadesk.india-compliance.adapter.request.v1',
        operation: 'submit_e_invoice',
        requestId,
        requestHash: canonicalHash(request),
        request,
      });
      return new Response(JSON.stringify(adapterResponse()), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const result = await provider(fetchImpl).submitEInvoice(request, requestId);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.signedPayload).toMatchObject({
      providerEvidence: { providerSignedInvoice: 'opaque-provider-evidence' },
      mesaDeskAdapterAttestation: {
        claim: 'configured_adapter_response',
        operation: 'submit_e_invoice',
        requestId,
        requestHash: canonicalHash(request),
      },
    });
  });

  it('rejects a response with a valid shape that is not bound to the request', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(adapterResponse(
      'submit_e_invoice',
      undefined,
      { requestId: 'different-request-001' },
    )), { status: 200 }));
    await expect(provider(fetchImpl).submitEInvoice(request, requestId)).rejects.toMatchObject({
      status: 502,
      code: 'compliance_provider_response_unbound',
    });
  });

  it('rejects tampered operation payloads before they enter statutory records', async () => {
    const response = adapterResponse();
    response.payload = { ...(response.payload as Record<string, unknown>), acknowledgementNumber: 'TAMPERED' };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    await expect(provider(fetchImpl).submitEInvoice(request, requestId)).rejects.toMatchObject({
      status: 502,
      code: 'compliance_provider_attestation_invalid',
    });
  });

  it('rejects malformed operation payloads even when the adapter attestation is valid', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(adapterResponse(
      'submit_e_invoice',
      { provider: 'adapter', providerReference: 'ref-without-statutory-fields' },
    )), { status: 200 }));
    await expect(provider(fetchImpl).submitEInvoice(request, requestId)).rejects.toMatchObject({
      status: 502,
      code: 'compliance_provider_response_invalid',
    });
  });

  it('aborts the entire upstream exchange at the configured deadline', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }));
      const timed = new GenericHttpsIndiaComplianceProvider({
        baseUrl: 'https://adapter.example.test/india/',
        bearerToken: 'test-bearer-token-long-enough',
        attestationKey: key,
        attestationKeyId: keyId,
        timeoutMs: 500,
        fetchImpl,
      }).submitEInvoice(request, requestId);
      const assertion = expect(timed).rejects.toMatchObject({ status: 504, code: 'compliance_provider_timeout' });
      await vi.advanceTimersByTimeAsync(501);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
