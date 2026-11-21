import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMigrationState, assessMissingMigrationLedger, assessMigrationLedger, assessSchema } from './audit-prisma-migration-readiness.mjs';

const memoryColumns = new Set(['session_id', 'role', 'content', 'timestamp']);
const cacheColumns = new Set(['id', 'prompt', 'response', 'embedding', 'created_at']);
const vectorIndexes = new Set(['idx_reasoning_embedding', 'idx_agent_session', 'coding_tasks_status_next_attempt_idx', 'coding_tasks_status_lease_expiry_idx', 'coding_tasks_user_created_idx', 'coding_tasks_workbench_run_idx', 'agent_runs_queue_type_status_created_idx']);

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

test('reconciles exact SHA-256 checksums and reports unfinished, rolled-back, and duplicate ledger records', () => {
  const local = [
    { name: '20261101000000_first', checksum: 'sha-first' },
    { name: '20261102000000_second', checksum: 'sha-second' },
  ];
  const rows = [
    { migration_name: '20261101000000_first', checksum: 'sha-first', started_at: '2026-11-01T00:00:00Z', finished_at: '2026-11-01T00:00:01Z', rolled_back_at: null, logs: null, applied_steps_count: 1 },
    { migration_name: '20261102000000_second', checksum: 'old-checksum', started_at: '2026-11-02T00:00:00Z', finished_at: '2026-11-02T00:00:01Z', rolled_back_at: null, logs: null, applied_steps_count: 2 },
    { migration_name: '20261103000000_unfinished', checksum: 'failed-checksum', started_at: '2026-11-03T00:00:00Z', finished_at: null, rolled_back_at: null, logs: 'sensitive SQL error text', applied_steps_count: 0 },
    { migration_name: '20261104000000_rolled_back', checksum: 'rolled-checksum', started_at: '2026-11-04T00:00:00Z', finished_at: null, rolled_back_at: '2026-11-04T00:01:00Z', logs: 'historical failure', applied_steps_count: 0 },
    { migration_name: '20261101000000_first', checksum: 'sha-first', started_at: '2026-11-01T00:02:00Z', finished_at: '2026-11-01T00:02:01Z', rolled_back_at: null, logs: null, applied_steps_count: 1 },
    { migration_name: '20261105000000_database_only', checksum: 'unknown', started_at: '2026-11-05T00:00:00Z', finished_at: '2026-11-05T00:00:01Z', rolled_back_at: null, logs: null, applied_steps_count: 1 },
  ];
  const result = assessMigrationLedger(local, rows);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.databaseOnly, ['20261105000000_database_only']);
  assert.deepEqual(result.checksumMismatches, [{
    migration: '20261102000000_second', localChecksum: 'sha-second', databaseChecksum: 'old-checksum',
  }]);
  assert.deepEqual(result.unresolved, [{
    migration: '20261103000000_unfinished',
    startedAt: '2026-11-03T00:00:00Z',
    hasErrorLog: true,
    appliedStepsCount: 0,
  }]);
  assert.deepEqual(result.rolledBack, [{
    migration: '20261104000000_rolled_back',
    rolledBackAt: '2026-11-04T00:01:00Z',
    startedAt: '2026-11-04T00:00:00Z',
  }]);
  assert.deepEqual(result.duplicateCompleted, [{
    migration: '20261101000000_first', completedRecords: 2,
  }]);
  assert.equal(JSON.stringify(result).includes('sensitive SQL error text'), false);
  assert.equal(JSON.stringify(result).includes('historical failure'), false);
});

test('keeps rolled-back historical rows visible without treating them as applied', () => {
  const result = assessMigrationLedger(
    [{ name: '20261101000000_first', checksum: 'same' }],
    [{ migration_name: '20261101000000_first', checksum: 'same', started_at: '2026-11-01', finished_at: null, rolled_back_at: '2026-11-02', logs: null, applied_steps_count: 0 }],
  );
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.pending, ['20261101000000_first']);
  assert.equal(result.rolledBack.length, 1);
  assert.deepEqual(result.unresolved, []);
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
  assert.ok(result.missingTables.includes('agent_brain_health'));
  assert.ok(result.missingTables.includes('agent_run_evidence'));
  assert.ok(result.missingTables.includes('coding_tasks'));
  assert.ok(result.missingTables.includes('profiles'));
  assert.ok(result.missingTables.includes('rooms'));
  assert.ok(result.missingSharedColumns.includes('profiles.id'));
  assert.ok(result.missingSharedColumns.includes('rooms.id'));
  assert.equal(result.vector.extensionPresent, false);
  assert.deepEqual(result.vector.missingTables, ['agent_memory']);
  assert.deepEqual(result.vector.missingMemoryColumns, ['session_id', 'content', 'timestamp']);
  assert.deepEqual(result.vector.missingCacheColumns, ['response', 'embedding', 'created_at']);
  assert.deepEqual(result.vector.missingIndexes, ['idx_reasoning_embedding', 'idx_agent_session', 'coding_tasks_status_next_attempt_idx', 'coding_tasks_status_lease_expiry_idx', 'coding_tasks_user_created_idx', 'coding_tasks_workbench_run_idx', 'agent_runs_queue_type_status_created_idx']);
  assert.equal(result.vector.indexPresent, false);
});

test('accepts a complete schema and vector-memory installation', () => {
  const columns = ['queue_type', 'execution_scope', 'approval_status', 'plan_snapshot', 'plan_hash', 'base_commit_sha',
    'proposed_diff_hash', 'approved_plan_hash', 'approved_commit_sha', 'approved_diff_hash',
    'approved_by', 'approved_at', 'steering_notes', 'cancel_requested_at', 'requested_model'];
  const result = assessSchema({
    columns: new Set(columns),
    tables: new Set(['agent_runs', 'agent_handoffs', 'agent_brain_health', 'agent_run_evidence', 'jarvis_audit_events', 'coding_tasks', 'reasoning_cache', 'agent_memory', 'profiles', 'conversations', 'messages', 'memory_entries', 'rooms', 'room_members', 'room_messages']),
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

const validAttemptColumns = [
  ['id', 'uuid'], ['event_inbox_id', 'uuid'], ['attempt', 'integer'], ['worker_id', 'character varying(128)'],
  ['status', 'character varying(24)'], ['error', 'text'], ['started_at', 'timestamp with time zone'], ['finished_at', 'timestamp with time zone'],
].map(([column_name, formatted_type]) => ({ column_name, formatted_type }));
const attemptConstraints = [
  { conname: 'intelligence_event_attempts_event_inbox_id_fkey', definition: 'FOREIGN KEY (event_inbox_id) REFERENCES public.intelligence_event_inbox(id) ON DELETE CASCADE ON UPDATE CASCADE' },
  { conname: 'intelligence_event_attempt_event_attempt_key', definition: 'UNIQUE (event_inbox_id, attempt)' },
  { conname: 'intelligence_event_attempts_attempt_check', definition: 'CHECK ((attempt > 0))' },
  { conname: 'intelligence_event_attempts_status_check', definition: "CHECK (((status)::text = ANY ((ARRAY['started'::character varying, 'succeeded'::character varying, 'retry'::character varying, 'dead_letter'::character varying, 'lease_expired'::character varying])::text[])))" },
];
const attemptIndexes = [
  { indexname: 'intelligence_event_attempt_event_started_idx', indexdef: 'CREATE INDEX intelligence_event_attempt_event_started_idx ON public.intelligence_event_attempts USING btree (event_inbox_id, started_at DESC)' },
  { indexname: 'intelligence_event_attempt_status_started_idx', indexdef: 'CREATE INDEX intelligence_event_attempt_status_started_idx ON public.intelligence_event_attempts USING btree (status, started_at DESC)' },
];

test('detects missing and mismatched intelligence event attempt schema objects', () => {
  const result = assessSchema({
    columns: new Set(), tables: new Set(['intelligence_event_attempts']), indexes: new Set(), extensions: new Set(),
    memoryColumns: new Set(), cacheColumns: new Set(),
    eventAttemptColumns: [{ column_name: 'event_inbox_id', formatted_type: 'text' }],
    eventAttemptConstraints: [], eventAttemptIndexes: [], eventAttemptRlsEnabled: false,
  });
  assert.ok(result.eventAttempts.missingColumns.includes('id'));
  assert.deepEqual(result.eventAttempts.mismatchedColumns, [{ column: 'event_inbox_id', expected: 'uuid', actual: 'text' }]);
  assert.deepEqual(result.eventAttempts.missingConstraints, attemptConstraints.map((item) => item.conname));
  assert.deepEqual(result.eventAttempts.missingIndexes, attemptIndexes.map((item) => item.indexname));
  assert.equal(result.eventAttempts.rlsEnabled, false);
});

test('accepts the expected intelligence event attempt table contract', () => {
  const result = assessSchema({
    columns: new Set(), tables: new Set(['intelligence_event_attempts']), indexes: new Set(), extensions: new Set(),
    memoryColumns: new Set(), cacheColumns: new Set(), eventAttemptColumns: validAttemptColumns,
    eventAttemptConstraints: attemptConstraints, eventAttemptIndexes: attemptIndexes, eventAttemptRlsEnabled: true,
  });
  assert.equal(result.eventAttempts.tablePresent, true);
  assert.deepEqual(result.eventAttempts.missingColumns, []);
  assert.deepEqual(result.eventAttempts.mismatchedColumns, []);
  assert.deepEqual(result.eventAttempts.missingConstraints, []);
  assert.deepEqual(result.eventAttempts.mismatchedConstraints, []);
  assert.deepEqual(result.eventAttempts.missingIndexes, []);
  assert.deepEqual(result.eventAttempts.mismatchedIndexes, []);
  assert.equal(result.eventAttempts.rlsEnabled, true);
});

test('requires ON UPDATE CASCADE on the intelligence event attempt foreign key', () => {
  const result = assessSchema({
    columns: new Set(), tables: new Set(['intelligence_event_attempts']), indexes: new Set(), extensions: new Set(),
    memoryColumns: new Set(), cacheColumns: new Set(), eventAttemptColumns: validAttemptColumns,
    eventAttemptConstraints: [
      { conname: 'intelligence_event_attempts_event_inbox_id_fkey', definition: 'FOREIGN KEY (event_inbox_id) REFERENCES public.intelligence_event_inbox(id) ON DELETE CASCADE' },
      ...attemptConstraints.filter((item) => item.conname !== 'intelligence_event_attempts_event_inbox_id_fkey'),
    ],
    eventAttemptIndexes: attemptIndexes, eventAttemptRlsEnabled: true,
  });
  assert.deepEqual(result.eventAttempts.missingConstraints, []);
  assert.ok(result.eventAttempts.mismatchedConstraints.some((item) => item.name === 'intelligence_event_attempts_event_inbox_id_fkey'));
});

test('detects wrong foreign-key actions, unique columns, and index definitions despite matching names', () => {
  const result = assessSchema({
    columns: new Set(), tables: new Set(['intelligence_event_attempts']), indexes: new Set(), extensions: new Set(),
    memoryColumns: new Set(), cacheColumns: new Set(), eventAttemptColumns: validAttemptColumns,
    eventAttemptConstraints: [
      { conname: 'intelligence_event_attempts_event_inbox_id_fkey', definition: 'FOREIGN KEY (event_inbox_id) REFERENCES public.intelligence_event_inbox(id) ON DELETE SET NULL' },
      { conname: 'intelligence_event_attempt_event_attempt_key', definition: 'UNIQUE (event_inbox_id)' },
    ],
    eventAttemptIndexes: [
      { indexname: 'intelligence_event_attempt_event_started_idx', indexdef: 'CREATE INDEX intelligence_event_attempt_event_started_idx ON public.intelligence_event_attempts USING btree (event_inbox_id)' },
      { indexname: 'intelligence_event_attempt_status_started_idx', indexdef: 'CREATE INDEX intelligence_event_attempt_status_started_idx ON public.intelligence_event_attempts USING btree (status, started_at)' },
    ],
    eventAttemptRlsEnabled: true,
  });
  assert.deepEqual(result.eventAttempts.missingConstraints, ['intelligence_event_attempts_attempt_check', 'intelligence_event_attempts_status_check']);
  assert.equal(result.eventAttempts.mismatchedConstraints.length, 2);
  assert.equal(result.eventAttempts.missingIndexes.length, 0);
  assert.equal(result.eventAttempts.mismatchedIndexes.length, 2);
});


test('detects missing or weakened attempt and status CHECK constraints even when names match', () => {
  const base = {
    columns: new Set(), tables: new Set(['intelligence_event_attempts']), indexes: new Set(), extensions: new Set(),
    memoryColumns: new Set(), cacheColumns: new Set(), eventAttemptColumns: validAttemptColumns,
    eventAttemptIndexes: attemptIndexes, eventAttemptRlsEnabled: true,
  };
  const wrongAttempt = assessSchema({
    ...base,
    eventAttemptConstraints: attemptConstraints.map((item) => item.conname === 'intelligence_event_attempts_attempt_check'
      ? { ...item, definition: 'CHECK (attempt >= 0)' } : item),
  });
  assert.deepEqual(wrongAttempt.eventAttempts.missingConstraints, []);
  assert.ok(wrongAttempt.eventAttempts.mismatchedConstraints.some((item) => item.name === 'intelligence_event_attempts_attempt_check'));

  const wrongStatus = assessSchema({
    ...base,
    eventAttemptConstraints: attemptConstraints.map((item) => item.conname === 'intelligence_event_attempts_status_check'
      ? { ...item, definition: "CHECK (status IN ('started', 'succeeded', 'retry', 'dead_letter', 'unknown'))" } : item),
  });
  assert.deepEqual(wrongStatus.eventAttempts.missingConstraints, []);
  assert.ok(wrongStatus.eventAttempts.mismatchedConstraints.some((item) => item.name === 'intelligence_event_attempts_status_check'));

  const missingStatus = assessSchema({
    ...base,
    eventAttemptConstraints: attemptConstraints.filter((item) => item.conname !== 'intelligence_event_attempts_status_check'),
  });
  assert.ok(missingStatus.eventAttempts.missingConstraints.includes('intelligence_event_attempts_status_check'));
});


test('detects the exact six-column LangGraph checkpoint_writes primary key', () => {
  const expected = ['thread_id', 'checkpoint_ns', 'checkpoint_id', 'task_id', 'idx', 'channel'];
  const base = { columns: new Set(), tables: new Set(), indexes: new Set(), extensions: new Set(), memoryColumns: new Set(), cacheColumns: new Set() };
  const valid = assessSchema({
    ...base,
    tables: new Set(['checkpoint_writes']),
    checkpointWritePrimaryKeyColumns: expected,
  });
  assert.equal(valid.checkpointWrites.tablePresent, true);
  assert.equal(valid.checkpointWrites.primaryKeyPresent, true);
  assert.deepEqual(valid.checkpointWrites.actualPrimaryKeyColumns, expected);
  assert.equal(valid.checkpointWrites.primaryKeyMatches, true);
  const fiveColumn = assessSchema({ ...base, checkpointWritePrimaryKeyColumns: expected.slice(0, 5) });
  assert.equal(fiveColumn.checkpointWrites.primaryKeyMatches, false);
  const wrongOrder = assessSchema({ ...base, checkpointWritePrimaryKeyColumns: [...expected].reverse() });
  assert.equal(wrongOrder.checkpointWrites.primaryKeyMatches, false);
  const absent = assessSchema(base);
  assert.equal(absent.checkpointWrites.tablePresent, false);
  assert.equal(absent.checkpointWrites.primaryKeyPresent, false);
  assert.equal(absent.checkpointWrites.actualPrimaryKeyColumns, null);
  assert.equal(absent.checkpointWrites.primaryKeyMatches, false);
  const tableWithoutKey = assessSchema({
    ...base,
    tables: new Set(['checkpoint_writes']),
  });
  assert.equal(tableWithoutKey.checkpointWrites.tablePresent, true);
  assert.equal(tableWithoutKey.checkpointWrites.primaryKeyPresent, false);
  assert.equal(tableWithoutKey.checkpointWrites.primaryKeyMatches, false);
});


test('reports a missing Prisma ledger as unknown without fabricating pending/applied history', () => {
  const local = [
    { name: '20261101000000_first', checksum: 'sha-first' },
    { name: '20261102000000_second', checksum: 'sha-second' },
  ];
  const result = assessMissingMigrationLedger(local);
  assert.equal(result.status, 'missing');
  assert.equal(result.ledgerPresent, false);
  assert.deepEqual(result.local, ['20261101000000_first', '20261102000000_second']);
  assert.equal(result.applied, null);
  assert.equal(result.pending, null);
  assert.equal(result.databaseOnly, null);
  assert.match(result.note, /history is unknown/);
});
