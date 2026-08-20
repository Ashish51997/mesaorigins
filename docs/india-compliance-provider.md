# India compliance provider adapter

MesaERP is safe-by-default: without explicit configuration, provider-backed
e-invoice and e-way-bill operations return `compliance_provider_unavailable`.
The externally verified evidence workflows remain separate.

## Production environment contract

Select the provider with:

- `MESAERP_INDIA_COMPLIANCE_PROVIDER=generic_https`
- `MESAERP_INDIA_COMPLIANCE_BASE_URL=https://.../` — HTTPS only
- `MESAERP_INDIA_COMPLIANCE_BEARER_TOKEN` — adapter authentication credential
- `MESAERP_INDIA_COMPLIANCE_ATTESTATION_KEY_ID` — active adapter HMAC key id
- `MESAERP_INDIA_COMPLIANCE_ATTESTATION_HMAC_KEY` — base64 key, at least 32 bytes
- `MESAERP_INDIA_COMPLIANCE_TIMEOUT_MS` — optional integer from 500 to 30000; default 10000

Secrets must come from the deployment secret store. The base URL and key id may
be ordinary environment configuration. Do not put credentials in repository
files.

## Generic HTTPS protocol

MesaOrigins sends `POST operations/{operation}` under the configured base URL with
Bearer authentication, `Idempotency-Key`, `X-MesaOrigins-Operation` and
`X-MesaOrigins-Request-Hash`. The JSON request schema is
`mesaorigins.india-compliance.adapter.request.v1` and carries the same operation,
request id, canonical SHA-256 request hash and request object.

The adapter must return
`mesaorigins.india-compliance.adapter.response.v1` with the identical operation,
request id and request hash, a schema-valid operation payload, and:

```json
{
  "attestation": {
    "algorithm": "hmac-sha256",
    "keyId": "configured-key-id",
    "signature": "lowercase-hex-hmac"
  }
}
```

The HMAC input is canonical JSON for the response without `attestation`, plus
`attestation: { algorithm: "hmac-sha256", keyId }`. MesaOrigins verifies this in
constant time before accepting the payload and stores the attestation alongside
the provider evidence.

This HMAC proves that the configured adapter produced a response bound to the
specific operation and request. It is **adapter attestation, not a government,
GSTN or IRP digital signature**. Provider onboarding, live credentials,
government-signature validation inside the authorised adapter, certification
evidence and statutory practitioner approval remain deployment responsibilities.
