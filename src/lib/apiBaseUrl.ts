const configuredApiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  import.meta.env.VITE_API_URL?.trim();

/**
 * Render service references expose RENDER_EXTERNAL_HOSTNAME without a scheme.
 * Browser fetch and URL parsing require an absolute URL, so normalize host-only
 * values to HTTPS while preserving explicit local HTTP URLs for development.
 */
export function normalizeApiBaseUrl(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
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
      const hostname = new URL(normalized).hostname.toLowerCase();
      const isLoopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
      if (isLoopback) return browserOrigin;
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
