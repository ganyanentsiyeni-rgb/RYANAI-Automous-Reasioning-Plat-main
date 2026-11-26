# Recovery Evidence Report API

**Endpoint:** `GET /api/admin/resilience/recovery/report`  
**Authorization:** administrator authentication (`requireAdmin`)  
**Mode:** read-only

## Current behavior

The endpoint returns a timestamped report containing:

- Backup inventory metadata plus a bounded read-only re-download of eligible private dump objects. Actual byte count and SHA-256 are compared with manifest metadata; results are `verified`, `failed`, or `not_verified`.
- The migration directory inventory shipped with the running application build. This is expected repository state only, not the target's applied migration ledger.
- Recovery preflight status and target label, without returning database URLs or credentials.
- Acceptance criteria, all initially `not_verified` until independently evidenced.
- Safety invariants: production restore disabled, writes false, migrations not executed, and recovery target not queried.

The report intentionally returns `evidence_incomplete`. It does not claim schema compatibility, target isolation, artifact integrity, or recovery success.

## Explicit non-goals

This endpoint does not connect to the recovery target, query `_prisma_migrations`, inspect target schema, execute SQL, restore a database, or write audit/database/storage records. Its only artifact access is authenticated read-only download from the configured private bucket; dump bytes are hashed in memory and never returned. Verification is bounded to 10 artifacts and 256 MiB per artifact. Missing manifest evidence stays `not_verified`; download failures or byte/digest mismatches are `failed`.

## Validation

Route and service tests cover authorization, read-only invariants, matching/tampered bytes, missing evidence, download failures, and credential redaction.
