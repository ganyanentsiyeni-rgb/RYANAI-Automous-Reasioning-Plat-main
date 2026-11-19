#!/usr/bin/env node
/**
 * One-shot, narrowly scoped initializer for the isolated Render RyanAI staging DB.
 * Does not use Prisma's Supabase-oriented production migration runner.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const RESOURCE_ID = 'dpg-dbtev2rm8hqs73anvf00-a';
const DATABASE_NAME = 'ryanai_database';
const DATABASE_USER = 'ryanai_database_user';
const MIGRATION = '20261101110000_communications_and_langgraph_checkpoint';
const REQUIRED = [
  'communication_conversations',
  'communication_messages',
  'checkpoint_migrations',
  'checkpoints',
  'checkpoint_blobs',
  'checkpoint_writes',
];

export function validateTarget(rawUrl) {
  if (!rawUrl) throw new Error('DATABASE_URL is required; refusing to run.');
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  if (/supabase|pooler|prod|production/i.test(host + ' ' + url.pathname)) {
    throw new Error('Supabase/pooler/production targets are forbidden.');
  }
  if (url.hostname !== RESOURCE_ID && !url.hostname.startsWith(RESOURCE_ID + '.')) {
    throw new Error('DATABASE_URL is not the approved Render staging PostgreSQL resource.');
  }
  if (decodeURIComponent(url.pathname.replace(/^\//, '')) !== DATABASE_NAME) {
    throw new Error('Database name does not match the approved staging database.');
  }
  if (decodeURIComponent(url.username) !== DATABASE_USER) {
    throw new Error('Database user does not match the approved staging database owner.');
  }
  return url;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  validateTarget(databaseUrl);
  if (process.env.RYANAI_STAGING_MIGRATION_APPROVED !== 'true') {
    throw new Error('Set RYANAI_STAGING_MIGRATION_APPROVED=true only for the approved one-shot staging operation.');
  }

  const sqlPath = resolve('prisma/migrations', MIGRATION, 'migration.sql');
  const migrationSql = await readFile(sqlPath, 'utf8');
  const checksum = createHash('sha256').update(migrationSql).digest('hex');
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ryanai-render-staging-langgraph-init'))");
    const identity = await client.query('SELECT current_database() AS db, current_user AS usr');
    if (identity.rows[0]?.db !== DATABASE_NAME || identity.rows[0]?.usr !== DATABASE_USER) {
      throw new Error('Connected database identity does not match the approved staging target.');
    }

    const platformState = await client.query("SELECT (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS public_table_count, (SELECT count(*)::int FROM information_schema.schemata WHERE schema_name IN ('auth', 'storage', 'realtime', 'vault', 'supabase_functions')) AS supabase_schema_count, (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'supabase_admin')) AS supabase_role_count, (SELECT count(*)::int FROM pg_extension WHERE extname <> 'plpgsql') AS unexpected_extension_count");
    const state = platformState.rows[0];
    if (Number(state.public_table_count) !== 0 || Number(state.supabase_schema_count) !== 0 || Number(state.supabase_role_count) !== 0 || Number(state.unexpected_extension_count) !== 0) {
      throw new Error('Unexpected database baseline (public tables, Supabase platform objects, or extensions found); refusing to initialize.');
    }

    const existing = await client.query(
      "SELECT name, to_regclass('public.' || name) IS NOT NULL AS present FROM unnest($1::text[]) AS t(name)",
      [REQUIRED],
    );
    const present = existing.rows.filter((row) => row.present).map((row) => row.name);
    if (present.length) {
      const evidence = await client.query(
        'SELECT migration_name, checksum FROM public._ryanai_staging_migration_evidence WHERE migration_name = $1',
        [MIGRATION],
      ).catch(() => ({ rows: [] }));
      if (evidence.rows.length === 1 && evidence.rows[0].checksum === checksum) {
        throw new Error('Migration evidence already exists; refusing to rerun. Verify readiness instead.');
      }
      throw new Error('Unexpected pre-existing target tables: ' + present.join(', ') + '. No changes applied.');
    }

    await client.query(`
      CREATE TABLE public._ryanai_staging_migration_evidence (
        migration_name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        database_name text NOT NULL,
        database_user text NOT NULL
      )
    `);
    await client.query(migrationSql);
    const verify = await client.query(
      "SELECT name, to_regclass('public.' || name) IS NOT NULL AS present FROM unnest($1::text[]) AS t(name)",
      [REQUIRED],
    );
    const missing = verify.rows.filter((row) => !row.present).map((row) => row.name);
    const version = await client.query('SELECT MAX(v)::int AS version FROM public.checkpoint_migrations');
    if (missing.length || Number(version.rows[0]?.version) < 5) {
      throw new Error('Post-migration verification failed; transaction will be rolled back.');
    }
    await client.query(
      'INSERT INTO public._ryanai_staging_migration_evidence (migration_name, checksum, database_name, database_user) VALUES ($1, $2, $3, $4)',
      [MIGRATION, checksum, DATABASE_NAME, DATABASE_USER],
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({
      status: 'applied_and_verified',
      target: DATABASE_NAME,
      migration: MIGRATION,
      requiredTables: REQUIRED,
      checkpointMigrationVersion: Number(version.rows[0].version),
      checksum,
    }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error('STAGING MIGRATION BLOCKED:', error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  });
}
