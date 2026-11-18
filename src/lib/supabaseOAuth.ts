import { SUPABASE_URL } from '@/lib/supabase';

/** Public OAuth 2.1 / OIDC metadata; no client secrets or signing keys are bundled. */
export const SUPABASE_OAUTH_ENDPOINTS = Object.freeze({
  authorization: `${SUPABASE_URL}/auth/v1/oauth/authorize`,
  token: `${SUPABASE_URL}/auth/v1/oauth/token`,
  jwks: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  openidConfiguration: `${SUPABASE_URL}/auth/v1/.well-known/openid-configuration`,
  authorizationServerMetadata: `${SUPABASE_URL}/.well-known/oauth-authorization-server/auth/v1`,
const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseEndpoint = (path: string): string | null =>
  configuredSupabaseUrl ? `${configuredSupabaseUrl}${path}` : null;

/** Public OAuth 2.1 / OIDC metadata; no client secrets or signing keys are bundled. */
export const SUPABASE_OAUTH_ENDPOINTS = Object.freeze({
  authorization: supabaseEndpoint('/auth/v1/oauth/authorize'),
  token: supabaseEndpoint('/auth/v1/oauth/token'),
  jwks: supabaseEndpoint('/auth/v1/.well-known/jwks.json'),
  openidConfiguration: supabaseEndpoint('/auth/v1/.well-known/openid-configuration'),
  authorizationServerMetadata: supabaseEndpoint('/.well-known/oauth-authorization-server/auth/v1'),
  consentPath: '/oauth/consent',
});
