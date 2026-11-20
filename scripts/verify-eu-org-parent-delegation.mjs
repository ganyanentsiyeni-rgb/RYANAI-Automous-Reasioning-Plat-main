#!/usr/bin/env node
import { Resolver, lookup } from 'node:dns/promises';
import { createSocket } from 'node:dgram';
import { randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DOMAIN = 'ryanai.eu.org';
export const DEFAULT_PARENT_ZONE = 'eu.org';
export const EXPECTED_NAMESERVERS = ['ns1.desec.io', 'ns2.desec.org'];

const normalize = (value) => String(value ?? '').trim().replace(/\.+$/, '').toLowerCase();

function encodeName(name) {
  const labels = normalize(name).split('.');
  const encoded = [];
  for (const label of labels) {
    const bytes = Buffer.from(label, 'ascii');
    if (!bytes.length || bytes.length > 63 || bytes.toString('ascii') !== label) {
      throw new Error(`Invalid DNS label in ${name}`);
    }
    encoded.push(Buffer.from([bytes.length]), bytes);
  }
  encoded.push(Buffer.from([0]));
  return Buffer.concat(encoded);
}

export function buildNsQueryPacket(name, id = randomInt(0, 65536)) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(1, 4);
  const question = Buffer.alloc(4);
  question.writeUInt16BE(2, 0); // NS
  question.writeUInt16BE(1, 2); // IN
  return { id, packet: Buffer.concat([header, encodeName(name), question]) };
}

function decodeName(packet, start) {
  const labels = [];
  const visited = new Set();
  let offset = start;
  let consumed = null;
  for (let hops = 0; hops < 128; hops += 1) {
    if (offset >= packet.length) throw new Error('DNS name extends beyond packet.');
    const length = packet[offset];
    if (length === 0) {
      offset += 1;
      return { name: labels.join('.').toLowerCase(), nextOffset: consumed ?? offset };
    }
    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= packet.length) throw new Error('Truncated DNS compression pointer.');
      const pointer = ((length & 0x3f) << 8) | packet[offset + 1];
      if (visited.has(pointer)) throw new Error('DNS compression pointer loop.');
      visited.add(pointer);
      if (consumed === null) consumed = offset + 2;
      offset = pointer;
      continue;
    }
    if ((length & 0xc0) !== 0 || offset + 1 + length > packet.length) {
      throw new Error('Malformed DNS label.');
    }
    labels.push(packet.toString('ascii', offset + 1, offset + 1 + length));
    offset += length + 1;
  }
  throw new Error('DNS name compression depth exceeded.');
}

export function parseNsResponse(packet, expectedId) {
  if (!Buffer.isBuffer(packet) || packet.length < 12) throw new Error('Truncated DNS response header.');
  if (packet.readUInt16BE(0) !== expectedId) throw new Error('DNS response ID does not match query.');
  const flags = packet.readUInt16BE(2);
  if ((flags & 0x8000) === 0) throw new Error('DNS packet is not a response.');
  const rcode = flags & 0x000f;
  const questionCount = packet.readUInt16BE(4);
  const answerCount = packet.readUInt16BE(6);
  const authorityCount = packet.readUInt16BE(8);
  const additionalCount = packet.readUInt16BE(10);
  let offset = 12;

  for (let i = 0; i < questionCount; i += 1) {
    offset = decodeName(packet, offset).nextOffset + 4;
    if (offset > packet.length) throw new Error('Truncated DNS question.');
  }

  const readRecords = (count, section) => {
    const records = [];
    for (let i = 0; i < count; i += 1) {
      const owner = decodeName(packet, offset);
      offset = owner.nextOffset;
      if (offset + 10 > packet.length) throw new Error('Truncated DNS resource record.');
      const type = packet.readUInt16BE(offset);
      const klass = packet.readUInt16BE(offset + 2);
      const ttl = packet.readUInt32BE(offset + 4);
      const rdlength = packet.readUInt16BE(offset + 8);
      const rdataOffset = offset + 10;
      const end = rdataOffset + rdlength;
      if (end > packet.length) throw new Error('DNS resource data extends beyond packet.');
      if (type === 2 && klass === 1) {
        const target = decodeName(packet, rdataOffset).name;
        records.push({ owner: owner.name, target, ttl, section });
      }
      offset = end;
    }
    return records;
  };

  const answerRecords = readRecords(answerCount, 'answer');
  const authorityRecords = readRecords(authorityCount, 'authority');
  readRecords(additionalCount, 'additional');
  return {
    rcode,
    authoritative: (flags & 0x0400) !== 0,
    truncated: (flags & 0x0200) !== 0,
    answerNs: answerRecords,
    authorityNs: authorityRecords,
  };
}

export async function queryParentNs({ address, family, domain, timeoutMs = 5000 }) {
  const { id, packet } = buildNsQueryPacket(domain);
  const socket = createSocket(family === 6 ? 'udp6' : 'udp4');
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      try { socket.close(); } catch {}
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    const timer = setTimeout(() => {
      const error = new Error(`DNS query timed out after ${timeoutMs}ms`);
      error.code = 'ETIMEDOUT';
      finish(error);
    }, timeoutMs);
    socket.once('error', (error) => finish(error));
    socket.once('message', (message) => {
      try {
        const result = parseNsResponse(message, id);
        if (result.truncated) {
          const error = new Error('Parent DNS response was truncated; TCP fallback is not implemented.');
          error.code = 'ETRUNCATED';
          throw error;
        }
        if (result.rcode !== 0) {
          const error = new Error(`Parent DNS server returned RCODE ${result.rcode}.`);
          error.code = 'EDNS';
          throw error;
        }
        finish(null, result);
      } catch (error) {
        finish(error);
      }
    });
    socket.send(packet, 53, address, (error) => {
      if (error) finish(error);
    });
  });
}

function uniqueAddresses(addresses, label) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error(`No IPv4 or IPv6 addresses found for ${label}.`);
  }
  const unique = [...new Map(addresses.map(({ address, family }) => [
    `${family}:${address}`, { address, family },
  ])).values()];
  for (const item of unique) {
    if (!isIP(item.address) || isIP(item.address) !== item.family) {
      throw new Error(`Invalid IP address/family returned for ${label}: ${item.address} (family ${item.family}).`);
    }
  }
  return unique;
}

function detail(error) {
  const code = error?.code ? ` (${error.code})` : '';
  return `${error?.message ?? String(error)}${code}`;
}

/**
 * Sends non-recursive DNS wire queries directly to eu.org nameserver IPs.
 * It inspects the answer/authority NS RRsets without following referrals,
 * so the child delegation is read from the parent-server response itself.
 */
export async function verifyParentDelegation({
  domain = DEFAULT_DOMAIN,
  parentZone = DEFAULT_PARENT_ZONE,
  nameservers = EXPECTED_NAMESERVERS,
  resolveAddresses = lookup,
  resolverFactory = () => new Resolver(),
  queryParent = queryParentNs,
  queryTimeoutMs = 5000,
} = {}) {
  const zone = normalize(domain);
  const parent = normalize(parentZone);
  const expected = [...new Set(nameservers.map(normalize))].sort();
  if (!zone || !parent || !zone.endsWith(`.${parent}`) || expected.length < 2 || expected.some((v) => !v)) {
    throw new Error('A child domain under the parent zone and at least two unique expected nameservers are required.');
  }
  if (!Number.isInteger(queryTimeoutMs) || queryTimeoutMs < 1) {
    throw new Error('queryTimeoutMs must be a positive integer.');
  }

  const discovery = resolverFactory();
  let parentNameservers;
  try {
    parentNameservers = [...new Set((await discovery.resolveNs(parent)).map(normalize))].sort();
  } catch (error) {
    throw new Error(`Could not discover ${parent} nameservers: ${detail(error)}`, { cause: error });
  } finally {
    discovery.cancel?.();
  }
  if (parentNameservers.length < 2) {
    throw new Error(`Expected at least two ${parent} nameservers; found ${parentNameservers.length}.`);
  }

  const checks = [];
  for (const parentNs of parentNameservers) {
    let addresses;
    try {
      addresses = uniqueAddresses(await resolveAddresses(parentNs, { all: true, verbatim: true }), parentNs);
    } catch (error) {
      throw new Error(`Address lookup failed for parent nameserver ${parentNs}: ${detail(error)}`, { cause: error });
    }
    for (const endpoint of addresses) {
      try {
        const response = await queryParent({
          address: endpoint.address,
          family: endpoint.family,
          domain: zone,
          timeoutMs: queryTimeoutMs,
        });
        const records = [...response.answerNs, ...response.authorityNs]
          .filter((record) => normalize(record.owner) === zone)
          .map((record) => normalize(record.target));
        const observed = [...new Set(records)].sort();
        if (JSON.stringify(observed) !== JSON.stringify(expected)) {
          throw new Error(`Child NS mismatch; expected [${expected.join(', ')}], received [${observed.join(', ')}].`);
        }
        checks.push({
          parentNameserver: parentNs,
          address: endpoint.address,
          family: endpoint.family,
          childNameservers: observed,
          recordSection: response.authorityNs.some((record) => normalize(record.owner) === zone) ? 'authority' : 'answer',
          authoritativeAnswer: response.authoritative,
          status: 'passed',
        });
      } catch (error) {
        throw new Error(`Parent delegation query failed via ${parentNs} at ${endpoint.address}: ${detail(error)}`, { cause: error });
      }
    }
  }

  return {
    domain: zone,
    parentZone: parent,
    expectedNameservers: expected,
    parentNameservers,
    status: 'passed',
    checks,
    parentZoneDelegation: 'observed in direct non-recursive DNS responses from every discovered eu.org nameserver endpoint',
    registrationApproval: 'not-verified; EU.org confirmation or registrar status is still required',
  };
}

async function main() {
  const report = await verifyParentDelegation({ domain: process.argv[2] || DEFAULT_DOMAIN });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`Parent delegation verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
