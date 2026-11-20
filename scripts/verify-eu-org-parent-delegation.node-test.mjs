import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNsQueryPacket, parseNsResponse, verifyParentDelegation } from './verify-eu-org-parent-delegation.mjs';

const childNs = ['ns1.desec.io', 'ns2.desec.org'];
const parentNs = ['ns1.eu.org', 'ns2.eu.org'];

function encodeName(name) {
  return Buffer.concat([...name.split('.').map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])), Buffer.from([0])]);
}

function referralResponse(id, zone = 'ryanai.eu.org', targets = childNs) {
  const questionName = encodeName(zone);
  const question = Buffer.concat([questionName, Buffer.from([0, 2, 0, 1])]);
  const records = targets.map((target) => {
    const owner = Buffer.from([0xc0, 0x0c]);
    const rdata = encodeName(target);
    const fixed = Buffer.alloc(10);
    fixed.writeUInt16BE(2, 0);
    fixed.writeUInt16BE(1, 2);
    fixed.writeUInt32BE(300, 4);
    fixed.writeUInt16BE(rdata.length, 8);
    return Buffer.concat([owner, fixed, rdata]);
  });
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x8000, 2); // QR=1, AA=0: parent referral
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(records.length, 8);
  return Buffer.concat([header, question, ...records]);
}

function fakeResolver({ discovered = parentNs } = {}) {
  return () => ({
    async resolveNs(zone) { assert.equal(zone, 'eu.org'); return discovered; },
    cancel() {},
  });
}

const addresses = async (host) => host === 'ns1.eu.org'
  ? [{ address: '192.0.2.10', family: 4 }, { address: '2001:db8::10', family: 6 }]
  : [{ address: '192.0.2.11', family: 4 }];

test('builds a non-recursive NS query and parses parent authority referral records', () => {
  const { id, packet } = buildNsQueryPacket('ryanai.eu.org', 1234);
  assert.equal(packet.readUInt16BE(2), 0); // RD=0
  const response = parseNsResponse(referralResponse(id), id);
  assert.equal(response.rcode, 0);
  assert.equal(response.authoritative, false);
  assert.deepEqual(response.authorityNs.map((record) => record.target).sort(), childNs);
});

test('rejects mismatched DNS response IDs', () => {
  const { id } = buildNsQueryPacket('ryanai.eu.org', 1234);
  assert.throws(() => parseNsResponse(referralResponse(id), id + 1), /ID does not match/);
});

test('checks child delegation through every IPv4/IPv6 address of every eu.org nameserver', async () => {
  const result = await verifyParentDelegation({
    resolveAddresses: addresses,
    resolverFactory: fakeResolver(),
    queryParent: async () => ({
      rcode: 0, authoritative: false, truncated: false, answerNs: [],
      authorityNs: childNs.map((target) => ({ owner: 'ryanai.eu.org', target })),
    }),
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.checks.length, 3);
  assert.equal(result.registrationApproval.startsWith('not-verified'), true);
  assert.equal(result.checks.every((item) => item.recordSection === 'authority'), true);
});

test('fails closed when the parent returns a different child NS RRset', async () => {
  await assert.rejects(
    () => verifyParentDelegation({
      resolveAddresses: async () => [{ address: '192.0.2.10', family: 4 }],
      resolverFactory: fakeResolver(),
      queryParent: async () => ({
        rcode: 0, authoritative: false, answerNs: [],
        authorityNs: [{ owner: 'ryanai.eu.org', target: 'ns1.desec.io' }],
      }),
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
