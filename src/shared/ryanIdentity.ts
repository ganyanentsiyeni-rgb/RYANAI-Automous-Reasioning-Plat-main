import { OWNER_DEFAULT_LANGUAGE, isRyanLanguage, languageInstruction } from './languages.js';
export const RYANAI_LOCALE = 'en-ZA';
export const RYANAI_TIME_ZONE = 'Africa/Johannesburg';

export interface RyanAIIdentity {
  displayName?: string | null;
  email?: string | null;
  isOwner?: boolean;
}

export function getAddress(identity: RyanAIIdentity): string {
  if (identity.isOwner) return 'Sir G';
  const name = identity.displayName?.trim();
  if (name) return name;
  const emailName = identity.email?.split('@')[0]?.trim();
  return emailName || 'there';
}

/** Human-readable local weekday, full date, and 24-hour time for the owner. */
export function getLocalDateTimeContext(date = new Date()): string {
  const weekdayAndDate = new Intl.DateTimeFormat(RYANAI_LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: RYANAI_TIME_ZONE,
  }).format(date);
  const localTime = new Intl.DateTimeFormat(RYANAI_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: RYANAI_TIME_ZONE,
  }).format(date);
  return `${weekdayAndDate} at ${localTime} (${RYANAI_TIME_ZONE})`;
}

/** Greeting bands are evaluated against Johannesburg local time, not server time. */
export function getTimeGreeting(date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat(RYANAI_LOCALE, {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: RYANAI_TIME_ZONE,
  }).format(date));
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 21) return 'Good evening';
  return 'Good night';
}

export function createLoginGreeting(identity: RyanAIIdentity, date = new Date()): string {
  return `${getTimeGreeting(date)}, ${getAddress(identity)}. Today is ${getLocalDateTimeContext(date)}. I'm RyanAI. Your assistant is ready.`;
}

export function getOwnerResponseLanguage(): string {
  const configured = process.env.RYANAI_OWNER_LANGUAGE?.trim();
  return configured && isRyanLanguage(configured) ? configured : OWNER_DEFAULT_LANGUAGE;
}

export function ownerCommunicationInstruction(): string {
  const title = process.env.RYANAI_OWNER_TITLE?.trim() || 'Sir G';
  return [
    'You are RyanAI, the personal assistant for the verified owner.',
    `Address the owner respectfully as ${title} in every direct reply.`,
    languageInstruction(getOwnerResponseLanguage()),
    `The owner's current local date and time is ${getLocalDateTimeContext()}. Use this as the authoritative context for greetings, relative dates, weekdays, and scheduling; do not infer time from the server timezone.`,
    'When the owner writes in another language, understand it and respond in that language unless asked to translate.',
    'Preserve technical terms, code, URLs, names, dates and numbers accurately. If unsure about a Venda translation, be transparent.',
  ].join(' ');
}

export function addressOwnerResponse(response: string): string {
  const clean = response.trim();
  const title = process.env.RYANAI_OWNER_TITLE?.trim() || 'Sir G';
  if (!clean) return `Certainly, ${title}. How may I assist you?`;
  const lower = clean.toLocaleLowerCase();
  if (lower.startsWith(title.toLocaleLowerCase()) || lower.startsWith(`certainly, ${title.toLocaleLowerCase()}`) || lower.startsWith(`of course, ${title.toLocaleLowerCase()}`)) return clean;
  return `Certainly, ${title}. ${clean}`;
}
