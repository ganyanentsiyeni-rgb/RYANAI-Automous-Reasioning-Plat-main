#!/usr/bin/env node
/**
 * Upgrade rehearsal for 20261108080000_agent_runs_runtime_contract.
 * Destructive only inside an explicitly named, local disposable database.
 * Executes the committed migration file and exercises the worker's existing
 * three-minute lease expiry, attempt cap, cancellation and approval predicates.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

if (process.env.RYANAI_DISPOSABLE_DB !== '1') {
  throw new Error('Set RYANAI_DISPOSABLE_DB=1 only for a disposable PostgreSQL database.');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must target a local disposable PostgreSQL database.');
}
const databaseUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)) {
  throw new Error('Refusing destructive test: DATABASE_URL host must be localhost/127.0.0.1/::1.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const database = await pool.query('SELECT current_database() AS name');
if (!/^ryanai_disposable_/i.test(database.rows[0]?.name ?? '')
  && !(process.env.RYANAI_DISPOSABLE_SUPABASE === '1' && database.rows[0]?.name === 'postgres')) {
  await pool.end();
  throw new Error('Refusing destructive test: require a named disposable database or the explicit local Supabase harness marker.');
}

const migration = await readFile(
  new URL('../prisma/migrations/20261108080000_agent_runs_runtime_contract/migration.sql', import.meta.url),
  'utf8',
);
const applyMigration = () => pool.query(migration);

async function assertColumnsAndIndexes() {
  const columns = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_runs'
  `);
  const names = new Set(columns.rows.map((row) => row.column_name));
  for (const name of [
    'trace_context', 'execution_scope', 'approval_status', 'plan_snapshot',
    'plan_hash', 'base_commit_sha', 'proposed_diff_hash', 'approved_plan_hash',
    'approved_commit_sha', 'approved_diff_hash', 'approved_by', 'approved_at',
    'steering_notes', 'cancel_requested_at', 'queue_type',
  ]) assert.ok(names.has(name), `agent_runs.${name} must exist`);

  const indexes = await pool.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY($1::text[])
  `, [[
    'agent_runs_queue_type_status_created_idx',
    'agent_runs_approval_status_created_idx',
  ]]);
  assert.equal(indexes.rows.length, 2, 'both runtime contract indexes must exist');
}

async function readRows() {
  const result = await pool.query(`
    SELECT id, status, queue_type, approval_status, attempts, max_attempts,
           worker_id, locked_at, cancel_requested_at
    FROM public.agent_runs ORDER BY id
  `);
  return Object.fromEntries(result.rows.map((row) => [row.id, row]));
}

try {
  await pool.query('DROP TABLE IF EXISTS public.agent_runs CASCADE');
  await pool.query(`
    CREATE TABLE public.agent_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'fixture-user',
      objective TEXT NOT NULL DEFAULT 'fixture objective',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      worker_id TEXT,
      locked_at TIMESTAMP(3),
      error TEXT,
      completed_at TIMESTAMP(3),
      next_attempt_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cancel_requested_at TIMESTAMP(3),
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    INSERT INTO public.agent_runs
      (id, status, attempts, max_attempts, worker_id, locked_at, cancel_requested_at, created_at)
    VALUES
      ('legacy-stale-queued', 'queued', 0, 3, NULL, NULL, NULL, CURRENT_TIMESTAMP - INTERVAL '2 hours'),
      ('legacy-fresh-queued', 'queued', 0, 3, NULL, NULL, NULL, CURRENT_TIMESTAMP - INTERVAL '5 minutes'),
      ('legacy-active-lease', 'running', 1, 3, 'worker-active', CURRENT_TIMESTAMP - INTERVAL '1 minute', NULL, CURRENT_TIMESTAMP - INTERVAL '10 minutes'),
      ('legacy-expired-lease', 'running', 1, 3, 'worker-dead', CURRENT_TIMESTAMP - INTERVAL '4 minutes', NULL, CURRENT_TIMESTAMP - INTERVAL '20 minutes'),
      ('legacy-exhausted-lease', 'running', 3, 3, 'worker-exhausted', CURRENT_TIMESTAMP - INTERVAL '4 minutes', NULL, CURRENT_TIMESTAMP - INTERVAL '1 day'),
      ('legacy-cancelled-lease', 'running', 1, 3, 'worker-cancelled', CURRENT_TIMESTAMP - INTERVAL '4 minutes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP - INTERVAL '1 day'),
      ('legacy-unleased-running', 'running', 1, 3, NULL, NULL, NULL, CURRENT_TIMESTAMP - INTERVAL '1 day'),
      ('legacy-completed', 'completed', 1, 3, NULL, NULL, NULL, CURRENT_TIMESTAMP - INTERVAL '3 days'),
      ('legacy-failed', 'failed', 3, 3, NULL, NULL, NULL, CURRENT_TIMESTAMP - INTERVAL '1 day')
  `);

  await applyMigration();
  await assertColumnsAndIndexes();
  let rows = await readRows();

  for (const id of [
    'legacy-stale-queued', 'legacy-fresh-queued', 'legacy-unleased-running',
    'legacy-completed', 'legacy-failed',
  ]) {
    assert.equal(rows[id].queue_type, 'unclassified', `${id} must be quarantined`);
    assert.equal(rows[id].approval_status, 'pending', `${id} must require explicit review`);
  }
  for (const id of [
    'legacy-active-lease', 'legacy-expired-lease',
    'legacy-exhausted-lease', 'legacy-cancelled-lease',
  ]) {
    assert.equal(rows[id].queue_type, 'reasoning', `${id} must retain its pre-existing leased queue`);
    assert.equal(rows[id].approval_status, 'approved', `${id} must retain its pre-existing worker eligibility`);
  }
  assert.equal(rows['legacy-active-lease'].status, 'running', 'active work must not be rewritten');
  assert.equal(rows['legacy-completed'].status, 'completed', 'completed history must be preserved');
  assert.equal(rows['legacy-failed'].status, 'failed', 'failed history must be preserved');

  // Match claimNextAgentRun's exhausted-attempt handling.
  const exhausted = await pool.query(`
    UPDATE public.agent_runs
    SET status = 'failed',
        error = 'Worker lease expired after the maximum number of attempts.',
        completed_at = NOW(), worker_id = NULL, locked_at = NULL
    WHERE status = 'running'
      AND queue_type = 'reasoning'
      AND approval_status = 'approved'
      AND locked_at < NOW() - INTERVAL '3 minutes'
      AND attempts >= max_attempts
    RETURNING id
  `);
  assert.deepEqual(exhausted.rows.map((row) => row.id), ['legacy-exhausted-lease']);

  // Match the worker's stale-lease claim gate, including cancellation,
  // approved-plan binding, next-attempt time and max-attempt protection.
  const claimed = await pool.query(`
    UPDATE public.agent_runs
    SET status = 'running', worker_id = $1, locked_at = NOW(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM public.agent_runs
      WHERE queue_type = 'reasoning'
        AND approval_status = 'approved'
        AND (plan_snapshot IS NULL OR (
          approved_plan_hash = plan_hash
          AND approved_commit_sha = base_commit_sha
          AND approved_diff_hash = proposed_diff_hash
        ))
        AND cancel_requested_at IS NULL
        AND (
          (status = 'queued' AND next_attempt_at <= NOW())
          OR (
            status = 'running'
            AND locked_at < NOW() - INTERVAL '3 minutes'
            AND attempts < max_attempts
            AND next_attempt_at <= NOW()
          )
        )
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, attempts, worker_id
  `, ['worker-recovery']);
  assert.deepEqual(claimed.rows.map((row) => row.id), ['legacy-expired-lease'],
    'only the expired, approved, non-cancelled lease below max attempts may be reclaimed');
  assert.equal(claimed.rows[0].attempts, 2, 'reclaim must increment the existing attempt counter');
  assert.equal(claimed.rows[0].worker_id, 'worker-recovery');

  rows = await readRows();
  assert.equal(rows['legacy-active-lease'].worker_id, 'worker-active',
    'fresh lease ownership must remain untouched');
  assert.equal(rows['legacy-cancelled-lease'].worker_id, 'worker-cancelled',
    'cancelled work must not be reclaimed by the worker query');
  assert.equal(rows['legacy-exhausted-lease'].status, 'failed',
    'exhausted leases must follow the existing terminal failure path');
  assert.equal(rows['legacy-fresh-queued'].queue_type, 'unclassified',
    'migration must not auto-approve or silently rescue queued legacy work');

  // Existing coding work remains isolated and is not rewritten by this migration.
  await pool.query('DROP TABLE public.agent_runs CASCADE');
  await pool.query(`
    CREATE TABLE public.agent_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'fixture-user',
      objective TEXT NOT NULL DEFAULT 'fixture objective',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      worker_id TEXT,
      locked_at TIMESTAMP(3),
      next_attempt_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cancel_requested_at TIMESTAMP(3),
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      queue_type TEXT,
      approval_status TEXT
    )
  `);
  await pool.query(`
    INSERT INTO public.agent_runs (id, status, queue_type, approval_status) VALUES
      ('classified-coding', 'queued', 'coding', 'approved'),
      ('classified-coding-null-approval', 'queued', 'coding', NULL),
      ('classified-reasoning', 'queued', 'reasoning', 'approved'),
      ('classified-null-queue', 'queued', NULL, 'approved')
  `);
  await applyMigration();
  await assertColumnsAndIndexes();
  rows = await readRows();
  assert.deepEqual(
    { queue_type: rows['classified-coding'].queue_type, approval_status: rows['classified-coding'].approval_status },
    { queue_type: 'coding', approval_status: 'approved' },
  );
  assert.deepEqual(
    { queue_type: rows['classified-coding-null-approval'].queue_type, approval_status: rows['classified-coding-null-approval'].approval_status },
    { queue_type: 'coding', approval_status: 'pending' },
  );
  for (const id of ['classified-reasoning', 'classified-null-queue']) {
    assert.equal(rows[id].queue_type, 'unclassified');
    assert.equal(rows[id].approval_status, 'pending');
  }

  console.log('PASS: legacy queued/unleased rows are quarantined without automatic approval.');
  console.log('PASS: running rows with worker ID + lock timestamp retain the existing lease contract.');
  console.log('PASS: stale leases are reclaimed only below max attempts and with cancellation/plan gates satisfied.');
  console.log('PASS: exhausted leases follow the existing terminal failure path.');
  console.log('PASS: completed/failed history and classified coding work are preserved.');
  console.log('LIMIT: isolated migration/SQL rehearsal only; no live worker or production data was touched.');
} finally {
  await pool.query('DROP TABLE IF EXISTS public.agent_runs CASCADE').catch(() => undefined);
  await pool.end();
}
