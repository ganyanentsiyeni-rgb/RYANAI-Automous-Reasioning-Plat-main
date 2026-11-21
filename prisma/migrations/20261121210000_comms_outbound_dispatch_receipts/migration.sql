-- Outbound Comms dispatch state is separate from AgentRun execution state.
-- CommsDeliveryReceipt is append-only: callbacks insert a new event and never
-- mutate prior receipt rows or AgentRun state.
CREATE TABLE IF NOT EXISTS "public"."outbound_comms_dispatches" (
  "id" TEXT NOT NULL,
  "communication_message_id" TEXT NOT NULL,
  "agent_run_id" TEXT,
  "channel" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "state" TEXT NOT NULL DEFAULT 'reserved',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMPTZ,
  "uncertain_at" TIMESTAMPTZ,
  "reconciled_at" TIMESTAMPTZ,
  "reconciled_by" TEXT,
  "reconciliation_reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbound_comms_dispatches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbound_comms_dispatches_communication_message_id_key" UNIQUE ("communication_message_id"),
  CONSTRAINT "outbound_comms_dispatches_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "outbound_comms_dispatches_provider_message_id_key" UNIQUE ("provider_message_id"),
  CONSTRAINT "outbound_comms_dispatches_communication_message_id_fkey"
    FOREIGN KEY ("communication_message_id") REFERENCES "public"."communication_messages"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outbound_comms_dispatches_agent_run_id_fkey"
    FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "outbound_comms_dispatch_state_updated_idx"
  ON "public"."outbound_comms_dispatches" ("state", "updated_at");
CREATE INDEX IF NOT EXISTS "outbound_comms_dispatch_run_created_idx"
  ON "public"."outbound_comms_dispatches" ("agent_run_id", "created_at");
CREATE INDEX IF NOT EXISTS "outbound_comms_dispatch_provider_id_idx"
  ON "public"."outbound_comms_dispatches" ("provider_message_id");

CREATE TABLE IF NOT EXISTS "public"."comms_delivery_receipts" (
  "id" TEXT NOT NULL,
  "dispatch_id" TEXT NOT NULL,
  "communication_message_id" TEXT NOT NULL,
  "provider_message_id" TEXT NOT NULL,
  "provider_status" TEXT NOT NULL,
  "delivery_state" TEXT NOT NULL,
  "provider_event_key" TEXT NOT NULL,
  "provider_reference_hash" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comms_delivery_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "comms_delivery_receipts_provider_event_key_key" UNIQUE ("provider_event_key"),
  CONSTRAINT "comms_delivery_receipts_dispatch_id_fkey"
    FOREIGN KEY ("dispatch_id") REFERENCES "public"."outbound_comms_dispatches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "comms_delivery_receipts_communication_message_id_fkey"
    FOREIGN KEY ("communication_message_id") REFERENCES "public"."communication_messages"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "comms_delivery_receipts_dispatch_created_idx"
  ON "public"."comms_delivery_receipts" ("dispatch_id", "created_at");
CREATE INDEX IF NOT EXISTS "comms_delivery_receipts_provider_created_idx"
  ON "public"."comms_delivery_receipts" ("provider_message_id", "created_at");
CREATE INDEX IF NOT EXISTS "comms_delivery_receipts_message_created_idx"
  ON "public"."comms_delivery_receipts" ("communication_message_id", "created_at");
