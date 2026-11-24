import { createRyanAIStudioWorkerRuntime } from '../src/server/engineering/ryanaiStudioWorkerRuntime.js';
import {
  getStudioWorkerHandlerReadiness,
  registerStudioTaskHandler,
} from '../src/server/engineering/studioNativeCore.js';
import { registerRyanAICiDiagnosticsTaskHandlers } from '../src/server/engineering/ryanaiCiDiagnosticsTask.js';
import { prisma } from '../src/lib/prisma.js';
import { inspectConnectedGitHubWorkflowEvidence } from '../src/server/routes/githubIntegration.js';
import { registerRyanAISpecialistTaskHandlers } from '../src/server/engineering/ryanaiSpecialistTaskHandlers.js';

const profileId = process.env.RYANAI_STUDIO_WORKER_PROFILE_ID?.trim() || 'coordinator';
const workerId = process.env.RYANAI_STUDIO_WORKER_ID?.trim();

const unregisterSpecialistHandlers = registerRyanAISpecialistTaskHandlers(profileId);
const unregisterCiDiagnosticsHandlers = profileId === 'ci-diagnostics'
  ? registerRyanAICiDiagnosticsTaskHandlers((ownerUserId, headSha, options) => inspectConnectedGitHubWorkflowEvidence(
      { prisma },
      ownerUserId,
      headSha,
      options,
    ))
  : () => undefined;
const unregisterHandlers = profileId === 'coordinator'
  ? [
      registerStudioTaskHandler('coordination', async ({ task }) => ({
        schemaVersion: 1,
        kind: 'ryanai.coordination.plan',
        taskId: task.id,
        objective: task.objective.trim(),
        assignedWorkerId: task.assignedWorkerId ?? null,
        steps: [
          'Confirm objective and owner scope',
          'Identify a registered specialist and required evidence',
          'Collect exact task and test evidence',
          'Return findings and unresolved blockers to PA',
        ],
        status: 'plan_proposed',
        executionAuthority: 'none',
      })),
      unregisterSpecialistHandlers,
      unregisterCiDiagnosticsHandlers,
    ]
  : [unregisterSpecialistHandlers, unregisterCiDiagnosticsHandlers];

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
