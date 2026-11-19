/* jshint esversion: 11 */
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
  assert.match(runner, /--network=none/);
  assert.match(runner, /--read-only/);
  assert.match(runner, /--cap-drop=ALL/);
  assert.match(runner, /--security-opt=no-new-privileges:true/);
  assert.match(runner, /--user=10001:10001/);
  assert.match(runner, /benchmark-isolation-container\\.mjs,readonly/);
  assert.match(runner, /benchmark-endpoint-policy\\.mjs,readonly/);
  assert.match(runner, /local-isolation-policy\\.json,readonly/);
  assert.doesNotMatch(runner, /src=\\$\\(pwd\\)|--env-file|docker\\.sock/);
  const argsDeclarationStart = runner.indexOf('DOCKER_RUN_ARGS=(');
  const argsDeclarationEnd = runner.indexOf('\\n    )', argsDeclarationStart);
  const dockerArgs = argsDeclarationStart >= 0 && argsDeclarationEnd > argsDeclarationStart
    ? runner.slice(argsDeclarationStart + 'DOCKER_RUN_ARGS=('.length, argsDeclarationEnd)
    : '';
  assert.ok(dockerArgs, 'Docker invocation must remain an explicit argument array');
  assert.doesNotMatch(dockerArgs, /(?:^|\\s)--env(?:=|\\s)|(?:^|\\s)-e(?:\\s|$)/);
});

test('isolation probe rejects weak network-denial evidence', async () => {
  const probe = await readFile('scripts/benchmark-isolation-container.mjs', 'utf8');
  assert.match(probe, /DENIED_NETWORK_CODES/);
  assert.match(probe, /DNS_DENIED_CODES/);
  assert.match(probe, /HOST_ALIAS_UNAVAILABLE_CODES/);
  assert.match(probe, /ENETUNREACH/);
  assert.match(probe, /EHOSTUNREACH/);
  assert.doesNotMatch(probe, /ECONNREFUSED.*ETIMEDOUT/s);
  assert.match(probe, /resolver\\.setServers\\(\\['1\\.1\\.1\\.1'\\]\\)/);
  assert.match(probe, /only-loopback-network-interface/);
  assert.match(probe, /isAllowedInferenceEndpoint/);
  assert.match(probe, /HARNESS_PASS_ONLY_NOT_GATE_PASS/);
});

test('isolation probe performs real IPv4 and IPv6 loopback TCP round-trips', async () => {
  const probe = await readFile('scripts/benchmark-isolation-container.mjs', 'utf8');
  assert.match(probe, /net\\.createServer\\(/);
  assert.match(probe, /net\\.createConnection\\(/);
  assert.match(probe, /server\\.listen\\(\\{ host, port: 0/);
  assert.match(probe, /LOOPBACK_CONNECTED/);
  assert.match(probe, /host: '127\\.0\\.0\\.1'/);
  assert.match(probe, /host: '::1'/);
  assert.match(probe, /family: 4/);
  assert.match(probe, /family: 6/);
  assert.match(probe, /credential-environment-absent/);
  assert.match(probe, /only-loopback-network-interface/);
  assert.match(probe, /modelInvocation: false/);
});

test('workflow writes a clean evidence document and uploads it even after probe failure', async () => {
  const workflow = await readFile('.github/workflows/benchmark-contracts.yml', 'utf8');
  assert.match(workflow, /run: bash scripts\\/benchmark-isolation-container\\.sh/);
  assert.match(workflow, /if: always\\(\\)[\\s\\S]*uses: actions\\/upload-artifact@v7/);
  assert.doesNotMatch(workflow, /npm run benchmark:isolation:container \\| tee/);
});
