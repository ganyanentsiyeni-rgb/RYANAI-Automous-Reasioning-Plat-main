#!/usr/bin/env node
/**
 * Verify the runtime-contract migration's fail-closed legacy behavior and
 * the default eligibility contract for newly created reasoning tasks.
 * DATABASE_URL must point to the disposable migration-upgrade database.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must target a disposable PostgreSQL database.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const newRunId = 'runtime-contract-new-' + randomUUID();
const legacyRunId = 'queue-migration-fixture-reasoning';

try {
  const columns = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_runs'
      AND column_name IN (
        'trace_context', 'execution_scope', 'approval_status', 'queue_type',
        'plan_snapshot', 'approved_plan_hash', 'approved_commit_sha',
        'approved_diff_hash', 'cancel_requested_at'
      )
  `);
  const present = new Set(columns.rows.map((row) => row.column_name));
  for (const column of [
    'trace_context', 'execution_scope', 'approval_status', 'queue_type',
    'plan_snapshot', 'approved_plan_hash', 'approved_commit_sha',
    'approved_diff_hash', 'cancel_requested_at',
  ]) {
    assert.ok(present.has(column), `agent_runs.${column} must exist`);
  }

  const legacy = await pool.query(`
    SELECT queue_type, approval_status
    FROM public.agent_runs
    WHERE id = $1
  `, [legacyRunId]);
  assert.equal(legacy.rowCount, 1, 'the pre-migration legacy fixture must exist');
  assert.deepEqual(legacy.rows[0], {
    queue_type: 'unclassified',
    approval_status: 'pending',
  }, 'legacy rows must be quarantined, not implicitly approved for reasoning');

  const coding = await pool.query(`
    SELECT id, queue_type
    FROM public.agent_runs
    WHERE id IN (
      'queue-migration-fixture-plan',
      'queue-migration-fixture-pending-workbench',
      'queue-migration-fixture-diff'
    )
  `);
  assert.equal(coding.rowCount, 3, 'all explicit workbench fixtures must remain present');
  assert.ok(coding.rows.every((row) => row.queue_type === 'coding'),
    'only rows with explicit workbench plan or diff evidence remain in the coding queue');

  const ordinaryPending = await pool.query(`
    SELECT queue_type, approval_status
    FROM public.agent_runs
    WHERE id = 'queue-migration-fixture-pending'
  `);
  assert.deepEqual(ordinaryPending.rows[0], {
    queue_type: 'unclassified',
    approval_status: 'pending',
  }, 'an ordinary pending reasoning row must remain quarantined, not be misclassified as coding');

  const inserted = await pool.query(`
    INSERT INTO public.agent_runs (id, user_id, objective, status)
    VALUES ($1, 'queue-migration-fixture-user', 'New authorized reasoning fixture', 'queued')
    RETURNING queue_type, approval_status
  `, [newRunId]);
  assert.deepEqual(inserted.rows[0], {
    queue_type: 'reasoning',
    approval_status: 'approved',
  }, 'new task defaults must remain eligible for the reasoning queue');

  const claimable = async (id) => pool.query(`
    SELECT id
    FROM public.agent_runs
    WHERE id = $1
      AND queue_type = 'reasoning'
      AND approval_status = 'approved'
      AND (
        plan_snapshot IS NULL
        OR (
          approved_plan_hash = plan_hash
          AND approved_commit_sha = base_commit_sha
          AND approved_diff_hash = proposed_diff_hash
        )
      )
      AND cancel_requested_at IS NULL
  `, [id]);

  assert.equal((await claimable(newRunId)).rowCount, 1,
    'a newly created approved reasoning task must satisfy the worker claim predicate');
  assert.equal((await claimable(legacyRunId)).rowCount, 0,
    'a legacy row must never satisfy the reasoning worker claim predicate');

  console.log('PASS: legacy reasoning rows are unclassified and pending.');
  console.log('PASS: pre-existing coding workbench rows retain coding classification.');
  console.log('PASS: new tasks default to reasoning and approved.');
  console.log('PASS: worker claim predicate admits new tasks and rejects legacy rows.');
} finally {
  await pool.query('DELETE FROM public.agent_runs WHERE id = $1', [newRunId]).catch(() => {});
  await pool.end();
}
