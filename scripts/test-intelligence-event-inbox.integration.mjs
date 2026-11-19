#!/usr/bin/env node
/**
 * Real PostgreSQL lifecycle tests for the durable intelligence event inbox.
 * DATABASE_URL must point to the disposable CI database; no external providers
 * or production services are contacted.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../dist/server/lib/prisma.js';
import {
  EventAttemptAuditError,
  EventLeaseLostError,
  IntelligenceEventInbox,
} from '../dist/server/events/intelligenceEventInbox.js';

if (!process.env.DATABASE_URL || process.env.RYANAI_DISPOSABLE_DB !== '1' && process.env.CI !== 'true') {
  throw new Error('This integration test requires the disposable PostgreSQL CI guard.');
}

const inbox = new IntelligenceEventInbox(prisma, { leaseMs: 30_000, baseRetryMs: 50, maxRetryMs: 1_000 });
const fixtureIds = [];
const owner = randomUUID();
const worker = 'same-worker-' + randomUUID();
const now = new Date();

async function enqueue(label) {
  const eventId = randomUUID();
  const result = await inbox.enqueue({
    eventId,
    eventType: 'github.pull_request',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    source: { provider: 'github', service: 'event-streams' },
    idempotencyKey: 'ci:' + randomUUID(),
    classification: 'internal',
    payload: { owner: { userId: owner }, fixture: label },
  });
  fixtureIds.push(result.event.id);
  return result.event;
}

try {
  // Two independent transactions compete for one owner-scoped event.
  const concurrent = await enqueue('concurrent-claim');
  const claims = await Promise.all([
    inbox.claimNextForOwner('ci-concurrent-a-' + randomUUID(), owner, new Date()),
    inbox.claimNextForOwner('ci-concurrent-b-' + randomUUID(), owner, new Date()),
  ]);
  assert.equal(claims.filter(Boolean).length, 1, 'exactly one concurrent claimant must win');
  const concurrentAttempts = await prisma.intelligenceEventAttempt.count({ where: { eventInboxId: concurrent.id } });
  assert.equal(concurrentAttempts, 1, 'a competing claim must not create a duplicate attempt audit');

  // Expire, recover, then reclaim using the identical worker ID. Attempt number
  // (not worker ID) must fence the stale execution.
  const sameWorkerEvent = await enqueue('same-worker-reclaim');
  const first = await inbox.claimNextForOwner(worker, owner, new Date());
  assert.ok(first, 'first same-worker claim should succeed');
  assert.equal(first.id, sameWorkerEvent.id, 'isolated owner fixture should claim the expected event');
  await prisma.intelligenceEventInbox.update({
    where: { id: first.id },
    data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
  });
  const recoveredCount = await inbox.recoverExpiredLeases(new Date());
  assert.ok(recoveredCount >= 1, 'expired lease should be recovered');
  const recoveredAttempt = await prisma.intelligenceEventAttempt.findUnique({
    where: { eventInboxId_attempt: { eventInboxId: first.id, attempt: 1 } },
  });
  assert.equal(recoveredAttempt?.status, 'lease_expired');
  const second = await inbox.claimNextForOwner(worker, owner, new Date(Date.now() + 5));
  assert.ok(second, 'same worker should reclaim the recovered event');
  assert.equal(second.id, first.id);
  assert.equal(second.attempts, 2);
  await assert.rejects(
    inbox.acknowledge(first.id, worker, 1, new Date()),
    (error) => error instanceof EventLeaseLostError,
    'the stale attempt must not acknowledge the newer attempt even with the same worker ID',
  );
  await inbox.acknowledge(second.id, worker, 2, new Date());
  const finalAttempt = await prisma.intelligenceEventAttempt.findUnique({
    where: { eventInboxId_attempt: { eventInboxId: second.id, attempt: 2 } },
  });
  assert.equal(finalAttempt?.status, 'succeeded');

  // A missing audit row must abort the whole transaction, leaving the inbox
  // lease untouched. Exercise both acknowledgement and failure transitions.
  for (const action of ['acknowledge', 'fail']) {
    const event = await enqueue('rollback-' + action);
    const claimed = await inbox.claimNextForOwner('ci-rollback-' + action + '-' + randomUUID(), owner, new Date());
    assert.ok(claimed);
    assert.equal(claimed.id, event.id);
    await prisma.intelligenceEventAttempt.delete({
      where: { eventInboxId_attempt: { eventInboxId: event.id, attempt: claimed.attempts } },
    });
    if (action === 'acknowledge') {
      await assert.rejects(inbox.acknowledge(event.id, claimed.leaseOwner, claimed.attempts), EventAttemptAuditError);
    } else {
      await assert.rejects(inbox.fail(event.id, claimed.leaseOwner, claimed.attempts, new Error('audit rollback fixture')), EventAttemptAuditError);
    }
    const unchanged = await prisma.intelligenceEventInbox.findUnique({ where: { id: event.id } });
    assert.equal(unchanged?.status, 'processing', 'failed audit transition must roll back inbox state');
    assert.equal(unchanged?.attempts, claimed.attempts);
  }

  console.log('PASS PostgreSQL concurrent owner-scoped claims: one winner, one attempt audit');
  console.log('PASS expired lease recovery and same-worker reclaim: stale attempt fenced by attempt number');
  console.log('PASS exact-one attempt audit enforcement');
  console.log('PASS acknowledgement/failure transaction rollback when attempt audit is missing');
} finally {
  if (fixtureIds.length) {
    await prisma.intelligenceEventInbox.deleteMany({ where: { id: { in: fixtureIds } } });
  }
  await prisma.$disconnect();
}
