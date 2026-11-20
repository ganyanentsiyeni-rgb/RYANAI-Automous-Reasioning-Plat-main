#!/usr/bin/env node
import { Resolver, lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DOMAIN = 'ryanai.eu.org';
export const EXPECTED_NAMESERVERS = ['ns1.desec.io', 'ns2.desec.org'];

function normalizeName(value) {
  return String(value ?? '').trim().replace(/\.+$/, '').toLowerCase();
}

function errorDetail(error) {
  const code = error?.code ? ` (${error.code})` : '';
  return `${error?.message ?? String(error)}${code}`;
}

async function withTimeout(promise, timeoutMs, onTimeout) {
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

/**
 * Queries each configured nameserver IP directly. This verifies that the
 * endpoints answer consistently; it does not prove parent-zone delegation
 * or EU.org registration approval (neither is exposed by Node's Resolver API).
 */
export async function verifyAuthoritativeDns({
  domain = DEFAULT_DOMAIN,
  nameservers = EXPECTED_NAMESERVERS,
  resolveAddresses = lookup,
  resolverFactory = () => new Resolver(),
  queryTimeoutMs = 5000,
} = {}) {
  const zone = normalizeName(domain);
  const expected = [...new Set(nameservers.map(normalizeName))].sort();

  if (!zone || expected.length < 2 || expected.some((name) => !name)) {
    throw new Error('A valid zone and at least two unique nameservers are required.');
  }
  if (!Number.isInteger(queryTimeoutMs) || queryTimeoutMs < 1) {
    throw new Error('queryTimeoutMs must be a positive integer.');
  }

  const checks = [];
  for (const nameserver of expected) {
    let addresses;
    try {
      addresses = await resolveAddresses(nameserver, { all: true, verbatim: true });
    } catch (error) {
      throw new Error(`Address lookup failed for ${nameserver}: ${errorDetail(error)}`, { cause: error });
    }

    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new Error(`No IPv4 or IPv6 addresses found for ${nameserver}.`);
    }

    const uniqueAddresses = [...new Map(addresses.map(({ address, family }) => [
      `${family}:${address}`, { address, family },
    ])).values()];

    for (const endpoint of uniqueAddresses) {
      const detectedFamily = isIP(endpoint.address);
      if (!detectedFamily || detectedFamily !== endpoint.family) {
        throw new Error(`Invalid IP address/family returned for ${nameserver}: ${endpoint.address} (family ${endpoint.family}).`);
      }

      let resolver;
      try {
        resolver = resolverFactory();
        resolver.setServers([endpoint.address]);
        const [soa, ns] = await withTimeout(
          Promise.all([resolver.resolveSoa(zone), resolver.resolveNs(zone)]),
          queryTimeoutMs,
          () => resolver.cancel?.(),
        );

        const observedNs = [...new Set(ns.map(normalizeName))].sort();
        if (!soa || !normalizeName(soa.ns)) {
          throw new Error('SOA response has no valid primary nameserver.');
        }
        if (!expected.includes(normalizeName(soa.ns))) {
          throw new Error(`SOA primary ${normalizeName(soa.ns)} is not one of the expected nameservers.`);
        }
        if (JSON.stringify(observedNs) !== JSON.stringify(expected)) {
          throw new Error(`NS set mismatch; expected [${expected.join(', ')}], received [${observedNs.join(', ')}].`);
        }

        checks.push({
          nameserver,
          address: endpoint.address,
          family: detectedFamily,
          soaPrimary: normalizeName(soa.ns),
          serial: soa.serial,
          ns: observedNs,
          status: 'passed',
        });
      } catch (error) {
        const reason = errorDetail(error);
        throw new Error(`Direct DNS check failed for ${nameserver} at ${endpoint.address}: ${reason}`, { cause: error });
      } finally {
        resolver?.cancel?.();
      }
    }
  }

  return {
    domain: zone,
    nameservers: expected,
    status: 'passed',
    checks,
    registrationApproval: 'not-verified; EU.org confirmation required',
    parentZoneDelegation: 'not-verified by direct nameserver checks',
  };
}

async function main() {
  const domain = process.argv[2] || DEFAULT_DOMAIN;
  const report = await verifyAuthoritativeDns({ domain });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`DNS verification failed: ${error.message}\\n`);
    process.exitCode = 1;
  });
}
