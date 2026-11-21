import { randomBytes } from 'node:crypto';
import { getRyanAIAnniversaryInfo } from '../../shared/ryanVoiceIdentity.js';
import { RYANAI_REALTIME_VOICES, type RyanAIRealtimeVoice } from '../../lib/settingsPreferences.js';

export const REALTIME_VOICE_TICKET_TTL_SECONDS = 30;

export interface VoiceTicket {
  userId: string;
  isOwner: boolean;
  language: string;
  voice: RyanAIRealtimeVoice;
  anniversaryEvolution: boolean;
  anniversaryYears: number;
  deviceId?: string;
}

export interface RedisVoiceTicketStore {
  set(key: string, value: string, expiry: 'EX', seconds: number, mode: 'NX'): Promise<string | null>;
}

export function isRealtimeVoice(value: unknown): value is RyanAIRealtimeVoice {
  return typeof value === 'string' && (RYANAI_REALTIME_VOICES as readonly string[]).includes(value);
}

export async function issueRealtimeVoiceTicket(
  redis: RedisVoiceTicketStore,
  input: {
    userId: string;
    isOwner: boolean;
    language: string;
    requestedVoice?: unknown;
    anniversaryEvolution?: boolean;
    deviceId?: string;
  },
): Promise<{ ticket: string; expiresIn: number } | null> {
  const ticket = randomBytes(32).toString('base64url');
  const configuredVoice = process.env.RYANAI_REALTIME_VOICE?.trim();
  const voice = isRealtimeVoice(configuredVoice)
    ? configuredVoice
    : isRealtimeVoice(input.requestedVoice) ? input.requestedVoice : 'ash';
  const value: VoiceTicket = {
    userId: input.userId,
    isOwner: input.isOwner,
    language: input.language,
    voice,
    anniversaryEvolution: input.anniversaryEvolution !== false,
    anniversaryYears: getRyanAIAnniversaryInfo().years,
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
  };
  const stored = await redis.set(
    `ryanai:realtime-voice:${ticket}`,
    JSON.stringify(value),
    'EX',
    REALTIME_VOICE_TICKET_TTL_SECONDS,
    'NX',
  );
  return stored === 'OK' ? { ticket, expiresIn: REALTIME_VOICE_TICKET_TTL_SECONDS } : null;
}
