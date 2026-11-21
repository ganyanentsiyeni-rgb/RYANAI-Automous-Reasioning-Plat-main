import { describe, expect, it } from "vitest";
import {
  bindRyanAiGitHubEventToOwner,
  createRyanAiGitHubOwnerBinding,
  resolveRyanAiGitHubOwnerBinding,
} from "./githubEventOwnerBinding";

const connection = {
  userId: "ryanai-user-1",
  githubUserId: "123456",
  repositoryId: "1361308785",
  repositoryFullName: "ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main",
};

const event = {
  id: "evt_1",
  type: "pull_request" as const,
  repository: connection.repositoryFullName,
  occurredAt: "2026-11-19T12:00:00.000Z",
  payload: {
    action: "synchronize",
    repository: { id: 1361308785, full_name: connection.repositoryFullName },
    // An attacker-controlled owner field must never influence the binding.
    ownerUserId: "attacker-user",
  },
};

describe("owner-bound GitHub event identity", () => {
  it("binds events to the authenticated owner and immutable repository identity", () => {
    const binding = createRyanAiGitHubOwnerBinding("ryanai-user-1", connection);
    const result = bindRyanAiGitHubEventToOwner(binding, event);
    expect(result).toMatchObject({
      ownerUserId: "ryanai-user-1",
      githubUserId: "123456",
      repositoryId: "1361308785",
      repositoryFullName: connection.repositoryFullName,
      event,
    });
    expect(result.ownerUserId).not.toBe(event.payload.ownerUserId);
  });

  it("rejects a connection belonging to another RyanAI user", () => {
    expect(() => createRyanAiGitHubOwnerBinding("different-user", connection))
      .toThrow(/does not belong/);
  });

  it("rejects malformed or incomplete connection identity", () => {
    expect(() => createRyanAiGitHubOwnerBinding("", connection)).toThrow(/owner user ID/);
    expect(() => createRyanAiGitHubOwnerBinding("ryanai-user-1", {
      ...connection, repositoryFullName: "not-a-repository",
    })).toThrow(/owner\/repository/);
    expect(() => createRyanAiGitHubOwnerBinding("ryanai-user-1", {
      ...connection, repositoryId: "",
    })).toThrow(/repository ID/);
  });

  it("rejects an event for a different immutable repository ID", () => {
    const binding = createRyanAiGitHubOwnerBinding("ryanai-user-1", connection);
    expect(() => bindRyanAiGitHubEventToOwner(binding, {
      ...event,
      payload: { repository: { id: 999999, full_name: connection.repositoryFullName } },
    })).toThrow(/does not match/);
  });

  it("rejects a renamed or spoofed repository full name", () => {
    const binding = createRyanAiGitHubOwnerBinding("ryanai-user-1", connection);
    expect(() => bindRyanAiGitHubEventToOwner(binding, {
      ...event,
      repository: "attacker/fork",
      payload: { repository: { id: 1361308785, full_name: "attacker/fork" } },
    })).toThrow(/does not match/);
  });

  it("rejects events without provider repository identity", () => {
    const binding = createRyanAiGitHubOwnerBinding("ryanai-user-1", connection);
    expect(() => bindRyanAiGitHubEventToOwner(binding, {
      ...event, payload: { action: "opened" },
    })).toThrow(/missing its repository identity/);
  });

  it("resolves the stored connection using only the authenticated RyanAI user ID", async () => {
    const lookups: string[] = [];
    const binding = await resolveRyanAiGitHubOwnerBinding("ryanai-user-1", async (userId) => {
      lookups.push(userId);
      return connection;
    });
    expect(lookups).toEqual(["ryanai-user-1"]);
    expect(binding).toMatchObject({
      ownerUserId: "ryanai-user-1",
      githubUserId: "123456",
      repositoryId: "1361308785",
    });
  });

  it("returns null when the authenticated owner has no GitHub connection", async () => {
    const binding = await resolveRyanAiGitHubOwnerBinding("ryanai-user-1", async () => null);
    expect(binding).toBeNull();
  });

  it("rejects a lookup result belonging to a different RyanAI owner", async () => {
    await expect(resolveRyanAiGitHubOwnerBinding("ryanai-user-1", async () => ({
      ...connection,
      userId: "another-user",
    }))).rejects.toThrow(/does not belong/);
  });

  it("does not query storage when the authenticated owner ID is missing", async () => {
    let queried = false;
    await expect(resolveRyanAiGitHubOwnerBinding("", async () => {
      queried = true;
      return connection;
    })).rejects.toThrow(/owner user ID/);
    expect(queried).toBe(false);
  });

});
