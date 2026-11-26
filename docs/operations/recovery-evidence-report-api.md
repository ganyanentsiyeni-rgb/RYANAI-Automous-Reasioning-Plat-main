# Recovery Evidence Report API

**Endpoint:** `GET /api/admin/resilience/recovery/report`  
**Authorization:** administrator authentication (`requireAdmin`)  
**Mode:** read-only

## Current behavior

The endpoint returns a timestamped report containing:

- Backup inventory metadata, while explicitly marking each existing artifact `not_verified` because inventory does not re-download and hash the stored dump bytes.
- The migration directory inventory shipped with the running application build. This is expected repository state only, not the target's applied migration ledger.
- Recovery preflight status and target label, without returning database URLs or credentials.
- Acceptance criteria, all initially `not_verified` until independently evidenced.
- Safety invariants: production restore disabled, writes false, migrations not executed, and recovery target not queried.

The report intentionally returns `evidence_incomplete`. It does not claim schema compatibility, target isolation, artifact integrity, or recovery success.

## Explicit non-goals

This endpoint does not connect to the recovery target, query `_prisma_migrations`, inspect target schema, download backup artifacts, execute SQL, restore a database, or write audit/database/storage records. Those require separate, reviewed increments and explicit authorization.

## Validation

Route tests cover administrator authorization, unauthenticated rejection, migration inventory presence, read-only safety invariants, and the distinction between recorded SHA-256 metadata and fresh artifact-byte verification.
