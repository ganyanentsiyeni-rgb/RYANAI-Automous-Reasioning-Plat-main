import { afterEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ url: 'https://example.supabase.co/' }));
vi.mock('@/lib/supabase', () => ({ SUPABASE_URL: mock.url }));

afterEach(() => {
  vi.resetModules();
  mock.url = 'https://example.supabase.co/';
});

describe('Supabase OAuth endpoint configuration', () => {
  it('builds the Auth and OIDC endpoints from the configured project URL', async () => {
    const { SUPABASE_OAUTH_ENDPOINTS } = await import('./supabaseOAuth');
    expect(SUPABASE_OAUTH_ENDPOINTS).toEqual({
      authorization: 'https://example.supabase.co/auth/v1/oauth/authorize',
      token: 'https://example.supabase.co/auth/v1/oauth/token',
      jwks: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
      openidConfiguration: 'https://example.supabase.co/auth/v1/.well-known/openid-configuration',
      authorizationServerMetadata: 'https://example.supabase.co/.well-known/oauth-authorization-server/auth/v1',
      consentPath: '/oauth/consent',
    });
  });

  it('does not emit malformed project endpoints when Supabase is not configured', async () => {
    vi.resetModules();
    mock.url = '';
    const { SUPABASE_OAUTH_ENDPOINTS } = await import('./supabaseOAuth');
    expect(SUPABASE_OAUTH_ENDPOINTS.authorization).toBeNull();
    expect(SUPABASE_OAUTH_ENDPOINTS.token).toBeNull();
    expect(SUPABASE_OAUTH_ENDPOINTS.jwks).toBeNull();
    expect(SUPABASE_OAUTH_ENDPOINTS.openidConfiguration).toBeNull();
    expect(SUPABASE_OAUTH_ENDPOINTS.authorizationServerMetadata).toBeNull();
  });
});
