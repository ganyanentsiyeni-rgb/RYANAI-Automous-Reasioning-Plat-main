import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'server');
const PLUGIN_DIR = join(ROOT, 'plugins');

async function collectTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectTsFiles(full));
    else if (/\\.(?:ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function normalizeImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const absolute = join(fromFile, '..', specifier);
  return posix.normalize(absolute.replaceAll('\\\\', '/'));
}

export function isPluginImplementationImport(fromFile, specifier, serverRoot = ROOT) {
  const normalizedRoot = posix.normalize(serverRoot.replaceAll('\\\\', '/'));
  const pluginRoot = posix.join(normalizedRoot, 'plugins');
  let resolved = normalizeImport(fromFile, specifier);

  // TypeScript server aliases resolve to src/server/*; they must obey the
  // same boundary as relative imports.
  if (specifier.startsWith('@/server/plugins/')) {
    resolved = posix.join(normalizedRoot, 'plugins', specifier.slice('@/server/plugins/'.length));
  } else if (specifier === '@/server/plugins') {
    resolved = pluginRoot;
  }

  if (!resolved || !resolved.startsWith(pluginRoot + '/')) return false;
  return !/\\/index(?:\\.(?:[cm]?[jt]sx?))?$/.test(resolved);
}

export async function findPluginBoundaryViolations() {
  const files = await collectTsFiles(ROOT);
  const violations = [];
  for (const file of files) {
    if (file.startsWith(PLUGIN_DIR + '/') || file === PLUGIN_DIR) continue;
    const source = await readFile(file, 'utf8');
    const importPattern = /(?:from\\s+|import\\s*\\(\\s*)['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (isPluginImplementationImport(file, specifier)) {
        violations.push({
          file: relative(ROOT, file).replaceAll('\\\\', '/'),
          import: specifier,
        });
      }
    }
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = await findPluginBoundaryViolations();
  if (violations.length) {
    console.error(JSON.stringify({ boundary: 'server-plugins-public-api', violations }, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Backend module boundary check passed: external server consumers use the plugin public API.');
  }
}
