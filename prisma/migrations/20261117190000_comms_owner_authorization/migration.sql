-- Additive authorization records for owner-verified outbound communications.
-- This migration is intentionally not applied by this change or its CI workflow.

CREATE TABLE IF NOT EXISTS public.comms_verified_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('phone', 'email')),
  address text NOT NULL,
  normalized_address text NOT NULL,
  verified_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comms_verified_destinations_owner_channel_address_key
    UNIQUE (owner_user_id, channel, normalized_address)
);

CREATE INDEX IF NOT EXISTS comms_verified_destinations_owner_active_idx
  ON public.comms_verified_destinations (owner_user_id, channel, normalized_address);

CREATE TABLE IF NOT EXISTS public.comms_destination_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('phone', 'email')),
  address text NOT NULL,
  normalized_address text NOT NULL,
  provider_verification_sid text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comms_destination_challenges_owner_expiry_idx
  ON public.comms_destination_verification_challenges (owner_user_id, expires_at);

CREATE TABLE IF NOT EXISTS public.comms_send_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'voice', 'email')),
  recipient text NOT NULL,
  payload_hash char(64) NOT NULL,
  payload jsonb NOT NULL,
  policy_rule_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'dispatching', 'accepted', 'unknown', 'failed', 'rejected', 'expired')),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  dispatched_at timestamptz,
  provider_message_id text,
  provider_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comms_send_approvals_owner_status_expiry_idx
  ON public.comms_send_approvals (owner_user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS comms_send_approvals_provider_message_idx
  ON public.comms_send_approvals (provider_message_id);
