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

COMMENT ON FUNCTION public.reject_jarvis_audit_event_mutation()
  IS 'Prevents UPDATE, DELETE and TRUNCATE against the append-only RyanAI audit ledger.';
