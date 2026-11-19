import { expect, test } from 'vitest';
import { createPoolOptions, validateTarget } from './migrate-render-staging.mjs';

const good = 'postgresql://ryanai_database_user:secret@dpg-dbtev2rm8hqs73anvf00-a.oregon-postgres.render.com/ryanai_database';

test('accepts only the approved Render staging database identity', () => {
  expect(validateTarget(good).pathname).toBe('/ryanai_database');
});
test('rejects Supabase, pooler, production, other Render DBs and wrong database/user', () => {
  for (const value of [
    'postgresql://u:p@db.example.supabase.co/ryanai_database',
    'postgresql://u:p@aws-1.pooler.supabase.com/ryanai_database',
    'postgresql://u:p@dpg-dbtev2rm8hqs73anvf00-a.oregon-postgres.render.com/production',
    'postgresql://u:p@dpg-other.oregon-postgres.render.com/ryanai_database',
    'postgresql://other:p@dpg-dbtev2rm8hqs73anvf00-a.oregon-postgres.render.com/ryanai_database',
  ]) expect(() => validateTarget(value)).toThrow();
});
test('rejects missing DATABASE_URL', () => expect(() => validateTarget(undefined)).toThrow());

test('requires TLS and verifies the PostgreSQL server certificate', () => {
  const options = createPoolOptions(good);
  expect(options.ssl).toEqual({ rejectUnauthorized: true });
  expect(options.connectionString).toBe(good);
  expect(options.max).toBe(1);
});
