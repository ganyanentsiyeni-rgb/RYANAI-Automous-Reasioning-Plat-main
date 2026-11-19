import { describe, expect, it, vi } from "vitest";
import { createPostgresRyanAiEventIdempotencyStore } from "./postgresGitHubEventIdempotencyStore";

describe("createPostgresRyanAiEventIdempotencyStore", () => {
  it("uses atomic INSERT ON CONFLICT RETURNING to claim an event", async () => {
    const query = vi.fn(async () => ({ rows: [{ event_id: "evt-1" }] }));
    const store = createPostgresRyanAiEventIdempotencyStore(query);

    await expect(store.claim("evt-1")).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (event_id) DO NOTHING"),
      ["evt-1"],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("RETURNING event_id"),
      ["evt-1"],
    );
  });

  it("returns false when another worker already claimed the event", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = createPostgresRyanAiEventIdempotencyStore(query);

    await expect(store.claim("evt-1")).resolves.toBe(false);
  });

  it("parameterizes lookup, remember, and release operations", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ present: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const store = createPostgresRyanAiEventIdempotencyStore(query);

    await expect(store.has("evt-2")).resolves.toBe(true);
    await store.remember("evt-2");
    await store.forget("evt-2");

    expect(query.mock.calls.map(([sql, params]) => [String(sql), params])).toEqual([
      [expect.stringContaining("SELECT EXISTS"), ["evt-2"]],
      [expect.stringContaining("ON CONFLICT (event_id) DO NOTHING"), ["evt-2"]],
      [expect.stringContaining("DELETE FROM public.github_event_idempotency"), ["evt-2"]],
    ]);
  });
});
