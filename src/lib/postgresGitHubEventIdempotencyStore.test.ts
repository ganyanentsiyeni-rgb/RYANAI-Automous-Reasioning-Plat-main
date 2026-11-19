import { describe, expect, it, vi } from "vitest";
import { createPostgresRyanAiEventIdempotencyStore } from "./postgresGitHubEventIdempotencyStore";

describe("createPostgresRyanAiEventIdempotencyStore", () => {
  it("atomically claims an event with an expiring processing lease", async () => {
    const query = vi.fn(async () => ({ rows: [{ event_id: "evt-1" }] }));
    const store = createPostgresRyanAiEventIdempotencyStore(query, { leaseMs: 30_000 });

    await expect(store.claim("evt-1")).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (event_id) DO UPDATE"),
      ["evt-1", 30_000],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("lease_expires_at <= NOW()"),
      ["evt-1", 30_000],
    );
  });

  it("returns false when an event is active or already completed", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = createPostgresRyanAiEventIdempotencyStore(query);

    await expect(store.claim("evt-1")).resolves.toBe(false);
  });

  it("marks successful processing as completed", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = createPostgresRyanAiEventIdempotencyStore(query);

    await store.remember("evt-2");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'completed', completed_at = NOW()"),
      ["evt-2"],
    );
  });

  it("checks presence and releases only a processing reservation", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ present: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const store = createPostgresRyanAiEventIdempotencyStore(query);

    await expect(store.has("evt-2")).resolves.toBe(true);
    await store.forget("evt-2");

    expect(query.mock.calls.map(([sql, params]) => [String(sql), params])).toEqual([
      [expect.stringContaining("SELECT EXISTS"), ["evt-2"]],
      [expect.stringContaining("status = 'processing'"), ["evt-2"]],
    ]);
  });

  it("rejects unsafe lease durations", () => {
    expect(() => createPostgresRyanAiEventIdempotencyStore(vi.fn(), { leaseMs: 999 }))
      .toThrow("between 1000 and 3600000");
    expect(() => createPostgresRyanAiEventIdempotencyStore(vi.fn(), { leaseMs: 3_600_001 }))
      .toThrow("between 1000 and 3600000");
  });
});
