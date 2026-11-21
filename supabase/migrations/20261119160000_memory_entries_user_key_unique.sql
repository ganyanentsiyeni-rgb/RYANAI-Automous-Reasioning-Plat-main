-- Supabase owns public.memory_entries and its Auth-scoped row-level security.
-- Enforce the same (user_id, key) uniqueness as the Prisma compound unique.
-- Refuse ambiguous existing data rather than silently choosing a winner.

DO $memory_entries_unique$
BEGIN
  IF to_regclass('public.memory_entries') IS NULL THEN
    RAISE EXCEPTION 'public.memory_entries must exist before its owner/key uniqueness migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.memory_entries
    GROUP BY user_id, key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate (user_id, key) pairs found in public.memory_entries; resolve duplicates before applying this migration';
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
        'public.memory_entries_user_key_idx exists but is not the required unique (user_id, key) index';
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

-- Assert the final catalog definition. A same-named but non-unique or
-- differently ordered index must fail the migration rather than pass silently.
DO $memory_entries_unique_assert$
BEGIN
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
      'Required unique index public.memory_entries_user_key_idx(user_id, key) was not created';
  END IF;
END;
$memory_entries_unique_assert$;
