\set ON_ERROR_STOP on
-- Disposable local Supabase stack only. All fixtures are rolled back.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

INSERT INTO public.rooms (id, name, created_by, created_at)
VALUES ('20000000-0000-4000-8000-000000000001', 'RLS CI fixture',
        '10000000-0000-4000-8000-000000000001', now());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.room_members
    WHERE room_id = '20000000-0000-4000-8000-000000000001'
      AND user_id = '10000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'creator membership was not created automatically';
  END IF;
END $$;

INSERT INTO public.room_members (room_id, user_id, joined_at)
VALUES ('20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002', now());
INSERT INTO public.room_messages (id, room_id, sender_id, body, created_at)
VALUES ('30000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001', 'creator message', now());

-- Member can read room and messages, but cannot add another member.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.rooms
      WHERE id = '20000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'room member cannot read their room';
  END IF;
  IF (SELECT count(*) FROM public.room_messages
      WHERE id = '30000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'room member cannot read room messages';
  END IF;
  BEGIN
    INSERT INTO public.room_members (room_id, user_id, joined_at)
    VALUES ('20000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000003', now());
    RAISE EXCEPTION 'member unexpectedly added another member';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- An unrelated user sees no room data and cannot post into the room.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.rooms
      WHERE id = '20000000-0000-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'non-member can read room';
  END IF;
  IF (SELECT count(*) FROM public.room_messages
      WHERE id = '30000000-0000-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'non-member can read room messages';
  END IF;
  BEGIN
    INSERT INTO public.room_messages (id, room_id, sender_id, body, created_at)
    VALUES ('30000000-0000-4000-8000-000000000002',
            '20000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000003', 'unauthorized message', now());
    RAISE EXCEPTION 'non-member unexpectedly inserted a message';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Creator cannot transfer ownership or rewrite room identity.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    UPDATE public.rooms
    SET created_by = '10000000-0000-4000-8000-000000000002'
    WHERE id = '20000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'room ownership unexpectedly changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
