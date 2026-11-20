import { prisma } from '../../lib/prisma.js';
import { createRyanAIStudioWorkerRuntime } from './ryanaiStudioWorkerRuntime.js';
import { createStudioArtifact, registerStudioTaskHandler } from './studioNativeCore.js';
import { removeStoredStudioArtifact, storeStudioArtifact } from './studioArtifactStorage.js';

const workerProfileId = 'coordinator';
const workerInstanceId = process.env.RYANAI_STUDIO_WORKER_ID?.trim() || undefined;

function log(event: string, detail: Record<string, unknown> = {}) {
  console.info('[studio-worker]', JSON.stringify({ event, ...detail }));
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
        error: cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error',
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
async function shutdown(signal: string) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    log('stopping', { signal, workerId: runtime.snapshot().workerId });
    try {
      await runtime.stop();
    } finally {
      unregister();
      await prisma.$disconnect();
      log('stopped', { signal, workerId: runtime.snapshot().workerId });
      disabledStopResolver?.();
      disabledStopResolver = null;
    }
  })();
  return shutdownPromise;
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

async function main() {
  try {
    if (process.env.STUDIO_WORKER_ENABLED !== 'true') {
      log('disabled', { workerId: runtime.snapshot().workerId, reason: 'STUDIO_WORKER_ENABLED is not true.' });
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
