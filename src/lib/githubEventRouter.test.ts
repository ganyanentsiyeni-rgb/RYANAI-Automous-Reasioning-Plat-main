import { describe, expect, it, vi } from "vitest";
import { createRyanAiGitHubEventRouter } from "./githubEventRouter";

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

  it("ignores unsupported event types without crashing", async () => {
    const wake = vi.fn();
    const route = createRyanAiGitHubEventRouter(wake);

    await route({
      ...event("evt-unknown", "push"),
      type: "push",
    });

    expect(wake).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "evt-unknown",
      target: "repository",
    }));
  });
});
