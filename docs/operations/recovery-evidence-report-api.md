# Recovery Evidence Report API

**Endpoint:** `GET /api/admin/resilience/recovery/report`  
**Authorization:** administrator authentication (`requireAdmin`)  
**Mode:** read-only

## Current behavior

The endpoint returns a timestamped report containing:

- Backup inventory metadata plus a bounded, read-only re-download of eligible private dump objects. The report compares actual byte count and SHA-256 with manifest metadata; results are `verified`, `failed`, or `not_verified`.
- The migration directory inventory shipped with the running application build. This is expected repository state only, not the target's applied migration ledger.
- Backup inventory metadata plus a bounded read-only re-download of eligible private dump objects. Actual byte count and SHA-256 are compared with manifest metadata; results are `verified`, `failed`, or `not_verified`.
- A read-only fingerprint of `prisma/schema.prisma` and every ordered migration SQL file shipped with the running build. Missing/empty files, duplicate IDs, or invalid ordering fail the source-artifact check. This does not establish that a database applied the migrations.
- Recovery preflight status and target label, without returning database URLs or credentials.
- Acceptance criteria, all initially `not_verified` until independently evidenced.
- Safety invariants: production restore disabled, writes false, migrations not executed, and recovery target not queried.

The report intentionally returns `evidence_incomplete`. It does not claim schema compatibility, target isolation, artifact integrity, or recovery success.

## Explicit non-goals

This endpoint does not connect to the recovery target, query `_prisma_migrations`, inspect target schema, execute SQL, restore a database, or write audit/database/storage records. Its only artifact access is authenticated read-only download from the configured private backup bucket; dump bytes are hashed in memory and never returned. Verification is bounded to the first 10 listed artifacts and 256 MiB per artifact. Missing/invalid manifest evidence remains `not_verified`; download failures or digest/size mismatches are `failed`.

## Validation

Route and service tests cover administrator authorization, unauthenticated rejection, migration inventory presence, read-only safety invariants, matching and tampered bytes, missing manifest/digest evidence, download failures, and credential/content redaction.
This endpoint does not connect to the recovery target, query `_prisma_migrations`, inspect target schema, execute SQL, restore a database, or write audit/database/storage records.

Schema/migration evidence covers repository file presence, migration identifier uniqueness/order, byte counts, and SHA-256 fingerprints. A separate offline migration dependency audit now tokenizes PostgreSQL statements and checks a deliberately limited subset of `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, and foreign-key ordering. Dollar-quoted procedural statements are retained as unsupported evidence rather than causing surrounding statements to be discarded. Explicitly schema-qualified prerequisites that are not created in the inspected migration chain remain `external_dependency_not_verified`. This scanner is not a complete PostgreSQL parser, does not compare the Prisma model graph with the complete SQL migration history, and does not establish which migrations a database has applied. Target database compatibility remains `not_verified`.

The repository's `npm run db:validate` command runs Prisma's schema validator against placeholder connection URLs; it does not connect to a database or validate migration SQL semantics. Do not substitute `db:status`, `test:migration:audit`, or the structural database audit for this offline check: those workflows require a configured database connection and are outside this report's no-target-connection boundary.

The endpoint's only external artifact access is an authenticated read-only download from the configured private bucket; dump bytes are hashed in memory and never returned. Verification is bounded to 10 artifacts and 256 MiB per artifact. Missing manifest evidence stays `not_verified`; download failures or byte/digest mismatches are `failed`.

## Validation

Route and service tests cover authorization, read-only invariants, matching/tampered bytes, missing evidence, download failures, credential redaction, and schema/migration source completeness and ordering. Runtime test results must be recorded separately; source changes alone are not test evidence.
