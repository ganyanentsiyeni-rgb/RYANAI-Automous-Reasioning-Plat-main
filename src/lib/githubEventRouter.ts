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

export type RyanAiWorkerWakeHandlers = Partial<
  Record<RyanAiWorkerWakeTarget, RyanAiWorkerWakeHandler>
>;

export function createRyanAiWorkerWakeDispatcher(
  handlers: RyanAiWorkerWakeHandlers,
): RyanAiWorkerWakeHandler {
  return async (signal) => {
    const handler = handlers[signal.target];
    if (!handler) return;
    await handler(signal);
  };
}

export interface RyanAiEventIdempotencyStore {
  has(eventId: string): Promise<boolean> | boolean;
  remember(eventId: string): Promise<void> | void;
  forget(eventId: string): Promise<void> | void;
}

export function createInMemoryRyanAiEventIdempotencyStore(
  maxRememberedEventIds = 2048,
): RyanAiEventIdempotencyStore {
  const handledEventIds = new Set<string>();

  return {
    has: (eventId) => handledEventIds.has(eventId),
    remember: (eventId) => {
      handledEventIds.add(eventId);
      if (handledEventIds.size > maxRememberedEventIds) {
        const oldest = handledEventIds.values().next().value;
        if (oldest) handledEventIds.delete(oldest);
      }
    },
    forget: (eventId) => {
      handledEventIds.delete(eventId);
    },
  };
}

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
  idempotencyStore: RyanAiEventIdempotencyStore =
    createInMemoryRyanAiEventIdempotencyStore(),
): (event: RyanAiGitHubEvent) => Promise<void> {
  return async (event) => {
    if (await idempotencyStore.has(event.id)) return;

    const target = targetByEventType[event.type];
    if (!target) return;

    await idempotencyStore.remember(event.id);

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
      await idempotencyStore.forget(event.id);
      throw error;
    }
  };
}
