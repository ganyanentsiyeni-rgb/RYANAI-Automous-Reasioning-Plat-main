CREATE TABLE IF NOT EXISTS public.account_lifecycle_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type VARCHAR(32) NOT NULL CHECK (request_type IN ('role_change', 'account_suspension', 'session_revocation')),
  target_user_id UUID NOT NULL,
  requested_role VARCHAR(16) NULL CHECK (requested_role IS NULL OR requested_role IN ('user', 'admin')),
  reason VARCHAR(1000) NOT NULL CHECK (length(trim(reason)) > 0),
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending')),
  policy_decision VARCHAR(24) NOT NULL CHECK (policy_decision IN ('REQUIRE_APPROVAL', 'ALLOW')),
  policy_rule_id VARCHAR(64) NOT NULL,
  created_by UUID NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT account_lifecycle_role_shape CHECK (
    (request_type = 'role_change' AND requested_role IS NOT NULL) OR
    (request_type <> 'role_change' AND requested_role IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS account_lifecycle_requests_status_created_idx
  ON public.account_lifecycle_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS account_lifecycle_requests_target_created_idx
  ON public.account_lifecycle_requests (target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.account_lifecycle_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.account_lifecycle_requests(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS account_lifecycle_audit_request_created_idx
  ON public.account_lifecycle_audit_events (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_lifecycle_audit_actor_created_idx
  ON public.account_lifecycle_audit_events (actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reject_account_lifecycle_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'account lifecycle audit events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS account_lifecycle_audit_no_update_delete
  ON public.account_lifecycle_audit_events;
CREATE TRIGGER account_lifecycle_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON public.account_lifecycle_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_account_lifecycle_audit_mutation();

-- Requests are also append-only in this increment. Future decision/execution
-- state belongs in a separate event-driven workflow, not in-place mutation.
DROP TRIGGER IF EXISTS account_lifecycle_requests_no_update_delete
  ON public.account_lifecycle_requests;
CREATE TRIGGER account_lifecycle_requests_no_update_delete
  BEFORE UPDATE OR DELETE ON public.account_lifecycle_requests
  FOR EACH ROW EXECUTE FUNCTION public.reject_account_lifecycle_audit_mutation();
