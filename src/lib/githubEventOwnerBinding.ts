/**
 * Server-derived identity for one owner's already-verified GitHub OAuth
 * connection. Never construct this from an event payload or browser input.
 */
export interface RyanAiGitHubOwnerBinding {
  ownerUserId: string;
  githubUserId: string;
  repositoryId: string;
  repositoryFullName: string;
}

export interface RyanAiGitHubOwnerEvent {
  id: string;
  type: "pull_request" | "pull_request_review" | "pull_request_review_thread" | "check_suite" | "check_run" | "push";
  repository: string;
  occurredAt: string;
  payload: unknown;
}

export interface RyanAiOwnerBoundGitHubEvent {
  ownerUserId: string;
  githubUserId: string;
  repositoryId: string;
  repositoryFullName: string;
  event: RyanAiGitHubOwnerEvent;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("GitHub owner binding " + field + " is required.");
  }
  return value.trim();
}

/** Build only from the persisted connection row returned for an authenticated user. */
export function createRyanAiGitHubOwnerBinding(
  authenticatedUserId: string,
  connection: {
    userId: string;
    githubUserId: string;
    repositoryId: string;
    repositoryFullName: string;
  },
): RyanAiGitHubOwnerBinding {
  const ownerUserId = requiredString(authenticatedUserId, "owner user ID");
  if (requiredString(connection.userId, "connection user ID") !== ownerUserId) {
    throw new Error("GitHub connection does not belong to the authenticated RyanAI owner.");
  }
  const repositoryFullName = requiredString(connection.repositoryFullName, "repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryFullName)) {
    throw new Error("GitHub owner binding repository must use owner/repository format.");
  }
  return Object.freeze({
    ownerUserId,
    githubUserId: requiredString(connection.githubUserId, "GitHub account ID"),
    repositoryId: requiredString(connection.repositoryId, "repository ID"),
    repositoryFullName,
  });
}

function readEventRepository(payload: unknown): { id: string; fullName: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("GitHub event payload is missing its repository identity.");
  }
  const repository = (payload as { repository?: unknown }).repository;
  if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
    throw new Error("GitHub event payload is missing its repository identity.");
  }
  const value = repository as { id?: unknown; full_name?: unknown };
  const id = typeof value.id === "number" && Number.isSafeInteger(value.id) && value.id > 0
    ? String(value.id)
    : typeof value.id === "string" && /^\d+$/.test(value.id) ? value.id : "";
  return {
    id,
    fullName: typeof value.full_name === "string" ? value.full_name.trim() : "",
  };
}

/**
 * Attach the server-derived owner only after matching both GitHub's immutable
 * repository ID and canonical full name. Payload-supplied owner IDs are ignored.
 */
export function bindRyanAiGitHubEventToOwner(
  binding: RyanAiGitHubOwnerBinding,
  event: RyanAiGitHubOwnerEvent,
): RyanAiOwnerBoundGitHubEvent {
  if (!binding.ownerUserId || !binding.githubUserId || !binding.repositoryId) {
    throw new Error("GitHub owner binding is incomplete.");
  }
  const eventRepository = readEventRepository(event.payload);
  if (
    eventRepository.id !== binding.repositoryId ||
    eventRepository.fullName !== binding.repositoryFullName ||
    event.repository !== binding.repositoryFullName
  ) {
    throw new Error("GitHub event repository does not match the owner's verified connection.");
  }
  return Object.freeze({
    ownerUserId: binding.ownerUserId,
    githubUserId: binding.githubUserId,
    repositoryId: binding.repositoryId,
    repositoryFullName: binding.repositoryFullName,
    event,
  });
}
