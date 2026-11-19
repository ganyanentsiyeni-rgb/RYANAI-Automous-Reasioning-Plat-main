import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('isolation harness contract requires network-disabled, hardened container execution', async () => {
  const contract = JSON.parse(await readFile('benchmarks/contracts/isolation-harness-contract.json', 'utf8'));
  assert.equal(contract.modelInvocation, false);
  assert.equal(contract.container.networkMode, 'none');
  assert.equal(contract.container.readOnlyRootFilesystem, true);
  assert.equal(contract.container.dropAllCapabilities, true);
  assert.equal(contract.container.noNewPrivileges, true);
  assert.equal(contract.container.dockerSocketMounted, false);
  assert.equal(contract.container.hostEnvironmentPassed, false);
  assert.equal(contract.container.repositoryMount, 'three-file-allowlist');
  assert.equal(contract.successMeaning, 'HARNESS_PASS_ONLY_NOT_GATE_PASS');
  assert.ok(contract.requiredChecks.includes('public-ip-egress-denied'));
  assert.ok(contract.requiredChecks.includes('public-dns-denied'));
  assert.ok(contract.requiredChecks.includes('only-loopback-network-interface'));
  assert.equal(contract.evidence.format, 'single-json-document');
  assert.equal(contract.evidence.testedRevisionSource, 'git-rev-parse-HEAD');
  assert.equal(contract.evidence.stdoutAndStderrSeparated, true);
  assert.equal(contract.evidence.validJsonRequiredOnFailure, true);
});

test('container runner passes no host environment and mounts only three allowlisted files', async () => {
  const runner = await readFile('scripts/benchmark-isolation-container.sh', 'utf8');
  assert.ok(runner.includes('--network=none'));
  assert.ok(runner.includes('--read-only'));
  assert.ok(runner.includes('--cap-drop=ALL'));
  assert.ok(runner.includes('--security-opt=no-new-privileges:true'));
  assert.ok(runner.includes('--user=10001:10001'));
  assert.ok(runner.includes('benchmark-isolation-container.mjs,readonly'));
  assert.ok(runner.includes('benchmark-endpoint-policy.mjs,readonly'));
  assert.ok(runner.includes('local-isolation-policy.json,readonly'));
  assert.ok(!runner.includes('--env-file'));
  assert.ok(!runner.includes('docker.sock'));
  const start = runner.indexOf('DOCKER_RUN_ARGS=(');
  const end = runner.indexOf('\n    )', start);
  const dockerArgs = start >= 0 && end > start ? runner.slice(start, end) : '';
  assert.ok(dockerArgs, 'Docker invocation must remain an explicit argument array');
  assert.doesNotMatch(dockerArgs, /(^|\s)--env(?:=|\s)|(^|\s)-e(\s|$)/);
});

test('isolation probe rejects weak network-denial evidence', async () => {
  const probe = await readFile('scripts/benchmark-isolation-container.mjs', 'utf8');
  assert.ok(probe.includes('DENIED_NETWORK_CODES'));
  assert.ok(probe.includes('DNS_DENIED_CODES'));
  assert.ok(probe.includes('HOST_ALIAS_UNAVAILABLE_CODES'));
  assert.ok(probe.includes('ENETUNREACH'));
  assert.ok(probe.includes('EHOSTUNREACH'));
  assert.ok(!probe.includes("'ECONNREFUSED', 'ETIMEDOUT'"));
  assert.ok(probe.includes("resolver.setServers(['1.1.1.1'])"));
  assert.ok(probe.includes('only-loopback-network-interface'));
  assert.ok(probe.includes('isAllowedInferenceEndpoint'));
  assert.ok(probe.includes('HARNESS_PASS_ONLY_NOT_GATE_PASS'));
});

test('isolation probe performs real IPv4 and IPv6 loopback TCP round-trips', async () => {
  const probe = await readFile('scripts/benchmark-isolation-container.mjs', 'utf8');
  for (const required of [
    'net.createServer(',
    'net.createConnection(',
    'server.listen({ host, port: 0',
    'LOOPBACK_CONNECTED',
    "host: '127.0.0.1'",
    "host: '::1'",
    'family: 4',
    'family: 6',
    'credential-environment-absent',
    'only-loopback-network-interface',
    'modelInvocation: false'
  ]) assert.ok(probe.includes(required), `missing loopback probe behaviour: ${required}`);
});

test('workflow writes a clean evidence document and uploads it even after probe failure', async () => {
  const workflow = await readFile('.github/workflows/benchmark-contracts.yml', 'utf8');
  assert.ok(workflow.includes('run: bash scripts/benchmark-isolation-container.sh'));
  assert.match(workflow, /if: always\(\)[\s\S]*uses: actions\/upload-artifact@v7/);
  assert.ok(!workflow.includes('npm run benchmark:isolation:container | tee'));
});
