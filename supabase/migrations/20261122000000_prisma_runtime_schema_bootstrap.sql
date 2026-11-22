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

-- BEGIN PRISMA MIGRATION 20261102123000_supabase_auth_identity_bridge
-- Bridge Supabase Auth identities to the legacy Prisma user relation.
-- Supabase Auth remains the credential authority; never copy auth.users password hashes.
ALTER TABLE public.users
  ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.users TO service_role;

CREATE OR REPLACE FUNCTION public.sync_ryanai_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.users WHERE id = OLD.id::text;
    RETURN OLD;
  END IF;

  INSERT INTO public.users (
    id, email, password_hash, name, created_at, updated_at
  )
  VALUES (
    NEW.id::text,
    COALESCE(NULLIF(NEW.email, ''), 'auth-user-' || NEW.id::text || '@no-email.invalid'),
    NULL,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.created_at, pg_catalog.now())::timestamp(3),
    COALESCE(NEW.updated_at, NEW.created_at, pg_catalog.now())::timestamp(3)
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      name = COALESCE(EXCLUDED.name, public.users.name),
      updated_at = pg_catalog.now();

  RETURN NEW;
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.sync_ryanai_auth_user()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ryanai_auth_user_sync_insert ON auth.users;
CREATE TRIGGER ryanai_auth_user_sync_insert
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_ryanai_auth_user();

DROP TRIGGER IF EXISTS ryanai_auth_user_sync_update ON auth.users;
CREATE TRIGGER ryanai_auth_user_sync_update
AFTER UPDATE OF email, raw_user_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_ryanai_auth_user();

DROP TRIGGER IF EXISTS ryanai_auth_user_sync_delete ON auth.users;
CREATE TRIGGER ryanai_auth_user_sync_delete
AFTER DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_ryanai_auth_user();

-- Backfill identity metadata only. Never copy passwords, tokens, or sessions.
INSERT INTO public.users (
  id, email, password_hash, name, created_at, updated_at
)
SELECT
  au.id::text,
  COALESCE(NULLIF(au.email, ''), 'auth-user-' || au.id::text || '@no-email.invalid'),
  NULL,
  COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name'),
  COALESCE(au.created_at, pg_catalog.now())::timestamp(3),
  COALESCE(au.updated_at, au.created_at, pg_catalog.now())::timestamp(3)
FROM auth.users au
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, public.users.name),
    updated_at = pg_catalog.now();

COMMENT ON TABLE public.users IS
  'Server-only identity shadow of Supabase Auth users; password_hash is NULL for Supabase-managed identities.';
COMMENT ON FUNCTION public.sync_ryanai_auth_user() IS
  'Synchronizes only user identity metadata to the legacy Prisma relation; credentials remain managed by Supabase Auth.';

-- END PRISMA MIGRATION 20261102123000_supabase_auth_identity_bridge
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'fd48bfd21aa806f8839dc5f624f5ed4f38bf215d8b9ee09e58d7397bd3d7e6a6',now(),'20261102123000_supabase_auth_identity_bridge',now(),1);

-- BEGIN PRISMA MIGRATION 20261102150000_agent_run_execution_scope
-- Persist the server-derived execution scope with the durable task.
-- The empty default intentionally causes legacy/unclassified tasks to run full reconciliation.
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS execution_scope JSONB NOT NULL DEFAULT '{}'::jsonb;

-- END PRISMA MIGRATION 20261102150000_agent_run_execution_scope
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'874cae5ef0e7a8c3d6695f0294d6448437d400acefcbf5cf6adf27419ed665d3',now(),'20261102150000_agent_run_execution_scope',now(),1);

-- BEGIN PRISMA MIGRATION 20261102210000_internal_jarvis_audit
CREATE TABLE IF NOT EXISTS "jarvis_audit_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "resource_id" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "jarvis_audit_events_created_at_idx" ON "jarvis_audit_events" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "jarvis_audit_events_actor_created_idx" ON "jarvis_audit_events" ("actor_id", "created_at" DESC);

-- END PRISMA MIGRATION 20261102210000_internal_jarvis_audit
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'de8788068c484624f801064fc2c0313091254d6cce332c4895d303327e7f61b1',now(),'20261102210000_internal_jarvis_audit',now(),1);

-- BEGIN PRISMA MIGRATION 20261102235000_engineering_evidence_workbench
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS plan_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS plan_hash TEXT,
  ADD COLUMN IF NOT EXISTS base_commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS proposed_diff_hash TEXT,
  ADD COLUMN IF NOT EXISTS approved_plan_hash TEXT,
  ADD COLUMN IF NOT EXISTS approved_commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS approved_diff_hash TEXT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS steering_notes TEXT,
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS agent_runs_approval_status_created_idx
  ON public.agent_runs (approval_status, created_at);

CREATE TABLE IF NOT EXISTS public.agent_run_evidence (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  payload JSONB NOT NULL,
  previous_hash TEXT,
  hash TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT agent_run_evidence_pkey PRIMARY KEY (id),
  CONSTRAINT agent_run_evidence_run_id_fkey
    FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_run_evidence_run_sequence_key
  ON public.agent_run_evidence (run_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS agent_run_evidence_hash_key
  ON public.agent_run_evidence (hash);
CREATE INDEX IF NOT EXISTS agent_run_evidence_run_sequence_idx
  ON public.agent_run_evidence (run_id, sequence);

-- Evidence is append-only. Corrections are new events that reference the prior event.
CREATE OR REPLACE FUNCTION public.reject_agent_run_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Direct mutation is rejected. Parent-job deletion may cascade for data erasure.
  IF TG_OP = 'UPDATE' OR pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'agent_run_evidence is append-only; append a correction event instead';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS agent_run_evidence_immutable ON public.agent_run_evidence;
CREATE TRIGGER agent_run_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.agent_run_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_agent_run_evidence_mutation();

-- END PRISMA MIGRATION 20261102235000_engineering_evidence_workbench
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'946aa86092192336185f591bfe4a0d09fa906c6abe58a42141f753eadd7e2cec',now(),'20261102235000_engineering_evidence_workbench',now(),1);

-- BEGIN PRISMA MIGRATION 20261104100000_vector_memory
-- Bring the legacy Docker Compose pgvector bootstrap under ordered Prisma migration control.
-- Every object is created idempotently so databases initialized by the former
-- Docker Compose bootstrap can upgrade without duplicate-object errors.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.reasoning_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessionid VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Existing databases may contain either the unquoted legacy identifier
-- sessionId (stored by PostgreSQL as sessionid) or a quoted "sessionId".
-- The current Supabase schema snapshot uses the quoted form. Create the
-- supporting index against the column that actually exists; the following
-- compatibility migration then renames that column to session_id.
DO $$
DECLARE
  session_column TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'sessionid'
  ) THEN
    session_column := 'sessionid';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'sessionId'
  ) THEN
    session_column := '"sessionId"';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'session_id'
  ) THEN
    session_column := 'session_id';
  ELSE
    RAISE EXCEPTION 'agent_memory has no recognized session identifier column';
  END IF;

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_agent_session ON public.agent_memory (%s, timestamp)',
    session_column
  );
END
$$;

CREATE INDEX IF NOT EXISTS idx_reasoning_embedding
  ON public.reasoning_cache USING hnsw (embedding vector_cosine_ops);

-- END PRISMA MIGRATION 20261104100000_vector_memory
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'48b30e3bf06521200b7e08d528fb3ce7491402a9db9130c0f97625d8f15560e1',now(),'20261104100000_vector_memory',now(),1);

-- BEGIN PRISMA MIGRATION 20261104120000_agent_memory_session_id
-- Align the legacy vector-memory session column with the runtime SQL contract.
-- The original bootstrap created unquoted sessionId, which PostgreSQL stores as
-- sessionid. Rename in place so existing memory rows and the index are retained.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'sessionid'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE public.agent_memory RENAME COLUMN sessionid TO session_id;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'sessionId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE public.agent_memory RENAME COLUMN "sessionId" TO session_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_memory' AND column_name = 'session_id'
  ) THEN
    RAISE EXCEPTION 'agent_memory has no recognized session identifier column; refusing destructive reconciliation';
  END IF;
END
$$;

-- END PRISMA MIGRATION 20261104120000_agent_memory_session_id
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'d8287856440d2c26fe41678eb9f5df68ac232578787dddb769da53255e37764d',now(),'20261104120000_agent_memory_session_id',now(),1);

-- BEGIN PRISMA MIGRATION 20261104120000_isolated_coding_task_queue
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS queue_type TEXT NOT NULL DEFAULT 'reasoning';

-- Existing workbench records are not eligible for the three-brain reasoning worker.
UPDATE public.agent_runs
SET queue_type = 'coding'
WHERE approval_status = 'pending'
   OR plan_snapshot IS NOT NULL
   OR proposed_diff_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_runs_queue_type_status_created_idx
  ON public.agent_runs (queue_type, status, created_at);

CREATE TABLE IF NOT EXISTS public.coding_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workbench_run_id TEXT NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  approval_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  base_commit_sha TEXT NOT NULL,
  proposed_diff_hash TEXT NOT NULL,
  agent TEXT NOT NULL,
  prompt TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  worker_id TEXT,
  locked_at TIMESTAMPTZ(6),
  lease_expires_at TIMESTAMPTZ(6),
  next_attempt_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  cancel_requested_at TIMESTAMPTZ(6),
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS coding_tasks_status_next_attempt_idx
  ON public.coding_tasks (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS coding_tasks_status_lease_expiry_idx
  ON public.coding_tasks (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS coding_tasks_user_created_idx
  ON public.coding_tasks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coding_tasks_workbench_run_idx
  ON public.coding_tasks (workbench_run_id, created_at DESC);

-- END PRISMA MIGRATION 20261104120000_isolated_coding_task_queue
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'72733a3934735acba833b471817a6cd982ad8330e119478e5cd2a8bd3734f151',now(),'20261104120000_isolated_coding_task_queue',now(),1);

-- BEGIN PRISMA MIGRATION 20261104190000_quant_experiments
CREATE TABLE "quant_experiments" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "strategy" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "result" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_experiments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_experiments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "quant_experiments_user_created_idx"
  ON "quant_experiments"("user_id", "created_at" DESC);

-- END PRISMA MIGRATION 20261104190000_quant_experiments
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'6bc74f2acf33869c6283ab68ba89c4e894684e051fe86b12cddcc26c0fd7c573',now(),'20261104190000_quant_experiments',now(),1);
