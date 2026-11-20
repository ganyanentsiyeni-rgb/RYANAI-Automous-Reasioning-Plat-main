import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyParentDelegation } from './verify-eu-org-parent-delegation.mjs';

const childNs = ['ns1.desec.io', 'ns2.desec.org'];
const parentNs = ['ns1.eu.org', 'ns2.eu.org'];

function fakeResolver({ discovered = parentNs, observed = childNs, fail = null } = {}, calls = []) {
  return () => ({
    setServers(servers) { this.server = servers[0]; },
    async resolveNs(zone) {
      calls.push({ zone, server: this.server ?? 'system' });
      if (fail) throw fail;
      return zone === 'eu.org' ? discovered : observed;
    },
    cancel() {},
  });
}

const addresses = async (host) => host === 'ns1.eu.org'
  ? [{ address: '192.0.2.10', family: 4 }, { address: '2001:db8::10', family: 6 }]
  : [{ address: '192.0.2.11', family: 4 }];

test('checks child NS delegation through every IPv4/IPv6 address of every eu.org nameserver', async () => {
  const calls = [];
  const result = await verifyParentDelegation({
    resolveAddresses: addresses,
    resolverFactory: fakeResolver({}, calls),
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.checks.length, 3);
  assert.deepEqual(result.expectedNameservers, childNs);
  assert.equal(result.registrationApproval.startsWith('not-verified'), true);
  assert.equal(result.authoritativeAnswerBit, 'not-exposed-by-node-dns-resolver-api');
  assert.equal(calls.filter((call) => call.zone === 'ryanai.eu.org').length, 3);
});

test('fails closed when the parent returns a different child NS RRset', async () => {
  await assert.rejects(
    () => verifyParentDelegation({
      resolveAddresses: async () => [{ address: '192.0.2.10', family: 4 }],
      resolverFactory: fakeResolver({ observed: ['ns1.desec.io'] }),
    }),
    /Child NS mismatch/,
  );
});

test('fails closed when a parent nameserver cannot be resolved', async () => {
  await assert.rejects(
    () => verifyParentDelegation({
      resolveAddresses: async () => { throw Object.assign(new Error('temporary failure'), { code: 'EAI_AGAIN' }); },
      resolverFactory: fakeResolver(),
    }),
    /Address lookup failed.*EAI_AGAIN/,
  );
});

test('rejects domains outside the configured parent zone', async () => {
  await assert.rejects(
    () => verifyParentDelegation({ domain: 'example.net' }),
    /child domain under the parent zone/,
  );
});

test('rejects a parent zone with fewer than two nameservers', async () => {
  await assert.rejects(
    () => verifyParentDelegation({
      resolveAddresses: addresses,
      resolverFactory: fakeResolver({ discovered: ['ns1.eu.org'] }),
    }),
    /Expected at least two/,
  );
});
