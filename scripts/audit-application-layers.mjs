#!/usr/bin/env node
/**
 * Read-only application-layer inventory and relative-import topology report.
 * Does not execute discovered code, read environment values, or contact services.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const APPLICATION_LAYERS = [
  { id: 'experience', name: 'Experience', roots: ['src/pages', 'src/components', 'src/screens', 'apps/mobile', 'android'] },
  { id: 'application', name: 'Application and API', roots: ['src/routes', 'src/api', 'src/services', 'src/hooks'] },
  { id: 'governance', name: 'Identity, security and governance', roots: ['src/security', 'src/approvals', 'src/middleware'] },
  { id: 'orchestration', name: 'Orchestration and workforce', roots: ['src/agents', 'src/orchestrator', 'src/workers', 'src/scheduler'] },
  { id: 'reasoning', name: 'Reasoning and intelligence', roots: ['src/agent', 'src/engine', 'src/inference', 'models', 'quant-engine'] },
  { id: 'integration', name: 'Tools and integrations', roots: ['src/tools', 'src/mcp', 'src/plugins', 'src/integrations', 'mcp-server', 'comms-orchestration'] },
  { id: 'data', name: 'Data and persistence', roots: ['src/database', 'src/db', 'src/store', 'prisma', 'supabase'] },
  { id: 'platform', name: 'Runtime and platform', roots: ['src/server', 'src/config', 'src/observability', 'src/telemetry', 'observability', 'infra', 'ops', '.github/workflows'] },
];

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const IGNORED = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.vite', '.vercel', 'target', '.venv', 'venv']);
const IMPORT_PATTERN = /(?:\bimport\s+(?:[^'";]*?\s+from\s*)?|\bexport\s+[^'";]*?\s+from\s*|\bimport\s*\(|\brequire\s*\()(['"])(\.\.?\/[^'"]+)\1/g;
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_DEPTH = 24;

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error('Application layer audit cancelled.');
}

function normalize(value) {
  return value.split(path.sep).join('/');
}

async function walk(root, directory, depth, signal, files) {
  abortIfNeeded(signal);
  if (depth > MAX_DEPTH) throw new Error(`Application layer audit exceeded maximum depth at ${directory}`);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    abortIfNeeded(signal);
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED.has(entry.name)) await walk(root, absolute, depth + 1, signal, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(normalize(path.relative(root, absolute)));
      if (files.length > MAX_FILES) throw new Error(`Application layer audit exceeded ${MAX_FILES} source files`);
    }
  }
}

function layerFor(relativePath, layers) {
  const matches = layers.flatMap((layer) => layer.roots
    .filter((root) => relativePath === root || relativePath.startsWith(root + '/'))
    .map((root) => ({ id: layer.id, root })));
  matches.sort((a, b) => b.root.length - a.root.length);
  return matches[0]?.id ?? 'unclassified';
}

async function resolveRelativeImport(root, sourcePath, specifier) {
  const base = path.resolve(root, path.dirname(sourcePath), specifier);
  const candidates = [base];
  const ext = path.extname(base);
  if (ext) {
    if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
      candidates.push(base.slice(0, -ext.length) + '.ts', base.slice(0, -ext.length) + '.tsx');
    }
  } else {
    for (const suffix of SOURCE_EXTENSIONS) candidates.push(base + suffix);
    for (const suffix of SOURCE_EXTENSIONS) candidates.push(path.join(base, 'index' + suffix));
  }
  for (const candidate of candidates) {
    try {
      const stat = await import('node:fs/promises').then(({ stat }) => stat(candidate));
      if (stat.isFile()) return normalize(path.relative(root, candidate));
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    }
  }
  return null;
}

export async function auditApplicationLayers({
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  layers = APPLICATION_LAYERS,
  signal,
} = {}) {
  const root = path.resolve(rootDir);
  const layerResults = [];
  const allFiles = [];
  for (const layer of layers) {
    abortIfNeeded(signal);
    const roots = [];
    let fileCount = 0;
    for (const relativeRoot of layer.roots) {
      const absolute = path.resolve(root, relativeRoot);
      if (!absolute.startsWith(root + path.sep)) throw new Error(`Layer root escapes repository: ${relativeRoot}`);
      try {
        const { stat } = await import('node:fs/promises');
        const info = await stat(absolute);
        if (!info.isDirectory()) continue;
        roots.push(relativeRoot);
        const files = [];
        await walk(root, absolute, 0, signal, files);
        fileCount += files.length;
        allFiles.push(...files.map((file) => ({ path: file, layer: layer.id })));
      } catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      }
    }
    layerResults.push({
      id: layer.id,
      name: layer.name,
      declaredRoots: layer.roots,
      presentRoots: roots,
      sourceFileCount: fileCount,
      status: roots.length ? 'INVENTORIED' : 'MISSING',
    });
  }

  const layerByPath = new Map(allFiles.map((item) => [item.path, item.layer]));
  const crossLayerEdges = new Map();
  const unresolvedRelativeImports = [];
  const unclassifiedSourceFiles = allFiles.filter((item) => item.layer === 'unclassified').map((item) => item.path);

  for (const item of allFiles) {
    abortIfNeeded(signal);
    const absolute = path.join(root, item.path);
    const { size } = await import('node:fs/promises').then(({ stat }) => stat(absolute));
    if (size > MAX_FILE_BYTES) continue;
    const source = await readFile(absolute, { encoding: 'utf8', signal });
    IMPORT_PATTERN.lastIndex = 0;
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      abortIfNeeded(signal);
      const specifier = match[2];
      const target = await resolveRelativeImport(root, item.path, specifier);
      if (!target) {
        unresolvedRelativeImports.push({ source: item.path, specifier });
        continue;
      }
      const targetLayer = layerByPath.get(target) ?? layerFor(target, layers);
      if (targetLayer !== item.layer) {
        const key = item.layer + '->' + targetLayer;
        const current = crossLayerEdges.get(key) ?? { from: item.layer, to: targetLayer, imports: 0, examples: [] };
        current.imports += 1;
        if (current.examples.length < 5) current.examples.push({ source: item.path, target });
        crossLayerEdges.set(key, current);
      }
    }
  }

  const missingLayers = layerResults.filter((layer) => layer.status === 'MISSING').map((layer) => layer.id);
  return {
    schemaVersion: 1,
    mode: 'READ_ONLY_STATIC_APPLICATION_LAYER_AUDIT',
    generatedAt: new Date().toISOString(),
    commandsExecuted: false,
    environmentValuesRead: false,
    networkCallsMade: false,
    runtimeExecutionVerified: false,
    sourceFileCount: allFiles.length,
    layers: layerResults,
    crossLayerDependencies: [...crossLayerEdges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    unresolvedRelativeImports,
    unclassifiedSourceFiles,
    missingLayers,
    interpretation: {
      crossLayerDependencies: 'Observed relative-import edges only; an edge is not automatically a defect.',
      unresolvedRelativeImports: 'Relative imports not resolved by the bounded static resolver; aliases, generated files, and platform-specific resolution may require manual review.',
      unclassifiedSourceFiles: 'Source files outside the declared layer roots; they are not silently assigned to a layer.',
      runtime: 'Static inventory does not prove process startup, live worker heartbeats, provider health, authorization behavior, or production wiring.',
    },
    status: missingLayers.length ? 'REVIEW_REQUIRED' : 'STATIC_BASELINE_READY_FOR_REVIEW',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await auditApplicationLayers();
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.status === 'REVIEW_REQUIRED') process.exitCode = 1;
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}
