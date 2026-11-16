import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

const launcher = await readFile(new URL('../src/server/launcher.ts', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../supabase/migrations/20261108195000_community_feedback_submissions.sql', import.meta.url),
  'utf8',
);

test('community survey exposes exactly one anonymous feedback handler', () => {
  assert.equal(
    (launcher.match(/fastify\.post<\{[\s\S]*?\}>\('\/api\/community-feedback'/g) ?? []).length,
    1,
  );
  assert.equal(
    (launcher.match(/fastify\.post<\{[\s\S]*?\}>\('\/api\/community-beta-interest'/g) ?? []).length,
    1,
  );

  const feedbackStart = launcher.indexOf("fastify.post<{");
  const feedbackRoute = launcher.slice(feedbackStart, launcher.indexOf("fastify.post<{", feedbackStart + 1));
  assert.match(feedbackRoute, /'\/api\/community-feedback'/);
  assert.doesNotMatch(feedbackRoute, /contactName|contactEmail|followUpConsent/);

  const persistIndex = feedbackRoute.indexOf('community_feedback_submissions');
  const notifyIndex = feedbackRoute.indexOf('transporter.sendMail');
  assert.ok(persistIndex >= 0, 'survey persistence must exist');
  assert.ok(notifyIndex >= 0, 'owner notification must exist');
  assert.ok(persistIndex < notifyIndex, 'survey must be durably stored before notification');
  assert.match(feedbackRoute, /notificationStatus/);
});

test('community survey migration contains one coherent definition per table', () => {
  assert.equal(
    (migration.match(/CREATE TABLE IF NOT EXISTS public\.community_feedback_submissions/g) ?? []).length,
    1,
  );
  assert.equal(
    (migration.match(/CREATE TABLE IF NOT EXISTS public\.community_beta_interest/g) ?? []).length,
    1,
  );
  assert.match(migration, /REVOKE ALL ON TABLE public\.community_feedback_submissions/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.community_beta_interest/);
  assert.doesNotMatch(migration, /contactEmail|contactName|followUpConsent/);
});
