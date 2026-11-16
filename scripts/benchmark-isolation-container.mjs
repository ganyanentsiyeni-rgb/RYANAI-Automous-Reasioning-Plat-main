#!/usr/bin/env node
import { Resolver, lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import { isAllowedInferenceEndpoint } from './benchmark-endpoint-policy.mjs';

const DENIED_NETWORK_CODES = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'EACCES', 'EPERM']);
const ALLOWED_ENVIRONMENT_VARIABLE_NAMES = [
  'HOME', 'HOSTNAME', 'NODE_VERSION', 'PATH', 'PWD', 'TERM', 'YARN_VERSION'
];
const timeoutMs = 1500;

function connectCode(host, port, timeout = timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(code);
    };
    socket.once('connect', () => finish('CONNECTED'));
    socket.once('error', (error) => finish(error.code || 'UNKNOWN'));
    socket.setTimeout(timeout, () => finish('ETIMEDOUT'));
  });
}

async function loopbackFixture(host) {
  const server = net.createServer((socket) => socket.end('ok'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    return { ok: false, code: 'NO_LISTEN_ADDRESS' };
  }
  const code = await connectCode(host, address.port);
  await new Promise((resolve) => server.close(resolve));
  return { ok: code === 'CONNECTED', code };
}

async function dnsDenied() {
  const resolver = new Resolver();
  resolver.setServers(['1.1.1.1']);
  let timer;
  const result = await Promise.race([
    resolver.resolve4('example.com').then(
      () => ({ ok: false, code: 'DNS_RESOLVED' }),
      (error) => ({ ok: DENIED_NETWORK_CODES.has(error.code), code: error.code || 'UNKNOWN' }),
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => {
        resolver.cancel();
        resolve({ ok: false, code: 'ETIMEDOUT' });
      }, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return result;
}

async function dockerHostAliasDenied() {
  try {
    const result = await lookup('host.docker.internal');
    const address = result.address;
    if (address === '127.0.0.1' || address === '::1') {
      return { ok: true, code: 'LOOPBACK_ONLY' };
    }
    const code = await connectCode(address, 2375);
    return { ok: DENIED_NETWORK_CODES.has(code), code };
  } catch (error) {
    return { ok: error.code === 'ENOTFOUND' || DENIED_NETWORK_CODES.has(error.code), code: error.code || 'UNKNOWN' };
  }
}

async function loadPolicy() {
  return JSON.parse(await readFile(new URL('./local-isolation-policy.json', import.meta.url), 'utf8'));
}

async function main() {
  const policy = await loadPolicy();
  const interfaceNames = Object.entries(os.networkInterfaces())
    .filter(([, addresses]) => Array.isArray(addresses) && addresses.length > 0)
    .map(([name]) => name)
    .sort();
  const environmentVariableNames = Object.keys(process.env).sort();
  const credentialNames = environmentVariableNames.filter((name) =>
    /(API_KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|PRIVATE_KEY|CREDENTIAL|AWS_|SUPABASE_)/i.test(name)
  );
  const checks = [];
  const add = (name, command, result) => checks.push({
    name,
    status: result.ok ? 'PASS' : 'FAIL',
    command,
    exitCode: result.ok ? 0 : 1,
    observedCode: result.code || 'UNKNOWN',
    ...(result.ok ? {} : { failureReason: result.reason || `Expected an isolated result; observed ${result.code || 'UNKNOWN'}` }),
  });

  add('only-loopback-network-interface', 'inspect network interfaces; require only lo', {
    ok: interfaceNames.length === 1 && interfaceNames[0] === 'lo',
    code: interfaceNames.join(',') || 'NONE',
  });
  add('ipv4-loopback-fixture', "connect to '127.0.0.1' loopback fixture", await loopbackFixture('127.0.0.1'));
  add('ipv6-loopback-fixture', "connect to '::1' loopback fixture", await loopbackFixture('::1'));
  const publicIp = await connectCode('1.1.1.1', 443);
  add('public-ip-egress-denied', "connect to '1.1.1.1':443 and require a network-unreachable error", {
    ok: DENIED_NETWORK_CODES.has(publicIp),
    code: publicIp,
  });
  const privateLan = await connectCode('10.0.0.1', 443);
  add('private-lan-egress-denied', "connect to '10.0.0.1':443 and require a network-unreachable error", {
    ok: DENIED_NETWORK_CODES.has(privateLan),
    code: privateLan,
  });
  add('public-dns-denied', "resolver.setServers(['1.1.1.1']); resolve 'example.com' and require a network-unreachable error", await dnsDenied());
  add('docker-host-alias-denied', "resolve 'host.docker.internal' and reject host access", await dockerHostAliasDenied());

  const allowedEndpoints = policy.allowedInferenceEndpoints || [];
  const allowlistPass =
    isAllowedInferenceEndpoint('http://127.0.0.1:11434/v1', allowedEndpoints) &&
    isAllowedInferenceEndpoint('http://[::1]:11434/v1', allowedEndpoints) &&
    !isAllowedInferenceEndpoint('http://10.0.0.1:11434/v1', allowedEndpoints) &&
    !isAllowedInferenceEndpoint('http://host.docker.internal:11434/v1', allowedEndpoints) &&
    !isAllowedInferenceEndpoint('http://127.0.0.1:11435/v1', allowedEndpoints);
  add('policy-endpoint-allowlist', 'validate only approved loopback inference endpoints', {
    ok: allowlistPass,
    code: allowlistPass ? 'ALLOWLIST_ENFORCED' : 'ALLOWLIST_MISMATCH',
  });

  add('credential-environment-absent', 'inspect environment variable names for credentials', {
    ok: credentialNames.length === 0 &&
      Object.keys(process.env).every((name) => ALLOWED_ENVIRONMENT_VARIABLE_NAMES.includes(name)) &&
      policy.credentials?.providerCredentialsMounted === false &&
      policy.credentials?.productionDatabaseUrlMounted === false &&
      policy.credentials?.deploymentTokenMounted === false &&
      policy.credentials?.repositoryWriteTokenMounted === false,
    code: credentialNames.length ? credentialNames.join(',') : 'NO_CREDENTIAL_VARIABLES',
  });

  const failedChecks = checks.filter((check) => check.status !== 'PASS').length;
  const imageDigest = process.argv[2] || '';
  const report = {
    schemaVersion: '1.0.0',
    evidenceType: 'isolated-container-network-boundary-test',
    modelInvocation: false,
    networkMode: 'none',
    containerImageDigest: imageDigest,
    networkInterfaces: interfaceNames,
    environmentVariableNames,
    allowedEnvironmentVariableNames: ALLOWED_ENVIRONMENT_VARIABLE_NAMES,
    failedChecks,
    checks,
    verdict: failedChecks === 0 && /^node@sha256:[a-f0-9]{64}$/.test(imageDigest)
      ? 'HARNESS_PASS_ONLY_NOT_GATE_PASS'
      : 'HARNESS_FAIL',
  };

  process.stdout.write(JSON.stringify(report));
  if (report.verdict !== 'HARNESS_PASS_ONLY_NOT_GATE_PASS') process.exitCode = 1;
}

main().catch((error) => {
  const report = {
    schemaVersion: '1.0.0',
    evidenceType: 'isolated-container-network-boundary-test',
    modelInvocation: false,
    networkMode: 'none',
    containerImageDigest: process.argv[2] || '',
    networkInterfaces: Object.keys(os.networkInterfaces()).sort(),
    environmentVariableNames: Object.keys(process.env).sort(),
    allowedEnvironmentVariableNames: ALLOWED_ENVIRONMENT_VARIABLE_NAMES,
    failedChecks: 1,
    checks: [],
    verdict: 'HARNESS_FAIL',
    failureReasons: [error instanceof Error ? error.message : String(error)],
  };
  process.stdout.write(JSON.stringify(report));
  process.exitCode = 1;
});
