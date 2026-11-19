import { createRyanAiGitHubEventRouter } from "./githubEventRouter";

export type RyanAiGitHubEventType =
  | "pull_request"
  | "pull_request_review"
  | "pull_request_review_thread"
  | "check_suite"
  | "check_run"
  | "push";

export interface RyanAiGitHubEvent<TPayload = unknown> {
  id: string;
  type: RyanAiGitHubEventType;
  repository: string;
  occurredAt: string;
  payload: TPayload;
}

export function normalizeRyanAiGitHubEvent(
  event: RyanAiGitHubEvent,
): RyanAiGitHubEvent {
  if (!event.id.trim()) throw new Error("GitHub event ID is required.");
  if (!event.repository.trim()) throw new Error("GitHub event repository is required.");
  if (!event.occurredAt.trim() || Number.isNaN(Date.parse(event.occurredAt))) {
    throw new Error("GitHub event occurredAt must be a valid ISO timestamp.");
  }
  return {
    ...event,
    id: event.id.trim(),
    repository: event.repository.trim(),
    occurredAt: new Date(event.occurredAt).toISOString(),
  };
}

export interface RyanAiGitHubEventSubscription {
  subscriptionId: string;
  repository: string;
  eventTypes: readonly RyanAiGitHubEventType[];
}

export interface RyanAiGitHubEventStream {
  subscribe(
    subscription: RyanAiGitHubEventSubscription,
    onEvent: (event: RyanAiGitHubEvent) => Promise<void> | void,
  ): Promise<() => Promise<void>>;
}

/**
 * RyanAI's worker-facing contract for GitHub Event Streams.
 *
 * This intentionally contains no polling fallback. The provider adapter is
 * responsible for delivering events; workers react to delivered events.
 * Until GitHub Event Streams access is enabled for the installation, this
 * interface remains an integration boundary rather than a fake live stream.
 */
export interface RyanAiGitHubEventWorker {
  start(stream: RyanAiGitHubEventStream): Promise<() => Promise<void>>;
}

export function createRyanAiGitHubEventWorker(
  subscriptions: readonly RyanAiGitHubEventSubscription[],
  handleEvent: (event: RyanAiGitHubEvent) => Promise<void> | void,
): RyanAiGitHubEventWorker {
  return {
    async start(stream) {
      const stops: Array<() => Promise<void>> = [];
      try {
        for (const subscription of subscriptions) {
          stops.push(await stream.subscribe(subscription, async (event) => {
            await handleEvent(normalizeRyanAiGitHubEvent(event));
          }));
        }
      } catch (error) {
        const cleanup = await Promise.allSettled(
          stops.reverse().map((stop) => stop()),
        );
        const cleanupErrors = cleanup
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason);
        if (cleanupErrors.length > 0 && error instanceof Error) {
          throw new AggregateError([error, ...cleanupErrors], "GitHub event subscription startup failed and cleanup was incomplete.");
        }
        throw error;
      }

      let stopped = false;
      return async () => {
        if (stopped) return;
        stopped = true;
        const results = await Promise.allSettled(
          stops.splice(0).reverse().map((stop) => stop()),
        );
        const errors = results
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason);
        if (errors.length > 0) {
          throw new AggregateError(errors, "One or more GitHub event subscriptions failed to stop.");
        }
      };
    },
  };
}

export function createRyanAiGitHubEventWorkerWithRouter(
  subscriptions: readonly RyanAiGitHubEventSubscription[],
  handleWake: import("./githubEventRouter").RyanAiWorkerWakeHandler,
  idempotencyStore?: import("./githubEventRouter").RyanAiEventIdempotencyStore,
): RyanAiGitHubEventWorker {
  return createRyanAiGitHubEventWorker(
    subscriptions,
    createRyanAiGitHubEventRouter(handleWake, idempotencyStore),
  );
}
