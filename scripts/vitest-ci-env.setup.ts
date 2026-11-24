/**
 * Keep unit-test imports isolated from hosted Supabase configuration.
 * PostgreSQL integration tests provision their own disposable database and opt in
 * explicitly; the ordinary Vitest suite must never inherit a hosted DATABASE_URL.
 */
if (process.env.CI === 'true') {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://ryanai:ci_password@127.0.0.1:5432/ryanai_test';
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SESSION_POOLER_HOST;
  delete process.env.SUPABASE_SSL_ROOT_CERT_PATH;
}
