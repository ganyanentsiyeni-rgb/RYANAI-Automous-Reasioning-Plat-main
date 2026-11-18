/**
 * Parse explicit browser origins for the API CORS allowlist.
 *
 * Operators sometimes paste a full site URL (including a trailing slash) or a
 * Render hostname without a scheme. CORS compares the browser's origin, so
 * normalize those values to URL.origin. Never turn an empty or wildcard value
 * into an allow-all policy.
 */
export function normalizeCorsOrigin(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || candidate === '*') return null;

  const withProtocol = /^[a-z][a-z\\d+.-]*:\\/\\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      // Paths are not part of an Origin header; accepting them would conceal
      // a misconfigured allowlist entry. A single trailing slash is harmless.
      if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function parseCorsOrigins(...values: Array<string | undefined>): Set<string> {
  const origins = new Set<string>();
  for (const value of values) {
    for (const entry of value?.split(',') ?? []) {
      const origin = normalizeCorsOrigin(entry);
      if (origin) origins.add(origin);
    }
  }
  return origins;
}
