-- Mirror the Supabase-owned checkpoint_writes primary-key repair in
-- Prisma-only installs. Supabase fresh stacks may already have the six-key
-- primary key; in that case this migration is an idempotent assertion.
-- Historical migrations remain unchanged.

DO $checkpoint_writes_primary_key$
DECLARE
  current_pk_name TEXT;
  current_pk_columns TEXT[];
  expected_legacy_columns TEXT[] := ARRAY[
    'thread_id', 'checkpoint_ns', 'checkpoint_id', 'task_id', 'idx'
  ];
  expected_columns TEXT[] := ARRAY[
    'thread_id', 'checkpoint_ns', 'checkpoint_id', 'task_id', 'idx', 'channel'
  ];
  has_duplicates BOOLEAN;
BEGIN
  IF to_regclass('public.checkpoint_writes') IS NULL THEN
    RAISE EXCEPTION
      'Expected public.checkpoint_writes before the Prisma checkpoint primary-key repair';
  END IF;

  SELECT c.conname,
         array_agg(a.attname::text ORDER BY key_column.ordinality)
    INTO current_pk_name, current_pk_columns
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY
      AS key_column(attnum, ordinality)
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = key_column.attnum
   WHERE c.conrelid = 'public.checkpoint_writes'::regclass
     AND c.contype = 'p'
   GROUP BY c.oid, c.conname;

  IF current_pk_name IS NULL THEN
    RAISE EXCEPTION
      'Refusing checkpoint_writes repair: primary key is missing';
  END IF;

  IF current_pk_columns = expected_columns THEN
    RAISE NOTICE
      'checkpoint_writes already has the expected six-column primary key';
    RETURN;
  END IF;

  IF current_pk_columns IS DISTINCT FROM expected_legacy_columns THEN
    RAISE EXCEPTION
      'Refusing checkpoint_writes repair: unexpected primary key columns %',
      current_pk_columns;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'checkpoint_writes'
      AND column_name = 'channel'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION
      'Refusing checkpoint_writes repair: required non-null channel column is missing';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.checkpoint_writes
    GROUP BY thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel
    HAVING count(*) > 1
  ) INTO has_duplicates;

  IF has_duplicates THEN
    RAISE EXCEPTION
      'Refusing checkpoint_writes repair: duplicate rows exist for the intended six-column key';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.checkpoint_writes DROP CONSTRAINT %I',
    current_pk_name
  );

  ALTER TABLE public.checkpoint_writes
    ADD CONSTRAINT checkpoint_writes_pkey
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel);
END
$checkpoint_writes_primary_key$;
