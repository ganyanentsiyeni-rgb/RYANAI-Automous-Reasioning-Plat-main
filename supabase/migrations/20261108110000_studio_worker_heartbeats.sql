-- Independently observable liveness for dedicated Studio worker processes.
CREATE TABLE IF NOT EXISTS public.studio_worker_heartbeats (
  worker_id varchar(160) PRIMARY KEY,
  status varchar(24) NOT NULL DEFAULT 'starting'
    CHECK (status IN ('starting', 'healthy', 'stopped')),
  started_at timestamptz(6) NOT NULL DEFAULT now(),
  last_seen_at timestamptz(6) NOT NULL DEFAULT now(),
  stopped_at timestamptz(6),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS studio_worker_heartbeats_status_seen_idx
  ON public.studio_worker_heartbeats (status, last_seen_at DESC);

ALTER TABLE public.studio_worker_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.studio_worker_heartbeats FROM PUBLIC, anon, authenticated;
