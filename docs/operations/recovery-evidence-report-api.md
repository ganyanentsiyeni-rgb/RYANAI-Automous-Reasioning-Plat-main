# Recovery Evidence Report API

**Endpoint:** `GET /api/admin/resilience/recovery/report`  
**Authorization:** administrator authentication (`requireAdmin`)  
**Mode:** read-only

## Current behavior

The endpoint returns a timestamped report containing:

- Backup inventory metadata plus a bounded, read-only re-download of eligible private dump objects. The report compares actual byte count and SHA-256 with manifest metadata; results are `verified`, `failed`, or `not_verified`.
- The migration directory inventory shipped with the running application build. This is expected repository state only, not the target's applied migration ledger.
- Recovery preflight status and target label, without returning database URLs or credentials.
- Acceptance criteria, all initially `not_verified` until independently evidenced.
- Safety invariants: production restore disabled, writes false, migrations not executed, and recovery target not queried.

The report intentionally returns `evidence_incomplete`. It does not claim schema compatibility, target isolation, artifact integrity, or recovery success.

## Explicit non-goals

This endpoint does not connect to the recovery target, query `_prisma_migrations`, inspect target schema, execute SQL, restore a database, or write audit/database/storage records. Its only artifact access is authenticated read-only download from the configured private backup bucket; dump bytes are hashed in memory and never returned. Verification is bounded to the first 10 listed artifacts and 256 MiB per artifact. Missing/invalid manifest evidence remains `not_verified`; download failures or digest/size mismatches are `failed`.

## Validation

Route and service tests cover administrator authorization, unauthenticated rejection, migration inventory presence, read-only safety invariants, matching and tampered bytes, missing manifest/digest evidence, download failures, and credential/content redaction.
