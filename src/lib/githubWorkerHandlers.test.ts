import { describe, expect, it, vi } from "vitest";
import {
  createRyanAiGitHubWorkerHandlers,
  type RyanAiGitHubWorkerAdapters,
} from "./githubWorkerHandlers";
import type { RyanAiWorkerWakeSignal } from "./githubEventRouter";

const signal: RyanAiWorkerWakeSignal = {
  eventId: "evt-1",
  target: "ci",
  eventType: "check_suite",
  repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
  occurredAt: "2026-11-19T12:00:00.000Z",
  payload: { action: "completed" },
};

function adapters(): RyanAiGitHubWorkerAdapters {
  return {
    ci: vi.fn(async () => undefined),
    review: vi.fn(async () => undefined),
    pullRequest: vi.fn(async () => undefined),
    repository: vi.fn(async () => undefined),
  };
}

describe("createRyanAiGitHubWorkerHandlers", () => {
  it("requires all four domain adapters before starting workers", () => {
    expect(() => createRyanAiGitHubWorkerHandlers({} as never))
      .toThrow("All four GitHub worker adapters must be registered.");
  });

  it("routes CI events to the CI reconciliation adapter", async () => {
    const registered = adapters();
    const handlers = createRyanAiGitHubWorkerHandlers(registered);

    await handlers.ci?.(signal);

    expect(registered.ci).toHaveBeenCalledWith(signal);
    expect(registered.review).not.toHaveBeenCalled();
  });

  it("routes review events only to the review adapter", async () => {
    const registered = adapters();
    const handlers = createRyanAiGitHubWorkerHandlers(registered);
    const reviewSignal = { ...signal, target: "review" as const, eventType: "pull_request_review" as const };

    await handlers.review?.(reviewSignal);

    expect(registered.review).toHaveBeenCalledWith(reviewSignal);
  });

  it("rejects target and event-type mismatches before invoking an adapter", async () => {
    const registered = adapters();
    const handlers = createRyanAiGitHubWorkerHandlers(registered);

    await expect(handlers.ci?.({
      ...signal,
      target: "ci",
      eventType: "push",
    })).rejects.toThrow("Unsupported ci event type: push");
    expect(registered.ci).not.toHaveBeenCalled();
  });

  it("rejects malformed repository identities", async () => {
    const registered = adapters();
    const handlers = createRyanAiGitHubWorkerHandlers(registered);

    await expect(handlers.ci?.({
      ...signal,
      repository: "not-a-repository",
    })).rejects.toThrow("owner/repository format");
    expect(registered.ci).not.toHaveBeenCalled();
  });

  it("propagates domain adapter failures for durable retry", async () => {
    const registered = adapters();
    vi.mocked(registered.ci).mockRejectedValueOnce(new Error("CI provider unavailable"));
    const handlers = createRyanAiGitHubWorkerHandlers(registered);

    await expect(handlers.ci?.(signal)).rejects.toThrow("CI provider unavailable");
  });
});
