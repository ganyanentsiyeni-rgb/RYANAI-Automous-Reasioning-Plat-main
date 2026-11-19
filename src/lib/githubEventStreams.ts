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

const supportedEventTypes = new Set<RyanAiGitHubEventType>([
  "pull_request",
  "pull_request_review",
  "pull_request_review_thread",
  "check_suite",
  "check_run",
  "push",
]);

export function validateRyanAiGitHubEventSubscriptions(
  subscriptions: readonly RyanAiGitHubEventSubscription[],
): void {
  const subscriptionIds = new Set<string>();
  for (const subscription of subscriptions) {
    if (!subscription.subscriptionId.trim()) {
      throw new Error("GitHub event subscription ID is required.");
    }
    if (subscriptionIds.has(subscription.subscriptionId)) {
      throw new Error(`Duplicate GitHub event subscription ID: ${subscription.subscriptionId}`);
    }
    subscriptionIds.add(subscription.subscriptionId);

    const repository = subscription.repository.trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
      throw new Error("GitHub event subscription repository must use owner/repository format.");
    }
    if (subscription.eventTypes.length === 0) {
      throw new Error("GitHub event subscription must include at least one event type.");
    }
    const seenTypes = new Set<RyanAiGitHubEventType>();
    for (const eventType of subscription.eventTypes) {
      if (!supportedEventTypes.has(eventType)) {
        throw new Error(`Unsupported GitHub event type: ${String(eventType)}`);
      }
      if (seenTypes.has(eventType)) {
        throw new Error(`Duplicate GitHub event type: ${eventType}`);
      }
      seenTypes.add(eventType);
    }
  }
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
  validateRyanAiGitHubEventSubscriptions(subscriptions);
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
