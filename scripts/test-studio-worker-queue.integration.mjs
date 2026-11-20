#!/usr/bin/env node
/**
 * Exercise the Studio task queue against disposable PostgreSQL.
 * This test creates isolated fixtures and removes them in a finally block.
 * It never calls external model providers or production infrastructure.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma.ts';
import {
  claimStudioTask,
  createStudioProject,
  heartbeatStudioTask,
  recoverExpiredStudioLeases,
  registerStudioTaskHandler,
  runStudioWorkerOnce,
} from '../src/server/engineering/studioNativeCore.ts';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must target a disposable PostgreSQL database.');
}

const suffix = randomUUID();
const ownerUserId = randomUUID();
const taskType = {
  claimA: 'database-audit',
  claimB: 'queue-audit',
  success: 'ci-failure',
  denied: 'security-audit',
  retry: 'worker-recovery',
  exhausted: 'infrastructure-audit',
  handlerFailure: 'build-failure',
  leaseLost: 'test-failure',
};
let projectId;

async function taskById(id) {
  const row = await prisma.studioTask.findUnique({ where: { id } });
  assert.ok(row, 'expected Studio task to exist: ' + id);
  return row;
}

async function withHandler(type, handler, run) {
  const unregister = registerStudioTaskHandler(type, handler);
  try {
    return await run();
  } finally {
    unregister();
  }
}

async function runWorker(workerId, authorize) {
  return runStudioWorkerOnce(workerId, null, 60, authorize);
}

try {
  const created = await createStudioProject({
    ownerUserId,
    title: 'Studio worker integration ' + suffix,
    objective: 'Disposable PostgreSQL queue lifecycle verification.',
    projectType: 'engineering',
    initialTasks: [
      { title: 'Concurrent claim A', objective: 'Claim exactly once.', taskType: taskType.claimA, priority: 20 },
      { title: 'Concurrent claim B', objective: 'Claim exactly once.', taskType: taskType.claimB, priority: 19 },
      { title: 'Successful handler', objective: 'Persist output and completion evidence.', taskType: taskType.success, priority: 18 },
      { title: 'Policy denial', objective: 'Remain blocked without executing handler.', taskType: taskType.denied, priority: 17 },
      { title: 'Authorization retry', objective: 'Release lease for retry.', taskType: taskType.retry, priority: 16 },
      { title: 'Authorization exhaustion', objective: 'Fail at max attempts.', taskType: taskType.exhausted, priority: 15 },
      { title: 'Handler retry', objective: 'Release lease after handler error.', taskType: taskType.handlerFailure, priority: 14 },
      { title: 'Lost lease', objective: 'Never persist completion after lease expiry.', taskType: taskType.leaseLost, priority: 13 },
    ],
  });
  projectId = created.project.id;
  const [claimA, claimB] = await Promise.all([
    claimStudioTask('studio-ci-a-' + suffix, [taskType.claimA, taskType.claimB], 60),
    claimStudioTask('studio-ci-b-' + suffix, [taskType.claimA, taskType.claimB], 60),
  ]);
  assert.ok(claimA && claimB, 'two concurrent workers should each claim one task');
  assert.notEqual(claimA.id, claimB.id, 'concurrent workers must never claim the same task');
  assert.equal(claimA.status, 'running');
  assert.equal(claimB.status, 'running');

  assert.equal(await heartbeatStudioTask(claimA.id, claimA.leaseOwner), true, 'the current lease owner can renew its lease');
  const heartbeated = await taskById(claimA.id);
  assert.ok(heartbeated.heartbeatAt && heartbeated.leaseExpiresAt > new Date(), 'heartbeat and lease expiry must persist');

  await prisma.studioTask.update({
    where: { id: claimB.id },
    data: { leaseExpiresAt: new Date(Date.now() - 1000) },
  });
  const recovery = await recoverExpiredStudioLeases();
  assert.ok(recovery.recovered >= 1, 'an expired lease must be recovered');
  const recoveredTask = await taskById(claimB.id);
  assert.equal(recoveredTask.status, 'queued');
  assert.equal(recoveredTask.leaseOwner, null);
  assert.ok(await prisma.studioEvent.findFirst({ where: { taskId: claimB.id, eventType: 'task.lease_recovered' } }));

  const successTask = created.tasks.find((item) => item.taskType === taskType.success);
  assert.ok(successTask);
  const success = await withHandler(taskType.success, async ({ heartbeat }) => {
    assert.equal(await heartbeat(), true, 'handler heartbeat should renew its active lease');
    return { result: 'persisted', fixture: suffix };
  }, () => runWorker('studio-ci-success-' + suffix, async () => undefined));
  assert.equal(success.state, 'completed');
  const completed = await taskById(successTask.id);
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.output, { result: 'persisted', fixture: suffix });
  assert.ok(await prisma.studioEvent.findFirst({ where: { taskId: successTask.id, eventType: 'task.completed' } }));

  const deniedTask = created.tasks.find((item) => item.taskType === taskType.denied);
  assert.ok(deniedTask);
  let deniedHandlerCalled = false;
  const denied = await withHandler(taskType.denied, async () => { deniedHandlerCalled = true; return {}; },
    () => runWorker('studio-ci-denied-' + suffix));
  assert.equal(denied.state, 'blocked');
  assert.equal(deniedHandlerCalled, false);
  assert.equal((await taskById(deniedTask.id)).approvalStatus, 'blocked');
  assert.ok(await prisma.studioEvent.findFirst({ where: { taskId: deniedTask.id, eventType: 'task.policy_blocked' } }));

  const retryTask = created.tasks.find((item) => item.taskType === taskType.retry);
  assert.ok(retryTask);
  const retry = await withHandler(taskType.retry, async () => { throw new Error('must not execute after auth exception'); },
    () => runWorker('studio-ci-retry-' + suffix, async () => { throw new Error('temporary authorization timeout'); }));
  assert.equal(retry.state, 'failed');
  const retried = await taskById(retryTask.id);
  assert.equal(retried.status, 'queued');
  assert.equal(retried.attempts, 1);
  assert.ok(retried.availableAt > new Date());
  assert.ok(await prisma.studioEvent.findFirst({ where: { taskId: retryTask.id, eventType: 'task.authorization_failed' } }));

  const exhaustedTask = created.tasks.find((item) => item.taskType === taskType.exhausted);
  assert.ok(exhaustedTask);
  await prisma.studioTask.update({ where: { id: exhaustedTask.id }, data: { maxAttempts: 1 } });
  const exhausted = await withHandler(taskType.exhausted, async () => ({}),
    () => runWorker('studio-ci-exhausted-' + suffix, async () => { throw new Error('final authorization timeout'); }));
  assert.equal(exhausted.state, 'failed');
  assert.equal((await taskById(exhaustedTask.id)).status, 'failed');
  assert.ok(await prisma.studioEvent.findFirst({ where: { taskId: exhaustedTask.id, eventType: 'task.authorization_exhausted' } }));

  const handlerFailureTask = created.tasks.find((item) => item.taskType === taskType.handlerFailure);
  assert.ok(handlerFailureTask);
  const handlerFailure = await withHandler(taskType.handlerFailure, async () => { throw new Error('temporary handler failure'); },
    () => runWorker('studio-ci-handler-failure-' + suffix));
  assert.equal(handlerFailure.state, 'failed');
  assert.equal((await taskById(handlerFailureTask.id)).status, 'queued');
  assert.ok(await prisma.studioEvent.findFirst({ where: { taskId: handlerFailureTask.id, eventType: 'task.execution_failed' } }));

  const leaseLostTask = created.tasks.find((item) => item.taskType === taskType.leaseLost);
  assert.ok(leaseLostTask);
  const leaseLost = await withHandler(taskType.leaseLost, async ({ task }) => {
    await prisma.studioTask.update({ where: { id: task.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    return { result: 'must-not-complete' };
  }, () => runWorker('studio-ci-lease-lost-' + suffix));
  assert.equal(leaseLost.state, 'failed');
  const stale = await taskById(leaseLostTask.id);
  assert.equal(stale.status, 'running');
  assert.ok(stale.leaseExpiresAt <= new Date());
  assert.equal(await prisma.studioEvent.count({ where: { taskId: leaseLostTask.id, eventType: 'task.completed' } }), 0);

  console.log('Studio worker PostgreSQL integration passed: competing claims, heartbeat, recovery, completion persistence, policy denial, retry, exhaustion and lease-loss fencing.');
} finally {
  if (projectId) await prisma.studioProject.delete({ where: { id: projectId } }).catch(() => undefined);
  await prisma.$disconnect();
}
