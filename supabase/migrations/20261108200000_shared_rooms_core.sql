-- Shared-room table contract from the supplied live schema snapshot.
-- The snapshot supplies column types and primary keys, but not the original
-- foreign keys, indexes, helper-function bodies, or policy expressions.
-- Preserve only the verified table shape here. RLS is enabled fail-closed;
-- restore the original policies only after their exact definitions are recovered.
CREATE TABLE IF NOT EXISTS public.rooms (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.room_members (
  room_id UUID NOT NULL,
  user_id UUID NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.room_messages (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;
