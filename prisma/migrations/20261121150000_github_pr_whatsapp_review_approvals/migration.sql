-- Durable one-time owner approval for a GitHub PR review.
-- This migration is additive and is not applied by this PR.
CREATE TABLE public.github_pr_review_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  repository_full_name VARCHAR(255) NOT NULL
    CHECK (repository_full_name = 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main'),
  pull_request_number INTEGER NOT NULL CHECK (pull_request_number > 0),
  expected_head_sha CHAR(40) NOT NULL
    CHECK (expected_head_sha ~ '^[0-9a-f]{40}$'),
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'submitting', 'submitted', 'expired', 'blocked')),
  expires_at TIMESTAMPTZ(6) NOT NULL,
  approved_at TIMESTAMPTZ(6),
  inbound_message_sid VARCHAR(128) UNIQUE,
  consumed_at TIMESTAMPTZ(6),
  github_review_id BIGINT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT github_pr_review_approvals_approval_state_check CHECK (
    (status IN ('pending', 'rejected', 'expired', 'blocked') AND consumed_at IS NULL)
    OR (status IN ('approved', 'submitting', 'submitted') AND approved_at IS NOT NULL)
  ),
  CONSTRAINT github_pr_review_approvals_submission_state_check CHECK (
    status <> 'submitted' OR (consumed_at IS NOT NULL AND github_review_id IS NOT NULL)
  )
);

CREATE INDEX github_pr_review_approvals_owner_status_expiry_idx
  ON public.github_pr_review_approvals (owner_user_id, status, expires_at);
CREATE INDEX github_pr_review_approvals_target_idx
  ON public.github_pr_review_approvals (repository_full_name, pull_request_number, expected_head_sha);

ALTER TABLE public.github_pr_review_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.github_pr_review_approvals FROM PUBLIC;
DO $github_review_approval_roles$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.github_pr_review_approvals FROM %I', role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.github_pr_review_approvals TO service_role;
  END IF;
END;
$github_review_approval_roles$;
