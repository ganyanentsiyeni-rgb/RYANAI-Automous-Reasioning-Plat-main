import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { IntelligenceEventInbox } from '../src/events/intelligenceEventInbox.ts';

if (process.env.RYANAI_DISPOSABLE_DB !== '1' || !process.env.DATABASE_URL) {
  throw new Error('Refusing to run unless RYANAI_DISPOSABLE_DB=1 and DATABASE_URL targets disposable PostgreSQL.');
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
