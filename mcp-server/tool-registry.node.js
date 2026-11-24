import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveToolRegistry } from './tool-registry.js';

const tools = [
  { name: 'tool_registry' }, { name: 'repository_status' },
  { name: 'run_project_checks' }, { name: 'platform_health' },
  { name: 'comms_policy_read' }, { name: 'comms_draft_prepare' },
];

test('only explicitly allowlisted action tools are exposed', () => {
  const result = resolveToolRegistry(tools, { RYANAI_MCP_ENABLED_TOOLS: 'repository_status, platform_health' });
  assert.deepEqual(result.tools.map((tool) => tool.name), ['tool_registry', 'repository_status', 'platform_health']);
  assert.equal(result.registry.find((entry) => entry.name === 'run_project_checks').enabled, false);
});

test('the read-only registry remains available when no action tools are enabled', () => {
  const result = resolveToolRegistry(tools, {});
  assert.deepEqual(result.tools.map((tool) => tool.name), ['tool_registry']);
  assert.equal(result.registry.every((entry) => entry.name === 'tool_registry' || !entry.enabled), true);
});

test('unknown tool names and registry self-enablement fail closed', () => {
  assert.throws(() => resolveToolRegistry(tools, { RYANAI_MCP_ENABLED_TOOLS: 'repo_status' }), /Unknown or non-configurable MCP tool name/);
  assert.throws(() => resolveToolRegistry(tools, { RYANAI_MCP_ENABLED_TOOLS: 'tool_registry' }), /Unknown or non-configurable MCP tool name/);
});

test('tool metadata declares capability, execution, approval, audit and hard-deny boundaries', () => {
  const result = resolveToolRegistry(tools, { RYANAI_MCP_ENABLED_TOOLS: 'run_project_checks,comms_draft_prepare' });
  const checks = result.registry.find((entry) => entry.name === 'run_project_checks');
  const comms = result.registry.find((entry) => entry.name === 'comms_draft_prepare');
  assert.equal(checks.risk, 'code-execution');
  assert.equal(checks.capability, 'engineering.checks.execute');
  assert.equal(checks.approval, 'operator-allowlist');
  assert.equal(checks.audit, 'required');
  assert.equal(checks.productionAccess, false);
  assert.equal(checks.secretAccess, false);
  assert.equal(comms.approval, 'human-before-dispatch');
  assert.equal(comms.execution, 'draft-generation');
});

test('every registered tool is non-secret and cannot access production', () => {
  const result = resolveToolRegistry(tools, {});
  assert.ok(result.registry.every((entry) => entry.secretAccess === false && entry.productionAccess === false));
  assert.ok(result.registry.every((entry) => entry.audit === 'required'));
});

test('configured tools missing from this runtime fail closed', () => {
  assert.throws(() => resolveToolRegistry([{ name: 'tool_registry' }], {
    RYANAI_MCP_ENABLED_TOOLS: 'repository_status',
  }), /Configured MCP tool.*not available in this runtime/);
});

test('registry publishes stable versioned tool contracts and bounded execution metadata', () => {
  const result = resolveToolRegistry(tools, { RYANAI_MCP_ENABLED_TOOLS: 'platform_health,comms_draft_prepare' });
  const health = result.registry.find((entry) => entry.name === 'platform_health');
  const draft = result.registry.find((entry) => entry.name === 'comms_draft_prepare');
  assert.equal(health.toolId, 'ryanai.mcp.platform_health');
  assert.equal(health.version, '1.0.0');
  assert.equal(health.timeoutMs, 5000);
  assert.equal(health.idempotency, 'safe');
  assert.equal(health.outputContract, 'mcp-text-content');
  assert.deepEqual(health.inputSchema, { type: 'object', properties: {} });
  assert.equal(draft.timeoutMs, 10000);
  assert.equal(draft.idempotency, 'safe');
  assert.equal(draft.inputSchema.additionalProperties, false);
  assert.ok(result.registry.every((entry) => Number.isInteger(entry.timeoutMs) && entry.timeoutMs > 0));
  assert.ok(result.registry.every((entry) => entry.toolId.startsWith('ryanai.mcp.') && entry.version));
});
