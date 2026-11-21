-- No-op baseline marker for the Supabase platform schema.
--
-- The Supabase CLI migration chain runs first in the combined local stack and
-- creates Supabase-owned Auth, Storage, RLS, and platform tables. Prisma then
-- owns the RyanAI application migration sequence. This marker initializes the
-- Prisma ledger without pretending that Prisma created the Supabase objects.
-- It must be recorded as applied after `supabase db reset --local` and before
-- the first Prisma application migration. It contains no schema DDL.
SELECT 1;
