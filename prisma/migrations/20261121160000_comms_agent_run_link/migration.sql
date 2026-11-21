-- Link each inbound communication event to at most one durable agent run.
-- Nullable and SET NULL preserve communication history if a run is later removed.
ALTER TABLE "public"."communication_messages"
  ADD COLUMN "agent_run_id" TEXT;

CREATE UNIQUE INDEX "communication_messages_agent_run_id_key"
  ON "public"."communication_messages"("agent_run_id");

ALTER TABLE "public"."communication_messages"
  ADD CONSTRAINT "communication_messages_agent_run_id_fkey"
  FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
