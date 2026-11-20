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
let childExitObserved = false;
let output = '';
let errorOutput = '';

function diagnosticTail(value, limit = 8000) {
  return value.length > limit ? value.slice(-limit) : value || '<no output>';
}

function childDiagnostics(processHandle) {
  return [
    'child exitCode=' + processHandle.exitCode,
    'signalCode=' + processHandle.signalCode,
    'stdout tail:\\n' + diagnosticTail(output),
    'stderr tail:\\n' + diagnosticTail(errorOutput),
  ].join('\\n');
}

function waitForExit(processHandle, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    // Listen for the actual exit event. exitCode/signalCode may be updated
    // before this event is delivered, so they are not an exit-event substitute.
    const onExit = (code, signal) => {
      childExitObserved = true;
      clearTimeout(timer);
      resolve({ code, signal });
    };
    const timer = setTimeout(() => {
      processHandle.removeListener('exit', onExit);
      reject(new Error('Studio worker did not exit after SIGTERM.\\n' + childDiagnostics(processHandle)));
    }, timeoutMs);
    processHandle.once('exit', onExit);
  });
}

function waitForOutput(stream, getOutput, marker, processHandle, timeoutMs = 10000) {
  if (getOutput().includes(marker)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onData = () => {
      if (!getOutput().includes(marker)) return;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      resolve();
    };
    const timer = setTimeout(() => {
      stream.removeListener('data', onData);
      reject(new Error(
        'Studio worker did not emit expected log: ' + marker + '\\n' + childDiagnostics(processHandle),
      ));
    }, timeoutMs);
    stream.on('data', onData);
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
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Worker exited before reporting disabled state.\\n' + childDiagnostics(child));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(
    output.includes('"event":"disabled"'),
    'worker must explicitly report its disabled state.\\n' + (child ? childDiagnostics(child) : ''),
  );
  const workerIdMatch = output.match(/\\"workerId\\":\\"([^\\"]+)\\"/);
  assert.ok(workerIdMatch, 'disabled worker log must identify the process instance.\\n' + diagnosticTail(output));
  const workerId = workerIdMatch[1];
  assert.ok(output.includes('STUDIO_WORKER_ENABLED is not true'), 'disabled reason must be explicit');
  assert.equal(output.includes('"event":"started"'), false, 'disabled worker must not enter its execution loop');
  assert.equal(output.includes('"event":"task-cycle"'), false, 'disabled worker must not run task cycles');

  // Register both observers before SIGTERM so neither the log nor the exit
  // event can be missed during shutdown. Timeout errors include both streams.
  const stoppedLog = waitForOutput(child.stdout, () => output, '"event":"stopped"', child);
  const exitEvent = waitForExit(child);
  child.kill('SIGTERM');
  await stoppedLog;
  const exit = await exitEvent;
  assert.equal(exit.signal, null, `disabled worker should not be terminated by a signal (got ${exit.signal})`);
  assert.equal(exit.code, 0, `disabled worker should stop cleanly after SIGTERM (got ${exit.code})`);

  const task = await prisma.studioTask.findUnique({ where: { id: taskId } });
  assert.ok(task, 'fixture task must still exist');
  assert.equal(task.status, 'queued', 'disabled worker must leave queued work untouched');
  assert.equal(task.attempts, 0, 'disabled worker must not increment task attempts');
  assert.equal(task.leaseOwner, null, 'disabled worker must not acquire a lease');
  const heartbeat = await prisma.studioWorkerHeartbeat.findUnique({ where: { workerId } });
  assert.equal(heartbeat, null, 'disabled worker must not create or refresh a worker heartbeat');

  console.log('Studio worker disabled-gate integration passed: real entrypoint stayed idle, left PostgreSQL task queued, and shut down cleanly.');
} finally {
  if (child && !childExitObserved) {
    // The graceful-shutdown assertion window has ended. If no exit event was
    // observed (even when signalCode is already populated), force cleanup now.
    const exitPromise = waitForExit(child, 5000);
    child.kill('SIGKILL');
    await exitPromise.catch(() => undefined);
  }
  if (projectId) await prisma.studioProject.delete({ where: { id: projectId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => undefined);
  await prisma.$disconnect();
}
