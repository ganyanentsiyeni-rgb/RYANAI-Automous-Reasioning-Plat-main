#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { EventLeaseLostError, IntelligenceEventInbox } from '../src/events/intelligenceEventInbox.ts';

if (!process.env.DATABASE_URL || process.env.RYANAI_DISPOSABLE_DB !== '1') {
  throw new Error('This integration test requires RYANAI_DISPOSABLE_DB=1 and a disposable PostgreSQL DATABASE_URL.');
}

const prisma = new PrismaClient();
const inbox = new IntelligenceEventInbox(prisma, { leaseMs: 1_000, baseRetryMs: 100, maxRetryMs: 1_000 });
const createdIds = [];
const now = new Date();
const expiredAt = new Date(now.getTime() - 10_000);

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
  createdIds.push(result.event.id);
  return result.event;
}

async function seedProcessing(label, { leaseOwner = 'worker-a', leaseExpiresAt = expiredAt, withAudit = true } = {}) {
  const event = await enqueue(label);
  await prisma.intelligenceEventInbox.update({
    where: { id: event.id },
    data: { status: 'processing', attempts: 1, leaseOwner, leaseExpiresAt },
  });
  if (withAudit) {
    await prisma.intelligenceEventAttempt.create({
      data: { eventInboxId: event.id, attempt: 1, workerId: leaseOwner, status: 'started' },
    });
  }
  return event;
}

try {
  // Same event, two independent transactions: at most one worker may acquire attempt 1.
  const claimable = await enqueue('competing-claims');
  const claimResults = await Promise.all([
    inbox.claimNext('concurrent-worker-a', now, ['integration.lifecycle.test']),
    inbox.claimNext('concurrent-worker-b', now, ['integration.lifecycle.test']),
  ]);
  const winners = claimResults.filter(Boolean);
  assert.equal(winners.length, 1, 'exactly one concurrent claimant may win a single event');
  assert.equal(winners[0].id, claimable.id);
  const claimAudits = await prisma.intelligenceEventAttempt.findMany({ where: { eventInboxId: claimable.id } });
  assert.equal(claimAudits.length, 1, 'claim and started audit must commit exactly once');
  assert.equal(claimAudits[0].attempt, 1);
  console.log('PASS PostgreSQL concurrent claims: one owner and one attempt audit');

  // Two recovery workers racing over the same expired lease must close it once.
  const recoverable = await seedProcessing('competing-recovery');
  const recoveredCounts = await Promise.all([
    inbox.recoverExpiredLeases(now),
    inbox.recoverExpiredLeases(now),
  ]);
  assert.equal(recoveredCounts.reduce((sum, count) => sum + count, 0), 1);
  const recoveredRow = await prisma.intelligenceEventInbox.findUniqueOrThrow({ where: { id: recoverable.id } });
  const recoveredAudit = await prisma.intelligenceEventAttempt.findMany({ where: { eventInboxId: recoverable.id } });
  assert.equal(recoveredRow.status, 'retry');
  assert.equal(recoveredAudit.length, 1);
  assert.equal(recoveredAudit[0].status, 'lease_expired');
  console.log('PASS PostgreSQL competing recovery: one compare-and-set winner');

  // Recovery racing a new claim may serialize as recovery-then-claim or claim-first,
  // but must never let attempt 1 overwrite attempt 2 or create duplicate audit rows.
  const raced = await seedProcessing('recovery-versus-reclaim');
  const race = await Promise.all([
    inbox.recoverExpiredLeases(now),
    inbox.claimNext('recovery-race-worker-b', now, ['integration.lifecycle.test']),
  ]);
  const racedRow = await prisma.intelligenceEventInbox.findUniqueOrThrow({ where: { id: raced.id } });
  const racedAudits = await prisma.intelligenceEventAttempt.findMany({
    where: { eventInboxId: raced.id }, orderBy: { attempt: 'asc' },
  });
  assert.ok(racedRow.attempts === 1 || racedRow.attempts === 2);
  assert.equal(new Set(racedAudits.map((entry) => entry.attempt)).size, racedAudits.length);
  if (racedRow.attempts === 2) {
    assert.equal(racedRow.status, 'processing');
    assert.equal(racedRow.leaseOwner, 'recovery-race-worker-b');
    assert.equal(racedAudits.length, 2);
    assert.equal(racedAudits[0].status, 'lease_expired');
    assert.equal(racedAudits[1].status, 'started');
  } else {
    assert.equal(racedRow.status, 'retry');
    assert.equal(racedAudits.length, 1);
    assert.equal(racedAudits[0].status, 'lease_expired');
  }
  console.log('PASS PostgreSQL recovery/reclaim race: attempt fencing and unique audit sequence');

  // An absent started-audit row must abort and roll back acknowledgement.
  const missingAckAudit = await seedProcessing('missing-ack-audit', { withAudit: false, leaseExpiresAt: new Date(now.getTime() + 60_000) });
  await assert.rejects(
    inbox.acknowledge(missingAckAudit.id, 'worker-a', 1, now),
    /Expected exactly one started attempt audit record/,
  );
  const afterAck = await prisma.intelligenceEventInbox.findUniqueOrThrow({ where: { id: missingAckAudit.id } });
  assert.equal(afterAck.status, 'processing', 'inbox transition must roll back when audit closure is missing');
  console.log('PASS PostgreSQL acknowledgement atomicity: missing audit rolls back inbox transition');

  // The same atomicity guarantee applies to failure and expiry recovery.
  const missingFailAudit = await seedProcessing('missing-fail-audit', { withAudit: false, leaseExpiresAt: new Date(now.getTime() + 60_000) });
  await assert.rejects(inbox.fail(missingFailAudit.id, 'worker-a', 1, new Error('synthetic failure'), now),
    /Expected exactly one started attempt audit record/);
  const afterFail = await prisma.intelligenceEventInbox.findUniqueOrThrow({ where: { id: missingFailAudit.id } });
  assert.equal(afterFail.status, 'processing');

  const missingRecoveryAudit = await seedProcessing('missing-recovery-audit', { withAudit: false });
  await assert.rejects(inbox.recoverExpiredLeases(now), /Expected exactly one started attempt audit record/);
  const afterRecovery = await prisma.intelligenceEventInbox.findUniqueOrThrow({ where: { id: missingRecoveryAudit.id } });
  assert.equal(afterRecovery.status, 'processing', 'recovery must roll back when its audit row is absent');
  console.log('PASS PostgreSQL fail/recovery atomicity: missing audit rolls back both transitions');

  // The database unique key is the final defence against duplicate attempt numbers.
  const duplicateAuditEvent = await enqueue('duplicate-audit-key');
  await prisma.intelligenceEventAttempt.create({
    data: { eventInboxId: duplicateAuditEvent.id, attempt: 1, workerId: 'worker-a', status: 'started' },
  });
  await assert.rejects(
    prisma.intelligenceEventAttempt.create({
      data: { eventInboxId: duplicateAuditEvent.id, attempt: 1, workerId: 'worker-b', status: 'started' },
    }),
    (error) => error && typeof error === 'object' && 'code' in error && error.code === 'P2002',
  );
  console.log('PASS PostgreSQL duplicate audit protection: unique (eventInboxId, attempt) constraint');

  // A late worker cannot acknowledge a newer attempt, even when it knows the event ID.
  const stale = await seedProcessing('stale-worker-fence', { leaseOwner: 'worker-b', leaseExpiresAt: new Date(now.getTime() + 60_000) });
  await prisma.intelligenceEventInbox.update({
    where: { id: stale.id },
    data: { attempts: 2, leaseOwner: 'worker-b', leaseExpiresAt: new Date(now.getTime() + 60_000) },
  });
  await prisma.intelligenceEventAttempt.create({
    data: { eventInboxId: stale.id, attempt: 2, workerId: 'worker-b', status: 'started' },
  });
  await assert.rejects(inbox.acknowledge(stale.id, 'worker-a', 1, now), EventLeaseLostError);
  const staleAfter = await prisma.intelligenceEventInbox.findUniqueOrThrow({ where: { id: stale.id } });
  assert.equal(staleAfter.status, 'processing');
  assert.equal(staleAfter.attempts, 2);
  assert.equal(staleAfter.leaseOwner, 'worker-b');
  console.log('PASS PostgreSQL stale-worker fencing: attempt 1 cannot overwrite attempt 2');
} finally {
  if (createdIds.length) {
    await prisma.intelligenceEventInbox.deleteMany({ where: { id: { in: createdIds } } });
  }
  await prisma.$disconnect();
}
