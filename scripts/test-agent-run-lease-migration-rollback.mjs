#!/usr/bin/env node
/**
 * Transactional rollback rehearsal for the AgentRun lease migration.
 * Executes inverse DDL in a transaction, checks the intermediate schema, then
 * rolls back so both the migration result and Prisma ledger remain intact.
 */
import assert from 'node:assert/strict';
import { Pool } from 'pg';

if (process.env.RYANAI_DISPOSABLE_DB !== '1') throw new Error('Set RYANAI_DISPOSABLE_DB=1 only for disposable PostgreSQL.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must target a local disposable PostgreSQL database.');
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('Refusing rollback rehearsal: host must be localhost.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function contract(client) {
  const cols = await client.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND (table_name,column_name) IN (
      ('agent_runs','lease_expires_at'),('agent_runs','heartbeat_at'),('coding_tasks','heartbeat_at')
    )
  `);
  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes WHERE schemaname='public'
      AND indexname = ANY($1::text[])
  `, [['agent_runs_status_next_attempt_lease_idx','agent_runs_worker_lease_idx','coding_tasks_status_lease_expiry_idx']]);
  return {
    columns: new Set(cols.rows.map(x => x.table_name + '.' + x.column_name)),
    indexes: new Set(indexes.rows.map(x => x.indexname)),
  };
}
try {
  const db = await pool.query('SELECT current_database() AS name');
  assert.match(db.rows[0].name, /^ryanai_disposable_/i, 'database name must identify a disposable database');
  const before = await contract(pool);
  for (const name of ['agent_runs.lease_expires_at','agent_runs.heartbeat_at','coding_tasks.heartbeat_at']) assert.ok(before.columns.has(name), name+' must exist');
  for (const name of ['agent_runs_status_next_attempt_lease_idx','agent_runs_worker_lease_idx','coding_tasks_status_lease_expiry_idx']) assert.ok(before.indexes.has(name), name+' must exist');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP INDEX public.agent_runs_status_next_attempt_lease_idx');
    await client.query('DROP INDEX public.agent_runs_worker_lease_idx');
    await client.query('ALTER TABLE public.agent_runs DROP COLUMN lease_expires_at, DROP COLUMN heartbeat_at');
    await client.query('ALTER TABLE public.coding_tasks DROP COLUMN heartbeat_at');
    const inside = await contract(client);
    assert.equal(inside.columns.size, 0, 'inverse DDL must remove the three introduced columns');
    assert.deepEqual([...inside.indexes], ['coding_tasks_status_lease_expiry_idx'],
      'CodingTask lease index predates this migration and must remain intact');
    await client.query('ROLLBACK');
  } finally { client.release(); }

  const after = await contract(pool);
  assert.deepEqual([...after.columns].sort(), [...before.columns].sort(), 'rollback must restore all lease columns');
  assert.deepEqual([...after.indexes].sort(), [...before.indexes].sort(), 'rollback must restore AgentRun indexes and preserve CodingTask index');
  const ledger = await pool.query(`
    SELECT finished_at FROM public._prisma_migrations
    WHERE migration_name='20261121120000_agent_run_lease_heartbeat'
  `);
  assert.equal(ledger.rowCount, 1, 'Prisma migration ledger entry must remain present');
  assert.ok(ledger.rows[0].finished_at, 'migration must remain recorded as applied');
  console.log('PASS: inverse AgentRun lease DDL rolled back; CodingTask prior index and Prisma ledger preserved.');
} finally { await pool.end(); }
