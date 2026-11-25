import fs from 'node:fs';
import path from 'node:path';

const LINE_PATTERN = /^([A-Z][A-Z0-9_]*)=(.*)$/;

export function parseContractKeys(contractPath = path.resolve(process.cwd(), '.env.example')): string[] {
  if (!fs.existsSync(contractPath)) throw new Error('[env-contract] Contract file not found.');

  const keys: string[] = [];
  const pollutedKeys: string[] = [];
  const duplicateKeys: string[] = [];

  for (const rawLine of fs.readFileSync(contractPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(LINE_PATTERN);
    if (!match) throw new Error('[env-contract] Malformed declaration in contract.');
    const [, key, value] = match;
    if (value.trim()) pollutedKeys.push(key);
    if (keys.includes(key)) duplicateKeys.push(key);
    keys.push(key);
  }

  if (pollutedKeys.length || duplicateKeys.length) {
    const problems = [
      pollutedKeys.length ? `non-empty values: ${pollutedKeys.join(', ')}` : '',
      duplicateKeys.length ? `duplicate keys: ${duplicateKeys.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`[env-contract] Names-only contract violation: ${problems}`);
  }
  return keys;
}

export function validateEnvContract(contractPath?: string): void {
  const keys = parseContractKeys(contractPath);
  const missing = keys.filter((key) => process.env[key] === undefined || process.env[key] === '');
  if (missing.length) {
    throw new Error(`[env-contract] Missing required runtime keys (names only): ${missing.join(', ')}`);
  }
  console.log(`[env-contract] Verified ${keys.length} contract keys; values were not logged.`);
}

if (process.argv[1]?.endsWith('validate-env-contract.ts')) validateEnvContract();
