import { createHash } from "node:crypto";
import type { RyanAiPostgresQuery } from "./postgresGitHubEventIdempotencyStore";
import type {
  RyanAiWorkerWakeHandler,
  RyanAiWorkerWakeSignal,
  RyanAiWorkerWakeTarget,
} from "./githubEventRouter";

export const RYANAI_GITHUB_WORKER_WAKE_CHANNELS: Readonly<
  Record<RyanAiWorkerWakeTarget, string>
> = Object.freeze({
  ci: "ryanai_github_ci_wake",
  review: "ryanai_github_review_wake",
  "pull-request": "ryanai_github_pr_wake",
  repository: "ryanai_github_repository_wake",
});

export interface RyanAiPostgresNotify {
  (channel: string, payload: string): Promise<void>;
}

export interface RyanAiGitHubWakePersistence {
  /** Persist the complete event in an idempotent durable inbox before notifying. */
  (signal: RyanAiWorkerWakeSignal): Promise<void>;
}

/**
 * Durable-inbox + PostgreSQL NOTIFY publisher for independently deployed
 * GitHub workers. The full event must be committed by persistWake before the
 * wake hint is sent. NOTIFY is not durable; consumers recover pending inbox
 * rows on startup. This module does not open database connections.
 */
export function createPostgresRyanAiGitHubWorkerWakePublisher(
  persistWake: RyanAiGitHubWakePersistence,
  notify: RyanAiPostgresNotify,
): RyanAiWorkerWakeHandler {
  return async (signal: RyanAiWorkerWakeSignal) => {
    const channel = RYANAI_GITHUB_WORKER_WAKE_CHANNELS[signal.target];
    if (!channel) throw new Error("Unsupported RyanAI GitHub worker wake target.");

    // Commit the full event to a durable inbox before sending the lossy wake hint.
    // persistWake must be idempotent by eventId and return only after commit.
    await persistWake(signal);

    // Keep NOTIFY payload comfortably below PostgreSQL's 8 KB limit.
    // The full provider payload belongs in durable storage, not NOTIFY.
    const payload = JSON.stringify({
      version: 1,
      eventId: signal.eventId,
      target: signal.target,
      eventType: signal.eventType,
      repository: signal.repository,
      occurredAt: signal.occurredAt,
    });
    if (new TextEncoder().encode(payload).length > 7_000) {
      throw new Error("GitHub worker wake envelope exceeds the 7000-byte safety limit.");
    }
    await notify(channel, payload);
  };
}

/**
 * Durable persistence adapter for the existing provider-neutral
 * intelligence_event_inbox table. The source/idempotency unique key makes
 * duplicate provider deliveries safe across processes.
 */
export function createPostgresRyanAiGitHubWakePersistence(
  query: RyanAiPostgresQuery,
): RyanAiGitHubWakePersistence {
  return async (signal) => {
    if (!signal.eventId.trim() || signal.eventId.length > 200) {
      throw new Error("GitHub event ID must contain 1 to 200 characters.");
    }
    const eventIdentity = createHash("sha256").update(signal.eventId).digest("hex");
    const uuidHex = `${eventIdentity.slice(0, 12)}5${eventIdentity.slice(13, 16)}${((parseInt(eventIdentity[16], 16) & 0x3) | 0x8).toString(16)}${eventIdentity.slice(17, 20)}${eventIdentity.slice(20, 32)}`;
    const eventUuid = `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20, 32)}`;
    const payload = {
      id: signal.eventId,
      type: signal.eventType,
      target: signal.target,
      repository: signal.repository,
      occurredAt: signal.occurredAt,
      payload: signal.payload,
    };
    const serializedPayload = JSON.stringify(payload);
    const payloadHash = createHash("sha256").update(serializedPayload).digest("hex");
    await query(
      `INSERT INTO public.intelligence_event_inbox
         (event_id, event_type, schema_version, occurred_at, source_provider,
          source_service, correlation_id, idempotency_key, classification,
          payload, payload_hash, status)
       VALUES ($1::uuid, $2, 1, $3::timestamptz, 'github', 'event-streams',
               $4, $5, 'internal', $6::jsonb, $7, 'pending')
       ON CONFLICT (source_provider, idempotency_key) DO NOTHING`,
      [
        eventUuid,
        signal.eventType,
        signal.occurredAt,
        signal.eventId,
        signal.eventId,
        serializedPayload,
        payloadHash,
      ],
    );
  };
}

/** Narrow worker-side listener contract; implementations must use a dedicated connection for LISTEN. */
export interface RyanAiPostgresWakeListener {
  listen(
    channel: string,
    onNotification: (payload: string) => Promise<void> | void,
  ): Promise<() => Promise<void>>;
}

export function subscribeRyanAiGitHubWorkerWake(
  listener: RyanAiPostgresWakeListener,
  target: RyanAiWorkerWakeTarget,
  onWake: (wake: {
    version: 1;
    eventId: string;
    target: RyanAiWorkerWakeTarget;
    eventType: string;
    repository: string;
    occurredAt: string;
  }) => Promise<void> | void,
): Promise<() => Promise<void>> {
  const channel = RYANAI_GITHUB_WORKER_WAKE_CHANNELS[target];
  return listener.listen(channel, async (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Invalid JSON in RyanAI GitHub worker wake notification.");
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as Record<string, unknown>).version !== 1 ||
      (parsed as Record<string, unknown>).target !== target ||
      typeof (parsed as Record<string, unknown>).eventId !== "string" ||
      typeof (parsed as Record<string, unknown>).eventType !== "string" ||
      typeof (parsed as Record<string, unknown>).repository !== "string" ||
      typeof (parsed as Record<string, unknown>).occurredAt !== "string"
    ) {
      throw new Error("Invalid RyanAI GitHub worker wake envelope.");
    }
    await onWake(parsed as {
      version: 1;
      eventId: string;
      target: RyanAiWorkerWakeTarget;
      eventType: string;
      repository: string;
      occurredAt: string;
    });
  });
}

/** Shared channel identifier; safe to import from browser-side wake-listener contracts. */
export const RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL = "ryanai_github_owner_events";
