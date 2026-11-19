import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { EventLeaseLostError, IntelligenceEventInbox } from '../src/events/intelligenceEventInbox.ts';

if (process.env.RYANAI_DISPOSABLE_DB !== '1' || !process.env.DATABASE_URL) {
  throw new Error('Refusing to run unless RYANAI_DISPOSABLE_DB=1 and DATABASE_URL are set by the disposable PostgreSQL harness.');
}
const databaseUrl = new URL(process.env.DATABASE_URL);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
if (!['127.0.0.1', 'localhost', '::1'].includes(databaseUrl.hostname)
  || !databaseName.includes('disposable')) {
  throw new Error('Refusing to run: DATABASE_URL must target a loopback host and a database name containing "disposable".');
}

const db = new PrismaClient();
const inbox = new IntelligenceEventInbox(db, { leaseMs: 5_000, baseRetryMs: 100, maxRetryMs: 1_000 });
const ids = [];
const now = new Date();

async function enqueue(label) {
  const id = randomUUID();
  const result = await inbox.enqueue({
    eventId: id,
    eventType: 'integration.lifecycle.test',
    schemaVersion: 1,
    occurredAt: now.toISOString(),
    source: { provider: 'integration-test', service: 'postgres' },
    idempotencyKey: `postgres-inbox:${label}:${id}`,
    classification: 'internal',
    payload: { label },
  });
  ids.push(result.event.id);
  return result.event;
}

try {
  const claimEvent = await enqueue('competing-claims');
  const claims = await Promise.all([
    inbox.claimNext('concurrent-a', now, ['integration.lifecycle.test']),
    inbox.claimNext('concurrent-b', now, ['integration.lifecycle.test']),
  ]);
  const winners = claims.filter(Boolean);
  assert.equal(winners.length, 1, 'only one concurrent claimant may own the event');
  assert.equal(winners[0].id, claimEvent.id);
  const claimAudit = await db.intelligenceEventAttempt.findMany({ where: { eventInboxId: claimEvent.id } });
  assert.equal(claimAudit.length, 1);
  assert.equal(claimAudit[0].attempt, 1);
  console.log('PASS: concurrent claims serialize to one lease and one audit row');

  const expired = await enqueue('competing-recovery');
  await db.intelligenceEventInbox.update({
    where: { id: expired.id },
    data: { status: 'processing', attempts: 1, leaseOwner: 'expired-worker', leaseExpiresAt: new Date(now.getTime() - 1_000) },
  });
  await db.intelligenceEventAttempt.create({
    data: { eventInboxId: expired.id, attempt: 1, workerId: 'expired-worker', status: 'started' },
  });
  const recoveries = await Promise.all([inbox.recoverExpiredLeases(now), inbox.recoverExpiredLeases(now)]);
  assert.equal(recoveries.reduce((sum, count) => sum + count, 0), 1);
  const recovered = await db.intelligenceEventInbox.findUniqueOrThrow({ where: { id: expired.id } });
  const recoveryAudit = await db.intelligenceEventAttempt.findMany({ where: { eventInboxId: expired.id } });
  assert.equal(recovered.status, 'retry');
  assert.equal(recoveryAudit.length, 1);
  assert.equal(recoveryAudit[0].status, 'lease_expired');
  console.log('PASS: concurrent lease recovery has one compare-and-set winner');

  const reclaimedWithSameWorker = await inbox.claimNext('expired-worker', new Date(now.getTime() + 10), ['integration.lifecycle.test']);
  assert.ok(reclaimedWithSameWorker, 'the expired lease should be claimable again');
  assert.equal(reclaimedWithSameWorker.id, expired.id);
  assert.equal(reclaimedWithSameWorker.attempts, 2);
  await assert.rejects(
    inbox.acknowledge(expired.id, 'expired-worker', 1, new Date(now.getTime() + 20)),
    (error) => error instanceof EventLeaseLostError,
    'the previous attempt must be fenced even when the worker ID is reused',
  );
  await inbox.acknowledge(expired.id, 'expired-worker', 2, new Date(now.getTime() + 20));
  const sameWorkerAudit = await db.intelligenceEventAttempt.findMany({
    where: { eventInboxId: expired.id },
    orderBy: { attempt: 'asc' },
  });
  assert.deepEqual(sameWorkerAudit.map((row) => [row.attempt, row.workerId, row.status]), [
    [1, 'expired-worker', 'lease_expired'],
    [2, 'expired-worker', 'succeeded'],
  ]);
  console.log('PASS: expired lease reclaimed by same worker ID; stale attempt fenced by attempt number');


  const missingAudit = await enqueue('missing-audit-rollback');
  await db.intelligenceEventInbox.update({
    where: { id: missingAudit.id },
    data: { status: 'processing', attempts: 1, leaseOwner: 'worker-a', leaseExpiresAt: new Date(now.getTime() + 60_000) },
  });
  await assert.rejects(
    inbox.acknowledge(missingAudit.id, 'worker-a', 1, now),
    /Expected exactly one started attempt audit record/,
  );
  const unchanged = await db.intelligenceEventInbox.findUniqueOrThrow({ where: { id: missingAudit.id } });
  assert.equal(unchanged.status, 'processing', 'audit failure must roll back the inbox transition');
  console.log('PASS: missing attempt audit aborts and rolls back acknowledgement');

  const missingFailureAudit = await enqueue('missing-failure-audit');
  await db.intelligenceEventInbox.update({
    where: { id: missingFailureAudit.id },
    data: { status: 'processing', attempts: 1, leaseOwner: 'worker-fail', leaseExpiresAt: new Date(now.getTime() + 60_000) },
  });
  await assert.rejects(
    inbox.fail(missingFailureAudit.id, 'worker-fail', 1, new Error('synthetic failure'), now),
    /Expected exactly one started attempt audit record/,
  );
  const failureUnchanged = await db.intelligenceEventInbox.findUniqueOrThrow({ where: { id: missingFailureAudit.id } });
  assert.equal(failureUnchanged.status, 'processing');
  console.log('PASS: missing failure audit aborts and rolls back inbox retry transition');

  const missingRecoveryAudit = await enqueue('missing-recovery-audit');
  await db.intelligenceEventInbox.update({
    where: { id: missingRecoveryAudit.id },
    data: { status: 'processing', attempts: 1, leaseOwner: 'worker-recover', leaseExpiresAt: new Date(now.getTime() - 1_000) },
  });
  await assert.rejects(
    inbox.recoverExpiredLeases(now),
    /Expected exactly one started attempt audit record/,
  );
  const recoveryUnchanged = await db.intelligenceEventInbox.findUniqueOrThrow({ where: { id: missingRecoveryAudit.id } });
  assert.equal(recoveryUnchanged.status, 'processing');
  console.log('PASS: missing recovery audit aborts and rolls back lease recovery');

  const stale = await enqueue('stale-worker-fencing');
  await db.intelligenceEventInbox.update({
    where: { id: stale.id },
    data: { status: 'processing', attempts: 2, leaseOwner: 'current-worker', leaseExpiresAt: new Date(now.getTime() + 60_000) },
  });
  await db.intelligenceEventAttempt.create({
    data: { eventInboxId: stale.id, attempt: 2, workerId: 'current-worker', status: 'started' },
  });
  await assert.rejects(
    inbox.acknowledge(stale.id, 'stale-worker', 1, now),
    /lease is missing, expired, or owned by another worker/,
  );
  const staleUnchanged = await db.intelligenceEventInbox.findUniqueOrThrow({ where: { id: stale.id } });
  assert.equal(staleUnchanged.leaseOwner, 'current-worker');
  assert.equal(staleUnchanged.status, 'processing');
  console.log('PASS: stale worker cannot acknowledge a newer attempt');

  const githubOwner = randomUUID();
  const githubId = randomUUID();
  const githubEvent = await inbox.enqueue({
    eventId: githubId,
    eventType: 'github.pull_request',
    schemaVersion: 1,
    occurredAt: now.toISOString(),
    source: { provider: 'github', service: 'event-streams' },
    idempotencyKey: 'github-owner:' + githubId,
    classification: 'internal',
    payload: { owner: { userId: githubOwner } },
  });
  ids.push(githubEvent.event.id);
  assert.equal(await inbox.claimNext('generic-worker', now, ['github.pull_request']), null,
    'generic workers must not claim GitHub Event Streams events');
  const ownerClaim = await inbox.claimNextForOwner('github-owner-worker', githubOwner, now, ['github.pull_request']);
  assert.equal(ownerClaim?.id, githubEvent.event.id,
    'the authenticated owner-scoped path must claim its own GitHub event');
  console.log('PASS: PostgreSQL GitHub event lane requires authenticated owner-scoped claim');

  const duplicate = await enqueue('duplicate-audit');
  await db.intelligenceEventAttempt.create({
    data: { eventInboxId: duplicate.id, attempt: 1, workerId: 'worker-a', status: 'started' },
  });
  await assert.rejects(
    db.intelligenceEventAttempt.create({
      data: { eventInboxId: duplicate.id, attempt: 1, workerId: 'worker-b', status: 'started' },
    }),
    (error) => error && typeof error === 'object' && 'code' in error && error.code === 'P2002',
  );
  console.log('PASS: PostgreSQL unique key rejects duplicate event/attempt audit rows');
} finally {
  if (ids.length) await db.intelligenceEventInbox.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
}
