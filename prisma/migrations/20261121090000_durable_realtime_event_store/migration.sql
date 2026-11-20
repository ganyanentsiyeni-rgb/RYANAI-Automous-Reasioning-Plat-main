CREATE TABLE "public"."realtime_channel_sequences" (
  "audience_type" VARCHAR(24) NOT NULL,
  "audience_id" VARCHAR(160) NOT NULL,
  "channel" VARCHAR(120) NOT NULL,
  "next_sequence" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "realtime_channel_sequences_pkey" PRIMARY KEY ("audience_type", "audience_id", "channel")
);

CREATE TABLE "public"."realtime_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "audience_type" VARCHAR(24) NOT NULL,
  "audience_id" VARCHAR(160) NOT NULL,
  "channel" VARCHAR(120) NOT NULL,
  "sequence" BIGINT NOT NULL,
  "event_type" VARCHAR(160) NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "realtime_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "realtime_events_audience_channel_sequence_key" UNIQUE ("audience_type", "audience_id", "channel", "sequence")
);

CREATE INDEX "realtime_events_replay_idx"
  ON "public"."realtime_events" ("audience_type", "audience_id", "channel", "expires_at", "sequence");
CREATE INDEX "realtime_events_retention_idx"
  ON "public"."realtime_events" ("expires_at");
