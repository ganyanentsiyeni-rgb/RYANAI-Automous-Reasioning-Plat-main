#!/usr/bin/env node
/**
 * Prove the dedicated Studio worker honours its disabled-by-default gate.
 * Uses a disposable PostgreSQL task and starts the real worker entrypoint.
 * No provider, storage, production service, or secret is required.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma.ts';
import { createStudioProject } from '../src/server/engineering/studioNativeCore.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must target a disposable PostgreSQL database.');

const suffix = randomUUID();
const ownerUserId = randomUUID();
let projectId;
let child;
let output = '';
let errorOutput = '';

function waitForExit(processHandle, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    // A child can exit between kill() and listener registration. Also, a
    // signal-terminated child has signalCode set while exitCode remains null.
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      resolve({ code: processHandle.exitCode, signal: processHandle.signalCode });
      return;
    }
    const timer = setTimeout(() => reject(new Error('Studio worker did not exit after SIGTERM.')), timeoutMs);
    processHandle.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

try {
  // Studio projects are owned by an application user, not a bare Supabase Auth UUID.
  // Seed that user in this disposable database so the ownership FK is valid.
  await prisma.user.create({
    data: { id: ownerUserId, email: `studio-worker-disabled-${suffix}@example.test` },
  });

  const created = await createStudioProject({
    ownerUserId,
    title: 'Disabled worker gate ' + suffix,
    objective: 'Verify disabled worker does not claim queued tasks.',
    projectType: 'engineering',
    initialTasks: [{
      title: 'Must remain queued',
      objective: 'The disabled worker must not execute or claim this task.',
      taskType: 'studio.plan',
      priority: 100,
    }],
  });
  projectId = created.project.id;
  const taskId = created.tasks[0].id;

  child = spawn(process.execPath, ['--import', 'tsx/esm', 'src/server/engineering/studioWorker.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      STUDIO_WORKER_ENABLED: 'false',
      STUDIO_WORKER_POLL_MS: '500',
      STUDIO_WORKER_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errorOutput += chunk; });

  const deadline = Date.now() + 10000;
  while (!output.includes('"event":"disabled"') && Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Worker exited before reporting disabled state: ' + errorOutput);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(output.includes('"event":"disabled"'), 'worker must explicitly report its disabled state');
  const workerIdMatch = output.match(/\"workerId\":\"([^\"]+)\"/);
  assert.ok(workerIdMatch, 'disabled worker log must identify the process instance');
  const workerId = workerIdMatch[1];
  assert.ok(output.includes('STUDIO_WORKER_ENABLED is not true'), 'disabled reason must be explicit');
  assert.equal(output.includes('"event":"started"'), false, 'disabled worker must not enter its execution loop');
  assert.equal(output.includes('"event":"task-cycle"'), false, 'disabled worker must not run task cycles');

  child.kill('SIGTERM');
  const exit = await waitForExit(child);
  assert.equal(exit.code, 0, 'disabled worker should stop cleanly after SIGTERM');

  const task = await prisma.studioTask.findUnique({ where: { id: taskId } });
  assert.ok(task, 'fixture task must still exist');
  assert.equal(task.status, 'queued', 'disabled worker must leave queued work untouched');
  assert.equal(task.attempts, 0, 'disabled worker must not increment task attempts');
  assert.equal(task.leaseOwner, null, 'disabled worker must not acquire a lease');
  const heartbeat = await prisma.studioWorkerHeartbeat.findUnique({ where: { workerId } });
  assert.equal(heartbeat, null, 'disabled worker must not create or refresh a worker heartbeat');

  console.log('Studio worker disabled-gate integration passed: real entrypoint stayed idle, left PostgreSQL task queued, and shut down cleanly.');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exitPromise = waitForExit(child);
    child.kill('SIGKILL');
    await exitPromise;
  }
  if (projectId) await prisma.studioProject.delete({ where: { id: projectId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => undefined);
  await prisma.$disconnect();
}
