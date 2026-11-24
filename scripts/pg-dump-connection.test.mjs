import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPgDumpEnvironment } from './pg-dump-connection.mjs';

function makeConnectionUrl() {
  const url = new URL('https://db.example.test/ryanai');
  url.protocol = 'postgresql:';
  url.username = 'backup@user';
  url.password = 'p@ss:word';
  url.hostname = 'db.example.test';
  url.port = '6543';
  url.pathname = '/ryanai';
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', '/certs/root.pem');
  url.searchParams.set('connect_timeout', '8');
  url.searchParams.set('application_name', 'ryanai-backup');
  return url.toString();
}

describe('PostgreSQL dump connection environment', () => {
  it('maps URL credentials and connection settings to libpq variables', () => {
    const env = buildPgDumpEnvironment(makeConnectionUrl(), { PATH: '/usr/bin', KEEP_ME: 'yes' });
    assert.equal(env.PGHOST, 'db.example.test');
    assert.equal(env.PGPORT, '6543');
    assert.equal(env.PGDATABASE, 'ryanai');
    assert.equal(env.PGUSER, 'backup@user');
    assert.equal(env.PGPASSWORD, 'p@ss:word');
    assert.equal(env.PGSSLMODE, 'verify-full');
    assert.equal(env.PGSSLROOTCERT, '/certs/root.pem');
    assert.equal(env.PGCONNECT_TIMEOUT, '8');
    assert.equal(env.PGAPPNAME, 'ryanai-backup');
    assert.equal(env.KEEP_ME, 'yes');
  });

  it('normalizes bracketed IPv6 hosts for libpq', () => {
    const url = new URL('https://db.example.test/ryanai');
    url.protocol = 'postgresql:';
    url.username = 'user';
    url.password = 'pass';
    url.hostname = '[::1]';
    url.port = '5433';
    url.pathname = '/ryanai';
    const env = buildPgDumpEnvironment(url.toString());
    assert.equal(env.PGHOST, '::1');
    assert.equal(env.PGPORT, '5433');
  });

  it('preserves inherited PGUSER when URL omits a username', () => {
    const url = new URL('https://db.example.test/ryanai');
    url.protocol = 'postgresql:';
    url.pathname = '/ryanai';
    const env = buildPgDumpEnvironment(url.toString(), { PGUSER: 'runtime-user' });
    assert.equal(env.PGUSER, 'runtime-user');
  });

  it('rejects non-PostgreSQL and incomplete URLs without echoing credentials', () => {
    const invalid = new URL('https://db.example.test/ryanai');
    invalid.username = 'user';
    invalid.password = 'private-password';
    invalid.hostname = 'db.example.test';
    invalid.pathname = '/ryanai';
    const missingDatabase = new URL('https://db.example.test/');
    missingDatabase.protocol = 'postgresql:';
    missingDatabase.username = 'user';
    missingDatabase.password = 'private-password';
    missingDatabase.hostname = 'db.example.test';
    for (const value of [invalid.toString(), missingDatabase.toString(), 'not-a-url']) {
      assert.throws(() => buildPgDumpEnvironment(value), (error) => {
        assert.match(error.message, /DATABASE_URL/);
        assert.equal(error.message.includes('private-password'), false);
        return true;
      });
    }
  });
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPgDumpEnvironment } from './pg-dump-connection.mjs';

test('maps PostgreSQL URL credentials and connection settings to libpq variables', () => {
  const env = buildPgDumpEnvironment(
    'postgresql://backup%40user:p%40ss%3Aword@db.example.test:6543/ryanai?sslmode=verify-full&sslrootcert=%2Fcerts%2Froot.pem&connect_timeout=8&application_name=ryanai-backup',
    { PATH: '/usr/bin', KEEP_ME: 'yes' },
  );
  assert.equal(env.PGHOST, 'db.example.test');
  assert.equal(env.PGPORT, '6543');
  assert.equal(env.PGDATABASE, 'ryanai');
  assert.equal(env.PGUSER, 'backup@user');
  assert.equal(env.PGPASSWORD, 'p@ss:word');
  assert.equal(env.PGSSLMODE, 'verify-full');
  assert.equal(env.PGSSLROOTCERT, '/certs/root.pem');
  assert.equal(env.PGCONNECT_TIMEOUT, '8');
  assert.equal(env.PGAPPNAME, 'ryanai-backup');
  assert.equal(env.KEEP_ME, 'yes');
});

test('normalizes bracketed IPv6 hosts for libpq', () => {
  const env = buildPgDumpEnvironment('postgres://user:pass@[::1]:5433/ryanai');
  assert.equal(env.PGHOST, '::1');
  assert.equal(env.PGPORT, '5433');
});

test('preserves inherited PGUSER when URL omits a username', () => {
  const env = buildPgDumpEnvironment('postgres://db.example.test/ryanai', { PGUSER: 'runtime-user' });
  assert.equal(env.PGUSER, 'runtime-user');
});

test('rejects non-PostgreSQL and incomplete URLs without echoing credentials', () => {
  for (const value of [
    'https://user:private-password@db.example.test/ryanai',
    'postgresql://user:private-password@db.example.test/',
    'not-a-url',
  ]) {
    assert.throws(() => buildPgDumpEnvironment(value), (error) => {
      assert.match(error.message, /DATABASE_URL/);
      assert.equal(error.message.includes('private-password'), false);
      return true;
    });
  }
});
