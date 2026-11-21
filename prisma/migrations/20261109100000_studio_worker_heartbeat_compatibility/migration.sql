-- Prisma-only compatibility contract for the Supabase-owned Studio worker heartbeat table.
-- The Supabase migration remains the owner of RLS/browser policies; this migration
-- only provisions the table for disposable Prisma validation installs.
CREATE TABLE IF NOT EXISTS public.studio_worker_heartbeats (
  worker_id VARCHAR(160) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'starting',
  started_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stopped_at TIMESTAMPTZ(6),
  metadata JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT studio_worker_heartbeats_pkey PRIMARY KEY (worker_id)
);

CREATE INDEX IF NOT EXISTS studio_worker_heartbeats_status_seen_idx
  ON public.studio_worker_heartbeats (status, last_seen_at DESC);
