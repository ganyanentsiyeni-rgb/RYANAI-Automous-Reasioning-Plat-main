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

/**
 * PostgreSQL NOTIFY publisher for independently deployed GitHub workers.
 * Notifications are wake hints, not durable storage: handlers must load
 * authoritative work by eventId from a durable inbox/queue and recover
 * pending work on startup. This module does not connect to a database.
 */
export function createPostgresRyanAiGitHubWorkerWakePublisher(
  notify: RyanAiPostgresNotify,
): RyanAiWorkerWakeHandler {
  return async (signal: RyanAiWorkerWakeSignal) => {
    const channel = RYANAI_GITHUB_WORKER_WAKE_CHANNELS[signal.target];
    if (!channel) throw new Error("Unsupported RyanAI GitHub worker wake target.");

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
