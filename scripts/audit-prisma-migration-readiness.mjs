#!/usr/bin/env node
/**
 * Read-only Prisma migration readiness audit.
 * Never applies migrations, alters schema, prints DATABASE_URL, or reads row data.
 */
import { readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function compareMigrationState(localNames, appliedRows) {
  const applied = new Set(appliedRows.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name));
  const local = [...localNames].filter((name) => /^\d{14}_[a-z0-9_]+$/.test(name)).sort();
  return { local, applied: [...applied].sort(), pending: local.filter((name) => !applied.has(name)), databaseOnly: [...applied].filter((name) => !local.includes(name)).sort() };
}

export function assessSchema({ columns, tables, indexes, extensions, memoryColumns, cacheColumns, sharedColumns = new Set(), eventAttemptColumns = null, eventAttemptConstraints = [], eventAttemptIndexes = [], eventAttemptRlsEnabled = null }) {
  const requiredColumns = ['requested_model', 'execution_scope', 'approval_status', 'plan_snapshot', 'plan_hash', 'base_commit_sha', 'proposed_diff_hash', 'approved_plan_hash', 'approved_commit_sha', 'approved_diff_hash', 'approved_by', 'approved_at', 'steering_notes', 'cancel_requested_at', 'queue_type'];
  const requiredTables = ['agent_run_evidence', 'jarvis_audit_events', 'coding_tasks', 'profiles', 'conversations', 'messages', 'memory_entries', 'rooms', 'room_members', 'room_messages'];
  const requiredSharedColumns = ['profiles.id', 'profiles.email', 'profiles.full_name', 'profiles.avatar_url', 'profiles.created_at', 'profiles.updated_at', 'conversations.id', 'conversations.user_id', 'conversations.title', 'conversations.model', 'conversations.created_at', 'conversations.updated_at', 'messages.id', 'messages.conversation_id', 'messages.role', 'messages.content', 'messages.model', 'messages.steps', 'messages.created_at', 'messages.metadata', 'memory_entries.id', 'memory_entries.user_id', 'memory_entries.key', 'memory_entries.value', 'memory_entries.category', 'memory_entries.created_at', 'rooms.id', 'rooms.name', 'rooms.created_by', 'rooms.created_at', 'room_members.room_id', 'room_members.user_id', 'room_members.joined_at', 'room_messages.id', 'room_messages.room_id', 'room_messages.sender_id', 'room_messages.body', 'room_messages.created_at'];
  const missingSharedColumns = requiredSharedColumns.filter((name) => !sharedColumns.has(name));
  const requiredVector = ['reasoning_cache', 'agent_memory'];
  const missingColumns = requiredColumns.filter((name) => !columns.has(name));
  const missingTables = requiredTables.filter((name) => !tables.has(name));
  const missingVectorTables = requiredVector.filter((name) => !tables.has(name));
  const requiredMemoryColumns = ['session_id', 'role', 'content', 'timestamp'];
  const requiredCacheColumns = ['id', 'prompt', 'response', 'embedding', 'created_at'];
  const missingMemoryColumns = requiredMemoryColumns.filter((name) => !memoryColumns.has(name));
  const missingCacheColumns = requiredCacheColumns.filter((name) => !cacheColumns.has(name));
  const requiredIndexes = ['idx_reasoning_embedding', 'idx_agent_session', 'coding_tasks_status_next_attempt_idx', 'coding_tasks_status_lease_expiry_idx', 'coding_tasks_user_created_idx', 'coding_tasks_workbench_run_idx', 'agent_runs_queue_type_status_created_idx'];
  const missingIndexes = requiredIndexes.filter((name) => !indexes.has(name));
  const expectedAttemptTypes = { id: 'uuid', event_inbox_id: 'uuid', attempt: 'integer', worker_id: 'character varying(128)', status: 'character varying(24)', error: 'text', started_at: 'timestamp with time zone', finished_at: 'timestamp with time zone' };
  const missingAttemptColumns = eventAttemptColumns === null ? [] : Object.keys(expectedAttemptTypes).filter((name) => !eventAttemptColumns.some((column) => column.column_name === name));
  const mismatchedAttemptColumns = eventAttemptColumns === null ? [] : eventAttemptColumns.filter((column) => expectedAttemptTypes[column.column_name] && column.formatted_type !== expectedAttemptTypes[column.column_name]).map((column) => ({ column: column.column_name, expected: expectedAttemptTypes[column.column_name], actual: column.formatted_type }));
  const normalizeDefinition = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/\bpublic\./g, '').trim();
  const constraintByName = new Map(eventAttemptConstraints.map((item) => [item.conname, normalizeDefinition(item.definition)]));
  const expectedAttemptConstraints = {
    intelligence_event_attempts_event_inbox_id_fkey: 'foreign key (event_inbox_id) references intelligence_event_inbox(id) on delete cascade',
    intelligence_event_attempt_event_attempt_key: 'unique (event_inbox_id, attempt)',
    intelligence_event_attempts_attempt_check: 'check (attempt > 0)',
    intelligence_event_attempts_status_check: 'check (status in started,succeeded,retry,dead_letter,lease_expired)',
  };
  const missingAttemptConstraints = Object.keys(expectedAttemptConstraints).filter((name) => !constraintByName.has(name));
  const constraintMatches = (name, actual, expected) => {
    if (name === 'intelligence_event_attempts_attempt_check') {
      return /check/.test(actual) && /\battempt\b/.test(actual) && />\s*0\b/.test(actual);
    }
    if (name === 'intelligence_event_attempts_status_check') {
      const allowed = ['started', 'succeeded', 'retry', 'dead_letter', 'lease_expired'];
      const values = [...actual.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
      return /\bstatus\b/.test(actual) && (actual.includes('= any') || /\bin\s*\(/.test(actual))
        && values.length === allowed.length && values.every((value, index) => value === [...allowed].sort()[index]);
    }
    return actual.includes(normalizeDefinition(expected));
  };
  const mismatchedAttemptConstraints = Object.entries(expectedAttemptConstraints).filter(([name, expected]) => constraintByName.has(name) && !constraintMatches(name, constraintByName.get(name), expected)).map(([name, expected]) => ({ name, expected, actual: constraintByName.get(name) }));
  const indexByName = new Map(eventAttemptIndexes.map((item) => [item.indexname, normalizeDefinition(item.indexdef)]));
  const expectedAttemptIndexes = {
    intelligence_event_attempt_event_started_idx: '(event_inbox_id, started_at desc)',
    intelligence_event_attempt_status_started_idx: '(status, started_at desc)',
  };
  const missingAttemptIndexes = Object.keys(expectedAttemptIndexes).filter((name) => !indexByName.has(name));
  const mismatchedAttemptIndexes = Object.entries(expectedAttemptIndexes).filter(([name, expected]) => indexByName.has(name) && !indexByName.get(name).includes(normalizeDefinition(expected))).map(([name, expected]) => ({ name, expected, actual: indexByName.get(name) }));
  const eventAttempts = {
    tablePresent: tables.has('intelligence_event_attempts'),
    missingColumns: missingAttemptColumns,
    mismatchedColumns: mismatchedAttemptColumns,
    missingConstraints: missingAttemptConstraints,
    mismatchedConstraints: mismatchedAttemptConstraints,
    missingIndexes: missingAttemptIndexes,
    mismatchedIndexes: mismatchedAttemptIndexes,
    rlsEnabled: eventAttemptRlsEnabled,
    rlsEnabledExpected: true,
  };
  return {
    missingColumns, missingTables, missingSharedColumns,
    vector: { extensionPresent: extensions.has('vector'), missingTables: missingVectorTables, missingMemoryColumns, missingCacheColumns, missingIndexes, indexPresent: missingIndexes.length === 0 },
    eventAttempts,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('BLOCKED: DATABASE_URL is required (value is never printed).'); process.exitCode = 2; return; }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const migrationRoot = resolve(root, 'prisma/migrations');
  const entries = await readdir(migrationRoot, { withFileTypes: true });
  const localNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 8000 });
  try {
    const migrationResult = await pool.query('SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name');
    const state = compareMigrationState(localNames, migrationResult.rows);
    const [columnResult, tableResult, indexResult, extensionResult, memoryColumnResult, cacheColumnResult, sharedColumnResult, attemptColumnResult, attemptConstraintResult, attemptIndexResult, attemptRlsResult] = await Promise.all([
      pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_runs'"),
      pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"),
      pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='public'"),
      pool.query("SELECT extname FROM pg_extension WHERE extname='vector'"),
      pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_memory'"),
      pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='reasoning_cache'"),
      pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('profiles','conversations','messages','memory_entries','rooms','room_members','room_messages')"),
      pool.query("SELECT column_name, format_type(a.atttypid, a.atttypmod) AS formatted_type FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='intelligence_event_attempts' AND a.attnum > 0 AND NOT a.attisdropped"),
      pool.query("SELECT conname, pg_get_constraintdef(oid, true) AS definition FROM pg_constraint WHERE conrelid=to_regclass('public.intelligence_event_attempts')"),
      pool.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='intelligence_event_attempts'"),
      pool.query("SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.intelligence_event_attempts')"),
    ]);
    const schema = assessSchema({
      columns: new Set(columnResult.rows.map((row) => row.column_name)),
      tables: new Set(tableResult.rows.map((row) => row.table_name)),
      indexes: new Set(indexResult.rows.map((row) => row.indexname)),
      extensions: new Set(extensionResult.rows.map((row) => row.extname)),
      memoryColumns: new Set(memoryColumnResult.rows.map((row) => row.column_name)),
      cacheColumns: new Set(cacheColumnResult.rows.map((row) => row.column_name)),
      sharedColumns: new Set(sharedColumnResult.rows.map((row) => row.table_name + '.' + row.column_name)),
      eventAttemptColumns: attemptColumnResult.rows,
      eventAttemptConstraints: attemptConstraintResult.rows,
      eventAttemptIndexes: attemptIndexResult.rows,
      eventAttemptRlsEnabled: attemptRlsResult.rows[0]?.relrowsecurity ?? false,
    });
    console.log(JSON.stringify({ mode: 'read-only', migrationState: state, schema, remediation: 'Review each pending migration against live schema before applying. This command never applies DDL.' }, null, 2));
    if (state.pending.length || state.databaseOnly.length || schema.missingColumns.length || schema.missingTables.length || schema.missingSharedColumns.length || !schema.vector.extensionPresent || schema.vector.missingTables.length || schema.vector.missingMemoryColumns.length || schema.vector.missingCacheColumns.length || schema.vector.missingIndexes.length || !schema.eventAttempts.tablePresent || schema.eventAttempts.missingColumns.length || schema.eventAttempts.mismatchedColumns.length || schema.eventAttempts.missingConstraints.length || schema.eventAttempts.mismatchedConstraints.length || schema.eventAttempts.missingIndexes.length || schema.eventAttempts.mismatchedIndexes.length || schema.eventAttempts.rlsEnabled !== true) process.exitCode = 1;
  } catch {
    console.error('BLOCKED: migration metadata/schema audit failed. Check database connectivity and permissions; connection details were suppressed.');
    process.exitCode = 2;
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('BLOCKED: migration audit could not complete; error details suppressed.'); process.exitCode = 2; });
