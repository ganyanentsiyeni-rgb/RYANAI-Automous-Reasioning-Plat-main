import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseDocument } from 'yaml';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validatorPath = path.join(repoRoot, 'scripts', 'validate-stack-manifest.mjs');
const sourceManifest = JSON.parse(readFileSync(path.join(repoRoot, 'stacks', 'ryanai.stack.json'), 'utf8'));
const sourceSchema = readFileSync(path.join(repoRoot, 'stacks', 'ryanai.stack.schema.json'), 'utf8');

function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ryanai-stack-validator-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const makeDir = (relative) => mkdirSync(path.join(dir, relative), { recursive: true });
  const put = (relative, value = '# fixture\n') => {
    const destination = path.join(dir, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, value, 'utf8');
  };

  makeDir('stacks');
  put('stacks/ryanai.stack.json', JSON.stringify(structuredClone(sourceManifest), null, 2));
  put('stacks/ryanai.stack.schema.json', sourceSchema);
  put('Dockerfile');
  put('mcp-server/Dockerfile');
  put('k8s/kustomization.yaml');
  put('k8s/ryanai-apps.yaml');
  put('k8s/ryanai-databases.yaml');
  put('.github/workflows/deploy-render.yml');
  put('.github/workflows/deploy-railway.yml');
  put('railway.json', JSON.stringify({ build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile.api' }, deploy: { healthcheckPath: '/health' } }));
  put('render.yaml');
  put('docker-compose.yml', [
    'services:',
    '  postgres:',
    '    image: postgres',
    '  redis:',
    '    image: redis',
    'volumes:',
    '  postgres_data:',
    '  redis_data:',
    '',
  ].join('\n'));

  return {
    dir,
    manifest: JSON.parse(readFileSync(path.join(dir, 'stacks/ryanai.stack.json'), 'utf8')),
    saveManifest(manifest) {
      writeFileSync(path.join(dir, 'stacks/ryanai.stack.json'), JSON.stringify(manifest, null, 2), 'utf8');
    },
  };
}

function validate(dir) {
  return spawnSync(process.execPath, [validatorPath], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env },
  });
}

test('accepts the repository stack manifest and schema', (t) => {
  const f = fixture(t);
  const result = validate(f.dir);
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /PASS RyanAI stack manifest, schema, path, and credential policy validated/);
});


test('rejects a stale repository source-of-truth reference', (t) => {
  const f = fixture(t);
  f.manifest.repository = 'RyanAI-Automated/RYANAI-Automous-Reasioning-Plat';
  f.saveManifest(f.manifest);

  const result = validate(f.dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Stack repository must match the authorised RyanAI source-of-truth repository/);
});

test('rejects dependencies that do not resolve to declared stack services', (t) => {
  const f = fixture(t);
  f.manifest.services[0].dependsOn.push('missing-worker');
  f.saveManifest(f.manifest);

  const result = validate(f.dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown dependency missing-worker declared by stack service api/);
});

test('rejects a service path that traverses outside the repository', (t) => {
  const f = fixture(t);
  f.manifest.services[0].dockerfile = '../outside.Dockerfile';
  f.saveManifest(f.manifest);

  const result = validate(f.dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dockerfile path must stay inside the repository/);
});

test('rejects absolute and traversal deployment targets', (t) => {
  const unsafeTargets = ['../outside.yaml', '/tmp/outside.yaml', 'C:\\outside.yaml'];
  for (const target of unsafeTargets) {
    const f = fixture(t);
    f.manifest.deploymentTargets.render = target;
    f.saveManifest(f.manifest);

    const result = validate(f.dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Deployment target must be a repository-relative path/);
  }
});

test('rejects a symlink whose target resolves outside the repository', (t) => {
  if (process.platform === 'win32') {
    t.skip('Creating file symlinks can require elevated privileges on Windows');
    return;
  }
  const f = fixture(t);
  const outside = path.join(os.tmpdir(), 'ryanai-validator-outside-' + path.basename(f.dir) + '.txt');
  writeFileSync(outside, 'not a project file', 'utf8');
  t.after(() => rmSync(outside, { force: true }));
  symlinkSync(outside, path.join(f.dir, 'Dockerfile-external'));

  f.manifest.services[0].dockerfile = 'Dockerfile-external';
  f.saveManifest(f.manifest);
  const result = validate(f.dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dockerfile path must stay inside the repository/);
});

test('reports malformed service entries without crashing', (t) => {
  const f = fixture(t);
  f.manifest.services[0] = null;
  f.saveManifest(f.manifest);

  const result = validate(f.dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Each stack service must be an object/);
  assert.doesNotMatch(result.stderr, /TypeError|Cannot read properties of null/);
});

test('rejects common credential key variants without echoing secret values', (t) => {
  const f = fixture(t);
  const credentialKeys = ['password', 'apiKey', 'api_key', 'client-secret', 'accessToken', 'authorization'];
  for (const key of credentialKeys) {
    f.manifest.services[0][key] = 'secret-fixture-value-do-not-print-' + key;
  }
  f.saveManifest(f.manifest);

  const result = validate(f.dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Do not store credentials in stack manifest/);
  for (const key of credentialKeys) {
    assert.ok(result.stderr.includes('.' + key), 'Expected credential policy to identify ' + key);
  }
  assert.doesNotMatch(result.stdout + result.stderr, /secret-fixture-value-do-not-print/);
});

test('enforces schema constraints on service ports', (t) => {
  const f = fixture(t);
  f.manifest.services[0].port = 0;
  f.saveManifest(f.manifest);

  const result = validate(f.dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid port for stack service/);
  assert.match(result.stderr, /Stack manifest does not conform to schema/);
});


test('Compose exposes the compiled Studio worker only through an explicit opt-in profile', () => {
  const composePath = path.join(repoRoot, 'docker-compose.yml');
  const document = parseDocument(readFileSync(composePath, 'utf8'), { uniqueKeys: true });
  assert.deepEqual(document.errors, [], document.errors.map((error) => error.message).join('\\n'));
  const worker = document.getIn(['services', 'studio-worker']);
  assert.ok(worker, 'studio-worker service must be declared');
  assert.deepEqual(worker.get('profiles')?.toJSON(), ['workers']);
  assert.equal(worker.getIn(['build', 'target']), 'studio-worker');
  assert.equal(worker.getIn(['build', 'dockerfile']), 'Dockerfile');
  assert.equal(worker.getIn(['environment', 'DATABASE_URL']), 'postgresql://ryanai:${DB_PASSWORD:?Set DB_PASSWORD in .env}@postgres:5432/ryanai_db');
  assert.equal(worker.getIn(['environment', 'STUDIO_WORKER_ENABLED']), 'true');
  assert.equal(worker.getIn(['depends_on', 'postgres', 'condition']), 'service_healthy');
  const dockerfile = readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
  assert.ok(dockerfile.includes('FROM api AS studio-worker'));
  assert.ok(dockerfile.includes('CMD ["node", "dist/server/server/engineering/studioWorker.js"]'));
});

test('docker-compose environment mapping has no duplicate keys', () => {
  const composePath = path.join(repoRoot, 'docker-compose.yml');
  const document = parseDocument(readFileSync(composePath, 'utf8'), { uniqueKeys: true });
  assert.deepEqual(document.errors, [], document.errors.map((error) => error.message).join('\\n'));
  const mcpEnvironment = document.getIn(['services', 'mcp-server', 'environment']);
  assert.equal(
    mcpEnvironment.items.filter((item) => item.key?.value === 'RYANAI_MCP_ENABLED_TOOLS').length,
    1,
    'mcp-server must declare RYANAI_MCP_ENABLED_TOOLS exactly once',
  );
});
