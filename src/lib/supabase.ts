import { createClient, SupabaseClient } from '@supabase/supabase-js';

// The Supabase project URL is deployment configuration. Never fall back to a
// historical project: doing so can silently bind a new frontend to the wrong
// database and produce misleading auth/data-fetch failures.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';

const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
const legacyAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const candidateKey = publishableKey || legacyAnonKey;

// Supabase secret keys (sb_secret_...) are privileged server-side credentials.
// VITE_ variables are bundled into the browser, so never pass a secret key to
// the browser client—even if it was mistakenly placed in the legacy variable.
const isSecretKey = candidateKey.startsWith('sb_secret_');
const supabaseKey = isSecretKey ? '' : candidateKey;

// Explicitly typed and fail closed when configuration is missing or unsafe.
export const supabase: SupabaseClient | null =
  SUPABASE_URL && supabaseKey ? createClient(SUPABASE_URL, supabaseKey) : null;
