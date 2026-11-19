import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTarget } from './migrate-render-staging.mjs';

const good = 'postgresql://ryanai_database_user@dpg-dbtev2rm8hqs73anvf00-a.oregon-postgres.render.com/ryanai_database';

test('accepts only the approved Render staging database identity', () => {
  assert.equal(validateTarget(good).pathname, '/ryanai_database');
});
test('rejects Supabase, pooler, production, other Render DBs and wrong database/user', () => {
  for (const value of [
    'postgresql://u@db.example.supabase.co/ryanai_database',
    'postgresql://u@aws-1.pooler.supabase.com/ryanai_database',
    'postgresql://u@dpg-dbtev2rm8hqs73anvf00-a.oregon-postgres.render.com/production',
    'postgresql://u@dpg-other.oregon-postgres.render.com/ryanai_database',
    'postgresql://other@dpg-dbtev2rm8hqs73anvf00-a.oregon-postgres.render.com/ryanai_database',
  ]) assert.throws(() => validateTarget(value));
});
test('rejects missing DATABASE_URL', () => assert.throws(() => validateTarget(undefined)));
