import { describe, expect, it } from 'vitest';
import { assertProductionDependencies, resolveConnectionUrls } from './startupConfig.js';

const expectedLocalDatabaseUrl = () => {
  const url = new URL('postgresql:' + '//localhost:5432/ryanai');
  url.username = 'postgres';
  url.password = 'postgres';
  return url.toString();
};

const supabaseProjectRef = 'narsvpwymvlrhurqbthu';
const supabaseProjectUrl = `https://${supabaseProjectRef}.supabase.co`;
const supabasePoolerHost = 'aws-1-eu-west-1.pooler.supabase.com';

function supabaseDatabaseUrl(host: string, password = 'test-placeholder'): string {
  const url = new URL('postgresql:' + '//localhost:5432/postgres');
  url.hostname = host;
  url.username = 'postgres';
  url.password = password;
  return url.toString();
}

describe('production and staging connection configuration', () => {
  it('fails closed when production database and Redis URLs are missing', () => {
    expect(() => resolveConnectionUrls('production')).toThrow(
      'DATABASE_URL, REDIS_URL',
    );
  });

  it('fails closed when staging database and Redis URLs are missing', () => {
    expect(() => resolveConnectionUrls('staging')).toThrow('DATABASE_URL, REDIS_URL');
  });

  it('identifies only the missing production variable', () => {
    expect(() => resolveConnectionUrls('production', 'postgresql://db/app')).toThrow(
      'REDIS_URL',
    );
    expect(() => resolveConnectionUrls('production', undefined, 'redis://cache')).toThrow(
      'DATABASE_URL',
    );
  });

  it('rejects malformed production DATABASE_URL values before Prisma initialization', () => {
    expect(() => resolveConnectionUrls(
      'production',
      'postgresql://postgres:password@',
      'redis://cache',
    )).toThrow('Invalid DATABASE_URL: expected a complete PostgreSQL connection URI');

    expect(() => resolveConnectionUrls(
      'production',
      'https://database.example.com',
      'redis://cache',
    )).toThrow('Invalid DATABASE_URL: expected a PostgreSQL URI with a hostname');
  });

  it('accepts explicitly configured staging URLs without production defaults', () => {
    expect(resolveConnectionUrls('staging', 'postgresql://staging-db/app', 'redis://staging-cache')).toEqual({
      databaseUrl: 'postgresql://staging-db/app',
      redisUrl: 'redis://staging-cache',
    });
  });

  it('accepts explicitly configured production URLs', () => {
    expect(
      resolveConnectionUrls(
        'production',
        'postgresql://db/app',
        'redis://cache/0',
      ),
    ).toEqual({
      databaseUrl: 'postgresql://db/app',
      redisUrl: 'redis://cache/0',
    });
  });

  it('routes a Supabase direct connection through the configured IPv4 Session Pooler', () => {
    const result = resolveConnectionUrls(
      'production',
      supabaseDatabaseUrl(`db.${supabaseProjectRef}.supabase.co`, 'p@ss:word'),
      'redis://cache',
      supabaseProjectUrl,
      supabasePoolerHost,
      '/etc/ssl/supabase-root.crt',
    );
    const database = new URL(result.databaseUrl);

    expect(database.hostname).toBe(supabasePoolerHost);
    expect(database.port).toBe('5432');
    expect(database.username).toBe(`postgres.${supabaseProjectRef}`);
    expect(database.password).toBe('p%40ss%3Aword');
    expect(database.searchParams.get('sslmode')).toBe('verify-full');
    expect(database.searchParams.get('sslrootcert')).toBe('/etc/ssl/supabase-root.crt');
    expect(database.searchParams.get('sslaccept')).toBe('strict');
  });

  it('repairs an existing Supabase pooler URL with an unqualified username', () => {
    const result = resolveConnectionUrls(
      'production',
      supabaseDatabaseUrl(supabasePoolerHost),
      'redis://cache',
      supabaseProjectUrl,
      supabasePoolerHost,
    );
    const database = new URL(result.databaseUrl);

    expect(database.hostname).toBe(supabasePoolerHost);
    expect(database.username).toBe(`postgres.${supabaseProjectRef}`);
    expect(database.searchParams.get('sslmode')).toBe('verify-full');
  });

  it('routes the dedicated U2EB Supabase project through its exact EU Central Session Pooler', () => {
    const u2ebProjectRef = 'omqavyppdoniehseokvx';
    const u2ebProjectUrl = `https://${u2ebProjectRef}.supabase.co`;
    const u2ebPoolerHost = 'aws-1-eu-central-1.pooler.supabase.com';
    const result = resolveConnectionUrls(
      'staging',
      `postgresql://postgres.${u2ebProjectRef}:test-placeholder@db.${u2ebProjectRef}.supabase.co:5432/postgres`,
      'redis://u2eb-cache',
      u2ebProjectUrl,
      u2ebPoolerHost,
      '/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt',
    );
    const database = new URL(result.databaseUrl);

    expect(database.hostname).toBe(u2ebPoolerHost);
    expect(database.port).toBe('5432');
    expect(database.username).toBe(`postgres.${u2ebProjectRef}`);
    expect(database.searchParams.get('sslmode')).toBe('verify-full');
    expect(database.searchParams.get('sslrootcert')).toBe(
      '/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt',
    );
    expect(database.searchParams.get('sslaccept')).toBe('strict');
  });

  it('rejects Supabase pooler routing when its project or verified host is missing', () => {
    expect(() => resolveConnectionUrls(
      'production',
      `postgresql://postgres:password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`,
      'redis://cache',
      supabaseProjectUrl,
    )).toThrow('SUPABASE_SESSION_POOLER_HOST');
  });

  it('rejects a primary database URL that points outside the configured U2EB Supabase project', () => {
    const u2ebProjectUrl = 'https://omqavyppdoniehseokvx.supabase.co';
    expect(() => resolveConnectionUrls(
      'staging',
      (() => {
        const databaseUrl = new URL('postgresql:' + '//localhost:5432/ryanai');
        databaseUrl.hostname = 'postgres.internal.example';
        return databaseUrl.toString();
      })(),
      'redis://u2eb-cache',
      u2ebProjectUrl,
      'aws-1-eu-central-1.pooler.supabase.com',
    )).toThrow(/DATABASE_URL must target the Supabase project configured by SUPABASE_URL/);
  });

  it('allows the explicit local Compose Postgres service alongside Supabase Auth', () => {
    expect(resolveConnectionUrls(
      'production',
      'postgresql://ryanai:local-only@postgres:5432/ryanai_db',
      'redis://redis:6379',
      supabaseProjectUrl,
      supabasePoolerHost,
      undefined,
      true,
    )).toEqual({
      databaseUrl: 'postgresql://ryanai:local-only@postgres:5432/ryanai_db',
      redisUrl: 'redis://redis:6379',
    });
  });

  it('does not let local Compose mode bypass a non-Compose database host', () => {
    expect(() => resolveConnectionUrls(
      'staging',
      'postgresql://ryanai:local-only@remote-db.example:5432/ryanai_db',
      'redis://u2eb-cache',
      'https://omqavyppdoniehseokvx.supabase.co',
      'aws-1-eu-central-1.pooler.supabase.com',
      undefined,
      true,
    )).toThrow(/DATABASE_URL must target the Supabase project configured by SUPABASE_URL/);
  });

  it('does not route tests to a hosted Supabase URL inherited from dotenv', () => {
    const result = resolveConnectionUrls(
      'test',
      supabaseDatabaseUrl(`db.${supabaseProjectRef}.supabase.co`),
      'redis://test-cache',
      supabaseProjectUrl,
      undefined,
    );

    expect(result).toEqual({
      databaseUrl: expectedLocalDatabaseUrl(),
      redisUrl: 'redis://test-cache',
    });
  });

  it('allows the shared database callers to use the explicit loopback disposable policy', () => {
    expect(resolveConnectionUrls(
      'staging',
      'postgresql://postgres:test-placeholder@localhost:5432/postgres',
      'redis://u2eb-cache',
      supabaseProjectUrl,
      supabasePoolerHost,
      undefined,
      false,
      true,
    ).databaseUrl).toBe('postgresql://postgres:test-placeholder@localhost:5432/postgres');
  });

  it('retains local defaults outside production', () => {
    expect(resolveConnectionUrls('development')).toEqual({
      databaseUrl: expectedLocalDatabaseUrl(),
      redisUrl: 'redis://localhost:6379',
    });
    expect(resolveConnectionUrls('test')).toEqual({
      databaseUrl: expectedLocalDatabaseUrl(),
      redisUrl: 'redis://localhost:6379',
    });
  });

  it('does not treat whitespace-only values as configured', () => {
    expect(() => resolveConnectionUrls('production', '  ', 'redis://cache')).toThrow(
      'DATABASE_URL',
    );
  });
});

describe('production and staging startup dependency gate', () => {
  it('blocks staging startup when PostgreSQL or Redis is unavailable', () => {
    expect(() => assertProductionDependencies('staging', { database: false, redis: true, agentCheckpointer: true })).toThrow('PostgreSQL');
    expect(() => assertProductionDependencies('staging', { database: true, redis: false, agentCheckpointer: true })).toThrow('Redis');
  });

  it('blocks production startup when PostgreSQL is unavailable', () => {
    expect(() =>
      assertProductionDependencies('production', { database: false, redis: true, agentCheckpointer: true }),
    ).toThrow('PostgreSQL');
  });

  it('blocks production startup when Redis is unavailable', () => {
    expect(() =>
      assertProductionDependencies('production', { database: true, redis: false, agentCheckpointer: true }),
    ).toThrow('Redis');
  });

  it('allows production startup only when both dependencies are ready', () => {
    expect(() =>
      assertProductionDependencies('production', { database: true, redis: true, agentCheckpointer: true }),
    ).not.toThrow();
  });

  it('keeps non-production degraded startup behavior unchanged', () => {
    expect(() =>
      assertProductionDependencies('development', { database: false, redis: false, agentCheckpointer: false }),
    ).not.toThrow();
    expect(() =>
      assertProductionDependencies('test', { database: false, redis: false, agentCheckpointer: false }),
    ).not.toThrow();
  });
});

describe('production agent checkpointer readiness', () => {
  it('blocks staging startup when the agent checkpointer is unavailable', () => {
    expect(() => assertProductionDependencies('staging', { database: true, redis: true, agentCheckpointer: false })).toThrow('agent checkpointer');
  });

  it('blocks production startup when the agent checkpointer is unavailable', () => {
    expect(() =>
      assertProductionDependencies('production', {
        database: true,
        redis: true,
        agentCheckpointer: false,
      }),
    ).toThrow('agent checkpointer');
  });
});
