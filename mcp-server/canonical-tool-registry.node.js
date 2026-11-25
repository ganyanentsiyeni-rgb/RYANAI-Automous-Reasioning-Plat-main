import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const registry = JSON.parse(readFileSync(new URL('../src/mcp/canonical-tool-registry.json', import.meta.url), 'utf8'));
const policyModule = await import('./tool-registry.js');

test('MCP runtime policy is derived from the canonical registry', () => {
  const canonicalNames = registry.tools.map((tool) => tool.name);
  assert.equal(new Set(canonicalNames).size, canonicalNames.length);

  for (const name of canonicalNames) {
    const policy = policyModule.TOOL_POLICY[name];
    assert.ok(policy, `missing policy for canonical tool ${name}`);
    assert.equal(policy.capability, registry.tools.find((tool) => tool.name === name).capability);
    assert.equal(policy.approval, registry.tools.find((tool) => tool.name === name).approval);
  }
});

test('canonical registry is the only source of runtime tool schemas', () => {
  const canonicalNames = new Set(registry.tools.map((tool) => tool.name));
  for (const name of Object.keys(policyModule.TOOL_POLICY)) {
    assert.ok(canonicalNames.has(name), `runtime policy contains non-canonical tool ${name}`);
  }
});
