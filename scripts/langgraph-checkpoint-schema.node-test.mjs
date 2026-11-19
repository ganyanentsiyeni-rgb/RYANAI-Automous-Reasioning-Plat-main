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



const prismaRoot = resolve(root, 'prisma');
const prismaCheckpointMigrationPath = resolve(
  prismaRoot,
  'migrations/20261119171000_align_checkpoint_writes_primary_key/migration.sql'
);
const prismaSchemaPath = resolve(prismaRoot, 'schema.prisma');

test('Prisma fresh installs have exactly one six-column checkpoint_writes primary key', async () => {
  const schema = await readFile(prismaSchemaPath, 'utf8');
  const model = schema.match(/model LangGraphCheckpointWrite \{[\s\S]*?\n\}/)?.[0] ?? '';
  const primaryKeys = [...model.matchAll(/^\s*@@id\((.*?)\)\s*$/gm)].map((match) => match[1]);
  assert.equal(primaryKeys.length, 1, 'LangGraphCheckpointWrite must declare exactly one primary key');
  assert.equal(
    primaryKeys[0].replace(/\s+/g, ''),
    '[threadId,checkpointNs,checkpointId,taskId,idx,channel]',
    'Prisma primary key must include channel in the six-column order'
  );
});

test('Prisma migration safely upgrades the historical five-column checkpoint key', async () => {
  const historical = await readFile(
    resolve(prismaRoot, 'migrations/20261101110000_communications_and_langgraph_checkpoint/migration.sql'),
    'utf8'
  );
  const forward = await readFile(prismaCheckpointMigrationPath, 'utf8');

  assert.match(historical, /PRIMARY KEY\s*\(\s*"thread_id",\s*"checkpoint_ns",\s*"checkpoint_id",\s*"task_id",\s*"idx"\s*\)/i);
  assert.match(forward, /expected_legacy_columns[\s\S]*?expected_columns/i);
  assert.match(forward, /current_pk_columns = expected_columns/i);
  assert.match(forward, /current_pk_columns IS DISTINCT FROM expected_legacy_columns/i);
  assert.match(forward, /GROUP BY thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel[\s\S]*?HAVING count\(\*\) > 1/i);
  assert.match(forward, /ADD CONSTRAINT checkpoint_writes_pkey\s+PRIMARY KEY\s*\(thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel\)/i);
  assert.doesNotMatch(forward, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});
