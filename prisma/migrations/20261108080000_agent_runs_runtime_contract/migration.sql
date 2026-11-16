-- Additive runtime-contract repair for public.agent_runs.
-- Legacy queued/unclassified work is quarantined before the reasoning worker can
-- claim it. Workbench rows already classified as coding remain in that queue.
-- Existing running rows with a worker ID and lock timestamp retain their
-- pre-migration reasoning approval so the existing lease heartbeat/reclaim
-- contract can finish or retry them. No new work is auto-approved by this rule.
-- This migration does NOT create coding_tasks or change the production allowlist.

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS trace_context JSONB,
  ADD COLUMN IF NOT EXISTS execution_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS plan_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS plan_hash TEXT,
  ADD COLUMN IF NOT EXISTS base_commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS proposed_diff_hash TEXT,
  ADD COLUMN IF NOT EXISTS approved_plan_hash TEXT,
  ADD COLUMN IF NOT EXISTS approved_commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS approved_diff_hash TEXT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS steering_notes TEXT,
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS queue_type TEXT NOT NULL DEFAULT 'reasoning';

-- ADD COLUMN defaults populate legacy rows. Preserve only a running row that
-- has both pieces of lease evidence written by claimNextAgentRun; the worker's
-- existing cancellation, plan-binding, attempt-limit and lease-expiry checks
-- remain authoritative. Everything else in the reasoning/default queue fails
-- closed and requires explicit classification/approval.
UPDATE public.agent_runs
SET approval_status = 'pending'
WHERE queue_type IS NULL
   OR (
     queue_type = 'reasoning'
     AND NOT (
       status = 'running'
       AND worker_id IS NOT NULL
       AND locked_at IS NOT NULL
     )
   )
   OR approval_status IS NULL;

UPDATE public.agent_runs
SET queue_type = 'unclassified'
WHERE queue_type IS NULL
   OR (
     queue_type = 'reasoning'
     AND NOT (
       status = 'running'
       AND worker_id IS NOT NULL
       AND locked_at IS NOT NULL
     )
   );

ALTER TABLE public.agent_runs
  ALTER COLUMN queue_type SET DEFAULT 'reasoning',
  ALTER COLUMN queue_type SET NOT NULL,
  ALTER COLUMN approval_status SET DEFAULT 'approved',
  ALTER COLUMN approval_status SET NOT NULL;

CREATE INDEX IF NOT EXISTS agent_runs_queue_type_status_created_idx
  ON public.agent_runs (queue_type, status, created_at);

CREATE INDEX IF NOT EXISTS agent_runs_approval_status_created_idx
  ON public.agent_runs (approval_status, created_at);
