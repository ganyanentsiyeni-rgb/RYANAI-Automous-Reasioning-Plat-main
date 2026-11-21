# RyanAI database schema reconciliation — design draft

**Status:** Draft for owner review; not approved for implementation.  
**EGM independent review:** Blocked — fresh Goldfish subagent contexts are unavailable in the connected environment. No independent review is claimed.  
**Scope:** Reconcile schema ownership and drift across Prisma migrations, Supabase migrations, disposable CI databases and the deployed PostgreSQL contract. This document authorizes no migration or deployment.

## Problem statement

RyanAI currently has two migration histories that touch the same PostgreSQL platform: Prisma migrations for application-owned models, and Supabase SQL migrations for Supabase-integrated tables, grants and RLS policies. The histories must be reconciled against the actual database catalog before further schema changes are written.

Earlier migration-validation evidence identified unresolved differences involving:
- `studio_worker_heartbeats`: an expected index difference and Studio ownership/foreign-key drift.
- Quant paper-trading tables: foreign-key/schema differences between Prisma models and migration-created tables.
- Community Survey tables: created by a Supabase migration but inserted into by the API through Prisma raw SQL. The API's effective database role and grants must be verified.
- The Community Survey migration revokes table privileges from `PUBLIC`, `anon` and `authenticated`; successful API insertion therefore depends on the actual role used by the API connection.

The latest main-branch database validation run observed at drafting time is queued, not passed: run `42517240464` on main SHA `d061fa8376fb80451b6ae4c1c8d66d68a91a363c`. No current production catalog was queried.

## Design goals

1. Establish one explicit migration owner for every application table, index, constraint, policy and grant.
2. Ensure a clean database can be created from checked-in migration history in deterministic order.
3. Ensure Prisma's expected schema and the resulting PostgreSQL catalog agree for Prisma-owned objects.
4. Preserve Supabase RLS, role grants and Supabase-managed object semantics.
5. Keep account-owned Quant data private and retain virtual-paper-only execution boundaries.
6. Keep anonymous survey answers separate from consented Beta contact details.
7. Prevent schema repair from weakening constraints, privacy, ownership checks or CI validation.
8. Make every proposed change reviewable and independently testable before production approval.

## Proposed ownership contract

### Prisma-owned objects
Prisma migrations own application tables represented in `prisma/schema.prisma`, including their foreign keys, indexes, uniqueness constraints and column types.

### Supabase-owned objects
Supabase migrations own Supabase-specific policies, grants, RLS configuration, and tables deliberately excluded from Prisma's model contract. If the API accesses a Supabase-owned table through Prisma raw SQL, the migration must document the required database role and grants explicitly.

### Shared or ambiguous objects
No object may be changed by both migration systems without a documented ownership decision and deterministic ordering. The owner must decide whether each ambiguous table is Prisma-owned, Supabase-owned, or shared through a documented and testable boundary.

Do not solve drift by deleting an index, removing a foreign key, disabling schema validation, or broadening grants merely to make a check green.

## Reconciliation plan

1. **Inventory:** Extract tables, columns, types, defaults, indexes, constraints, foreign keys, RLS flags and grants from a disposable PostgreSQL instance. Target-environment catalog access requires separate approval.
2. **Migration provenance:** Map every object to the migration that creates or alters it. Identify duplicate ownership, missing migration records and ordering assumptions.
3. **Prisma comparison:** Run Prisma schema diff against a database rebuilt from the complete migration history. Separate expected Supabase-only differences from genuine Prisma drift.
4. **Domain review:** Resolve Studio worker ownership and heartbeat indexing; resolve Quant account/user foreign keys; verify survey API role privileges and privacy separation.
5. **Design decision:** Record the chosen owner, exact DDL, compatibility implications and forward migration strategy for every discrepancy.
6. **Disposable replay:** Apply the full history to a clean ephemeral database, run schema diff, API integration tests and security/grant assertions.
7. **Human approval:** Obtain owner approval of the final design and migration PR. Production migration remains a separate authorization.
8. **Post-migration evidence:** Record exact database version, migration IDs, schema diff result, test results and catalog assertions.

## Required invariants

- Quant tables remain account-owned; users cannot read or mutate another user's paper account, orders, positions, trades or risk state.
- Quant remains historical research and virtual paper trading only; no brokerage or live trading is enabled by schema changes.
- Survey answer rows contain no respondent account ID, name or email. Beta contact details remain in a separate consent-gated table without a join key.
- Survey notification configuration does not affect whether a persisted response remains stored.
- RLS and least-privilege grants remain enabled where required. The API's service role must be verified, not assumed.
- No migration is applied to production as part of design or CI work.

## Acceptance criteria

- [ ] Every database object has one documented migration owner.
- [ ] A clean ephemeral database replays all migrations in order without manual intervention.
- [ ] Prisma schema diff reports no unexplained drift for Prisma-owned objects.
- [ ] Supabase RLS and grants match documented least-privilege expectations.
- [ ] Studio worker indexes and ownership constraints match the approved model.
- [ ] Quant foreign keys enforce the approved user/account ownership model.
- [ ] Survey API insertion works with the verified least-privilege API database role.
- [ ] Anonymous survey and separate Beta-contact privacy tests pass.
- [ ] Database validation, API regression and security checks pass on the exact PR head.
- [ ] Human review approves the migration plan before implementation.
- [ ] Production migration and deployment receive separate explicit authorization.

## Open decisions

1. Which migration system is authoritative for each existing Studio and Quant table?
2. Should `studio_worker_heartbeats` be represented in Prisma schema or explicitly remain Supabase-owned?
3. What are the intended FK targets and delete/update actions for each Quant paper table?
4. Which database role does the deployed API actually use, and does it have only the required survey insert privileges?
5. How should CI schema diff represent Supabase-only objects without suppressing real drift?
6. Which exact differences remain on current main after the latest CI fixes? The current database validation run is queued, so this is unverified.

## Evidence references

- `prisma/schema.prisma`
- `prisma/migrations/20261105182000_quant_private_table_isolation/migration.sql`
- `supabase/migrations/20261108110000_studio_worker_heartbeats.sql`
- `supabase/migrations/20261108195000_community_feedback_submissions.sql`
- `src/server/launcher.ts` — Community Survey raw SQL insert and owner notification
- Main database validation run `42517240464` (queued at draft time)
- `docs/designs/community-survey/design_draft.md`

## Authorization boundaries

This is a design proposal only. It does not authorize schema changes, production catalog access, migration execution, secret changes, deployment, paid infrastructure or relaxation of database/security checks.
