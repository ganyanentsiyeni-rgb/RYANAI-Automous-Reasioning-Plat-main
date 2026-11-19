import type { RyanAiGitHubEvent, RyanAiGitHubEventType } from "./githubEventStreams";

export type RyanAiWorkerWakeTarget =
  | "ci"
  | "review"
  | "pull-request"
  | "repository";

export interface RyanAiWorkerWakeSignal {
  eventId: string;
  target: RyanAiWorkerWakeTarget;
  eventType: RyanAiGitHubEventType;
  repository: string;
  occurredAt: string;
  payload: unknown;
}

export type RyanAiWorkerWakeHandler = (
  signal: RyanAiWorkerWakeSignal,
) => Promise<void> | void;

const targetByEventType: Partial<Record<RyanAiGitHubEventType, RyanAiWorkerWakeTarget>> = {
  check_suite: "ci",
  check_run: "ci",
  pull_request_review: "review",
  pull_request_review_thread: "review",
  pull_request: "pull-request",
  push: "repository",
};

export function createRyanAiGitHubEventRouter(
  handleWake: RyanAiWorkerWakeHandler,
): (event: RyanAiGitHubEvent) => Promise<void> {
  const handledEventIds = new Set<string>();
  const maxRememberedEventIds = 2048;

  return async (event) => {
    if (handledEventIds.has(event.id)) return;

    const target = targetByEventType[event.type];
    if (!target) return;

    handledEventIds.add(event.id);
    if (handledEventIds.size > maxRememberedEventIds) {
      const oldest = handledEventIds.values().next().value;
      if (oldest) handledEventIds.delete(oldest);
    }

    try {
      await handleWake({
        eventId: event.id,
        target,
        eventType: event.type,
        repository: event.repository,
        occurredAt: event.occurredAt,
        payload: event.payload,
      });
    } catch (error) {
      handledEventIds.delete(event.id);
      throw error;
    }
  };
}
