import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoolOptions, validateTarget } from './migrate-render-staging.mjs';

const good = 'postgresql://ryanai_database_user:secret@dpg-dbtev2rm8hqs73anvf00-a.oregon-postgres.render.com/ryanai_database';

test('accepts only the approved Render staging database identity', () => {
  assert.equal(validateTarget(good).pathname, '/ryanai_database');
});

test('rejects Supabase, pooler, production, other Render DBs and wrong database/user', () => {
  for (const value of [
    'postgresql://u:p@db.example.supabase.co/ryanai_database',
    'postgresql://u:p@aws-1.pooler.supabase.com/ryanai_database',
    'postgresql://u:p@dpg-dbtev2rm8hqs73anvf00-a.oregon-postgres.render.com/production',
    'postgresql://u:p@dpg-other.oregon-postgres.render.com/ryanai_database',
    'postgresql://other:p@dpg-dbtev2rm8hqs73anvf00-a.oregon-postgres.render.com/ryanai_database',
  ]) assert.throws(() => validateTarget(value));
});
test('rejects missing DATABASE_URL', () => assert.throws(() => validateTarget(undefined)));

test('rejects missing DATABASE_URL', () => {
  assert.throws(() => validateTarget(undefined));
});

test('requires TLS and verifies the PostgreSQL server certificate', () => {
  const options = createPoolOptions(good);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.equal(options.connectionString, good);
  assert.equal(options.max, 1);
});
