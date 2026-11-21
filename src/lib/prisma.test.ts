import { afterEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor(options?: unknown) {
      captured.options.push(options);
    }
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  captured.options.length = 0;
});

describe('shared Prisma client connection configuration', () => {
  it('uses the same project-qualified Supabase Session Pooler URL as the API launcher', async () => {
    const projectRef = 'narsvpwymvlrhurqbthu';
    const poolerHost = 'aws-1-eu-west-1.pooler.supabase.com';
    const database = new URL('postgresql://postgres:placeholder@db.' + projectRef + '.supabase.co:5432/postgres');

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', database.toString());
    vi.stubEnv('REDIS_URL', 'redis://cache:6379');
    vi.stubEnv('SUPABASE_URL', 'https://' + projectRef + '.supabase.co');
    vi.stubEnv('SUPABASE_SESSION_POOLER_HOST', poolerHost);
    vi.stubEnv('SUPABASE_SSL_ROOT_CERT_PATH', '/etc/ssl/supabase-root.crt');

    const { prisma } = await import('./prisma.js');

    expect(prisma).toBeDefined();
    const options = captured.options.at(-1) as { datasources: { db: { url: string } } };
    const resolved = new URL(options.datasources.db.url);

    expect(resolved.hostname).toBe(poolerHost);
    expect(resolved.port).toBe('5432');
    expect(resolved.username).toBe('postgres.' + projectRef);
    expect(resolved.searchParams.get('sslmode')).toBe('verify-full');
    expect(resolved.searchParams.get('sslrootcert')).toBe('/etc/ssl/supabase-root.crt');
    expect(resolved.searchParams.get('sslaccept')).toBe('strict');
  });
});
