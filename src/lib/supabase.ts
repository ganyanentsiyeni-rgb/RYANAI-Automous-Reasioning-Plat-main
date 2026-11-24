import { createClient, SupabaseClient } from '@supabase/supabase-js';

// The Supabase project URL is deployment configuration. Never fall back to a
// historical project: doing so can silently bind a new frontend to the wrong
// database and produce misleading auth/data-fetch failures.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}


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

// Use PKCE so OAuth callbacks exchange the authorization code for a session.
// Keep the session in browser storage across refreshes and let the SDK refresh
// expiring tokens and detect the callback URL on initial client construction.
const authOptions = {
  flowType: 'pkce' as const,
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
};

// Explicitly typed and fail closed when configuration is missing or unsafe.
export const supabase: SupabaseClient | null =
  isValidHttpUrl(SUPABASE_URL) && supabaseKey
    ? createClient(SUPABASE_URL, supabaseKey, { auth: authOptions })
    : null;
