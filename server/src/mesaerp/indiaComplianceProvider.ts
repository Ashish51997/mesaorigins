import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, canonicalHash } from '../lib/canonical';
import { ApiError } from '../middleware/error';

export interface EInvoiceProviderAcknowledgement {
  provider: string;
  providerReference: string;
  irn: string;
  acknowledgementNumber: string;
  acknowledgementAt: string;
  signedPayload: Record<string, unknown>;
  qrData: string;
}

export interface EWayBillProviderAcknowledgement {
  provider: string;
  providerReference: string;
  eWayBillNumber: string;
  issuedAt: string;
  validUntil: string;
  signedPayload: Record<string, unknown>;
}

export interface ProviderCancellation {
  providerReference: string;
  cancelledAt: string;
  evidence: Record<string, unknown>;
}

export interface ProviderVehicleUpdate {
  providerReference: string;
  updatedAt: string;
  vehicle: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

export interface ProviderValidityExtension {
  providerReference: string;
  extendedAt: string;
  validUntil: string;
  evidence: Record<string, unknown>;
}

/**
 * Adapter boundary for an authorised IRP/GSP/ASP integration. Implementations
 * must use the supplied key as the upstream idempotency/reference key. A
 * provider-specific adapter is responsible for government/provider signature
 * validation; the generic HTTPS implementation verifies the configured
 * adapter attestation and deliberately does not label it a government claim.
 */
export interface IndiaComplianceProvider {
  submitEInvoice(request: Record<string, unknown>, idempotencyKey: string): Promise<EInvoiceProviderAcknowledgement>;
  cancelEInvoice(request: Record<string, unknown>, idempotencyKey: string): Promise<ProviderCancellation>;
  generateEWayBill(request: Record<string, unknown>, idempotencyKey: string): Promise<EWayBillProviderAcknowledgement>;
  cancelEWayBill(request: Record<string, unknown>, idempotencyKey: string): Promise<ProviderCancellation>;
  updateEWayBillVehicle(request: Record<string, unknown>, idempotencyKey: string): Promise<ProviderVehicleUpdate>;
  extendEWayBill(request: Record<string, unknown>, idempotencyKey: string): Promise<ProviderValidityExtension>;
}

type ProviderOperation =
  | 'submit_e_invoice'
  | 'cancel_e_invoice'
  | 'generate_e_way_bill'
  | 'cancel_e_way_bill'
  | 'update_e_way_bill_vehicle'
  | 'extend_e_way_bill';

type ProviderPayload<T extends ProviderOperation> =
  T extends 'submit_e_invoice' ? EInvoiceProviderAcknowledgement
    : T extends 'generate_e_way_bill' ? EWayBillProviderAcknowledgement
      : T extends 'update_e_way_bill_vehicle' ? ProviderVehicleUpdate
        : T extends 'extend_e_way_bill' ? ProviderValidityExtension
          : ProviderCancellation;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface GenericHttpsIndiaComplianceProviderOptions {
  baseUrl: string;
  bearerToken: string;
  attestationKey: Buffer;
  attestationKeyId: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

const isoTimestamp = z.string().datetime({ offset: true });
const evidence = z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, 'Evidence cannot be empty.');
const providerResultSchemas = {
  submit_e_invoice: z.object({
    provider: z.string().trim().min(1).max(100),
    providerReference: z.string().trim().min(1).max(200),
    irn: z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/),
    acknowledgementNumber: z.string().trim().min(1).max(30),
    acknowledgementAt: isoTimestamp,
    signedPayload: evidence,
    qrData: z.string().trim().min(1).max(10000),
  }).strict(),
  cancel_e_invoice: z.object({ providerReference: z.string().trim().min(1).max(200), cancelledAt: isoTimestamp, evidence }).strict(),
  generate_e_way_bill: z.object({
    provider: z.string().trim().min(1).max(100),
    providerReference: z.string().trim().min(1).max(200),
    eWayBillNumber: z.string().regex(/^[0-9]{12}$/),
    issuedAt: isoTimestamp,
    validUntil: isoTimestamp,
    signedPayload: evidence,
  }).strict().refine((value) => value.validUntil > value.issuedAt, { message: 'E-way-bill validity must end after issuance.' }),
  cancel_e_way_bill: z.object({ providerReference: z.string().trim().min(1).max(200), cancelledAt: isoTimestamp, evidence }).strict(),
  update_e_way_bill_vehicle: z.object({
    providerReference: z.string().trim().min(1).max(200),
    updatedAt: isoTimestamp,
    vehicle: z.record(z.string(), z.unknown()),
    evidence,
  }).strict(),
  extend_e_way_bill: z.object({
    providerReference: z.string().trim().min(1).max(200),
    extendedAt: isoTimestamp,
    validUntil: isoTimestamp,
    evidence,
  }).strict(),
} satisfies Record<ProviderOperation, z.ZodTypeAny>;

const responseEnvelopeSchema = z.object({
  schema: z.literal('mesaorigins.india-compliance.adapter.response.v1'),
  operation: z.enum([
    'submit_e_invoice', 'cancel_e_invoice', 'generate_e_way_bill',
    'cancel_e_way_bill', 'update_e_way_bill_vehicle', 'extend_e_way_bill',
  ]),
  requestId: z.string().min(8).max(128),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  payload: z.unknown(),
  attestation: z.object({
    algorithm: z.literal('hmac-sha256'),
    keyId: z.string().trim().min(1).max(100),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
}).strict();

function upstreamMessage(envelope: Omit<z.infer<typeof responseEnvelopeSchema>, 'attestation'>, keyId: string): string {
  return canonicalJson({ ...envelope, attestation: { algorithm: 'hmac-sha256', keyId } });
}

function attestedEvidence(
  providerEvidence: Record<string, unknown>,
  envelope: z.infer<typeof responseEnvelopeSchema>,
): Record<string, unknown> {
  return {
    providerEvidence,
    mesaDeskAdapterAttestation: {
      scheme: 'mesaorigins-generic-https-hmac-v1',
      keyId: envelope.attestation.keyId,
      signature: envelope.attestation.signature,
      operation: envelope.operation,
      requestId: envelope.requestId,
      requestHash: envelope.requestHash,
      // This proves which configured adapter produced the response. It is not
      // an IRP/GSTN/government signature and must never be represented as one.
      claim: 'configured_adapter_response',
    },
  };
}

/**
 * Production-selectable adapter for an organisation's authorised IRP/GSP/ASP
 * gateway. The gateway contract is deliberately provider-neutral. MesaOrigins
 * authenticates with a bearer token and verifies an HMAC attestation over the
 * operation, upstream idempotency identity, request hash and response payload.
 * That attestation authenticates the configured adapter only; it does not
 * assert or replace a government signature.
 */
export class GenericHttpsIndiaComplianceProvider implements IndiaComplianceProvider {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: GenericHttpsIndiaComplianceProviderOptions) {
    this.endpoint = new URL(options.baseUrl);
    if (this.endpoint.protocol !== 'https:') throw new Error('India compliance adapter base URL must use HTTPS.');
    if (options.bearerToken.trim().length < 16) throw new Error('India compliance adapter bearer token is missing or too short.');
    if (options.attestationKey.length < 32) throw new Error('India compliance adapter attestation key must be at least 32 bytes.');
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(options.attestationKeyId)) throw new Error('India compliance adapter attestation key id is invalid.');
    this.timeoutMs = Math.min(Math.max(options.timeoutMs ?? 10_000, 500), 30_000);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async invoke<T extends ProviderOperation>(
    operation: T,
    request: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ payload: ProviderPayload<T>; envelope: z.infer<typeof responseEnvelopeSchema> }> {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new ApiError(400, 'invalid_upstream_idempotency_key', 'The statutory provider requires a stable idempotency key.');
    }
    const requestHash = canonicalHash(request);
    const body = {
      schema: 'mesaorigins.india-compliance.adapter.request.v1',
      operation,
      requestId: idempotencyKey,
      requestHash,
      request,
    };
    const url = new URL(`operations/${operation}`, this.endpoint.href.endsWith('/') ? this.endpoint : new URL(`${this.endpoint.href}/`));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.bearerToken}`,
          'idempotency-key': idempotencyKey,
          'x-mesaorigins-operation': operation,
          'x-mesaorigins-request-hash': requestHash,
        },
        body: JSON.stringify(body),
      });
      text = await response.text();
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        throw new ApiError(504, 'compliance_provider_timeout', 'The India compliance provider did not respond before the configured deadline.');
      }
      throw new ApiError(502, 'compliance_provider_transport_error', 'The India compliance provider could not be reached.');
    } finally {
      clearTimeout(timer);
    }

    if (text.length > 1_000_000) throw new ApiError(502, 'compliance_provider_response_too_large', 'The India compliance provider response exceeded the one-megabyte limit.');
    if (!response.ok) {
      throw new ApiError(502, 'compliance_provider_rejected', `The India compliance provider rejected the request with HTTP ${response.status}.`);
    }
    let decoded: unknown;
    try { decoded = JSON.parse(text); } catch {
      throw new ApiError(502, 'compliance_provider_response_invalid', 'The India compliance provider returned invalid JSON.');
    }
    const parsed = responseEnvelopeSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new ApiError(502, 'compliance_provider_response_invalid', 'The India compliance provider returned an invalid response envelope.');
    }
    const envelope = parsed.data;
    if (envelope.operation !== operation || envelope.requestId !== idempotencyKey || envelope.requestHash !== requestHash) {
      throw new ApiError(502, 'compliance_provider_response_unbound', 'The India compliance provider response is not bound to this operation and request.');
    }
    if (envelope.attestation.keyId !== this.options.attestationKeyId) {
      throw new ApiError(502, 'compliance_provider_attestation_key_unknown', 'The India compliance provider used an unexpected attestation key.');
    }
    const { attestation: _attestation, ...unsigned } = envelope;
    const expected = createHmac('sha256', this.options.attestationKey)
      .update(upstreamMessage(unsigned, envelope.attestation.keyId))
      .digest();
    const supplied = Buffer.from(envelope.attestation.signature, 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ApiError(502, 'compliance_provider_attestation_invalid', 'The India compliance provider response attestation could not be verified.');
    }
    const payload = providerResultSchemas[operation].safeParse(envelope.payload);
    if (!payload.success) {
      throw new ApiError(502, 'compliance_provider_response_invalid', 'The India compliance provider returned an invalid operation payload.');
    }
    return { payload: payload.data as ProviderPayload<T>, envelope };
  }

  async submitEInvoice(request: Record<string, unknown>, idempotencyKey: string): Promise<EInvoiceProviderAcknowledgement> {
    const { payload, envelope } = await this.invoke('submit_e_invoice', request, idempotencyKey);
    return { ...payload, signedPayload: attestedEvidence(payload.signedPayload, envelope) };
  }

  async cancelEInvoice(request: Record<string, unknown>, idempotencyKey: string): Promise<ProviderCancellation> {
    const { payload, envelope } = await this.invoke('cancel_e_invoice', request, idempotencyKey);
    return { ...payload, evidence: attestedEvidence(payload.evidence, envelope) };
  }

  async generateEWayBill(request: Record<string, unknown>, idempotencyKey: string): Promise<EWayBillProviderAcknowledgement> {
    const { payload, envelope } = await this.invoke('generate_e_way_bill', request, idempotencyKey);
    return { ...payload, signedPayload: attestedEvidence(payload.signedPayload, envelope) };
  }

  async cancelEWayBill(request: Record<string, unknown>, idempotencyKey: string): Promise<ProviderCancellation> {
    const { payload, envelope } = await this.invoke('cancel_e_way_bill', request, idempotencyKey);
    return { ...payload, evidence: attestedEvidence(payload.evidence, envelope) };
  }

  async updateEWayBillVehicle(request: Record<string, unknown>, idempotencyKey: string): Promise<ProviderVehicleUpdate> {
    const { payload, envelope } = await this.invoke('update_e_way_bill_vehicle', request, idempotencyKey);
    return { ...payload, evidence: attestedEvidence(payload.evidence, envelope) };
  }

  async extendEWayBill(request: Record<string, unknown>, idempotencyKey: string): Promise<ProviderValidityExtension> {
    const { payload, envelope } = await this.invoke('extend_e_way_bill', request, idempotencyKey);
    return { ...payload, evidence: attestedEvidence(payload.evidence, envelope) };
  }
}

export function createIndiaComplianceProviderFromEnv(env: NodeJS.ProcessEnv = process.env): IndiaComplianceProvider {
  const provider = (env.MESAERP_INDIA_COMPLIANCE_PROVIDER || '').trim().toLowerCase();
  if (!provider || provider === 'unavailable') return new UnavailableIndiaComplianceProvider();
  if (provider !== 'generic_https') throw new Error(`Unsupported MESAERP_INDIA_COMPLIANCE_PROVIDER: ${provider}`);
  const baseUrl = (env.MESAERP_INDIA_COMPLIANCE_BASE_URL || '').trim();
  const bearerToken = (env.MESAERP_INDIA_COMPLIANCE_BEARER_TOKEN || '').trim();
  const keyId = (env.MESAERP_INDIA_COMPLIANCE_ATTESTATION_KEY_ID || '').trim();
  const encodedKey = (env.MESAERP_INDIA_COMPLIANCE_ATTESTATION_HMAC_KEY || '').trim();
  const attestationKey = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedKey)
    ? Buffer.from(encodedKey, 'base64')
    : Buffer.alloc(0);
  if (!baseUrl || !bearerToken || !keyId || !encodedKey || attestationKey.length < 32 || attestationKey.toString('base64') !== encodedKey) {
    throw new Error('generic_https India compliance provider requires base URL, bearer token, attestation key id and a base64 HMAC key of at least 32 bytes.');
  }
  const rawTimeout = env.MESAERP_INDIA_COMPLIANCE_TIMEOUT_MS;
  const timeoutMs = rawTimeout ? Number(rawTimeout) : undefined;
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000)) {
    throw new Error('MESAERP_INDIA_COMPLIANCE_TIMEOUT_MS must be an integer from 500 to 30000.');
  }
  return new GenericHttpsIndiaComplianceProvider({
    baseUrl,
    bearerToken,
    attestationKey,
    attestationKeyId: keyId,
    timeoutMs,
  });
}

/**
 * Safe default for local and credential-free deployments. It never fabricates
 * a government acknowledgement. External evidence import remains usable only
 * with the deployment-owned verifier HMAC key and a valid bound attestation.
 */
export class UnavailableIndiaComplianceProvider implements IndiaComplianceProvider {
  private unavailable(): never {
    throw new ApiError(503, 'compliance_provider_unavailable', 'No authorised India compliance provider is configured. Use the validated manual evidence flow or configure an adapter.');
  }

  async submitEInvoice(_request: Record<string, unknown>, _idempotencyKey: string): Promise<EInvoiceProviderAcknowledgement> { this.unavailable(); }
  async cancelEInvoice(_request: Record<string, unknown>, _idempotencyKey: string): Promise<ProviderCancellation> { this.unavailable(); }
  async generateEWayBill(_request: Record<string, unknown>, _idempotencyKey: string): Promise<EWayBillProviderAcknowledgement> { this.unavailable(); }
  async cancelEWayBill(_request: Record<string, unknown>, _idempotencyKey: string): Promise<ProviderCancellation> { this.unavailable(); }
  async updateEWayBillVehicle(_request: Record<string, unknown>, _idempotencyKey: string): Promise<ProviderVehicleUpdate> { this.unavailable(); }
  async extendEWayBill(_request: Record<string, unknown>, _idempotencyKey: string): Promise<ProviderValidityExtension> { this.unavailable(); }
}
