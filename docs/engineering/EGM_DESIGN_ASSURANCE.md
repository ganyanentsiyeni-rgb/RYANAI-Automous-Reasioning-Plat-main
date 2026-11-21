# RyanAI Engineering Design Assurance — Elephant-Goldfish Model

## Decision

Adopt the Elephant-Goldfish Model (EGM) as RyanAI's pre-implementation design-assurance workflow. EGM is a design-governance layer; it does not replace GitHub Actions, automated tests, security scanners, human review, or runtime verification.

The canonical repository is `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`.

## Roles

- **Elephant:** works with the project context, requirements, current source, and prior architectural decisions to create a specification.
- **Goldfish:** fresh, independent reviewer contexts inspect the specification and referenced source without inheriting the earlier brainstorming conversation.
- **Human owner/reviewer:** resolves trade-offs, decides which findings to address, and approves the specification before implementation.

A Goldfish review is not valid merely because a document says "reviewed". The coding agent must actually execute EGM's fresh-review workflow and record its output. If fresh subagents are unavailable, the review is blocked and must be reported as such.

## Required workflow

1. **Bootstrap existing context:** run `/egm-bootstrap` on the official repository before making claims about architecture. Reconcile the generated documentation against source rather than treating generated docs as ground truth.
2. **Explore:** use `/egm-brainstorm` for a new feature or material architectural change. Record the agreed problem, goals, non-goals, constraints, and options in `concepts_brief.md`.
3. **Draft:** use `/egm-draft` to create `design_draft.md`. Review each section with the owner.
4. **Independent review:** use `/egm-review design_draft.md`. Retain the findings and identify which are fixed, accepted with rationale, or unresolved.
5. **Resolve:** use `/egm-resolve` where needed. Critical security, data-integrity, authorization, and safety findings must be resolved before implementation.
6. **Approve:** the owner approves the final specification. Save it as `approved_specification.md` under `docs/designs/<workstream>/`.
7. **Implement:** create a separate feature/repair branch and link the approved specification from the PR. Keep implementation changes aligned with the approved design; material drift requires a specification update and renewed review.
8. **Verify:** run exact-head CI, security, typecheck/build, integration and relevant deployment-contract tests. Report passed, failed, queued, skipped, cancelled, missing, and provider-blocked states distinctly.
9. **Drift review:** use `/egm-drift-report` after significant implementation changes and before release readiness reviews.

For non-software documents, configure independent standards and reviewers with `/egm-review-loop`; software-codebase bootstrap and drift reporting are not general document-review substitutes.

## Where EGM fits in CI

EGM operates before implementation and during specification maintenance. GitHub Actions remains the implementation-verification system:

- typecheck, lint, unit and integration tests;
- application and Docker builds;
- CodeQL, Trivy, TruffleHog, dependency and container scans;
- database migration replay against disposable databases;
- deployment-contract and infrastructure configuration validation.

Do not mark EGM as a passing GitHub check unless an integration can prove that the actual fresh-review process ran, identify the reviewed specification and source revision, preserve reviewer findings, and fail closed when reviewers could not run. A checked-in document or a manual "approved" label alone is not proof of an EGM review.

Until such an integration exists, EGM is a documented pre-implementation owner gate, not a fabricated CI status. This repository's CI remains authoritative for code validation.

## PR governance

Every architectural or cross-module PR must link:
- the approved specification path and revision;
- the Goldfish review record;
- dispositions for all critical/high findings;
- exact-head CI and security evidence;
- any migration or deployment implications and their separate approvals.

A PR must not be merged merely because a workflow is queued, skipped, cancelled, missing, or provider-blocked. No automatic merge. No production deployment, production database migration, secrets change, or paid infrastructure change is authorized by this design-assurance decision.

## Initial pilot

The Community Survey is the first EGM pilot. Review its backend persistence, anonymous-response boundaries, owner notification routing, delivery-failure handling, idempotency, rate limiting, and evidence of delivery. Do not infer successful mailbox delivery from SMTP acceptance. Do not apply its migrations or deploy from this PR.

## Known adoption limitation

The published EGM plugin must be installed in the developer's supported coding-agent environment, followed by a new session. Repository documentation does not itself install the plugin into ChatGPT, Codex, Claude Code, or Antigravity. Fresh subagent support must be verified in the chosen environment before claiming Goldfish review completion.
