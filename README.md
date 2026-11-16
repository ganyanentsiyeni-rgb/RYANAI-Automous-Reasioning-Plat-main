# RyanAI Inverted Foundation

Standalone, repository-ready architecture scaffold. It is not committed to RyanAI.

**Operating principle:** AI proposes. Gen-X authorizes. Jarvis coordinates. Tools execute.
Systems report. Evidence proves. Memory remembers. Humans retain approval authority where policy requires it.

## Modules
Ontology; Decisions and Evidence; Gen-X Authority; Agent Registry; Jarvis Execution;
Outbox/Event Fabric; Idempotency; Tombstones; Reconciliation; Operational Memory;
Model Control Plane; Security/Audit; framework-neutral API services.

## Validate
`pip install -e ".[test]" && pytest -q`
`python scripts/validate_operational_loop.py`

## Stage 6
The integration harness defaults to dry-run. Live staging mode requires `--live`,
`RYANAI_STAGE6_LIVE=1`, and `SUPABASE_DATABASE_URL`, `NEON_DATABASE_URL`, `MONGODB_URI`.
Apply `sql/stage6_staging_schema.sql` only to a dedicated staging database first.
The harness never drops/truncates records and is not approved for production use.
Before merging, reconcile this scaffold with the official repo's actual framework,
dependency versions, migrations, naming and CI.
