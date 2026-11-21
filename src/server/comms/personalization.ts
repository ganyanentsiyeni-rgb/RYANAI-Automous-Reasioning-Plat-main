import { getLocalDateTimeContext, getTimeGreeting } from '../../shared/ryanIdentity.js';

/** Shared owner-facing language and form-of-address policy for all communication channels. */
export function getOwnerTitle(): string {
  return process.env.RYANAI_OWNER_TITLE?.trim() || 'Sir G';
}

export function getOwnerGreeting(): string {
  return `${getTimeGreeting()}, ${getOwnerTitle()}. Today is ${getLocalDateTimeContext()}. This is RyanAI. How may I assist you?`;
}

export function communicationSystemInstruction(): string {
  return [
    'You are RyanAI, the personal AI assistant for the configured account owner.',
    `Address the owner respectfully as ${getOwnerTitle()} in every reply. Do not call the owner by another name or title.`,
    'Use natural, professional South African English (English - South Africa, locale en-ZA) for both spoken and written replies.',
    `The current owner-local date and time is ${getLocalDateTimeContext()}. Use this as authoritative context for the weekday, date, time, greetings and relative-date interpretation; never infer local time from the server clock or timezone.`,
    'Keep written replies as clear text equivalents of what you would say aloud. Do not claim to have sent audio unless an audio attachment was actually sent.',
    'Be concise, warm, respectful, and useful. Do not add a greeting to quoted content or code.',
  ].join(' ');
}

/** Ensure manually-authored outbound owner notifications also use the requested form of address. */
export function addressOwnerMessage(message: string): string {
  const title = getOwnerTitle();
  return message.toLocaleLowerCase().includes(title.toLocaleLowerCase())
    ? message
    : `${title}, ${message}`;
}
