-- Shared Rooms: owner/member RLS and creator membership.
-- Based on the verified live U2EB schema:
--   rooms(id, name, created_by, created_at)
--   room_members(room_id, user_id, joined_at)
--   room_messages(id, room_id, sender_id, body, created_at)
-- Existing grants are intentionally unchanged. No foreign keys are added here:
-- their absence was verified, but deletion/retention semantics and auth.users
-- lifecycle behavior have not yet been approved.
--
-- This migration is intended for isolated staging validation first.
-- Rollback: drop the three policies per table, the three triggers, the three
-- private functions, and the private schema only after confirming no other
-- objects depend on it. Do not run rollback in production without approval.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

-- These helpers accept no caller-supplied user identity. They always evaluate
-- the current JWT subject and execute as the tightly scoped function owner,
-- avoiding recursive RLS when policies inspect room_members / rooms.
CREATE OR REPLACE FUNCTION private.is_room_member(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.room_members AS rm
    WHERE rm.room_id = p_room_id
      AND rm.user_id = (SELECT auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_room_creator(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.rooms AS r
    WHERE r.id = p_room_id
      AND r.created_by = (SELECT auth.uid())
  );
$function$;

REVOKE ALL ON FUNCTION private.is_room_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_room_creator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_room_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_room_creator(uuid) TO authenticated;

-- Creator membership is established atomically with room creation.
CREATE OR REPLACE FUNCTION private.add_room_creator_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL
     AND NEW.created_by IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'created_by must match the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.room_members (room_id, user_id, joined_at)
  VALUES (NEW.id, NEW.created_by, NEW.created_at)
  ON CONFLICT (room_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.add_room_creator_membership() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rooms_add_creator_membership ON public.rooms;
CREATE TRIGGER trg_rooms_add_creator_membership
AFTER INSERT ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION private.add_room_creator_membership();

-- Room identity and ownership are immutable after creation. Room names remain
-- editable by the creator through the existing UPDATE grant.
CREATE OR REPLACE FUNCTION private.protect_room_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'room id, creator, and creation time are immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.protect_room_identity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rooms_protect_identity ON public.rooms;
CREATE TRIGGER trg_rooms_protect_identity
BEFORE UPDATE ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION private.protect_room_identity();

-- Remove only policies owned by this migration; never drop unrelated policies.
DROP POLICY IF EXISTS rooms_select_creator_or_member ON public.rooms;
DROP POLICY IF EXISTS rooms_insert_authenticated_creator ON public.rooms;
DROP POLICY IF EXISTS rooms_update_creator_only ON public.rooms;
DROP POLICY IF EXISTS room_members_select_self_or_room_member ON public.room_members;
DROP POLICY IF EXISTS room_members_insert_creator_only ON public.room_members;
DROP POLICY IF EXISTS room_messages_select_room_member ON public.room_messages;
DROP POLICY IF EXISTS room_messages_insert_member_as_sender ON public.room_messages;

CREATE POLICY rooms_select_creator_or_member
ON public.rooms
FOR SELECT
TO authenticated
USING (
  created_by = (SELECT auth.uid())
  OR private.is_room_member(id)
);

CREATE POLICY rooms_insert_authenticated_creator
ON public.rooms
FOR INSERT
TO authenticated
WITH CHECK (created_by = (SELECT auth.uid()));

CREATE POLICY rooms_update_creator_only
ON public.rooms
FOR UPDATE
TO authenticated
USING (private.is_room_creator(id))
WITH CHECK (created_by = (SELECT auth.uid()));

-- Members can see the roster only for rooms they belong to; users can also
-- retrieve their own membership row. Only a room creator may add members.
CREATE POLICY room_members_select_self_or_room_member
ON public.room_members
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR private.is_room_member(room_id)
);

CREATE POLICY room_members_insert_creator_only
ON public.room_members
FOR INSERT
TO authenticated
WITH CHECK (private.is_room_creator(room_id));

CREATE POLICY room_messages_select_room_member
ON public.room_messages
FOR SELECT
TO authenticated
USING (private.is_room_member(room_id));

CREATE POLICY room_messages_insert_member_as_sender
ON public.room_messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND private.is_room_member(room_id)
);

COMMIT;
