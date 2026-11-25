import canonicalRegistry from '../src/mcp/canonical-tool-registry.json' with { type: 'json' };

const REGISTRY_TOOL = 'tool_registry';
const ENABLED_TOOLS_ENV = 'RYANAI_MCP_ENABLED_TOOLS';

const canonicalTools = Object.freeze(canonicalRegistry.tools.map((tool) => Object.freeze({ ...tool })));
const canonicalByName = new Map(canonicalTools.map((tool) => [tool.name, tool]));

if (canonicalByName.size !== canonicalTools.length) {
  throw new Error('Canonical MCP registry contains duplicate tool names.');
}

export const TOOL_POLICY = Object.freeze(
  Object.fromEntries(canonicalTools.map((tool) => [
    tool.name,
    Object.freeze({
      owner: tool.owner,
      risk: tool.risk,
      capability: tool.capability,
      execution: tool.execution,
      approval: tool.approval,
      audit: tool.audit,
      timeoutMs: tool.timeoutMs,
      idempotency: tool.idempotency,
      productionAccess: tool.productionAccess,
      secretAccess: tool.secretAccess,
      description: tool.description,
    }),
  ])),
);

export function resolveToolRegistry(tools, env = process.env) {
  const requested = String(env[ENABLED_TOOLS_ENV] ?? '')
    .split(',').map((name) => name.trim()).filter(Boolean);
  const knownNames = new Set(canonicalTools.map((tool) => tool.name));
  const unknown = requested.filter((name) => !knownNames.has(name) || name === REGISTRY_TOOL);
  if (unknown.length) {
    throw new Error(`Unknown or non-configurable MCP tool name(s) in ${ENABLED_TOOLS_ENV}: ${unknown.join(', ')}`);
  }

  const availableNames = new Set(tools.map((tool) => tool.name));
  const unavailable = requested.filter((name) => !availableNames.has(name));
  if (unavailable.length) {
    throw new Error(`Configured MCP tool(s) are not available in this runtime: ${unavailable.join(', ')}`);
  }

  const registry = canonicalTools.map((tool) => ({
    ...tool,
    toolId: `ryanai.mcp.${tool.name}`,
    registryVersion: canonicalRegistry.version,
    available: tool.name === REGISTRY_TOOL || availableNames.has(tool.name),
    inputSchema: tools.find((runtimeTool) => runtimeTool.name === tool.name)?.inputSchema ?? tool.inputSchema,
    outputContract: 'mcp-text-content',
    enabled: tool.name === REGISTRY_TOOL || (availableNames.has(tool.name) && requested.includes(tool.name)),
    enablement: tool.name === REGISTRY_TOOL ? 'always-on-read-only' : 'explicit-operator-allowlist',
  }));

  const visibleNames = new Set(registry.filter((entry) => entry.enabled).map((entry) => entry.name));
  return {
    registry: Object.freeze(registry.map((entry) => Object.freeze(entry))),
    tools: tools.filter((tool) => visibleNames.has(tool.name)),
  };
}

export function getCanonicalTool(name) {
  return canonicalByName.get(name) ?? null;
}
