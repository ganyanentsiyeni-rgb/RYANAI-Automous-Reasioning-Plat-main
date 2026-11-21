export type ReadinessProbe = () => Promise<unknown>;

export interface AgentWorkerReadinessSnapshot {
  state?: string;
  queueClaimState?: string;
  lastSuccessfulClaimAt?: string | null;
  listener?: {
    state?: string;
    connected?: boolean;
    subscribed?: boolean;
  } | null;
}

/** A live worker process is not ready until its durable queue claim has succeeded. */
export function isAgentWorkerReady(worker: AgentWorkerReadinessSnapshot): boolean {
  return worker.state === 'running'
    && worker.queueClaimState === 'ready'
    && Boolean(worker.lastSuccessfulClaimAt)
    && worker.listener?.state === 'listening'
    && worker.listener.connected === true
    && worker.listener.subscribed === true;
}

export interface ReadinessProbeSet {
  database: ReadinessProbe;
  redis: ReadinessProbe;
  agentCheckpointerInitialized: boolean;
  apiListening: boolean;
  agentQueueListenerReady: boolean;
}

export interface ReadinessResult {
  ready: boolean;
  services: {
    database: boolean;
    redis: boolean;
    agentCheckpointer: boolean;
    agentQueueListener: boolean;
    api: boolean;
  };
}

async function probe(
  probeService: ReadinessProbe,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve()
        .then(probeService)
        .then(
          () => true,
          () => false,
        ),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    return result;
  } catch {
    // Never expose connection strings or raw provider/client errors in health output.
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Evaluate dependency readiness using live PostgreSQL and Redis probes.
 * Checkpointer readiness requires successful startup initialization and a live
 * PostgreSQL connection because the saver shares the configured database.
 */
export async function inspectReadiness(
  probes: ReadinessProbeSet,
  timeoutMs = 1500,
): Promise<ReadinessResult> {
  const boundedTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(timeoutMs, 10_000))
    : 1500;
  const [database, redis] = await Promise.all([
    probe(probes.database, boundedTimeoutMs),
    probe(probes.redis, boundedTimeoutMs),
  ]);
  const services = {
    database,
    redis,
    agentCheckpointer: probes.agentCheckpointerInitialized && database,
    agentQueueListener: probes.agentQueueListenerReady,
    api: probes.apiListening,
  };

  return {
    ready: Object.values(services).every(Boolean),
    services,
  };
}


export interface StudioWorkerHeartbeatSnapshot {
  workerId: string;
  status: string;
  lastSeenAt: Date | string;
}

export interface StudioWorkerReadinessResult {
  ready: boolean;
  state: 'healthy' | 'missing' | 'stale' | 'stopped' | 'starting' | 'unhealthy';
  workerId: string | null;
  lastSeenAt: string | null;
  ageMs: number | null;
}

/** A separate process is ready only while at least one worker has a fresh heartbeat. */
export function evaluateStudioWorkerHeartbeats(
  heartbeats: readonly StudioWorkerHeartbeatSnapshot[],
  nowMs = Date.now(),
  staleAfterMs = 30_000,
): StudioWorkerReadinessResult {
  const ordered = [...heartbeats].sort(
    (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
  );
  const fresh = ordered.find((heartbeat) => {
    const seenAt = new Date(heartbeat.lastSeenAt).getTime();
    return heartbeat.status === 'healthy'
      && Number.isFinite(seenAt)
      && nowMs - seenAt <= staleAfterMs;
  });
  const selected = fresh ?? ordered[0];

  if (!selected) {
    return { ready: false, state: 'missing', workerId: null, lastSeenAt: null, ageMs: null };
  }

  const seenAt = new Date(selected.lastSeenAt).getTime();
  const ageMs = Number.isFinite(seenAt) ? Math.max(0, nowMs - seenAt) : null;
  let state: StudioWorkerReadinessResult['state'];
  if (fresh) state = 'healthy';
  else if (selected.status === 'stopped') state = 'stopped';
  else if (selected.status === 'starting') state = 'starting';
  else if (ageMs === null || ageMs > staleAfterMs) state = 'stale';
  else state = 'unhealthy';

  return {
    ready: state === 'healthy',
    state,
    workerId: selected.workerId,
    lastSeenAt: Number.isFinite(seenAt) ? new Date(seenAt).toISOString() : null,
    ageMs,
  };
}
