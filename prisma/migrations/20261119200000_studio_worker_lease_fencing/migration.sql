ALTER TABLE "public"."studio_tasks"
  ADD COLUMN "lease_token" UUID;

-- Running leases created before fencing cannot be safely resumed: invalidate
-- them so the next worker obtains a fresh token and attempt generation.
UPDATE "public"."studio_tasks"
SET "status" = CASE WHEN "attempts" >= "max_attempts" THEN 'failed' ELSE 'queued' END,
    "lease_owner" = NULL,
    "lease_token" = NULL,
    "lease_expires_at" = NULL,
    "heartbeat_at" = NULL,
    "completed_at" = CASE WHEN "attempts" >= "max_attempts" THEN NOW() ELSE NULL END,
    "available_at" = CASE WHEN "attempts" >= "max_attempts" THEN NOW() ELSE "available_at" END
WHERE "status" = 'running';
