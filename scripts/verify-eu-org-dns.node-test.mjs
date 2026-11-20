import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAuthoritativeDns } from './verify-eu-org-dns.mjs';

test('checks SOA and both delegated NS records against every nameserver address', async () => {
  const queries = [];
  const report = await verifyAuthoritativeDns({
    domain: 'RYANAI.EU.ORG.',
    resolveAddresses: async (host) => [{ address: host.includes('ns1') ? '192.0.2.1' : '192.0.2.2', family: 4 }],
    resolverFactory: () => ({
      setServers(servers) { this.server = servers[0]; },
      async resolveSoa(zone) {
        queries.push(['SOA', zone, this.server]);
        return { ns: 'ns1.desec.io', serial: 42 };
      },
      async resolveNs(zone) {
        queries.push(['NS', zone, this.server]);
        return ['ns1.desec.io.', 'ns2.desec.org.'];
      },
    }),
  });

  assert.equal(report.domain, 'ryanai.eu.org');
  assert.equal(report.checks.length, 2);
  assert.equal(queries.length, 4);
  assert.deepEqual(report.nameservers, ['ns1.desec.io', 'ns2.desec.org']);
});

test('fails closed when an authoritative answer omits a delegated nameserver', async () => {
  await assert.rejects(() => verifyAuthoritativeDns({
    resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }],
    resolverFactory: () => ({
      setServers() {},
      async resolveSoa() { return { ns: 'ns1.desec.io', serial: 42 }; },
      async resolveNs() { return ['ns1.desec.io']; },
    }),
  }), /missing: ns2.desec.org/);
});
