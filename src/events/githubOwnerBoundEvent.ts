import { createHash } from 'node:crypto';
import {
  bindRyanAiGitHubEventToOwner,
  resolveRyanAiGitHubOwnerBinding,
  type RyanAiGitHubOwnerConnection,
  type RyanAiGitHubOwnerEvent,
} from '../lib/githubEventOwnerBinding.js';
import type { EnqueueEventResult, IntelligenceEventInbox } from './intelligenceEventInbox.js';
import type { GitHubOwnerEventNotifier } from './postgresGitHubOwnerEventWakeSource.js';

export type GitHubOwnerConnectionLookup = (
  authenticatedUserId: string,
) => Promise<RyanAiGitHubOwnerConnection | null>;

const EVENT_TYPES: Record< RyanAiGitHubOwnerEvent['type'], string> = {
  pull_request: 'github.pull_request',
  pull_request_review: 'github.pull_request_review',
  pull_request_review_thread: 'github.pull_request_review_thread',
  check_suite: 'github.check_suite',
  check_run: 'github.check_run',
  push: 'github.push',
};

function stableEventUuid(repositoryId: string, providerEventId: string): string {
  const hex = createHash('sha256')
    .update('ryanai:github:')
    .update(repositoryId)
    .update(':')
    .update(providerEventId)
    .digest('hex')
    .slice(0, 32)
    .split('');
  // Stable UUID-shaped identifier, with RFC 4122 version/variant bits set.
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return value.slice(0, 8) + '-' + value.slice(8, 12) + '-' + value.slice(12, 16)
    + '-' + value.slice(16, 20) + '-' + value.slice(20);
}

/**
 * Resolve the authenticated owner's persisted GitHub connection, verify the
 * provider event against its immutable repository identity, then enqueue a
 * provider-neutral event carrying a trusted owner envelope.
 *
 * This function only writes to the supplied server-side inbox. It does not
 * activate subscriptions, authorize actions, or execute event payloads.
 */
export async function enqueueRyanAiGitHubOwnerBoundEvent(
  inbox: Pick<IntelligenceEventInbox, 'enqueue'>,
  authenticatedUserId: string,
  findConnectionForUser: GitHubOwnerConnectionLookup,
  event: RyanAiGitHubOwnerEvent,
  notifyOwnerEvent?: GitHubOwnerEventNotifier,
): Promise<EnqueueEventResult | null> {
  const binding = await resolveRyanAiGitHubOwnerBinding(authenticatedUserId, findConnectionForUser);
  if (!binding) return null;

  const bound = bindRyanAiGitHubEventToOwner(binding, event);
  const occurredAt = new Date(event.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new Error('GitHub event timestamp is invalid.');
  }

  const envelope = {
    eventId: stableEventUuid(binding.repositoryId, event.id),
    eventType: EVENT_TYPES[event.type],
    schemaVersion: 1,
    occurredAt: occurredAt.toISOString(),
    source: { provider: 'github', service: 'event-streams' },
    idempotencyKey: 'github:' + binding.repositoryId + ':' + event.id,
    classification: 'confidential' as const,
    payload: {
      owner: {
        userId: bound.ownerUserId,
        githubUserId: bound.githubUserId,
        repositoryId: bound.repositoryId,
        repositoryFullName: bound.repositoryFullName,
      },
      githubEvent: {
        id: event.id,
        type: event.type,
        repository: event.repository,
        occurredAt: occurredAt.toISOString(),
        payload: event.payload,
      },
    },
  };

  return inbox.enqueue(envelope);
  // enqueue resolves only after the durable inbox write has committed. Send
  // the lossy wake hint afterwards; a failed notify is safe to retry because
  // the provider event and inbox idempotency key are stable.
  const result = await inbox.enqueue(envelope);
  if (result && notifyOwnerEvent) await notifyOwnerEvent(envelope.eventId);
  return result;
}
