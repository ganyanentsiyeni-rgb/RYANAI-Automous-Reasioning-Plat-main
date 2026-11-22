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

-- BEGIN PRISMA MIGRATION 20261104200000_audiobook_persistence_jobs
CREATE TABLE "audiobook_projects" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "language" VARCHAR(16) NOT NULL DEFAULT 'en-ZA',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audiobook_projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audiobook_projects_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "audiobook_chapters" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "position" INTEGER NOT NULL,
  "narration_settings" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audiobook_chapters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audiobook_chapters_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "audiobook_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "audiobook_render_jobs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'queued',
  "progress" JSONB NOT NULL DEFAULT '{}',
  "result" JSONB,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "worker_id" VARCHAR(120),
  "locked_at" TIMESTAMPTZ(6),
  "lease_expires_at" TIMESTAMPTZ(6),
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancel_requested_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "audiobook_render_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audiobook_render_jobs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "audiobook_render_jobs_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "audiobook_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "audiobook_render_jobs_attempts_check" CHECK ("attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 5),
  CONSTRAINT "audiobook_render_jobs_status_check" CHECK ("status" IN ('queued','running','completed','failed','cancel_requested','cancelled'))
);

CREATE INDEX "audiobook_projects_user_updated_idx" ON "audiobook_projects"("user_id", "updated_at" DESC);
CREATE UNIQUE INDEX "audiobook_chapters_project_position_key" ON "audiobook_chapters"("project_id", "position");
CREATE INDEX "audiobook_chapters_project_position_idx" ON "audiobook_chapters"("project_id", "position");
CREATE INDEX "audiobook_render_jobs_status_next_attempt_idx" ON "audiobook_render_jobs"("status", "next_attempt_at", "created_at");
CREATE INDEX "audiobook_render_jobs_status_lease_idx" ON "audiobook_render_jobs"("status", "lease_expires_at");
CREATE INDEX "audiobook_render_jobs_user_created_idx" ON "audiobook_render_jobs"("user_id", "created_at" DESC);
CREATE INDEX "audiobook_render_jobs_project_created_idx" ON "audiobook_render_jobs"("project_id", "created_at" DESC);

-- END PRISMA MIGRATION 20261104200000_audiobook_persistence_jobs
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'0cc4ce93b2404910637595add0c8144c380cc4f330fe1af4241e01ec85fdab30',now(),'20261104200000_audiobook_persistence_jobs',now(),1);

-- BEGIN PRISMA MIGRATION 20261104203000_audiobook_render_request_snapshot
ALTER TABLE "audiobook_render_jobs"
  ADD COLUMN "idempotency_key" VARCHAR(120),
  ADD COLUMN "request" JSONB;

-- Existing jobs, if any, receive a deterministic unique migration placeholder.
UPDATE "audiobook_render_jobs"
SET "idempotency_key" = 'legacy-' || "id",
    "request" = '{}'::jsonb
WHERE "idempotency_key" IS NULL OR "request" IS NULL;

ALTER TABLE "audiobook_render_jobs"
  ALTER COLUMN "idempotency_key" SET NOT NULL,
  ALTER COLUMN "request" SET NOT NULL;

CREATE UNIQUE INDEX "audiobook_render_jobs_user_idempotency_key"
  ON "audiobook_render_jobs"("user_id", "idempotency_key");

-- END PRISMA MIGRATION 20261104203000_audiobook_render_request_snapshot
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'99917734040cdcea38fe8f9de39795107126f0037ff67a7ccbc7c9552eb6db3c',now(),'20261104203000_audiobook_render_request_snapshot',now(),1);

-- BEGIN PRISMA MIGRATION 20261104210000_audiobook_active_render_guard
-- Enforce at most one active render per audiobook project even under concurrent API requests.
CREATE UNIQUE INDEX "audiobook_render_jobs_one_active_per_project"
  ON "audiobook_render_jobs"("project_id")
  WHERE "status" IN ('queued', 'running', 'cancel_requested');

-- END PRISMA MIGRATION 20261104210000_audiobook_active_render_guard
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'b49ba0a2d61ce5fd765aee943256cbf8e05d8aaf49bf373ef8e38d5ad5a64eac',now(),'20261104210000_audiobook_active_render_guard',now(),1);

-- BEGIN PRISMA MIGRATION 20261105120000_comms_outbound_idempotency
-- Prevent duplicate external dispatch when browser/network retries repeat a send request.
-- Nullable for backwards compatibility with existing communication history.
ALTER TABLE "communication_messages" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "communication_messages_idempotency_key_key" ON "communication_messages" ("idempotency_key");

-- END PRISMA MIGRATION 20261105120000_comms_outbound_idempotency
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'05247de3b4910ed3fa287a90fb934002e702ec579162cdbd5dfbc5acfb96a887',now(),'20261105120000_comms_outbound_idempotency',now(),1);

-- BEGIN PRISMA MIGRATION 20261105130000_comms_secure_attachments
ALTER TABLE "communication_conversations" ADD COLUMN IF NOT EXISTS "owner_user_id" UUID;
CREATE INDEX IF NOT EXISTS "communication_conversations_owner_updated_idx" ON "communication_conversations" ("owner_user_id","updated_at");
CREATE TABLE IF NOT EXISTS "communication_attachments" (
 "id" TEXT PRIMARY KEY,"communication_message_id" TEXT NOT NULL,"owner_user_id" UUID NOT NULL,
 "bucket_id" TEXT NOT NULL DEFAULT 'ryanai-comms-attachments',"object_name" TEXT NOT NULL UNIQUE,
 "file_name" TEXT NOT NULL,"mime_type" TEXT NOT NULL,"size" BIGINT NOT NULL CHECK ("size">0),
 "source" TEXT NOT NULL,"provider_media_id" TEXT,"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "communication_attachments_message_fkey" FOREIGN KEY ("communication_message_id") REFERENCES "communication_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "communication_attachments_owner_created_idx" ON "communication_attachments" ("owner_user_id","created_at");
CREATE INDEX IF NOT EXISTS "communication_attachments_message_created_idx" ON "communication_attachments" ("communication_message_id","created_at");
ALTER TABLE "communication_attachments" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS "communication_attachment_audit" (
 "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 "communication_attachment_id" TEXT NOT NULL,
 "owner_user_id" UUID NOT NULL,
 "event" TEXT NOT NULL,
 "metadata" JSONB,
 "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "communication_attachment_audit_attachment_created_idx" ON "communication_attachment_audit" ("communication_attachment_id","created_at");
CREATE INDEX IF NOT EXISTS "communication_attachment_audit_owner_created_idx" ON "communication_attachment_audit" ("owner_user_id","created_at");
ALTER TABLE "communication_attachment_audit" ENABLE ROW LEVEL SECURITY;

-- END PRISMA MIGRATION 20261105130000_comms_secure_attachments
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'9aeaf8f62d61f3639f470c0f661efd337fc62060b5a790de6ac5eca13565829a',now(),'20261105130000_comms_secure_attachments',now(),1);

-- BEGIN PRISMA MIGRATION 20261105143000_quant_paper_trading
CREATE TABLE "quant_paper_accounts" (
  "user_id" TEXT NOT NULL,
  "cash_balance" NUMERIC(24, 8) NOT NULL DEFAULT 100000,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_accounts_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "quant_paper_accounts_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_accounts_cash_nonnegative" CHECK ("cash_balance" >= 0)
);

CREATE TABLE "quant_paper_positions" (
  "user_id" TEXT NOT NULL,
  "symbol" VARCHAR(15) NOT NULL,
  "quantity" NUMERIC(24, 8) NOT NULL,
  "average_entry_price" NUMERIC(24, 8) NOT NULL,
  "last_price" NUMERIC(24, 8) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_positions_pkey" PRIMARY KEY ("user_id", "symbol"),
  CONSTRAINT "quant_paper_positions_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_positions_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "quant_paper_positions_prices_positive" CHECK ("average_entry_price" > 0 AND "last_price" > 0)
);

CREATE TABLE "quant_paper_orders" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "client_order_id" VARCHAR(64) NOT NULL,
  "symbol" VARCHAR(15) NOT NULL,
  "side" VARCHAR(4) NOT NULL,
  "quantity" NUMERIC(24, 8) NOT NULL,
  "reference_price" NUMERIC(24, 8) NOT NULL,
  "fill_price" NUMERIC(24, 8) NOT NULL,
  "fee" NUMERIC(24, 8) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'filled',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_paper_orders_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_orders_side_check" CHECK ("side" IN ('buy', 'sell')),
  CONSTRAINT "quant_paper_orders_status_check" CHECK ("status" IN ('filled')),
  CONSTRAINT "quant_paper_orders_values_check" CHECK ("quantity" > 0 AND "reference_price" > 0 AND "fill_price" > 0 AND "fee" >= 0),
  CONSTRAINT "quant_paper_orders_idempotency_key" UNIQUE ("user_id", "client_order_id")
);

CREATE INDEX "quant_paper_orders_user_created_idx"
  ON "quant_paper_orders"("user_id", "created_at" DESC);

CREATE TABLE "quant_paper_trades" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "order_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "symbol" VARCHAR(15) NOT NULL,
  "side" VARCHAR(4) NOT NULL,
  "quantity" NUMERIC(24, 8) NOT NULL,
  "price" NUMERIC(24, 8) NOT NULL,
  "fee" NUMERIC(24, 8) NOT NULL,
  "realized_pnl" NUMERIC(24, 8),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_trades_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_paper_trades_order_id_fkey" FOREIGN KEY ("order_id")
    REFERENCES "quant_paper_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_trades_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "quant_paper_trades_user_created_idx"
  ON "quant_paper_trades"("user_id", "created_at" DESC);

-- END PRISMA MIGRATION 20261105143000_quant_paper_trading
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'5f2cfb7f750a5c4ec8b6918b1899838b129bc89977ba5f176d6976d647397b5c',now(),'20261105143000_quant_paper_trading',now(),1);

-- BEGIN PRISMA MIGRATION 20261105150000_quant_paper_risk_policies
CREATE TABLE "quant_paper_risk_policies" (
  "user_id" TEXT NOT NULL,
  "max_order_notional" NUMERIC(18, 2) NOT NULL DEFAULT 10000,
  "max_position_notional" NUMERIC(18, 2) NOT NULL DEFAULT 25000,
  "max_gross_exposure" NUMERIC(18, 2) NOT NULL DEFAULT 75000,
  "trading_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_risk_policies_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "quant_paper_risk_policies_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_risk_policies_order_cap" CHECK ("max_order_notional" >= 100 AND "max_order_notional" <= 10000),
  CONSTRAINT "quant_paper_risk_policies_position_cap" CHECK ("max_position_notional" >= 100 AND "max_position_notional" <= 50000),
  CONSTRAINT "quant_paper_risk_policies_gross_cap" CHECK ("max_gross_exposure" >= 100 AND "max_gross_exposure" <= 100000),
  CONSTRAINT "quant_paper_risk_policies_order_le_position" CHECK ("max_order_notional" <= "max_position_notional"),
  CONSTRAINT "quant_paper_risk_policies_position_le_gross" CHECK ("max_position_notional" <= "max_gross_exposure")
);

-- END PRISMA MIGRATION 20261105150000_quant_paper_risk_policies
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'8aaf1e597cf4a29105ef866090c0210e481c2e9b55cf688fb1d15330b01bcb10',now(),'20261105150000_quant_paper_risk_policies',now(),1);

-- BEGIN PRISMA MIGRATION 20261105160000_quant_paper_strategies
CREATE TABLE "quant_paper_strategies" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "experiment_id" TEXT NOT NULL,
  "allocation_pct" NUMERIC(5, 2) NOT NULL DEFAULT 10.00,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_strategies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_paper_strategies_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_strategies_experiment_id_fkey" FOREIGN KEY ("experiment_id")
    REFERENCES "quant_experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_strategies_allocation_check" CHECK ("allocation_pct" >= 1 AND "allocation_pct" <= 100),
  CONSTRAINT "quant_paper_strategies_user_experiment_key" UNIQUE ("user_id", "experiment_id")
);

CREATE INDEX "quant_paper_strategies_user_enabled_idx"
  ON "quant_paper_strategies"("user_id", "enabled", "created_at" DESC);

-- END PRISMA MIGRATION 20261105160000_quant_paper_strategies
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'9abedd1f73840f4ca7a9b016267f93b010d11428c093232dbadefc30b796e774',now(),'20261105160000_quant_paper_strategies',now(),1);

-- BEGIN PRISMA MIGRATION 20261105170000_quant_market_data_imports
CREATE TABLE "quant_market_data_imports" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "symbol" VARCHAR(15) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "feed" VARCHAR(16) NOT NULL,
  "timeframe" VARCHAR(16) NOT NULL,
  "adjustment" VARCHAR(16) NOT NULL,
  "bar_count" INTEGER NOT NULL,
  "first_bar_at" TIMESTAMPTZ(6) NOT NULL,
  "last_bar_at" TIMESTAMPTZ(6) NOT NULL,
  "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_stale" BOOLEAN NOT NULL DEFAULT FALSE,
  "bars" JSONB NOT NULL,
  "provenance" JSONB NOT NULL,
  CONSTRAINT "quant_market_data_imports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_market_data_imports_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_market_data_imports_bar_count_check" CHECK ("bar_count" BETWEEN 30 AND 1000),
  CONSTRAINT "quant_market_data_imports_symbol_check" CHECK ("symbol" ~ '^[A-Z0-9.-]{1,15}$')
);

CREATE INDEX "quant_market_data_imports_user_symbol_fetched_idx"
  ON "quant_market_data_imports"("user_id", "symbol", "fetched_at" DESC);

-- END PRISMA MIGRATION 20261105170000_quant_market_data_imports
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'58b4c8e74b0a3ba6b863437262213898eed917107028792c4990170f7db35909',now(),'20261105170000_quant_market_data_imports',now(),1);

-- BEGIN PRISMA MIGRATION 20261105180000_quant_strategy_signals
CREATE TABLE "quant_strategy_signals" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "market_data_import_id" TEXT NOT NULL,
  "strategy" VARCHAR(40) NOT NULL,
  "fast_window" SMALLINT NOT NULL,
  "slow_window" SMALLINT NOT NULL,
  "action" VARCHAR(8) NOT NULL,
  "reference_price" DECIMAL(18,8) NOT NULL,
  "previous_fast_sma" DECIMAL(18,8) NOT NULL,
  "previous_slow_sma" DECIMAL(18,8) NOT NULL,
  "fast_sma" DECIMAL(18,8) NOT NULL,
  "slow_sma" DECIMAL(18,8) NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL,
  "metadata" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_strategy_signals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_strategy_signals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_strategy_signals_import_id_fkey"
    FOREIGN KEY ("market_data_import_id") REFERENCES "quant_market_data_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_strategy_signals_windows_check"
    CHECK ("fast_window" >= 2 AND "slow_window" > "fast_window" AND "slow_window" <= 200),
  CONSTRAINT "quant_strategy_signals_action_check"
    CHECK ("action" IN ('buy', 'sell', 'hold'))
);

CREATE UNIQUE INDEX "quant_strategy_signals_user_import_strategy_windows_key"
  ON "quant_strategy_signals"("user_id", "market_data_import_id", "strategy", "fast_window", "slow_window");
CREATE INDEX "quant_strategy_signals_user_generated_idx"
  ON "quant_strategy_signals"("user_id", "generated_at" DESC);

-- END PRISMA MIGRATION 20261105180000_quant_strategy_signals
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'186bcdf206c462de52470a79a88ae35fdf2c5f1a4cf1516849b705ad8734ff85',now(),'20261105180000_quant_strategy_signals',now(),1);

-- BEGIN PRISMA MIGRATION 20261105182000_quant_private_table_isolation
-- Quant tables contain account-owned research and simulated trading data.
-- Access is through the authenticated RyanAI API; browser/PostgREST roles must not
-- read or mutate these tables directly. Request-level ownership remains enforced
-- by parameterized server queries. Keep this migration portable to local Postgres
-- where the Supabase-specific roles may not exist.
DO $quant_isolation$
DECLARE
  table_name TEXT;
  browser_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'quant_experiments',
    'quant_paper_accounts',
    'quant_paper_positions',
    'quant_paper_orders',
    'quant_paper_trades',
    'quant_paper_risk_policies',
    'quant_paper_strategies',
    'quant_market_data_imports',
    'quant_strategy_signals'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);

    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, browser_role);
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    END IF;
  END LOOP;
END;
$quant_isolation$;

-- END PRISMA MIGRATION 20261105182000_quant_private_table_isolation
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'a12cb23a2799b4f044090151b66eba8e52c8582a5dfa2dd94a656f2fe61f76ce',now(),'20261105182000_quant_private_table_isolation',now(),1);

-- BEGIN PRISMA MIGRATION 20261105190000_quant_paper_daily_risk_controls
ALTER TABLE "quant_paper_risk_policies"
  ADD COLUMN "max_daily_loss" NUMERIC(18,2) NOT NULL DEFAULT 5000,
  ADD COLUMN "max_drawdown_pct" NUMERIC(6,2) NOT NULL DEFAULT 10,
  ADD COLUMN "emergency_stop" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "emergency_stop_reason" TEXT,
  ADD COLUMN "emergency_stopped_at" TIMESTAMPTZ(6);

ALTER TABLE "quant_paper_risk_policies"
  ADD CONSTRAINT "quant_paper_risk_policies_daily_loss_cap"
    CHECK ("max_daily_loss" >= 100 AND "max_daily_loss" <= 50000),
  ADD CONSTRAINT "quant_paper_risk_policies_drawdown_cap"
    CHECK ("max_drawdown_pct" >= 1 AND "max_drawdown_pct" <= 50);

CREATE TABLE "quant_paper_daily_risk_state" (
  "user_id" TEXT NOT NULL,
  "risk_date" DATE NOT NULL,
  "starting_equity" NUMERIC(24,8) NOT NULL,
  "current_equity" NUMERIC(24,8) NOT NULL,
  "daily_loss" NUMERIC(24,8) NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_daily_risk_state_pkey" PRIMARY KEY ("user_id", "risk_date"),
  CONSTRAINT "quant_paper_daily_risk_state_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_daily_risk_state_values_check"
    CHECK ("starting_equity" >= 0 AND "current_equity" >= 0 AND "daily_loss" >= 0)
);

CREATE TABLE "quant_paper_portfolio_risk_state" (
  "user_id" TEXT NOT NULL,
  "peak_equity" NUMERIC(24,8) NOT NULL,
  "current_equity" NUMERIC(24,8) NOT NULL,
  "max_drawdown_pct" NUMERIC(8,4) NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_portfolio_risk_state_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "quant_paper_portfolio_risk_state_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_portfolio_risk_state_values_check"
    CHECK ("peak_equity" >= 0 AND "current_equity" >= 0 AND "max_drawdown_pct" >= 0 AND "max_drawdown_pct" <= 100)
);

CREATE INDEX "quant_paper_daily_risk_state_date_idx"
  ON "quant_paper_daily_risk_state"("risk_date" DESC);

-- END PRISMA MIGRATION 20261105190000_quant_paper_daily_risk_controls
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'2348aede6d1eb5bf14c2dfff5ee427b0eda8517a766c2968ba432df12f821168',now(),'20261105190000_quant_paper_daily_risk_controls',now(),1);

-- BEGIN PRISMA MIGRATION 20261105200000_github_app_oauth
-- GitHub App user authorization is server-only. Browser roles must not
-- read credentials or one-time PKCE state. Server API uses the privileged
-- PostgreSQL connection and enforces the authenticated RyanAI user ID.
CREATE TABLE public.github_app_connections (
  user_id TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL,
  github_login VARCHAR(120) NOT NULL,
  repository_id TEXT NOT NULL,
  repository_full_name VARCHAR(255) NOT NULL,
  repository_permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  access_token_expires_at TIMESTAMPTZ(6),
  refresh_token_expires_at TIMESTAMPTZ(6),
  connected_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.github_oauth_states (
  state_hash VARCHAR(64) PRIMARY KEY,
  user_id TEXT NOT NULL,
  encrypted_code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX github_oauth_states_expires_idx ON public.github_oauth_states(expires_at);
CREATE INDEX github_oauth_states_user_idx ON public.github_oauth_states(user_id);

ALTER TABLE public.github_app_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.github_app_connections FROM PUBLIC;
REVOKE ALL ON TABLE public.github_oauth_states FROM PUBLIC;
DO $github_roles$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.github_app_connections FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE public.github_oauth_states FROM %I', role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.github_app_connections TO service_role;
    GRANT ALL ON TABLE public.github_oauth_states TO service_role;
  END IF;
END;
$github_roles$;

-- END PRISMA MIGRATION 20261105200000_github_app_oauth
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'f4bc85ae1e52bef7c42740bef486db0ccf3c577c04bedf637544130db99ae086',now(),'20261105200000_github_app_oauth',now(),1);

-- BEGIN PRISMA MIGRATION 20261105200000_quant_risk_state_private_access
-- Daily and lifetime portfolio risk state is account-owned trading data.
-- Keep direct browser/PostgREST access disabled; the authenticated API accesses
-- these tables through the server's database connection.
DO $quant_risk_isolation$
DECLARE
  table_name TEXT;
  browser_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'quant_paper_daily_risk_state',
    'quant_paper_portfolio_risk_state'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);

    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, browser_role);
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    END IF;
  END LOOP;
END;
$quant_risk_isolation$;

-- END PRISMA MIGRATION 20261105200000_quant_risk_state_private_access
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'3f38084cd9cb3e30ad042c5e793e2f7dfbd26d7a741097ada0f7916c872d13a3',now(),'20261105200000_quant_risk_state_private_access',now(),1);

-- BEGIN PRISMA MIGRATION 20261105210000_agent_run_trace_context
ALTER TABLE "agent_runs"
ADD COLUMN IF NOT EXISTS "trace_context" JSONB;

-- END PRISMA MIGRATION 20261105210000_agent_run_trace_context
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'184352dd7d7d539d755d53f5cb554ee933114755b85fa1bc1a9c79d2b1fa979f',now(),'20261105210000_agent_run_trace_context',now(),1);

-- BEGIN PRISMA MIGRATION 20261105210000_pa_delegation
CREATE TABLE "pa_identity_nonces" (
  "id" UUID NOT NULL,
  "nonce" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pa_identity_nonces_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pa_identity_nonces_nonce_key" ON "pa_identity_nonces"("nonce");
CREATE INDEX "pa_identity_nonces_expires_at_idx" ON "pa_identity_nonces"("expires_at");

-- agent_runs.id is TEXT in the authoritative schema; keep this optional FK text-compatible.
CREATE TABLE "pa_delegations" (
  "id" UUID NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "requested_capabilities" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "trace_id" TEXT NOT NULL,
  "agent_run_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "pa_delegations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pa_delegations_agent_run_id_key" ON "pa_delegations"("agent_run_id");
CREATE INDEX "pa_delegations_owner_user_id_created_at_idx" ON "pa_delegations"("owner_user_id","created_at");
CREATE INDEX "pa_delegations_status_created_at_idx" ON "pa_delegations"("status","created_at");
ALTER TABLE "pa_delegations" ADD CONSTRAINT "pa_delegations_agent_run_id_fkey"
  FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pa_execution_receipts" (
  "id" UUID NOT NULL,
  "delegation_id" UUID NOT NULL,
  "agent_run_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "trace_id" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "result" JSONB,
  "error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pa_execution_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pa_execution_receipts_delegation_id_key" ON "pa_execution_receipts"("delegation_id");
CREATE INDEX "pa_execution_receipts_agent_run_id_created_at_idx" ON "pa_execution_receipts"("agent_run_id","created_at");
CREATE INDEX "pa_execution_receipts_trace_id_created_at_idx" ON "pa_execution_receipts"("trace_id","created_at");
ALTER TABLE "pa_execution_receipts" ADD CONSTRAINT "pa_execution_receipts_delegation_id_fkey"
  FOREIGN KEY ("delegation_id") REFERENCES "pa_delegations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- END PRISMA MIGRATION 20261105210000_pa_delegation
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'32a476a2d08ab5d8b2237801878b8c78ff0a872954dd0e87e752420f2ef4a329',now(),'20261105210000_pa_delegation',now(),1);

-- BEGIN PRISMA MIGRATION 20261105210000_quant_paper_order_proposals
CREATE TABLE "quant_paper_order_proposals" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "signal_id" TEXT NOT NULL,
  "market_data_import_id" TEXT NOT NULL,
  "symbol" VARCHAR(15) NOT NULL,
  "side" VARCHAR(4) NOT NULL,
  "quantity" NUMERIC(24,8) NOT NULL,
  "reference_price" NUMERIC(24,8) NOT NULL,
  "notional" NUMERIC(24,8) NOT NULL,
  "client_order_id" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "order_id" TEXT,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMPTZ(6),
  CONSTRAINT "quant_paper_order_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_paper_order_proposals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_order_proposals_signal_id_fkey"
    FOREIGN KEY ("signal_id") REFERENCES "quant_strategy_signals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_order_proposals_market_data_import_id_fkey"
    FOREIGN KEY ("market_data_import_id") REFERENCES "quant_market_data_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_order_proposals_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "quant_paper_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_order_proposals_side_check"
    CHECK ("side" IN ('buy', 'sell')),
  CONSTRAINT "quant_paper_order_proposals_status_check"
    CHECK ("status" IN ('pending', 'confirmed', 'rejected', 'expired')),
  CONSTRAINT "quant_paper_order_proposals_values_check"
    CHECK ("quantity" > 0 AND "reference_price" > 0 AND "notional" > 0),
  CONSTRAINT "quant_paper_order_proposals_idempotency_key"
    UNIQUE ("user_id", "client_order_id")
);

CREATE INDEX "quant_paper_order_proposals_user_status_created_idx"
  ON "quant_paper_order_proposals"("user_id", "status", "created_at" DESC);
CREATE INDEX "quant_paper_order_proposals_status_expiry_idx"
  ON "quant_paper_order_proposals"("status", "expires_at");

-- Proposals are visible only through authenticated API endpoints.
DO $quant_proposal_isolation$
DECLARE
  browser_role TEXT;
BEGIN
  ALTER TABLE public.quant_paper_order_proposals ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.quant_paper_order_proposals FROM PUBLIC;

  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'quant_paper_order_proposals', browser_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.quant_paper_order_proposals TO service_role;
  END IF;
END;
$quant_proposal_isolation$;

-- END PRISMA MIGRATION 20261105210000_quant_paper_order_proposals
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'d1a5598829a74fcb9f5a9b6eeec9826bb719c614af9aaef8322f9eed2664c299',now(),'20261105210000_quant_paper_order_proposals',now(),1);

-- BEGIN PRISMA MIGRATION 20261105211000_quant_paper_proposal_confirmation_state
ALTER TABLE "quant_paper_order_proposals"
  DROP CONSTRAINT "quant_paper_order_proposals_status_check";

ALTER TABLE "quant_paper_order_proposals"
  ADD CONSTRAINT "quant_paper_order_proposals_status_check"
    CHECK ("status" IN ('pending', 'confirming', 'confirmed', 'rejected', 'expired'));

-- END PRISMA MIGRATION 20261105211000_quant_paper_proposal_confirmation_state
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'da890b2184037eaf01bb2087640f1a82db0cdc58b7a12fced7e9145cff7fbadd',now(),'20261105211000_quant_paper_proposal_confirmation_state',now(),1);

-- BEGIN PRISMA MIGRATION 20261105223000_quant_market_data_events
CREATE TABLE "quant_market_data_events" (
  "id" BIGSERIAL NOT NULL,
  "user_id" TEXT NOT NULL,
  "symbol" VARCHAR(15) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "feed" VARCHAR(16) NOT NULL,
  "timeframe" VARCHAR(16) NOT NULL,
  "event_timestamp" TIMESTAMPTZ(6) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "source" VARCHAR(16) NOT NULL DEFAULT 'stream',
  "bar" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "quant_market_data_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_market_data_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_market_data_events_source_check"
    CHECK ("source" IN ('stream', 'historical'))
);

CREATE UNIQUE INDEX "quant_market_data_events_dedupe_key"
  ON "quant_market_data_events"(
    "user_id", "provider", "feed", "timeframe", "symbol", "event_timestamp", "payload_hash"
  );
CREATE INDEX "quant_market_data_events_user_symbol_cursor_idx"
  ON "quant_market_data_events"("user_id", "symbol", "id" ASC);
CREATE INDEX "quant_market_data_events_user_symbol_time_idx"
  ON "quant_market_data_events"("user_id", "symbol", "event_timestamp" DESC);

-- END PRISMA MIGRATION 20261105223000_quant_market_data_events
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'7dd86ef0b676e71ff1914cc17f044aee490abf2a83092abec71aee0671d9f612',now(),'20261105223000_quant_market_data_events',now(),1);

-- BEGIN PRISMA MIGRATION 20261105224500_quant_market_data_events_rls
-- Keep market-event data behind the authenticated API. No browser role receives direct table access.
DO $quant_market_data_events_isolation$
DECLARE
  browser_role TEXT;
BEGIN
  ALTER TABLE public.quant_market_data_events ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.quant_market_data_events FROM PUBLIC;
  REVOKE ALL ON SEQUENCE public.quant_market_data_events_id_seq FROM PUBLIC;

  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'quant_market_data_events', browser_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM %I', 'quant_market_data_events_id_seq', browser_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.quant_market_data_events TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE public.quant_market_data_events_id_seq TO service_role;
  END IF;
END;
$quant_market_data_events_isolation$;

-- END PRISMA MIGRATION 20261105224500_quant_market_data_events_rls
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'448aa8686da5bcc6249e0b21b2b63213421389c5a3b4595b526a074435f5de1a',now(),'20261105224500_quant_market_data_events_rls',now(),1);

-- BEGIN PRISMA MIGRATION 20261105233000_quant_paper_fill_reconciliation
ALTER TABLE "quant_paper_orders"
  ADD COLUMN "filled_quantity" NUMERIC(24, 8) NOT NULL DEFAULT 0,
  ADD COLUMN "remaining_quantity" NUMERIC(24, 8) NOT NULL DEFAULT 0,
  ADD COLUMN "average_fill_price" NUMERIC(24, 8),
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing paper orders were created as fully filled and have one matching trade row.
UPDATE "quant_paper_orders"
SET "filled_quantity" = "quantity",
    "remaining_quantity" = 0,
    "average_fill_price" = "fill_price",
    "updated_at" = "created_at";

ALTER TABLE "quant_paper_orders"
  ADD CONSTRAINT "quant_paper_orders_fill_quantities_check"
    CHECK (
      "filled_quantity" >= 0 AND
      "remaining_quantity" >= 0 AND
      ABS(("filled_quantity" + "remaining_quantity") - "quantity") <= 0.00000001
    ),
  ADD CONSTRAINT "quant_paper_orders_average_fill_check"
    CHECK (
      ("filled_quantity" = 0 AND "average_fill_price" IS NULL) OR
      ("filled_quantity" > 0 AND "average_fill_price" IS NOT NULL AND "average_fill_price" > 0)
    );

-- Preserve compatibility with the existing atomic paper-fill route. The
-- current route writes a fully-filled order and a single fill row in one tx.
CREATE OR REPLACE FUNCTION public.quant_paper_order_fill_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'filled' AND NEW.filled_quantity = 0 AND NEW.remaining_quantity = 0 THEN
    NEW.filled_quantity := NEW.quantity;
    NEW.remaining_quantity := 0;
    NEW.average_fill_price := NEW.fill_price;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER quant_paper_order_fill_defaults_trigger
BEFORE INSERT ON public.quant_paper_orders
FOR EACH ROW EXECUTE FUNCTION public.quant_paper_order_fill_defaults();

ALTER TABLE "quant_paper_trades"
  ADD COLUMN "client_fill_id" VARCHAR(96);

UPDATE "quant_paper_trades"
SET "client_fill_id" = 'legacy:' || "id";

CREATE OR REPLACE FUNCTION public.quant_paper_trade_fill_id()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  order_client_id TEXT;
BEGIN
  -- Validate order ownership for every fill, including rows that provide an
  -- explicit idempotency key. Never let client_fill_id bypass account isolation.
  SELECT client_order_id INTO order_client_id
  FROM public.quant_paper_orders WHERE id = NEW.order_id AND user_id = NEW.user_id;
  IF order_client_id IS NULL THEN
    RAISE EXCEPTION 'paper fill references an unknown order';
  END IF;

  IF NEW.client_fill_id IS NULL OR NEW.client_fill_id = '' THEN
    NEW.client_fill_id := 'paper:' || order_client_id || ':' || NEW.id::text;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER quant_paper_trade_fill_id_trigger
BEFORE INSERT ON public.quant_paper_trades
FOR EACH ROW EXECUTE FUNCTION public.quant_paper_trade_fill_id();

ALTER TABLE "quant_paper_trades"
  ALTER COLUMN "client_fill_id" SET NOT NULL;

CREATE UNIQUE INDEX "quant_paper_trades_user_client_fill_id_key"
  ON "quant_paper_trades"("user_id", "client_fill_id");

CREATE INDEX "quant_paper_trades_user_order_idx"
  ON "quant_paper_trades"("user_id", "order_id");

-- Reserve explicit lifecycle values for future simulated partial/cancelled fills.
ALTER TABLE "quant_paper_orders"
  DROP CONSTRAINT "quant_paper_orders_status_check",
  ADD CONSTRAINT "quant_paper_orders_status_check"
    CHECK ("status" IN ('accepted', 'partially_filled', 'filled', 'cancelled', 'rejected'));

-- END PRISMA MIGRATION 20261105233000_quant_paper_fill_reconciliation
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'9b58cd1f0758554a90e3576de72e82d8b157f9308c0eff62ed928e5f74a0d39a',now(),'20261105233000_quant_paper_fill_reconciliation',now(),1);

-- BEGIN PRISMA MIGRATION 20261106000000_security_centre_core
-- RyanAI Security Centre: evidence-backed scans and findings.
-- Production targets are deliberately excluded from this first iteration.
-- Existing JarvisAuditEvent and AgentRunEvidence remain the general audit/evidence ledgers.

CREATE TABLE IF NOT EXISTS public.security_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('kali_lab_scan', 'remediation_review')),
  environment TEXT NOT NULL CHECK (environment IN ('isolated_kali_lab', 'staging')),
  target_ref TEXT NOT NULL,
  commit_sha TEXT,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'revoked')),
  reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS security_approvals_status_expiry_idx
  ON public.security_approvals (status, expires_at);
CREATE INDEX IF NOT EXISTS security_approvals_target_commit_idx
  ON public.security_approvals (target_ref, commit_sha);

CREATE TABLE IF NOT EXISTS public.security_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID,
  initiated_by TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('github_actions', 'kali_lab', 'manual_import')),
  environment TEXT NOT NULL
    CHECK (environment IN ('isolated_ci', 'isolated_kali_lab', 'staging')),
  target_ref TEXT,
  branch TEXT,
  commit_sha TEXT,
  workflow_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  toolchain JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  approval_id UUID REFERENCES public.security_approvals(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT security_scans_kali_requires_approval
    CHECK (source <> 'kali_lab' OR approval_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS security_scans_created_idx
  ON public.security_scans (created_at DESC);
CREATE INDEX IF NOT EXISTS security_scans_commit_created_idx
  ON public.security_scans (commit_sha, created_at DESC);
CREATE INDEX IF NOT EXISTS security_scans_environment_status_idx
  ON public.security_scans (environment, status, created_at DESC);
CREATE INDEX IF NOT EXISTS security_scans_owner_created_idx
  ON public.security_scans (owner_user_id, created_at DESC);

-- A Kali run consumes a single-use approval bound to the exact environment,
-- target and commit. There is intentionally no production environment value.
CREATE OR REPLACE FUNCTION public.consume_security_scan_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  approval_record public.security_approvals%ROWTYPE;
BEGIN
  IF NEW.source <> 'kali_lab' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO approval_record
    FROM public.security_approvals
    WHERE id = NEW.approval_id
    FOR UPDATE;

  IF NOT FOUND
    OR approval_record.scope <> 'kali_lab_scan'
    OR approval_record.status <> 'approved'
    OR approval_record.expires_at <= NOW()
    OR approval_record.used_at IS NOT NULL
    OR approval_record.environment <> NEW.environment
    OR approval_record.target_ref IS DISTINCT FROM NEW.target_ref
    OR approval_record.commit_sha IS DISTINCT FROM NEW.commit_sha
  THEN
    RAISE EXCEPTION 'Kali scan requires a valid, unused, scope-bound human approval';
  END IF;

  UPDATE public.security_approvals SET used_at = NOW() WHERE id = approval_record.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS security_scans_consume_approval ON public.security_scans;
CREATE TRIGGER security_scans_consume_approval
  BEFORE INSERT ON public.security_scans
  FOR EACH ROW EXECUTE FUNCTION public.consume_security_scan_approval();

CREATE TABLE IF NOT EXISTS public.security_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES public.security_scans(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  source_tool TEXT NOT NULL,
  rule_id TEXT,
  severity TEXT NOT NULL
    CHECK (severity IN ('critical', 'high', 'medium', 'low', 'informational')),
  confidence TEXT NOT NULL DEFAULT 'unknown'
    CHECK (confidence IN ('unknown', 'low', 'medium', 'high')),
  title TEXT NOT NULL,
  description TEXT,
  affected_component TEXT,
  file_path TEXT,
  start_line INTEGER CHECK (start_line IS NULL OR start_line > 0),
  end_line INTEGER CHECK (end_line IS NULL OR end_line > 0),
  cve TEXT,
  cwe TEXT,
  cvss NUMERIC(4,2) CHECK (cvss IS NULL OR (cvss >= 0 AND cvss <= 10)),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'false_positive', 'remediated', 'accepted_risk')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scan_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS security_findings_severity_status_seen_idx
  ON public.security_findings (severity, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS security_findings_fingerprint_seen_idx
  ON public.security_findings (fingerprint, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS security_findings_component_status_idx
  ON public.security_findings (affected_component, status);

CREATE TABLE IF NOT EXISTS public.security_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES public.security_scans(id) ON DELETE CASCADE,
  finding_id UUID REFERENCES public.security_findings(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  artifact_ref TEXT,
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  media_type TEXT,
  redacted_excerpt TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS security_evidence_scan_captured_idx
  ON public.security_evidence (scan_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS security_evidence_finding_captured_idx
  ON public.security_evidence (finding_id, captured_at DESC);

-- Evidence is immutable; corrections are represented by new evidence rows.
-- Cascaded parent deletion remains possible for authorised data erasure.
CREATE OR REPLACE FUNCTION public.reject_security_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'security_evidence is append-only; insert a correction record';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS security_evidence_immutable ON public.security_evidence;
CREATE TRIGGER security_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.security_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_security_evidence_mutation();

CREATE TABLE IF NOT EXISTS public.security_remediations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id UUID NOT NULL REFERENCES public.security_findings(id) ON DELETE CASCADE,
  recommendation TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected', 'verified')),
  proposed_by TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  verification_scan_id UUID REFERENCES public.security_scans(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'verified' OR verification_scan_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS security_remediations_finding_status_idx
  ON public.security_remediations (finding_id, status, created_at DESC);

-- Security approvals are scoped to isolated Kali or staging only.
-- No approval record can authorise a production target in this release.

-- These records are server-side security evidence, not browser-facing tables.
-- Match the repository's least-privilege pattern and keep local Postgres portable.
DO $security_table_isolation$
DECLARE
  table_name TEXT;
  browser_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'security_scans',
    'security_findings',
    'security_evidence',
    'security_remediations',
    'security_approvals'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);

    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, browser_role);
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    END IF;
  END LOOP;
END;
$security_table_isolation$;

-- END PRISMA MIGRATION 20261106000000_security_centre_core
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'a35a24fbd2e5dc6eabd7f16743a22ffc16901503cae7aedf099d890f1c181ee3',now(),'20261106000000_security_centre_core',now(),1);

-- BEGIN PRISMA MIGRATION 20261107100000_plugin_provider_authorization
-- Plugin provider authorization state is server-only.
-- No browser role may read tokens, PKCE verifier material, or connection records.
CREATE TABLE public.plugin_provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  provider_id VARCHAR(64) NOT NULL CHECK (provider_id ~ '^[a-z][a-z0-9-]{1,63}$'),
  external_account_id TEXT,
  display_label VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'reauthorization_required', 'revocation_pending', 'revoked', 'error')),
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  access_token_expires_at TIMESTAMPTZ(6),
  refresh_token_expires_at TIMESTAMPTZ(6),
  granted_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  connection_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected_at TIMESTAMPTZ(6),
  revoked_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT plugin_connection_revoked_timestamp_check
    CHECK ((status <> 'revoked') OR revoked_at IS NOT NULL),
  CONSTRAINT plugin_connection_connected_token_check
    CHECK ((status <> 'connected') OR encrypted_access_token IS NOT NULL),
  CONSTRAINT plugin_connection_metadata_no_credentials_check
    CHECK (NOT (connection_metadata ?| ARRAY[
      'access_token', 'refresh_token', 'accessToken', 'refreshToken',
      'client_secret', 'clientSecret', 'password', 'credential', 'credentials'
    ]))
);
CREATE UNIQUE INDEX plugin_provider_connections_owner_provider_key
  ON public.plugin_provider_connections (owner_user_id, provider_id);
CREATE INDEX plugin_provider_connections_owner_status_idx
  ON public.plugin_provider_connections (owner_user_id, status, updated_at DESC);
CREATE INDEX plugin_provider_connections_provider_status_idx
  ON public.plugin_provider_connections (provider_id, status, updated_at DESC);

CREATE TABLE public.plugin_oauth_states (
  state_hash VARCHAR(64) PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  owner_user_id TEXT NOT NULL,
  provider_id VARCHAR(64) NOT NULL CHECK (provider_id ~ '^[a-z][a-z0-9-]{1,63}$'),
  encrypted_code_verifier TEXT NOT NULL,
  requested_scopes TEXT[] NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX plugin_oauth_states_expires_idx ON public.plugin_oauth_states (expires_at);
CREATE INDEX plugin_oauth_states_owner_provider_idx
  ON public.plugin_oauth_states (owner_user_id, provider_id);

CREATE TABLE public.plugin_authorization_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  provider_id VARCHAR(64) NOT NULL,
  connection_id UUID REFERENCES public.plugin_provider_connections(id) ON DELETE SET NULL,
  event_type VARCHAR(64) NOT NULL
    CHECK (event_type IN (
      'authorization_started',
      'authorization_completed',
      'authorization_failed',
      'scopes_rejected',
      'token_refreshed',
      'revocation_requested',
      'revocation_confirmed',
      'revocation_pending',
      'connection_reauthorized'
    )),
  actor_user_id TEXT NOT NULL,
  request_id VARCHAR(128),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (NOT (details ?| ARRAY[
      'access_token', 'refresh_token', 'accessToken', 'refreshToken',
      'client_secret', 'clientSecret', 'password', 'credential', 'credentials'
    ])),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX plugin_authorization_events_owner_created_idx
  ON public.plugin_authorization_events (owner_user_id, created_at DESC);
CREATE INDEX plugin_authorization_events_connection_created_idx
  ON public.plugin_authorization_events (connection_id, created_at DESC);

-- The OAuth state is single-use and removed atomically by callback handlers.
-- Provider authorization audit is append-only.
CREATE OR REPLACE FUNCTION public.reject_plugin_authorization_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'plugin_authorization_events is append-only';
END;
$$;
CREATE TRIGGER plugin_authorization_events_immutable
  BEFORE UPDATE OR DELETE ON public.plugin_authorization_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_plugin_authorization_event_mutation();

DO $plugin_authorization_privileges$
DECLARE
  table_name TEXT;
  browser_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'plugin_provider_connections',
    'plugin_oauth_states',
    'plugin_authorization_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, browser_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    END IF;
  END LOOP;
END;
$plugin_authorization_privileges$;

-- END PRISMA MIGRATION 20261107100000_plugin_provider_authorization
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'2c0f36a949bd187a5392c59485bbce5dee70af6fceaf8974ad3807d6ca6863ea',now(),'20261107100000_plugin_provider_authorization',now(),1);

-- BEGIN PRISMA MIGRATION 20261107160000_agent_requested_model
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "requested_model" TEXT;

-- END PRISMA MIGRATION 20261107160000_agent_requested_model
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'cd01e42b50ff67140c2a9fe239e6576f338a1acd1fd463b1ea277a620f56c4d2',now(),'20261107160000_agent_requested_model',now(),1);

-- BEGIN PRISMA MIGRATION 20261108010000_studio_native_core
-- RyanAI Studio native core. This migration is reviewed in source control only;
-- it is not applied to any production database by this change.
CREATE TABLE "studio_projects" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "objective" TEXT NOT NULL,
  "project_type" VARCHAR(32) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "studio_projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_projects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "studio_projects_owner_status_updated_idx" ON "studio_projects"("owner_user_id", "status", "updated_at" DESC);
CREATE INDEX "studio_projects_status_priority_created_idx" ON "studio_projects"("status", "priority", "created_at");

CREATE TABLE "studio_tasks" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "objective" TEXT NOT NULL,
  "task_type" VARCHAR(48) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'queued',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "required_capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "assigned_worker_id" VARCHAR(96),
  "depends_on_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "input" JSONB NOT NULL DEFAULT '{}',
  "output" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" VARCHAR(128),
  "lease_expires_at" TIMESTAMPTZ(6),
  "heartbeat_at" TIMESTAMPTZ(6),
  "approval_required" BOOLEAN NOT NULL DEFAULT FALSE,
  "approval_status" VARCHAR(32) NOT NULL DEFAULT 'not_required',
  "idempotency_key" VARCHAR(160),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "studio_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "studio_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "studio_tasks_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "studio_tasks_attempts_check" CHECK ("attempts" >= 0 AND "max_attempts" > 0)
);
CREATE UNIQUE INDEX "studio_tasks_idempotency_key_key" ON "studio_tasks"("idempotency_key");
CREATE INDEX "studio_tasks_project_status_priority_idx" ON "studio_tasks"("project_id", "status", "priority");
CREATE INDEX "studio_tasks_claim_idx" ON "studio_tasks"("status", "available_at", "priority");
CREATE INDEX "studio_tasks_lease_expiry_idx" ON "studio_tasks"("lease_expires_at");
CREATE INDEX "studio_tasks_owner_created_idx" ON "studio_tasks"("owner_user_id", "created_at" DESC);

CREATE TABLE "studio_artifacts" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "task_id" TEXT,
  "owner_user_id" TEXT NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "kind" VARCHAR(48) NOT NULL,
  "storage_provider" VARCHAR(48) NOT NULL,
  "storage_key" TEXT NOT NULL,
  "mime_type" VARCHAR(160),
  "byte_size" BIGINT,
  "sha256" VARCHAR(64),
  "provenance" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "studio_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_artifacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "studio_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "studio_artifacts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "studio_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "studio_artifacts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "studio_artifacts_byte_size_check" CHECK ("byte_size" IS NULL OR "byte_size" >= 0),
  CONSTRAINT "studio_artifacts_sha256_check" CHECK ("sha256" IS NULL OR "sha256" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "studio_artifacts_project_created_idx" ON "studio_artifacts"("project_id", "created_at" DESC);
CREATE INDEX "studio_artifacts_owner_created_idx" ON "studio_artifacts"("owner_user_id", "created_at" DESC);

CREATE TABLE "studio_events" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "task_id" TEXT,
  "owner_user_id" TEXT NOT NULL,
  "actor_id" TEXT,
  "event_type" VARCHAR(64) NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "studio_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "studio_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "studio_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "studio_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "studio_events_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "studio_events_project_created_idx" ON "studio_events"("project_id", "created_at");
CREATE INDEX "studio_events_task_created_idx" ON "studio_events"("task_id", "created_at");
CREATE INDEX "studio_events_owner_created_idx" ON "studio_events"("owner_user_id", "created_at" DESC);

-- END PRISMA MIGRATION 20261108010000_studio_native_core
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'a02855c2d896633df1c2df728df338d51458e62b5b523eb50e3fad8fafc5b1c4',now(),'20261108010000_studio_native_core',now(),1);

-- BEGIN PRISMA MIGRATION 20261108080000_agent_runs_runtime_contract
-- Additive runtime-contract repair for public.agent_runs.
-- Legacy queued/unclassified work is quarantined before the reasoning worker can
-- claim it. Workbench rows already classified as coding remain in that queue.
-- Existing running rows with a worker ID and lock timestamp retain their
-- pre-migration reasoning approval so the existing lease heartbeat/reclaim
-- contract can finish or retry them. No new work is auto-approved by this rule.
-- This migration does NOT create coding_tasks or change the production allowlist.

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS trace_context JSONB,
  ADD COLUMN IF NOT EXISTS execution_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
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
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS queue_type TEXT NOT NULL DEFAULT 'reasoning';

-- ADD COLUMN defaults populate legacy rows. Preserve only a running row that
-- has both pieces of lease evidence written by claimNextAgentRun; the worker's
-- existing cancellation, plan-binding, attempt-limit and lease-expiry checks
-- remain authoritative. Everything else in the reasoning/default queue fails
-- closed and requires explicit classification/approval.
UPDATE public.agent_runs
SET approval_status = 'pending'
WHERE queue_type IS NULL
   OR (
     queue_type = 'reasoning'
     AND NOT (
       status = 'running'
       AND worker_id IS NOT NULL
       AND locked_at IS NOT NULL
     )
   )
   OR approval_status IS NULL;

UPDATE public.agent_runs
SET queue_type = 'unclassified'
WHERE queue_type IS NULL
   OR (
     queue_type = 'reasoning'
     AND NOT (
       status = 'running'
       AND worker_id IS NOT NULL
       AND locked_at IS NOT NULL
     )
   );

ALTER TABLE public.agent_runs
  ALTER COLUMN queue_type SET DEFAULT 'reasoning',
  ALTER COLUMN queue_type SET NOT NULL,
  ALTER COLUMN approval_status SET DEFAULT 'approved',
  ALTER COLUMN approval_status SET NOT NULL;

CREATE INDEX IF NOT EXISTS agent_runs_queue_type_status_created_idx
  ON public.agent_runs (queue_type, status, created_at);

CREATE INDEX IF NOT EXISTS agent_runs_approval_status_created_idx
  ON public.agent_runs (approval_status, created_at);

-- END PRISMA MIGRATION 20261108080000_agent_runs_runtime_contract
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'6cf735b99bef5939fb306a3c3910987d92127ad0c2df59c446d3260dfd6f0d7e',now(),'20261108080000_agent_runs_runtime_contract',now(),1);

-- BEGIN PRISMA MIGRATION 20261108100000_shared_rooms_compatibility
-- Shared-room table contract for Prisma-only disposable installs.
-- Keep only the columns and primary keys present in the supplied live schema
-- snapshot. Supabase owns RLS policies; unknown constraints are not invented.
CREATE TABLE IF NOT EXISTS public.rooms (
  id UUID NOT NULL,
  name TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT rooms_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.room_members (
  room_id UUID NOT NULL,
  user_id UUID NOT NULL,
  joined_at TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT room_members_pkey PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.room_messages (
  id UUID NOT NULL,
  room_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT room_messages_pkey PRIMARY KEY (id)
);

-- END PRISMA MIGRATION 20261108100000_shared_rooms_compatibility
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'b855a19cd5b2fa9d0e3896747fbedd4fca99dbb6c8f1814a02f1cbaf3d2625a4',now(),'20261108100000_shared_rooms_compatibility',now(),1);

-- BEGIN PRISMA MIGRATION 20261108120000_correct_pending_reasoning_queue_classification
-- Correct legacy queue rows that the original coding-queue migration
-- classified using approval_status alone. Approval is a gate, not evidence
-- that a run belongs in the coding workbench.
--
-- A run remains coding only when it has explicit workbench plan or diff data.
-- This migration is deliberately additive so previously recorded migration
-- checksums remain unchanged.
UPDATE public.agent_runs
SET queue_type = 'unclassified'
WHERE queue_type = 'coding'
  AND approval_status = 'pending'
  AND plan_snapshot IS NULL
  AND proposed_diff_hash IS NULL;

-- END PRISMA MIGRATION 20261108120000_correct_pending_reasoning_queue_classification
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'d7525c68c23422354fc00942223220ef83b675b979ddea7d9396c31f5fe9b2ce',now(),'20261108120000_correct_pending_reasoning_queue_classification',now(),1);

-- BEGIN PRISMA MIGRATION 20261109100000_studio_worker_heartbeat_compatibility
-- Prisma-only compatibility contract for the Supabase-owned Studio worker heartbeat table.
-- The Supabase migration remains the owner of RLS/browser policies; this migration
-- only provisions the table for disposable Prisma validation installs.
CREATE TABLE IF NOT EXISTS public.studio_worker_heartbeats (
  worker_id VARCHAR(160) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'starting',
  started_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stopped_at TIMESTAMPTZ(6),
  metadata JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT studio_worker_heartbeats_pkey PRIMARY KEY (worker_id)
);

CREATE INDEX IF NOT EXISTS studio_worker_heartbeats_status_seen_idx
  ON public.studio_worker_heartbeats (status, last_seen_at DESC);

-- END PRISMA MIGRATION 20261109100000_studio_worker_heartbeat_compatibility
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'2c5c926dee79e89f5ba61ca1c70bb1329afacc521a30a62fd4c2f2bfa9040f12',now(),'20261109100000_studio_worker_heartbeat_compatibility',now(),1);

-- BEGIN PRISMA MIGRATION 20261117190000_comms_owner_authorization
-- Additive authorization records for owner-verified outbound communications.
-- This migration is intentionally not applied by this change or its CI workflow.

CREATE TABLE IF NOT EXISTS public.comms_verified_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('phone', 'email')),
  address text NOT NULL,
  normalized_address text NOT NULL,
  verified_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comms_verified_destinations_owner_channel_address_key
    UNIQUE (owner_user_id, channel, normalized_address)
);

CREATE INDEX IF NOT EXISTS comms_verified_destinations_owner_active_idx
  ON public.comms_verified_destinations (owner_user_id, channel, normalized_address);

CREATE TABLE IF NOT EXISTS public.comms_destination_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('phone', 'email')),
  address text NOT NULL,
  normalized_address text NOT NULL,
  provider_verification_sid text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comms_destination_challenges_owner_expiry_idx
  ON public.comms_destination_verification_challenges (owner_user_id, expires_at);

CREATE TABLE IF NOT EXISTS public.comms_send_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'voice', 'email')),
  recipient text NOT NULL,
  payload_hash char(64) NOT NULL,
  payload jsonb NOT NULL,
  policy_rule_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'dispatching', 'accepted', 'unknown', 'failed', 'rejected', 'expired')),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  dispatched_at timestamptz,
  provider_message_id text,
  provider_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comms_send_approvals_owner_status_expiry_idx
  ON public.comms_send_approvals (owner_user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS comms_send_approvals_provider_message_idx
  ON public.comms_send_approvals (provider_message_id);

-- END PRISMA MIGRATION 20261117190000_comms_owner_authorization
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'680d7b29b50eb2478dc3aabb63d244d552741f4c117cfdd563fb7f9cf46084cc',now(),'20261117190000_comms_owner_authorization',now(),1);

-- BEGIN PRISMA MIGRATION 20261118170000_intelligence_event_inbox
-- Durable, provider-neutral event inbox. Application code owns retries and lease lifecycle.
-- This migration is additive and is not applied automatically by this PR.

CREATE TABLE IF NOT EXISTS public.intelligence_event_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE,
  event_type varchar(160) NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  occurred_at timestamptz NOT NULL,
  source_provider varchar(80) NOT NULL,
  source_service varchar(80),
  correlation_id varchar(160),
  idempotency_key varchar(200) NOT NULL,
  classification varchar(16) NOT NULL
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  payload jsonb NOT NULL,
  payload_hash char(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'processed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner varchar(128),
  lease_expires_at timestamptz,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intelligence_event_inbox_provider_idempotency_key
    UNIQUE (source_provider, idempotency_key)
);

CREATE INDEX IF NOT EXISTS intelligence_event_inbox_claim_idx
  ON public.intelligence_event_inbox (status, available_at, received_at);

CREATE INDEX IF NOT EXISTS intelligence_event_inbox_lease_idx
  ON public.intelligence_event_inbox (status, lease_expires_at);

CREATE INDEX IF NOT EXISTS intelligence_event_inbox_type_received_idx
  ON public.intelligence_event_inbox (event_type, received_at DESC);

-- No client-facing policies are created. Only the trusted server database role
-- should read or mutate the inbox; external providers must use authenticated adapters.
ALTER TABLE public.intelligence_event_inbox ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.intelligence_event_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_inbox_id uuid NOT NULL REFERENCES public.intelligence_event_inbox(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  worker_id varchar(128) NOT NULL,
  status varchar(24) NOT NULL
    CHECK (status IN ('started', 'succeeded', 'retry', 'dead_letter', 'lease_expired')),
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT intelligence_event_attempt_event_attempt_key UNIQUE (event_inbox_id, attempt)
);

CREATE INDEX IF NOT EXISTS intelligence_event_attempt_event_started_idx
  ON public.intelligence_event_attempts (event_inbox_id, started_at DESC);

CREATE INDEX IF NOT EXISTS intelligence_event_attempt_status_started_idx
  ON public.intelligence_event_attempts (status, started_at DESC);

ALTER TABLE public.intelligence_event_attempts ENABLE ROW LEVEL SECURITY;

-- END PRISMA MIGRATION 20261118170000_intelligence_event_inbox
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'02139b3a661edcb22cfe656b0712728cfa931a6a75f0102fa84862a881997a58',now(),'20261118170000_intelligence_event_inbox',now(),1);

-- BEGIN PRISMA MIGRATION 20261118183000_intelligence_event_attempts_fk_update_cascade
-- Align the existing event-attempt foreign key with Prisma's explicit
-- referential action. This is a forward-only repair for databases that
-- already applied the original inbox migration.
ALTER TABLE public.intelligence_event_attempts
  DROP CONSTRAINT IF EXISTS intelligence_event_attempts_event_inbox_id_fkey;

ALTER TABLE public.intelligence_event_attempts
  ADD CONSTRAINT intelligence_event_attempts_event_inbox_id_fkey
  FOREIGN KEY (event_inbox_id)
  REFERENCES public.intelligence_event_inbox(id)
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- END PRISMA MIGRATION 20261118183000_intelligence_event_attempts_fk_update_cascade
INSERT INTO public."_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES (gen_random_uuid()::text,'2cadc590b758399818e962dd83a7eb7f3bad0af34a7f20aae55e6cf7772a67e7',now(),'20261118183000_intelligence_event_attempts_fk_update_cascade',now(),1);
