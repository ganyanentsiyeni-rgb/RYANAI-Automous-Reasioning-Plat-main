-- Anonymous RyanAI community feedback. No account or contact-data linkage.
CREATE TABLE IF NOT EXISTS public.community_feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  answers jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_feedback_submissions_created_at_idx
  ON public.community_feedback_submissions (created_at DESC);

-- Beta contact details are stored separately and only after explicit consent.
CREATE TABLE IF NOT EXISTS public.community_beta_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text NOT NULL,
  consent boolean NOT NULL DEFAULT false CHECK (consent = true),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_beta_interest_created_at_idx
  ON public.community_beta_interest (created_at DESC);

REVOKE ALL ON TABLE public.community_feedback_submissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.community_beta_interest FROM PUBLIC, anon, authenticated;
