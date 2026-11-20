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
    if (!handler) {
      throw new Error(`No RyanAI GitHub worker registered for target: ${signal.target}`);
    }
    await handler(signal);
  };
}

export interface RyanAiEventIdempotencyStore {
  /** Atomically reserves an unseen or expired event ID; false means active/completed. */
  claim(eventId: string): Promise<boolean> | boolean;
  has(eventId: string): Promise<boolean> | boolean;
  /** Marks a successfully handled event as completed. */
  remember(eventId: string): Promise<void> | void;
  /** Releases a failed processing reservation so delivery can retry. */
  forget(eventId: string): Promise<void> | void;
}

/**
 * Process-local deduplication only. This store is bounded and is not safe as
 * the sole production replay barrier across restarts or multiple instances.
 * Production adapters must provide an atomic, durable implementation.
 */
export function createInMemoryRyanAiEventIdempotencyStore(
  maxRememberedEventIds = 2048,
): RyanAiEventIdempotencyStore {
  if (
    !Number.isInteger(maxRememberedEventIds) ||
    maxRememberedEventIds < 1 ||
    maxRememberedEventIds > 1_000_000
  ) {
    throw new Error("maxRememberedEventIds must be an integer between 1 and 1000000.");
  }
  const handledEventIds = new Set<string>();

  return {
    claim: (eventId) => {
      if (handledEventIds.has(eventId)) return false;
      handledEventIds.add(eventId);
      if (handledEventIds.size > maxRememberedEventIds) {
        const oldest = handledEventIds.values().next().value;
        if (oldest) handledEventIds.delete(oldest);
      }
      return true;
    },
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
    const target = targetByEventType[event.type];
    if (!target) return;
    if (!(await idempotencyStore.claim(event.id))) return;

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
          { cause: forgetError },
        );
      }
      throw error;
    }

    // Completion is separate from handler execution. If this write fails, the
    // durable processing lease expires and delivery can retry (at-least-once).
    await idempotencyStore.remember(event.id);
  };

  return (event) => {
    const existing = inFlight.get(event.id);
    if (existing) return existing;
    const processing = processEvent(event).finally(() => {
      if (inFlight.get(event.id) === processing) inFlight.delete(event.id);
    });
    inFlight.set(event.id, processing);
    return processing;
  };
}
