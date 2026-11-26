# RyanAI Recovery Evidence Report — Read-only Contract

**Status:** Evidence contract only. This document does not enable restore, migration, deletion, or production recovery.
**Scope:** Admin Resilience / Recovery. All evidence is read-only and must be attributable to a timestamp, source, and exact artifact or database identity.

## Purpose

A backup listing or a successful `pg_dump` is not proof that RyanAI can recover. The report must show what is proven, what is merely recorded, and what remains unknown. It must fail closed: missing evidence is `not_verified`, never `passed`.

## Report envelope

Every generated report must include:

- `reportId`: unique report identifier.
- `generatedAt`: UTC timestamp.
- `sourceCommit`: exact application commit when available; otherwise `unknown`.
- `sourceDatabaseLabel`: non-secret logical label only; never a connection URL.
- `recoveryTargetLabel`: separately configured logical label only.
- `mode`: always `read_only`.
- `productionRestore`: always `disabled`.
- `writesPerformed`: always `false`.
- `overallStatus`: `not_ready`, `evidence_incomplete`, or `ready_for_separately_approved_drill`.

The report must never serialize credentials, connection strings, service-role keys, raw database rows, or private object payloads.

## Evidence domains

### 1. Backup artifact integrity

Report these as separate facts:

| Evidence | Passing condition | Otherwise |
|---|---|---|
| Inventory presence | Object listing identifies both `database.dump` and a parseable manifest | `not_verified` |
| Manifest metadata | Manifest has a supported format, backup ID, timestamp, byte count and SHA-256 | `not_verified` |
| Current artifact bytes | The stored dump is downloaded through authenticated private storage and its actual byte count and SHA-256 match the manifest | `not_verified` |
| Artifact provenance | Manifest commit and creation metadata are present and attributable | `not_verified` |
| Retention | Timestamp parses and is within configured policy | `outside_policy` or `unknown` |

A checksum recorded in a manifest is metadata, not proof of the current object's contents. The inventory endpoint currently reads manifest metadata but does not re-download and re-hash existing dumps. The backup creation path does perform an immediate read-back comparison after upload; that historical upload check must not be represented as a fresh verification of the artifact today.

Do not mark an artifact verified merely because it is listed, has a manifest, has a SHA-256 string, or was verified at upload time. A failed or unavailable read-back must remain visible as `failed` or `not_verified`.

### 2. Schema and migration compatibility

A migration ledger is evidence of migration records, not proof that the restored database has the expected schema or that every migration is compatible with the application build.

The report must collect, read-only:

- The target's applied migration identifiers and their success/finished state from `_prisma_migrations`.
- The repository migration identifiers expected by the exact source commit.
- Missing, failed, rolled-back, duplicate, or unknown migration records.
- Presence and required columns of the tables declared in `database.yml`, including the primary runtime tables and checkpoint tables.
- A schema compatibility result tied to the exact source commit and target identity.

Schema compatibility is `not_verified` if the target cannot be queried, the migration ledger is absent/unreadable, expected migrations cannot be resolved from the source commit, required tables/columns are missing, or the comparison is incomplete. Do not run `prisma migrate deploy`, `db push`, DDL, or repair SQL as part of report generation.

### 3. Recovery target isolation and identity

Report the configured target label and the result of source/target identity checks without exposing either URL.

Required evidence before a drill can be considered eligible:

- Valid PostgreSQL target URL syntax.
- Source and target endpoint comparison including normalized hostname, effective port and database name.
- Independent proof that the target is a separately provisioned database, not merely a different URL string.
- Network/access isolation evidence showing the target cannot write to production.
- Confirmation that the target is non-production and explicitly designated for recovery testing.

Different hostnames or database names alone are not independent proof of isolation. If independent identity or network evidence is unavailable, report `identity_unverified`. Exact source/target identity must be blocked. Invalid or missing configuration must fail closed.

### 4. Recovery acceptance criteria

A drill must not be marked successful until an independently authorized, isolated drill has produced evidence for all of the following:

- Artifact checksum and byte count verified against the stored bytes.
- Restore completed only on the isolated non-production target.
- Migration ledger and required schema validated against the exact application commit.
- Authentication identity mapping and row-level security behavior checked.
- Critical RyanAI workflows and durable event/AgentRun continuity checked.
- Data integrity checks completed, with exceptions recorded.
- Achieved recovery point objective (RPO) and recovery time objective (RTO) measured.
- Operator, approval, target identity, start/end timestamps, outcome, and immutable audit receipt recorded.
- Rollback/disposal procedure for the isolated target documented.

A database connection, `SELECT 1`, HTTP `/health` response, successful dump, or successful process startup is not recovery acceptance evidence.

## Status rules

- `verified`: the named check ran successfully and has attributable evidence.
- `not_verified`: evidence is missing, stale, incomplete, or has not been independently checked.
- `failed`: a performed check failed.
- `blocked`: a safety rule prevents proceeding, such as source/target identity match.
- `not_configured`: required configuration is absent.
- `unknown`: the source cannot establish the fact.

The overall report may be `ready_for_separately_approved_drill` only when artifact integrity, schema/migration compatibility, target identity/isolation, and every drill prerequisite are independently verified. This status is not authorization to run a drill. A separate human approval and explicit non-production target selection remain mandatory.

## Safety invariants

- Report generation is read-only.
- `productionRestore` remains `disabled`.
- `writesPerformed` remains `false`.
- No restore, migration, DDL, object deletion, provider mutation, secret change, or deployment is initiated.
- No missing evidence is inferred from a healthy process or a configured environment variable.
- CI/security results must be checked against the exact PR head SHA; provider rate limits, skipped checks, queued checks, or missing checks are not passes.

## Current implementation gaps to preserve honestly

- Backup creation performs an immediate uploaded-object read-back comparison.
- Existing backup inventory reads manifest metadata and object listing; it does not currently re-hash stored dump bytes on each inventory read.
- Recovery preflight is a configuration/URL safety check, not a database identity proof or restore test.
- No isolated restore execution or recovery acceptance workflow is enabled.
- Schema/migration compatibility must remain `not_verified` until the read-only target comparison described above exists and has been exercised.

This contract is documentation for the next implementation increment. It does not claim that the report API or any recovery drill is already operational.
