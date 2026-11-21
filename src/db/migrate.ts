/**
 * Apply an explicitly approved Prisma migration.
 *
 * Application startup performs read-only schema readiness checks and never
 * applies DDL. Production execution is limited to one allowlisted migration
 * after checking the database's complete migration history and checksums.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { Pool } from 'pg';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveSupabaseSessionPoolerUrl } from '../server/supabasePooler.js';
import {
  assertAppliedMigrationChecksumsMatch,
  assertOnlyApprovedMigrationPending,
  stageApprovedPrismaMigration,
} from './scopedPrismaMigration.js';

const prismaCli = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');

async function runPrismaMigration(schemaPath) {
  const args = [prismaCli, 'migrate', 'deploy'];
  if (schemaPath) args.push('--schema', schemaPath);

  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', () => reject(new Error('Failed to start the Prisma migration CLI.')));
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Prisma migration deployment failed with exit code ${code ?? 'unknown'}.`));
    });
  });
}

async function readLocalMigrationChecksums(prismaDirectory, migrationNames) {
  const entries = await Promise.all(migrationNames.map(async (name) => {
    const sql = await readFile(join(prismaDirectory, 'migrations', name, 'migration.sql'));
    return [name, createHash('sha256').update(sql).digest('hex')];
  }));
  return Object.fromEntries(entries);
}

async function runProductionMigration(databaseUrl) {
  const prismaDirectory = resolve(process.cwd(), 'prisma');
  const migrationName = process.env.PRODUCTION_MIGRATION_NAME?.trim();
  if (!migrationName) {
    throw new Error('PRODUCTION_MIGRATION_NAME is required for production migration execution.');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
  });

  let temporaryDirectory;
  try {
    let history;
    try {
      const ledger = await pool.query(
        "SELECT to_regclass('public._prisma_migrations') AS ledger",
      );
      if (!ledger.rows[0]?.ledger) {
        throw new Error('missing');
      }
      history = await pool.query(
        'SELECT migration_name, checksum, finished_at, rolled_back_at FROM public."_prisma_migrations" ORDER BY migration_name',
      );
    } catch {
      throw new Error(
        'Production Prisma migration history is missing or unreadable; refusing to bootstrap or migrate.',
      );
    }

    const localEntries = await readdir(join(prismaDirectory, 'migrations'), { withFileTypes: true });
    const localMigrationNames = localEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const appliedMigrationRecords = history.rows
      .filter((row) => row.finished_at && !row.rolled_back_at);
    const appliedMigrationNames = appliedMigrationRecords.map((row) => row.migration_name);
    const unresolvedMigrationNames = history.rows
      .filter((row) => !row.finished_at)
      .map((row) => row.migration_name);

    const localMigrationChecksums = await readLocalMigrationChecksums(
      prismaDirectory,
      localMigrationNames,
    );
    assertAppliedMigrationChecksumsMatch({
      localMigrationChecksums,
      appliedMigrationRecords,
    });

    assertOnlyApprovedMigrationPending({
      localMigrationNames,
      appliedMigrationNames,
      unresolvedMigrationNames,
      migrationName,
    });

    temporaryDirectory = await mkdtemp(join(tmpdir(), 'ryanai-approved-prisma-'));
    const schemaPath = await stageApprovedPrismaMigration({
      prismaDirectory,
      migrationName,
      destinationDirectory: temporaryDirectory,
    });

    await runPrismaMigration(schemaPath);
  } finally {
    await pool.end().catch(() => {});
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function main() {
  const originalDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!originalDatabaseUrl) {
    throw new Error('DATABASE_URL is required to apply committed Prisma migrations.');
  }

  if (process.env.NODE_ENV !== 'production') {
    await runPrismaMigration(undefined);
    return;
  }

  const rootCertPath = process.env.SUPABASE_SSL_ROOT_CERT_PATH?.trim();
  if (!rootCertPath) {
    throw new Error('Production migrations require the verified Supabase root CA path.');
  }

  try {
    accessSync(rootCertPath, constants.R_OK);
  } catch {
    throw new Error('Production migrations cannot read the configured Supabase root CA certificate.');
  }

  const resolution = resolveSupabaseSessionPoolerUrl(
    originalDatabaseUrl,
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SESSION_POOLER_HOST,
    rootCertPath,
  );

  if (
    !resolution.databaseUrl
    || !['rewritten', 'already-pooled'].includes(resolution.reason)
  ) {
    throw new Error(
      `Production migration database URL validation failed (${resolution.reason}); refusing to run.`,
    );
  }

  const resolvedUrl = new URL(resolution.databaseUrl);
  if (
    resolvedUrl.searchParams.get('sslmode') !== 'verify-full'
    || resolvedUrl.searchParams.get('sslrootcert') !== rootCertPath
    || resolvedUrl.searchParams.get('sslaccept') !== 'strict'
  ) {
    throw new Error('Production migration database URL does not enforce verified Supabase TLS.');
  }

  // Never print or otherwise expose the connection URL.
  process.env.DATABASE_URL = resolution.databaseUrl;
  await runProductionMigration(resolution.databaseUrl);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown migration error';
  console.error('Prisma migration blocked or failed:', message);
  process.exitCode = 1;
});
