# Darkside Copilot: completion and operational milestones

**Programme status:** approved for focused implementation; not yet certified operational.
**Canonical repository:** `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`
**Base reviewed:** `a7d2204bb23084b9f296503c69cf0b3ca691a6fc` (main, 2026-11-08)
**Delivery rule:** separate feature branches and reviewable PRs; no auto-merge.

## Product outcome

Darkside is the single, phone-first operating surface for RyanAI. It must make it possible to start a task, understand who or what is working on it, see evidence and blockers, approve only the exact permitted action, resume the same task, and verify the result. A larger dashboard or more agent names do not count as progress.

The acceptance unit is a completed user mission with a durable record, visible execution state, verifiable output, and a safe recovery path.

## Existing foundations observed on main

These are source-level observations, not proof of production availability or end-to-end operation:

- `src/pages/DarksideCopilot.tsx` reuses the authenticated Command Center for text and realtime voice, displays a read-only Alex PA status observer, and conditionally exposes the existing PA delegation panel.
- `src/components/PADelegationPanel` is the existing Ryan-to-Alex handoff surface. PR #1271 documents authenticated, owner-scoped, approval-gated delegation and Gen-X policy checks; its documented scope is reasoning over a supplied objective, not live repository editing or arbitrary tool execution.
- `src/pages/PhoneLinkWorkspace.tsx`, `src/server/routes/phoneLink.ts`, and `android/phonelink` provide a device-pairing and scoped mobile bridge. `docs/phonelink/README.md` explicitly records remaining native integration and physical-device validation.
- `docs/COPILOT_VSCODE_SESSION_HANDOFF.md` correctly treats cross-app session transfer as capability-gated; automatic bidirectional transfer is not assumed.
- Existing preference tests cover optional Alex/delegation panels and refresh intervals. They do not prove a complete mission lifecycle.

## Milestone 1 — Darkside core completion

**Goal:** one coherent, reliable command surface rather than another collection of disconnected panels.

Deliver:
1. One shared mission/conversation identity across text, voice and supported mobile entry points.
2. A durable mission record with objective, owner, scope, plan revision, base/head references where relevant, assigned workers, dependencies, approvals, events, outputs and terminal result.
3. A mission timeline with honest states: `queued`, `running`, `waiting_for_approval`, `blocked`, `succeeded`, `failed`, `cancelled`. A configured, queued, skipped or mocked action must never appear as completed.
4. A single workforce registry that reports real provider/worker readiness and capability boundaries. No decorative or invented agent health.
5. Persistent, searchable mission history with provenance and a user-visible correction/retention path.
6. Responsive, accessible phone-first layouts, recoverable loading/error states and explicit empty states.
7. Voice and text must address the same mission; voice remains user-initiated and must respect saved voice preferences.

Acceptance gates:
- A signed-in user can create a mission, refresh or reopen the page, and see the same durable mission and event history.
- Every state transition is persisted server-side and is authorized for the owning account.
- Stale asynchronous responses cannot overwrite newer mission state.
- Failed or unavailable dependencies are visible and recoverable; no green/healthy presentation is shown without a successful probe.
- Keyboard and screen-reader labels exist for mission actions and status changes.
- Unit, route, authorization, persistence and browser-level tests cover success, failure, retry, cancellation, stale response and cross-account isolation.
- No production migration is applied by this milestone PR. Any required schema change must be a separately reviewed migration with staging evidence and separate production approval.

## Milestone 2 — Agentic workforce that completes work

**Goal:** move from proposal-only delegation to bounded, evidence-producing execution.

Deliver:
1. Ryan as task-facing orchestrator; Alex as human-facing PA coordinator; specialist workers selected from a capability registry, not hard-coded personas.
2. Explicit task decomposition into dependency-linked steps with per-step input/output contracts and budgets.
3. Parallel execution only for independent steps; deterministic aggregation and conflict handling.
4. Tool adapters with least-privilege scopes, per-tool timeouts, idempotency keys, audit events and cancellation.
5. A review/evaluation worker that checks outputs against acceptance criteria and source evidence. It cannot approve its own privileged action.
6. A resumable queue with leases, retry limits, dead-letter visibility and recovery tests.
7. Mission replay from immutable event history, with sensitive values redacted.

Acceptance gates:
- A representative mission runs end-to-end in isolated test/staging conditions and produces a durable result plus evidence.
- Duplicate delivery does not duplicate side effects; worker crashes and expired leases recover without losing or silently re-running work.
- Gen-X evaluates every requested capability and remains the policy authority; the human remains the approval authority for protected actions.
- Approval binds to the exact plan revision, requested scopes and diff/artifact hash. Any change invalidates prior approval.
- No agent can grant itself tools, widen scopes, approve its own work, merge PRs, deploy, run production migrations, rotate secrets or trigger external communications.
- Multi-model disagreement is surfaced with provenance; a Judge can compare and explain but cannot grant authority.

## Milestone 3 — PhoneLink and cross-device continuity

**Goal:** make the Android phone a reliable companion, not a surveillance or remote-control channel.

Deliver:
1. Complete native QR scanning/rendering and deep-link pairing; verify the full token exchange and revocation lifecycle.
2. A phone mission inbox with status, evidence summaries, safe approvals and resume links.
3. Native share-sheet intake and scoped file/document transfer with size/type scanning and user confirmation.
4. Foreground voice sessions and clearly disclosed background behavior; push notifications only after provider setup and opt-in.
5. Cross-device continuity based on durable mission IDs and explicit handoff records. Do not claim live Copilot session migration unless the provider exposes and confirms it.

Acceptance gates:
- Physical Android tests cover pairing, expiry, replay prevention, revocation, offline/online recovery, file permissions and token storage.
- Mobile capabilities are opt-in and revocable; no background calls, SMS, clipboard, location or microphone surveillance.
- A phone can resume the same mission after app restart without duplicating actions.
- Live voice requires a foreground user action and the separately granted capability.

## Milestone 4 — Intelligence, anticipation and knowledge-to-action

**Goal:** make RyanAI more useful through grounded context, not speculative autonomy.

Deliver:
1. Multi-brain comparison across configured NVIDIA, Qwen, Logic and Ollama paths, with model/version, prompt/config provenance, latency and cost evidence.
2. A benchmark/evaluation harness with held-out data, adversarial Gen-X tests and reproducible scoring.
3. Knowledge-to-action proposals that cite the memory, files, mission history or repository evidence behind each recommendation.
4. A daily intelligence brief and anticipation queue that are opt-in, explain why an item is suggested, and never execute protected actions.
5. Skills and MCP connector catalogue with owner-visible permissions, health, last-used state and uninstall/revoke controls.
6. Mission replay and an isolated digital-twin/test workspace for safe experiments.

Acceptance gates:
- No unsupported factual assertion is represented as verified; citations and source freshness are visible.
- Benchmarks are isolated, reproducible and disclose model/provider failures and ZAR cost.
- Proactive suggestions are dismissible and do not create work, contact people or change infrastructure without explicit authorization.
- Provider credentials are never displayed or written to logs.

## Operational definition of “genuinely works”

Darkside is not complete because a page renders, a PR merges, an agent is listed, or a workflow is configured. It is operational only when all of the following are demonstrated on an exact commit and a controlled test account:

- **Start:** create a mission from text and from an authorized voice session.
- **Persist:** reload, sign out/in, and resume the same owner-scoped mission.
- **Coordinate:** assign a bounded task to a real worker and see durable progress events.
- **Govern:** deny an out-of-scope request; request approval for a protected step; bind approval to the exact plan and artifact.
- **Execute:** complete a safe isolated task using a real permitted tool, not a mock.
- **Verify:** run the required tests/evaluation and attach exact evidence to the mission.
- **Recover:** simulate timeout, worker crash, duplicate event and stale response; recover without duplicate side effects or lost state.
- **Deliver:** show the output, provenance, limitations and next action to the user.
- **Revoke:** revoke a device/tool capability and prove subsequent access is denied.
- **Observe:** distinguish passed, failed, queued, skipped, cancelled, missing and provider-blocked checks.

## Delivery sequence and PR policy

1. Audit the current source and tests before each increment; reuse existing APIs and tables where safe.
2. Implement one vertical slice at a time: UI + API + persistence + authorization + tests + evidence.
3. Keep changes on separate feature branches and open reviewable PRs against `main`.
4. Report exact base/head SHAs and changed files. State which checks actually ran and which remain pending or blocked.
5. Do not merge automatically. Require human review and exact-head CI/security evidence.
6. No production deployment, production database migration, secret/credential changes, paid upgrades or outbound communications are included in this authorization.
7. If a feature depends on provider capability, account entitlement, hardware or a human dashboard action, label it as blocked until directly verified; do not simulate success.

## First implementation priority after this foundation

The next engineering milestone is **Mission Lifecycle Vertical Slice**: authenticated mission creation, durable mission/event persistence, owner-scoped reads, visible status timeline, bounded cancellation/retry, and tests for authorization and recovery. Only after that works end-to-end should the workforce expand from approval-gated reasoning proposals to real bounded tool execution.
