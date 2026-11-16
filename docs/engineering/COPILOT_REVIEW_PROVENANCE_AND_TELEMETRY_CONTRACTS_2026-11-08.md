# Copilot review provenance and shared telemetry contracts

Date: 8 November 2026
Repository: `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`
Implementation base: `8ce41975d61ea28d13542cb76aa544edc6b6abc1`

## 1. Available GitHub evidence and capability boundary

The connected GitHub integration currently exposes ordinary pull-request review submissions and PR metadata. Its repository connection verifies the official repository identity and `pull: true`; it does not request or prove write/admin access. The connected GitHub tools used for this change expose review nodes, PR state, commit SHA, workflow runs and combined statuses.

The GitHub November 6, 2026 changelog confirms REST/GraphQL support for explicit Copilot review/comment attribution, review effort when available, and skill/MCP/custom-instruction source metadata. The separate November 5 usage-metrics API adds aggregate counts for comments evaluated/addressed, breakdowns by severity, review tier, comment type and customization, plus merged reviews with no later human change request. Those reports are enterprise/organization scoped and require the Copilot usage-metrics policy plus an authorized View Copilot Metrics role; they are not individual comment evidence. However, these fields are not exposed by the connected GitHub review tool schema in this session. No live Copilot attribution, effort, skills, MCP or custom-instruction source fields were returned during this audit. Treat these as unavailable until an authorized GitHub API response is retrieved and mapped by a supported adapter. Do not infer Copilot from a bot login, reviewer display name, comment wording or a configured ruleset.

The existing RyanAI GitHub App integration currently verifies repository `pull: true` only; it does not verify repository `Administration: read` or organization/enterprise administrator roles. GitHub documents repository settings reads as requiring `Administration: read`, while organization and enterprise settings APIs do not support GitHub Apps or fine-grained PATs. Therefore this PR does not read or change Copilot settings.

The repository contains a workflow payload that proposes `copilot_code_review` on pushes and draft PRs, but that file is a configuration proposal/workflow. It is not proof that the live repository ruleset is active or that Copilot reviewed any specific commit.

## 2. Normalized evidence contract

Schema: `ryanai.github-review-provenance/v1`

Required fields:
- `reviewId`: bounded provider review identifier.
- `pullRequestNumber`: positive PR number.
- `reviewedCommitSha`: full 40-character commit SHA actually reviewed.
- `submittedAt`: valid, non-future timestamp.
- `state`: approved, changes requested, commented, dismissed, pending or unknown.
- `actorKind`: human, copilot or unknown; populated only from explicit provider attribution.

Optional fields:
- `effortLevel`: provider-reported review tier, restricted to `auto`, `lite`, `balanced` or `max`; never infer it from a configured default or estimate cost.
- `commentAttributions`: bounded comment identifiers with categories only: skill, MCP, custom instructions, other. Preserve the per-comment relationship, but never store source names or comment bodies.

Never store or display review bodies, inline comment bodies, prompts, code snippets, file contents, tool arguments, raw MCP names, skill names, custom-instruction contents, OAuth tokens, email addresses, or private user identifiers. Do not persist raw provider payloads. Unknown fields are dropped.

Attribution is evidence, not authority. Copilot can never satisfy a required human approval. A human approval is eligible only when provider attribution explicitly says human, review state is `APPROVED`, and `reviewedCommitSha` equals the exact current PR head SHA. Any push changes the head binding; approvals on older SHAs do not certify the new head. Unknown attribution is not a human approval.

## 3. Merge evidence contract

A PR is not merge-ready unless all conditions are independently evidenced for the same exact head SHA:
1. Required CI checks are completed with conclusion `success`.
2. Required security checks are completed with conclusion `success`.
3. No required check is queued, pending, skipped, cancelled, missing or provider-blocked.
4. At least one independent human review is explicitly `APPROVED` and bound to the current head SHA.
5. Review threads required by policy are resolved.
6. The base branch is current under the effective repository policy.
7. No auto-merge or bypass is used.

Record the PR number, base SHA, head SHA, review ID, reviewer kind, review state, reviewed SHA, submitted timestamp, required check names, run IDs, conclusions, and unresolved blockers. Never treat merge state alone as evidence of approval or CI success.

## 4. Shared telemetry snapshot contract

Schema: `ryanai.telemetry.metric/v1`

Every snapshot carries:
- stable metric ID and human label;
- numeric value or null;
- explicit unit;
- source identity;
- observation timestamp;
- freshness: fresh, stale or unknown;
- status: available, unavailable or error;
- optional time-window bounds only when the source actually reports a window.

Missing, malformed or future timestamps are unknown. Stale data remains stale. Non-finite values become null. A single snapshot is a KPI, not a time series. Render a trend only after timestamped history is available. Never translate unavailable/unknown into healthy or zero.

Existing freshness-aware health hooks, Admin metrics and Cockpit provider snapshots remain the sources of truth. The shared card is a presentation primitive, not a new telemetry collector or storage system. The current admin metrics route intentionally reports database status as unknown; the dashboard must preserve that.

## 5. Dashboard integration

The Admin Console and Command Cockpit reuse a shared telemetry metric card for existing process, dependency and provider snapshots. The new Copilot usage-metrics aggregates are a possible future operational view, but are not connected here because the available GitHub App integration has no verified organization/enterprise metrics permission. These remain process-level observations, not deployment or dependency health. Pending approvals are sourced from their existing queue endpoints and are not given fabricated freshness timestamps.

Do not add a charting dependency or draw trend charts from current snapshots. First complete instrumentation coverage and establish timestamped history; then select chart types appropriate to the data shape.

## 6. Validation and rollout

This PR adds normalized contracts, privacy/eligibility tests and a shared snapshot card. It does not yet fetch Copilot-specific metadata because the connected integration does not expose the required endpoint/fields. The read-only GraphQL adapter and modal evidence panel are now proposed in [PR #1331](https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat/pull/1331). It uses existing repository pull-read access, maps explicit `isCopilotCodeReview`, review effort, reviewed commit SHA, and comment source kinds, and deliberately excludes review text, author login, source names and paths. Live evidence remains unavailable until the PR is independently reviewed, passes exact-head checks, is merged under governance, and the in-app GitHub connection is configured and verified.

No live ruleset, GitHub App permission, secret, database, infrastructure, telemetry exporter, production deployment or branch protection setting is changed. No tests are claimed as run by the authoring connector. Require exact-head CI/security evidence and independent human review before merge.


The GraphQL schema documents `PullRequestReview.isCopilotCodeReview`, `copilotCodeReviewEffort`, and `PullRequestReviewComment.copilotCodeReviewSources`. The REST review-list endpoint requires repository Pull requests read permission; the adapter uses the GraphQL equivalent through the already-verified user token.

## 7. Upstream references

- [GitHub Changelog: Copilot code review API management and review overview updates, 6 November 2026](https://github.blog/changelog/2026-11-06-copilot-code-review-api-management-and-review-overview-updates/)
- [GitHub Docs: Configure Copilot code review with the API](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review)
- [GitHub Docs: Using Copilot code review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-code-review)
- [GitHub GraphQL API: Pull request reviews and Copilot attribution fields](https://docs.github.com/en/graphql/reference/pulls)
- [GitHub REST API: Pull request reviews](https://docs.github.com/en/rest/pulls/reviews)
