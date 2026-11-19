import type {
  RyanAiWorkerWakeHandler,
  RyanAiWorkerWakeHandlers,
  RyanAiWorkerWakeSignal,
  RyanAiWorkerWakeTarget,
} from "./githubEventRouter";

export interface RyanAiGitHubWorkerAdapters {
  /** Reconcile check_suite/check_run events against the provider's current check state. */
  ci: RyanAiWorkerWakeHandler;
  /** Capture review lifecycle and exact-head provenance; never infer approval from Copilot. */
  review: RyanAiWorkerWakeHandler;
  /** Reconcile pull-request lifecycle and current head/base metadata. */
  pullRequest: RyanAiWorkerWakeHandler;
  /** Reconcile repository pushes/refs without executing untrusted code in the worker. */
  repository: RyanAiWorkerWakeHandler;
}

const EVENT_TYPES_BY_TARGET: Readonly<Record<RyanAiWorkerWakeTarget, readonly string[]>> = {
  ci: ["check_suite", "check_run"],
  review: ["pull_request_review", "pull_request_review_thread"],
  "pull-request": ["pull_request"],
  repository: ["push"],
};

function validateSignalForTarget(
  target: RyanAiWorkerWakeTarget,
  signal: RyanAiWorkerWakeSignal,
): void {
  if (signal.target !== target) {
    throw new Error(`GitHub worker target mismatch: expected ${target}.`);
  }
  if (!EVENT_TYPES_BY_TARGET[target].includes(signal.eventType)) {
    throw new Error(`Unsupported ${target} event type: ${signal.eventType}`);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(signal.repository)) {
    throw new Error("GitHub worker event repository must use owner/repository format.");
  }
  if (!signal.eventId.trim() || !Number.isFinite(Date.parse(signal.occurredAt))) {
    throw new Error("GitHub worker event identity or timestamp is invalid.");
  }
}

function guarded(
  target: RyanAiWorkerWakeTarget,
  adapter: RyanAiWorkerWakeHandler,
): RyanAiWorkerWakeHandler {
  return async (signal) => {
    validateSignalForTarget(target, signal);
    await adapter(signal);
  };
}

/**
 * Builds a complete, fail-closed worker registry. Each adapter represents the
 * domain-specific reconciliation implementation; no target silently succeeds
 * when its adapter is absent.
 */
export function createRyanAiGitHubWorkerHandlers(
  adapters: RyanAiGitHubWorkerAdapters,
): RyanAiWorkerWakeHandlers {
  if (
    typeof adapters?.ci !== "function" ||
    typeof adapters?.review !== "function" ||
    typeof adapters?.pullRequest !== "function" ||
    typeof adapters?.repository !== "function"
  ) {
    throw new Error("All four GitHub worker adapters must be registered.");
  }
  return {
    ci: guarded("ci", adapters.ci),
    review: guarded("review", adapters.review),
    "pull-request": guarded("pull-request", adapters.pullRequest),
    repository: guarded("repository", adapters.repository),
  };
}
