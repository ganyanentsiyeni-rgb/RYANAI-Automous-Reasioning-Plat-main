-- Align the existing event-attempt foreign key with Prisma's explicit
-- referential action. This is a forward-only repair for databases that
-- already applied the original inbox migration.
ALTER TABLE public.intelligence_event_attempts
  DROP CONSTRAINT IF EXISTS intelligence_event_attempts_event_inbox_id_fkey;

ALTER TABLE public.intelligence_event_attempts
  ADD CONSTRAINT intelligence_event_attempts_event_inbox_id_fkey
  FOREIGN KEY (event_inbox_id)
  REFERENCES public.intelligence_event_inbox(id)
  ON DELETE CASCADE
  ON UPDATE CASCADE;
