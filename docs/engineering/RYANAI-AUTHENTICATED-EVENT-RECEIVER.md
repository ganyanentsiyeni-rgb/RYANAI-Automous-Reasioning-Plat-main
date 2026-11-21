# RyanAI authenticated event receiver

The RyanAI API exposes `POST /api/internal/ryanai/events` for signed, metadata-only events delivered to the PA observer.

## Authentication contract

The receiver reads the already-provisioned `RYANAI_EVENT_HMAC_SECRET` at request time. It does not create, rotate, print, or modify secrets. The value must be at least 32 characters; when absent or too short the endpoint fails closed with HTTP 503.

Send these headers:

- `X-RyanAI-Timestamp`: Unix timestamp in seconds (10 decimal digits).
- `X-RyanAI-Signature`: lowercase or uppercase hex HMAC-SHA256.

The signature is computed over:

```text
HMAC_SHA256(secret, timestamp + "." + canonical_json(body))
```

Canonical JSON recursively sorts object keys, preserves array order, and uses JSON scalar encoding. Requests outside the five-minute clock-skew window are rejected. The receiver validates the event against `parseRyanAIEvent` after signature verification.

## PA boundary

Accepted events are emitted through the RyanAI-only in-process PA event bridge. The launcher forwards only the already-sanitized event to the PA observer as `ryanAIEvent` and logs identifiers/type/source, not message content or recipient data. This is observation only: no dispatch, patch execution, tool invocation, approval, or policy decision is triggered.

The receiver and bridge do not import Gen-X or Jarvis. They do not bypass or alter existing authorization boundaries elsewhere in RyanAI.

## Delivery and limitations

- HTTP 202 means the event was authenticated, schema-validated, and handed to the in-process PA observer. It is not a Comms delivery receipt and does not prove an external message was delivered.
- Duplicate event IDs are suppressed in the current process. The deduplication cache is memory-resident and is lost on restart; durable replay protection requires a separately reviewed persistent event ledger.
- No provider-specific callback is automatically converted into this event yet. An upstream RyanAI adapter must sign the event using the contract above.
- No secret value is included in this repository. The endpoint remains unavailable until the environment owner separately provisions the HMAC secret.
- No live communications, production deployment, database migration, secret changes, or paid service changes are performed by this implementation.
