export const DASHBOARD_UI_OPTIONS = [
 { id:'dashboard',label:'Dashboard',description:'Show the system dashboard and workspace shortcuts.' },
 { id:'pa',label:'Personal Assistant',description:'Show the Personal Assistant workspace.' },
 { id:'operator',label:'Operator Console',description:'Show durable task execution and progress.' },
 { id:'operations',label:'Operations Center',description:'Show operations and review tools.' },
 { id:'admin',label:'Admin Console',description:'Show administrative controls.',access:'admin' },
 { id:'quant',label:'Quant Lab',description:'Show isolated research and paper-trading tools.' },
 { id:'trading',label:'Trading Terminal',description:'Show the trading workspace.' },
 { id:'cockpit',label:'Command Cockpit',description:'Show model and platform health views.' },
 { id:'studio',label:'RyanAI Studio',description:'Show the development studio.' },
 { id:'programming',label:'Basic Programming Tools',description:'Show code editors, version control, testing tools and project planning.' },
 { id:'comms',label:'RyanAI Communications',description:'Show owner-authorised communications.',access:'owner' },
 { id:'workspace',label:'Reasoning Workspace',description:'Show chat, memory and workspace tools.' },
 { id:'audiobook',label:'Audiobook Studio',description:'Enable or disable the audiobook workspace.' },
 { id:'music',label:'RyanAI Music',description:'Show the standalone music library, VLC handoff and saved playlists.' },
 { id:'phonelink',label:'RyanAI PhoneLink',description:'Pair trusted phones and manage mobile connection permissions.' },
 { id:'inferenceConsole',label:'Inference Console',description:'Enable or disable the inference console in Workspace.' },
] as const;
export type DashboardUiId=(typeof DASHBOARD_UI_OPTIONS)[number]['id'];
export type DashboardUiPreferences=Record<DashboardUiId,boolean>;
export const AUDIOBOOK_VOICES=['alloy','ash','ballad','coral','echo','fable','onyx','nova','sage','shimmer','verse'] as const;
export type AudiobookVoice=(typeof AUDIOBOOK_VOICES)[number];
export const AUDIOBOOK_SPEEDS=[0.8,0.9,1,1.1,1.2] as const;
export interface AudiobookSettings { defaultVoice:AudiobookVoice; narrationSpeed:(typeof AUDIOBOOK_SPEEDS)[number]; }
export const DEFAULT_AUDIOBOOK_SETTINGS:AudiobookSettings={defaultVoice:'coral',narrationSpeed:1};
export function normalizeDashboardUiPreferences(value:unknown):DashboardUiPreferences {
 const result=Object.fromEntries(DASHBOARD_UI_OPTIONS.map(({id})=>[id,true])) as DashboardUiPreferences;
 if(!value||typeof value!=='object'||Array.isArray(value))return result;
 const input=value as Record<string,unknown>;
 for(const {id} of DASHBOARD_UI_OPTIONS)if(typeof input[id]==='boolean')result[id]=input[id];
 return result;
}
export function normalizeAudiobookSettings(value:unknown):AudiobookSettings {
 if(!value||typeof value!=='object'||Array.isArray(value))return {...DEFAULT_AUDIOBOOK_SETTINGS};
 const input=value as Record<string,unknown>;
 return {
  defaultVoice:AUDIOBOOK_VOICES.includes(input.defaultVoice as AudiobookVoice)?input.defaultVoice as AudiobookVoice:DEFAULT_AUDIOBOOK_SETTINGS.defaultVoice,
  narrationSpeed:AUDIOBOOK_SPEEDS.includes(input.narrationSpeed as AudiobookSettings['narrationSpeed'])?input.narrationSpeed as AudiobookSettings['narrationSpeed']:DEFAULT_AUDIOBOOK_SETTINGS.narrationSpeed,
 };
}
export function normalizeInferenceSettings(value:unknown,validModels:readonly string[],fallbackModel:string):{preferredModel:string} {
 if(!value||typeof value!=='object'||Array.isArray(value))return {preferredModel:fallbackModel};
 const candidate=(value as Record<string,unknown>).preferredModel;
 return {preferredModel:typeof candidate==='string'&&validModels.includes(candidate)?candidate:fallbackModel};
}

export const MUSIC_PROVIDERS = ['vlc', 'spotify', 'youtube-music'] as const;
export type MusicProvider = (typeof MUSIC_PROVIDERS)[number];
export interface MusicSettings { defaultProvider: MusicProvider; rememberPreferredProvider: boolean; volume: number; resumePlayback: boolean; vlcMode: 'both' | 'external' | 'embedded'; autoSaveLibrary: boolean; autoSavePlaylists: boolean; restoreLastPlaylist: boolean; }
export const DEFAULT_MUSIC_SETTINGS: MusicSettings = { defaultProvider: 'vlc', rememberPreferredProvider: true, volume: 70, resumePlayback: true, vlcMode: 'both', autoSaveLibrary: true, autoSavePlaylists: true, restoreLastPlaylist: true };
export function normalizeMusicSettings(value: unknown): MusicSettings {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_MUSIC_SETTINGS };
 const input = value as Record<string, unknown>;
 const volume = typeof input.volume === 'number' && Number.isFinite(input.volume) ? Math.min(100, Math.max(0, Math.round(input.volume))) : DEFAULT_MUSIC_SETTINGS.volume;
 return { defaultProvider: MUSIC_PROVIDERS.includes(input.defaultProvider as MusicProvider) ? input.defaultProvider as MusicProvider : DEFAULT_MUSIC_SETTINGS.defaultProvider, rememberPreferredProvider: typeof input.rememberPreferredProvider === 'boolean' ? input.rememberPreferredProvider : DEFAULT_MUSIC_SETTINGS.rememberPreferredProvider, volume, resumePlayback: typeof input.resumePlayback === 'boolean' ? input.resumePlayback : DEFAULT_MUSIC_SETTINGS.resumePlayback, vlcMode: input.vlcMode === 'external' || input.vlcMode === 'embedded' || input.vlcMode === 'both' ? input.vlcMode : DEFAULT_MUSIC_SETTINGS.vlcMode, autoSaveLibrary: typeof input.autoSaveLibrary === 'boolean' ? input.autoSaveLibrary : DEFAULT_MUSIC_SETTINGS.autoSaveLibrary, autoSavePlaylists: typeof input.autoSavePlaylists === 'boolean' ? input.autoSavePlaylists : DEFAULT_MUSIC_SETTINGS.autoSavePlaylists, restoreLastPlaylist: typeof input.restoreLastPlaylist === 'boolean' ? input.restoreLastPlaylist : DEFAULT_MUSIC_SETTINGS.restoreLastPlaylist };
}

export interface PhoneLinkSettings {
  autoReconnect: boolean;
  wifiOnlyTransfers: boolean;
  notifyComms: boolean;
  notifyTasks: boolean;
  allowShareIntake: boolean;
  requireConfirmation: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}
export const DEFAULT_PHONELINK_SETTINGS: PhoneLinkSettings = {
  autoReconnect: true, wifiOnlyTransfers: true, notifyComms: true, notifyTasks: true,
  allowShareIntake: true, requireConfirmation: true, quietHoursEnabled: false,
  quietHoursStart: '22:00', quietHoursEnd: '07:00',
};
export function normalizePhoneLinkSettings(value: unknown): PhoneLinkSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_PHONELINK_SETTINGS };
  const input = value as Record<string, unknown>;
  const validTime = (candidate: unknown, fallback: string) => typeof candidate === 'string' && /^([01]\\d|2[0-3]):[0-5]\\d$/.test(candidate) ? candidate : fallback;
  return {
    autoReconnect: typeof input.autoReconnect === 'boolean' ? input.autoReconnect : DEFAULT_PHONELINK_SETTINGS.autoReconnect,
    wifiOnlyTransfers: typeof input.wifiOnlyTransfers === 'boolean' ? input.wifiOnlyTransfers : DEFAULT_PHONELINK_SETTINGS.wifiOnlyTransfers,
    notifyComms: typeof input.notifyComms === 'boolean' ? input.notifyComms : DEFAULT_PHONELINK_SETTINGS.notifyComms,
    notifyTasks: typeof input.notifyTasks === 'boolean' ? input.notifyTasks : DEFAULT_PHONELINK_SETTINGS.notifyTasks,
    allowShareIntake: typeof input.allowShareIntake === 'boolean' ? input.allowShareIntake : DEFAULT_PHONELINK_SETTINGS.allowShareIntake,
    requireConfirmation: typeof input.requireConfirmation === 'boolean' ? input.requireConfirmation : DEFAULT_PHONELINK_SETTINGS.requireConfirmation,
    quietHoursEnabled: typeof input.quietHoursEnabled === 'boolean' ? input.quietHoursEnabled : DEFAULT_PHONELINK_SETTINGS.quietHoursEnabled,
    quietHoursStart: validTime(input.quietHoursStart, DEFAULT_PHONELINK_SETTINGS.quietHoursStart),
    quietHoursEnd: validTime(input.quietHoursEnd, DEFAULT_PHONELINK_SETTINGS.quietHoursEnd),
  };
}

export const RYANAI_REALTIME_VOICES = ['ash', 'echo', 'verse', 'cedar', 'marin', 'alloy', 'ballad', 'coral', 'sage', 'shimmer'] as const;
export type RyanAIRealtimeVoice = (typeof RYANAI_REALTIME_VOICES)[number];
export interface RyanVoiceSettings {
  realtimeVoice: RyanAIRealtimeVoice;
  anniversaryEvolution: boolean;
}
export const DEFAULT_RYAN_VOICE_SETTINGS: RyanVoiceSettings = {
  realtimeVoice: 'ash',
  anniversaryEvolution: true,
};
export function normalizeRyanVoiceSettings(value: unknown): RyanVoiceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_RYAN_VOICE_SETTINGS };
  const input = value as Record<string, unknown>;
  return {
    realtimeVoice: RYANAI_REALTIME_VOICES.includes(input.realtimeVoice as RyanAIRealtimeVoice)
      ? input.realtimeVoice as RyanAIRealtimeVoice
      : DEFAULT_RYAN_VOICE_SETTINGS.realtimeVoice,
    anniversaryEvolution: typeof input.anniversaryEvolution === 'boolean'
      ? input.anniversaryEvolution
      : DEFAULT_RYAN_VOICE_SETTINGS.anniversaryEvolution,
  };
}

export const COPILOT_PERSONALITIES = ['balanced', 'warm', 'professional', 'playful'] as const;
export type CopilotPersonality = (typeof COPILOT_PERSONALITIES)[number];
export const COPILOT_RESPONSE_STYLES = ['concise', 'balanced', 'detailed'] as const;
export type CopilotResponseStyle = (typeof COPILOT_RESPONSE_STYLES)[number];
export const COPILOT_INITIATIVE_LEVELS = ['ask-first', 'suggest', 'proactive'] as const;
export type CopilotInitiativeLevel = (typeof COPILOT_INITIATIVE_LEVELS)[number];
export const COPILOT_COLLABORATION_MODES = ['independent', 'collaborative'] as const;
export type CopilotCollaborationMode = (typeof COPILOT_COLLABORATION_MODES)[number];
export interface CopilotSettings {
  showAlexStatus: boolean;
  showDelegationPanel: boolean;
  refreshIntervalSeconds: 15 | 30 | 60;
  personality: CopilotPersonality;
  responseStyle: CopilotResponseStyle;
  initiative: CopilotInitiativeLevel;
  collaboration: CopilotCollaborationMode;
  useAccountMemory: boolean;
}

export const DEFAULT_COPILOT_SETTINGS: CopilotSettings = {
  showAlexStatus: true,
  showDelegationPanel: true,
  refreshIntervalSeconds: 30,
  personality: 'balanced',
  responseStyle: 'balanced',
  initiative: 'ask-first',
  collaboration: 'collaborative',
  useAccountMemory: true,
};

export function normalizeCopilotSettings(value: unknown): CopilotSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_COPILOT_SETTINGS };
  const input = value as Record<string, unknown>;
  return {
    showAlexStatus: typeof input.showAlexStatus === 'boolean' ? input.showAlexStatus : DEFAULT_COPILOT_SETTINGS.showAlexStatus,
    showDelegationPanel: typeof input.showDelegationPanel === 'boolean' ? input.showDelegationPanel : DEFAULT_COPILOT_SETTINGS.showDelegationPanel,
    refreshIntervalSeconds: input.refreshIntervalSeconds === 15 || input.refreshIntervalSeconds === 30 || input.refreshIntervalSeconds === 60
      ? input.refreshIntervalSeconds : DEFAULT_COPILOT_SETTINGS.refreshIntervalSeconds,
    personality: COPILOT_PERSONALITIES.includes(input.personality as CopilotPersonality)
      ? input.personality as CopilotPersonality : DEFAULT_COPILOT_SETTINGS.personality,
    responseStyle: COPILOT_RESPONSE_STYLES.includes(input.responseStyle as CopilotResponseStyle)
      ? input.responseStyle as CopilotResponseStyle : DEFAULT_COPILOT_SETTINGS.responseStyle,
    initiative: COPILOT_INITIATIVE_LEVELS.includes(input.initiative as CopilotInitiativeLevel)
      ? input.initiative as CopilotInitiativeLevel : DEFAULT_COPILOT_SETTINGS.initiative,
    collaboration: COPILOT_COLLABORATION_MODES.includes(input.collaboration as CopilotCollaborationMode)
      ? input.collaboration as CopilotCollaborationMode : DEFAULT_COPILOT_SETTINGS.collaboration,
    useAccountMemory: typeof input.useAccountMemory === 'boolean'
      ? input.useAccountMemory : DEFAULT_COPILOT_SETTINGS.useAccountMemory,
  };
}
