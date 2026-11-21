CREATE TABLE IF NOT EXISTS phonelink_pairings (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS phonelink_pairings_user_expiry_idx ON phonelink_pairings(user_id, expires_at);
CREATE TABLE IF NOT EXISTS phonelink_devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'paired' CHECK (status IN ('paired', 'revoked')),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS phonelink_devices_user_status_idx ON phonelink_devices(user_id, status);
ALTER TABLE phonelink_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE phonelink_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY phonelink_pairings_owner_select ON phonelink_pairings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY phonelink_devices_owner_all ON phonelink_devices FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS phonelink_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES phonelink_devices(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'acknowledged', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS phonelink_events_device_status_idx ON phonelink_events(device_id, status, created_at);
ALTER TABLE phonelink_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY phonelink_events_owner_all ON phonelink_events FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE phonelink_devices ADD COLUMN IF NOT EXISTS device_token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS phonelink_devices_device_token_hash_idx
  ON phonelink_devices(device_token_hash) WHERE device_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS phonelink_device_exchanges (
  id UUID PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES phonelink_devices(id) ON DELETE CASCADE,
  exchange_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS phonelink_device_exchanges_expiry_idx
  ON phonelink_device_exchanges(expires_at);
ALTER TABLE phonelink_device_exchanges ENABLE ROW LEVEL SECURITY;
CREATE POLICY phonelink_device_exchanges_owner_select ON phonelink_device_exchanges
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM phonelink_devices d
    WHERE d.id = phonelink_device_exchanges.device_id AND d.user_id = auth.uid()
  ));
