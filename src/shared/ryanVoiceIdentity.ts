export const RYANAI_BIRTH_DATE = '2024-05-24';
export const RYANAI_IDENTITY_NAME = 'Mukhethwa Ryan Ganyane';
export const RYANAI_TIME_ZONE = 'Africa/Johannesburg';

export interface RyanAIAnniversaryInfo {
  years: number;
  months: number;
  nextAnniversary: string;
}

const ANNUAL_DELIVERY_STYLES = [
  'Use a youthful but unmistakably adult masculine-presenting voice: bright, clear, warm, medium pitch, and relaxed conversational energy.',
  'Use an adult masculine-presenting voice with a slightly brighter resonance, confident articulation, and friendly measured pacing.',
  'Use a youthful adult masculine-presenting voice with warm clarity, lively but controlled energy, and a natural mid-range register.',
  'Use an adult masculine-presenting voice with balanced resonance, steady pacing, and more assured conversational emphasis.',
  'Use an adult masculine-presenting voice with a warm, grounded tone, clear articulation, and calm confidence.',
  'Use an adult masculine-presenting voice with a composed, lightly textured delivery, measured cadence, and reassuring clarity.',
] as const;

function johannesburgDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-ZA', {
    timeZone: RYANAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: 'year' | 'month' | 'day') => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

export function getRyanAIAnniversaryInfo(date = new Date()): RyanAIAnniversaryInfo {
  const today = johannesburgDateParts(date);
  const birthYear = Number(RYANAI_BIRTH_DATE.slice(0, 4));
  const birthMonth = Number(RYANAI_BIRTH_DATE.slice(5, 7));
  const birthDay = Number(RYANAI_BIRTH_DATE.slice(8, 10));
  let months = (today.year - birthYear) * 12 + today.month - birthMonth;
  if (today.day < birthDay) months -= 1;
  months = Math.max(0, months);
  const years = Math.floor(months / 12);
  const completedMonths = months % 12;
  const anniversaryPassed = today.month > birthMonth || (today.month === birthMonth && today.day >= birthDay);
  const nextYear = anniversaryPassed ? today.year + 1 : today.year;
  return {
    years,
    months: completedMonths,
    nextAnniversary: `${nextYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`,
  };
}

export function getRyanVoiceDeliveryInstruction(
  anniversaryYears: number,
  anniversaryEvolution = true,
): string {
  const safeYears = Number.isInteger(anniversaryYears) && anniversaryYears >= 0 ? anniversaryYears : 0;
  const style = anniversaryEvolution
    ? ANNUAL_DELIVERY_STYLES[safeYears % ANNUAL_DELIVERY_STYLES.length]
    : 'Use a consistent, warm, clear adult masculine-presenting voice with a natural mid-range register and measured conversational pacing.';
  return [
    style,
    'This is an AI-generated adult voice. Never imitate a child or claim to be human.',
    'Preserve the same RyanAI identity, pronunciation, language choice, and conversational character across sessions.',
  ].join(' ');
}
