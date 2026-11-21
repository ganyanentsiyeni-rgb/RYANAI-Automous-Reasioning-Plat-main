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
