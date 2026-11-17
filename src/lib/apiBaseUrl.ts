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

export const API_BASE_URL =
  normalizeApiBaseUrl(configuredApiBaseUrl) ||
  (typeof window === 'undefined'
    ? 'http://localhost:3000'
    : window.location.origin);
