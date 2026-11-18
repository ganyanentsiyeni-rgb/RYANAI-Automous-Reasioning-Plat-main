import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

interface AuthPageProps {
  mode?: 'signin' | 'signup';
}

type OAuthProvider = 'google' | 'github';

const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Google',
  github: 'GitHub',
};

const SUPABASE_CALLBACK_URL = (() => {
  const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\\/+$/, '');
  return projectUrl
    ? `${projectUrl}/auth/v1/callback`
    : 'the callback URL shown in Supabase Dashboard → Authentication → Sign In / Providers';
})();

function getOAuthProviderError(provider: OAuthProvider, cause: unknown): Error | null {
  if (!(cause instanceof Error)) return null;

  const providerError = cause as Error & { code?: string; status?: number };
  const message = providerError.message || '';
  if (
    providerError.status === 400 &&
    providerError.code === 'validation_failed' &&
    (/provider.*not enabled/i.test(message) || /unsupported/i.test(message))
  ) {
    return new Error(
      `${OAUTH_PROVIDER_LABELS[provider]} sign-in is not enabled for this Supabase project. Enable ${OAUTH_PROVIDER_LABELS[provider]} in Authentication → Sign In / Providers, add its OAuth Client ID and Client Secret, and use this authorized callback URL: ${SUPABASE_CALLBACK_URL}.`,
    );
  }

  return cause;
}

/**
 * Render Supabase sign-in or signup, including Google and GitHub OAuth,
 * provider errors and email confirmation. Authentication is disabled without
 * a configured client; access follows verified session state.
 */
export default function AuthPage({ mode = 'signin' }: AuthPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const isSignup = mode === 'signup';

  const handleOAuthAuth = async (provider: OAuthProvider) => {
    if (!supabase || loading) return;
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          // The app uses hash routing. Keep the OAuth callback on the origin
          // without a hash so Supabase can parse its access token/code fragment.
          // The auth-state listener below routes the restored session to the dashboard.
          redirectTo: window.location.origin,
          scopes: provider === 'google' ? 'openid email profile' : 'read:user user:email',
        },
      });
      if (authError) throw getOAuthProviderError(provider, authError) ?? authError;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : `${OAUTH_PROVIDER_LABELS[provider]} authentication failed. Please try again.`,
      );
      setLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || loading) return;
    setError('');
    setSuccess('');
    if (isSignup && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const credentials = { email: email.trim().toLowerCase(), password };
      const { data, error: authError } = isSignup
        ? await supabase.auth.signUp({
            ...credentials,
            options: { data: { full_name: fullName.trim() || undefined } },
          })
        : await supabase.auth.signInWithPassword(credentials);
      if (authError) throw authError;
      // Access is granted only by the session listener, never by form submission.
      if (isSignup && !data.session) {
        setSuccess('Check your email to confirm your account, then sign in.');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Authentication failed. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="font-display text-2xl font-bold text-cyan-200">
        {isSignup ? 'Create your RYANAI account' : 'Sign in to RYANAI'}
      </h1>
      <p className="mb-6 mt-2 text-sm text-slate-400">
        Sign in to access your dashboard and workspace.
      </p>
      {!supabase ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-400/30 p-4 text-amber-200"
        >
          Sign in is unavailable because authentication has not been configured.
          Contact your administrator.
        </p>
      ) : (
        <>
          <div className="space-y-3">
            <button
              type="button"
              data-provider="google"
              onClick={() => void handleOAuthAuth('google')}
              disabled={loading}
              className="w-full rounded-lg border border-white/15 bg-white/[0.04] p-3 font-semibold text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
            >
              {loading ? 'Please wait…' : 'Continue with Google'}
            </button>
            <button
              type="button"
              data-provider="github"
              onClick={() => void handleOAuthAuth('github')}
              disabled={loading}
              className="w-full rounded-lg border border-white/15 bg-white/[0.04] p-3 font-semibold text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
            >
              {loading ? 'Please wait…' : 'Continue with GitHub'}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-rose-300">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="mt-3 text-sm text-emerald-300">
              {success}
            </p>
          )}
          <div className="my-4 flex items-center gap-3 text-xs text-slate-500">
            <span className="h-px flex-1 bg-white/10" />
            <span>or use email</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <fieldset
              disabled={loading}
              className="space-y-4 disabled:opacity-60"
            >
              {isSignup && (
                <label className="block text-sm">
                  Full name (optional)
                  <input
                    autoComplete="name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    className="mt-1 block w-full rounded-lg bg-slate-800 p-3"
                  />
                </label>
              )}
              <label className="block text-sm">
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 block w-full rounded-lg bg-slate-800 p-3"
                />
              </label>
              <label className="block text-sm">
                Password
                <input
                  type="password"
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  required
                  minLength={isSignup ? 8 : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1 block w-full rounded-lg bg-slate-800 p-3"
                />
              </label>
              {isSignup && (
                <label className="block text-sm">
                  Confirm password
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="mt-1 block w-full rounded-lg bg-slate-800 p-3"
                  />
                </label>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-cyan-500/20 p-3 font-semibold text-cyan-200 disabled:opacity-60"
              >
                {loading
                  ? 'Please wait…'
                  : isSignup
                    ? 'Create account'
                    : 'Sign in'}
              </button>
            </fieldset>
          </form>
        </>
      )}
      {error && !supabase && (
        <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>
      )}
      <a
        href={isSignup ? '#/signin' : '#/signup'}
        className="mt-5 text-sm text-cyan-300"
      >
        {isSignup
          ? 'Already have an account? Sign in'
          : 'New to RYANAI? Sign up'}
      </a>
    </section>
  );
}
