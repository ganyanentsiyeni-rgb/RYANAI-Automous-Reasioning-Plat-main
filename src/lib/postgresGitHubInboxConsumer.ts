import type { RyanAiPostgresQuery } from "./postgresGitHubEventIdempotencyStore";
import type {
  RyanAiWorkerWakeHandler,
  RyanAiWorkerWakeSignal,
  RyanAiWorkerWakeTarget,
} from "./githubEventRouter";

export interface RyanAiDurableGitHubInboxEvent {
  id: string;
  event_id: string;
  event_type: string;
  occurred_at: string;
  payload: {
    id: string;
    type: string;
    target: RyanAiWorkerWakeTarget;
    repository: string;
    occurredAt: string;
    payload: unknown;
  };
  attempts: number;
  max_attempts: number;
}

export interface RyanAiGitHubInboxConsumer {
  claimNext(target: RyanAiWorkerWakeTarget, workerId: string): Promise<RyanAiDurableGitHubInboxEvent | null>;
  complete(eventInboxId: string, workerId: string): Promise<boolean>;
  fail(eventInboxId: string, workerId: string, error: unknown): Promise<"retry" | "dead_letter" | "lease_lost">;
  recoverExpired(target?: RyanAiWorkerWakeTarget): Promise<number>;
}

const allowedTargets = new Set<RyanAiWorkerWakeTarget>(["ci", "review", "pull-request", "repository"]);

function validateWorkerId(workerId: string): void {
  if (!workerId.trim() || workerId.length > 128) {
    throw new Error("workerId must contain 1 to 128 characters.");
  }
}

function validateLeaseMs(leaseMs: number): void {
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 3_600_000) {
    throw new Error("leaseMs must be an integer between 1000 and 3600000.");
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 8_000);
}

/**
 * Atomic inbox lifecycle for the existing intelligence_event_inbox schema.
 * Every state transition is a single parameterized PostgreSQL statement.
 * The injected query must use a trusted server connection with inbox access.
 */
export function createPostgresRyanAiGitHubInboxConsumer(
  query: RyanAiPostgresQuery,
  options: { leaseMs?: number; retryBaseMs?: number; retryMaxMs?: number } = {},
): RyanAiGitHubInboxConsumer {
  const leaseMs = options.leaseMs ?? 60_000;
  const retryBaseMs = options.retryBaseMs ?? 5_000;
  const retryMaxMs = options.retryMaxMs ?? 300_000;
  validateLeaseMs(leaseMs);
  if (!Number.isInteger(retryBaseMs) || retryBaseMs < 100 || retryBaseMs > 3_600_000) {
    throw new Error("retryBaseMs must be an integer between 100 and 3600000.");
  }
  if (!Number.isInteger(retryMaxMs) || retryMaxMs < retryBaseMs || retryMaxMs > 86_400_000) {
    throw new Error("retryMaxMs must be at least retryBaseMs and no more than 86400000.");
  }

  return {
    async claimNext(target, workerId) {
      if (!allowedTargets.has(target)) throw new Error("Unsupported GitHub worker target.");
      validateWorkerId(workerId);
      const result = await query<RyanAiDurableGitHubInboxEvent>(
        `WITH candidate AS (
           SELECT id
           FROM public.intelligence_event_inbox
           WHERE (
             (status IN ('pending', 'retry') AND available_at <= NOW())
             OR (status = 'processing' AND lease_expires_at <= NOW())
           )
             AND source_provider = 'github'
             AND source_service = 'event-streams'
             AND payload->>'target' = $1
             AND attempts < max_attempts
           ORDER BY available_at ASC, received_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         ), claimed AS (
           UPDATE public.intelligence_event_inbox AS inbox
           SET status = 'processing',
               attempts = inbox.attempts + 1,
               lease_owner = $2,
               lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
               updated_at = NOW()
           FROM candidate
           WHERE inbox.id = candidate.id
           RETURNING inbox.id, inbox.event_id, inbox.event_type, inbox.occurred_at,
                     inbox.payload, inbox.attempts, inbox.max_attempts
         ), attempt_started AS (
           INSERT INTO public.intelligence_event_attempts
             (event_inbox_id, attempt, worker_id, status)
           SELECT id, attempts, $2, 'started' FROM claimed
           RETURNING event_inbox_id
         )
         SELECT claimed.*
         FROM claimed
         INNER JOIN attempt_started ON attempt_started.event_inbox_id = claimed.id`,
        [target, workerId, leaseMs],
      );
      return result.rows[0] ?? null;
    },

    async complete(eventInboxId, workerId) {
      validateWorkerId(workerId);
      const result = await query<{ id: string }>(
        `WITH completed AS (
           UPDATE public.intelligence_event_inbox
           SET status = 'processed',
               processed_at = NOW(),
               lease_owner = NULL,
               lease_expires_at = NULL,
               last_error = NULL,
               updated_at = NOW()
           WHERE id = $1::uuid
             AND status = 'processing'
             AND lease_owner = $2
             AND lease_expires_at > NOW()
           RETURNING id, attempts
         ), attempt_done AS (
           UPDATE public.intelligence_event_attempts AS attempt
           SET status = 'succeeded', finished_at = NOW(), error = NULL
           FROM completed
           WHERE attempt.event_inbox_id = completed.id
             AND attempt.attempt = completed.attempts
             AND attempt.worker_id = $2
             AND attempt.status = 'started'
           RETURNING attempt.event_inbox_id
         )
         SELECT completed.id FROM completed
         INNER JOIN attempt_done ON attempt_done.event_inbox_id = completed.id`,
        [eventInboxId, workerId],
      );
      return result.rows.length === 1;
    },

    async fail(eventInboxId, workerId, error) {
      validateWorkerId(workerId);
      const result = await query<{ outcome: "retry" | "dead_letter" }>(
        `WITH failed AS (
           UPDATE public.intelligence_event_inbox
           SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'retry' END,
               available_at = CASE
                 WHEN attempts >= max_attempts THEN available_at
                 ELSE NOW() + (LEAST($3::integer * POWER(2, GREATEST(attempts - 1, 0)), $4::integer) * INTERVAL '1 millisecond')
               END,
               lease_owner = NULL,
               lease_expires_at = NULL,
               last_error = $5,
               updated_at = NOW()
           WHERE id = $1::uuid
             AND status = 'processing'
             AND lease_owner = $2
             AND lease_expires_at > NOW()
           RETURNING id, attempts, status
         ), attempt_done AS (
           UPDATE public.intelligence_event_attempts AS attempt
           SET status = failed.status, finished_at = NOW(), error = $5
           FROM failed
           WHERE attempt.event_inbox_id = failed.id
             AND attempt.attempt = failed.attempts
             AND attempt.worker_id = $2
             AND attempt.status = 'started'
           RETURNING attempt.event_inbox_id
         )
         SELECT failed.status AS outcome FROM failed
         INNER JOIN attempt_done ON attempt_done.event_inbox_id = failed.id`,
        [eventInboxId, workerId, retryBaseMs, retryMaxMs, errorMessage(error)],
      );
      return result.rows[0]?.outcome ?? "lease_lost";
    },

    async recoverExpired(target) {
      if (target !== undefined && !allowedTargets.has(target)) {
        throw new Error("Unsupported GitHub worker target.");
      }
      const result = await query<{ id: string }>(
        `WITH expired AS (
           UPDATE public.intelligence_event_inbox
           SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'retry' END,
               available_at = CASE
                 WHEN attempts >= max_attempts THEN available_at
                 ELSE NOW() + ($2 * INTERVAL '1 millisecond')
               END,
               lease_owner = NULL,
               lease_expires_at = NULL,
               last_error = COALESCE(last_error, 'Worker lease expired before completion.'),
               updated_at = NOW()
           WHERE status = 'processing'
             AND lease_expires_at <= NOW()
             AND source_provider = 'github'
             AND source_service = 'event-streams'
             AND ($1::text IS NULL OR payload->>'target' = $1)
           RETURNING id, attempts, lease_owner, status
         ), attempt_done AS (
           UPDATE public.intelligence_event_attempts AS attempt
           SET status = 'lease_expired',
               finished_at = NOW(),
               error = 'Worker lease expired before completion.'
           FROM expired
           WHERE attempt.event_inbox_id = expired.id
             AND attempt.attempt = expired.attempts
             AND attempt.worker_id = expired.lease_owner
             AND attempt.status = 'started'
           RETURNING attempt.event_inbox_id
         )
         SELECT expired.id FROM expired`,
        [target ?? null, retryBaseMs],
      );
      return result.rows.length;
    },
  };
}

export type RyanAiGitHubInboxProcessResult =
  | { status: "empty" }
  | { status: "processed"; eventId: string }
  | { status: "retry" | "dead_letter"; eventId: string; error: string }
  | { status: "lease_lost"; eventId: string };

/** Claims and dispatches one durable event; handlers are explicitly injected. */
export async function processNextRyanAiGitHubInboxEvent(
  consumer: RyanAiGitHubInboxConsumer,
  target: RyanAiWorkerWakeTarget,
  workerId: string,
  handlers: Partial<Record<RyanAiWorkerWakeTarget, RyanAiWorkerWakeHandler>>,
): Promise<RyanAiGitHubInboxProcessResult> {
  const event = await consumer.claimNext(target, workerId);
  if (!event) return { status: "empty" };
  const eventId = event.payload?.id ?? event.event_id;
  const handler = handlers[target];
  if (!handler) {
    const error = new Error(`No handler registered for GitHub worker target: ${target}`);
    const status = await consumer.fail(event.id, workerId, error);
    return status === "lease_lost"
      ? { status, eventId }
      : { status, eventId, error: error.message };
  }

  const signal: RyanAiWorkerWakeSignal = {
    eventId,
    target,
    eventType: event.event_type as RyanAiWorkerWakeSignal["eventType"],
    repository: event.payload.repository,
    occurredAt: event.occurred_at,
    payload: event.payload.payload,
  };
  try {
    await handler(signal);
  } catch (error) {
    const message = errorMessage(error);
    const status = await consumer.fail(event.id, workerId, error);
    return status === "lease_lost"
      ? { status, eventId }
      : { status, eventId, error: message };
  }

  if (!(await consumer.complete(event.id, workerId))) {
    return { status: "lease_lost", eventId };
  }
  return { status: "processed", eventId };
}
