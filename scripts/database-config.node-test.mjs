import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { getDatabaseStore, loadDatabaseManifest } from '../src/config/databaseConfig.js';

const root = resolve(process.cwd());
const manifest = loadDatabaseManifest(resolve(root, 'database.yml'));

assert.equal(manifest.version, 1);
assert.equal(manifest.environments.staging.primary.url_env, 'DATABASE_URL');
assert.equal(manifest.environments.production.primary.url_env, 'DATABASE_URL');
assert.equal(manifest.agent_runs.table, 'agent_runs');
assert.equal(manifest.agent_runs.schema, 'public');
for (const table of [
  'coding_tasks',
  'communication_conversations',
  'communication_messages',
  'checkpoints',
  'checkpoint_blobs',
  'checkpoint_writes',
  'checkpoint_migrations',
]) {
  assert.ok(manifest.environments.production.primary.required_runtime_tables.includes(table),
    `production database contract must declare runtime table: ${table}`);
  assert.ok(manifest.environments.staging.primary.required_runtime_tables.includes(table),
    `staging database contract must declare runtime table: ${table}`);
}
assert.equal(manifest.fleet_contract.expected_agents, 12);
assert.equal(manifest.fleet_contract.expected_workers, 10);
assert.equal(getDatabaseStore('production', 'cache').url_env, 'REDIS_URL');
assert.equal(getDatabaseStore('production', 'audiobook').url_env, 'AUDIOBOOK_DATABASE_URL');

console.log('database.yml contract: OK');
