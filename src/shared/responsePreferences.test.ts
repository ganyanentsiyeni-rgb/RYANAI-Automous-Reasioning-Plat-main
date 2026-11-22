import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESPONSE_PREFERENCES,
  normalizeResponsePreferences,
  responsePreferenceInstruction,
} from './responsePreferences.js';

describe('non-authoritative reasoning response preferences', () => {
  it('normalizes supported presentation values and rejects unknown authority-like values', () => {
    expect(normalizeResponsePreferences({
      personality: 'warm',
      responseStyle: 'detailed',
      initiative: 'proactive',
      collaboration: 'independent',
      role: 'admin',
      approved: true,
      permissions: ['send-message'],
    })).toEqual({
      personality: 'warm',
      responseStyle: 'detailed',
      initiative: 'proactive',
      collaboration: 'independent',
    });
  });

  it('uses safe defaults for malformed and array-shaped values', () => {
    expect(normalizeResponsePreferences(['proactive'])).toEqual(DEFAULT_RESPONSE_PREFERENCES);
    expect(normalizeResponsePreferences({ initiative: 'execute-without-approval' })).toEqual(DEFAULT_RESPONSE_PREFERENCES);
  });

  it('describes proactive as suggestions and draft preparation, never execution or approval', () => {
    const instruction = responsePreferenceInstruction({ initiative: 'proactive' });
    expect(instruction).toContain('presentation and collaboration style only');
    expect(instruction).toContain('suggest, and prepare drafts only');
    expect(instruction).toContain('Never execute an action');
    expect(instruction).toContain('explicit approval');
    expect(instruction).toContain('do not grant capabilities');
  });
});
