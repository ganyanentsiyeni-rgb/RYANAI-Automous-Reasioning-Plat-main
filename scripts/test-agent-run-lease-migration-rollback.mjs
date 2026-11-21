#!/usr/bin/env node
/**
 * Verify that the lease migration's inverse DDL can be exercised transactionally.
 * All destructive DDL is rolled back before the test exits; migration history is retained.
 */
import assert from 'node:assert/strict';
import { Pool } from 'pg';

if (process.env.RYANAI_DISPOSABLE_DB !== '1') {
  throw new Error('Set RYANAI_DISPOSABLE_DB=1 only for a disposable PostgreSQL database.');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must target a local disposable PostgreSQL database.');
}
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
  throw new Error('Refusing rollback rehearsal: database host must be localhost.');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function readContract(client) {
  const result = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (
        ('agent_runs', 'lease_expires_at'),
        ('agent_runs', 'heartbeat_at'),
        ('coding_tasks', 'heartbeat_at')
      )
  `);
  const columns = new Set(result.rows.map((row) => row.table_name + '.' + row.column_name));
  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY($1::text[])
  `, [[
    'agent_runs_status_next_attempt_lease_idx',
    'agent_runs_worker_lease_idx',
    'coding_tasks_status_lease_expiry_idx',
  ]]);
  return { columns, indexes: new Set(indexes.rows.map((row) => row.indexname)) };
}

try {
  const identity = await pool.query('SELECT current_database() AS name');
  assert.match(identity.rows[0].name, /^ryanai_disposable_/i,
    'database name must explicitly identify a disposable test database');
  const before = await readContract(pool);
  for (const item of [
    'agent_runs.lease_expires_at', 'agent_runs.heartbeat_at', 'coding_tasks.heartbeat_at',
  ]) assert.ok(before.columns.has(item), item + ' must exist before rollback rehearsal');
  for (const item of [
    'agent_runs_status_next_attempt_lease_idx', 'agent_runs_worker_lease_idx',
    'coding_tasks_status_lease_expiry_idx',
  ]) assert.ok(before.indexes.has(item), item + ' must exist before rollback rehearsal');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP INDEX public.agent_runs_status_next_attempt_lease_idx');
    await client.query('DROP INDEX public.agent_runs_worker_lease_idx');
    await client.query('DROP INDEX public.coding_tasks_status_lease_expiry_idx');
    await client.query('ALTER TABLE public.agent_runs DROP COLUMN lease_expires_at, DROP COLUMN heartbeat_at');
    await client.query('ALTER TABLE public.coding_tasks DROP COLUMN heartbeat_at');
    const inside = await readContract(client);
    assert.equal(inside.columns.size, 0, 'inverse DDL must remove only the lease/heartbeat columns');
    assert.equal(inside.indexes.size, 0, 'inverse DDL must remove all lease indexes');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  const after = await readContract(pool);
  assert.deepEqual([...after.columns].sort(), [...before.columns].sort(),
    'transaction rollback must restore the lease/heartbeat columns');
  assert.deepEqual([...after.indexes].sort(), [...before.indexes].sort(),
    'transaction rollback must restore the lease indexes');

  const ledger = await pool.query(`
    SELECT finished_at FROM public._prisma_migrations
    WHERE migration_name = '20261121120000_agent_run_lease_heartbeat'
  `);
  assert.equal(ledger.rowCount, 1, 'Prisma migration ledger must remain intact after rollback rehearsal');
  assert.ok(ledger.rows[0].finished_at, 'lease migration must remain recorded as successfully applied');
  console.log('PASS: inverse lease DDL was executed and rolled back; schema and Prisma ledger remain consistent.');
} finally {
  await pool.end();
}
