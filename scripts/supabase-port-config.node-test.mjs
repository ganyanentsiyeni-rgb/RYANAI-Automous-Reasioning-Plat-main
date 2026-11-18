import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');

function section(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = config.match(new RegExp('(?:^|\\n)\\[' + escaped + '\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|$)'));
  return match?.[1] ?? '';
}

test('Supabase local service ports are dynamically allocated', () => {
  for (const name of ['api', 'db', 'studio']) {
    assert.doesNotMatch(section(name), /^\\s*(?:port|shadow_port)\\s*=/m, '[' + name + '] must not pin a local port');
  }
});

test('Supabase local config does not pin auxiliary service ports', () => {
  for (const name of ['db.pooler', 'local_smtp', 'analytics', 'edge_runtime']) {
    assert.doesNotMatch(section(name), /^\\s*(?:port|shadow_port|inspector_port|smtp_port|pop3_port|vector_port)\\s*=/m, '[' + name + '] must not pin a local port');
  }
});
