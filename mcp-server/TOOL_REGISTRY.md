# RyanAI MCP tool registry

The MCP manager exposes a read-only `tool_registry` catalogue and keeps action tools disabled unless an operator explicitly enables them.

## Enablement

Set `RYANAI_MCP_ENABLED_TOOLS` to a comma-separated list of exact tool names:

```sh
RYANAI_MCP_ENABLED_TOOLS=platform_health,repository_status
```

The registry is fail-closed:

- An unset or empty variable exposes only `tool_registry`.
- Unknown names cause MCP server startup to fail instead of silently accepting a typo.
- A configured tool that is not available in the current runtime causes startup to fail.
- `tool_registry` is always available for read-only discovery and cannot be added to the action allowlist.
- Tool metadata reports ownership, risk, availability, enablement, and the enablement mechanism.

## Current boundary

This is the first control-plane increment, not a complete enterprise gateway. The allowlist is operator-managed process configuration and applies to the MCP service as a whole. It does not yet provide per-user delegated identity, per-tool OAuth scopes, dynamic registry administration, protocol translation to arbitrary downstream services, or policy decisions through OPA. Do not treat the shared MCP bearer token as an end-user identity.

The existing HTTP transport authentication and host/origin checks remain in place. Keep the MCP listener loopback-bound unless a separately reviewed deployment configures a strong `MCP_AUTH_TOKEN` and a narrow `MCP_ALLOWED_HOSTS` allowlist.

## Validation

Run `npm --prefix mcp-server run check`. The check includes unit tests for default-deny behavior, explicit allowlisting, unknown names, unavailable tools, and registry metadata.

## Communications contracts

The following tools are disabled by default and require explicit operator allowlisting:

```sh
RYANAI_MCP_ENABLED_TOOLS=comms_policy_read,comms_draft_prepare
MCP_AUTH_TOKEN=<at-least-32-character-random-secret>
```

- `comms_policy_read`: channel policy only; no private history, contacts or provider access.
- `comms_draft_prepare`: validated draft only; always reports `approvalRequired=true` and `dispatchPerformed=false`.
- Enabling either tool requires `MCP_AUTH_TOKEN` to contain at least 32 characters. Streamable HTTP checks the bearer token with constant-time comparison.
- The shared bearer token authenticates the MCP client/service, not a human end-user. These tools must not be used for delegated private-history access or provider dispatch.
- Stdio access is a trusted local-process boundary; protect it with OS permissions.


## Canonical tool contract metadata

Each registry entry now exposes a stable `toolId` (`ryanai.mcp.<tool-name>`), contract `version`, the runtime's actual `inputSchema`, an `outputContract` identifier, a bounded `timeoutMs`, and an `idempotency` classification alongside its existing owner, risk, capability, execution, approval, audit and hard-deny fields.

- `safe` means repeating the operation does not create an externally visible mutation.
- `best-effort` means the operation may perform local work and callers must not assume retry safety.
- `non-idempotent` means a repeated request may repeat provider/model work; callers must not retry blindly.

The registry reports the schema from the tool actually available in the current process. An unavailable tool is never made available by metadata. These fields describe the current MCP server contract; they do not grant scopes, bypass API-issued delegation, skip execution-time Gen-X authorization, or enable a tool. The operator allowlist and delegated scope intersection remain mandatory.

`outputContract: mcp-text-content` identifies the current MCP text-content response envelope; it is not a promise that every tool returns the same business payload.
