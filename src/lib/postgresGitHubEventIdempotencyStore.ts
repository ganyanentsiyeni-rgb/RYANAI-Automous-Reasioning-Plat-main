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
 * Durable, cross-process idempotency store.
 *
 * Requires public.github_event_idempotency(event_id TEXT PRIMARY KEY,
 * created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()) to exist. This change does
 * not create or apply that schema; provision it only through a separately
 * reviewed migration and explicit database approval.
 */
export function createPostgresRyanAiEventIdempotencyStore(
  query: RyanAiPostgresQuery,
): RyanAiEventIdempotencyStore {
  return {
    async claim(eventId) {
      const result = await query<{ event_id: string }>(
        `INSERT INTO public.github_event_idempotency (event_id)
         VALUES ($1)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId],
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
        `INSERT INTO public.github_event_idempotency (event_id)
         VALUES ($1)
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId],
      );
    },
    async forget(eventId) {
      await query(
        `DELETE FROM public.github_event_idempotency WHERE event_id = $1`,
        [eventId],
      );
    },
  };
}
