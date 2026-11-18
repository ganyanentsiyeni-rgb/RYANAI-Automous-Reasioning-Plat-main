-- Backfill profiles for Auth users that predate the profile trigger.
-- Idempotent: existing profile rows are preserved.
INSERT INTO public.profiles (id, email, full_name, avatar_url)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
  u.raw_user_meta_data->>'avatar_url'
FROM auth.users AS u
ON CONFLICT (id) DO NOTHING;

-- Pin the append-only Jarvis audit guard to a deterministic search_path.
CREATE OR REPLACE FUNCTION public.reject_jarvis_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'jarvis_audit_events is append-only; % is prohibited', TG_OP
    USING ERRCODE = '55000';
END;
$$;
