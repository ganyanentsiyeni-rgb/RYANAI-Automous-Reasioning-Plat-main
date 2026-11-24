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

-- A user cannot create a room claiming another user's identity.
DO $shared_rooms_rls$
BEGIN
  BEGIN
    INSERT INTO public.rooms (id, name, created_by, created_at)
    VALUES ('20000000-0000-4000-8000-000000000009', 'spoofed room',
            '10000000-0000-4000-8000-000000000002', now());
    RAISE EXCEPTION 'authenticated user unexpectedly created room for another user';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $shared_rooms_rls$;

-- Member can read room and messages, but cannot add another member.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
DO $member_access$
DECLARE
  affected_rows integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM '10000000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'member JWT subject did not switch to the expected user';
  END IF;
  IF private.is_room_creator('20000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'room member was incorrectly identified as the creator';
  END IF;
  IF (SELECT count(*) FROM public.rooms
      WHERE id = '20000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'room member cannot read their room';
  END IF;
  IF (SELECT count(*) FROM public.room_messages
      WHERE id = '30000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'room member cannot read room messages';
  END IF;
  IF (SELECT count(*) FROM public.room_members
      WHERE room_id = '20000000-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'room member cannot read the complete room roster';
  END IF;

  -- RLS USING filters non-owned rows; a denied UPDATE affects zero rows
  -- rather than raising insufficient_privilege.
  UPDATE public.rooms SET name = 'member changed name'
  WHERE id = '20000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'member unexpectedly updated room';
  END IF;
  IF (SELECT name FROM public.rooms
      WHERE id = '20000000-0000-4000-8000-000000000001') <> 'RLS CI fixture' THEN
    RAISE EXCEPTION 'member changed the room name despite creator-only update policy';
  END IF;

  BEGIN
    INSERT INTO public.room_messages (id, room_id, sender_id, body, created_at)
    VALUES ('30000000-0000-4000-8000-000000000003',
            '20000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001', 'forged sender', now());
    RAISE EXCEPTION 'member unexpectedly posted with forged sender_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.room_members (room_id, user_id, joined_at)
    VALUES ('20000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000003', now());
    RAISE EXCEPTION 'member unexpectedly added another member';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $member_access$;

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
  BEGIN
    UPDATE public.rooms SET id = '20000000-0000-4000-8000-000000000008'
    WHERE id = '20000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'room id unexpectedly changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.rooms SET created_at = created_at + interval '1 second'
    WHERE id = '20000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'room creation time unexpectedly changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
