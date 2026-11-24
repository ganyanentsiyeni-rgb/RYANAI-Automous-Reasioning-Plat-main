/**
 * Keep unit-test imports isolated from hosted Supabase configuration.
 * Preserve a job's explicit loopback PostgreSQL/Redis fixture; otherwise use
 * loopback defaults so a repository dotenv overlay can never target U2EB or prod.
 */
function isLoopbackUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

if (process.env.CI === 'true') {
  process.env.NODE_ENV = 'test';
  if (!isLoopbackUrl(process.env.DATABASE_URL)) {
    const localDatabaseUrl = new URL('postgresql:' + '//localhost:5432/ryanai_test');
    localDatabaseUrl.hostname = '127.0.0.1';
    process.env.DATABASE_URL = localDatabaseUrl.toString();
  }
  if (!isLoopbackUrl(process.env.REDIS_URL)) {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  }
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SESSION_POOLER_HOST;
  delete process.env.SUPABASE_SSL_ROOT_CERT_PATH;
}
