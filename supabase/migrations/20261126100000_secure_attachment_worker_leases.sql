-- Close browser execution of privileged attachment worker RPCs and bind scan completion
-- to the exact claim generation. Apply before deploying the updated scanner worker.
ALTER TABLE public.ryanai_attachment_scans
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

DROP FUNCTION IF EXISTS public.claim_ryanai_attachment_scan();

CREATE FUNCTION public.claim_ryanai_attachment_scan()
RETURNS TABLE(bucket_id text, object_name text, attempt integer, lease_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT s.id
    FROM public.ryanai_attachment_scans AS s
    WHERE (
      s.status IN ('pending', 'failed')
      OR (
        s.status = 'scanning'
        AND COALESCE(s.lease_expires_at, s.updated_at + interval '5 minutes') <= now()
      )
    )
      AND s.attempts < 5
    ORDER BY s.created_at, s.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.ryanai_attachment_scans AS s
  SET status = 'scanning',
      attempts = s.attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '10 minutes',
      updated_at = now(),
      last_error = NULL
  FROM candidate AS c
  WHERE s.id = c.id
  RETURNING s.bucket_id, s.object_name, s.attempts, s.lease_token;
END;
$$;

DROP FUNCTION IF EXISTS public.finish_ryanai_attachment_scan(text, text, text, text);

CREATE FUNCTION public.finish_ryanai_attachment_scan(
  p_bucket_id text,
  p_object_name text,
  p_status text,
  p_error text,
  p_lease_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_status NOT IN ('clean', 'infected', 'failed') THEN
    RAISE EXCEPTION 'Invalid attachment scan result' USING ERRCODE = '22023';
  END IF;
  IF p_lease_token IS NULL THEN
    RAISE EXCEPTION 'Attachment scan lease token is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.ryanai_attachment_scans AS s
  SET status = p_status,
      last_error = CASE WHEN p_error IS NULL THEN NULL ELSE left(p_error, 500) END,
      updated_at = now(),
      scanned_at = CASE WHEN p_status IN ('clean', 'infected') THEN now() ELSE scanned_at END,
      lease_token = NULL,
      lease_expires_at = NULL
  WHERE s.bucket_id = p_bucket_id
    AND s.object_name = p_object_name
    AND s.status = 'scanning'
    AND s.lease_token = p_lease_token
    AND s.lease_expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attachment scan lease was lost or expired';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ryanai_attachment_scan() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_ryanai_attachment_scan(text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_ryanai_orphan_attachment_cleanup(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ryanai_attachment_scan() TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_ryanai_attachment_scan(text, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_ryanai_orphan_attachment_cleanup(timestamptz, integer) TO service_role;

-- Prevent future SECURITY DEFINER functions created by either migration role
-- from inheriting browser EXECUTE grants through role-specific default ACLs.
DO $
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres')
     AND pg_has_role(current_user, 'postgres', 'MEMBER') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin')
     AND pg_has_role(current_user, 'supabase_admin', 'MEMBER') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated';
  END IF;
END;
$;

COMMENT ON COLUMN public.ryanai_attachment_scans.lease_token IS
  'Per-claim generation token; only the worker holding this token may finish the scan.';
COMMENT ON COLUMN public.ryanai_attachment_scans.lease_expires_at IS
  'Expiry for the current scanner claim; expired claims can be reclaimed with a new token.';
