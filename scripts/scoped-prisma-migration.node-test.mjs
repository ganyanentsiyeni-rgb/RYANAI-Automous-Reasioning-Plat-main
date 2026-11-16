import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PRODUCTION_MIGRATION_ALLOWLIST,
  PRODUCTION_MIGRATION_EXCLUSIONS,
  assertOnlyApprovedMigrationPending,
  stageApprovedPrismaMigration,
} from '../src/db/scopedPrismaMigration.ts';

const WORKBENCH = '20261102235000_engineering_evidence_workbench';
const CODING_QUEUE = '20261104120000_isolated_coding_task_queue';

test('coding queue migration remains explicitly excluded pending independent human review', () => {
  assert.ok(!PRODUCTION_MIGRATION_ALLOWLIST.includes(CODING_QUEUE));
  assert.ok(PRODUCTION_MIGRATION_EXCLUSIONS.includes(CODING_QUEUE));
  assert.throws(() => assertOnlyApprovedMigrationPending({
    localMigrationNames: [WORKBENCH, CODING_QUEUE],
    appliedMigrationNames: [],
    migrationName: CODING_QUEUE,
  }), /not in the reviewed allowlist/);
});

test('production preflight allows the workbench migration while excluding coding queue DDL', () => {
  const result = assertOnlyApprovedMigrationPending({
    localMigrationNames: [WORKBENCH, CODING_QUEUE],
    appliedMigrationNames: [],
    migrationName: WORKBENCH,
  });
  assert.deepEqual(result.pendingMigrations, [WORKBENCH]);
  assert.deepEqual(result.excludedPendingMigrations, [CODING_QUEUE]);
});

test('production preflight rejects any additional unapproved pending migration', () => {
  assert.throws(() => assertOnlyApprovedMigrationPending({
    localMigrationNames: [WORKBENCH, CODING_QUEUE, '20261106120000_unreviewed_change'],
    appliedMigrationNames: [],
    migrationName: WORKBENCH,
  }), /no other unapproved pending migrations/);
});

test('production preflight fails closed for unresolved history and missing local history', () => {
  const input = {
    localMigrationNames: [WORKBENCH, CODING_QUEUE],
    appliedMigrationNames: [],
    migrationName: WORKBENCH,
  };
  assert.throws(() => assertOnlyApprovedMigrationPending({
    ...input,
    unresolvedMigrationNames: ['unfinished_migration'],
  }), /unfinished or rolled-back/);
  assert.throws(() => assertOnlyApprovedMigrationPending({
    ...input,
    appliedMigrationNames: ['migration_missing_from_checkout'],
  }), /missing from this checkout/);
});

test('production preflight fails closed if the excluded coding queue migration is already applied', () => {
  assert.throws(() => assertOnlyApprovedMigrationPending({
    localMigrationNames: [WORKBENCH, CODING_QUEUE],
    appliedMigrationNames: [CODING_QUEUE],
    migrationName: WORKBENCH,
  }), /explicitly excluded coding-task migration is already applied/);
});

test('staging preserves historical migrations but omits excluded coding queue DDL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryanai-scoped-prisma-'));
  const prismaDirectory = join(root, 'prisma');
  const migrationsDirectory = join(prismaDirectory, 'migrations');
  const destinationDirectory = join(root, 'staged');
  try {
    await mkdir(migrationsDirectory, { recursive: true });
    await writeFile(join(prismaDirectory, 'schema.prisma'), 'generator client {}\n');
    await writeFile(join(migrationsDirectory, 'migration_lock.toml'), 'provider = "postgresql"\n');
    for (const name of [WORKBENCH, CODING_QUEUE]) {
      const directory = join(migrationsDirectory, name);
      await mkdir(directory);
      await writeFile(join(directory, 'migration.sql'), '-- reviewed migration fixture\n');
    }

    await stageApprovedPrismaMigration({
      prismaDirectory,
      migrationName: WORKBENCH,
      destinationDirectory,
    });

    const staged = (await readdir(join(destinationDirectory, 'migrations'))).sort();
    assert.deepEqual(staged, ['migration_lock.toml', WORKBENCH].sort());
    await assert.rejects(
      () => readFile(join(destinationDirectory, 'migrations', CODING_QUEUE, 'migration.sql'), 'utf8'),
      { code: 'ENOENT' },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
