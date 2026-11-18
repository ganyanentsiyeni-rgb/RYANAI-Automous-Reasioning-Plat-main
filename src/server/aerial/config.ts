export interface AerialConfig {
  enabled: boolean;
  mode: 'disabled' | 'development-simulator' | 'external';
  baseUrl: string | null;
  healthPath: string;
  inferenceUrl: string | null;
  model: string;
  timeoutMs: number;
  apiKey: string | null;
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
  const simulator = readBool(env.AERIAL_DEV_SIMULATOR);
  const baseUrl = normalizeUrl(env.AERIAL_BASE_URL);
  const inferenceUrl = normalizeUrl(env.AERIAL_INFERENCE_URL);
  const enabled = readBool(env.AERIAL_ENABLED) || simulator || Boolean(baseUrl);

  return {
    enabled,
    mode: simulator ? 'development-simulator' : baseUrl ? 'external' : 'disabled',
    baseUrl,
    healthPath: env.AERIAL_HEALTH_PATH?.trim() || '/health',
    inferenceUrl,
    model: env.AERIAL_MODEL?.trim() || 'aerial-dev',
    timeoutMs: readPositiveInt(env.AERIAL_TIMEOUT_MS, 10_000),
    apiKey: env.AERIAL_API_KEY?.trim() || null,
  };
}
