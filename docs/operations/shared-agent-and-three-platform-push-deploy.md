# Shared PA, Darkside Copilot, Comms, and three-platform release contract

**Status:** implementation contract; no deployment is authorized by this document alone.

## Shared agent control plane

PA Agent, Darkside Copilot, and the Admin Console use the same PA delegation component and capability vocabulary. The UI is a shared operator surface, not an authorization boundary. Every operation remains owner-scoped and is checked by the server and Gen-X at proposal and execution time.

The shared surface includes internal Comms task creation. A PA-to-Comms handoff creates a durable child task directly from the PA objective; it does not require an existing Comms conversation. The task is idempotent, linked to its parent delegation, and internal-only. It does not send WhatsApp, SMS, voice, or email and cannot claim provider delivery.

## Push Deploy contract

The release workflow is manually dispatched with the explicit \`PUSH DEPLOY\` input and an exact 40-character commit SHA. Before any provider job starts, it:

1. Runs the reusable CI/CD validation workflow against that exact SHA.
2. Confirms the requested SHA is still the current \`main\` commit.
3. Requires every named CI and security check to be completed successfully on that SHA. Missing, queued, skipped, cancelled, neutral, stale, provider-blocked, or failed checks block release.
4. Uses the exact checked-out SHA for provider deployment.

After the gate passes, Render, Railway, and Vercel are independent jobs. A provider failure must not prevent the other provider jobs from being attempted. Each job records its deployment identifier or URL, provider status, source SHA, and runtime health result. The overall release is successful only when all three providers report successful deployment and health verification.

Required environment configuration is read at runtime from protected GitHub environment secrets and variables. The code does not create, expose, or rotate provider credentials. A missing provider credential, target ID, CLI version, or health URL blocks that provider job and remains visible in its result.

## Future Comms message-trigger contract

## Current implementation boundary

The current Push Deploy path is a fixed GitHub `workflow_dispatch` release workflow. PA may be governed to dispatch it only through the owner-scoped GitHub connection and Gen-X policy path. The workflow itself remains the final release gate for exact-SHA CI/security evidence and provider execution.

The tagged Comms trigger described below is **not** implemented merely by documenting the tags. Until its authenticated event adapter exists and is verified, a tagged message must not be treated as a deployment command. The durable Comms child task can report a release request/result without becoming an outbound provider sender.



A future Comms trigger may route messages tagged with \`@RyanAI\`, \`@PA Agents\`, \`@Comms\`, \`@Security\`, \`@updates\`, and \`@self-patches\` into the release coordinator. These tags are routing metadata, not permissions. The message must also contain the explicit \`PUSH DEPLOY\` command and resolve to an exact current-main SHA. The release gate above remains mandatory.

The Comms event handler must be authenticated, owner-scoped, idempotent by provider/message ID, and append an audit record linking the source message, PA task, commit SHA, workflow run, and each provider deployment. Duplicate webhook deliveries must not dispatch a second release. No outbound message is considered sent without a provider receipt. This event-trigger adapter is a separate implementation step; the current workflow_dispatch release path does not yet subscribe to tagged Comms conversations.

## Boundaries

- No automatic deployment merely because CI completed; the explicit Push Deploy command is required.
- No agent may bypass Gen-X, grant itself capabilities, approve its own privileged action, merge code, or mutate secrets.
- No production database migration is included in Push Deploy.
- No deployment result is inferred from another provider's result.
- Provider health is reported separately from deployment acceptance.
