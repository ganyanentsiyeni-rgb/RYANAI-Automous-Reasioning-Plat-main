#!/usr/bin/env node
/**
 * Read-only structural audit for the Supabase Auth identity bridge and Prisma
 * agent queue tables. This tool only opens a READ ONLY transaction and issues
 * SELECT statements against PostgreSQL catalogs. It never reads application
 * rows, changes schema objects, or reads/writes the Prisma migration ledger.
 */
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TABLES = ['users', 'agent_runs', 'coding_tasks', 'agent_handoffs', 'agent_brain_health'];

const COLUMN_CONTRACTS = {
  users: {
    id: ['text', false, null], email: ['text', false, null],
    password_hash: ['text', true, null], name: ['text', true, null],
    created_at: ['timestamp(3) without time zone', false, 'now'],
    updated_at: ['timestamp(3) without time zone', false, null],
  },
  agent_runs: {
    id: ['text', false, null], user_id: ['text', false, null], objective: ['text', false, null],
    requested_model: ['text', true, null], trace_context: ['jsonb', true, null],
    execution_scope: ['jsonb', false, "'{}'"], approval_status: ['text', false, "'approved'"],
    plan_snapshot: ['jsonb', true, null], plan_hash: ['text', true, null],
    base_commit_sha: ['text', true, null], proposed_diff_hash: ['text', true, null],
    approved_plan_hash: ['text', true, null], approved_commit_sha: ['text', true, null],
    approved_diff_hash: ['text', true, null], approved_by: ['text', true, null],
    approved_at: ['timestamp(3) without time zone', true, null],
    steering_notes: ['text', true, null], cancel_requested_at: ['timestamp(3) without time zone', true, null],
    status: ['text', false, "'queued'"], result: ['jsonb', true, null], error: ['text', true, null],
    attempts: ['integer', false, '0'], max_attempts: ['integer', false, '3'],
    worker_id: ['text', true, null], locked_at: ['timestamp(3) without time zone', true, null],
    lease_expires_at: ['timestamp(3) without time zone', true, null],
    heartbeat_at: ['timestamp(3) without time zone', true, null],
    next_attempt_at: ['timestamp(3) without time zone', false, 'now'],
    created_at: ['timestamp(3) without time zone', false, 'now'],
    updated_at: ['timestamp(3) without time zone', false, 'now'],
    completed_at: ['timestamp(3) without time zone', true, null],
    queue_type: ['text', false, "'reasoning'"],
  },
  coding_tasks: {
    id: ['text', false, null], user_id: ['text', false, null], workbench_run_id: ['text', false, null],
    approval_id: ['text', false, null], plan_hash: ['text', false, null],
    base_commit_sha: ['text', false, null], proposed_diff_hash: ['text', false, null],
    agent: ['text', false, null], prompt: ['text', false, null], workspace_key: ['text', false, null],
    status: ['text', false, "'queued'"], attempts: ['integer', false, '0'], max_attempts: ['integer', false, '3'],
    worker_id: ['text', true, null], locked_at: ['timestamp(6) with time zone', true, null],
    lease_expires_at: ['timestamp(6) with time zone', true, null],
    heartbeat_at: ['timestamp(6) with time zone', true, null],
    next_attempt_at: ['timestamp(6) with time zone', false, 'now'],
    cancel_requested_at: ['timestamp(6) with time zone', true, null], result: ['jsonb', true, null],
    error: ['text', true, null], created_at: ['timestamp(6) with time zone', false, 'now'],
    updated_at: ['timestamp(6) with time zone', false, 'now'],
    completed_at: ['timestamp(6) with time zone', true, null],
  },
  agent_handoffs: {
    id: ['text', false, null], run_id: ['text', false, null], from_agent: ['text', false, null],
    to_agent: ['text', false, null], status: ['text', false, "'pending'"], input: ['text', false, null],
    output: ['text', true, null], error: ['text', true, null],
    started_at: ['timestamp(3) without time zone', false, 'now'],
    completed_at: ['timestamp(3) without time zone', true, null],
  },
  agent_brain_health: {
    id: ['text', false, null], brain: ['text', false, null], model: ['text', false, null],
    status: ['text', false, null], latency_ms: ['integer', true, null],
    last_success_at: ['timestamp(3) without time zone', true, null],
    last_error: ['text', true, null], checked_at: ['timestamp(3) without time zone', false, 'now'],
  },
};

const INDEX_CONTRACTS = [
  ['users_email_key', 'users', 'unique (email)'],
  ['agent_runs_user_id_created_at_idx', 'agent_runs', '(user_id, created_at)'],
  ['agent_runs_status_created_at_idx', 'agent_runs', '(status, created_at)'],
  ['agent_runs_status_locked_at_idx', 'agent_runs', '(status, locked_at)'],
  ['agent_runs_status_next_attempt_at_idx', 'agent_runs', '(status, next_attempt_at)'],
  ['agent_runs_queue_type_status_created_idx', 'agent_runs', '(queue_type, status, created_at)'],
  ['agent_runs_status_next_attempt_lease_idx', 'agent_runs', '(status, next_attempt_at, lease_expires_at)'],
  ['agent_runs_worker_lease_idx', 'agent_runs', '(worker_id, lease_expires_at)'],
  ['agent_runs_approval_status_created_idx', 'agent_runs', '(approval_status, created_at)'],
  ['coding_tasks_status_next_attempt_idx', 'coding_tasks', '(status, next_attempt_at, created_at)'],
  ['coding_tasks_status_lease_expiry_idx', 'coding_tasks', '(status, lease_expires_at)'],
  ['coding_tasks_user_created_idx', 'coding_tasks', '(user_id, created_at desc)'],
  ['coding_tasks_workbench_run_idx', 'coding_tasks', '(workbench_run_id, created_at desc)'],
  ['agent_handoffs_run_id_started_at_idx', 'agent_handoffs', '(run_id, started_at)'],
  ['agent_brain_health_brain_key', 'agent_brain_health', 'unique (brain)'],
];

const PK_CONTRACTS = ['users', 'agent_runs', 'coding_tasks', 'agent_handoffs', 'agent_brain_health'];

const FK_CONTRACTS = [
  ['agent_runs_user_id_fkey', 'agent_runs', 'foreign key (user_id) references users(id)', 'cascade', 'cascade'],
  ['coding_tasks_user_id_fkey', 'coding_tasks', 'foreign key (user_id) references users(id)', 'cascade', 'no action'],
  ['coding_tasks_workbench_run_id_fkey', 'coding_tasks', 'foreign key (workbench_run_id) references agent_runs(id)', 'cascade', 'no action'],
  ['agent_handoffs_run_id_fkey', 'agent_handoffs', 'foreign key (run_id) references agent_runs(id)', 'cascade', 'cascade'],
];

const TRIGGER_CONTRACTS = [
  ['ryanai_auth_user_sync_insert', 'after insert on auth.users'],
  ['ryanai_auth_user_sync_update', 'after update of email, raw_user_meta_data on auth.users'],
  ['ryanai_auth_user_sync_delete', 'after delete on auth.users'],
];

const normalize = (value) => String(value ?? '').toLowerCase()
  .replace(/"/g, '').replace(/\bpublic\./g, '').replace(/\bauth\./g, 'auth.')
  .replace(/\s+/g, ' ').trim();

function normalizeDefault(value) {
  if (value == null) return null;
  return normalize(value).replace(/::[a-z0-9_ ]+/g, '').replace(/[()]/g, (m) => m)
    .replace(/current_timestamp/g, 'now').replace(/now\(\)/g, 'now')
    .replace(/^\((.*)\)$/g, '$1').trim();
}

function finding(findings, object, expected, actual, present, matches) {
  findings.push({
    object,
    status: expected === 'absent' && !present ? 'matching' : !present ? 'missing' : matches ? 'matching' : 'structurally_wrong',
    recommendedRepairClass: expected === 'absent' && !present ? 'no_action' : !present ? 'create_after_review' : matches ? 'no_action' : 'alter_or_recreate_after_dependency_review',
    expected,
    actual: actual ?? null,
  });
}

function actionFromDefinition(definition, action) {
  const match = normalize(definition).match(new RegExp('on ' + action + ' (no action|restrict|cascade|set null|set default)'));
  return match?.[1] ?? 'no action';
}

export function assessStructuralContract(snapshot) {
  const findings = [];
  const tableMap = new Map((snapshot.tables ?? []).map((row) => [row.table_name, row]));
  const columnMap = new Map((snapshot.columns ?? []).map((row) => [row.table_name + '.' + row.column_name, row]));
  const indexMap = new Map((snapshot.indexes ?? []).map((row) => [row.indexname, row]));
  const constraintMap = new Map((snapshot.constraints ?? []).map((row) => [row.conname, row]));
  const triggerMap = new Map((snapshot.triggers ?? []).map((row) => [row.tgname, row]));
  const functionRow = (snapshot.functions ?? []).find((row) => row.proname === 'sync_ryanai_auth_user');

  for (const table of TABLES) {
    const row = tableMap.get(table);
    finding(findings, 'table public.' + table, 'ordinary table', row?.relkind ?? null, Boolean(row), row?.relkind === 'r');
  }

  for (const [table, columns] of Object.entries(COLUMN_CONTRACTS)) {
    for (const [column, [type, nullable, expectedDefault]] of Object.entries(columns)) {
      const key = table + '.' + column;
      const row = columnMap.get(key);
      const actualDefault = normalizeDefault(row?.column_default);
      const expectedDefaultNormalized = expectedDefault === null ? null : normalizeDefault(expectedDefault);
      const matches = Boolean(row)
        && normalize(row.formatted_type) === normalize(type)
        && Boolean(row.is_nullable === false || row.is_nullable === 'NO') === !nullable
        && actualDefault === expectedDefaultNormalized;
      finding(findings, 'column public.' + key,
        { type, nullable, default: expectedDefault },
        row ? { type: row.formatted_type, nullable: row.is_nullable, default: row.column_default } : null,
        Boolean(row), matches);
    }
  }

  // Prisma @map fields absent from these models must not be silently added as a
  // substitute for the actual contract.
  for (const absent of ['agent_handoffs.updated_at']) {
    const row = columnMap.get(absent);
    finding(findings, 'column public.' + absent, 'absent', row ?? null, Boolean(row), !row);
  }

  for (const [name, table, definition] of INDEX_CONTRACTS) {
    const row = indexMap.get(name);
    const actual = normalize(row?.indexdef);
    const expected = normalize(definition);
    const matches = Boolean(row) && actual.includes('using btree') && !/\swhere\s/.test(actual)
      && (definition.startsWith('unique ') ? actual.includes('create unique index') && actual.includes(expected.slice('unique '.length)) : actual.includes(expected));
    finding(findings, 'index public.' + table + '.' + name, definition, row?.indexdef ?? null, Boolean(row), matches);
  }

  for (const table of PK_CONTRACTS) {
    const name = table + '_pkey';
    const row = constraintMap.get(name);
    const actual = normalize(row?.definition);
    const matches = Boolean(row) && row.table_name === table && row.contype === 'p' && actual === 'primary key (id)';
    finding(findings, 'primary_key public.' + table + '.' + name, 'PRIMARY KEY (id)', row?.definition ?? null, Boolean(row), matches);
  }

  for (const [name, table, definition, onDelete, onUpdate] of FK_CONTRACTS) {
    const row = constraintMap.get(name);
    const actual = normalize(row?.definition);
    const matches = Boolean(row)
      && row.table_name === table
      && actual.includes(normalize(definition))
      && actionFromDefinition(actual, 'delete') === onDelete
      && actionFromDefinition(actual, 'update') === onUpdate;
    finding(findings, 'foreign_key public.' + table + '.' + name,
      { definition, onDelete, onUpdate },
      row ? { definition: row.definition, onDelete: actionFromDefinition(actual, 'delete'), onUpdate: actionFromDefinition(actual, 'update') } : null,
      Boolean(row), matches);
  }

  for (const [name, definition] of TRIGGER_CONTRACTS) {
    const row = triggerMap.get(name);
    const actual = normalize(row?.definition);
    const matches = Boolean(row) && row.table_schema === 'auth' && row.table_name === 'users'
      && actual.includes(normalize(definition)) && row.tgenabled === 'O';
    finding(findings, 'trigger auth.users.' + name,
      { definition, enabled: true },
      row ? { definition: row.definition, enabled: row.tgenabled === 'O' } : null,
      Boolean(row), matches);
  }

  const functionDefinition = normalize(functionRow?.function_definition);
  const functionConfig = (functionRow?.proconfig ?? []).map(normalize).join(';');
  const functionChecks = [
    ['function public.sync_ryanai_auth_user security mode', 'SECURITY DEFINER', functionDefinition.includes('security definer')],
    ['function public.sync_ryanai_auth_user search_path', "set search_path = ''", functionConfig.includes('search_path=""') || functionDefinition.includes("set search_path = ''") || functionDefinition.includes("set search_path to ''")],
    ['function public.sync_ryanai_auth_user empty-email fallback', "NULLIF(NEW.email, '') and auth-user-<id>@no-email.invalid", functionDefinition.includes("nullif(new.email, '')") && functionDefinition.includes("'auth-user-' || new.id::text || '@no-email.invalid'")],
    ['function public.sync_ryanai_auth_user auth timestamps', 'NEW.updated_at then NEW.created_at then pg_catalog.now(), cast timestamp(3)', functionDefinition.includes('coalesce(new.updated_at, new.created_at, pg_catalog.now())::timestamp(3)')],
    ['function public.sync_ryanai_auth_user name preservation', 'COALESCE(EXCLUDED.name, public.users.name), without trimming', functionDefinition.includes('coalesce(excluded.name, users.name)') && !functionDefinition.includes('btrim(') && !functionDefinition.includes('trim(')],
    ['function public.sync_ryanai_auth_user conflict timestamp', 'updated_at = pg_catalog.now() on conflict', /updated_at\s*=\s*pg_catalog\.now\(\)/.test(functionDefinition)],
  ];
  for (const [object, expected, matches] of functionChecks) {
    finding(findings, object, expected, functionRow ? functionRow.function_definition : null, Boolean(functionRow), matches);
  }

  const usersTable = tableMap.get('users');
  finding(findings, 'RLS public.users', 'relrowsecurity = true', usersTable?.relrowsecurity ?? null,
    Boolean(usersTable), usersTable?.relrowsecurity === true);

  const grants = snapshot.grants ?? [];
  const hasGrant = (role, privilege) => grants.some((row) => row.table_name === 'users' && row.grantee === role && row.privilege_type === privilege);
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    const privileges = grants.filter((row) => row.table_name === 'users' && row.grantee === role).map((row) => row.privilege_type);
    finding(findings, 'grant public.users to ' + role, 'no table privileges', privileges, true, privileges.length === 0);
  }
  const servicePrivileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
  const serviceRolePrivileges = servicePrivileges.filter((privilege) => hasGrant('service_role', privilege));
  const hasAnyServiceRoleGrant = grants.some((row) => row.table_name === 'users' && row.grantee === 'service_role');
  finding(findings, 'grant public.users to service_role', 'service_role has SELECT, INSERT, UPDATE, DELETE',
    serviceRolePrivileges, hasAnyServiceRoleGrant,
    ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].every((privilege) => hasGrant('service_role', privilege)),
  );
  finding(findings, 'grant public.users to service_role', 'service_role has all table privileges',
    serviceRolePrivileges, hasAnyServiceRoleGrant,
    servicePrivileges.every((privilege) => hasGrant('service_role', privilege)));

  const functionGrants = snapshot.functionGrants ?? [];
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    const privileges = functionGrants.filter((row) => row.grantee === role).map((row) => row.privilege_type);
    finding(findings, 'execute public.sync_ryanai_auth_user for ' + role, 'EXECUTE revoked', privileges, true, privileges.length === 0);
  }

  const counts = {
    matching: findings.filter((item) => item.status === 'matching').length,
    missing: findings.filter((item) => item.status === 'missing').length,
    structurally_wrong: findings.filter((item) => item.status === 'structurally_wrong').length,
  };
  return { counts, findings };
}

export function assessMigrationSourceContracts(sources) {
  const findings = [];
  const add = (object, expected, actual, matches) => finding(findings, object, expected, actual, actual !== null, matches);
  const coding = sources.codingQueue;
  const correction = sources.queueCorrection;
  const lease = sources.leaseHeartbeat;
  const authBridge = sources.authBridge;
  const agentOperations = sources.agentOperations;
  add('migration Auth identity bridge trigger, function and privilege contract',
    'empty search_path; NULLIF email fallback; name COALESCE; exact auth.users triggers; client revoke and service_role grant',
    authBridge,
    Boolean(authBridge && /SECURITY DEFINER/i.test(authBridge)
      && /SET search_path\s*=\s*''/i.test(authBridge)
      && /COALESCE\(NULLIF\(NEW\.email, ''\),\s*'auth-user-'\s*\|\|\s*NEW\.id::text\s*\|\|\s*'@no-email\.invalid'\)/i.test(authBridge)
      && /COALESCE\(EXCLUDED\.name,\s*public\.users\.name\)/i.test(authBridge)
      && !/\btrim\s*\(/i.test(authBridge)
      && /CREATE TRIGGER ryanai_auth_user_sync_insert[\s\S]*?AFTER INSERT ON auth\.users/i.test(authBridge)
      && /CREATE TRIGGER ryanai_auth_user_sync_update[\s\S]*?AFTER UPDATE OF email, raw_user_meta_data ON auth\.users/i.test(authBridge)
      && /CREATE TRIGGER ryanai_auth_user_sync_delete[\s\S]*?AFTER DELETE ON auth\.users/i.test(authBridge)
      && /REVOKE ALL PRIVILEGES ON TABLE public\.users FROM PUBLIC, anon, authenticated/i.test(authBridge)
      && /GRANT ALL PRIVILEGES ON TABLE public\.users TO service_role/i.test(authBridge)));
  add('migration agent handoff and brain-health base contracts',
    'agent_handoffs TEXT input, timestamp(3) started_at, cascade FK and run/start index; brain health status without default and unique brain',
    agentOperations,
    Boolean(agentOperations && /"input" TEXT NOT NULL/i.test(agentOperations)
      && /"started_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/i.test(agentOperations)
      && /agent_handoffs_run_id_started_at_idx/i.test(agentOperations)
      && /agent_handoffs_run_id_fkey[\s\S]*?ON DELETE CASCADE ON UPDATE CASCADE/i.test(agentOperations)
      && /"status" TEXT NOT NULL,/i.test(agentOperations)
      && /agent_brain_health_brain_key/i.test(agentOperations)));
  add('migration coding_tasks required columns, foreign keys and indexes',
    'ten required columns; user/run ON DELETE CASCADE; four exact coding_tasks indexes',
    coding,
    Boolean(coding && ['id TEXT PRIMARY KEY','user_id TEXT NOT NULL','workbench_run_id TEXT NOT NULL','approval_id TEXT NOT NULL','plan_hash TEXT NOT NULL','base_commit_sha TEXT NOT NULL','proposed_diff_hash TEXT NOT NULL','agent TEXT NOT NULL','prompt TEXT NOT NULL','workspace_key TEXT NOT NULL'].every((fragment) => coding.toLowerCase().includes(fragment.toLowerCase()))
      && /user_id TEXT NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/i.test(coding)
      && /workbench_run_id TEXT NOT NULL REFERENCES public\.agent_runs\(id\) ON DELETE CASCADE/i.test(coding)
      && ['coding_tasks_status_next_attempt_idx','coding_tasks_status_lease_expiry_idx','coding_tasks_user_created_idx','coding_tasks_workbench_run_idx'].every((name) => coding.includes(name))));
  add('migration coding queue legacy classification',
    "approval_status = 'pending' OR plan_snapshot IS NOT NULL OR proposed_diff_hash IS NOT NULL",
    coding,
    Boolean(coding && /approval_status\s*=\s*'pending'/.test(coding)
      && /plan_snapshot\s+IS\s+NOT\s+NULL/.test(coding)
      && /proposed_diff_hash\s+IS\s+NOT\s+NULL/.test(coding)));
  add('migration pending reasoning queue correction',
    "pending AND plan_snapshot IS NULL AND proposed_diff_hash IS NULL => unclassified",
    correction,
    Boolean(correction && /queue_type\s*=\s*'unclassified'/.test(correction)
      && /approval_status\s*=\s*'pending'/.test(correction)
      && /plan_snapshot\s+IS\s+NULL/.test(correction)
      && /proposed_diff_hash\s+IS\s+NULL/.test(correction)));
  add('migration Auth identity backfill timestamp semantics',
    'backfill created_at and updated_at from auth.users values with timestamp(3) fallback',
    authBridge,
    Boolean(authBridge && /COALESCE\(au\.updated_at,\s*au\.created_at,\s*pg_catalog\.now\(\)\)::timestamp\(3\)/i.test(authBridge)
      && /COALESCE\(au\.created_at,\s*pg_catalog\.now\(\)\)::timestamp\(3\)/i.test(authBridge)));
  add('migration agent_runs lease timestamp precision',
    'lease_expires_at TIMESTAMP(3), heartbeat_at TIMESTAMP(3)',
    lease,
    Boolean(lease && /agent_runs[\s\S]*?lease_expires_at\s+TIMESTAMP\(3\)/i.test(lease)
      && /agent_runs[\s\S]*?heartbeat_at\s+TIMESTAMP\(3\)/i.test(lease)));
  add('migration coding_tasks heartbeat precision and backfill',
    'heartbeat_at TIMESTAMPTZ(6), running rows backfilled from locked_at then NOW()',
    lease,
    Boolean(lease && /coding_tasks[\s\S]*?heartbeat_at\s+TIMESTAMPTZ\(6\)/i.test(lease)
      && /UPDATE\s+public\.coding_tasks[\s\S]*?heartbeat_at\s*=\s*COALESCE\(locked_at,\s*NOW\(\)\)/i.test(lease)));
  return { counts: {
    matching: findings.filter((item) => item.status === 'matching').length,
    missing: findings.filter((item) => item.status === 'missing').length,
    structurally_wrong: findings.filter((item) => item.status === 'structurally_wrong').length,
  }, findings };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('BLOCKED: DATABASE_URL is required; its value is never printed.');
    process.exitCode = 2;
    return;
  }
  const root = resolve(process.cwd());
  const [authBridge, agentOperations, codingQueue, queueCorrection, leaseHeartbeat] = await Promise.all([
    readFile(resolve(root, 'prisma/migrations/20261102123000_supabase_auth_identity_bridge/migration.sql'), 'utf8'),
    readFile(resolve(root, 'prisma/migrations/20261030120000_agent_operations/migration.sql'), 'utf8'),
    readFile(resolve(root, 'prisma/migrations/20261104120000_isolated_coding_task_queue/migration.sql'), 'utf8'),
    readFile(resolve(root, 'prisma/migrations/20261108120000_correct_pending_reasoning_queue_classification/migration.sql'), 'utf8'),
    readFile(resolve(root, 'prisma/migrations/20261121120000_agent_run_lease_heartbeat/migration.sql'), 'utf8'),
  ]);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 8000,
    statement_timeout: 10000,
    options: '-c default_transaction_read_only=on',
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const [tables, columns, indexes, constraints, triggers, functions, grants, functionGrants] = await Promise.all([
      client.query("SELECT c.relname AS table_name, c.relkind, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname = ANY($1::text[])", [TABLES]),
      client.query("SELECT c.relname AS table_name, a.attname AS column_name, pg_catalog.format_type(a.atttypid,a.atttypmod) AS formatted_type, NOT a.attnotnull AS is_nullable, pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS column_default FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname = ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped", [TABLES]),
      client.query("SELECT tablename, indexname, indexdef FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename = ANY($1::text[])", [TABLES]),
      client.query("SELECT con.conname, src.relname AS table_name, con.contype, pg_catalog.pg_get_constraintdef(con.oid,true) AS definition FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class src ON src.oid=con.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=src.relnamespace WHERE n.nspname='public' AND src.relname = ANY($1::text[])", [TABLES]),
      client.query("SELECT tg.tgname, ns.nspname AS table_schema, cls.relname AS table_name, pg_catalog.pg_get_triggerdef(tg.oid,true) AS definition, tg.tgenabled FROM pg_catalog.pg_trigger tg JOIN pg_catalog.pg_class cls ON cls.oid=tg.tgrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=cls.relnamespace WHERE NOT tg.tgisinternal AND ns.nspname='auth' AND cls.relname='users' AND tg.tgname = ANY($1::text[])", [TRIGGER_CONTRACTS.map(([name]) => name)]),
      client.query("SELECT p.proname, pg_catalog.pg_get_functiondef(p.oid) AS function_definition, p.proconfig FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='sync_ryanai_auth_user'"),
      client.query("SELECT c.relname AS table_name, CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE r.rolname END AS grantee, acl.privilege_type FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r',c.relowner))) acl LEFT JOIN pg_catalog.pg_roles r ON r.oid=acl.grantee WHERE n.nspname='public' AND c.relname='users'"),
      client.query("SELECT CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE r.rolname END AS grantee, acl.privilege_type FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f',p.proowner))) acl LEFT JOIN pg_catalog.pg_roles r ON r.oid=acl.grantee WHERE n.nspname='public' AND p.proname='sync_ryanai_auth_user'"),
    ]);
    const structural = assessStructuralContract({
      tables: tables.rows, columns: columns.rows, indexes: indexes.rows, constraints: constraints.rows,
      triggers: triggers.rows, functions: functions.rows, grants: grants.rows, functionGrants: functionGrants.rows,
    });
    const migration = assessMigrationSourceContracts({ authBridge, agentOperations, codingQueue, queueCorrection, leaseHeartbeat });
    await client.query('COMMIT');
    console.log(JSON.stringify({
      mode: 'read-only',
      transaction: 'READ ONLY',
      ledger: 'not queried',
      application_rows: 'not queried',
      structural,
      migrationSource: migration,
      remediation: 'Review each finding and prepare a targeted forward repair plan. This audit never executes DDL.',
    }, null, 2));
    if (structural.counts.missing || structural.counts.structurally_wrong
      || migration.counts.missing || migration.counts.structurally_wrong) process.exitCode = 1;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error('Read-only structural audit failed:', error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  });
}
