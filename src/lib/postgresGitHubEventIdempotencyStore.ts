import type { RyanAiEventIdempotencyStore } from "./githubEventRouter";

/**
 * Minimal parameterized PostgreSQL query contract. Adapt a Prisma/pg client
 * at the composition root; this module never opens connections or reads env.
 */
export interface RyanAiPostgresQueryResult<Row> {
  rows: Row[];
}

export type RyanAiPostgresQuery = <Row = Record<string, unknown>>(
  sql: string,
  parameters?: readonly unknown[],
) => Promise<RyanAiPostgresQueryResult<Row>>;

/**
 * Durable lease-based event idempotency.
 *
 * Requires public.github_event_idempotency with:
 * event_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'processing',
 * lease_expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 * completed_at TIMESTAMPTZ NULL.
 *
 * The schema is intentionally not created or applied here. A separately
 * reviewed migration and explicit database approval are required.
 */
export function createPostgresRyanAiEventIdempotencyStore(
  query: RyanAiPostgresQuery,
  options: { leaseMs?: number } = {},
): RyanAiEventIdempotencyStore {
  const leaseMs = options.leaseMs ?? 60_000;
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 3_600_000) {
    throw new Error("leaseMs must be an integer between 1000 and 3600000.");
  }

  return {
    async claim(eventId) {
      const result = await query<{ event_id: string }>(
        `INSERT INTO public.github_event_idempotency
           (event_id, status, lease_expires_at)
         VALUES ($1, 'processing', NOW() + ($2 * INTERVAL '1 millisecond'))
         ON CONFLICT (event_id) DO UPDATE
           SET status = 'processing',
               lease_expires_at = EXCLUDED.lease_expires_at,
               completed_at = NULL
         WHERE github_event_idempotency.status <> 'completed'
           AND github_event_idempotency.lease_expires_at <= NOW()
         RETURNING event_id`,
        [eventId, leaseMs],
      );
      return result.rows.length === 1;
    },
    async has(eventId) {
      const result = await query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM public.github_event_idempotency
           WHERE event_id = $1
         ) AS present`,
        [eventId],
      );
      return result.rows[0]?.present === true;
    },
    async remember(eventId) {
      await query(
        `UPDATE public.github_event_idempotency
         SET status = 'completed', completed_at = NOW()
         WHERE event_id = $1 AND status = 'processing'`,
        [eventId],
      );
    },
    async forget(eventId) {
      await query(
        `DELETE FROM public.github_event_idempotency
         WHERE event_id = $1 AND status = 'processing'`,
        [eventId],
      );
    },
  };
}
