import type { Provider, Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type RyanOAuthProvider = Extract<Provider, 'google' | 'github'>;

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase authentication is not configured.');
  }
  return supabase;
}

async function requireCurrentUser() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('A signed-in session is required.');
  return { client, user: data.user };
}

async function requireAnonymousUser() {
  const { client, user } = await requireCurrentUser();
  if (!user.is_anonymous) {
    throw new Error('This operation is only available to an anonymous session.');
  }
  return { client, user };
}

/** Create a temporary authenticated user. Pass a CAPTCHA token when CAPTCHA is enabled. */
export async function signInAnonymously(captchaToken?: string) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInAnonymously({
    options: captchaToken ? { captchaToken } : undefined,
  });
  if (error) throw error;
  if (!data.user?.is_anonymous || !data.session) {
    throw new Error('Supabase did not return an anonymous session.');
  }
  return data;
}

/** Start email identity linking on the currently signed-in anonymous account. */
export async function linkAnonymousEmail(email: string) {
  const { client } = await requireAnonymousUser();
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error('An email address is required.');
  const { data, error } = await client.auth.updateUser({ email: normalizedEmail });
  if (error) throw error;
  return data;
}

/** Set a password only after Supabase confirms the linked email identity. */
export async function setLinkedAccountPassword(password: string) {
  const { client, user } = await requireCurrentUser();
  if (user.is_anonymous) {
    throw new Error('Link and verify an email address before setting a password.');
  }
  if (!user.email_confirmed_at) {
    throw new Error('Verify your email address before setting a password.');
  }
  if (password.length < 8) {
    throw new Error('Password must contain at least 8 characters.');
  }
  const { data, error } = await client.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

/** Link Google or GitHub to the existing anonymous account; never signs into another account. */
export async function linkAnonymousOAuthIdentity(provider: RyanOAuthProvider) {
  const { client } = await requireAnonymousUser();
  const { data, error } = await client.auth.linkIdentity({
    provider,
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
  return data;
}

/** Link an additional Google or GitHub identity to the currently authenticated account. */
export async function linkOAuthIdentity(provider: RyanOAuthProvider) {
  const { client } = await requireCurrentUser();
  const { data, error } = await client.auth.linkIdentity({
    provider,
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
  return data;
}

/** Normal OAuth sign-in for users who are not linking an existing account. */
export async function signInWithOAuth(provider: RyanOAuthProvider) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: window.location.origin,
      scopes: provider === 'google' ? 'openid email profile' : 'read:user user:email',
    },
  });
  if (error) throw error;
  return data;
}

export async function getAuthSession(): Promise<Session | null> {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getVerifiedAuthUser(): Promise<User | null> {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const client = requireSupabase();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}
