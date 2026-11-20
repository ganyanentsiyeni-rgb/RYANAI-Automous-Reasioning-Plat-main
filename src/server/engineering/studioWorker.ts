import { prisma } from '../../lib/prisma.js';
import { createRyanAIStudioWorkerRuntime } from './ryanaiStudioWorkerRuntime.js';
import { createStudioArtifact, registerStudioTaskHandler } from './studioNativeCore.js';
import { removeStoredStudioArtifact, storeStudioArtifact } from './studioArtifactStorage.js';

const workerProfileId = 'coordinator';
const workerInstanceId = process.env.RYANAI_STUDIO_WORKER_ID?.trim() || undefined;

function log(event: string, detail: Record<string, unknown> = {}) {
  console.info('[studio-worker]', JSON.stringify({ event, ...detail }));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const unregister = registerStudioTaskHandler('coordination', async ({ task, workerId, claimToken }) => {
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

  try {
    const artifact = await createStudioArtifact({
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
    return { artifactId: artifact.id, sha256: stored.sha256, byteSize: stored.byteSize, state: 'plan_artifact_created' };
  } catch (error) {
    await removeStoredStudioArtifact(stored.storageKey).catch((cleanupError) => {
      log('artifact-orphan-cleanup-failed', {
        taskId: task.id,
        error: errorMessage(cleanupError),
      });
    });
    throw error;
  }
});

const runtime = createRyanAIStudioWorkerRuntime({
  workerProfileId,
  workerInstanceId,
  pollIntervalMs: Number(process.env.RYANAI_STUDIO_WORKER_POLL_MS ?? 2500),
  heartbeatIntervalMs: Number(process.env.RYANAI_STUDIO_WORKER_HEARTBEAT_MS ?? 10_000),
  recoveryIntervalMs: Number(process.env.RYANAI_STUDIO_WORKER_RECOVERY_MS ?? 15_000),
  leaseSeconds: Number(process.env.RYANAI_STUDIO_WORKER_LEASE_SECONDS ?? 90),
});

let shutdownPromise: Promise<void> | null = null;
let disabledStopResolver: (() => void) | null = null;
let disabledKeepAlive: NodeJS.Timeout | null = null;
async function shutdown(signal: string) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    const shutdownErrors: string[] = [];
    log('stopping', { signal, workerId: runtime.snapshot().workerId });
    try {
      await runtime.stop();
      log('runtime-stopped', { signal, workerId: runtime.snapshot().workerId });
    } catch (error) {
      shutdownErrors.push('runtime.stop: ' + errorMessage(error));
      log('runtime-stop-failed', { signal, error: errorMessage(error) });
    }

    try {
      unregister();
    } catch (error) {
      shutdownErrors.push('handler-unregister: ' + errorMessage(error));
      log('handler-unregister-failed', { signal, error: errorMessage(error) });
    }

    try {
      await prisma.$disconnect();
      log('database-disconnected', { signal, workerId: runtime.snapshot().workerId });
    } catch (error) {
      shutdownErrors.push('prisma.$disconnect: ' + errorMessage(error));
      log('database-disconnect-failed', { signal, error: errorMessage(error) });
    } finally {
      // The disabled entrypoint waits on this resolver. Always release it,
      // even when runtime shutdown or Prisma cleanup fails, so SIGTERM cannot
      // strand the process indefinitely without a terminal diagnostic.
      log('stopped', {
        signal,
        workerId: runtime.snapshot().workerId,
        shutdownErrors,
      });
      disabledKeepAlive && clearInterval(disabledKeepAlive);
      disabledKeepAlive = null;
      disabledStopResolver?.();
      disabledStopResolver = null;
    }

    if (shutdownErrors.length > 0) process.exitCode = 1;
  })();
  return shutdownPromise;
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

async function main() {
  try {
    if (process.env.STUDIO_WORKER_ENABLED !== 'true') {
      log('disabled', { workerId: runtime.snapshot().workerId, reason: 'STUDIO_WORKER_ENABLED is not true.' });
      // A pending Promise alone does not keep a Node.js process alive. Keep
      // the disabled worker resident so it can receive SIGTERM and emit the
      // same observable shutdown sequence as an enabled worker.
      disabledKeepAlive = setInterval(() => {}, 60_000);
      await new Promise<void>((resolve) => { disabledStopResolver = resolve; });
      return;
    }
    await runtime.start();
    log('started', {
      workerId: runtime.snapshot().workerId,
      workerProfileId,
      status: runtime.snapshot().status,
      registeredTaskTypes: ['coordination'],
    });
  } catch (error) {
    unregister();
    await prisma.$disconnect().catch(() => undefined);
    throw error;
  }
}

void main().catch((error) => {
  console.error('[studio-worker] fatal startup failure', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
