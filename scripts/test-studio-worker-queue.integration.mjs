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
  cancelStudioTask,
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
  handlerExhausted: 'worker-timeout',
  leaseLost: 'test-failure',
  leaseExhausted: 'lease-timeout',
};
let projectId;

async function taskById(id) {
  const row = await prisma.studioTask.findUnique({ where: { id } });
  assert.ok(row, 'expected Studio task to exist: ' + id);
  return row;
}

async function approveTaskForIntegrationTest(taskId) {
  await prisma.studioTask.update({
    where: { id: taskId },
    data: { approvalRequired: true, approvalStatus: 'approved' },
  });
  await prisma.studioEvent.create({
    data: {
      projectId,
      taskId,
      ownerUserId,
      actorId: ownerUserId,
      eventType: 'task.human_approved',
      payload: { source: 'disposable-integration-fixture', approval: 'explicit-owner-test-approval' },
    },
  });
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
  // Studio projects are owned by an application user (FK to users.id), so seed the owner in this disposable database first.
  await prisma.user.create({
    data: { id: ownerUserId, email: `studio-worker-queue-${suffix}@example.test` },
  });

  const created = await createStudioProject({
    ownerUserId,
    title: 'Studio worker integration ' + suffix,
    objective: 'Disposable PostgreSQL queue lifecycle verification.',
    projectType: 'engineering',
    initialTasks: [
      { title: 'Concurrent claim A', objective: 'Claim exactly once.', taskType: taskType.claimA, priority: 20 },
      { title: 'Concurrent claim B', objective: 'Claim exactly once.', taskType: taskType.claimB, priority: 19 },
      { title: 'Successful handler', objective: 'Persist output and completion evidence.', taskType: taskType.success, priority: 18 },
      { title: 'Policy denial', objective: 'Remain blocked without executing handler.', taskType: taskType.denied, requiredCapabilities: ['production.deploy'], priority: 17 },
      { title: 'Authorization retry', objective: 'Release lease for retry.', taskType: taskType.retry, priority: 16 },
      { title: 'Authorization exhaustion', objective: 'Fail at max attempts.', taskType: taskType.exhausted, priority: 15 },
      { title: 'Dependent after exhausted prerequisite', objective: 'Fail rather than remain queued.', taskType: 'dependency-after-exhaustion', dependsOnIndexes: [5], priority: 12 },
      { title: 'Handler retry', objective: 'Release lease after handler error.', taskType: taskType.handlerFailure, priority: 14 },
      { title: 'Handler exhaustion', objective: 'Fail after the configured handler retry limit.', taskType: taskType.handlerExhausted, priority: 11 },
      { title: 'Lost lease', objective: 'Never persist completion after lease expiry.', taskType: taskType.leaseLost, priority: 13 },
      { title: 'Expired lease exhaustion', objective: 'Fail after the configured expired-lease retry limit.', taskType: taskType.leaseExhausted, priority: 10 },
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

  assert.ok(claimA.leaseToken, 'a successful claim must return its fencing token');
  assert.equal(
    await heartbeatStudioTask(claimA.id, claimA.leaseOwner, claimA.leaseToken),
    true,
    'the current lease owner and fencing token can renew its lease',
  );
  assert.equal(
    await heartbeatStudioTask(claimA.id, claimA.leaseOwner, randomUUID()),
    false,
    'a stale or unrelated fencing token must not renew the lease',
  );
  assert.equal(
    await heartbeatStudioTask(claimA.id, 'studio-ci-impostor-' + suffix, claimA.leaseToken),
    false,
    'a different worker cannot renew another worker lease, even with its token',
  );
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
  assert.equal(recoveredTask.leaseToken, null);
  assert.equal(
    await heartbeatStudioTask(claimB.id, claimB.leaseOwner, claimB.leaseToken),
    false,
    'the previous worker cannot renew a recovered lease',
  );
  await prisma.studioTask.update({
    where: { id: claimB.id },
    data: { availableAt: new Date() },
  });
  const replacementClaim = await claimStudioTask(
    'studio-ci-replacement-' + suffix,
    [taskType.claimA, taskType.claimB],
    60,
  );
  assert.ok(replacementClaim, 'a recovered task becomes claimable after its retry delay');
  assert.equal(replacementClaim.id, claimB.id, 'the recovered task is claimed again');
  assert.notEqual(replacementClaim.leaseToken, claimB.leaseToken, 'reclaim must issue a fresh fencing token');
  assert.equal(
    await heartbeatStudioTask(claimB.id, claimB.leaseOwner, claimB.leaseToken),
    false,
    'the old worker remains fenced out after a new worker reclaims the task',
  );
  assert.equal(
    await heartbeatStudioTask(replacementClaim.id, replacementClaim.leaseOwner, replacementClaim.leaseToken),
    true,
    'the replacement worker can renew its new lease',
  );
  assert.ok(await prisma.studioEvent.findFirst({ where: { taskId: claimB.id, eventType: 'task.lease_recovered' } }));

  const cancelled = await cancelStudioTask(claimA.id, ownerUserId, 'integration cancellation');
  assert.equal(cancelled.cancelled, true, 'the owner can cancel its running task');
  const cancelledTask = await taskById(claimA.id);
  assert.equal(cancelledTask.status, 'cancelled');
  assert.equal(cancelledTask.leaseOwner, null);
  assert.equal(cancelledTask.leaseToken, null, 'cancellation must clear the fencing token');
  assert.equal(cancelledTask.leaseExpiresAt, null);
  assert.equal(cancelledTask.heartbeatAt, null);
  assert.equal(
    await heartbeatStudioTask(claimA.id, claimA.leaseOwner, claimA.leaseToken),
    false,
    'a cancelled worker cannot renew its former lease',
  );
  assert.ok(await prisma.studioEvent.findFirst({ where: { taskId: claimA.id, eventType: 'task.cancelled' } }));


  const successTask = created.tasks.find((item) => item.taskType === taskType.success);
  assert.ok(successTask);
  await approveTaskForIntegrationTest(successTask.id);
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
  await approveTaskForIntegrationTest(retryTask.id);
  const retry = await withHandler(taskType.retry, async () => { throw new Error('must not execute after auth exception'); },
    () => runWorker('studio-ci-retry-' + suffix, async () => { throw new Error('temporary authorization timeout'); }));
  assert.equal(retry.state, 'retrying', 'a requeued authorization failure must be reported as retrying');
  const retried = await taskById(retryTask.id);
  assert.equal(retried.status, 'queued');
  assert.equal(retried.attempts, 1);
  assert.ok(retried.availableAt > new Date());
  const authorizationFailureEvent = await prisma.studioEvent.findFirst({ where: { taskId: retryTask.id, eventType: 'task.authorization_failed' } });
  assert.ok(authorizationFailureEvent);
  assert.equal(authorizationFailureEvent.payload.outcome, 'retrying');
  assert.equal(authorizationFailureEvent.payload.maxAttempts, retried.maxAttempts);

  const exhaustedTask = created.tasks.find((item) => item.taskType === taskType.exhausted);
  assert.ok(exhaustedTask);
  await approveTaskForIntegrationTest(exhaustedTask.id);
  await prisma.studioTask.update({ where: { id: exhaustedTask.id }, data: { maxAttempts: 1 } });
  const exhausted = await withHandler(taskType.exhausted, async () => ({}),
    () => runWorker('studio-ci-exhausted-' + suffix, async () => { throw new Error('final authorization timeout'); }));
  assert.equal(exhausted.state, 'failed');
  const exhaustedAuthorizationRow = await taskById(exhaustedTask.id);
  assert.equal(exhaustedAuthorizationRow.status, 'failed');
  assert.equal(exhaustedAuthorizationRow.attempts, 1);
  assert.equal(exhaustedAuthorizationRow.leaseOwner, null);
  assert.equal(exhaustedAuthorizationRow.leaseToken, null);
  assert.equal(exhaustedAuthorizationRow.leaseExpiresAt, null);
  assert.equal(exhaustedAuthorizationRow.heartbeatAt, null);
  assert.ok(exhaustedAuthorizationRow.completedAt instanceof Date);
  const authorizationExhaustionEvent = await prisma.studioEvent.findFirst({ where: { taskId: exhaustedTask.id, eventType: 'task.authorization_exhausted' } });
  assert.ok(authorizationExhaustionEvent);
  assert.equal(authorizationExhaustionEvent.payload.outcome, 'failed');
  assert.equal(authorizationExhaustionEvent.payload.maxAttempts, 1);

  const dependentTask = created.tasks.find((item) => item.taskType === 'dependency-after-exhaustion');
  assert.ok(dependentTask);
  assert.deepEqual((await taskById(dependentTask.id)).dependsOnIds, [exhaustedTask.id]);
  const blockedByTerminalDependency = await claimStudioTask(
    'studio-ci-dependency-' + suffix,
    ['dependency-after-exhaustion'],
    60,
  );
  assert.equal(blockedByTerminalDependency, null, 'a task with a failed prerequisite must never be claimed');
  const failedDependent = await taskById(dependentTask.id);
  assert.equal(failedDependent.status, 'failed', 'a dependent task must not remain queued forever');
  assert.equal(failedDependent.completedAt instanceof Date, true);
  const dependencyFailureEvent = await prisma.studioEvent.findFirst({
    where: { taskId: dependentTask.id, eventType: 'task.dependency_failed' },
  });
  assert.ok(dependencyFailureEvent, 'terminal dependency propagation must be auditable');
  assert.deepEqual(dependencyFailureEvent.payload.failedDependencyIds, [exhaustedTask.id]);

  const handlerFailureTask = created.tasks.find((item) => item.taskType === taskType.handlerFailure);
  assert.ok(handlerFailureTask);
  await approveTaskForIntegrationTest(handlerFailureTask.id);
  const handlerFailure = await withHandler(taskType.handlerFailure, async () => { throw new Error('temporary handler failure'); },
    () => runWorker('studio-ci-handler-failure-' + suffix));
  assert.equal(handlerFailure.state, 'retrying', 'a requeued handler failure must be reported as retrying');
  assert.equal((await taskById(handlerFailureTask.id)).status, 'queued');
  const handlerFailureEvent = await prisma.studioEvent.findFirst({ where: { taskId: handlerFailureTask.id, eventType: 'task.execution_failed' } });
  assert.ok(handlerFailureEvent);
  assert.equal(handlerFailureEvent.payload.outcome, 'retrying');
  assert.equal(handlerFailureEvent.payload.maxAttempts, (await taskById(handlerFailureTask.id)).maxAttempts);

  const handlerExhaustedTask = created.tasks.find((item) => item.taskType === taskType.handlerExhausted);
  assert.ok(handlerExhaustedTask);
  await approveTaskForIntegrationTest(handlerExhaustedTask.id);
  await prisma.studioTask.update({ where: { id: handlerExhaustedTask.id }, data: { maxAttempts: 1 } });
  const handlerExhausted = await withHandler(taskType.handlerExhausted, async () => { throw new Error('final handler failure'); },
    () => runWorker('studio-ci-handler-exhausted-' + suffix));
  assert.equal(handlerExhausted.state, 'failed');
  const handlerExhaustedRow = await taskById(handlerExhaustedTask.id);
  assert.equal(handlerExhaustedRow.status, 'failed');
  assert.equal(handlerExhaustedRow.leaseOwner, null);
  assert.equal(handlerExhaustedRow.leaseToken, null);
  assert.equal(handlerExhaustedRow.leaseExpiresAt, null);
  assert.equal(handlerExhaustedRow.heartbeatAt, null);
  assert.ok(handlerExhaustedRow.completedAt instanceof Date);
  const handlerExhaustedEvent = await prisma.studioEvent.findFirst({ where: { taskId: handlerExhaustedTask.id, eventType: 'task.execution_failed' } });
  assert.ok(handlerExhaustedEvent);
  assert.equal(handlerExhaustedEvent.payload.outcome, 'failed');
  assert.equal(handlerExhaustedEvent.payload.maxAttempts, 1);

  const leaseLostTask = created.tasks.find((item) => item.taskType === taskType.leaseLost);
  assert.ok(leaseLostTask);
  await approveTaskForIntegrationTest(leaseLostTask.id);
  const leaseLost = await withHandler(taskType.leaseLost, async ({ task }) => {
    await prisma.studioTask.update({ where: { id: task.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    return { result: 'must-not-complete' };
  }, () => runWorker('studio-ci-lease-lost-' + suffix));
  assert.equal(leaseLost.state, 'lease_lost');
  const stale = await taskById(leaseLostTask.id);
  assert.equal(stale.status, 'running');
  assert.ok(stale.leaseExpiresAt <= new Date());
  assert.equal(await prisma.studioEvent.count({ where: { taskId: leaseLostTask.id, eventType: 'task.completed' } }), 0);

  const leaseExhaustedTask = created.tasks.find((item) => item.taskType === taskType.leaseExhausted);
  assert.ok(leaseExhaustedTask);
  await prisma.studioTask.update({ where: { id: leaseExhaustedTask.id }, data: { maxAttempts: 1 } });
  const expiringClaim = await claimStudioTask('studio-ci-lease-exhausted-' + suffix, [taskType.leaseExhausted], 60);
  assert.ok(expiringClaim);
  assert.equal(expiringClaim.id, leaseExhaustedTask.id);
  await prisma.studioTask.update({ where: { id: leaseExhaustedTask.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
  const exhaustedLeaseRecovery = await recoverExpiredStudioLeases();
  assert.ok(exhaustedLeaseRecovery.failed >= 1);
  const exhaustedLeaseRow = await taskById(leaseExhaustedTask.id);
  assert.equal(exhaustedLeaseRow.status, 'failed');
  assert.equal(exhaustedLeaseRow.leaseOwner, null);
  assert.equal(exhaustedLeaseRow.leaseToken, null);
  assert.equal(exhaustedLeaseRow.leaseExpiresAt, null);
  assert.equal(exhaustedLeaseRow.heartbeatAt, null);
  assert.ok(exhaustedLeaseRow.completedAt instanceof Date);
  const exhaustedLeaseEvent = await prisma.studioEvent.findFirst({ where: { taskId: leaseExhaustedTask.id, eventType: 'task.lease_exhausted' } });
  assert.ok(exhaustedLeaseEvent);
  assert.equal(exhaustedLeaseEvent.payload.attempts, 1);
  assert.equal(exhaustedLeaseEvent.payload.maxAttempts, 1);

  console.log('Studio worker PostgreSQL integration passed: competing claims, heartbeat, recovery, completion persistence, policy denial, retry, exhaustion and lease-loss fencing.');
} finally {
  if (projectId) await prisma.studioProject.delete({ where: { id: projectId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => undefined);
  await prisma.$disconnect();
}
