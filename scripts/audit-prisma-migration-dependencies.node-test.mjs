import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMigrationDependencies } from './audit-prisma-migration-dependencies.mjs';

test('reports clear supported create/alter/index dependency order without database access', () => {
  const result = analyzeMigrationDependencies([
    { id: '20261101000000_create_parent', sqlContent: 'CREATE TABLE parent (id text PRIMARY KEY);' },
    { id: '20261102000000_create_child', sqlContent: 'CREATE TABLE child (id text, parent_id text REFERENCES parent(id));' },
    { id: '20261103000000_add_index', sqlContent: 'CREATE INDEX child_parent_idx ON child(parent_id);' },
  ]);
  assert.equal(result.status, 'static_dependencies_clear');
  assert.equal(result.databaseQueried, false);
  assert.equal(result.sqlExecuted, false);
  assert.equal(result.compatibility, 'not_verified');
});

test('detects a foreign-key dependency on a table not yet created', () => {
  const result = analyzeMigrationDependencies([
    { id: '20261101000000_create_child', sqlContent: 'CREATE TABLE child (parent_id text REFERENCES parent(id));' },
    { id: '20261102000000_create_parent', sqlContent: 'CREATE TABLE parent (id text PRIMARY KEY);' },
  ]);
  assert.equal(result.status, 'static_dependencies_incomplete');
  assert.ok(result.findings.some(item => item.status === 'referenced_table_not_yet_created'));
});

test('detects alter and index statements before their table is created', () => {
  const result = analyzeMigrationDependencies([
    { id: '20261101000000_alter_missing', sqlContent: 'ALTER TABLE absent ADD COLUMN name text; CREATE INDEX absent_idx ON absent(name);' },
  ]);
  assert.ok(result.findings.some(item => item.status === 'alter_before_create_or_external_dependency'));
  assert.ok(result.findings.some(item => item.status === 'index_before_create_or_external_dependency'));
});

test('fails closed for missing SQL, duplicate IDs, and unsupported procedural SQL', () => {
  const result = analyzeMigrationDependencies([
    { id: '20261101000000_first', sqlContent: null },
    { id: '20261101000000_first', sqlContent: 'DO $$ BEGIN NULL; END $$;' },
  ]);
  assert.equal(result.status, 'static_dependencies_incomplete');
  assert.deepEqual(result.duplicateMigrationIds, ['20261101000000_first']);
  assert.deepEqual(result.missingFiles, ['20261101000000_first']);
  assert.ok(result.unsupported.some(item => item.includes('dollar_quoted_block')));
});

test('flags invalid migration identifiers', () => {
  const result = analyzeMigrationDependencies([{ id: 'bad_id', sqlContent: 'SELECT 1;' }]);
  assert.deepEqual(result.invalidMigrationIds, ['bad_id']);
  assert.equal(result.status, 'static_dependencies_incomplete');
});

test('keeps cross-schema dependencies explicitly unverified', () => {
  const result = analyzeMigrationDependencies([
    { id: '20261101000000_create_bridge', sqlContent: 'CREATE TABLE bridge (user_id text REFERENCES auth.users(id));' },
  ]);
  assert.equal(result.status, 'static_dependencies_incomplete');
  assert.equal(result.externalDependencies[0].dependency, 'auth.users');
  assert.equal(result.externalDependencies[0].status, 'external_dependency_not_verified');
});
