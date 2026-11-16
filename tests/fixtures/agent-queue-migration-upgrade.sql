INSERT INTO public.users (id, email, password_hash, name, created_at, updated_at)
VALUES (
  'queue-migration-fixture-user',
  'queue-migration-fixture@example.invalid',
  NULL,
  'Disposable queue migration fixture',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.agent_runs (
  id, user_id, objective, status, approval_status, plan_snapshot, proposed_diff_hash
)
VALUES
  ('queue-migration-fixture-reasoning', 'queue-migration-fixture-user',
   'Approved reasoning run without workbench fields', 'queued', 'approved', NULL, NULL),
  ('queue-migration-fixture-pending', 'queue-migration-fixture-user',
   'Ordinary pending reasoning run without workbench fields', 'queued', 'pending', NULL, NULL),
  ('queue-migration-fixture-plan', 'queue-migration-fixture-user',
   'Plan-bound workbench run', 'queued', 'approved', '{"steps":["review"]}'::jsonb, NULL),
  ('queue-migration-fixture-pending-workbench', 'queue-migration-fixture-user',
   'Pending workbench run with explicit plan evidence', 'queued', 'pending', '{"steps":["review"]}'::jsonb, NULL),
  ('queue-migration-fixture-diff', 'queue-migration-fixture-user',
   'Diff-bound workbench run', 'queued', 'approved', NULL, 'fixture-diff-sha')
ON CONFLICT (id) DO NOTHING;
