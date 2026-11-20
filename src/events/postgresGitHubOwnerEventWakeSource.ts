import type { RyanAiPostgresWakeListener } from '../lib/postgresGitHubWorkerWake.js';
import type { RyanAiPostgresQuery } from '../lib/postgresGitHubEventIdempotencyStore.js';
import { startGitHubOwnerEventWorker, type AuthorizedGitHubOwnerLister, type GitHubOwnerEventWorkerOptions } from './githubOwnerEventDispatcher.js';
import type { EventHandlerRegistry } from './eventHandlerRegistry.js';
import type { IntelligenceEventInbox } from './intelligenceEventInbox.js';

export { RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL } from '../lib/postgresGitHubWorkerWake.js';

export interface GitHubOwnerEventWakeSource {
  subscribe(onWake: () => void): () => void;
}

export type GitHubOwnerWakeErrorHandler = (error: unknown) => void;
export type GitHubOwnerEventNotifier = (eventId: string) => Promise<void>;

/**
 * Publishes a small wake hint only after the caller has durably enqueued the
 * event. pg_notify's channel argument is parameterized; the channel is fixed.
 */
export function createPostgresGitHubOwnerEventNotifier(
  query: RyanAiPostgresQuery,
): GitHubOwnerEventNotifier {
  return async (eventId) => {
    if (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 200) {
      throw new RangeError('eventId must contain 1-200 characters.');
    }
    await query(
      'SELECT pg_notify($1, $2)',
      [RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, JSON.stringify({ version: 1, eventId })],
    );
  };
}

/**
 * Adapts the existing dedicated-connection LISTEN contract. Notification
 * payloads are intentionally ignored; the durable inbox and trusted owner
 * resolver remain authoritative.
 */
export function createPostgresGitHubOwnerEventWakeSource(
  listener: RyanAiPostgresWakeListener,
  onError: GitHubOwnerWakeErrorHandler,
): GitHubOwnerEventWakeSource {
  return {
    subscribe(onWake) {
      let active = true;
      let unsubscribeListener: (() => Promise<void>) | undefined;

      void listener.listen(RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, () => {
        if (active) onWake();
      }).then((unsubscribe) => {
        if (!active) {
          void unsubscribe().catch(onError);
          return;
        }
        unsubscribeListener = unsubscribe;
      }).catch((error: unknown) => {
        if (active) onError(error);
      });

      return () => {
        active = false;
        const unsubscribe = unsubscribeListener;
        unsubscribeListener = undefined;
        if (unsubscribe) void unsubscribe().catch(onError);
      };
    },
  };
}


/**
 * Composition helper for an explicitly enabled server-side worker process.
 * Calling this function activates LISTEN; do not invoke from request handlers.
 */
export function startPostgresGitHubOwnerEventWorker(
  listener: RyanAiPostgresWakeListener,
  inbox: Pick<IntelligenceEventInbox, 'processNextForOwner'>,
  registry: EventHandlerRegistry,
  listAuthorizedOwnerUserIds: AuthorizedGitHubOwnerLister,
  options: GitHubOwnerEventWorkerOptions,
): () => void {
  const source = createPostgresGitHubOwnerEventWakeSource(
    listener,
    (error) => options.onError?.(error),
  );
  return startGitHubOwnerEventWorker(
    source,
    inbox,
    registry,
    listAuthorizedOwnerUserIds,
    options,
  );
}
