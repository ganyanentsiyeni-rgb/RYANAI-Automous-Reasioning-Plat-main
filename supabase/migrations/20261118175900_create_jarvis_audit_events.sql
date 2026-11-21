-- Bootstrap the Prisma-owned Jarvis audit ledger in the Supabase migration chain.
-- Prisma's separate migration creates the same table for Prisma-managed installs.
-- IF NOT EXISTS keeps this safe where that ledger was already provisioned.
CREATE TABLE IF NOT EXISTS public.jarvis_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jarvis_audit_events_created_at_idx
  ON public.jarvis_audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS jarvis_audit_events_actor_created_idx
  ON public.jarvis_audit_events (actor_id, created_at DESC);

COMMENT ON TABLE public.jarvis_audit_events
  IS 'Append-only Jarvis audit ledger; mutation guards are installed by the following migration.';
