import { describe, expect, it, vi } from "vitest";
import {
  createRyanAiGitHubEventWorker,
  normalizeRyanAiGitHubEvent,
  createRyanAiGitHubEventWorkerWithRouter,
  type RyanAiGitHubEventStream,
  type RyanAiGitHubEventSubscription,
} from "./githubEventStreams";

describe("normalizeRyanAiGitHubEvent", () => {
  it("canonicalizes identifiers and timestamps", () => {
    const event = normalizeRyanAiGitHubEvent({
      id: " evt-1 ",
      type: "check_suite",
      repository: " ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main ",
      occurredAt: "2026-11-19T00:00:00+02:00",
      payload: {},
    });
    expect(event.id).toBe("evt-1");
    expect(event.repository).toBe("ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main");
    expect(event.occurredAt).toBe("2026-11-18T22:00:00.000Z");
  });

  it("rejects malformed timestamps", () => {
    expect(() => normalizeRyanAiGitHubEvent({
      id: "evt-invalid",
      type: "push",
      repository: "repo",
      occurredAt: "not-a-date",
      payload: {},
    })).toThrow("valid ISO timestamp");
  });
});

describe("RyanAI GitHub Event Streams worker", () => {
  it("subscribes once and handles delivered events without polling", async () => {
    const events: string[] = [];
    const stop = vi.fn(async () => undefined);
    const subscribe = vi.fn(async (
      _subscription: RyanAiGitHubEventSubscription,
      onEvent: (event: { id: string; type: "check_suite"; repository: string; occurredAt: string; payload: unknown }) => Promise<void> | void,
    ) => {
      await onEvent({
        id: "evt-1",
        type: "check_suite",
        repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
        occurredAt: "2026-11-19T00:00:00Z",
        payload: { status: "completed" },
      });
      return stop;
    });

    const stream: RyanAiGitHubEventStream = { subscribe };
    const worker = createRyanAiGitHubEventWorker(
      [{
        subscriptionId: "ryanai-ci",
        repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
        eventTypes: ["check_suite"],
      }],
      async (event) => {
        events.push(event.id);
      },
    );

    const shutdown = await worker.start(stream);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["evt-1"]);
    await shutdown();
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it("routes delivered events through the worker wake router", async () => {
    const wake = vi.fn(async () => undefined);
    const subscribe = vi.fn(async (
      _subscription: RyanAiGitHubEventSubscription,
      onEvent: (event: { id: string; type: "check_suite"; repository: string; occurredAt: string; payload: unknown }) => Promise<void> | void,
    ) => {
      await onEvent({
        id: "evt-router-1",
        type: "check_suite",
        repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
        occurredAt: "2026-11-19T00:00:00Z",
        payload: { status: "completed" },
      });
      return async () => undefined;
    });

    const worker = createRyanAiGitHubEventWorkerWithRouter(
      [{
        subscriptionId: "ryanai-ci",
        repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
        eventTypes: ["check_suite"],
      }],
      wake,
    );

    await worker.start({ subscribe });

    expect(wake).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "evt-router-1",
      target: "ci",
    }));
  });

  it("cleans up earlier subscriptions when a later subscription fails", async () => {
    const stopFirst = vi.fn(async () => undefined);
    const subscribe = vi.fn()
      .mockResolvedValueOnce(stopFirst)
      .mockRejectedValueOnce(new Error("provider subscription failed"));
    const worker = createRyanAiGitHubEventWorker(
      [
        { subscriptionId: "one", repository: "owner/repo", eventTypes: ["push"] },
        { subscriptionId: "two", repository: "owner/repo", eventTypes: ["check_run"] },
      ],
      async () => undefined,
    );

    await expect(worker.start({ subscribe })).rejects.toThrow("provider subscription failed");
    expect(stopFirst).toHaveBeenCalledTimes(1);
  });

  it("makes shutdown idempotent", async () => {
    const stop = vi.fn(async () => undefined);
    const worker = createRyanAiGitHubEventWorker(
      [{ subscriptionId: "one", repository: "owner/repo", eventTypes: ["push"] }],
      async () => undefined,
    );
    const shutdown = await worker.start({
      subscribe: async () => stop,
    });

    await shutdown();
    await shutdown();
    expect(stop).toHaveBeenCalledTimes(1);
  });

});
