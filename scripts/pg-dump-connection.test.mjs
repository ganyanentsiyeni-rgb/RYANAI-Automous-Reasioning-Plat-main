import { describe, expect, it } from 'vitest';
import { buildPgDumpEnvironment } from './pg-dump-connection.mjs';

describe('PostgreSQL dump connection environment', () => {
  it('maps PostgreSQL URL credentials and connection settings to libpq variables', () => {
    const env = buildPgDumpEnvironment(
      'postgresql://backup%40user:p%40ss%3Aword@db.example.test:6543/ryanai?sslmode=verify-full&sslrootcert=%2Fcerts%2Froot.pem&connect_timeout=8&application_name=ryanai-backup',
      { PATH: '/usr/bin', KEEP_ME: 'yes' },
    );
    expect(env.PGHOST).toBe('db.example.test');
    expect(env.PGPORT).toBe('6543');
    expect(env.PGDATABASE).toBe('ryanai');
    expect(env.PGUSER).toBe('backup@user');
    expect(env.PGPASSWORD).toBe('p@ss:word');
    expect(env.PGSSLMODE).toBe('verify-full');
    expect(env.PGSSLROOTCERT).toBe('/certs/root.pem');
    expect(env.PGCONNECT_TIMEOUT).toBe('8');
    expect(env.PGAPPNAME).toBe('ryanai-backup');
    expect(env.KEEP_ME).toBe('yes');
  });

  it('normalizes bracketed IPv6 hosts for libpq', () => {
    const env = buildPgDumpEnvironment('postgres://user:pass@[::1]:5433/ryanai');
    expect(env.PGHOST).toBe('::1');
    expect(env.PGPORT).toBe('5433');
  });

  it('preserves inherited PGUSER when URL omits a username', () => {
    const env = buildPgDumpEnvironment('postgres://db.example.test/ryanai', { PGUSER: 'runtime-user' });
    expect(env.PGUSER).toBe('runtime-user');
  });

  it('rejects non-PostgreSQL and incomplete URLs without echoing credentials', () => {
    for (const value of [
      'https://user:private-password@db.example.test/ryanai',
      'postgresql://user:private-password@db.example.test/',
      'not-a-url',
    ]) {
      expect(() => buildPgDumpEnvironment(value)).toThrow(/DATABASE_URL/);
      expect(() => buildPgDumpEnvironment(value)).toThrowError(expect.not.stringContaining('private-password'));
    }
  });
});
