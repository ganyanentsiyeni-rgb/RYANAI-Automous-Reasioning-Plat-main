import type { RyanAiPostgresWakeListener } from '../lib/postgresGitHubWorkerWake.js';
import type { GitHubOwnerEventWakeSource } from './githubOwnerEventDispatcher.js';

/**
 * Dedicated PostgreSQL LISTEN channel for the owner-scoped intelligence inbox.
 * Notifications are deliberately treated as hints only: their payload is
 * ignored, and dispatch always reloads events using trusted owner context.
 */
export const RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL = 'ryanai_github_owner_events';

export type GitHubOwnerWakeErrorHandler = (error: unknown) => void;

/**
 * Adapts the existing dedicated-connection PostgreSQL listener contract to the
 * owner worker's synchronous subscribe/unsubscribe lifecycle. The listener
 * owns its connection; this adapter only owns the LISTEN subscription.
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
        // Do not parse or trust NOTIFY payloads; the durable inbox is authoritative.
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
