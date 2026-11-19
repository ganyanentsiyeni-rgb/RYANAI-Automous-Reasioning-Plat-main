
describe("validateRyanAiGitHubEventSubscriptions", () => {
  const valid = {
    subscriptionId: "ci-events",
    repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
    eventTypes: ["check_suite", "check_run"] as const,
  };

  it("accepts valid, unique subscription definitions", () => {
    expect(() => validateRyanAiGitHubEventSubscriptions([valid])).not.toThrow();
  });

  it("rejects duplicate subscription IDs", () => {
    expect(() => validateRyanAiGitHubEventSubscriptions([valid, valid]))
      .toThrow("Duplicate GitHub event subscription ID");
  });

  it("rejects malformed repositories and empty event lists", () => {
    expect(() => validateRyanAiGitHubEventSubscriptions([
      { ...valid, repository: "not-a-repository" },
    ])).toThrow("owner/repository");
    expect(() => validateRyanAiGitHubEventSubscriptions([
      { ...valid, eventTypes: [] },
    ])).toThrow("at least one event type");
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  createRyanAiGitHubEventWorker,
  normalizeRyanAiGitHubEvent,
  validateRyanAiGitHubEventSubscriptions,
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

  it("bounds pending delivery and preserves back-pressure", async () => {
    let releaseFirst!: () => void;
    let receive!: (event: {
      id: string;
      type: "push";
      repository: string;
      occurredAt: string;
      payload: unknown;
    }) => Promise<void> | void;
    const handled: string[] = [];
    const worker = createRyanAiGitHubEventWorker(
      [{ subscriptionId: "one", repository: "owner/repo", eventTypes: ["push"] }],
      async (event) => {
        if (event.id === "first") {
          await new Promise<void>((resolve) => { releaseFirst = resolve; });
        }
        handled.push(event.id);
      },
      { maxPendingEvents: 1 },
    );
    await worker.start({
      subscribe: async (_subscription, onEvent) => {
        receive = onEvent as typeof receive;
        return async () => undefined;
      },
    });

    const first = receive({
      id: "first", type: "push", repository: "owner/repo",
      occurredAt: "2026-11-19T00:00:00Z", payload: {},
    });
    await Promise.resolve();
    await expect(Promise.resolve(receive({
      id: "second", type: "push", repository: "owner/repo",
      occurredAt: "2026-11-19T00:00:01Z", payload: {},
    }))).rejects.toThrow("at capacity");

    releaseFirst();
    await first;
    await receive({
      id: "second", type: "push", repository: "owner/repo",
      occurredAt: "2026-11-19T00:00:01Z", payload: {},
    });
    expect(handled).toEqual(["first", "second"]);
  });

  it("preserves non-Error startup and cleanup failures together", async () => {
    const stop = vi.fn(async () => { throw "cleanup-failure"; });
    const subscribe = vi.fn()
      .mockResolvedValueOnce(stop)
      .mockRejectedValueOnce("provider-failure");
    const worker = createRyanAiGitHubEventWorker(
      [
        { subscriptionId: "one", repository: "owner/repo", eventTypes: ["push"] },
        { subscriptionId: "two", repository: "owner/repo", eventTypes: ["check_run"] },
      ],
      async () => undefined,
    );

    let caught: unknown;
    try {
      await worker.start({ subscribe });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual(["provider-failure", "cleanup-failure"]);
  });

  it("does not finish shutdown until accepted delivery finalization completes", async () => {
    let release!: () => void;
    let receive!: (event: {
      id: string; type: "push"; repository: string; occurredAt: string; payload: unknown;
    }) => Promise<void> | void;
    const worker = createRyanAiGitHubEventWorker(
      [{ subscriptionId: "one", repository: "owner/repo", eventTypes: ["push"] }],
      async () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const shutdownStop = vi.fn(async () => undefined);
    const shutdown = await worker.start({
      subscribe: async (_subscription, onEvent) => {
        receive = onEvent as typeof receive;
        return shutdownStop;
      },
    });
    const delivery = receive({
      id: "in-flight", type: "push", repository: "owner/repo",
      occurredAt: "2026-11-19T00:00:00Z", payload: {},
    });
    await Promise.resolve();
    let shutdownFinished = false;
    const stopping = shutdown().then(() => { shutdownFinished = true; });
    await Promise.resolve();
    expect(shutdownFinished).toBe(false);
    release();
    await Promise.all([delivery, stopping]);
    expect(shutdownFinished).toBe(true);
    expect(shutdownStop).toHaveBeenCalledTimes(1);
  });

});
