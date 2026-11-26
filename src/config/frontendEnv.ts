export interface FrontendEnvironment {
  apiBaseUrl: string;
  appEnvironment: 'development' | 'staging' | 'production';
}

const SAFE_PUBLIC_KEY_NAMES = new Set([
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
]);

const SECRET_NAME_PATTERN =
  /(SECRET|PRIVATE[_-]?KEY|PASSWORD|DATABASE_URL|DIRECT_URL|REDIS_URL|AUTH[_-]?TOKEN|ACCESS[_-]?TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|TWILIO_AUTH_TOKEN|API[_-]?KEY)/i;

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host === '::'
    || host === '::1'
    || host === '0.0.0.0'
    || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Validate the values that Vite can expose to browser code.
 * Supabase anon/publishable keys are intentionally allowed; service-role and
 * provider credentials are not. This is a name/value boundary, not a secret
 * scanner for arbitrary source files.
 */
export function validateFrontendEnvironment(
  values: Record<string, string | boolean | undefined>,
  mode: string,
): FrontendEnvironment {
  const exposedSecretNames = Object.keys(values).filter((key) =>
    key.startsWith('VITE_')
    && SECRET_NAME_PATTERN.test(key)
    && !SAFE_PUBLIC_KEY_NAMES.has(key),
  );

  if (exposedSecretNames.length > 0) {
    throw new Error(
      '[SECURITY GATE FAILURE] Server-only credentials must never use VITE_* names: '
      + exposedSecretNames.sort().join(', '),
    );
  }

  const configuredApiUrl = String(
    values.VITE_API_BASE_URL || values.VITE_API_URL || '',
  ).trim();

  const configuredEnvironment = String(values.VITE_APP_ENV ?? '').trim().toLowerCase();
  const appEnvironment = configuredEnvironment === 'staging' || mode === 'staging'
    ? 'staging'
    : configuredEnvironment === 'production' || mode === 'production'
      ? 'production'
      : 'development';

  if (!configuredApiUrl) {
    if (appEnvironment !== 'development') {
      throw new Error(
        '[CONFIG ERROR] VITE_API_BASE_URL is required for staging/production builds.',
      );
    }
    return { apiBaseUrl: '', appEnvironment };
  }

  let apiUrl: URL;
  try {
    apiUrl = new URL(configuredApiUrl);
  } catch {
    throw new Error('[CONFIG ERROR] VITE_API_BASE_URL must be an absolute HTTP(S) URL.');
  }

  if (!['http:', 'https:'].includes(apiUrl.protocol)) {
    throw new Error('[CONFIG ERROR] VITE_API_BASE_URL must use HTTP or HTTPS.');
  }
  if (apiUrl.username || apiUrl.password) {
    throw new Error('[SECURITY GATE FAILURE] API URLs must not contain embedded credentials.');
  }

  if (appEnvironment !== 'development') {
    if (apiUrl.protocol !== 'https:') {
      throw new Error('[SECURITY GATE FAILURE] Staging/production API URLs must use HTTPS.');
    }
    if (isLoopbackHostname(apiUrl.hostname)) {
      throw new Error(
        '[DEPLOY GATE FAILURE] Loopback API endpoints are forbidden in staging/production builds.',
      );
    }
  }

  return {
    apiBaseUrl: configuredApiUrl.replace(/\/+$/, ''),
    appEnvironment,
  };
}
