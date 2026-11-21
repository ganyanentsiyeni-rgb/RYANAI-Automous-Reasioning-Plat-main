import test from 'node:test';
import assert from 'node:assert/strict';
import { assessStructuralContract, assessMigrationSourceContracts } from './audit-prisma-structural-contract.mjs';

test('classifies absent tables, columns, indexes, foreign keys, triggers and Auth function as missing', () => {
  const result = assessStructuralContract({ tables: [], columns: [], indexes: [], constraints: [], triggers: [], functions: [], grants: [] });
  assert.ok(result.counts.missing > 50);
  assert.equal(result.counts.structurally_wrong, 0);
  for (const name of ['table public.users','column public.users.email','index public.coding_tasks.coding_tasks_user_created_idx','foreign_key public.coding_tasks.coding_tasks_user_id_fkey','trigger auth.users.ryanai_auth_user_sync_update','function public.sync_ryanai_auth_user search_path']) {
    assert.equal(result.findings.find((item) => item.object === name)?.status, 'missing', name);
  }
});

test('reports wrong defaults, timestamp precision and foreign-key update actions explicitly', () => {
  const result = assessStructuralContract({
    tables: [{ table_name: 'agent_runs', relkind: 'r', relrowsecurity: false }, { table_name: 'coding_tasks', relkind: 'r', relrowsecurity: false }],
    columns: [
      { table_name: 'agent_runs', column_name: 'approval_status', formatted_type: 'text', is_nullable: false, column_default: "'pending'::text" },
      { table_name: 'agent_runs', column_name: 'lease_expires_at', formatted_type: 'timestamp(6) with time zone', is_nullable: true, column_default: null },
      { table_name: 'coding_tasks', column_name: 'heartbeat_at', formatted_type: 'timestamp(3) without time zone', is_nullable: true, column_default: null },
    ],
    constraints: [{ conname: 'coding_tasks_user_id_fkey', table_name: 'coding_tasks', definition: 'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE' }],
  });
  const approval = result.findings.find((item) => item.object === 'column public.agent_runs.approval_status');
  assert.equal(approval.status, 'structurally_wrong');
  assert.equal(approval.expected.default, "'approved'");
  assert.match(approval.actual.default, /pending/);
  const lease = result.findings.find((item) => item.object === 'column public.agent_runs.lease_expires_at');
  assert.equal(lease.status, 'structurally_wrong');
  assert.equal(lease.expected.type, 'timestamp(3) without time zone');
  const heartbeat = result.findings.find((item) => item.object === 'column public.coding_tasks.heartbeat_at');
  assert.equal(heartbeat.status, 'structurally_wrong');
  assert.equal(heartbeat.expected.type, 'timestamp(6) with time zone');
  const fk = result.findings.find((item) => item.object === 'foreign_key public.coding_tasks.coding_tasks_user_id_fkey');
  assert.equal(fk.status, 'structurally_wrong');
  assert.equal(fk.expected.onUpdate, 'no action');
  assert.equal(fk.actual.onUpdate, 'cascade');
});

test('does not mistake intentionally absent handoff updated_at for a defect', () => {
  const result = assessStructuralContract({ tables: [], columns: [], indexes: [], constraints: [], triggers: [], functions: [], grants: [] });
  assert.equal(result.findings.find((item) => item.object === 'column public.agent_handoffs.updated_at')?.status, 'matching');
});

test('checks identity bridge, legacy queue correction and lease heartbeat migration source contracts', () => {
  const result = assessMigrationSourceContracts({
    authBridge: "COALESCE(au.created_at, pg_catalog.now())::timestamp(3) COALESCE(au.updated_at, au.created_at, pg_catalog.now())::timestamp(3)",
    codingQueue: "WHERE approval_status = 'pending' OR plan_snapshot IS NOT NULL OR proposed_diff_hash IS NOT NULL;",
    queueCorrection: "SET queue_type = 'unclassified' WHERE queue_type = 'coding' AND approval_status = 'pending' AND plan_snapshot IS NULL AND proposed_diff_hash IS NULL;",
    leaseHeartbeat: "ADD COLUMN lease_expires_at TIMESTAMP(3), ADD COLUMN heartbeat_at TIMESTAMP(3); ADD COLUMN heartbeat_at TIMESTAMPTZ(6); UPDATE public.coding_tasks SET heartbeat_at = COALESCE(locked_at, NOW()) WHERE status = 'running' AND heartbeat_at IS NULL;",
  });
  assert.equal(result.counts.missing, 0);
  assert.equal(result.counts.structurally_wrong, 0);
  assert.equal(result.counts.matching, 5);
});

test('flags weakened legacy coding classification', () => {
  const result = assessMigrationSourceContracts({ authBridge: '', codingQueue: "WHERE approval_status = 'pending';", queueCorrection: '', leaseHeartbeat: '' });
  assert.ok(result.findings.some((item) => item.object === 'migration coding queue legacy classification' && item.status === 'structurally_wrong'));
});
