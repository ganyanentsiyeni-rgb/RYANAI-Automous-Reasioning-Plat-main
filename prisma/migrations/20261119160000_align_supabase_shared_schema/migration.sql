-- Reconcile Prisma-owned models with the canonical Supabase shared-table baseline.
-- Existing timestamp-without-time-zone values are interpreted as UTC during
-- conversion. Already-timestamptz values are preserved without reinterpretation.

DO $shared_timestamp_types$
DECLARE
  item RECORD;
  current_type TEXT;
  current_precision INTEGER;
BEGIN
  FOR item IN
    SELECT *
    FROM (VALUES
      ('profiles', 'created_at'),
      ('profiles', 'updated_at'),
      ('conversations', 'created_at'),
      ('conversations', 'updated_at'),
      ('messages', 'created_at'),
      ('memory_entries', 'created_at')
    ) AS columns_to_align(table_name, column_name)
  LOOP
    SELECT data_type, datetime_precision
      INTO current_type, current_precision
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = item.table_name
      AND column_name = item.column_name;

    IF current_type IS NULL THEN
      RAISE EXCEPTION 'Required shared column public.%.% is missing', item.table_name, item.column_name;
    ELSIF current_type = 'timestamp without time zone' THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE TIMESTAMPTZ(6) USING %I AT TIME ZONE %L',
        item.table_name, item.column_name, item.column_name, 'UTC'
      );
    ELSIF current_type = 'timestamp with time zone' AND current_precision < 6 THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE TIMESTAMPTZ(6) USING %I',
        item.table_name, item.column_name, item.column_name
      );
    ELSIF current_type <> 'timestamp with time zone' THEN
      RAISE EXCEPTION
        'Unsupported type % for public.%.%; expected timestamp with or without time zone',
        current_type, item.table_name, item.column_name;
    END IF;
  END LOOP;
END;
$shared_timestamp_types$;

ALTER TABLE public.profiles
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.conversations
  ALTER COLUMN user_id SET DEFAULT auth.uid(),
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.messages
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.memory_entries
  ALTER COLUMN user_id SET DEFAULT auth.uid(),
  ALTER COLUMN created_at SET DEFAULT now();

-- The Supabase-owned messages FK uses ON DELETE CASCADE and the PostgreSQL
-- default ON UPDATE NO ACTION. Keep the Prisma-only and combined stacks equal.
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_conversation_id_fkey
  FOREIGN KEY (conversation_id)
  REFERENCES public.conversations(id)
  ON DELETE CASCADE
  ON UPDATE NO ACTION;

-- Preserve the compound unique declaration from Prisma while aligning its
-- physical index name with the Supabase-owned uniqueness migration.
DO $memory_entries_unique$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.memory_entries
    GROUP BY user_id, key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate (user_id, key) pairs found in public.memory_entries; resolve duplicates before aligning the Prisma migration history';
  END IF;

  IF to_regclass('public.memory_entries_user_key_idx') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index i
      JOIN pg_class idx ON idx.oid = i.indexrelid
      JOIN pg_namespace ns ON ns.oid = idx.relnamespace
      WHERE ns.nspname = 'public'
        AND idx.relname = 'memory_entries_user_key_idx'
        AND i.indisunique
        AND i.indisvalid
        AND i.indpred IS NULL
        AND i.indnkeyatts = 2
        AND i.indnatts = 2
        AND ARRAY(
          SELECT a.attname::text
          FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_attribute a
            ON a.attrelid = i.indrelid
           AND a.attnum = key.attnum
          WHERE key.position <= i.indnkeyatts
          ORDER BY key.position
        ) = ARRAY['user_id', 'key']::text[]
    ) THEN
      RAISE EXCEPTION
        'public.memory_entries_user_key_idx exists but does not match the expected unique (user_id, key) definition';
    END IF;

    ALTER TABLE public.memory_entries
      DROP CONSTRAINT IF EXISTS memory_entries_user_id_key_key;
  ELSIF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.memory_entries'::regclass
      AND conname = 'memory_entries_user_id_key_key'
      AND contype = 'u'
  ) THEN
    ALTER TABLE public.memory_entries
      RENAME CONSTRAINT memory_entries_user_id_key_key TO memory_entries_user_key_idx;
  ELSE
    CREATE UNIQUE INDEX memory_entries_user_key_idx
      ON public.memory_entries (user_id, key);
  END IF;
END;
$memory_entries_unique$;

CREATE INDEX IF NOT EXISTS checkpoints_thread_id_idx
  ON public.checkpoints (thread_id);

CREATE INDEX IF NOT EXISTS checkpoint_blobs_thread_id_idx
  ON public.checkpoint_blobs (thread_id);

CREATE INDEX IF NOT EXISTS checkpoint_writes_thread_id_idx
  ON public.checkpoint_writes (thread_id);
