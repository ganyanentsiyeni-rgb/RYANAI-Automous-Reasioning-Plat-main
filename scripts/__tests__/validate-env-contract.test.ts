import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseContractKeys } from '../validate-env-contract.js';

describe('names-only environment contract', () => {
  const originalEnv = { ...process.env };
  const dirs: string[] = [];

  afterEach(() => {
    process.env = { ...originalEnv };
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a names-only contract', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ryanai-env-contract-'));
    dirs.push(dir);
    const file = path.join(dir, '.env.example');
    fs.writeFileSync(file, 'DATABASE_URL=\nTWILIO_AUTH_TOKEN=\n');
    expect(parseContractKeys(file)).toEqual(['DATABASE_URL', 'TWILIO_AUTH_TOKEN']);
  });

  it('rejects populated values without exposing the value', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ryanai-env-contract-'));
    dirs.push(dir);
    const file = path.join(dir, '.env.example');
    const secret = 'super-secret-token-99999';
    fs.writeFileSync(file, `TWILIO_AUTH_TOKEN=${secret}\n`);
    expect(() => parseContractKeys(file)).toThrowError((err: Error) => {
      expect(err.message).toContain('TWILIO_AUTH_TOKEN');
      expect(err.message).not.toContain(secret);
      return true;
    });
  });

  it('rejects duplicate keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ryanai-env-contract-'));
    dirs.push(dir);
    const file = path.join(dir, '.env.example');
    fs.writeFileSync(file, 'DATABASE_URL=\nDATABASE_URL=\n');
    expect(() => parseContractKeys(file)).toThrow(/duplicate keys/);
  });
});
