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
  const inFlight = new Map<string, Promise<void>>();

  const processEvent = async (event: RyanAiGitHubEvent): Promise<void> => {
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
      try {
        await idempotencyStore.forget(event.id);
      } catch (forgetError) {
        throw new AggregateError(
          [error, forgetError],
          "GitHub event handling failed and its idempotency record could not be cleared.",
        );
      }
      throw error;
    }
  };

  return (event) => {
    // Coalesce concurrent redeliveries before the durable idempotency check
    // completes; otherwise two deliveries can both observe an unseen ID.
    const existing = inFlight.get(event.id);
    if (existing) return existing;

    const processing = processEvent(event).finally(() => {
      if (inFlight.get(event.id) === processing) inFlight.delete(event.id);
    });
    inFlight.set(event.id, processing);
    return processing;
  };
}
