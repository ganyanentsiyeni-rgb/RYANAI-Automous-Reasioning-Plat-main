-- The Supabase migration chain is independent from Prisma's migration chain.
-- Create the ledger here as well so a fresh Supabase stack has the table before
-- the append-only triggers are installed.
CREATE TABLE IF NOT EXISTS public.jarvis_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  event_type text NOT NULL,
  resource_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jarvis_audit_events_created_at_idx
  ON public.jarvis_audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS jarvis_audit_events_actor_created_idx
  ON public.jarvis_audit_events (actor_id, created_at DESC);

ALTER TABLE public.jarvis_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.jarvis_audit_events FROM PUBLIC, anon, authenticated;

-- Make the existing audit ledger append-only at the database boundary.
-- This migration is prepared for review only; it has not been applied to any database.
CREATE OR REPLACE FUNCTION public.reject_jarvis_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'jarvis_audit_events is append-only; % is prohibited', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS jarvis_audit_events_no_row_mutation
  ON public.jarvis_audit_events;
CREATE TRIGGER jarvis_audit_events_no_row_mutation
  BEFORE UPDATE OR DELETE ON public.jarvis_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_jarvis_audit_event_mutation();

DROP TRIGGER IF EXISTS jarvis_audit_events_no_truncate
  ON public.jarvis_audit_events;
CREATE TRIGGER jarvis_audit_events_no_truncate
  BEFORE TRUNCATE ON public.jarvis_audit_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.reject_jarvis_audit_event_mutation();

REVOKE ALL ON FUNCTION public.reject_jarvis_audit_event_mutation() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.reject_jarvis_audit_event_mutation()
  IS 'Prevents UPDATE, DELETE and TRUNCATE against the append-only RyanAI audit ledger.';
