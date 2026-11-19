import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryRyanAiEventIdempotencyStore,
  createRyanAiGitHubEventRouter,
  createRyanAiWorkerWakeDispatcher,
} from "./githubEventRouter";

const event = (id: string, type: "check_suite" | "pull_request_review" | "pull_request") => ({
  id,
  type,
  repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
  occurredAt: "2026-11-19T15:00:00.000Z",
  payload: { action: "completed" },
});

describe("createRyanAiGitHubEventRouter", () => {
  it("wakes the CI worker for a completed check suite", async () => {
    const wake = vi.fn();
    const route = createRyanAiGitHubEventRouter(wake);

    await route(event("evt-ci-1", "check_suite"));

    expect(wake).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "evt-ci-1",
      target: "ci",
      eventType: "check_suite",
    }));
  });

  it("wakes the review worker for a pull request review", async () => {
    const wake = vi.fn();
    const route = createRyanAiGitHubEventRouter(wake);

    await route(event("evt-review-1", "pull_request_review"));

    expect(wake).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "evt-review-1",
      target: "review",
      eventType: "pull_request_review",
    }));
  });

  it("wakes the pull-request worker for a pull request event", async () => {
    const wake = vi.fn();
    const route = createRyanAiGitHubEventRouter(wake);

    await route(event("evt-pr-1", "pull_request"));

    expect(wake).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "evt-pr-1",
      target: "pull-request",
      eventType: "pull_request",
    }));
  });

  it("dispatches wakes to the handler for their target", async () => {
    const ci = vi.fn();
    const review = vi.fn();
    const dispatcher = createRyanAiWorkerWakeDispatcher({ ci, review });

    await dispatcher({
      eventId: "evt-dispatch",
      target: "ci",
      eventType: "check_suite",
      repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
      occurredAt: "2026-11-19T00:00:00.000Z",
      payload: { conclusion: "success" },
    });

    expect(ci).toHaveBeenCalledTimes(1);
    expect(review).not.toHaveBeenCalled();
  });

  it("does nothing when a target has no registered worker", async () => {
    const dispatcher = createRyanAiWorkerWakeDispatcher({});

    await expect(
      dispatcher({
        eventId: "evt-unregistered",
        target: "repository",
        eventType: "push",
        repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
        occurredAt: "2026-11-19T00:00:00.000Z",
        payload: {},
      }),
    ).resolves.toBeUndefined();
  });

  it("supports an injected idempotency store", async () => {
    const wake = vi.fn();
    const store = createInMemoryRyanAiEventIdempotencyStore();
    const route = createRyanAiGitHubEventRouter(wake, store);
    const first = event("evt-store", "check_suite");

    await route(first);
    await route(first);

    expect(await store.has("evt-store")).toBe(true);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("ignores duplicate event IDs", async () => {
    const wake = vi.fn();
    const route = createRyanAiGitHubEventRouter(wake);
    const first = event("evt-duplicate", "check_suite");

    await route(first);
    await route(first);

    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("does not mark an event handled when the wake handler fails", async () => {
    const wake = vi.fn()
      .mockRejectedValueOnce(new Error("worker unavailable"))
      .mockResolvedValueOnce(undefined);
    const route = createRyanAiGitHubEventRouter(wake);
    const first = event("evt-retry", "check_suite");

    await expect(route(first)).rejects.toThrow("worker unavailable");
    await route(first);

    expect(wake).toHaveBeenCalledTimes(2);
  });

  it("ignores unknown event types without crashing", async () => {
    const wake = vi.fn();
    const route = createRyanAiGitHubEventRouter(wake);

    await route({
      id: "evt-unknown",
      type: "unknown",
      repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
      occurredAt: "2026-11-19T15:00:00.000Z",
      payload: {},
    } as never);

    expect(wake).not.toHaveBeenCalled();
  });
  it("coalesces concurrent redeliveries while the first wake is running", async () => {
    let release!: () => void;
    const wake = vi.fn(async () => new Promise<void>((resolve) => { release = resolve; }));
    const route = createRyanAiGitHubEventRouter(wake);
    const first = event("evt-concurrent", "check_suite");

    const deliveryOne = route(first);
    const deliveryTwo = route(first);
    await Promise.resolve();
    await Promise.resolve();

    expect(wake).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([deliveryOne, deliveryTwo]);
    await route(first);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("preserves the wake failure when clearing its idempotency record also fails", async () => {
    const store = {
      has: vi.fn(() => false),
      remember: vi.fn(() => undefined),
      forget: vi.fn(() => { throw new Error("store unavailable"); }),
    };
    const route = createRyanAiGitHubEventRouter(
      vi.fn(async () => { throw new Error("worker unavailable"); }),
      store,
    );

    await expect(route(event("evt-store-failure", "check_suite")))
      .rejects.toThrow("idempotency record could not be cleared");
  });

  it("rejects invalid in-memory idempotency capacities", () => {
    expect(() => createInMemoryRyanAiEventIdempotencyStore(0))
      .toThrow("between 1 and 1000000");
    expect(() => createInMemoryRyanAiEventIdempotencyStore(1.5))
      .toThrow("between 1 and 1000000");
    expect(() => createInMemoryRyanAiEventIdempotencyStore(1_000_001))
      .toThrow("between 1 and 1000000");
  });

  it("evicts the oldest ID when the bounded in-memory store is full", async () => {
    const store = createInMemoryRyanAiEventIdempotencyStore(2);
    await store.remember("first");
    await store.remember("second");
    await store.remember("third");

    expect(await store.has("first")).toBe(false);
    expect(await store.has("second")).toBe(true);
    expect(await store.has("third")).toBe(true);
  });

});
