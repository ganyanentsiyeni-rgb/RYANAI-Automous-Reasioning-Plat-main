import { useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './lib/supabase';
import { AuthContext, type AuthValue, type OAuthProvider } from './authContext';

const redirectTo = makeRedirectUri({ scheme: 'ryanai', path: 'auth/callback' });
// A deep-link event and WebBrowser result can deliver the same callback nearly
// simultaneously. Share the in-flight exchange so both callers await one result.
const oauthCodeExchanges = new Map<string, Promise<void>>();

async function completeOAuthCallback(url: string) {
  const callback = new URL(url);
  const errorDescription = callback.searchParams.get('error_description') ?? callback.searchParams.get('error');
  if (errorDescription) throw new Error(errorDescription);
  if (callback.protocol !== 'ryanai:' || callback.hostname !== 'auth' || callback.pathname !== '/callback') {
    throw new Error('Unexpected OAuth callback URL.');
  }

  // Supabase PKCE flow returns a one-time authorization code in the query.
  const code = callback.searchParams.get('code');
  if (!code) return;

  const existingExchange = oauthCodeExchanges.get(code);
  if (existingExchange) {
    await existingExchange;
    return;
  }

  const exchange = supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
    if (error) throw error;
  });
  oauthCodeExchanges.set(code, exchange);

  try {
    await exchange;
  } catch (error) {
    // Permit a deliberate retry if the exchange failed before a session was made.
    oauthCodeExchanges.delete(code);
    throw error;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let authChanged = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      authChanged = true;
      setSession(next?.user.is_anonymous ? null : next);
      setLoading(false);
    });

    void supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active || authChanged) return;
        setSession(error || data.session?.user.is_anonymous ? null : data.session);
        setLoading(false);
      })
      .catch(() => {
        if (!active || authChanged) return;
        setSession(null);
        setLoading(false);
      });

    const handleUrl = (url: string) => {
      let callback: URL;
      try {
        callback = new URL(url);
      } catch {
        return;
      }
      if (callback.protocol !== 'ryanai:' || callback.hostname !== 'auth' || callback.pathname !== '/callback') return;
      void completeOAuthCallback(url).catch((error: unknown) => {
        console.error('Mobile OAuth callback failed:', error);
      });
    };

    const subscriptionLink = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    void Linking.getInitialURL().then((url) => {
      if (active && url) handleUrl(url);
    }).catch(() => undefined);

    return () => {
      active = false;
      subscription.unsubscribe();
      subscriptionLink.remove();
    };
  }, []);

  const value = useMemo<AuthValue>(() => ({
    session,
    loading,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
    },
    async signInWithOAuth(provider: OAuthProvider) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          scopes: provider === 'google' ? 'openid email profile' : 'read:user user:email',
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error('Supabase did not return an OAuth authorization URL.');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') {
        await completeOAuthCallback(result.url);
        return;
      }
      if (result.type === 'cancel' || result.type === 'dismiss') return;
      throw new Error('OAuth sign-in did not complete. Please try again.');
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  }), [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
