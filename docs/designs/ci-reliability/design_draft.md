# RyanAI CI reliability — design draft

**Status:** Draft; not owner-approved.  
**EGM independent review:** Blocked — fresh Goldfish subagent contexts are unavailable in this environment.

## Problem and evidence

RyanAI has many workflows, but the repository has not established a completed, exact-head green CI/security baseline. Queued, skipped, cancelled, or missing runs have previously been mistaken for readiness.

Evidence reviewed:
- PR #1389 head `0dc88b12d0046149d794e4b5accbb22d477d65a9`: CI/CD failed at `scripts/check-platform-wiring.mjs`; the checker rejected OperatorConsole and QuantLab JSX instances with props. Typecheck/build steps were consequently skipped.
- PR #1390 head `c24ddbdc22f35ac731c298e576a5eb7cd9db5afc`: CI/CD and AI Inspector failed on the same platform-wiring check; migration replay and database schema validation also failed.
- PR #1391 merged the checker adjustment and several regression corrections, but its exact-head runs remained queued in the last available poll.
- PR #1392 head `381c725b7fe4ae18c4f57a512dd0b78145ece5c5`: 14 runs queued, Datadog Synthetic skipped. No passing evidence established.

## Goals

1. Establish reliable, repeatable CI on the exact PR head.
2. Keep typecheck, lint, unit/integration tests, application build, server build, Docker builds, database replay/schema checks, CodeQL, Trivy, TruffleHog, Codacy and SBOM visible as separate results.
3. Distinguish passed, failed, queued, skipped, cancelled, missing and provider-blocked.
4. Prevent merge while required checks are incomplete or failed.
5. Avoid weakening tests or suppressing database drift to obtain a green result.

## Proposed design

- Use one canonical set of required check names and keep ruleset contexts synchronized with actual workflow job names.
- Ensure required checks execute for pull requests and report a terminal conclusion; avoid relying on jobs that are conditionally skipped.
- Separate independent test domains (frontend, API, Prisma/Supabase migrations, containers, security) so one early failure does not hide useful evidence.
- Add regression tests for the wiring checker itself, including JSX component props and self-closing/paired components.
- Capture run ID, workflow, exact SHA, job conclusion, relevant failing log excerpt and provider blocker in each report.
- Do not rerun failed or queued workflows unless separately authorized.

## Acceptance criteria

- [ ] Required workflows execute on the exact current PR head.
- [ ] Typecheck, lint, unit/integration tests and app/server builds complete successfully.
- [ ] Docker build and image validation complete successfully.
- [ ] Supabase migration replay and Prisma schema validation complete successfully.
- [ ] Security checks complete with findings triaged; no scanner is counted as passed when skipped or queued.
- [ ] Required check contexts match the ruleset and block merge when missing or unsuccessful.
- [ ] CI reports exact SHA and run/job IDs.
- [ ] No production deployment, production migration, secret change or paid upgrade is included.

## Open questions

- Why are many Actions runs still queued with no runner assigned? Current evidence establishes queue state, not its cause.
- Which status checks are mandatory for every PR versus only release/staging workflows?
- Which existing workflow duplicates can be consolidated without losing coverage?

## Review and approval

Goldfish review: blocked; fresh reviewer contexts not executed. Human architecture review and owner approval are still required before material CI architecture changes.
