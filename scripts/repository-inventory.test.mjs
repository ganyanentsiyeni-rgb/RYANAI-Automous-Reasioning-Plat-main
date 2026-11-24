import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { generateRepositoryInventory } from './repository-inventory.mjs';

async function fixtureRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ryanai-inventory-'));
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'ignored'), { recursive: true });
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture-app',
      packageManager: 'npm@10.9.2',
      engines: { node: '24.x' },
      scripts: { validate: 'node scripts/check.mjs', build: 'vite build' },
    }),
  );
  await writeFile(path.join(root, 'scripts', 'check.mjs'), 'process.exit(0);\n');
  await writeFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
  await writeFile(path.join(root, 'node_modules', 'ignored', 'package.json'), '{}');
  return root;
}

test('inventory is read-only: it reports that no command ran and no environment value was read', async () => {
  const root = await fixtureRepo();
  try {
    const inventory = await generateRepositoryInventory({ rootDir: root });
    assert.equal(inventory.mode, 'READ_ONLY_STATIC_INVENTORY');
    assert.equal(inventory.commandsExecuted, false);
    assert.equal(inventory.environmentValuesRead, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inventory lists package scripts as NOT_EXECUTED, sorted by name, with engine and manager metadata', async () => {
  const root = await fixtureRepo();
  try {
    const inventory = await generateRepositoryInventory({ rootDir: root });
    const pkg = inventory.packages.find((item) => item.path === 'package.json');
    assert.ok(pkg, 'root package.json should be inventoried');
    assert.equal(pkg.name, 'fixture-app');
    assert.equal(pkg.packageManager, 'npm@10.9.2');
    assert.equal(pkg.nodeEngine, '24.x');
    assert.deepEqual(
      pkg.scripts.map((script) => script.name),
      ['build', 'validate'],
    );
    assert.ok(pkg.scripts.every((script) => script.status === 'NOT_EXECUTED'));
    assert.equal(inventory.packageScriptCount, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inventory skips ignored directories such as node_modules', async () => {
  const root = await fixtureRepo();
  try {
    const inventory = await generateRepositoryInventory({ rootDir: root });
    assert.ok(!inventory.packages.some((item) => item.path.includes('node_modules')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inventory finds GitHub workflow files and repository scripts', async () => {
  const root = await fixtureRepo();
  try {
    const inventory = await generateRepositoryInventory({ rootDir: root });
    assert.deepEqual(
      inventory.workflows.map((item) => item.path),
      ['.github/workflows/ci.yml'],
    );
    assert.ok(inventory.repositoryScripts.some((item) => item.path === 'scripts/check.mjs'));
    assert.ok(inventory.repositoryScripts.every((item) => item.status === 'NOT_EXECUTED'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an unparseable package manifest is reported as INVALID_MANIFEST instead of failing the inventory', async () => {
  const root = await fixtureRepo();
  try {
    await mkdir(path.join(root, 'broken'), { recursive: true });
    await writeFile(path.join(root, 'broken', 'package.json'), '{ not json');
    const inventory = await generateRepositoryInventory({ rootDir: root });
    const broken = inventory.packages.find((item) => item.path === 'broken/package.json');
    assert.equal(broken.status, 'INVALID_MANIFEST');
    assert.equal(broken.name, null);
    assert.deepEqual(broken.scripts, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inventory stops promptly when its worker signal is aborted', async () => {
  const root = await fixtureRepo();
  const controller = new AbortController();
  controller.abort(new Error('worker shutdown'));
  try {
    await assert.rejects(
      generateRepositoryInventory({ rootDir: root, signal: controller.signal }),
      /worker shutdown/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
