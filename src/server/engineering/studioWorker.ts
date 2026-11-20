import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { runStudioWorkerOnce, registerStudioTaskHandler, recoverExpiredStudioLeases, createStudioArtifact } from './studioNativeCore.js';
import { removeStoredStudioArtifact, storeStudioArtifact } from './studioArtifactStorage.js';

const workerId = 'studio-worker-' + (process.env.HOSTNAME || 'host').slice(0, 80) + '-' + randomUUID();
const heartbeatIntervalMs = 10_000;
const pollMs = Math.max(500, Math.min(30000, Number(process.env.STUDIO_WORKER_POLL_MS || 2500)));
const maxTasksPerCycle = Math.max(1, Math.min(8, Number(process.env.STUDIO_WORKER_CONCURRENCY || 1)));
const enabled = process.env.STUDIO_WORKER_ENABLED === 'true';

function log(event: string, detail: Record<string, unknown> = {}) {
  console.info('[studio-worker]', JSON.stringify({ event, workerId, ...detail }));
}

let heartbeatTimer: NodeJS.Timeout | undefined;
let heartbeatWrite = Promise.resolve();

function writeHeartbeat(status: 'healthy' | 'stopped') {
  heartbeatWrite = heartbeatWrite.then(async () => {
    const now = new Date();
    await prisma.studioWorkerHeartbeat.upsert({
      where: { workerId },
      create: {
        workerId,
        status,
        startedAt: now,
        lastSeenAt: now,
        stoppedAt: status === 'stopped' ? now : null,
        metadata: { hostname: process.env.HOSTNAME || null },
      },
      update: {
        status,
        lastSeenAt: now,
        stoppedAt: status === 'stopped' ? now : null,
        metadata: { hostname: process.env.HOSTNAME || null },
      },
    });
  }).catch((error: unknown) => {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || 'HEARTBEAT_WRITE_FAILED')
      : 'HEARTBEAT_WRITE_FAILED';
    log('heartbeat-error', { state: status, errorCode });
  });
  return heartbeatWrite;
}

async function main() {
  if (!enabled) {
    log('disabled', { reason: 'STUDIO_WORKER_ENABLED is not true.' });
    let stoppingDisabled = false;
    const stopDisabled = () => { stoppingDisabled = true; };
    process.once('SIGTERM', stopDisabled);
    process.once('SIGINT', stopDisabled);
    while (!stoppingDisabled) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          process.off('SIGTERM', finish);
          process.off('SIGINT', finish);
          resolve();
        };
        const timer = setTimeout(finish, 15000);
        process.once('SIGTERM', finish);
        process.once('SIGINT', finish);
      });
    }
    await prisma.$disconnect();
    return;
  }

  const unregister = registerStudioTaskHandler('coordination', async ({ task, claimToken }) => {
    const plan = {
      schemaVersion: 1,
      projectId: task.projectId,
      taskId: task.id,
      title: task.title,
      objective: task.objective,
      generatedAt: new Date().toISOString(),
      executionMode: 'ryanai-native-deterministic-planning-worker',
      steps: [
        { order: 1, action: 'Clarify scope and constraints', detail: 'Extract required outcome, constraints and unresolved assumptions from the task objective.' },
        { order: 2, action: 'Identify dependencies', detail: 'Review prerequisite task completion and required capabilities.' },
        { order: 3, action: 'Prepare deliverable outline', detail: 'Define a reviewable output and acceptance checks before specialist implementation.' },
        { order: 4, action: 'Request verification', detail: 'Require independent checks and human review before delivery.' },
      ],
      limitations: ['This built-in handler creates a structured plan only; it does not modify repositories, call external providers, or deploy.'],
    };
    const bytes = Buffer.from(JSON.stringify(plan, null, 2), 'utf8');
    const stored = await storeStudioArtifact({
      ownerUserId: task.ownerUserId,
      projectId: task.projectId,
      taskId: task.id,
      filename: 'studio-plan.json',
      bytes,
      mimeType: 'application/json',
    });
    let artifact;
    try {
      artifact = await createStudioArtifact({
        projectId: task.projectId,
        taskId: task.id,
        ownerUserId: task.ownerUserId,
        title: task.title + ' — execution plan',
        kind: 'plan',
        storageProvider: 'supabase-storage',
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        byteSize: BigInt(stored.byteSize),
        sha256: stored.sha256,
        provenance: { workerId, handler: 'coordination', schemaVersion: 1 },
        leaseFence: { workerId, claimToken },
      });
    } catch (error) {
      await removeStoredStudioArtifact(stored.storageKey).catch((cleanupError) => {
        log('artifact-orphan-cleanup-failed', { taskId: task.id, error: cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error' });
      });
      throw error;
    }
    return { artifactId: artifact.id, sha256: stored.sha256, byteSize: stored.byteSize, state: 'plan_artifact_created' };
  });

  let stopping = false;
  let active = false;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  log('started', { pollMs, maxTasksPerCycle, heartbeatIntervalMs, registeredTaskTypes: ['coordination'] });
  await writeHeartbeat('healthy');
  heartbeatTimer = setInterval(() => { void writeHeartbeat('healthy'); }, heartbeatIntervalMs);
  heartbeatTimer.unref();
  try {
    while (!stopping) {
      if (!active) {
        active = true;
        try {
          await recoverExpiredStudioLeases();
          for (let index = 0; index < maxTasksPerCycle && !stopping; index += 1) {
            const result = await runStudioWorkerOnce(workerId, 'coordinator');
            log('task-cycle', { state: result.state, taskId: 'taskId' in result ? result.taskId : undefined });
            if (result.state === 'idle' || result.state === 'blocked' || result.state === 'unhandled') break;
          }
        } catch (error) {
          log('cycle-error', { message: error instanceof Error ? error.message : 'Unknown worker error' });
        } finally {
          active = false;
        }
      }
      if (!stopping) await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    unregister();
    await writeHeartbeat('stopped');
    await prisma.$disconnect();
    log('stopped');
  }
}

void main().catch(async (error) => {
  console.error('[studio-worker] fatal startup failure', error instanceof Error ? error.message : error);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
