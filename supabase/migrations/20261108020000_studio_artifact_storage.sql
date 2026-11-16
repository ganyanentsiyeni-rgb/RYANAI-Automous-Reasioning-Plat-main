-- Private object storage for Studio execution artifacts.
-- Object key layout: <owner-user-id>/<project-id>/<task-id>/<opaque-id>-<filename>.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ryanai-studio-artifacts',
  'ryanai-studio-artifacts',
  false,
  26214400,
  ARRAY['application/json','text/plain','text/markdown']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "studio_artifacts_owner_read" ON storage.objects;
CREATE POLICY "studio_artifacts_owner_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'ryanai-studio-artifacts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "studio_artifacts_owner_insert" ON storage.objects;
CREATE POLICY "studio_artifacts_owner_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ryanai-studio-artifacts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "studio_artifacts_owner_update" ON storage.objects;
CREATE POLICY "studio_artifacts_owner_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'ryanai-studio-artifacts'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'ryanai-studio-artifacts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "studio_artifacts_owner_delete" ON storage.objects;
CREATE POLICY "studio_artifacts_owner_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'ryanai-studio-artifacts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
