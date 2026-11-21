import assert from 'node:assert/strict';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the Supabase schema contract check');

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

async function assertForeignKey({
  table,
  constraint,
  targetSchema,
  targetTable,
  sourceColumns,
  targetColumns,
  onDelete = 'a',
  onUpdate = 'a',
}) {
  const result = await pool.query(
    [
      'SELECT',
      '  c.confdeltype::text AS on_delete,',
      '  c.confupdtype::text AS on_update,',
      '  target_ns.nspname AS target_schema,',
      '  target.relname AS target_table,',
      '  ARRAY(',
      '    SELECT a.attname::text',
      '    FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, position)',
      '    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum',
      '    ORDER BY key.position',
      '  ) AS source_columns,',
      '  ARRAY(',
      '    SELECT a.attname::text',
      '    FROM unnest(c.confkey) WITH ORDINALITY AS key(attnum, position)',
      '    JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = key.attnum',
      '    ORDER BY key.position',
      '  ) AS target_columns',
      'FROM pg_constraint c',
      'JOIN pg_class source ON source.oid = c.conrelid',
      'JOIN pg_namespace source_ns ON source_ns.oid = source.relnamespace',
      'JOIN pg_class target ON target.oid = c.confrelid',
      'JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace',
      "WHERE c.contype = 'f'",
      "  AND source_ns.nspname = 'public'",
      '  AND source.relname = $1',
      '  AND c.conname = $2',
    ].join('\n'),
    [table, constraint]
  );

  const label = table + '.' + constraint;
  assert.equal(result.rowCount, 1, label + ' must exist');
  const row = result.rows[0];
  assert.equal(row.target_schema, targetSchema, label + ' target schema');
  assert.equal(row.target_table, targetTable, label + ' target table');
  assert.deepEqual(row.source_columns, sourceColumns, label + ' source columns');
  assert.deepEqual(row.target_columns, targetColumns, label + ' target columns');
  assert.equal(row.on_delete, onDelete, label + ' ON DELETE action');
  assert.equal(row.on_update, onUpdate, label + ' ON UPDATE action');
}

async function assertIndex(name, { columns, unique = false, partial = false }) {
  const result = await pool.query(
    [
      'SELECT',
      '  i.indisunique AS is_unique,',
      '  i.indisvalid AS is_valid,',
      '  i.indpred IS NOT NULL AS is_partial,',
      '  i.indnkeyatts AS key_attribute_count,',
      '  i.indnatts AS total_attribute_count,',
      '  ARRAY(',
      '    SELECT a.attname::text',
      '    FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, position)',
      '    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key.attnum',
      '    WHERE key.position <= i.indnkeyatts',
      '    ORDER BY key.position',
      '  ) AS columns',
      'FROM pg_index i',
      'JOIN pg_class index_relation ON index_relation.oid = i.indexrelid',
      'JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace',
      "WHERE index_schema.nspname = 'public'",
      '  AND index_relation.relname = $1',
    ].join('\n'),
    [name]
  );

  const label = 'Index public.' + name;
  assert.equal(result.rowCount, 1, label + ' must exist');
  const row = result.rows[0];
  assert.equal(row.is_valid, true, label + ' must be valid');
  assert.equal(row.is_unique, unique, label + ' uniqueness');
  assert.equal(row.is_partial, partial, label + ' predicate presence');
  assert.equal(row.key_attribute_count, columns.length, label + ' key column count');
  assert.equal(row.total_attribute_count, columns.length, label + ' included column count');
  assert.deepEqual(row.columns, columns, label + ' ordered columns');
}

try {
  const requiredTables = [
    'profiles',
    'conversations',
    'messages',
    'memory_entries',
    'phonelink_pairings',
    'phonelink_devices',
    'phonelink_events',
    'phonelink_device_exchanges',
    'community_feedback_submissions',
    'community_beta_interest',
    'ryanai_attachment_scans',
    'ryanai_attachment_upload_events',
    'checkpoint_migrations',
    'checkpoints',
    'checkpoint_blobs',
    'checkpoint_writes',
  ];
  const tables = await pool.query(
    'SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename = ANY($2::text[])',
    ['public', requiredTables]
  );
  const presentTables = new Set(tables.rows.map((row) => row.tablename));
  for (const table of requiredTables) {
    assert.ok(presentTables.has(table), 'Supabase fresh stack must contain public.' + table);
  }

  // Keep Auth as an external owner while asserting every required relationship.
  await assertForeignKey({
    table: 'profiles',
    constraint: 'profiles_id_fkey',
    targetSchema: 'auth',
    targetTable: 'users',
    sourceColumns: ['id'],
    targetColumns: ['id'],
    onDelete: 'c',
  });
  await assertForeignKey({
    table: 'conversations',
    constraint: 'conversations_user_id_fkey',
    targetSchema: 'auth',
    targetTable: 'users',
    sourceColumns: ['user_id'],
    targetColumns: ['id'],
    onDelete: 'c',
  });
  await assertForeignKey({
    table: 'memory_entries',
    constraint: 'memory_entries_user_id_fkey',
    targetSchema: 'auth',
    targetTable: 'users',
    sourceColumns: ['user_id'],
    targetColumns: ['id'],
    onDelete: 'c',
  });
  await assertForeignKey({
    table: 'messages',
    constraint: 'messages_conversation_id_fkey',
    targetSchema: 'public',
    targetTable: 'conversations',
    sourceColumns: ['conversation_id'],
    targetColumns: ['id'],
    onDelete: 'c',
    onUpdate: 'a',
  });

  await assertForeignKey({
    table: 'phonelink_pairings',
    constraint: 'phonelink_pairings_user_id_fkey',
    targetSchema: 'auth',
    targetTable: 'users',
    sourceColumns: ['user_id'],
    targetColumns: ['id'],
    onDelete: 'c',
  });
  await assertForeignKey({
    table: 'phonelink_devices',
    constraint: 'phonelink_devices_user_id_fkey',
    targetSchema: 'auth',
    targetTable: 'users',
    sourceColumns: ['user_id'],
    targetColumns: ['id'],
    onDelete: 'c',
  });
  await assertForeignKey({
    table: 'phonelink_events',
    constraint: 'phonelink_events_user_id_fkey',
    targetSchema: 'auth',
    targetTable: 'users',
    sourceColumns: ['user_id'],
    targetColumns: ['id'],
    onDelete: 'c',
  });
  await assertForeignKey({
    table: 'phonelink_events',
    constraint: 'phonelink_events_device_id_fkey',
    targetSchema: 'public',
    targetTable: 'phonelink_devices',
    sourceColumns: ['device_id'],
    targetColumns: ['id'],
    onDelete: 'c',
  });
  await assertForeignKey({
    table: 'phonelink_device_exchanges',
    constraint: 'phonelink_device_exchanges_device_id_fkey',
    targetSchema: 'public',
    targetTable: 'phonelink_devices',
    sourceColumns: ['device_id'],
    targetColumns: ['id'],
    onDelete: 'c',
  });

  const uidDefaults = await pool.query(
    [
      'SELECT table_name, column_name, column_default',
      'FROM information_schema.columns',
      "WHERE table_schema = 'public'",
      '  AND (table_name, column_name) IN (',
      "    ('conversations', 'user_id'),",
      "    ('memory_entries', 'user_id')",
      '  )',
    ].join('\n')
  );
  assert.equal(uidDefaults.rowCount, 2, 'Both Supabase owner columns must be present');
  for (const row of uidDefaults.rows) {
    assert.match(row.column_default ?? '', /auth\.uid\(\)/i,
      row.table_name + '.' + row.column_name + ' must retain its auth.uid() default');
  }

  const sharedTimestamps = await pool.query(
    [
      'SELECT table_name, column_name, data_type, datetime_precision',
      'FROM information_schema.columns',
      "WHERE table_schema = 'public'",
      '  AND (table_name, column_name) IN (',
      "    ('profiles', 'created_at'),",
      "    ('profiles', 'updated_at'),",
      "    ('conversations', 'created_at'),",
      "    ('conversations', 'updated_at'),",
      "    ('messages', 'created_at'),",
      "    ('memory_entries', 'created_at')",
      '  )',
    ].join('\n')
  );
  assert.equal(sharedTimestamps.rowCount, 6, 'All canonical shared timestamp columns must exist');
  for (const row of sharedTimestamps.rows) {
    assert.equal(row.data_type, 'timestamp with time zone',
      row.table_name + '.' + row.column_name + ' must match the Supabase timestamptz baseline');
    assert.equal(row.datetime_precision, 6,
      row.table_name + '.' + row.column_name + ' must use Supabase microsecond precision');
  }

  await assertIndex('memory_entries_user_key_idx', {
    columns: ['user_id', 'key'],
    unique: true,
  });
  await assertIndex('checkpoints_thread_id_idx', { columns: ['thread_id'] });
  await assertIndex('checkpoint_blobs_thread_id_idx', { columns: ['thread_id'] });
  await assertIndex('checkpoint_writes_thread_id_idx', { columns: ['thread_id'] });

  await assertIndex('phonelink_pairings_user_expiry_idx', { columns: ['user_id', 'expires_at'] });
  await assertIndex('phonelink_devices_user_status_idx', { columns: ['user_id', 'status'] });
  await assertIndex('phonelink_events_device_status_idx', {
    columns: ['device_id', 'status', 'created_at'],
  });
  await assertIndex('phonelink_device_exchanges_expiry_idx', { columns: ['expires_at'] });
  await assertIndex('phonelink_devices_device_token_hash_idx', {
    columns: ['device_token_hash'],
    unique: true,
    partial: true,
  });

  await assertIndex('ryanai_attachment_scans_queue_idx', {
    columns: ['status', 'created_at'],
    partial: true,
  });
  await assertIndex('ryanai_attachment_upload_events_user_created_idx', {
    columns: ['user_id', 'created_at'],
  });
  await assertIndex('community_feedback_submissions_created_at_idx', {
    columns: ['created_at'],
  });
  await assertIndex('community_beta_interest_created_at_idx', {
    columns: ['created_at'],
  });

  const rlsTables = await pool.query(
    'SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = $1 AND tablename = ANY($2::text[])',
    [
      'public',
      [
        'profiles',
        'conversations',
        'messages',
        'memory_entries',
        'phonelink_pairings',
        'phonelink_devices',
        'phonelink_events',
        'phonelink_device_exchanges',
        'ryanai_attachment_scans',
        'ryanai_attachment_upload_events',
      ],
    ]
  );
  assert.equal(rlsTables.rowCount, 10, 'All owner-data tables must be present for RLS validation');
  assert.ok(rlsTables.rows.every((row) => row.rowsecurity),
    'Every listed owner-data table must keep row-level security enabled');

  console.log('PASS: Supabase shared defaults, Auth relationships, memory uniqueness, LangGraph indexes, and Supabase-owned table contracts are exact.');
} finally {
  await pool.end();
}
