-- Fail-closed AgentRun approval repair.
-- New AgentRuns must not become executable merely because the database default
-- supplies a value. Explicit approval metadata is required before queue claim.
ALTER TABLE public.agent_runs
  ALTER COLUMN approval_status SET DEFAULT 'pending';

UPDATE public.agent_runs
SET approval_status = 'pending'
WHERE status = 'queued'
  AND queue_type = 'reasoning'
  AND approval_status = 'approved'
  AND approved_by IS NULL
  AND approved_at IS NULL;
