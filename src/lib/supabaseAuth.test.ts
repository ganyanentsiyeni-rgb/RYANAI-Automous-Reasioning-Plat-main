// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('./supabase', () => ({
  supabase: { auth },
}));

import { getAuthSession, signInWithOAuth, signOut } from './supabaseAuth';

describe('Supabase browser authentication lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    auth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://provider.example/oauth' }, error: null });
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    auth.signOut.mockResolvedValue({ error: null });
  });

  it('starts Google sign-in with the app origin as the OAuth callback destination', async () => {
    await signInWithOAuth('google');

    expect(auth.signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: 'openid email profile',
      },
    });
  });

  it('restores the session returned by Supabase after a page reload', async () => {
    const persistedSession = {
      access_token: 'test-access-token',
      user: { id: 'persisted-user', email: 'persisted@example.com' },
    };
    auth.getSession.mockResolvedValue({
      data: { session: persistedSession },
      error: null,
    });

    await expect(getAuthSession()).resolves.toEqual(persistedSession);
    expect(auth.getSession).toHaveBeenCalledOnce();
  });

  it('completes sign-out through the shared Supabase client', async () => {
    await expect(signOut()).resolves.toBeUndefined();
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it('propagates OAuth initiation errors instead of pretending sign-in succeeded', async () => {
    const failure = new Error('OAuth provider unavailable');
    auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: failure });

    await expect(signInWithOAuth('google')).rejects.toBe(failure);
  });
});
