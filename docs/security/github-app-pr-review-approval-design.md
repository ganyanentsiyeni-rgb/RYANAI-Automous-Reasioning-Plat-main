# RyanAI Comms — GitHub App PR review approval design

## Status

Preparation only. This document does not enable the GitHub App, create credentials, change runtime configuration, submit a review, or deploy anything.

## Canonical target

- Repository: `ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main`
- GitHub App: `RyanAI Comms GitHub Approvals`
- App ID: `5864885`
- Installation ID: `182512094`
- Expected installation permissions: repository Metadata (read) and Pull requests (read/write).
- Repository selection: only the canonical repository.
- Installation state at preparation time: suspended by the owner.

## Required execution sequence

1. Accept only a Comms approval event that has passed the existing Twilio signature verification and owner-destination verification. The event must be bound to the configured owner identity; do not accept an agent-supplied owner ID, phone number, repository, PR number, or SHA as authority.
2. Resolve a pending approval record created by RyanAI. Require a one-time approval identifier, an unexpired pending state, and an explicit owner decision of APPROVE. Reject replay, expired, already-decided, or mismatched requests.
3. Use GitHub App authentication (App JWT signed with the App private key) to request a short-lived installation access token for installation `182512094`. Never use the user's OAuth token or the separate ChatGPT GitHub connector token for this purpose.
4. Hard-bind every operation to the canonical repository. Do not accept arbitrary repository names or installation IDs from inbound messages.
5. Fetch the pull request from GitHub immediately before review submission. Require that it is open, belongs to the canonical repository, and that its current head SHA exactly equals the SHA recorded in the pending approval and explicitly confirmed by the owner.
6. Submit a GitHub pull-request review with event `APPROVE` and `commit_id` set to that exact head SHA. Do not submit if the head moved, the PR closed, the installation is suspended, permissions are insufficient, or any provider request fails.
7. Persist an idempotency/result record so retries cannot create duplicate approvals. Record the GitHub review ID, submitted commit SHA, PR number, owner identity, approval event ID, and timestamp; never store access tokens or private-key material in the audit record.
8. Return a truthful result to Comms. Distinguish submitted, rejected, stale-head, unavailable, and configuration-blocked outcomes. A queued or failed provider request is never reported as approved.

## Security and operational boundaries

- Fail closed on missing/malformed App ID, installation ID, private key, owner identity, pending approval, exact head SHA, or repository mismatch.
- Store the App private key only in the hosting provider's encrypted secret store after the owner explicitly authorizes credential provisioning. Never paste it into chat, source files, logs, PR descriptions, or test fixtures.
- Keep the GitHub App installation suspended until the backend implementation and tests are reviewed and the owner explicitly authorizes activation.
- No production environment changes, database migrations, deployments, paid upgrades, or live Comms messages are part of this change.
- Do not auto-merge the pull request being reviewed. A review approval is not a merge authorization.

## Implementation checklist

- [ ] Add isolated GitHub App JWT and installation-token client with bounded timeouts and strict response validation.
- [ ] Add read-only PR/head verification against the fixed repository.
- [ ] Add an approval-only review submission function that requires the exact current head SHA.
- [ ] Connect the function to the already-verified inbound Comms owner approval path; do not create a parallel unverified approval path.
- [ ] Add tests for wrong repository, wrong installation, suspended/unauthorized installation, closed PR, stale SHA, missing owner identity, expired/replayed approval, GitHub API errors, and successful exact-SHA review submission using mocked HTTP.
- [ ] Add audit/idempotency persistence using an existing schema only if its semantics fit; otherwise propose a separate migration for review, never apply it without separate approval.
- [ ] Verify CI/security results on the exact PR head and require independent human review before merge.

## Existing integration boundary

The current `src/server/githubAppOAuth.ts` and `src/server/routes/githubIntegration.ts` implement a user OAuth connection and read-only repository/workflow inspection. They are not the GitHub App installation-token flow and must not be repurposed by treating an OAuth user token as an App installation token. Existing Comms owner verification in `src/server/comms/authorization.ts` is the required inbound authorization boundary.
