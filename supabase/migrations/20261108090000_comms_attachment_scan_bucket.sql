-- Provision the private Comms attachment bucket and enqueue its objects
-- through the same durable malware-scan queue used by general attachments.
-- No public read policy is created; clean-only downloads remain application-gated.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ryanai-comms-attachments',
  'ryanai-comms-attachments',
  false,
  20971520,
  ARRAY[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4',
    'application/pdf', 'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/markdown', 'text/csv', 'application/json',
    'application/xml', 'text/javascript', 'text/typescript',
    'text/x-python', 'text/x-go', 'text/x-rust', 'text/x-java', 'text/css'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.enqueue_ryanai_attachment_scan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner text;
BEGIN
  IF NEW.bucket_id NOT IN ('ryanai-attachments', 'ryanai-comms-attachments') THEN
    RETURN NEW;
  END IF;

  v_owner := split_part(NEW.name, '/', 1);
  IF v_owner !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid attachment owner path' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ryanai_attachment_scans (bucket_id, object_name, user_id)
  VALUES (NEW.bucket_id, NEW.name, v_owner::uuid)
  ON CONFLICT (bucket_id, object_name) DO UPDATE
    SET status = 'pending',
        attempts = 0,
        last_error = NULL,
        updated_at = now(),
        scanned_at = NULL;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_ryanai_attachment_scan() FROM PUBLIC, anon, authenticated;
