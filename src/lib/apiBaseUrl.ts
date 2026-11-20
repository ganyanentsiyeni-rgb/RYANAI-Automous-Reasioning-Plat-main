const configuredApiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  import.meta.env.VITE_API_URL?.trim();

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

/**
 * Render service references expose RENDER_EXTERNAL_HOSTNAME without a scheme.
 * Browser fetch and URL parsing require an absolute URL. Use HTTP only for
 * loopback development targets; hosted service hostnames default to HTTPS.
 */
export function normalizeApiBaseUrl(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }

  let protocol = 'https';
  try {
    const candidate = new URL(`http://${trimmed}`);
    if (isLoopbackHostname(candidate.hostname)) protocol = 'http';
  } catch {
    // Leave malformed host-only values on the secure default; URL consumers
    // will report the invalid configuration rather than silently rewriting it.
  }

  return `${protocol}://${trimmed}`.replace(/\/+$/, '');
}

/**
 * A loopback API URL is meaningful to the Vite server inside Codespaces, not
 * to the user's remote browser. In development, send browser requests to the
 * frontend origin so Vite can proxy /api and /health to that loopback target.
 * Keep remote hosted API URLs direct, and keep production behavior unchanged.
 */
export function resolveApiBaseUrl(
  configuredValue: string | undefined,
  isDevelopment: boolean,
  browserOrigin?: string,
): string {
  const normalized = normalizeApiBaseUrl(configuredValue);

  if (isDevelopment && normalized && browserOrigin) {
    try {
      if (isLoopbackHostname(new URL(normalized).hostname)) return browserOrigin;
    } catch {
      // Preserve the configured value below; callers will surface invalid URLs.
    }
  }

  return normalized || browserOrigin || 'http://localhost:3000';
}

export const API_BASE_URL = resolveApiBaseUrl(
  configuredApiBaseUrl,
  import.meta.env.DEV,
  typeof window === 'undefined' ? undefined : window.location.origin,
);
