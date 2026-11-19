import { createRyanAIStudioWorkerRuntime } from '../src/server/engineering/ryanaiStudioWorkerRuntime.js';
import { getStudioWorkerHandlerReadiness } from '../src/server/engineering/studioNativeCore.js';
import { getStudioWorkerHandlerReadiness, registerStudioTaskHandler } from '../src/server/engineering/studioNativeCore.js';

const profileId = process.env.RYANAI_STUDIO_WORKER_PROFILE_ID?.trim() || 'coordinator';
const workerId = process.env.RYANAI_STUDIO_WORKER_ID?.trim();

const handlerReadiness = getStudioWorkerHandlerReadiness(profileId);
if (!handlerReadiness.ready) {
  throw new Error(
    `RyanAI Studio worker ${profileId} cannot start: ${handlerReadiness.reason} Supported task types: ${handlerReadiness.supportedTaskTypes.join(', ')}.`,
  );
}

const handlerReadiness = getStudioWorkerHandlerReadiness(profileId);
if (!handlerReadiness.ready) {
  unregisterCoordination?.();
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

const shutdown = async () => {
  await runtime.stop();
  process.exit(0);
};

process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });

await runtime.start();
console.log(JSON.stringify({
  service: 'ryanai-native-studio-worker',
  workerId: runtime.snapshot().workerId,
  workerProfileId: profileId,
  status: runtime.snapshot().status,
}));
