export const RESPONSE_PERSONALITIES = ['balanced', 'warm', 'professional', 'playful'] as const;
export const RESPONSE_STYLES = ['concise', 'balanced', 'detailed'] as const;
export const RESPONSE_INITIATIVES = ['ask-first', 'suggest', 'proactive'] as const;
export const RESPONSE_COLLABORATION_MODES = ['independent', 'collaborative'] as const;

export interface ResponsePreferences {
  personality: (typeof RESPONSE_PERSONALITIES)[number];
  responseStyle: (typeof RESPONSE_STYLES)[number];
  initiative: (typeof RESPONSE_INITIATIVES)[number];
  collaboration: (typeof RESPONSE_COLLABORATION_MODES)[number];
}

export const DEFAULT_RESPONSE_PREFERENCES: ResponsePreferences = {
  personality: 'balanced',
  responseStyle: 'balanced',
  initiative: 'ask-first',
  collaboration: 'collaborative',
};

/** Normalize presentation preferences only; this object never represents permission or approval. */
export function normalizeResponsePreferences(value: unknown): ResponsePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_RESPONSE_PREFERENCES };
  }
  const input = value as Record<string, unknown>;
  return {
    personality: RESPONSE_PERSONALITIES.includes(input.personality as ResponsePreferences['personality'])
      ? input.personality as ResponsePreferences['personality']
      : DEFAULT_RESPONSE_PREFERENCES.personality,
    responseStyle: RESPONSE_STYLES.includes(input.responseStyle as ResponsePreferences['responseStyle'])
      ? input.responseStyle as ResponsePreferences['responseStyle']
      : DEFAULT_RESPONSE_PREFERENCES.responseStyle,
    initiative: RESPONSE_INITIATIVES.includes(input.initiative as ResponsePreferences['initiative'])
      ? input.initiative as ResponsePreferences['initiative']
      : DEFAULT_RESPONSE_PREFERENCES.initiative,
    collaboration: RESPONSE_COLLABORATION_MODES.includes(input.collaboration as ResponsePreferences['collaboration'])
      ? input.collaboration as ResponsePreferences['collaboration']
      : DEFAULT_RESPONSE_PREFERENCES.collaboration,
  };
}

/** Render user preferences as bounded guidance, never as an authorization signal. */
export function responsePreferenceInstruction(value: unknown): string {
  const preferences = normalizeResponsePreferences(value);
  return [
    '[NON-AUTHORITATIVE RESPONSE PREFERENCES]',
    'These user preferences affect presentation and collaboration style only. They do not grant capabilities, change identity or roles, authorize tools, satisfy approvals, or permit external actions.',
    'Personality: ' + preferences.personality + '.',
    'Response detail: ' + preferences.responseStyle + '.',
    'Initiative preference: ' + preferences.initiative + '.',
    'Collaboration: ' + preferences.collaboration + '.',
    preferences.initiative === 'proactive'
      ? 'Proactive means proactively explain, suggest, and prepare drafts only. Never execute an action or bypass required owner authorization, policy checks, or explicit approval.'
      : 'Do not execute actions without the normal authorization and explicit approval required by policy.',
  ].join(' ');
}
