export interface AerialConfig {
  enabled: boolean;
  mode: 'disabled' | 'development-simulator' | 'external';
  baseUrl: string | null;
  healthPath: string;
  inferenceUrl: string | null;
  model: string;
  timeoutMs: number;
  apiKey: string | null;
  allowedHosts: string[];
}

function readBool(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Aerial URL must use http or https.');
  }
  if (url.username || url.password || url.hash) {
    throw new Error('Aerial URL must not contain embedded credentials or a fragment.');
  }
  return url.toString().replace(/\/$/, '');
}

export function loadAerialConfig(env: NodeJS.ProcessEnv = process.env): AerialConfig {
  const baseUrl = normalizeUrl(env.AERIAL_BASE_URL);
  // An explicit external runtime always wins over the development simulator,
  // including when AERIAL_DEV_SIMULATOR=true is left over from local testing.
  const simulator = !baseUrl && (
    readBool(env.AERIAL_DEV_SIMULATOR) || env.NODE_ENV === 'development'
  );
  const inferenceUrl = normalizeUrl(env.AERIAL_INFERENCE_URL);
  const enabled = readBool(env.AERIAL_ENABLED) || simulator || Boolean(baseUrl);

  return {
    enabled,
    mode: baseUrl ? 'external' : simulator ? 'development-simulator' : 'disabled',
    baseUrl,
    healthPath: env.AERIAL_HEALTH_PATH?.trim() || '/health',
    inferenceUrl,
    model: env.AERIAL_MODEL?.trim() || 'aerial-dev',
    timeoutMs: readPositiveInt(env.AERIAL_TIMEOUT_MS, 10_000),
    apiKey: env.AERIAL_API_KEY?.trim() || null,
    // Exact hostnames only; empty means external calls fail closed.
    allowedHosts: (env.AERIAL_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
}
