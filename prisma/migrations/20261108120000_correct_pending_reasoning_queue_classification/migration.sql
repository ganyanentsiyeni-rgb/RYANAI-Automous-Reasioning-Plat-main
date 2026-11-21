-- Correct legacy queue rows that the original coding-queue migration
-- classified using approval_status alone. Approval is a gate, not evidence
-- that a run belongs in the coding workbench.
--
-- A run remains coding only when it has explicit workbench plan or diff data.
-- This migration is deliberately additive so previously recorded migration
-- checksums remain unchanged.
UPDATE public.agent_runs
SET queue_type = 'unclassified'
WHERE queue_type = 'coding'
  AND approval_status = 'pending'
  AND plan_snapshot IS NULL
  AND proposed_diff_hash IS NULL;
