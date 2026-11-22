import { describe, expect, it } from 'vitest';
import { isPluginPreferenceEnabled, normalizePluginPreferences } from './pluginPreference.js';

describe('plugin preference runtime gate', () => {
  it('normalizes only user preference intent', () => {
    expect(normalizePluginPreferences({
      gmail: { enabled: true, scopes: ['Gmail read-only', 123] },
      'not-an-object': 'ignored',
    })).toEqual({ gmail: { enabled: true, scopes: ['Gmail read-only'] } });
  });

  it('does not treat missing or disabled preferences as runtime eligibility', () => {
    const preferences = { gmail: { enabled: false, scopes: [] } };
    expect(isPluginPreferenceEnabled(preferences, 'gmail')).toBe(false);
    expect(isPluginPreferenceEnabled(preferences, 'google-calendar')).toBe(false);
  });

  it('keeps preference gating separate from provider authorization', () => {
    expect(isPluginPreferenceEnabled({ gmail: { enabled: true, scopes: [] } }, 'gmail')).toBe(true);
  });
});
