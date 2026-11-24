import { createRyanAIStudioWorkerRuntime } from '../src/server/engineering/ryanaiStudioWorkerRuntime.js';
import {
  getStudioWorkerHandlerReadiness,
  registerStudioTaskHandler,
} from '../src/server/engineering/studioNativeCore.js';
import { createRyanAICiDiagnosticsTaskHandler } from '../src/server/engineering/ryanaiCiDiagnosticsTask.js';
import { generateRepositoryInventory } from './repository-inventory.mjs';
import { prisma } from '../src/lib/prisma.js';
import { inspectConnectedGitHubWorkflowEvidence } from '../src/server/routes/githubIntegration.js';

const profileId = process.env.RYANAI_STUDIO_WORKER_PROFILE_ID?.trim() || 'coordinator';
const workerId = process.env.RYANAI_STUDIO_WORKER_ID?.trim();

const runRepositoryInventoryTask = async ({ task }: {
  task: { id: string; objective: string; requiredCapabilities: string[] };
}) => {
  if (!task.requiredCapabilities.includes('read-repository')) {
    throw new Error('Repository inventory requires the explicit read-repository capability.');
  }
  return {
    kind: 'repository.inventory',
    schemaVersion: 1,
    taskId: task.id,
    objective: task.objective,
    inventory: await generateRepositoryInventory(),
  };
};

const runCiDiagnosticsTask = createRyanAICiDiagnosticsTaskHandler(
  (ownerUserId, headSha, options) => inspectConnectedGitHubWorkflowEvidence(
    { prisma },
    ownerUserId,
    headSha,
    options,
  ),
  (ownerUserId, headSha, options) =>
    inspectConnectedGitHubWorkflowEvidence({ prisma }, ownerUserId, headSha, options),
);

const unregisterHandlers = profileId === 'repository-auditor'
  ? [
      registerStudioTaskHandler('repository-audit', runRepositoryInventoryTask),
      registerStudioTaskHandler('inventory', runRepositoryInventoryTask),
  ]
  : profileId === 'ci-diagnostics'
    ? [
        registerStudioTaskHandler('ci-failure', runCiDiagnosticsTask),
        registerStudioTaskHandler('test-failure', runCiDiagnosticsTask),
        registerStudioTaskHandler('build-failure', runCiDiagnosticsTask),
      ]
    : [];

const handlerReadiness = getStudioWorkerHandlerReadiness(profileId);
if (!handlerReadiness.ready) {
  for (const unregister of unregisterHandlers) unregister();
  throw new Error(
    `RyanAI Studio worker ${profileId} cannot start: ${handlerReadiness.reason} Supported task types: ${handlerReadiness.supportedTaskTypes.join(', ')}.`,
  );
}

const runtime = createRyanAIStudioWorkerRuntime({
  workerProfileId: profileId,
  workerInstanceId: workerId,
  pollIntervalMs: Number(process.env.RYANAI_STUDIO_WORKER_POLL_MS ?? 1000),
  heartbeatIntervalMs: Number(process.env.RYANAI_STUDIO_WORKER_HEARTBEAT_MS ?? 5000),
  recoveryIntervalMs: Number(process.env.RYANAI_STUDIO_WORKER_RECOVERY_MS ?? 15000),
  leaseSeconds: Number(process.env.RYANAI_STUDIO_WORKER_LEASE_SECONDS ?? 90),
});

let shutdownPromise: Promise<void> | null = null;
const shutdown = () => {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    const errors: string[] = [];
    try {
      await runtime.stop();
    } catch (error) {
      errors.push('runtime.stop: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      for (const unregister of unregisterHandlers) unregister();
      try {
        await prisma.$disconnect();
      } catch (error) {
        errors.push('prisma.$disconnect: ' + (error instanceof Error ? error.message : String(error)));
      }
    }
    if (errors.length) {
      console.error('[studio-worker] shutdown failed', errors);
      process.exitCode = 1;
    }
  })();
  return shutdownPromise;
};

process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });

try {
  await runtime.start();
  console.log(JSON.stringify({
    service: 'ryanai-native-studio-worker',
    workerId: runtime.snapshot().workerId,
    workerProfileId: profileId,
    registeredTaskTypes: handlerReadiness.registeredTaskTypes,
    status: runtime.snapshot().status,
  }));
} catch (error) {
  await shutdown();
  throw error;
}
