export type PluginPreference = { enabled: boolean; scopes: string[] };
export type PluginPreferences = Record<string, PluginPreference>;

const MAX_SCOPE_LENGTH = 80;
const MAX_SCOPES = 12;

/** Normalize user-owned plugin intent before it reaches a runtime gate. */
export function normalizePluginPreferences(value: unknown): PluginPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized: PluginPreferences = {};
  for (const [providerId, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as { enabled?: unknown; scopes?: unknown };
    normalized[providerId] = {
      enabled: item.enabled === true,
      scopes: Array.isArray(item.scopes)
        ? item.scopes
          .filter((scope): scope is string => typeof scope === 'string' && scope.length <= MAX_SCOPE_LENGTH)
          .slice(0, MAX_SCOPES)
        : [],
    };
  }
  return normalized;
}

export function isPluginPreferenceEnabled(preferences: PluginPreferences | unknown, providerId: string): boolean {
  return normalizePluginPreferences(preferences)[providerId]?.enabled === true;
}
