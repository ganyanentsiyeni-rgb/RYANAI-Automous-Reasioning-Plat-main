import { SUPABASE_URL } from '@/lib/supabase';

const configuredSupabaseUrl = SUPABASE_URL.replace(/\/+$/, '');
const supabaseEndpoint = (path: string): string | null =>
  configuredSupabaseUrl ? `${configuredSupabaseUrl}${path}` : null;

/**
 * Public Supabase Auth OAuth/OIDC endpoints. These URLs contain no credentials;
 * provider client secrets and signing keys must remain in Supabase-managed config.
 */
export const SUPABASE_OAUTH_ENDPOINTS = Object.freeze({
  authorization: supabaseEndpoint('/auth/v1/oauth/authorize'),
  token: supabaseEndpoint('/auth/v1/oauth/token'),
  jwks: supabaseEndpoint('/auth/v1/.well-known/jwks.json'),
  openidConfiguration: supabaseEndpoint('/auth/v1/.well-known/openid-configuration'),
  authorizationServerMetadata: supabaseEndpoint('/.well-known/oauth-authorization-server/auth/v1'),
  consentPath: '/oauth/consent',
});
