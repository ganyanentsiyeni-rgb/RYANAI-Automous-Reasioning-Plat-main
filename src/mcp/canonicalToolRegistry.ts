import registry from './canonical-tool-registry.json' with { type: 'json' };

export type McpToolRisk =
  | 'read-only'
  | 'code-execution'
  | 'network-read'
  | 'external-model-request'
  | 'draft-only'
  | 'deployment';

export interface CanonicalMcpTool {
  readonly name: string;
  readonly owner: string;
  readonly risk: McpToolRisk;
  readonly capability: string;
  readonly execution: string;
  readonly approval: string;
  readonly audit: 'required';
  readonly timeoutMs: number;
  readonly idempotency: string;
  readonly productionAccess: boolean;
  readonly secretAccess: boolean;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const tools = registry.tools as CanonicalMcpTool[];

const byName = new Map(tools.map((tool) => [tool.name, tool]));

if (byName.size !== tools.length) {
  throw new Error('[mcp-registry] Duplicate tool names are not permitted.');
}

export const CANONICAL_MCP_REGISTRY_VERSION = registry.version;
export const CANONICAL_MCP_REGISTRY_ID = registry.registryId;

export function getCanonicalMcpTool(name: string): CanonicalMcpTool | null {
  return byName.get(name) ?? null;
}

export function listCanonicalMcpTools(): readonly CanonicalMcpTool[] {
  return Object.freeze(tools.map((tool) => Object.freeze({ ...tool })));
}

export function assertCanonicalMcpTool(name: string): CanonicalMcpTool {
  const tool = getCanonicalMcpTool(name);
  if (!tool) throw new Error(`Unknown canonical MCP tool: ${name}`);
  return tool;
}

/**
 * Returns a server-local view without changing the canonical policy.
 * Implementations may hide unavailable tools, but may not widen capabilities.
 */
export function createMcpToolView(availableNames: readonly string[]): readonly CanonicalMcpTool[] {
  const available = new Set(availableNames);
  return Object.freeze(tools.filter((tool) => available.has(tool.name)));
}
