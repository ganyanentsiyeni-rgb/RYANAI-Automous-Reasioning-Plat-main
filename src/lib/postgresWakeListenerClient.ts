import type { RyanAiPostgresWakeListener } from './postgresGitHubWorkerWake.js';
import { RYANAI_GITHUB_WORKER_WAKE_CHANNELS } from './postgresGitHubWorkerWake.js';
import { RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL } from '../shared/events/githubOwnerEventChannels.js';

/** Structural subset of pg.Client; callers supply a dedicated, already-connected client. */
export interface RyanAiPgNotification {
  channel: string;
  payload?: string | null;
}

export interface RyanAiPgListenerClient {
  query(sql: string): Promise<unknown>;
  on(event: 'notification', listener: (message: RyanAiPgNotification) => void): unknown;
  off(event: 'notification', listener: (message: RyanAiPgNotification) => void): unknown;
  end?(): Promise<void>;
}

const ALLOWED_CHANNELS: ReadonlySet<string> = new Set([
  ...Object.values(RYANAI_GITHUB_WORKER_WAKE_CHANNELS),
  RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL,
]);

export interface RyanAiPgWakeListenerOptions {
  /** Close the supplied dedicated client after its last subscription is removed. Defaults false. */
  closeClientOnStop?: boolean;
  onError?: (error: unknown) => void;
}

/**
 * Concrete pg.Client adapter for the existing wake-listener contract.
 * Channel names are allow-listed constants (PostgreSQL cannot parameterize LISTEN identifiers).
 * Notification payloads are forwarded as opaque strings; consumers must reload durable state.
 */
export function createRyanAiPostgresWakeListener(
  client: RyanAiPgListenerClient,
  options: RyanAiPgWakeListenerOptions = {},
): RyanAiPostgresWakeListener {
  const onError = options.onError ?? (() => undefined);

  return {
    async listen(channel, onNotification) {
      if (!ALLOWED_CHANNELS.has(channel)) {
        throw new Error('Unsupported RyanAI PostgreSQL wake channel.');
      }

      const handleNotification = (message: RyanAiPgNotification) => {
        if (message.channel !== channel) return;
        try {
          const result = onNotification(message.payload ?? '');
          if (result && typeof result.then === 'function') {
            void result.catch(onError);
          }
        } catch (error) {
          onError(error);
        }
      };

      // Register before LISTEN so a notification cannot arrive in the setup gap.
      client.on('notification', handleNotification);
      try {
        await client.query(`LISTEN "${channel}"`);
      } catch (error) {
        client.off('notification', handleNotification);
        throw error;
      }

      let stopped = false;
      return async () => {
        if (stopped) return;
        stopped = true;
        client.off('notification', handleNotification);
        try {
          await client.query(`UNLISTEN "${channel}"`);
        } finally {
          if (options.closeClientOnStop) await client.end?.();
        }
      };
    },
  };
}
