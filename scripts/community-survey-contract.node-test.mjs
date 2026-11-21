import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

const launcher = await readFile(new URL('../src/server/launcher.ts', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../supabase/migrations/20261108195000_community_feedback_submissions.sql', import.meta.url),
  'utf8',
);

function getPostRouteBlock(path) {
  const pathIndex = launcher.indexOf(`'${path}'`);
  assert.ok(pathIndex >= 0, `Route ${path} must exist`);

  const routeStart = launcher.lastIndexOf('fastify.post<{', pathIndex);
  assert.ok(routeStart >= 0, `Route ${path} must use a typed POST handler`);

  const nextRoute = launcher.indexOf('fastify.post<{', routeStart + 1);
  return launcher.slice(routeStart, nextRoute >= 0 ? nextRoute : launcher.length);
}

test('community survey exposes exactly one anonymous feedback handler', () => {
  const feedbackRoute = getPostRouteBlock('/api/community-feedback');
  const betaRoute = getPostRouteBlock('/api/community-beta-interest');

  assert.equal(
    (feedbackRoute.match(/'\/api\/community-feedback'/g) ?? []).length,
    1,
  );
  assert.equal(
    (betaRoute.match(/'\/api\/community-beta-interest'/g) ?? []).length,
    1,
  );

  assert.doesNotMatch(feedbackRoute, /contactName|contactEmail|followUpConsent/);
  assert.match(feedbackRoute, /privacyConsent\?: boolean/);
  assert.match(feedbackRoute, /body\.privacyConsent !== true/);
  assert.match(feedbackRoute, /privacyConsent: true/);
  assert.match(feedbackRoute, /privacyConsentAt: new Date\(\)\.toISOString\(\)/);

  const persistIndex = feedbackRoute.indexOf('community_feedback_submissions');
  const notifyIndex = feedbackRoute.indexOf('transporter.sendMail');

  assert.ok(persistIndex >= 0, 'survey persistence must exist');
  assert.ok(notifyIndex >= 0, 'owner notification must exist');
  assert.ok(persistIndex < notifyIndex, 'survey must be durably stored before notification');
  assert.match(feedbackRoute, /notificationStatus/);

  assert.match(betaRoute, /name\?: string/);
  assert.match(betaRoute, /email\?: string/);
  assert.match(betaRoute, /consent\?: boolean/);
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
