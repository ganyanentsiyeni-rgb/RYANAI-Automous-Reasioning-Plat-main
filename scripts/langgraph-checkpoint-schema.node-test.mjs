import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const historicalPath = resolve(root, 'supabase/migrations/20261119001000_langgraph_checkpoint_schema.sql');
const forwardPath = resolve(root, 'supabase/migrations/20261119170000_langgraph_checkpoint_writes_six_column_pk.sql');

test('fresh stacks apply the historical schema then the guarded six-column forward repair', async () => {
  const historical = await readFile(historicalPath, 'utf8');
  const forward = await readFile(forwardPath, 'utf8');
  assert.match(historical, /PRIMARY KEY\s*\(thread_id, checkpoint_ns, checkpoint_id, task_id, idx\)/i);
  assert.match(forward, /expected_legacy_columns[\s\S]*?expected_columns/i);
  assert.match(forward, /current_pk_columns = expected_columns/i);
  assert.match(forward, /current_pk_columns IS DISTINCT FROM expected_legacy_columns/i);
  assert.match(forward, /GROUP BY thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel[\s\S]*?HAVING count\(\*\) > 1/i);
  assert.match(forward, /ADD CONSTRAINT checkpoint_writes_pkey\s+PRIMARY KEY\s*\(thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel\)/i);
  assert.doesNotMatch(forward, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});
