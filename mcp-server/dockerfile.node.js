import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8');
const runtimeSources = [
  'index.js',
  'http.js',
  'provider-router.js',
  'stdio.js',
  'health-url.js',
  'tool-registry.js',
  'delegation.js',
];

test('MCP runtime image copies every local server module', () => {
  const copyLines = dockerfile.split(/\r?\n/).filter((line) => /^COPY\s/.test(line));
  for (const source of runtimeSources) {
    assert.ok(
      copyLines.some((line) => line.split(/\s+/).slice(1, -1).some((entry) => entry.endsWith('/' + source))),
      `MCP Dockerfile must copy runtime module ${source}`,
    );
  }
});


test('MCP Dockerfile copies the canonical tool registry contract', () => {
  const copyLines = dockerfile.split(/\\r?\\n/).filter((line) => /^COPY\\s/.test(line));
  assert.ok(
    copyLines.some((line) => line.includes('src/mcp/canonical-tool-registry.json') && line.includes('/app/src/mcp/canonical-tool-registry.json')),
    'MCP Dockerfile must package src/mcp/canonical-tool-registry.json',
  );
});
