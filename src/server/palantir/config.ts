export type PalantirMode = 'disabled' | 'external-read-only';

export interface PalantirConfig {
  enabled: boolean;
  mode: PalantirMode;
  baseUrl: string | null;
  timeoutMs: number;
  readonly: true;
}

function readBool(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Loads only non-secret Palantir connection metadata.
 * Credentials are intentionally not read from environment or repository code here.
 */
export function loadPalantirConfig(env: NodeJS.ProcessEnv = process.env): PalantirConfig {
  if (!readBool(env.PALANTIR_ENABLED)) {
    return {
      enabled: false,
      mode: 'disabled',
      baseUrl: null,
      timeoutMs: readPositiveInt(env.PALANTIR_TIMEOUT_MS, 10_000),
      readonly: true,
    };
  }

  const rawBaseUrl = env.PALANTIR_BASE_URL?.trim();
  if (!rawBaseUrl) {
    throw new Error('PALANTIR_BASE_URL is required when PALANTIR_ENABLED=true.');
  }

  const url = new URL(rawBaseUrl);
  const localDevelopmentHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localDevelopmentHost && env.NODE_ENV === 'development')) {
    throw new Error('Palantir base URL must use HTTPS (HTTP is allowed only for localhost development).');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Palantir base URL must not contain credentials, query parameters, or fragments.');
  }

  return {
    enabled: true,
    mode: 'external-read-only',
    baseUrl: url.toString().replace(/\/$/, ''),
    timeoutMs: readPositiveInt(env.PALANTIR_TIMEOUT_MS, 10_000),
    readonly: true,
  };
}
