#!/usr/bin/env node
import { Resolver, lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DOMAIN = 'ryanai.eu.org';
export const DEFAULT_PARENT_ZONE = 'eu.org';
export const EXPECTED_NAMESERVERS = ['ns1.desec.io', 'ns2.desec.org'];

const normalize = (value) => String(value ?? '').trim().replace(/\.+$/, '').toLowerCase();

function detail(error) {
  const code = error?.code ? ` (${error.code})` : '';
  return `${error?.message ?? String(error)}${code}`;
}

async function timed(promise, timeoutMs, onTimeout) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          const error = new Error(`DNS query timed out after ${timeoutMs}ms`);
          error.code = 'ETIMEDOUT';
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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

/**
 * Queries the eu.org parent-zone nameserver endpoints directly for the child
 * NS RRset. Node's Resolver API does not expose the DNS AA bit, so a matching
 * answer is reported as an observed parent-zone answer, not proof of the AA bit.
 */
export async function verifyParentDelegation({
  domain = DEFAULT_DOMAIN,
  parentZone = DEFAULT_PARENT_ZONE,
  nameservers = EXPECTED_NAMESERVERS,
  resolveAddresses = lookup,
  resolverFactory = () => new Resolver(),
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
    parentNameservers = [...new Set((await timed(
      discovery.resolveNs(parent), queryTimeoutMs, () => discovery.cancel?.(),
    )).map(normalize))].sort();
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
      let resolver;
      try {
        resolver = resolverFactory();
        resolver.setServers([endpoint.address]);
        const observed = [...new Set((await timed(
          resolver.resolveNs(zone), queryTimeoutMs, () => resolver.cancel?.(),
        )).map(normalize))].sort();
        if (JSON.stringify(observed) !== JSON.stringify(expected)) {
          throw new Error(`Child NS mismatch; expected [${expected.join(', ')}], received [${observed.join(', ')}].`);
        }
        checks.push({
          parentNameserver: parentNs,
          address: endpoint.address,
          family: endpoint.family,
          childNameservers: observed,
          status: 'passed',
        });
      } catch (error) {
        throw new Error(`Parent delegation query failed via ${parentNs} at ${endpoint.address}: ${detail(error)}`, { cause: error });
      } finally {
        resolver?.cancel?.();
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
    parentZoneDelegation: 'observed; exact child NS RRset returned by every discovered eu.org nameserver endpoint',
    authoritativeAnswerBit: 'not-exposed-by-node-dns-resolver-api',
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
