-- Preserve the original durable event-store migration checksum.
-- Prisma owns @updatedAt and @default(uuid()) at the client layer, so these
-- columns must not retain database defaults that create schema drift.
ALTER TABLE "public"."realtime_channel_sequences"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "public"."realtime_events"
  ALTER COLUMN "id" DROP DEFAULT;
