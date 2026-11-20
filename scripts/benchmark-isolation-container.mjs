import os from 'node:os';
import net from 'node:net';
import dns from 'node:dns/promises';
import { isAllowedInferenceEndpoint } from './benchmark-endpoint-policy.mjs';
import { readFile } from 'node:fs/promises';

const imageDigest = process.argv[2] ?? '';
const policy = JSON.parse(await readFile('/workspace/local-isolation-policy.json', 'utf8'));
const checks = [];
const DENIED_NETWORK_CODES = ['ENETUNREACH', 'EHOSTUNREACH'];
const DNS_DENIED_CODES = ['ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED'];
const HOST_ALIAS_UNAVAILABLE_CODES = ['ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN'];
const record = (name, command, observedCode, ok, failureReason = '') => checks.push({
  name, status: ok ? 'PASS' : 'FAIL', exitCode: ok ? 0 : 1,
  command, observedCode: String(observedCode ?? 'none'),
  ...(failureReason ? { failureReason } : {})
});

const interfaces = Object.entries(os.networkInterfaces())
  .filter(([, values]) => Array.isArray(values) && values.length > 0)
  .map(([name]) => name).sort();
record('only-loopback-network-interface', 'node os.networkInterfaces()', interfaces.join(','),
  JSON.stringify(interfaces) === JSON.stringify(['lo']),
  'observed interfaces: ' + interfaces.join(','));

// Exercise actual TCP loopback using an ephemeral server and client, rather than
// treating a connection to an arbitrary closed port as proof of loopback.
const verifyLoopback = async (host, family) => {
  const server = net.createServer(socket => socket.end('loopback-ok'));
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host, port: 0, exclusive: true }, resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not expose a TCP address');
    const response = await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port: address.port, family });
      const chunks = [];
      socket.on('data', chunk => chunks.push(chunk));
      socket.once('end', () => resolve(Buffer.concat(chunks).toString()));
      socket.once('error', reject);
    });
    return response === 'loopback-ok' ? 'LOOPBACK_CONNECTED' : 'UNEXPECTED_RESPONSE';
  } finally {
    await new Promise(resolve => server.close(() => resolve()));
  }
};
for (const fixture of [
  { name: 'ipv4-loopback-fixture', host: '127.0.0.1', family: 4 },
  { name: 'ipv6-loopback-fixture', host: '::1', family: 6 }
]) {
  let result;
  try { result = await verifyLoopback(fixture.host, fixture.family); }
  catch (error) { result = error?.code ?? error?.name ?? 'UNKNOWN'; }
  record(fixture.name, `TCP server/client loopback round-trip to ${fixture.host}`, result,
    result === 'LOOPBACK_CONNECTED', 'expected a successful loopback TCP round-trip, observed ' + result);
}

const connectDenied = host => new Promise(resolve => {
  const socket = net.createConnection({ host, port: 443 });
  const timer = setTimeout(() => { socket.destroy(); resolve('ETIMEDOUT'); }, 1500);
  socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve('CONNECTED'); });
  socket.once('error', err => { clearTimeout(timer); socket.destroy(); resolve(err?.code ?? err?.name ?? 'UNKNOWN'); });
});
const publicCode = await connectDenied('1.1.1.1');
record('public-ip-egress-denied', 'node net.connect(1.1.1.1:443)', publicCode,
  DENIED_NETWORK_CODES.includes(publicCode),
  'expected ENETUNREACH/EHOSTUNREACH, observed ' + publicCode);

const privateCode = await connectDenied('10.0.0.1');
record('private-lan-egress-denied', 'node net.connect(10.0.0.1:443)', privateCode,
  DENIED_NETWORK_CODES.includes(privateCode),
  'expected ENETUNREACH/EHOSTUNREACH, observed ' + privateCode);

const resolver = new dns.Resolver();
resolver.setServers(['1.1.1.1']);
let dnsCode = 'RESOLVED';
try { await resolver.resolve4('example.com'); } catch (err) { dnsCode = err?.code ?? err?.name ?? 'UNKNOWN'; }
record('public-dns-denied', 'dns.Resolver.setServers([1.1.1.1]).resolve4(example.com)', dnsCode,
  DNS_DENIED_CODES.includes(dnsCode),
  'expected ENETUNREACH/EHOSTUNREACH, observed ' + dnsCode);

let dockerHostCode = 'RESOLVED';
try { await dns.lookup('host.docker.internal'); } catch (err) { dockerHostCode = err?.code ?? err?.name ?? 'UNKNOWN'; }
record('docker-host-alias-denied', 'dns.lookup(host.docker.internal)', dockerHostCode,
  HOST_ALIAS_UNAVAILABLE_CODES.includes(dockerHostCode),
  'expected unavailable host alias, observed ' + dockerHostCode);

const allowed = policy.allowedInferenceEndpoints ?? [];
const policyPass =
  isAllowedInferenceEndpoint('http://127.0.0.1:11434/', allowed) &&
  isAllowedInferenceEndpoint('http://[::1]:11434/v1', allowed) &&
  !isAllowedInferenceEndpoint('https://example.com/', allowed) &&
  !isAllowedInferenceEndpoint('http://127.0.0.1:11435/', allowed);
record('policy-endpoint-allowlist', 'isAllowedInferenceEndpoint(local and disallowed endpoints)',
  policyPass ? 'ALLOWLIST_ENFORCED' : 'POLICY_MISMATCH', policyPass);

const observedEnv = Object.keys(process.env).sort();
const forbiddenEnvPattern = /(?:API_KEY|SECRET|TOKEN|PASSWORD|PASSWD|DATABASE_URL|REDIS_URL|SUPABASE|OPENAI|ANTHROPIC|AWS_|GITHUB_TOKEN|RENDER_|VERCEL_)/i;
const credentialEnv = observedEnv.filter(name => forbiddenEnvPattern.test(name));
record('credential-environment-absent', 'node inspect process.env variable names',
  credentialEnv.length === 0 ? 'NONE' : credentialEnv.join(','), credentialEnv.length === 0,
  credentialEnv.length ? 'credential-like environment names present: ' + credentialEnv.join(',') : '');

const failedChecks = checks.filter(check => check.status !== 'PASS').length;
const allowedEnvironmentVariableNames = observedEnv.filter(name => !forbiddenEnvPattern.test(name));

process.stdout.write(JSON.stringify({
  schemaVersion: '1.0.0',
  verdict: failedChecks === 0 ? 'HARNESS_PASS_ONLY_NOT_GATE_PASS' : 'HARNESS_FAIL',
  modelInvocation: false,
  networkMode: 'none',
  containerImageDigest: imageDigest,
  networkInterfaces: interfaces,
  environmentVariableNames: observedEnv,
  allowedEnvironmentVariableNames,
  failedChecks,
  checks
}, null, 2) + '\n');

process.exitCode = failedChecks === 0 ? 0 : 1;
