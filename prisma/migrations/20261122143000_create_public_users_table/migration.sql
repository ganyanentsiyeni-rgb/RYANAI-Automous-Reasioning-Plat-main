-- Create the Prisma-owned RyanAI application user table.
-- This is distinct from Supabase Auth's auth.users and public.profiles.
-- The application schema contains User relations targeting public.users;
-- a fresh Supabase/Prisma install must therefore create this table explicitly.

CREATE TABLE IF NOT EXISTS public.users (
  id TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT,
  name TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key
  ON public.users (email);

DO $assert_users$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'id'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'public.users.id must be a required text column';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND indexname = 'users_email_key'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'public.users.email must have the users_email_key unique index';
  END IF;
END;
$assert_users$;
