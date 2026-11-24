ALTER TABLE "public"."studio_artifacts"
  ADD COLUMN "idempotency_key" VARCHAR(240);

CREATE UNIQUE INDEX "studio_artifacts_idempotency_key_key"
  ON "public"."studio_artifacts"("idempotency_key");
