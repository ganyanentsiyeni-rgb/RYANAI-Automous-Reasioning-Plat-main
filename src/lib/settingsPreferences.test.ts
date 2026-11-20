import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIOBOOK_SETTINGS,
  DEFAULT_COPILOT_SETTINGS,
  DEFAULT_MUSIC_SETTINGS,
  DEFAULT_PHONELINK_SETTINGS,
  DEFAULT_RYAN_VOICE_SETTINGS,
  normalizeAudiobookSettings,
  normalizeCopilotSettings,
  normalizeDashboardUiPreferences,
  normalizeInferenceSettings,
  normalizeMusicSettings,
  normalizePhoneLinkSettings,
  normalizeRyanVoiceSettings,
} from './settingsPreferences';

describe('RyanAI dashboard and inference preferences', () => {
  it('enables modules by default', () => {
    expect(Object.values(normalizeDashboardUiPreferences(undefined)).every(Boolean)).toBe(true);
  });

  it('preserves valid module choices and ignores malformed values', () => {
    const preferences = normalizeDashboardUiPreferences({ dashboard: false, admin: 'on', unknown: false });
    expect(preferences.dashboard).toBe(false);
    expect(preferences.admin).toBe(true);
  });

  it('accepts only a model from the supported catalogue', () => {
    expect(normalizeInferenceSettings({ preferredModel: 'bad' }, ['a'], 'a')).toEqual({ preferredModel: 'a' });
  });
});

describe('RyanAI audiobook preferences', () => {
  it('uses safe defaults and validates voice and narration speed', () => {
    expect(normalizeAudiobookSettings(undefined)).toEqual(DEFAULT_AUDIOBOOK_SETTINGS);
    expect(normalizeAudiobookSettings({ defaultVoice: 'nova', narrationSpeed: 1.2 })).toEqual({ defaultVoice: 'nova', narrationSpeed: 1.2 });
    expect(normalizeAudiobookSettings({ defaultVoice: 'bad', narrationSpeed: 9 })).toEqual(DEFAULT_AUDIOBOOK_SETTINGS);
  });
});

describe('RyanAI music preference validation', () => {
  it('uses safe defaults', () => expect(normalizeMusicSettings(undefined)).toEqual(DEFAULT_MUSIC_SETTINGS));

  it('accepts supported providers and VLC modes', () => {
    expect(normalizeMusicSettings({ defaultProvider: 'vlc', vlcMode: 'both', volume: 45, resumePlayback: false }))
      .toMatchObject({ defaultProvider: 'vlc', vlcMode: 'both', volume: 45, resumePlayback: false });
  });

  it('clamps volume and rejects unknown providers or modes', () => {
    expect(normalizeMusicSettings({ defaultProvider: 'bad', vlcMode: 'invalid', volume: 150 }))
      .toMatchObject({ defaultProvider: 'vlc', vlcMode: 'both', volume: 100 });
  });

  it('normalizes malformed values safely', () => {
    expect(normalizeMusicSettings({ volume: 'loud' })).toEqual(DEFAULT_MUSIC_SETTINGS);
  });
});

describe('RyanAI PhoneLink preference validation', () => {
  it('uses privacy-conscious defaults', () => expect(normalizePhoneLinkSettings(undefined)).toEqual(DEFAULT_PHONELINK_SETTINGS));

  it('preserves explicit permission and transfer choices', () => {
    expect(normalizePhoneLinkSettings({ wifiOnlyTransfers: false, allowShareIntake: false, quietHoursEnabled: true, quietHoursStart: '21:30', quietHoursEnd: '06:45' }))
      .toMatchObject({ wifiOnlyTransfers: false, allowShareIntake: false, quietHoursEnabled: true, quietHoursStart: '21:30', quietHoursEnd: '06:45' });
  });

  it('rejects malformed time values and non-boolean preferences', () => {
    expect(normalizePhoneLinkSettings({ quietHoursStart: '25:61', autoReconnect: 'yes' }))
      .toMatchObject({ quietHoursStart: '22:00', autoReconnect: true });
  });
});

describe('RyanAI realtime voice preferences', () => {
  it('defaults to Ash with anniversary evolution enabled', () => expect(normalizeRyanVoiceSettings(undefined)).toEqual(DEFAULT_RYAN_VOICE_SETTINGS));

  it('accepts supported voice presets and explicit evolution preferences', () => {
    expect(normalizeRyanVoiceSettings({ realtimeVoice: 'echo', anniversaryEvolution: false }))
      .toEqual({ realtimeVoice: 'echo', anniversaryEvolution: false });
  });

  it('rejects unsupported voices and malformed evolution flags', () => {
    expect(normalizeRyanVoiceSettings({ realtimeVoice: 'child-voice', anniversaryEvolution: 'yes' }))
      .toEqual(DEFAULT_RYAN_VOICE_SETTINGS);
  });
});

describe('RyanAI Copilot preference contract', () => {
  it('uses safe defaults when preferences are absent', () => expect(normalizeCopilotSettings(undefined)).toEqual(DEFAULT_COPILOT_SETTINGS));

  it('preserves supported behavior and presentation preferences', () => {
    expect(normalizeCopilotSettings({ personality: 'warm', responseStyle: 'detailed', initiative: 'suggest', collaboration: 'independent', useAccountMemory: false, showAlexStatus: false, showDelegationPanel: true, refreshIntervalSeconds: 60 }))
      .toEqual({ personality: 'warm', responseStyle: 'detailed', initiative: 'suggest', collaboration: 'independent', useAccountMemory: false, showAlexStatus: false, showDelegationPanel: true, refreshIntervalSeconds: 60 });
  });

  it('rejects unknown enum values and malformed memory flags', () => {
    expect(normalizeCopilotSettings({ personality: 'unbounded', responseStyle: 'verbose', initiative: 'execute-without-approval', collaboration: 'unknown', useAccountMemory: 'yes' }))
      .toEqual(DEFAULT_COPILOT_SETTINGS);
  });

  it('rejects array-shaped preference payloads', () => expect(normalizeCopilotSettings(['warm'])).toEqual(DEFAULT_COPILOT_SETTINGS));
});
