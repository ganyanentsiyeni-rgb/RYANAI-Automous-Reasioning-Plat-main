import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { auditApplicationLayers, APPLICATION_LAYERS } from './audit-application-layers.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ryanai-layers-'));
  for (const layer of APPLICATION_LAYERS) {
    for (const relativeRoot of layer.roots) {
      await mkdir(path.join(root, relativeRoot), { recursive: true });
    }
  }
  await mkdir(path.join(root, 'node_modules', 'ignored'), { recursive: true });
  await writeFile(path.join(root, 'src', 'pages', 'page.tsx'), "import { callApi } from '../services/api.js';\nexport const page = callApi;\n");
  await writeFile(path.join(root, 'src', 'services', 'api.ts'), 'export const callApi = () => true;\n');
  await writeFile(path.join(root, 'src', 'agent', 'reasoning.ts'), "import { callApi } from '../services/api.js';\nexport { callApi };\n");
  await writeFile(path.join(root, 'src', 'pages', 'missing.ts'), "import './not-present.js';\n");
  await writeFile(path.join(root, 'node_modules', 'ignored', 'ignored.ts'), 'throw new Error("must not be scanned");\n');
  return root;
}

test('audit is read-only and inventories the declared application layers', async () => {
  const root = await fixture();
  try {
    const report = await auditApplicationLayers({ rootDir: root });
    assert.equal(report.mode, 'READ_ONLY_STATIC_APPLICATION_LAYER_AUDIT');
    assert.equal(report.commandsExecuted, false);
    assert.equal(report.environmentValuesRead, false);
    assert.equal(report.networkCallsMade, false);
    assert.equal(report.runtimeExecutionVerified, false);
    assert.equal(report.layers.length, 8);
    assert.ok(report.layers.every((layer) => layer.status === 'INVENTORIED'));
    assert.equal(report.status, 'STATIC_BASELINE_READY_FOR_REVIEW');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('audit maps relative imports into cross-layer dependency edges', async () => {
  const root = await fixture();
  try {
    const report = await auditApplicationLayers({ rootDir: root });
    const edge = report.crossLayerDependencies.find((item) => item.from === 'experience' && item.to === 'application');
    assert.ok(edge);
    assert.ok(edge.imports >= 1);
    assert.ok(edge.examples.some((example) => example.source === 'src/pages/page.tsx'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('audit reports unresolved relative imports without treating them as successful dependencies', async () => {
  const root = await fixture();
  try {
    const report = await auditApplicationLayers({ rootDir: root });
    assert.ok(report.unresolvedRelativeImports.some((item) => item.source === 'src/pages/missing.ts' && item.specifier === './not-present.js'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('audit ignores dependency folders and does not execute discovered source', async () => {
  const root = await fixture();
  try {
    const report = await auditApplicationLayers({ rootDir: root });
    assert.ok(!report.unclassifiedSourceFiles.some((file) => file.includes('node_modules')));
    assert.equal(report.commandsExecuted, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('audit rejects a layer root that escapes the repository', async () => {
  const root = await fixture();
  try {
    await assert.rejects(
      auditApplicationLayers({ rootDir: root, layers: [{ id: 'escape', name: 'Escape', roots: ['../outside'] }] }),
      /escapes repository/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('audit responds to cancellation before traversing', async () => {
  const root = await fixture();
  const controller = new AbortController();
  controller.abort(new Error('cancelled audit'));
  try {
    await assert.rejects(auditApplicationLayers({ rootDir: root, signal: controller.signal }), /cancelled audit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
