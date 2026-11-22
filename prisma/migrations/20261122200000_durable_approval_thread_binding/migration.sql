-- Durable human-approval binding for LangGraph interrupt threads.
-- Approval must be tied to the authenticated administrator and the exact thread.
ALTER TABLE public.pending_actions
  ADD COLUMN IF NOT EXISTS thread_id TEXT;

CREATE INDEX IF NOT EXISTS pending_actions_thread_lookup_idx
  ON public.pending_actions (user_id, thread_id, status, created_at DESC);

UPDATE public.pending_actions
SET thread_id = COALESCE(thread_id, 'legacy:' || id::text)
WHERE thread_id IS NULL;

ALTER TABLE public.pending_actions
  ALTER COLUMN thread_id SET NOT NULL;
