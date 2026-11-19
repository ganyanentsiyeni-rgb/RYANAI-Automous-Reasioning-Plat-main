import { describe, expect, it, vi } from "vitest";
import {
  createRyanAiGitHubEventWorkerWithPostgresWake,
  type RyanAiGitHubEvent,
  type RyanAiGitHubEventStream,
} from "./githubEventStreams";
import {
  RYANAI_GITHUB_WORKER_WAKE_CHANNELS,
  createPostgresRyanAiGitHubWorkerWakePublisher,
  subscribeRyanAiGitHubWorkerWake,
} from "./postgresGitHubWorkerWake";

const signal = {
  eventId: "evt-123",
  target: "ci" as const,
  eventType: "check_suite" as const,
  repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
  occurredAt: "2026-11-19T17:00:00.000Z",
  payload: { large: "not copied into NOTIFY" },
};

describe("PostgreSQL GitHub worker wake transport", () => {
  it("publishes a compact envelope to the target-specific channel", async () => {
    const persistWake = vi.fn(async () => undefined);
    const notify = vi.fn(async (_channel: string, _payload: string) => undefined);
    const publish = createPostgresRyanAiGitHubWorkerWakePublisher(persistWake, notify);

    await publish(signal);

    expect(persistWake).toHaveBeenCalledWith(signal);

    expect(notify).toHaveBeenCalledTimes(1);
    const [channel, raw] = notify.mock.calls[0];
    expect(channel).toBe(RYANAI_GITHUB_WORKER_WAKE_CHANNELS.ci);
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      eventId: "evt-123",
      target: "ci",
      eventType: "check_suite",
      repository: signal.repository,
      occurredAt: signal.occurredAt,
    });
    expect(raw).not.toContain("large");
  });

  it("routes notifications to a worker listener and validates the target", async () => {
    let receive!: (payload: string) => Promise<void>;
    const stop = vi.fn(async () => undefined);
    const listen = vi.fn(async (_channel: string, callback: (payload: string) => Promise<void>) => {
      receive = callback;
      return stop;
    });
    const onWake = vi.fn();
    const shutdown = await subscribeRyanAiGitHubWorkerWake({ listen }, "ci", onWake);

    expect(listen).toHaveBeenCalledWith(RYANAI_GITHUB_WORKER_WAKE_CHANNELS.ci, expect.any(Function));
    await receive(JSON.stringify({
      version: 1,
      eventId: "evt-123",
      target: "ci",
      eventType: "check_suite",
      repository: signal.repository,
      occurredAt: signal.occurredAt,
    }));
    expect(onWake).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt-123", target: "ci" }));
    await shutdown();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed and cross-target notifications", async () => {
    let receive!: (payload: string) => Promise<void>;
    const listen = vi.fn(async (_channel: string, callback: (payload: string) => Promise<void>) => {
      receive = callback;
      return async () => undefined;
    });
    const onWake = vi.fn();
    await subscribeRyanAiGitHubWorkerWake({ listen }, "ci", onWake);

    await expect(receive("{not-json")).rejects.toThrow("Invalid JSON");
    await expect(receive(JSON.stringify({ ...signal, version: 1 })))
      .rejects.toThrow("Invalid RyanAI GitHub worker wake envelope");
    expect(onWake).not.toHaveBeenCalled();
  });
});


describe("GitHub Event Streams PostgreSQL wake composition", () => {
  it("routes a delivered check-suite event to the PostgreSQL CI wake channel", async () => {
    let deliver!: (event: RyanAiGitHubEvent) => Promise<void> | void;
    const stream: RyanAiGitHubEventStream = {
      subscribe: async (_subscription, onEvent) => {
        deliver = onEvent;
        return async () => undefined;
      },
    };
    const persistWake = vi.fn(async () => undefined);
    const notify = vi.fn(async (_channel: string, _payload: string) => undefined);
    const worker = createRyanAiGitHubEventWorkerWithPostgresWake(
      [{
        subscriptionId: "ci-events",
        repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
        eventTypes: ["check_suite"],
      }],
      persistWake,
      notify,
    );
    const stop = await worker.start(stream);

    await deliver({
      id: "evt-stream-ci",
      type: "check_suite",
      repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
      occurredAt: "2026-11-19T17:00:00.000Z",
      payload: { conclusion: "success" },
    });

    expect(persistWake).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe(RYANAI_GITHUB_WORKER_WAKE_CHANNELS.ci);
    expect(JSON.parse(notify.mock.calls[0][1])).toMatchObject({
      eventId: "evt-stream-ci",
      target: "ci",
      eventType: "check_suite",
    });
    await stop();
  });
});
