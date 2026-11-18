-- Durable, provider-neutral event inbox. Application code owns retries and lease lifecycle.
-- This migration is additive and is not applied automatically by this PR.

CREATE TABLE IF NOT EXISTS public.intelligence_event_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE,
  event_type varchar(160) NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  occurred_at timestamptz NOT NULL,
  source_provider varchar(80) NOT NULL,
  source_service varchar(80),
  correlation_id varchar(160),
  idempotency_key varchar(200) NOT NULL,
  classification varchar(16) NOT NULL
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  payload jsonb NOT NULL,
  payload_hash char(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'processed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner varchar(128),
  lease_expires_at timestamptz,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intelligence_event_inbox_provider_idempotency_key
    UNIQUE (source_provider, idempotency_key)
);

CREATE INDEX IF NOT EXISTS intelligence_event_inbox_claim_idx
  ON public.intelligence_event_inbox (status, available_at, received_at);

CREATE INDEX IF NOT EXISTS intelligence_event_inbox_lease_idx
  ON public.intelligence_event_inbox (status, lease_expires_at);

CREATE INDEX IF NOT EXISTS intelligence_event_inbox_type_received_idx
  ON public.intelligence_event_inbox (event_type, received_at DESC);

-- No client-facing policies are created. Only the trusted server database role
-- should read or mutate the inbox; external providers must use authenticated adapters.
ALTER TABLE public.intelligence_event_inbox ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.intelligence_event_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_inbox_id uuid NOT NULL REFERENCES public.intelligence_event_inbox(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  worker_id varchar(128) NOT NULL,
  status varchar(24) NOT NULL
    CHECK (status IN ('started', 'succeeded', 'retry', 'dead_letter', 'lease_expired')),
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT intelligence_event_attempt_event_attempt_key UNIQUE (event_inbox_id, attempt)
);

CREATE INDEX IF NOT EXISTS intelligence_event_attempt_event_started_idx
  ON public.intelligence_event_attempts (event_inbox_id, started_at DESC);

CREATE INDEX IF NOT EXISTS intelligence_event_attempt_status_started_idx
  ON public.intelligence_event_attempts (status, started_at DESC);

ALTER TABLE public.intelligence_event_attempts ENABLE ROW LEVEL SECURITY;
