#!/usr/bin/env node
import { Resolver, lookup } from 'node:dns/promises';

export const DEFAULT_DOMAIN = 'ryanai.eu.org';
export const EXPECTED_NAMESERVERS = ['ns1.desec.io', 'ns2.desec.org'];

function normalizeName(value) {
  return String(value ?? '').trim().replace(/\\.$/, '').toLowerCase();
}

export async function verifyAuthoritativeDns({
  domain = DEFAULT_DOMAIN,
  nameservers = EXPECTED_NAMESERVERS,
  resolveAddresses = lookup,
  resolverFactory = () => new Resolver(),
} = {}) {
  const zone = normalizeName(domain);
  const expected = nameservers.map(normalizeName);
  if (!zone || expected.length < 2 || expected.some((name) => !name)) {
    throw new Error('A zone and at least two nameservers are required.');
  }

  const results = [];
  for (const nameserver of expected) {
    const addresses = await resolveAddresses(nameserver, { all: true, verbatim: true });
    if (!addresses.length) throw new Error(`No IP addresses found for ${nameserver}`);

    for (const address of addresses) {
      const resolver = resolverFactory();
      resolver.setServers([address.address]);
      const [soa, ns] = await Promise.all([
        resolver.resolveSoa(zone),
        resolver.resolveNs(zone),
      ]);
      const observedNs = ns.map(normalizeName).sort();
      const missing = expected.filter((name) => !observedNs.includes(name));
      if (missing.length) {
        throw new Error(`${nameserver} at ${address.address} returned NS records missing: ${missing.join(', ')}`);
      }
      if (!normalizeName(soa.ns)) {
        throw new Error(`${nameserver} at ${address.address} returned an invalid SOA primary server`);
      }
      results.push({
        nameserver,
        address: address.address,
        family: address.family,
        soaPrimary: normalizeName(soa.ns),
        serial: soa.serial,
        ns: observedNs,
      });
    }
  }
  return { domain: zone, nameservers: expected, checks: results };
}

async function main() {
  const domain = process.argv[2] || DEFAULT_DOMAIN;
  const report = await verifyAuthoritativeDns({ domain });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    process.stderr.write(`DNS verification failed: ${error.message}\\n`);
    process.exitCode = 1;
  });
}
