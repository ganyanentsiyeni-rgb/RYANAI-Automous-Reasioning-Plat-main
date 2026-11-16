import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMigrationState, assessSchema } from './audit-prisma-migration-readiness.mjs';

const memoryColumns = new Set(['session_id', 'role', 'content', 'timestamp']);
const cacheColumns = new Set(['id', 'prompt', 'response', 'embedding', 'created_at']);
const vectorIndexes = new Set(['idx_reasoning_embedding', 'idx_agent_session']);

test('reports source migrations absent from the applied ledger without mutating either input', () => {
  const names = ['20261102150000_agent_run_execution_scope', '20261102210000_internal_jarvis_audit'];
  const rows = [{ migration_name: names[0], finished_at: new Date(), rolled_back_at: null }];
  const result = compareMigrationState(names, rows);
  assert.deepEqual(result.pending, [names[1]]);
  assert.deepEqual(result.databaseOnly, []);
  assert.equal(rows.length, 1);
});

test('ignores rolled-back and unfinished ledger entries', () => {
  const result = compareMigrationState(['20261102150000_agent_run_execution_scope'], [
    { migration_name: '20261102150000_agent_run_execution_scope', finished_at: null, rolled_back_at: null },
    { migration_name: '20261102210000_internal_jarvis_audit', finished_at: new Date(), rolled_back_at: new Date() },
  ]);
  assert.deepEqual(result.pending, ['20261102150000_agent_run_execution_scope']);
  assert.deepEqual(result.databaseOnly, []);
});

test('detects schema and vector-memory drift, including runtime columns and indexes', () => {
  const result = assessSchema({
    columns: new Set(['execution_scope']),
    tables: new Set(['agent_runs', 'reasoning_cache']),
    indexes: new Set(),
    extensions: new Set(),
    memoryColumns: new Set(['sessionid', 'role']),
    cacheColumns: new Set(['id', 'prompt']),
  });
  assert.ok(result.missingColumns.includes('approval_status'));
  assert.ok(result.missingColumns.includes('requested_model'));
  assert.ok(result.missingColumns.includes('queue_type'));
  assert.ok(result.missingTables.includes('agent_run_evidence'));
  assert.ok(result.missingTables.includes('profiles'));
  assert.ok(result.missingTables.includes('rooms'));
  assert.ok(result.missingSharedColumns.includes('profiles.id'));
  assert.ok(result.missingSharedColumns.includes('rooms.id'));
  assert.equal(result.vector.extensionPresent, false);
  assert.deepEqual(result.vector.missingTables, ['agent_memory']);
  assert.deepEqual(result.vector.missingMemoryColumns, ['session_id', 'content', 'timestamp']);
  assert.deepEqual(result.vector.missingCacheColumns, ['response', 'embedding', 'created_at']);
  assert.deepEqual(result.vector.missingIndexes, ['idx_reasoning_embedding', 'idx_agent_session']);
  assert.equal(result.vector.indexPresent, false);
});

test('accepts a complete schema and vector-memory installation', () => {
  const columns = ['execution_scope', 'approval_status', 'plan_snapshot', 'plan_hash', 'base_commit_sha',
    'proposed_diff_hash', 'approved_plan_hash', 'approved_commit_sha', 'approved_diff_hash',
    'approved_by', 'approved_at', 'steering_notes', 'cancel_requested_at', 'requested_model'];
  const result = assessSchema({
    columns: new Set(columns),
    tables: new Set(['agent_run_evidence', 'jarvis_audit_events', 'reasoning_cache', 'agent_memory', 'profiles', 'conversations', 'messages', 'memory_entries', 'rooms', 'room_members', 'room_messages']),
    sharedColumns: new Set(['profiles.id', 'profiles.email', 'profiles.full_name', 'profiles.avatar_url', 'profiles.created_at', 'profiles.updated_at', 'conversations.id', 'conversations.user_id', 'conversations.title', 'conversations.model', 'conversations.created_at', 'conversations.updated_at', 'messages.id', 'messages.conversation_id', 'messages.role', 'messages.content', 'messages.model', 'messages.steps', 'messages.created_at', 'messages.metadata', 'memory_entries.id', 'memory_entries.user_id', 'memory_entries.key', 'memory_entries.value', 'memory_entries.category', 'memory_entries.created_at', 'rooms.id', 'rooms.name', 'rooms.created_by', 'rooms.created_at', 'room_members.room_id', 'room_members.user_id', 'room_members.joined_at', 'room_messages.id', 'room_messages.room_id', 'room_messages.sender_id', 'room_messages.body', 'room_messages.created_at']),
    indexes: vectorIndexes,
    extensions: new Set(['vector']),
    memoryColumns,
    cacheColumns,
  });
  assert.deepEqual(result.missingColumns, []);
  assert.deepEqual(result.missingTables, []);
  assert.deepEqual(result.missingSharedColumns, []);
  assert.equal(result.vector.extensionPresent, true);
  assert.deepEqual(result.vector.missingTables, []);
  assert.deepEqual(result.vector.missingMemoryColumns, []);
  assert.deepEqual(result.vector.missingCacheColumns, []);
  assert.deepEqual(result.vector.missingIndexes, []);
  assert.equal(result.vector.indexPresent, true);
});
