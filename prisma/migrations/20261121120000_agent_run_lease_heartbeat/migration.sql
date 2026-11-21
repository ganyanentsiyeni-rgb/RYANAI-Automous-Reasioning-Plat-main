-- Add explicit lease deadlines and liveness timestamps to both durable worker queues.
-- This migration assumes the existing agent_runs and coding_tasks base migrations
-- have been applied. It intentionally fails if either base table is absent: reconcile
-- prisma/migrations and _prisma_migrations instead of silently manufacturing schema drift.

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMP(3);

ALTER TABLE public.coding_tasks
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ(6);

-- Preserve currently running work by translating the legacy three-minute locked_at
-- timeout into an explicit expiry. Keep locked_at as the original claim timestamp.
UPDATE public.agent_runs
SET lease_expires_at = COALESCE(locked_at + INTERVAL '3 minutes', NOW()),
    heartbeat_at = COALESCE(heartbeat_at, locked_at, NOW())
WHERE status = 'running'
SET lease_expires_at = locked_at + INTERVAL '3 minutes',
    heartbeat_at = COALESCE(heartbeat_at, locked_at)
WHERE status = 'running'
  AND locked_at IS NOT NULL
  AND lease_expires_at IS NULL;

UPDATE public.coding_tasks
SET heartbeat_at = COALESCE(heartbeat_at, locked_at)
WHERE locked_at IS NOT NULL
  AND heartbeat_at IS NULL;

CREATE INDEX IF NOT EXISTS agent_runs_status_next_attempt_lease_idx
  ON public.agent_runs (status, next_attempt_at, lease_expires_at);

CREATE INDEX IF NOT EXISTS agent_runs_worker_lease_idx
  ON public.agent_runs (worker_id, lease_expires_at);

CREATE INDEX IF NOT EXISTS coding_tasks_status_lease_expiry_idx
  ON public.coding_tasks (status, lease_expires_at);
