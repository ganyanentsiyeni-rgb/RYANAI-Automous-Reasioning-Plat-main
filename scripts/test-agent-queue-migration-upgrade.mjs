#!/usr/bin/env node
/**
 * Verify the coding-queue migration on a disposable PostgreSQL upgrade path.
 * The fixture rows are inserted before the isolated queue migration runs.
 * No hosted database, model provider, or outbound integration is used.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must target a disposable PostgreSQL database.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  const requiredAgentColumns = ['requested_model', 'queue_type'];
  const agentColumns = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_runs'
  `);
  const agentColumnSet = new Set(agentColumns.rows.map((row) => row.column_name));
  for (const column of requiredAgentColumns) {
    assert.ok(agentColumnSet.has(column), `agent_runs.${column} must exist after migration replay`);
  }

  const taskColumns = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coding_tasks'
  `);
  const taskColumnSet = new Set(taskColumns.rows.map((row) => row.column_name));
  const requiredTaskColumns = [
    'id', 'user_id', 'workbench_run_id', 'approval_id', 'plan_hash',
    'base_commit_sha', 'proposed_diff_hash', 'agent', 'prompt', 'workspace_key',
    'status', 'attempts', 'max_attempts', 'worker_id', 'locked_at',
    'lease_expires_at', 'next_attempt_at', 'cancel_requested_at',
    'result', 'error', 'created_at', 'updated_at', 'completed_at',
  ];
  for (const column of requiredTaskColumns) {
    assert.ok(taskColumnSet.has(column), `coding_tasks.${column} must exist`);
  }

  const expectedIndexes = [
    'agent_runs_queue_type_status_created_idx',
    'coding_tasks_status_next_attempt_idx',
    'coding_tasks_status_lease_expiry_idx',
    'coding_tasks_user_created_idx',
    'coding_tasks_workbench_run_idx',
  ];
  const indexes = await pool.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ANY($1::text[])
  `, [expectedIndexes]);
  const indexSet = new Set(indexes.rows.map((row) => row.indexname));
  for (const index of expectedIndexes) {
    assert.ok(indexSet.has(index), `required queue index ${index} must exist`);
  }

  const foreignKeys = await pool.query(`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.coding_tasks'::regclass AND contype = 'f'
  `);
  assert.ok(
    foreignKeys.rows.some((row) => /FOREIGN KEY \(user_id\) REFERENCES (?:public\.)?users/.test(row.definition)),
    'coding_tasks.user_id must reference users',
  );
  assert.ok(
    foreignKeys.rows.some((row) => /FOREIGN KEY \(workbench_run_id\) REFERENCES (?:public\.)?agent_runs/.test(row.definition)),
    'coding_tasks.workbench_run_id must reference agent_runs',
  );

  const classified = await pool.query(`
    SELECT id, queue_type, approval_status
    FROM public.agent_runs
    WHERE id LIKE 'queue-migration-fixture-%'
    ORDER BY id
  `);
  const actual = Object.fromEntries(classified.rows.map((row) => [row.id, {
    queue_type: row.queue_type,
    approval_status: row.approval_status,
  }]));
  assert.deepEqual(actual, {
    'queue-migration-fixture-diff': { queue_type: 'coding', approval_status: 'approved' },
    'queue-migration-fixture-pending': { queue_type: 'unclassified', approval_status: 'pending' },
    'queue-migration-fixture-pending-workbench': { queue_type: 'coding', approval_status: 'pending' },
    'queue-migration-fixture-plan': { queue_type: 'coding', approval_status: 'approved' },
    'queue-migration-fixture-reasoning': { queue_type: 'unclassified', approval_status: 'pending' },
  }, 'pending state alone must not classify ordinary reasoning work as coding');

  const taskId = 'queue-migration-fixture-task-' + randomUUID();
  await pool.query(`
    INSERT INTO public.coding_tasks (
      id, user_id, workbench_run_id, approval_id, plan_hash,
      base_commit_sha, proposed_diff_hash, agent, prompt, workspace_key
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    taskId,
    'queue-migration-fixture-user',
    'queue-migration-fixture-plan',
    'fixture-approval',
    'a'.repeat(64),
    'b'.repeat(40),
    'c'.repeat(64),
    'repair-agent',
    'Disposable schema-only task fixture',
    'ci/disposable-queue',
  ]);
  await pool.query('DELETE FROM public.coding_tasks WHERE id = $1', [taskId]);

  console.log('PASS: requested_model and queue_type columns exist.');
  console.log('PASS: coding_tasks complete column, index, and foreign-key contract exists.');
  console.log('PASS: only explicit workbench plan/diff evidence classifies a run as coding.');
  console.log('PASS: ordinary pending reasoning remains unclassified and pending, not coding.');
  console.log('PASS: disposable coding task insert/delete satisfies schema constraints.');
} finally {
  await pool.end();
}
