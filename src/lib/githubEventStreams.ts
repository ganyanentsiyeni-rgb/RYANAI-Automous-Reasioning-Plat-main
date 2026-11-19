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

export function createRyanAiGitHubEventWorkerWithRouter(
  subscriptions: readonly RyanAiGitHubEventSubscription[],
  handleWake: import("./githubEventRouter").RyanAiWorkerWakeHandler,
): RyanAiGitHubEventWorker {
  return createRyanAiGitHubEventWorker(
    subscriptions,
    createRyanAiGitHubEventRouter(handleWake),
  );
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
import { createRyanAiGitHubEventRouter } from "./githubEventRouter";

export interface RyanAiGitHubEventWorker {
  start(stream: RyanAiGitHubEventStream): Promise<() => Promise<void>>;
}

export function createRyanAiGitHubEventWorker(
  subscriptions: readonly RyanAiGitHubEventSubscription[],
  handleEvent: (event: RyanAiGitHubEvent) => Promise<void> | void,
): RyanAiGitHubEventWorker {
  return {
    async start(stream) {
      const stops = await Promise.all(
        subscriptions.map((subscription) =>
          stream.subscribe(subscription, handleEvent),
        ),
      );

      return async () => {
        await Promise.all(stops.map((stop) => stop()));
      };
    },
  };
}
