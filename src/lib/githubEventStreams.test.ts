import { describe, expect, it, vi } from "vitest";
import {
  createRyanAiGitHubEventWorker,
  createRyanAiGitHubEventWorkerWithRouter,
  type RyanAiGitHubEventStream,
  type RyanAiGitHubEventSubscription,
} from "./githubEventStreams";

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

});
