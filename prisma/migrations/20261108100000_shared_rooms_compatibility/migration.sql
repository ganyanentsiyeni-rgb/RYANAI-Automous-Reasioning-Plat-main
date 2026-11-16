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
