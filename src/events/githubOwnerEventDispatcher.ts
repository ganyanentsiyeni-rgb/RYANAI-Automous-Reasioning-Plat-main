import type { RyanAIEventEnvelope } from './eventContract.js';
import { EventHandlerRegistry } from './eventHandlerRegistry.js';
import type { IntelligenceEventInbox } from './intelligenceEventInbox.js';

export type AuthorizedGitHubOwnerLister = () => Promise<readonly string[]>;

export interface GitHubOwnerDispatchResult {
  ownerUserId: string;
  status: string;
  eventId?: string;
}

/**
 * Performs one owner-scoped dispatch sweep. The owner list must come from a
 * trusted server-side query over authenticated RyanAI GitHub connections;
 * webhook/event payloads must never supply this list.
 *
 * This is intentionally a single-sweep primitive so a PostgreSQL NOTIFY
 * listener or a future GitHub Event Streams adapter can wake it without
 * introducing another polling loop.
 */
export async function dispatchNextGitHubEventForAuthorizedOwners(
  inbox: Pick<IntelligenceEventInbox, 'processNextForOwner'>,
  registry: EventHandlerRegistry,
  listAuthorizedOwnerUserIds: AuthorizedGitHubOwnerLister,
  workerId: string,
  now = new Date(),
): Promise<GitHubOwnerDispatchResult[]> {
  const worker = workerId.trim();
  if (!worker || worker.length > 128) throw new RangeError('workerId must contain 1-128 characters.');

  const eventTypes = registry.supportedEventTypes().filter((type) => type.startsWith('github.'));
  if (eventTypes.length === 0) return [];

  const owners = await listAuthorizedOwnerUserIds();
  const uniqueOwners = [...new Set(owners
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 128))];

  const results: GitHubOwnerDispatchResult[] = [];
  for (const ownerUserId of uniqueOwners) {
    const handler = async (event: RyanAIEventEnvelope) => {
      const payloadOwner = event.payload.owner as Record<string, unknown> | undefined;
      if (event.source.provider !== 'github'
        || event.source.service !== 'event-streams'
        || payloadOwner?.userId !== ownerUserId) {
        throw new Error('GitHub event does not match the authorized owner dispatch context.');
      }
      await registry.dispatch(event);
    };

    const result = await inbox.processNextForOwner(
      worker,
      ownerUserId,
      handler,
      now,
      eventTypes,
    );
    results.push({
      ownerUserId,
      status: result.status,
      ...('eventId' in result && result.eventId ? { eventId: result.eventId } : {}),
    });
  }
  return results;
}
