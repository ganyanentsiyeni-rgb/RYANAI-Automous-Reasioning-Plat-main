import { describe, expect, it, vi } from "vitest";
import {
  createPostgresRyanAiGitHubInboxConsumer,
  processNextRyanAiGitHubInboxEvent,
  startRyanAiGitHubInboxWorker,
  type RyanAiDurableGitHubInboxEvent,
} from "./postgresGitHubInboxConsumer";

const claimedEvent: RyanAiDurableGitHubInboxEvent = {
  id: "00000000-0000-4000-8000-000000000001",
  event_id: "00000000-0000-4000-8000-000000000002",
  event_type: "check_suite",
  occurred_at: "2026-11-19T12:00:00.000Z",
  payload: {
    id: "provider-event-1",
    type: "check_suite",
    target: "ci",
    repository: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
    occurredAt: "2026-11-19T12:00:00.000Z",
    payload: { action: "completed" },
  },
  attempts: 1,
  max_attempts: 5,
};

describe("createPostgresRyanAiGitHubInboxConsumer", () => {
  it("claims only due GitHub Event Streams rows for the requested target and records the attempt atomically", async () => {
    const query = vi.fn(async () => ({ rows: [claimedEvent] }));
    const consumer = createPostgresRyanAiGitHubInboxConsumer(query, { leaseMs: 30_000 });

    await expect(consumer.claimNext("ci", "ci-worker-1")).resolves.toEqual(claimedEvent);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("FOR UPDATE SKIP LOCKED");
    expect(String(sql)).toContain("source_provider = 'github'");
    expect(String(sql)).toContain("source_service = 'event-streams'");
    expect(String(sql)).toContain("payload->>'target' = $1");
    expect(String(sql)).toContain("INSERT INTO public.intelligence_event_attempts");
    expect(params).toEqual(["ci", "ci-worker-1", 30_000]);
  });

  it("rejects invalid targets and worker identifiers before querying", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const consumer = createPostgresRyanAiGitHubInboxConsumer(query);

    await expect(consumer.claimNext("invalid" as never, "worker")).rejects.toThrow("Unsupported");
    await expect(consumer.claimNext("ci", " ")).rejects.toThrow("workerId");
    expect(query).not.toHaveBeenCalled();
  });

  it("completes only while the same worker owns a live lease and closes its attempt", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: claimedEvent.id }] }));
    const consumer = createPostgresRyanAiGitHubInboxConsumer(query);

    await expect(consumer.complete(claimedEvent.id, "ci-worker-1")).resolves.toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("lease_owner = $2");
    expect(String(sql)).toContain("lease_expires_at > NOW()");
    expect(String(sql)).toContain("status = 'succeeded'");
    expect(params).toEqual([claimedEvent.id, "ci-worker-1"]);
  });

  it("reports lease loss when completion updates no owned row", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const consumer = createPostgresRyanAiGitHubInboxConsumer(query);
    await expect(consumer.complete(claimedEvent.id, "other-worker")).resolves.toBe(false);
  });

  it("moves failed attempts to retry or dead-letter with bounded exponential backoff", async () => {
    const query = vi.fn(async () => ({ rows: [{ outcome: "retry" as const }] }));
    const consumer = createPostgresRyanAiGitHubInboxConsumer(query, {
      retryBaseMs: 2_000,
      retryMaxMs: 20_000,
    });

    await expect(consumer.fail(claimedEvent.id, "ci-worker-1", new Error("temporary")))
      .resolves.toBe("retry");
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("attempts >= max_attempts");
    expect(String(sql)).toContain("POWER(2");
    expect(String(sql)).toContain("status = 'retry'");
    expect(params).toEqual([claimedEvent.id, "ci-worker-1", 2_000, 20_000, "temporary"]);
  });

  it("reports dead-letter transitions and lease loss distinctly", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ outcome: "dead_letter" as const }] })
      .mockResolvedValueOnce({ rows: [] });
    const consumer = createPostgresRyanAiGitHubInboxConsumer(query);

    await expect(consumer.fail(claimedEvent.id, "ci-worker-1", "fatal"))
      .resolves.toBe("dead_letter");
    await expect(consumer.fail(claimedEvent.id, "ci-worker-1", "late"))
      .resolves.toBe("lease_lost");
  });

  it("recovers expired leases and records lease_expired attempt outcomes", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: claimedEvent.id }] }));
    const consumer = createPostgresRyanAiGitHubInboxConsumer(query);

    await expect(consumer.recoverExpired("ci")).resolves.toBe(1);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("lease_expires_at <= NOW()");
    expect(String(sql)).toContain("status = 'lease_expired'");
    expect(String(sql)).toContain("FOR UPDATE SKIP LOCKED");
    expect(params).toEqual(["ci", 5_000]);
  });

  it("validates retry and lease bounds", () => {
    expect(() => createPostgresRyanAiGitHubInboxConsumer(vi.fn(), { leaseMs: 999 }))
      .toThrow("leaseMs");
    expect(() => createPostgresRyanAiGitHubInboxConsumer(vi.fn(), { retryBaseMs: 99 }))
      .toThrow("retryBaseMs");
    expect(() => createPostgresRyanAiGitHubInboxConsumer(vi.fn(), {
      retryBaseMs: 5_000,
      retryMaxMs: 4_999,
    })).toThrow("retryMaxMs");
  });
});

describe("processNextRyanAiGitHubInboxEvent", () => {
  it("dispatches a claimed event to its target handler and acknowledges it", async () => {
    const handler = vi.fn(async () => undefined);
    const consumer = {
      claimNext: vi.fn(async () => claimedEvent),
      complete: vi.fn(async () => true),
      fail: vi.fn(async () => "retry" as const),
      recoverExpired: vi.fn(async () => 0),
    };

    await expect(processNextRyanAiGitHubInboxEvent(
      consumer,
      "ci",
      "ci-worker-1",
      { ci: handler },
    )).resolves.toEqual({ status: "processed", eventId: "provider-event-1" });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "provider-event-1",
      target: "ci",
      eventType: "check_suite",
      repository: claimedEvent.payload.repository,
    }));
    expect(consumer.complete).toHaveBeenCalledWith(claimedEvent.id, "ci-worker-1");
    expect(consumer.fail).not.toHaveBeenCalled();
  });

  it("sends handler failures to the durable retry policy", async () => {
    const consumer = {
      claimNext: vi.fn(async () => claimedEvent),
      complete: vi.fn(async () => true),
      fail: vi.fn(async () => "retry" as const),
      recoverExpired: vi.fn(async () => 0),
    };
    const handler = vi.fn(async () => { throw new Error("worker unavailable"); });

    await expect(processNextRyanAiGitHubInboxEvent(
      consumer,
      "ci",
      "ci-worker-1",
      { ci: handler },
    )).resolves.toEqual({
      status: "retry",
      eventId: "provider-event-1",
      error: "worker unavailable",
    });
    expect(consumer.fail).toHaveBeenCalledWith(
      claimedEvent.id,
      "ci-worker-1",
      expect.objectContaining({ message: "worker unavailable" }),
    );
  });

  it("does not acknowledge an event after the worker lease is lost", async () => {
    const consumer = {
      claimNext: vi.fn(async () => claimedEvent),
      complete: vi.fn(async () => false),
      fail: vi.fn(async () => "lease_lost" as const),
      recoverExpired: vi.fn(async () => 0),
    };

    await expect(processNextRyanAiGitHubInboxEvent(
      consumer,
      "ci",
      "ci-worker-1",
      { ci: vi.fn(async () => undefined) },
    )).resolves.toEqual({ status: "lease_lost", eventId: "provider-event-1" });
  });

  it("returns empty when no eligible inbox event exists", async () => {
    const consumer = {
      claimNext: vi.fn(async () => null),
      complete: vi.fn(async () => true),
      fail: vi.fn(async () => "retry" as const),
      recoverExpired: vi.fn(async () => 0),
    };

    await expect(processNextRyanAiGitHubInboxEvent(
      consumer,
      "ci",
      "ci-worker-1",
      {},
    )).resolves.toEqual({ status: "empty" });
  });
});


describe("startRyanAiGitHubInboxWorker", () => {
  it("subscribes before draining startup backlog and shuts down the listener", async () => {
    const order: string[] = [];
    let onWake: (() => Promise<void>) | undefined;
    const listener = {
      listen: vi.fn(async (_channel: string, callback: (payload: string) => Promise<void>) => {
        order.push("subscribe");
        onWake = () => callback(JSON.stringify({
          version: 1,
          eventId: "provider-event-2",
          target: "ci",
          eventType: "check_suite",
          repository: claimedEvent.payload.repository,
          occurredAt: claimedEvent.occurred_at,
        }));
        return async () => { order.push("unsubscribe"); };
      }),
    };
    let claimsRemaining = 1;
    const consumer = {
      recoverExpired: vi.fn(async () => { order.push("recover"); return 0; }),
      claimNext: vi.fn(async () => {
        order.push("claim");
        if (claimsRemaining-- > 0) return claimedEvent;
        return null;
      }),
      complete: vi.fn(async () => true),
      fail: vi.fn(async () => "retry" as const),
    };
    const handler = vi.fn(async () => { order.push("handle"); });

    const stop = await startRyanAiGitHubInboxWorker(
      consumer,
      listener,
      "ci",
      "ci-worker-1",
      { ci: handler },
    );

    expect(order.slice(0, 2)).toEqual(["subscribe", "recover"]);
    expect(handler).toHaveBeenCalledTimes(1);
    await onWake?.();
    await stop();

    expect(listener.listen).toHaveBeenCalledWith("ryanai_github_ci_wake", expect.any(Function));
    expect(order[order.length - 1]).toBe("unsubscribe");
  });

  it("unsubscribes when the initial durable backlog drain fails", async () => {
    const unsubscribe = vi.fn(async () => undefined);
    const listener = {
      listen: vi.fn(async () => unsubscribe),
    };
    const consumer = {
      recoverExpired: vi.fn(async () => { throw new Error("database unavailable"); }),
      claimNext: vi.fn(async () => null),
      complete: vi.fn(async () => true),
      fail: vi.fn(async () => "retry" as const),
    };

    await expect(startRyanAiGitHubInboxWorker(
      consumer,
      listener,
      "ci",
      "ci-worker-1",
      {},
    )).rejects.toThrow("database unavailable");
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
