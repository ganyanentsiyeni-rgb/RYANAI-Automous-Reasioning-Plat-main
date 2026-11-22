-- RyanAI U2EB staging Prisma schema bootstrap.
-- Mirrors the ordered Prisma migrations after the Supabase platform migrations.
-- Each original checksum is recorded so future Prisma migrate deploy runs are idempotent.
CREATE TABLE IF NOT EXISTS public."_prisma_migrations" (
  "id" VARCHAR(36) NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "_prisma_migrations_migration_name_key"
  ON public."_prisma_migrations" ("migration_name");


-- BEGIN PRISMA MIGRATION 20261014000000_supabase_platform_baseline
-- No-op baseline marker for the Supabase platform schema.
--
-- The Supabase CLI migration chain runs first in the combined local stack and
-- creates Supabase-owned Auth, Storage, RLS, and platform tables. Prisma then
-- owns the RyanAI application migration sequence. This marker initializes the
-- Prisma ledger without pretending that Prisma created the Supabase objects.
-- It must be recorded as applied after `supabase db reset --local` and before
-- the first Prisma application migration. It contains no schema DDL.
SELECT 1;

-- END PRISMA MIGRATION 20261014000000_supabase_platform_baseline
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'aac76b7e9999d6844fc0cd6dd211bdbc5c572c2b4d8c29aabcbf123b997ae618',now(),'20261014000000_supabase_platform_baseline',now(),0);

-- BEGIN PRISMA MIGRATION 20261015081513_init_reasoning_platform
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('IDLE', 'RUNNING', 'COMPLETED', 'FAILED', 'PAUSED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New Reasoning Session',
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "content" TEXT NOT NULL,
    "reasoning" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" TEXT NOT NULL,
    "operator" TEXT NOT NULL DEFAULT 'Ntsiyeni Ganyane',
    "active_graph" TEXT NOT NULL DEFAULT 'ReAct-v2.1',
    "cuda_active" BOOLEAN NOT NULL DEFAULT true,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "content" TEXT NOT NULL,
    "reasoning_steps" TEXT NOT NULL,
    "latency_ms" INTEGER NOT NULL DEFAULT 14,
    "timestamp" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_instances" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AgentStatus" NOT NULL DEFAULT 'IDLE',
    "user_id" TEXT NOT NULL,
    "config" JSONB,
    "last_active" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_vault" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "tags" TEXT[],
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_vault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_telemetry" (
    "id" TEXT NOT NULL,
    "cpu_usage" DOUBLE PRECISION,
    "memory_usage" DOUBLE PRECISION,
    "active_nodes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'healthy',
    "payload" JSONB,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "session_messages_session_id_idx" ON "session_messages"("session_id");

-- CreateIndex
CREATE INDEX "agent_sessions_created_at_idx" ON "agent_sessions"("created_at");

-- CreateIndex
CREATE INDEX "agent_sessions_user_id_idx" ON "agent_sessions"("user_id");

-- CreateIndex
CREATE INDEX "agent_messages_session_id_idx" ON "agent_messages"("session_id");

-- CreateIndex
CREATE INDEX "agent_instances_user_id_idx" ON "agent_instances"("user_id");

-- CreateIndex
CREATE INDEX "memory_vault_user_id_idx" ON "memory_vault"("user_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_instances" ADD CONSTRAINT "agent_instances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_vault" ADD CONSTRAINT "memory_vault_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- END PRISMA MIGRATION 20261015081513_init_reasoning_platform
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'c587e81f517e2ae2c7dafe91da59557fd93d8f93f6d51aa9140404de94554f6f',now(),'20261015081513_init_reasoning_platform',now(),1);

-- BEGIN PRISMA MIGRATION 20261030120000_agent_operations
CREATE TABLE "agent_runs" ("id" TEXT NOT NULL,"user_id" TEXT NOT NULL,"objective" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'queued',"result" JSONB,"error" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"completed_at" TIMESTAMP(3),CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id"));
CREATE TABLE "agent_handoffs" ("id" TEXT NOT NULL,"run_id" TEXT NOT NULL,"from_agent" TEXT NOT NULL,"to_agent" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'pending',"input" TEXT NOT NULL,"output" TEXT,"error" TEXT,"started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"completed_at" TIMESTAMP(3),CONSTRAINT "agent_handoffs_pkey" PRIMARY KEY ("id"));
CREATE TABLE "agent_brain_health" ("id" TEXT NOT NULL,"brain" TEXT NOT NULL,"model" TEXT NOT NULL,"status" TEXT NOT NULL,"latency_ms" INTEGER,"last_success_at" TIMESTAMP(3),"last_error" TEXT,"checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "agent_brain_health_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "agent_brain_health_brain_key" ON "agent_brain_health"("brain");
CREATE INDEX "agent_runs_user_id_created_at_idx" ON "agent_runs"("user_id","created_at");
CREATE INDEX "agent_runs_status_created_at_idx" ON "agent_runs"("status","created_at");
CREATE INDEX "agent_handoffs_run_id_started_at_idx" ON "agent_handoffs"("run_id","started_at");
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_handoffs" ADD CONSTRAINT "agent_handoffs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- END PRISMA MIGRATION 20261030120000_agent_operations
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'23d84892060b66ffc3be5e8b68f0b0ba498841fd0098475f90202ca1a9a6cba7',now(),'20261030120000_agent_operations',now(),1);

-- BEGIN PRISMA MIGRATION 20261030130000_brain_knowledge
CREATE TABLE "brain_knowledge" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "source" TEXT,
  "category" TEXT NOT NULL DEFAULT 'general',
  "tags" TEXT[] NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "brain_knowledge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "brain_knowledge_fingerprint_key" ON "brain_knowledge"("fingerprint");
CREATE INDEX "brain_knowledge_active_priority_updated_at_idx" ON "brain_knowledge"("active","priority","updated_at");
CREATE INDEX "brain_knowledge_expires_at_idx" ON "brain_knowledge"("expires_at");

-- END PRISMA MIGRATION 20261030130000_brain_knowledge
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'f66b8b5cf73db22d9eeb0e01f4d424d5af1f52f0d8dd510537bbebccf77b6b1f',now(),'20261030130000_brain_knowledge',now(),1);

-- BEGIN PRISMA MIGRATION 20261030130500_agent_task_queue
ALTER TABLE "agent_runs"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "worker_id" TEXT,
  ADD COLUMN "locked_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "agent_runs_status_locked_at_idx" ON "agent_runs"("status", "locked_at");

-- END PRISMA MIGRATION 20261030130500_agent_task_queue
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'c0a207b8e76c47e1256a65474a977947c7b9dc9b71d42c43a5b98c55fbf4e6f1',now(),'20261030130500_agent_task_queue',now(),1);

-- BEGIN PRISMA MIGRATION 20261030153000_agent_run_retry_backoff
ALTER TABLE "agent_runs"
  ADD COLUMN "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "agent_runs_status_next_attempt_at_idx"
  ON "agent_runs"("status", "next_attempt_at");

-- END PRISMA MIGRATION 20261030153000_agent_run_retry_backoff
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'76057fc933164bdb0701e35942b289fe6b0efc1581f66d957f3d04b0579e6418',now(),'20261030153000_agent_run_retry_backoff',now(),1);

-- BEGIN PRISMA MIGRATION 20261101110000_communications_and_langgraph_checkpoint
-- Explicit application schema migration.
-- Communication tables mirror prisma/schema.prisma and the legacy startup DDL.
CREATE TABLE IF NOT EXISTS "communication_conversations" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "external_address" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "communication_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "communication_conversations_channel_address_key" UNIQUE ("channel", "external_address")
);

CREATE TABLE IF NOT EXISTS "communication_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'received',
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "communication_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "communication_messages_provider_message_id_key" UNIQUE ("provider_message_id"),
  CONSTRAINT "communication_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "communication_conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "communication_messages_conversation_created_idx"
  ON "communication_messages" ("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "communication_messages_status_created_idx"
  ON "communication_messages" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "communication_conversations_channel_updated_idx"
  ON "communication_conversations" ("channel", "updated_at");

-- LangGraph.js @langchain/langgraph-checkpoint-postgres 1.1.2 schema.
-- The package's migration array has versions 0..5; v=5 adds task_path.
CREATE TABLE IF NOT EXISTS "checkpoint_migrations" (
  "v" INTEGER NOT NULL,
  CONSTRAINT "checkpoint_migrations_pkey" PRIMARY KEY ("v")
);

CREATE TABLE IF NOT EXISTS "checkpoints" (
  "thread_id" TEXT NOT NULL,
  "checkpoint_ns" TEXT NOT NULL DEFAULT '',
  "checkpoint_id" TEXT NOT NULL,
  "parent_checkpoint_id" TEXT,
  "type" TEXT,
  "checkpoint" JSONB NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id")
);

CREATE TABLE IF NOT EXISTS "checkpoint_blobs" (
  "thread_id" TEXT NOT NULL,
  "checkpoint_ns" TEXT NOT NULL DEFAULT '',
  "channel" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "blob" BYTEA,
  CONSTRAINT "checkpoint_blobs_pkey" PRIMARY KEY ("thread_id", "checkpoint_ns", "channel", "version")
);

CREATE TABLE IF NOT EXISTS "checkpoint_writes" (
  "thread_id" TEXT NOT NULL,
  "checkpoint_ns" TEXT NOT NULL DEFAULT '',
  "checkpoint_id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "idx" INTEGER NOT NULL,
  "channel" TEXT NOT NULL,
  "type" TEXT,
  "blob" BYTEA NOT NULL,
  "task_path" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "checkpoint_writes_pkey" PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "idx")
);

ALTER TABLE "checkpoint_blobs" ALTER COLUMN "blob" DROP NOT NULL;
ALTER TABLE "checkpoint_writes" ADD COLUMN IF NOT EXISTS "task_path" TEXT NOT NULL DEFAULT '';

-- Mark the package's ordered migrations as applied. Existing versions are
-- preserved; an already-initialized checkpointer can safely run this migration.
INSERT INTO "checkpoint_migrations" ("v")
VALUES (0), (1), (2), (3), (4), (5)
ON CONFLICT ("v") DO NOTHING;

-- END PRISMA MIGRATION 20261101110000_communications_and_langgraph_checkpoint
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'d22d6b98d3d9805f3b4f5c6c0c77860e0c6e24d57599d8655ec938651dbd26a8',now(),'20261101110000_communications_and_langgraph_checkpoint',now(),1);

-- BEGIN PRISMA MIGRATION 20261101111500_complete_supabase_models
-- Complete the Prisma migration history for the Supabase-integrated models.
-- The initial migration created the legacy session message table as "messages".
-- The current Prisma model maps it to "session_messages", while ChatSqlMessage
-- owns the "messages" table. Preserve existing session rows by renaming the
-- original table before creating the chat message table.
-- Preserve the existing Supabase chat table public.messages in place.
-- The initial Prisma migration creates the distinct legacy table as
-- public.session_messages. Never rename public.messages: its columns, RLS
-- policies, Storage policies, and Data API contract belong to Supabase Auth.

CREATE TABLE IF NOT EXISTS "profiles" (
  "id" UUID NOT NULL,
  "email" TEXT,
  "full_name" TEXT,
  "avatar_url" TEXT,
  "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'New Thread',
  "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4.6',
  "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "model" TEXT,
  "steps" JSONB,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "memory_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'preference',
  "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_entries_user_id_key_key" UNIQUE ("user_id", "key")
);

CREATE TABLE IF NOT EXISTS "scheduled_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "prompt" TEXT NOT NULL,
  "run_at" TIMESTAMP(3) NOT NULL,
  "interval_minutes" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_run_at" TIMESTAMP(3),
  "last_result" TEXT,
  "last_error" TEXT,
  "locked_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pending_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "tool" TEXT NOT NULL,
  "args" JSONB NOT NULL,
  "summary" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "decided_at" TIMESTAMP(3),
  "decided_by" TEXT,
  "result" TEXT,
  CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "conversations_user_id_idx"
  ON "conversations"("user_id");
CREATE INDEX IF NOT EXISTS "messages_conversation_id_idx"
  ON "messages"("conversation_id");
CREATE INDEX IF NOT EXISTS "memory_entries_user_id_idx"
  ON "memory_entries"("user_id");
CREATE INDEX IF NOT EXISTS "scheduled_tasks_status_run_at_idx"
  ON "scheduled_tasks"("status", "run_at");
CREATE INDEX IF NOT EXISTS "scheduled_tasks_user_id_idx"
  ON "scheduled_tasks"("user_id");
CREATE INDEX IF NOT EXISTS "pending_actions_status_expires_at_idx"
  ON "pending_actions"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "pending_actions_user_id_idx"
  ON "pending_actions"("user_id");

-- END PRISMA MIGRATION 20261101111500_complete_supabase_models
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'0f0d5fb52266b0cef8b932cd48fff2caabaa6dbcfcd2ded2dae4059aca109e24',now(),'20261101111500_complete_supabase_models',now(),1);
