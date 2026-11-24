export const TOOL_POLICY = Object.freeze({
  tool_registry: { owner: 'platform', risk: 'read-only', capability: 'mcp.registry.read', execution: 'none', approval: 'none', audit: 'required', timeoutMs: 5000, idempotency: 'safe', productionAccess: false, secretAccess: false, description: 'Read the MCP tool catalogue and current enablement state.' },
  run_project_checks: { owner: 'platform', risk: 'code-execution', capability: 'engineering.checks.execute', execution: 'local-process', approval: 'operator-allowlist', audit: 'required', timeoutMs: 600000, idempotency: 'best-effort', productionAccess: false, secretAccess: false, description: 'Run repository validation and Docker Compose configuration checks.' },
  repository_status: { owner: 'platform', risk: 'read-only', capability: 'repository.status.read', execution: 'read-only-process', approval: 'none', audit: 'required', timeoutMs: 10000, idempotency: 'safe', productionAccess: false, secretAccess: false, description: 'Read Git status and whitespace diagnostics.' },
  ryanai_stack_manifest: { owner: 'platform', risk: 'read-only', capability: 'platform.stack.read', execution: 'none', approval: 'none', audit: 'required', timeoutMs: 5000, idempotency: 'safe', productionAccess: false, secretAccess: false, description: 'Read the non-secret service stack manifest.' },
  platform_health: { owner: 'platform', risk: 'network-read', capability: 'platform.health.read', execution: 'bounded-http-read', approval: 'none', audit: 'required', timeoutMs: 5000, idempotency: 'safe', productionAccess: false, secretAccess: false, description: 'Read the configured RyanAI API health endpoint.' },
  reasoning_route: { owner: 'reasoning', risk: 'external-model-request', capability: 'reasoning.request', execution: 'approved-provider-request', approval: 'user-requested-task', audit: 'required', timeoutMs: 120000, idempotency: 'non-idempotent', productionAccess: false, secretAccess: false, description: 'Send a prompt to a configured reasoning provider.' },
  comms_policy_read: { owner: 'communications', risk: 'read-only', capability: 'communications.policy.read', execution: 'none', approval: 'none', audit: 'required', timeoutMs: 5000, idempotency: 'safe', productionAccess: false, secretAccess: false, description: 'Read channel policy; no private history or provider access.' },
  comms_draft_prepare: { owner: 'communications', risk: 'draft-only', capability: 'communications.draft.prepare', execution: 'draft-generation', approval: 'human-before-dispatch', audit: 'required', timeoutMs: 10000, idempotency: 'safe', productionAccess: false, secretAccess: false, description: 'Prepare a draft for human approval; never dispatch.' },
});

const REGISTRY_TOOL = 'tool_registry';
const ENABLED_TOOLS_ENV = 'RYANAI_MCP_ENABLED_TOOLS';

export function resolveToolRegistry(tools, env = process.env) {
  const requested = String(env[ENABLED_TOOLS_ENV] ?? '')
    .split(',').map((name) => name.trim()).filter(Boolean);
  const enabled = new Set(requested);
  const knownNames = new Set(Object.keys(TOOL_POLICY));
  const unknown = requested.filter((name) => !knownNames.has(name) || name === REGISTRY_TOOL);
  if (unknown.length) throw new Error(`Unknown or non-configurable MCP tool name(s) in ${ENABLED_TOOLS_ENV}: ${unknown.join(', ')}`);

  const availableNames = new Set(tools.map((tool) => tool.name));
  const unavailable = requested.filter((name) => !availableNames.has(name));
  if (unavailable.length) throw new Error(`Configured MCP tool(s) are not available in this runtime: ${unavailable.join(', ')}`);

  const registry = Object.entries(TOOL_POLICY).map(([name, policy]) => ({
    name, available: name === REGISTRY_TOOL || availableNames.has(name),
    ...policy,
    toolId: `ryanai.mcp.${name}`,
    version: '1.0.0',
    inputSchema: tools.find((tool) => tool.name === name)?.inputSchema ?? { type: 'object', properties: {} },
    outputContract: 'mcp-text-content',
    enabled: name === REGISTRY_TOOL || (availableNames.has(name) && enabled.has(name)),
    enablement: name === REGISTRY_TOOL ? 'always-on-read-only' : 'explicit-operator-allowlist',
  }));
  const visibleNames = new Set(registry.filter((entry) => entry.enabled).map((entry) => entry.name));
  return { registry, tools: tools.filter((tool) => visibleNames.has(tool.name)) };
}
