# RyanAI Render Agent UI SDK Foundation

**Status:** Initial implementation foundation  
**Target:** Existing React 19 frontend delivered by Render  
**SDK:** `@ui-sdk/react` + `@ui-sdk/core`, pinned to `0.1.0-beta.13`  
**Hosting decision:** Render remains the frontend delivery platform. Vercel hosting is not part of this work.

## Why this increment

RyanAI's frontend is an existing React 19 application with Base UI already present. UI SDK adds a lower-level behavior composition layer and a component-to-agent bridge. It is not a replacement for Render, the RyanAI API, Supabase Auth, or Gen-X authorization.

## Implemented in this increment

- Adds the official React and core UI SDK packages at the same exact beta version.
- Adds `createRyanAiAgentUiBridge`, a narrow browser-side wrapper around UI SDK `createAgent`.
- Requires an application-owned approval callback for every component action marked with `data-agent-confirm`.
- Propagates the UI SDK abort signal to the approval handler.
- Refuses a confirmed action if approval is declined, the signal is already aborted, or the approval handler throws.
- Adds focused tests for allow, approve, decline, abort, and approval-handler failure.

## Security and integration boundaries

- The UI SDK bridge is an in-process UI capability, not an authorization service.
- Do not attach it to `window`, expose it as an unauthenticated HTTP endpoint, or let it authorize API, database, communications, deployment, secrets, trading, or GitHub mutations.
- Gen-X and the server-side authorization layer remain authoritative. Every consequential server operation must re-check identity, permissions, resource scope, policy, and any required exact-action approval.
- Components must explicitly mark consequential actions with `data-agent-confirm`; sensitive values must be marked secret/hidden according to the UI SDK guidance.
- Existing native React controls are not automatically visible to UI SDK. They must be migrated to UI SDK primitives individually, with accessible names and regression tests.
- The application approval callback is intentionally injected by the host UI. This increment does not invent a browser `confirm()` fallback.
- UI SDK is beta and its APIs may change. Keep the dependency pinned and upgrade only with a dedicated compatibility review.

## Not implemented yet

- No existing workspace controls have been converted to UI SDK primitives in this foundation commit.
- No RyanAI model/tool router is connected to `snapshot`, `query`, or `act`.
- No WebMCP registration is enabled.
- No GitHub Event Streams client or webhook receiver is added here.
- No model architecture or database platform migration is included.

## Next implementation gates

1. Add an application-owned approval surface and wire it to the bridge.
2. Convert one low-risk, read-only Operator Console component to UI SDK primitives.
3. Add an agent-bridge test proving the component appears in `snapshot()` and can be queried without mutating state.
4. Add a separate write-action test proving the approval callback can cancel the operation.
5. Expand workspace-by-workspace only after accessibility, authorization, and mobile regression tests pass.

## Delivery boundary

This is a code-only branch. It does not deploy Render, alter environment variables, change secrets, apply migrations, enable providers, or merge itself.
