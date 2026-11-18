import { createClient, SupabaseClient } from '@supabase/supabase-js';

// The Supabase project URL is deployment configuration. Never fall back to a
// historical project: doing so can silently bind a new frontend to the wrong
// database and produce misleading auth/data-fetch failures.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

// Explicitly typed to prevent 'unknown' inference and fail closed if missing config
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
