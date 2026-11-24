import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { getWorkerProfile } from '../../agent/workerRegistry.js';
import { recoverExpiredStudioLeases, runStudioWorkerOnce } from './studioNativeCore.js';
import { prisma } from '../../lib/prisma.js';

export type RyanAIStudioWorkerStatus = 'starting' | 'healthy' | 'degraded' | 'stopped';

export interface RyanAIStudioWorkerSnapshot {
  workerId: string;
  workerProfileId: string;
  status: RyanAIStudioWorkerStatus;
  startedAt: string;
  lastHeartbeatAt: string | null;
  lastExecutionAt: string | null;
  lastExecutionState: string | null;
  lastError: string | null;
}

export interface RyanAIStudioWorkerRuntimeOptions {
  workerProfileId: string;
  workerInstanceId?: string;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  recoveryIntervalMs?: number;
  leaseSeconds?: number;
  executeOnce?: (workerInstanceId: string, workerProfileId: string, leaseSeconds: number) => Promise<{ state: string; taskId?: string; error?: string }>;
  heartbeat?: (workerInstanceId: string, status: RyanAIStudioWorkerStatus, metadata: Prisma.InputJsonObject) => Promise<void>;
  recoverExpiredLeases?: () => Promise<{ inspected: number; recovered: number; failed: number }>;
}

export interface RyanAIStudioWorkerRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  snapshot(): RyanAIStudioWorkerSnapshot;
}

function boundedInterval(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value!)));
}

export function createRyanAIStudioWorkerRuntime(
  options: RyanAIStudioWorkerRuntimeOptions,
): RyanAIStudioWorkerRuntime {
  const profile = getWorkerProfile(options.workerProfileId);
  if (!profile) throw new Error('Unknown RyanAI Studio worker profile: ' + options.workerProfileId);

  const workerId = options.workerInstanceId?.trim() || `studio-worker-${profile.id}-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const pollIntervalMs = boundedInterval(options.pollIntervalMs, 100, 30_000, 1_000);
  const heartbeatIntervalMs = boundedInterval(options.heartbeatIntervalMs, 1_000, 30_000, 5_000);
  const recoveryIntervalMs = boundedInterval(options.recoveryIntervalMs, 5_000, 120_000, 15_000);
  const leaseSeconds = boundedInterval(options.leaseSeconds, 15, 600, 90);

  let status: RyanAIStudioWorkerStatus = 'starting';
  let lastHeartbeatAt: string | null = null;
  let lastExecutionAt: string | null = null;
  let lastExecutionState: string | null = null;
  let lastError: string | null = null;
  let started = false;
  let stopping = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  const inFlight = new Set<Promise<void>>();
  let startupPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let heartbeatWrite: Promise<void> = Promise.resolve();

  const track = (operation: Promise<void>) => {
    inFlight.add(operation);
    void operation.then(
      () => inFlight.delete(operation),
      () => inFlight.delete(operation),
    );
  };

  const heartbeat = options.heartbeat ?? (async (id, nextStatus, metadata) => {
    const now = new Date();
    await prisma.studioWorkerHeartbeat.upsert({
      where: { workerId: id },
      create: {
        workerId: id,
        status: nextStatus,
        startedAt: new Date(startedAt),
        lastSeenAt: now,
        metadata,
      },
      update: {
        status: nextStatus,
        lastSeenAt: now,
        stoppedAt: nextStatus === 'stopped' ? now : null,
        metadata,
      },
    });
  });

  const executeOnce = options.executeOnce ?? (async (id, profileId, seconds) => {
    return runStudioWorkerOnce(id, profileId, seconds);
  });

  const recover = options.recoverExpiredLeases ?? recoverExpiredStudioLeases;

  const metadata = (): Prisma.InputJsonObject => ({
    workerProfileId: profile.id,
    workerProfileName: profile.name,
    taskTypes: profile.taskTypes,
    allowedActions: profile.allowedActions,
    runtime: 'ryanai-native-studio-worker',
  });

  const persistHeartbeat = async (nextStatus: RyanAIStudioWorkerStatus) => {
    // Serialize status writes so a slower healthy heartbeat cannot overwrite
    // a newer degraded/stopped transition in the shared durable record.
    const write = heartbeatWrite.then(async () => {
      await heartbeat(workerId, nextStatus, metadata());
      lastHeartbeatAt = new Date().toISOString();
      status = nextStatus;
    });
    heartbeatWrite = write.catch(() => undefined);
    await write;
  };

  const poll = async () => {
    if (stopping) return;
    try {
      const result = await executeOnce(workerId, profile.id, leaseSeconds);
      lastExecutionAt = new Date().toISOString();
      lastExecutionState = result.state;
      lastError = null;
      if (status !== 'healthy') await persistHeartbeat('healthy');
    } catch (error) {
      lastExecutionAt = new Date().toISOString();
      lastExecutionState = 'runtime_error';
      lastError = error instanceof Error ? error.message : 'Studio worker runtime error.';
      await persistHeartbeat('degraded');
    } finally {
      if (!stopping) pollTimer = setTimeout(() => { track(poll()); }, pollIntervalMs);
    }
  };

  const heartbeatLoop = async () => {
    if (stopping) return;
    try {
      await persistHeartbeat(status === 'degraded' ? 'degraded' : 'healthy');
    } catch (error) {
      status = 'degraded';
      lastError = error instanceof Error ? error.message : 'Studio worker heartbeat failed.';
    } finally {
      if (!stopping) heartbeatTimer = setTimeout(() => { track(heartbeatLoop()); }, heartbeatIntervalMs);
    }
  };

  const recoveryLoop = async () => {
    if (stopping) return;
    try {
      await recover();
    } catch (error) {
      status = 'degraded';
      lastError = error instanceof Error ? error.message : 'Studio lease recovery failed.';
      // Recovery failures must be visible in the durable worker heartbeat
      // immediately, not only after the next periodic heartbeat interval.
      // Preserve the original recovery error if the heartbeat store is also
      // unavailable; the next scheduled heartbeat will retry persistence.
      await persistHeartbeat('degraded').catch(() => undefined);
    } finally {
      if (!stopping) recoveryTimer = setTimeout(() => { track(recoveryLoop()); }, recoveryIntervalMs);
    }
  };

  return {
    async start() {
      if (started) return;
      started = true;
      stopping = false;
      startupPromise = (async () => {
        try {
          await persistHeartbeat('starting');
          await persistHeartbeat('healthy');
          // A shutdown signal may arrive while the durable startup heartbeat
          // is pending. Do not launch loops after shutdown has begun.
          if (stopping) return;
          track(poll());
          track(heartbeatLoop());
          track(recoveryLoop());
        } catch (error) {
          started = false;
          status = 'degraded';
          lastError = error instanceof Error ? error.message : 'Studio worker startup heartbeat failed.';
          throw error;
        }
      })();
      try {
        await startupPromise;
      } finally {
        startupPromise = null;
      }
    },

    async stop() {
      if (stopPromise) return stopPromise;
      if (!started) return;
      stopping = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      if (recoveryTimer) clearTimeout(recoveryTimer);
      stopPromise = (async () => {
        // Finish startup before draining loops so a late startup heartbeat
        // cannot overwrite the terminal stopped state.
        if (startupPromise) await startupPromise.catch(() => undefined);
        // Drain in-flight poll/heartbeat/recovery operations before publishing
        // the terminal stopped heartbeat. Loops cannot reschedule once stopping.
        await Promise.allSettled([...inFlight]);
        await persistHeartbeat('stopped');
        started = false;
      })();
      try {
        await stopPromise;
      } catch (error) {
        // Keep the runtime in its stopping state, but permit a later stop()
        // call to retry the durable terminal heartbeat after a transient store
        // failure. Concurrent callers still share the same in-progress drain.
        stopPromise = null;
        throw error;
      }
    },

    snapshot() {
      return {
        workerId,
        workerProfileId: profile.id,
        status,
        startedAt,
        lastHeartbeatAt,
        lastExecutionAt,
        lastExecutionState,
        lastError,
      };
    },
  };
}
