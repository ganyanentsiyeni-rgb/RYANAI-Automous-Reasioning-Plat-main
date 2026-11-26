# Recovery Evidence Report API

**Endpoint:** `GET /api/admin/resilience/recovery/report`  
**Authorization:** administrator authentication (`requireAdmin`)  
**Mode:** read-only

## Current behavior

The endpoint returns a timestamped report containing:

- Backup inventory metadata plus a bounded read-only re-download of eligible private dump objects. Actual byte count and SHA-256 are compared with manifest metadata; results are `verified`, `failed`, or `not_verified`.
- A read-only fingerprint of `prisma/schema.prisma` and every ordered migration SQL file shipped with the running build. Missing/empty files, duplicate IDs, or invalid ordering fail the source-artifact check. This does not establish that a database applied the migrations.
- Recovery preflight status and target label, without returning database URLs or credentials.
- Acceptance criteria, all initially `not_verified` until independently evidenced.
- Safety invariants: production restore disabled, writes false, migrations not executed, and recovery target not queried.

The report intentionally returns `evidence_incomplete`. It does not claim schema compatibility, target isolation, artifact integrity, or recovery success.

## Explicit non-goals

This endpoint does not connect to the recovery target, query `_prisma_migrations`, inspect target schema, execute SQL, restore a database, or write audit/database/storage records. Schema/migration evidence is limited to repository files and SHA-256 fingerprints; target migration application and database compatibility remain `not_verified`. Schema/migration evidence is limited to local repository files and SHA-256 fingerprints; target migration application and database compatibility remain `not_verified`. Its only artifact access is authenticated read-only download from the configured private bucket; dump bytes are hashed in memory and never returned. Verification is bounded to 10 artifacts and 256 MiB per artifact. Missing manifest evidence stays `not_verified`; download failures or byte/digest mismatches are `failed`.

## Validation

Route and service tests cover authorization, read-only invariants, matching/tampered bytes, missing evidence, download failures, credential redaction, and schema/migration source completeness and ordering.
