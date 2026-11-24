ALTER TABLE "public"."pa_delegations"
  ADD COLUMN "comms_run_id" TEXT;

CREATE UNIQUE INDEX "pa_delegations_comms_run_id_key"
  ON "public"."pa_delegations"("comms_run_id");

ALTER TABLE "public"."pa_delegations"
  ADD CONSTRAINT "pa_delegations_comms_run_id_fkey"
  FOREIGN KEY ("comms_run_id") REFERENCES "public"."agent_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
