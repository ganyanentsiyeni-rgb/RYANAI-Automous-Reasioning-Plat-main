import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAuthoritativeDns } from './verify-eu-org-dns.mjs';

const expectedNs = ['ns1.desec.io', 'ns2.desec.org'];

function fakeResolver({ ns = expectedNs, soaNs = 'ns1.desec.io', failSoa, failNs } = {}, queries = []) {
  return () => ({
    setServers(servers) { this.server = servers[0]; },
    async resolveSoa(zone) {
      queries.push(['SOA', zone, this.server]);
      if (failSoa) throw failSoa;
      return { ns: soaNs, serial: 42 };
    },
    async resolveNs(zone) {
      queries.push(['NS', zone, this.server]);
      if (failNs) throw failNs;
      return ns;
    },
    cancel() { queries.push(['CANCEL', this.server]); },
  });
}

test('checks SOA and exact NS set against every IPv4 and IPv6 nameserver address', async () => {
  const queries = [];
  const report = await verifyAuthoritativeDns({
    domain: 'RYANAI.EU.ORG.',
    resolveAddresses: async (host) => host.includes('ns1')
      ? [{ address: '192.0.2.1', family: 4 }, { address: '2001:db8::1', family: 6 }]
      : [{ address: '192.0.2.2', family: 4 }, { address: '2001:db8::2', family: 6 }],
    resolverFactory: fakeResolver({}, queries),
  });

  assert.equal(report.domain, 'ryanai.eu.org');
  assert.equal(report.status, 'passed');
  assert.equal(report.checks.length, 4);
  assert.deepEqual(report.checks.map((item) => item.family), [4, 6, 4, 6]);
  assert.equal(queries.filter(([type]) => type === 'SOA').length, 4);
  assert.equal(queries.filter(([type]) => type === 'NS').length, 4);
  assert.equal(report.registrationApproval.startsWith('not-verified'), true);
  assert.equal(report.parentZoneDelegation.startsWith('not-verified'), true);
});

test('fails closed when an address lookup fails', async () => {
  await assert.rejects(
    () => verifyAuthoritativeDns({
      resolveAddresses: async () => { throw Object.assign(new Error('resolver offline'), { code: 'EAI_AGAIN' }); },
      resolverFactory: fakeResolver(),
    }),
    /Address lookup failed.*EAI_AGAIN/,
  );
});

test('fails closed when a nameserver has no IPv4 or IPv6 address', async () => {
  await assert.rejects(
    () => verifyAuthoritativeDns({ resolveAddresses: async () => [], resolverFactory: fakeResolver() }),
    /No IPv4 or IPv6 addresses/,
  );
});

test('rejects malformed address and family combinations before querying', async () => {
  await assert.rejects(
    () => verifyAuthoritativeDns({
      resolveAddresses: async () => [{ address: 'not-an-ip', family: 6 }],
      resolverFactory: fakeResolver(),
    }),
    /Invalid IP address\/family/,
  );
});

test('fails when an authoritative response omits an expected nameserver', async () => {
  await assert.rejects(
    () => verifyAuthoritativeDns({
      resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      resolverFactory: fakeResolver({ ns: ['ns1.desec.io'] }),
    }),
    /NS set mismatch/,
  );
});

test('fails when an unexpected nameserver appears in the NS set', async () => {
  await assert.rejects(
    () => verifyAuthoritativeDns({
      resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      resolverFactory: fakeResolver({ ns: [...expectedNs, 'ns3.example.net'] }),
    }),
    /NS set mismatch/,
  );
});

test('fails when the SOA primary is not an expected nameserver', async () => {
  await assert.rejects(
    () => verifyAuthoritativeDns({
      resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      resolverFactory: fakeResolver({ soaNs: 'ns3.example.net' }),
    }),
    /SOA primary.*not one of the expected nameservers/,
  );
});

test('reports DNS query failures with the nameserver endpoint and original error code', async () => {
  await assert.rejects(
    () => verifyAuthoritativeDns({
      resolveAddresses: async () => [{ address: '2001:db8::1', family: 6 }],
      resolverFactory: fakeResolver({ failSoa: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) }),
    }),
    /Direct DNS check failed.*2001:db8::1.*ECONNREFUSED/,
  );
});

test('times out and cancels a stalled DNS resolver', async () => {
  let cancelled = false;
  await assert.rejects(
    () => verifyAuthoritativeDns({
      queryTimeoutMs: 5,
      resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
      resolverFactory: () => ({
        setServers() {},
        resolveSoa: () => new Promise(() => {}),
        resolveNs: () => new Promise(() => {}),
        cancel() { cancelled = true; },
      }),
    }),
    /timed out after 5ms/,
  );
  assert.equal(cancelled, true);
});

test('rejects invalid timeout configuration', async () => {
  await assert.rejects(
    () => verifyAuthoritativeDns({ queryTimeoutMs: 0 }),
    /queryTimeoutMs must be a positive integer/,
  );
});
